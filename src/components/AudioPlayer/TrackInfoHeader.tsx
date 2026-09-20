// Track info header shared by file, Spotify, YouTube, and device modes (icon/album art + title/subtitle).
// In waveform view, the waveform renders here instead; this component is used in seekbar view
// or remote playback modes without waveform (Spotify / device detection).
interface TrackInfoHeaderProps {
  icon: React.ReactNode;
  iconBgClass: string;
  imageUrl?: string;
  title: string;
  subtitle?: string;
  extraLine?: string;
  emptyMessage: string;
  onClick?: () => void;
  linkHint?: boolean;
}

export function TrackInfoHeader({
  icon, iconBgClass, imageUrl, title, subtitle, extraLine, emptyMessage, onClick, linkHint,
}: TrackInfoHeaderProps) {
  if (!title) {
    return (
      <div className="h-10 flex items-center px-1">
        <span className="text-xs text-zinc-500">{emptyMessage}</span>
      </div>
    );
  }

  const content = (
    <>
      {imageUrl ? (
        <img src={imageUrl} alt={title} className="w-10 h-10 rounded shrink-0 object-cover" />
      ) : (
        <div className={`w-10 h-10 rounded flex items-center justify-center shrink-0 ${iconBgClass}`}>
          {icon}
        </div>
      )}
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-zinc-100 truncate">
          {title}
          {linkHint && (
            <svg
              className="inline-block ml-1 mb-0.5 opacity-0 group-hover/track:opacity-60"
              width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            >
              <path d="M7 7h10v10" /><path d="M7 17 17 7" />
            </svg>
          )}
        </span>
        {subtitle && <span className="text-xs text-zinc-400 truncate">{subtitle}</span>}
        {extraLine && <span className="text-[10px] text-zinc-600 truncate">{extraLine}</span>}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group/track flex items-center gap-3 min-w-0 px-1 text-left w-full hover:bg-zinc-800/40 rounded-lg py-1 -my-1 transition-colors"
      >
        {content}
      </button>
    );
  }

  return <div className="flex items-center gap-3 min-w-0 px-1">{content}</div>;
}
