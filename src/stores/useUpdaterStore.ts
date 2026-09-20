import { create } from "zustand";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useLrcStore } from "./useLrcStore";
import { saveRecoverySnapshot } from "../utils/recovery";

export type UpdaterStatus =
  | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";

interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  body: string | null; // Release notes
  progress: number; // 0-100, meaningful only during downloading
  error: string | null;
  _update: Update | null; // Internal handle for download/install execution, not used directly by UI

  checkForUpdate: (silent?: boolean) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restart: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  version: null,
  body: null,
  progress: 0,
  error: null,
  _update: null,

  checkForUpdate: async (silent = false) => {
    if (!silent) set({ status: "checking", error: null });
    try {
      const update = await check();
      if (update) {
        set({ status: "available", version: update.version, body: update.body ?? null, _update: update });
      } else {
        set({ status: silent ? "idle" : "up-to-date" });
      }
    } catch (e) {
      set({ status: silent ? "idle" : "error", error: silent ? null : String(e) });
    }
  },

  downloadAndInstall: async () => {
    const { _update } = get();
    if (!_update) return;
    set({ status: "downloading", progress: 0, error: null });
    try {
      let total = 0;
      let downloaded = 0;
      await _update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (total > 0) set({ progress: Math.min(100, Math.round((downloaded / total) * 100)) });
            break;
          case "Finished":
            set({ progress: 100 });
            break;
        }
      });
      set({ status: "ready" });
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  restart: async () => {
    // Before process terminates upon restart, force immediate (non-debounced) save
    // to prevent losing recent edits if debounced auto-save/recovery snapshot has not run yet.
    const lrc = useLrcStore.getState();
    if (lrc.isDirty) {
      if (lrc.lrcPath) {
        try { await lrc.saveLrc(); } catch { /* Even on failure, snapshot below acts as safety net */ }
      }
      const after = useLrcStore.getState();
      if (after.isDirty) {
        saveRecoverySnapshot(after.doc, after.lrcPath, after.audioPath);
      }
    }
    await relaunch();
  },

  dismiss: () => set({ status: "idle", version: null, body: null, progress: 0, error: null, _update: null }),
}));
