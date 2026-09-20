import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { formatDisplayTime } from "../../utils/lrcParser";

// Footer subscribes to currentTime -> only this small component re-renders during playback
export function CurrentTimeFooter() {
  const currentTime = useLrcStore((s) => s.currentTime);
  const { t } = useI18nStore();
  return (
    <div className="text-xs text-zinc-500 text-right font-mono">
      {t.currentTimeLabel}{formatDisplayTime(currentTime)}
    </div>
  );
}
