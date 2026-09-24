import { useEffect, useRef, useState } from "react";
import { type Translations } from "../../i18n/translations";
import { CtrlBtn } from "./CtrlBtn";
import { MorePopover } from "./MorePopover";
import {
  PlayIcon, PauseIcon, StopIcon, SkipBackIcon, SkipFwdIcon, TriLeftIcon, TriRightIcon, MoreIcon,
} from "./icons";

// Playback control row: Stop (left), Skip/Play (center), More (right: loop, markers, spectrogram, speed).
// Owns the "More" popover open state and outside click detection.
export function TransportControls({
  t, audioPath, isAudioReady = true, isPlaying, togglePlay, skip, stopAndReset,
  isLooping, onToggleLoop, showMarkers, onToggleMarkers, showSpectrogram, onToggleSpectrogram,
  playbackRate, speedMin, speedMax, onSpeedDown, onSpeedUp,
}: {
  t: Translations;
  audioPath: string | null;
  isAudioReady?: boolean;
  isPlaying: boolean;
  togglePlay: () => void;
  skip: (delta: number) => void;
  stopAndReset: () => void;
  isLooping: boolean;
  onToggleLoop: () => void;
  showMarkers: boolean;
  onToggleMarkers: () => void;
  showSpectrogram: boolean;
  onToggleSpectrogram: () => void;
  playbackRate: number;
  speedMin: number;
  speedMax: number;
  onSpeedDown: () => void;
  onSpeedUp: () => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close More popover on outside click
  useEffect(() => {
    if (!showMore) return;
    const h = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMore(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showMore]);

  return (
    // relative positioning across the row keeps popover aligned within card boundaries
    <div className="relative flex items-center gap-0.5" ref={moreRef}>
      <CtrlBtn onClick={stopAndReset} title={t.tooltipStop}>
        <StopIcon />
      </CtrlBtn>

      <div className="flex-1 flex items-center justify-center gap-0.5">
        <CtrlBtn onClick={() => skip(-5)} title={t.tooltipSkipBack5}>
          <SkipBackIcon /><span className="text-[10px] font-bold ml-0.5">5</span>
        </CtrlBtn>
        <CtrlBtn onClick={() => skip(-1)} title={t.tooltipSkipBack1}>
          <TriLeftIcon /><span className="text-[10px] font-bold ml-0.5">1</span>
        </CtrlBtn>
        <CtrlBtn onClick={togglePlay} disabled={!audioPath || !isAudioReady} title={t.tooltipPlayPause} accent>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </CtrlBtn>
        <CtrlBtn onClick={() => skip(1)} title={t.tooltipSkipFwd1}>
          <span className="text-[10px] font-bold mr-0.5">1</span><TriRightIcon />
        </CtrlBtn>
        <CtrlBtn onClick={() => skip(5)} title={t.tooltipSkipFwd5}>
          <span className="text-[10px] font-bold mr-0.5">5</span><SkipFwdIcon />
        </CtrlBtn>
      </div>

      <CtrlBtn
        onClick={() => setShowMore((v) => !v)}
        title={t.playerMore}
        active={showMore || isLooping || playbackRate !== 1.0 || showSpectrogram}
      >
        <MoreIcon />
      </CtrlBtn>
      {showMore && (
        <MorePopover
          t={t}
          isLooping={isLooping} onToggleLoop={onToggleLoop}
          showMarkers={showMarkers} onToggleMarkers={onToggleMarkers}
          showSpectrogram={showSpectrogram} onToggleSpectrogram={onToggleSpectrogram}
          playbackRate={playbackRate} speedMin={speedMin} speedMax={speedMax}
          onSpeedDown={onSpeedDown} onSpeedUp={onSpeedUp}
        />
      )}
    </div>
  );
}
