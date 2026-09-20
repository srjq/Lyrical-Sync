import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useBusyStore } from "../../stores/useBusyStore";
import { safeUnlisten } from "../../utils/safeUnlisten";

// YouTube URL -> yt-dlp audio download flow (modal state + progress event + cancellation).
// Separated from AudioPlayer to decouple from file mode / Spotify / device mode logic.
export function useYouTubeLoad(setAudioPath: (path: string) => void) {
  const { ytdlpAudioQuality, ytdlpCookiesFile, ytdlpProxy } = useSettingsStore();

  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoadingRaw] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytModalOpen, setYtModalOpen] = useState(false);

  // Set busy state to prevent update downloads/restarts from clashing with active yt-dlp download
  const YT_BUSY_ID = "youtube-download";
  const setYtLoading = (v: boolean) => {
    setYtLoadingRaw(v);
    if (v) useBusyStore.getState().markBusy(YT_BUSY_ID);
    else useBusyStore.getState().clearBusy(YT_BUSY_ID);
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ percent: number; speed: string; eta: string; done: boolean }>(
      "ytdlp-audio-progress",
      (e) => {
        if (e.payload.done) setYtLoading(false);
      }
    ).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { safeUnlisten(unlisten); };
  }, []);

  const handleYtLoad = async () => {
    const url = ytUrl.trim();
    if (!url) return;
    setYtLoading(true);
    setYtError(null);
    try {
      const path = await invoke<string>("ytdlp_load_audio", {
        url,
        quality: ytdlpAudioQuality,
        cookiesFile: ytdlpCookiesFile,
        proxy: ytdlpProxy,
      });
      setAudioPath(path);
      setYtModalOpen(false);
      setYtUrl("");
    } catch (e) {
      setYtError(String(e));
    } finally {
      setYtLoading(false);
    }
  };

  const handleYtCancel = () => {
    invoke("cancel_ytdlp_load").catch(() => {});
    setYtLoading(false);
  };

  const handleYtModalClose = () => {
    if (ytLoading) return;
    setYtModalOpen(false);
    setYtError(null);
  };

  return {
    ytUrl, ytLoading, ytError, ytModalOpen,
    setYtUrl, setYtError, setYtModalOpen,
    handleYtLoad, handleYtCancel, handleYtModalClose,
  };
}
