import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type KeyAction, DEFAULT_KEYBINDINGS } from "../utils/keybindings";

interface SettingsState {
  autoCheckUpdate: boolean;
  /** Auto-save on change for files with a designated save path */
  autoSave: boolean;
  uiScale: number;
  /** Custom model storage path. "" = use default app path */
  modelsDir: string;
  /** Empty line timestamp = previous lyric end + blankLineOffset seconds */
  blankLineOffset: number;
  /** Show notification popup when saving as Enhanced LRC due to syllable/word sync. If false, save without prompting */
  showElrcSaveNotice: boolean;
  /** Lyric editor font size scale factor (0.8 to 1.5, default: 1.0) */
  lyricsFontScale: number;
  /** Show time marker below character in syllable sync mode */
  showGlyphTimeMarkers: boolean;
  /** Show spectrogram instead of/alongside waveform (useful for inspecting pitch and harmonic structure) */
  showSpectrogram: boolean;
  /** Use Demucs vocal separation during AI alignment (when installed). If false, align with original audio */
  useVocalSeparation: boolean;
  /** Use vocal activity detection (VAD) during AI alignment — precise empty line placement and confidence correction. Requires vocal separation */
  useVad: boolean;
  /** Global shortcut bindings (action -> KeyboardEvent.code) */
  keybindings: Record<KeyAction, string>;
  /** Spotify Developer App client_id (manually entered by user) */
  spotifyClientId: string;
  /** Whether Spotify mode is active (switches UI independently of login state) */
  spotifyMode: boolean;
  /** Whether YouTube mode is active */
  youtubeMode: boolean;
  /** Whether device detection mode is active (detects local media playback via Windows SMTC / macOS MediaRemote) */
  deviceMode: boolean;
  /** yt-dlp audio quality */
  ytdlpAudioQuality: "best" | "192" | "128";
  /** yt-dlp cookie file path (for content requiring login) */
  ytdlpCookiesFile: string;
  /** yt-dlp proxy configuration */
  ytdlpProxy: string;
  /** Whether user has agreed once to YouTube download disclaimer */
  youtubeDisclaimerAccepted: boolean;
  /** List of recently opened files (lyrics/audio), up to 8 items in reverse chronological order */
  recentFiles: RecentFileEntry[];
  setAutoCheckUpdate: (v: boolean) => void;
  setAutoSave: (v: boolean) => void;
  setUiScale: (v: number) => void;
  setModelsDir: (v: string) => void;
  setBlankLineOffset: (v: number) => void;
  setShowElrcSaveNotice: (v: boolean) => void;
  setLyricsFontScale: (v: number) => void;
  setShowGlyphTimeMarkers: (v: boolean) => void;
  setShowSpectrogram: (v: boolean) => void;
  setUseVocalSeparation: (v: boolean) => void;
  setUseVad: (v: boolean) => void;
  setKeybinding: (action: KeyAction, code: string) => void;
  resetKeybindings: () => void;
  setSpotifyClientId: (v: string) => void;
  setSpotifyMode: (v: boolean) => void;
  setYoutubeMode: (v: boolean) => void;
  setDeviceMode: (v: boolean) => void;
  setYtdlpAudioQuality: (v: "best" | "192" | "128") => void;
  setYtdlpCookiesFile: (v: string) => void;
  setYtdlpProxy: (v: string) => void;
  setYoutubeDisclaimerAccepted: (v: boolean) => void;
  /** Add recent file entry (moves to front if same combination exists, keeps up to 8) */
  addRecentFile: (entry: { lrcPath: string | null; audioPath: string | null }) => void;
  clearRecentFiles: () => void;
}

export interface RecentFileEntry {
  lrcPath: string | null;
  audioPath: string | null;
  openedAt: number;
}

const MAX_RECENT_FILES = 8;

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoCheckUpdate: true,
      autoSave: true,
      uiScale: 1.0,
      modelsDir: "",
      blankLineOffset: 1.0,
      showElrcSaveNotice: true,
      lyricsFontScale: 1.0,
      showGlyphTimeMarkers: true,
      showSpectrogram: false,
      useVocalSeparation: true,
      useVad: true,
      keybindings: { ...DEFAULT_KEYBINDINGS },
      spotifyClientId: "",
      spotifyMode: false,
      youtubeMode: false,
      deviceMode: false,
      ytdlpAudioQuality: "best",
      ytdlpCookiesFile: "",
      ytdlpProxy: "",
      youtubeDisclaimerAccepted: false,
      recentFiles: [],
      setAutoCheckUpdate: (v) => set({ autoCheckUpdate: v }),
      setAutoSave: (v) => set({ autoSave: v }),
      setUiScale: (v) => set({ uiScale: v }),
      setModelsDir: (v) => set({ modelsDir: v }),
      setBlankLineOffset: (v) => set({ blankLineOffset: v }),
      setShowElrcSaveNotice: (v) => set({ showElrcSaveNotice: v }),
      setLyricsFontScale: (v) => set({ lyricsFontScale: v }),
      setShowGlyphTimeMarkers: (v) => set({ showGlyphTimeMarkers: v }),
      setShowSpectrogram: (v) => set({ showSpectrogram: v }),
      setUseVocalSeparation: (v) => set({ useVocalSeparation: v }),
      setUseVad: (v) => set({ useVad: v }),
      setKeybinding: (action, code) =>
        set((s) => ({ keybindings: { ...s.keybindings, [action]: code } })),
      resetKeybindings: () => set({ keybindings: { ...DEFAULT_KEYBINDINGS } }),
      setSpotifyClientId: (v) => set({ spotifyClientId: v }),
      setSpotifyMode: (v) => set({ spotifyMode: v }),
      setYoutubeMode: (v) => set({ youtubeMode: v }),
      setDeviceMode: (v) => set({ deviceMode: v }),
      setYtdlpAudioQuality: (v) => set({ ytdlpAudioQuality: v }),
      setYtdlpCookiesFile: (v) => set({ ytdlpCookiesFile: v }),
      setYtdlpProxy: (v) => set({ ytdlpProxy: v }),
      setYoutubeDisclaimerAccepted: (v) => set({ youtubeDisclaimerAccepted: v }),
      addRecentFile: (entry) =>
        set((s) => {
          if (!entry.lrcPath && !entry.audioPath) return s;
          const sameEntry = (f: RecentFileEntry) => f.lrcPath === entry.lrcPath && f.audioPath === entry.audioPath;
          const next = [{ ...entry, openedAt: Date.now() }, ...s.recentFiles.filter((f) => !sameEntry(f))];
          return { recentFiles: next.slice(0, MAX_RECENT_FILES) };
        }),
      clearRecentFiles: () => set({ recentFiles: [] }),
    }),
    { name: "lyrical-sync-settings" }
  )
);
