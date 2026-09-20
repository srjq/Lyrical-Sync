import { invoke } from "@tauri-apps/api/core";
import { useDeviceStore } from "../stores/useDeviceStore";

async function deviceTogglePlay(): Promise<void> {
  const store = useDeviceStore.getState();
  const willPlay = !store.isPlaying;
  // Optimistic update: reflect immediately to prevent display drift during command response latency (same as Spotify pattern)
  useDeviceStore.setState({
    isPlaying: willPlay,
    _lastKnownPositionMs: store.positionMs,
    _lastStateTimestamp: Date.now(),
  });
  if (willPlay) store._startInterpolation();
  else store._stopInterpolation();
  await invoke("now_playing_toggle_play_pause");
}

async function deviceSeekTo(seconds: number): Promise<void> {
  const posMs = Math.max(0, Math.round(seconds * 1000));
  useDeviceStore.setState({
    positionMs: posMs,
    _lastKnownPositionMs: posMs,
    _lastStateTimestamp: Date.now(),
  });
  await invoke("now_playing_seek", { positionMs: posMs });
}

export const deviceControls = {
  togglePlay: () => { deviceTogglePlay().catch(() => {}); },
  skip: (delta: number) => {
    const { positionMs } = useDeviceStore.getState();
    deviceSeekTo((positionMs + delta * 1000) / 1000).catch(() => {});
  },
  seekTo: (seconds: number) => { deviceSeekTo(seconds).catch(() => {}); },
  // Forcing arbitrary third-party apps to "stop + rewind to start" may not be supported by source app;
  // only pause is performed (unlike Spotify, seek(0) is not called to avoid rewinding other apps)
  stopAndReset: () => {
    const store = useDeviceStore.getState();
    if (store.isPlaying) deviceTogglePlay().catch(() => {});
  },
};
