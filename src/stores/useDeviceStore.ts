import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "./useLrcStore";
import { useSettingsStore } from "./useSettingsStore";
import { useI18nStore } from "./useI18nStore";
import { toast } from "./useToastStore";

// Detects currently playing media on this PC (Spotify desktop, Apple Music, browser, etc.)
// regardless of source app using Windows SMTC / macOS MediaRemote.
// Follows the same polling + interpolation pattern as Spotify remote control (useServiceStore).

interface NowPlayingInfo {
  title: string;
  artist: string;
  album: string;
  position_ms: number;
  duration_ms: number;
  is_playing: boolean;
  source_app: string;
  last_updated_unix_ms: number;
}

interface DeviceState {
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  trackName: string;
  artistName: string;
  albumName: string;
  sourceApp: string;
  hasSession: boolean; // Whether an active session is detected (true if track info exists even if paused)
  _lastKnownPositionMs: number;
  _lastStateTimestamp: number;

  startPolling: () => void;
  stopPolling: () => void;
  _startInterpolation: () => void;
  _stopInterpolation: () => void;
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let interpolationRaf: number | null = null;
// Notify once per failure streak — polling continues while mode is active, resets upon success
// so subsequent disconnects notify again.
let hasNotifiedFailure = false;

export const useDeviceStore = create<DeviceState>((set, get) => ({
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  trackName: "",
  artistName: "",
  albumName: "",
  sourceApp: "",
  hasSession: false,
  _lastKnownPositionMs: 0,
  _lastStateTimestamp: 0,

  startPolling: () => {
    if (pollingInterval !== null) return;
    hasNotifiedFailure = false;
    pollOnce();
    pollingInterval = setInterval(pollOnce, 1000);
  },

  stopPolling: () => {
    if (pollingInterval !== null) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
    get()._stopInterpolation();
  },

  _startInterpolation: () => {
    if (interpolationRaf !== null) return;
    const tick = () => {
      const { isPlaying, _lastKnownPositionMs, _lastStateTimestamp, durationMs } = get();
      if (!isPlaying) {
        interpolationRaf = null;
        return;
      }
      const elapsed = Date.now() - _lastStateTimestamp;
      const interpolated = Math.min(_lastKnownPositionMs + elapsed, durationMs);
      set({ positionMs: interpolated });
      if (useSettingsStore.getState().deviceMode) {
        useLrcStore.getState().setCurrentTime(interpolated / 1000);
      }
      interpolationRaf = requestAnimationFrame(tick);
    };
    interpolationRaf = requestAnimationFrame(tick);
  },

  _stopInterpolation: () => {
    if (interpolationRaf !== null) {
      cancelAnimationFrame(interpolationRaf);
      interpolationRaf = null;
    }
  },
}));

async function pollOnce(): Promise<void> {
  if (!useSettingsStore.getState().deviceMode) {
    useDeviceStore.getState()._stopInterpolation();
    return;
  }
  try {
    const info = await invoke<NowPlayingInfo | null>("get_now_playing");
    hasNotifiedFailure = false;
    const store = useDeviceStore.getState();
    if (!info) {
      if (store.hasSession) useDeviceStore.setState({ hasSession: false, isPlaying: false });
      store._stopInterpolation();
      return;
    }

    // Compensate position by elapsed time since last_updated_unix_ms (compensates for polling latency)
    const elapsedSinceUpdate = info.is_playing
      ? Math.max(0, Date.now() - info.last_updated_unix_ms)
      : 0;
    const positionMs = Math.min(info.position_ms + elapsedSinceUpdate, info.duration_ms || info.position_ms);

    useDeviceStore.setState({
      hasSession: true,
      isPlaying: info.is_playing,
      positionMs,
      durationMs: info.duration_ms,
      trackName: info.title,
      artistName: info.artist,
      albumName: info.album,
      sourceApp: info.source_app,
      _lastKnownPositionMs: positionMs,
      _lastStateTimestamp: Date.now(),
    });

    if (useSettingsStore.getState().deviceMode) {
      useLrcStore.getState().setMetadata({ title: info.title, artist: info.artist, album: info.album }, true);
    }

    if (info.is_playing) store._startInterpolation();
    else {
      store._stopInterpolation();
      if (useSettingsStore.getState().deviceMode) useLrcStore.getState().setCurrentTime(positionMs / 1000);
    }
  } catch {
    // Adapter invocation failed (e.g. macOS update blocks workaround) — polling retries
    // while mode is on, but notification is displayed once per failure streak.
    if (!hasNotifiedFailure) {
      hasNotifiedFailure = true;
      toast.error(useI18nStore.getState().t.toast.deviceUnavailable);
    }
  }
}
