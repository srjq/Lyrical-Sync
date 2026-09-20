// Playback control button — reused across AudioPlayer (file), ServicePlayerPanel (Spotify),
// and DevicePlayerPanel (device mode). Callers pass exact styling classes.
export function CtrlBtn({
  onClick, title, children, active, accent, disabled,
  accentClass = "w-9 h-9 rounded-full bg-indigo-500 hover:bg-indigo-400 active:bg-indigo-600 text-white",
  activeClass = "h-9 px-2 rounded-lg bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25",
  baseClass = "h-9 px-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white",
}: {
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  active?: boolean;
  accent?: boolean;
  disabled?: boolean;
  accentClass?: string;
  activeClass?: string;
  baseClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className={[
        "flex items-center justify-center text-sm transition-colors",
        "disabled:opacity-30 disabled:cursor-not-allowed",
        accent ? accentClass : active ? activeClass : baseClass,
      ].join(" ")}
    >
      {children}
    </button>
  );
}
