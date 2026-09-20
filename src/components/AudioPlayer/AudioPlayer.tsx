import { useEffect, useRef, useState, useCallback, useMemo, lazy, Suspense } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
// Spectrogram plugin (~36KB) is only needed when toggled on -> dynamically imported to exclude from initial bundle
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "../../stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";
import { toast } from "../../stores/useToastStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { audioControls } from "../../utils/audioControls";
import { readAudioBytes } from "../../utils/readAudioBytes";
import { activateSpotifyPlayer } from "../../utils/spotifyPlayer";
import { formatDisplayTime } from "../../utils/lrcParser";
import { ServicePlayerPanel } from "../Service/ServicePlayerPanel";
import { DevicePlayerPanel } from "../Service/DevicePlayerPanel";
import { TrackInfoHeader } from "./TrackInfoHeader";
import { SeekBar } from "./SeekBar";
import { NoTrackAlert } from "./NoTrackAlert";
import { useYouTubeLoad } from "./useYouTubeLoad";
import { TransportControls } from "./TransportControls";
// Only needed in YouTube mode -> lazy-loaded to reduce initial bundle
const YouTubeModal = lazy(() => import("./YouTubeModal").then((m) => ({ default: m.YouTubeModal })));
import { VolumeIcon, ZoomIcon, FileGlyph, YouTubeGlyph, YouTubeLinkIcon } from "./icons";

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav",
  ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", opus: "audio/ogg",
  aiff: "audio/aiff", aif: "audio/aiff",
};

const SPEED_STEPS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

// Zoom slider uses a logarithmic scale so that equal slider movements produce
// equal *ratios* of zoom change (better UX) and the default sits exactly at
// the visual center (level 50 out of 0–100).
//   level=0   → 10 px/s  (zoomed out)
//   level=50  → ~71 px/s (default, center)
//   level=100 → 500 px/s (zoomed in)
const ZOOM_PX_MIN = 10;
const ZOOM_PX_MAX = 500;
const zoomLevelToPixels = (level: number) =>
  Math.round(ZOOM_PX_MIN * Math.pow(ZOOM_PX_MAX / ZOOM_PX_MIN, level / 100));

interface AudioPlayerProps {
  onSpotifySearch?: () => void;
  onSpotifyNoClientId?: () => void;
}

export function AudioPlayer({ onSpotifySearch, onSpotifyNoClientId }: AudioPlayerProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const spectrogramContainerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const peaksRef = useRef<number[] | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);
  const isLoopingRef = useRef(false);
  const playbackRateRef = useRef(1.0);
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPlaying, setIsPlayingLocal] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [duration, setDurationLocal] = useState(0);
  const [currentTime, setCurrentTimeLocal] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(50); // 0–100, center=50
  const [volume, setVolume] = useState(1.0);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [viewMode, setViewMode] = useState<"waveform" | "bar">("waveform");
  const [showNoTrackAlert, setShowNoTrackAlert] = useState(false);

  // Renders UI via local state (currentTimeLocal, etc.), so does not subscribe to store currentTime
  const { audioPath, setCurrentTime, setIsPlaying, setDuration, openAudio, setAudioPath } = useLrcStore(
    useShallow((s) => ({
      audioPath: s.audioPath, setCurrentTime: s.setCurrentTime, setIsPlaying: s.setIsPlaying,
      setDuration: s.setDuration, openAudio: s.openAudio, setAudioPath: s.setAudioPath,
    }))
  );
  const lines = useLrcStore((s) => s.doc.lines);
  const metadata = useLrcStore((s) => s.doc.metadata);
  const activeLineId = useLrcStore((s) => s.activeLineId);
  const [showMarkers, setShowMarkers] = useState(true);
  const { t } = useI18nStore();
  const { isLoggedIn, startLogin, fetchCurrentlyPlaying, transferPlaybackToApp } = useServiceStore();
  const {
    spotifyMode, spotifyClientId, youtubeMode, deviceMode,
    showSpectrogram, setShowSpectrogram,
  } = useSettingsStore();
  const isServiceMode = isLoggedIn && spotifyMode;

  const {
    ytUrl, ytLoading, ytError, ytModalOpen,
    setYtUrl, setYtError, setYtModalOpen,
    handleYtLoad, handleYtCancel, handleYtModalClose,
  } = useYouTubeLoad(setAudioPath);

  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#6366f1",
      progressColor: "#a5b4fc",
      cursorColor: "#f43f5e",
      height: 80,
      normalize: true,
      interact: true,
    });
    // Prevent horizontal scrollbar on Windows from obscuring bottom of waveform
    ws.getWrapper().classList.add("ws-scroll");

    // Lyric timestamp marker plugin
    const regions = ws.registerPlugin(RegionsPlugin.create());
    regionsRef.current = regions;

    // Click lyric marker on waveform -> select line (editor auto-scrolls on activeLineId change)
    regions.on("region-clicked", (region, e) => {
      if (typeof region.id === "string" && region.id.startsWith("lyric:")) {
        e.stopPropagation(); // Prevent waveform seek
        useLrcStore.getState().setActiveLineId(region.id.slice("lyric:".length));
      }
    });

    // In Spotify/device mode, prevent local waveform from overwriting global playback state
    // (currentTime/isPlaying/duration). Local UI state (*Local) is always updated.
    const inService = () => {
      const settings = useSettingsStore.getState();
      return (useServiceStore.getState().isLoggedIn && settings.spotifyMode) || settings.deviceMode;
    };

    ws.on("ready", () => {
      const d = ws.getDuration();
      setDurationLocal(d);
      if (!inService()) setDuration(d);
      setIsAudioReady(true);
      // Normalized peaks cache for syllable sync lane waveform
      try {
        peaksRef.current = ws.exportPeaks({ channels: 1, maxLength: 4000 })[0] ?? null;
      } catch {
        peaksRef.current = null;
      }
      // Re-apply playback rate because media element resets to 1.0 on loading new audio
      if (playbackRateRef.current !== 1.0) {
        ws.setPlaybackRate(playbackRateRef.current);
      }
    });
    ws.on("audioprocess", (t) => {
      setCurrentTimeLocal(t);
      if (!inService()) setCurrentTime(t);
      // Line repeat: loops back to line start when reaching end of repeated interval.
      // Read directly from store each frame to prevent closure staleness.
      const { loopLineId, doc } = useLrcStore.getState();
      if (loopLineId) {
        const idx = doc.lines.findIndex((l) => l.id === loopLineId);
        const line = idx >= 0 ? doc.lines[idx] : null;
        if (line && line.timestamp !== null) {
          let end = ws.getDuration();
          for (let i = idx + 1; i < doc.lines.length; i++) {
            if (doc.lines[i].timestamp !== null) { end = doc.lines[i].timestamp as number; break; }
          }
          if (t >= end) {
            const d = ws.getDuration();
            if (d > 0) ws.seekTo(Math.max(0, Math.min(1, line.timestamp / d)));
          }
        }
      }
    });
    ws.on("seeking", (t) => {
      setCurrentTimeLocal(t);
      if (!inService()) setCurrentTime(t);
    });
    ws.on("play", () => { setIsPlayingLocal(true); if (!inService()) setIsPlaying(true); });
    ws.on("pause", () => { setIsPlayingLocal(false); if (!inService()) setIsPlaying(false); });
    ws.on("finish", () => {
      if (isLoopingRef.current) {
        ws.seekTo(0);
        ws.play();
      } else {
        setIsPlayingLocal(false);
        if (!inService()) setIsPlaying(false);
      }
    });

    wsRef.current = ws;
    return () => ws.destroy();
  }, [setCurrentTime]);

  useEffect(() => {
    audioControls.togglePlay = () => wsRef.current?.playPause();
    audioControls.pause = () => wsRef.current?.pause();
    audioControls.skip = (delta: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      if (useLrcStore.getState().loopLineId) useLrcStore.getState().setLoopLine(null);
      const d = ws.getDuration();
      if (!d) return;
      const t = Math.max(0, Math.min(d, ws.getCurrentTime() + delta));
      ws.seekTo(t / d);
    };
    audioControls.stopAndReset = () => {
      const ws = wsRef.current;
      if (!ws) return;
      if (useLrcStore.getState().loopLineId) useLrcStore.getState().setLoopLine(null);
      ws.pause();
      ws.seekTo(0);
      setCurrentTimeLocal(0);
      setCurrentTime(0);
    };
    audioControls.getPeaks = () => peaksRef.current;
    audioControls.seekTo = (seconds: number) => {
      const ws = wsRef.current;
      if (!ws) return;
      const d = ws.getDuration();
      if (!d) return;
      ws.seekTo(Math.max(0, Math.min(1, seconds / d)));
    };
  });

  const blobUrlRef = useRef<string | null>(null);

  // Revoke last Blob URL on unmount (load effect below revokes previous URL on path changes)
  useEffect(() => () => {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  useEffect(() => {
    // Local audio is not played in Spotify/device modes. audioPath may retain its file-mode value
    // across mode switches (intentionally retained to reuse when switching back); filtering here
    // avoids erroneously attempting to load the old file upon recovery.
    if (!wsRef.current || !audioPath || spotifyMode || deviceMode) return;
    let cancelled = false;

    setIsAudioReady(false);

    const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";

    readAudioBytes(audioPath).then(({ bytes, transcoded }) => {
      if (cancelled || !wsRef.current) return;

      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);

      const mimeType = transcoded ? "audio/wav" : (AUDIO_MIME[ext] ?? "audio/*");
      const blob = new Blob([bytes], { type: mimeType });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      return wsRef.current.load(url);
    }).catch((e) => {
      // Ignore cancellation from new load (AbortError); notify only genuine decode/read errors
      if (cancelled || (e && (e as Error).name === "AbortError")) return;
      toast.error(useI18nStore.getState().t.toast.audioLoadFailed);
    });

    return () => { cancelled = true; };
  }, [audioPath, spotifyMode, deviceMode]);

  // When opening audio, read metadata tags (ID3, etc.) to automatically populate empty fields
  useEffect(() => {
    // Skip in Spotify/device mode for the same reason — otherwise after crash recovery,
    // tags from previous local files could overwrite metadata of active document.
    if (!audioPath || spotifyMode || deviceMode) return;
    let cancelled = false;
    invoke<{ title: string; artist: string; album: string }>("read_audio_metadata", { path: audioPath })
      .then((m) => {
        if (cancelled) return;
        const cur = useLrcStore.getState().doc.metadata;
        const patch: { title?: string; artist?: string; album?: string } = {};
        if (!cur.title.trim() && m.title) patch.title = m.title;
        if (!cur.artist.trim() && m.artist) patch.artist = m.artist;
        if (!cur.album.trim() && m.album) patch.album = m.album;
        if (Object.keys(patch).length > 0) useLrcStore.getState().setMetadata(patch);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [audioPath, spotifyMode, deviceMode]);

  // Apply current zoom upon audio load completion (slider adjustments debounce directly)
  useEffect(() => {
    if (!wsRef.current || !isAudioReady) return;
    wsRef.current.zoom(zoomLevelToPixels(zoomLevel));
  }, [isAudioReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    wsRef.current?.setVolume(volume);
  }, [volume]);

  // Markers depend only on line ID, timestamp, and line number -> text edits without timestamp change
  // do not recreate regions, narrowing dependencies to prevent recreation on every keystroke.
  const markerSig = useMemo(
    () => lines.map((l, i) => (l.timestamp !== null ? `${l.id}:${l.timestamp}:${i}` : "")).filter(Boolean).join("|"),
    [lines]
  );

  // Synchronize lyric timestamp markers to waveform
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !isAudioReady) return;
    regions.clearRegions();
    if (!showMarkers) return;
    // Markers are purely visual — pointer-events disabled to avoid blocking waveform seek,
    // Set lyric markers as clickable so clicking selects the corresponding line.
    lines.forEach((l, i) => {
      if (l.timestamp === null) return;
      const isActive = l.id === activeLineId;
      const r = regions.addRegion({
        id: `lyric:${l.id}`,
        start: l.timestamp,
        color: isActive ? "#ea580c" : "rgba(217, 119, 6, 0.8)",
        drag: false,
        resize: false,
      });
      if (r.element) {
        r.element.style.pointerEvents = "auto";
        r.element.style.cursor = "pointer";
        r.element.style.overflow = "visible";
        r.element.classList.add("lyric-marker");
        // Line number at top (1-based, matches editor line number). Active line always shown;
        // inactive lines shown only on hover to prevent overlapping clutter.
        const label = document.createElement("div");
        label.textContent = String(i + 1);
        label.className = isActive ? "lyric-marker-num" : "lyric-marker-num dim";
        label.style.cssText = [
          "position:absolute", "top:0", "left:50%", "transform:translateX(-50%)",
          "font:600 9px ui-monospace,SFMono-Regular,monospace", "line-height:1.4",
          "padding:0 3px", "border-radius:0 0 3px 3px", "color:#fff",
          `background:${isActive ? "#ea580c" : "#b45309"}`,
          "pointer-events:none", "white-space:nowrap", "z-index:5",
        ].join(";");
        r.element.appendChild(label);
      }
    });
    // lines/activeLineId use latest closure values. Recreate only on markerSig (marker movement) ->
    // when only active line changes, effect below toggles styling without recreating regions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerSig, isAudioReady, showMarkers]);

  // Active line change: update color and label styles without recreating regions
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions || !isAudioReady || !showMarkers) return;
    const activeRegionId = activeLineId ? `lyric:${activeLineId}` : null;
    regions.getRegions().forEach((r) => {
      const isActive = r.id === activeRegionId;
      r.setOptions({ color: isActive ? "#ea580c" : "rgba(217, 119, 6, 0.8)" });
      const label = r.element?.querySelector<HTMLElement>(".lyric-marker-num");
      if (label) {
        label.className = isActive ? "lyric-marker-num" : "lyric-marker-num dim";
        label.style.background = isActive ? "#ea580c" : "#b45309";
      }
    });
  }, [activeLineId, isAudioReady, showMarkers, markerSig]);

  // Spectrogram plugin (~36KB) is dynamically imported only when enabled (avoids initial bundle and FFT overhead),
  // completely cleaned up via destroy() when turned off
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || !showSpectrogram || !spectrogramContainerRef.current) return;
    let cancelled = false;
    let plugin: InstanceType<typeof import("wavesurfer.js/dist/plugins/spectrogram.esm.js").default> | null = null;
    import("wavesurfer.js/dist/plugins/spectrogram.esm.js").then(({ default: SpectrogramPlugin }) => {
      if (cancelled || !wsRef.current || !spectrogramContainerRef.current) return;
      plugin = wsRef.current.registerPlugin(
        SpectrogramPlugin.create({ container: spectrogramContainerRef.current, height: 80, labels: false, scale: "mel" })
      );
    });
    return () => {
      cancelled = true;
      plugin?.destroy();
    };
  }, [showSpectrogram]);

  const togglePlay = useCallback(() => wsRef.current?.playPause(), []);

  const skip = useCallback((delta: number) => {
    const ws = wsRef.current;
    if (!ws) return;
    if (useLrcStore.getState().loopLineId) useLrcStore.getState().setLoopLine(null);
    const d = ws.getDuration();
    if (!d) return;
    const t = Math.max(0, Math.min(d, ws.getCurrentTime() + delta));
    ws.seekTo(t / d);
  }, []);

  const stopAndReset = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (useLrcStore.getState().loopLineId) useLrcStore.getState().setLoopLine(null);
    ws.pause();
    ws.seekTo(0);
    setCurrentTimeLocal(0);
    setCurrentTime(0);
  }, [setCurrentTime]);

  const toggleLoop = useCallback(() => {
    setIsLooping((prev) => {
      isLoopingRef.current = !prev;
      return !prev;
    });
  }, []);

  const adjustSpeed = useCallback((dir: 1 | -1) => {
    setPlaybackRate((prev) => {
      const idx = SPEED_STEPS.indexOf(prev);
      const next = idx === -1
        ? 1.0
        : SPEED_STEPS[Math.max(0, Math.min(SPEED_STEPS.length - 1, idx + dir))];
      if (next !== prev) {
        playbackRateRef.current = next;
        wsRef.current?.setPlaybackRate(next);
      }
      return next;
    });
  }, []);

  const handleSpotifyLogin = async () => {
    if (!spotifyClientId.trim()) {
      onSpotifyNoClientId?.();
      return;
    }
    try { await startLogin(); } catch { /* error shown in settings */ }
  };

  const handleLoadCurrent = async () => {
    try {
      const track = await fetchCurrentlyPlaying();
      if (track) {
        await activateSpotifyPlayer(); // Unlock audio from user gesture (for Web Playback SDK device playback)
        await transferPlaybackToApp();
      } else setShowNoTrackAlert(true);
    } catch { setShowNoTrackAlert(true); }
  };

  return (
    <>
      {showNoTrackAlert && (
        <NoTrackAlert t={t} onClose={() => setShowNoTrackAlert(false)} />
      )}
      {ytModalOpen && (
        <Suspense fallback={null}>
          <YouTubeModal
            t={t}
            ytUrl={ytUrl}
            ytLoading={ytLoading}
            ytError={ytError}
            onChangeUrl={(v) => { setYtUrl(v); setYtError(null); }}
            onLoad={handleYtLoad}
            onCancel={handleYtCancel}
            onClose={handleYtModalClose}
          />
        </Suspense>
      )}
    <div className="flex flex-col gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-700">
      {/* WaveSurfer container must always remain in the DOM while the component
          is mounted — removing it detaches the canvas and breaks the instance
          when switching back from Spotify mode. Hide with display:none instead. */}
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden bg-zinc-800 cursor-pointer"
        style={{ minHeight: 80, display: (isServiceMode || deviceMode || viewMode === "bar") ? "none" : "" }}
      />
      <div
        ref={spectrogramContainerRef}
        className="w-full rounded-lg overflow-hidden bg-zinc-800"
        style={{ minHeight: 80, display: (isServiceMode || deviceMode || viewMode === "bar" || !showSpectrogram) ? "none" : "" }}
      />

      {isServiceMode ? (
        <ServicePlayerPanel
          onSpotifySearch={onSpotifySearch}
          onLoadCurrent={handleLoadCurrent}
        />
      ) : deviceMode ? (
        <DevicePlayerPanel />
      ) : (
      <>
      {viewMode === "bar" && (
        <TrackInfoHeader
          icon={youtubeMode ? <YouTubeGlyph /> : <FileGlyph />}
          iconBgClass={youtubeMode ? "bg-red-500/15 text-red-400" : "bg-indigo-500/15 text-indigo-300"}
          title={metadata.title || (audioPath ? (audioPath.split(/[\\/]/).pop() ?? "") : "")}
          subtitle={[metadata.artist, metadata.album].filter(Boolean).join(" · ")}
          emptyMessage={t.noAudioShort}
        />
      )}

      {viewMode === "bar" && (
        <SeekBar
          position={currentTime}
          duration={duration}
          onSeek={audioControls.seekTo}
          accentClass={youtubeMode ? "bg-red-500" : "bg-indigo-500"}
        />
      )}

      {/* Time display (waveform mode only) */}
      {viewMode === "waveform" && (
        <div className="flex justify-between text-xs text-zinc-400 font-mono px-1">
          <span>{formatDisplayTime(currentTime)}</span>
          <span>{formatDisplayTime(duration)}</span>
        </div>
      )}

      <TransportControls
        t={t}
        audioPath={audioPath}
        isPlaying={isPlaying}
        togglePlay={togglePlay}
        skip={skip}
        stopAndReset={stopAndReset}
        isLooping={isLooping}
        onToggleLoop={toggleLoop}
        showMarkers={showMarkers}
        onToggleMarkers={() => setShowMarkers((v) => !v)}
        showSpectrogram={showSpectrogram}
        onToggleSpectrogram={() => setShowSpectrogram(!showSpectrogram)}
        playbackRate={playbackRate}
        speedMin={SPEED_STEPS[0]}
        speedMax={SPEED_STEPS[SPEED_STEPS.length - 1]}
        onSpeedDown={() => adjustSpeed(-1)}
        onSpeedUp={() => adjustSpeed(1)}
      />

      {/* Open button */}
      {spotifyMode ? (
        !isLoggedIn ? (
          <button
            onClick={handleSpotifyLogin}
            className="w-full py-1.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm transition-colors text-center truncate"
          >
            {t.spotifyConnect}
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleLoadCurrent}
              className="flex-1 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm transition-colors text-center truncate"
            >
              {t.spotifyLoadCurrent}
            </button>
            <button
              onClick={onSpotifySearch}
              className="flex-1 py-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-white text-sm transition-colors text-center truncate"
            >
              {t.spotifySearchTrack}
            </button>
          </div>
        )
      ) : youtubeMode ? (
        <button
          onClick={() => setYtModalOpen(true)}
          className="w-full py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm transition-colors text-center truncate flex items-center justify-center gap-2"
        >
          <YouTubeLinkIcon />
          {ytLoading ? t.youtubeLoading : t.youtubeOpenLink}
        </button>
      ) : (
        <button
          onClick={openAudio}
          className="w-full py-2 rounded-lg border border-zinc-700 hover:border-zinc-600 hover:bg-zinc-800 text-zinc-300 text-sm transition-colors text-center truncate"
        >
          {t.openAudio}
        </button>
      )}

      {/* Volume (speaker icon + slim slider) */}
      <div className="flex items-center gap-2.5 text-zinc-400" title={`${t.volume} ${Math.round(volume * 100)}%`}>
        <span className="shrink-0"><VolumeIcon /></span>
        <input
          type="range" min={0} max={1} step={0.01} value={volume}
          onChange={(e) => setVolume(parseFloat(Number(e.target.value).toFixed(2)))}
          className="range-slim min-w-0 flex-1"
          style={{ background: `linear-gradient(to right, #6366f1 ${Math.round(volume * 100)}%, #3f3f46 ${Math.round(volume * 100)}%)` }}
        />
        <span className="shrink-0 w-9 text-right text-xs text-zinc-400 tabular-nums">{Math.round(volume * 100)}%</span>
      </div>

      {/* Zoom + view toggle */}
      <div className="flex items-center gap-2.5 text-zinc-400">
        {viewMode === "waveform" ? (
          <>
            <span className="shrink-0"><ZoomIcon /></span>
            <input
              type="range" min={0} max={100} value={zoomLevel}
              onChange={(e) => {
                const v = Number(e.target.value);
                setZoomLevel(v);
                if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
                zoomDebounceRef.current = setTimeout(() => {
                  if (wsRef.current && isAudioReady) wsRef.current.zoom(zoomLevelToPixels(v));
                }, 80);
              }}
              className="range-slim min-w-0 flex-1"
              style={{ background: `linear-gradient(to right, #6366f1 ${zoomLevel}%, #3f3f46 ${zoomLevel}%)` }}
            />
          </>
        ) : (
          <div className="flex-1" />
        )}
        <div className="flex shrink-0 bg-zinc-800 rounded-lg p-0.5">
          <button
            onClick={() => setViewMode("waveform")}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === "waveform" ? "bg-zinc-600 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.tooltipViewWaveform}
          </button>
          <button
            onClick={() => setViewMode("bar")}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors ${
              viewMode === "bar" ? "bg-zinc-600 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.tooltipViewSeekBar}
          </button>
        </div>
      </div>

      {!audioPath && (
        <p className="text-center text-zinc-500 text-sm">{t.noAudio}</p>
      )}
      </>
      )}
    </div>
    </>
  );
}

