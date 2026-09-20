import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { AudioPlayer } from "./components/AudioPlayer/AudioPlayer";
import { MetaEditor } from "./components/MetaEditor/MetaEditor";
import { LrcEditor } from "./components/LrcEditor/LrcEditor";
// Modals not needed at startup -> lazy loaded (reduces initial bundle & parse time)
const PreviewModal = lazy(() => import("./components/Preview/PreviewModal").then((m) => ({ default: m.PreviewModal })));
const SettingsModal = lazy(() => import("./components/Settings/SettingsModal").then((m) => ({ default: m.SettingsModal })));
import { ModeSelectButton } from "./components/Service/ModeSelectButton";
const SpotifySearchModal = lazy(() => import("./components/Service/SpotifySearchModal").then((m) => ({ default: m.SpotifySearchModal })));
import { useLrcStore } from "./stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "./stores/useI18nStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useServiceStore } from "./stores/useServiceStore";
import { audioControls } from "./utils/audioControls";
import { serviceControls } from "./utils/serviceControls";
import { deviceControls } from "./utils/deviceControls";
import { useDeviceStore } from "./stores/useDeviceStore";
import { anyModalOpen } from "./utils/modalGuard";
import { safeUnlisten } from "./utils/safeUnlisten";
import { matchAction, normalizeKeybindings, PLAYBACK_ACTIONS } from "./utils/keybindings";
import { toast } from "./stores/useToastStore";
import { ToastContainer } from "./components/Toast/ToastContainer";
import { type RecoverySnapshot, loadRecoverySnapshot, saveRecoverySnapshot, clearRecoverySnapshot } from "./utils/recovery";
import { initSpotifyPlayer } from "./utils/spotifyPlayer";
import { useUpdaterStore } from "./stores/useUpdaterStore";
import { UpdateModal } from "./components/Update/UpdateModal";
import { useMacMenu } from "./hooks/useMacMenu";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
const HelpModal = lazy(() => import("./components/AppShell/HelpModal").then((m) => ({ default: m.HelpModal })));
import { ConfirmModal } from "./components/AppShell/ConfirmModal";
import { SaveFormatModal } from "./components/AppShell/SaveFormatModal";
import { ELrcNoticeModal } from "./components/AppShell/ELrcNoticeModal";
import { IconBtn } from "./components/AppShell/IconBtn";
import { LangDropdown } from "./components/AppShell/LangDropdown";
import { NewFileIcon, OpenFolderIcon, SaveIcon, SaveAsIcon, UndoIcon, RedoIcon, GearIcon } from "./components/AppShell/icons";
import { RecentFilesMenu } from "./components/AppShell/RecentFilesMenu";

const AUDIO_EXTS = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "aiff", "aif"];
const LYRICS_EXTS = ["lrc", "srt"];
const fileExt = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";

function useGlobalKeys() {
  // Actions have stable references -> narrow selector to avoid re-rendering on per-frame currentTime updates
  const { stampAndAdvance, goToPreviousLine, undo, redo } = useLrcStore(
    useShallow((s) => ({
      stampAndAdvance: s.stampAndAdvance,
      goToPreviousLine: s.goToPreviousLine,
      undo: s.undo,
      redo: s.redo,
    }))
  );
  const syncMode = useLrcStore((s) => s.syncMode);
  const keybindings = useSettingsStore((s) => s.keybindings);
  const isLoggedInForKeys = useServiceStore((s) => s.isLoggedIn);
  const spotifyModeForKeys = useSettingsStore((s) => s.spotifyMode);
  const deviceModeForKeys = useSettingsStore((s) => s.deviceMode);
  const isServiceMode = isLoggedInForKeys && spotifyModeForKeys;

  useEffect(() => {
    const controls = deviceModeForKeys ? deviceControls : isServiceMode ? serviceControls : audioControls;
    const kb = normalizeKeybindings(keybindings);
    const handler = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      // Cmd/Ctrl+Z Undo/Redo (reserved, not rebindable)
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.code === "KeyZ") {
        if (inInput || anyModalOpen()) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      // Key combos with modifiers are not user shortcut targets
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const action = matchAction(e.code, kb);
      if (!action || inInput) return;

      // Playback transport: shared across line/syllable modes (allows media control even when modal open)
      if (PLAYBACK_ACTIONS.includes(action)) {
        e.preventDefault();
        if (action === "skipBack5") controls.skip(-5);
        else if (action === "skipBack1") controls.skip(-1);
        else if (action === "playPause") controls.togglePlay();
        else if (action === "skipFwd1") controls.skip(1);
        else if (action === "skipFwd5") controls.skip(5);
        else if (action === "stop") controls.stopAndReset();
        return;
      }

      // stamp/prevLine: handled by CharSyncView in syllable mode, blocked behind modals
      if (action === "stamp" || action === "prevLine") {
        if (syncMode === "char" || anyModalOpen()) return;
        e.preventDefault();
        if (action === "stamp") stampAndAdvance();
        else goToPreviousLine();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [stampAndAdvance, goToPreviousLine, undo, redo, isServiceMode, deviceModeForKeys, syncMode, keybindings]);
}

// Auto-save after a debounce period once editing pauses, for files with a designated save path.
// New documents without lrcPath have no target destination, so they are not auto-saved.
function useAutoSave() {
  const isDirty = useLrcStore((s) => s.isDirty);
  const lrcPath = useLrcStore((s) => s.lrcPath);
  const doc = useLrcStore((s) => s.doc);
  const autoSave = useSettingsStore((s) => s.autoSave);

  useEffect(() => {
    if (!autoSave || !lrcPath || !isDirty) return;
    const id = setTimeout(() => {
      // Auto-save: silent on success, alert via toast only on failure
      useLrcStore.getState().saveLrc().catch(() => {
        toast.error(useI18nStore.getState().t.toast.saveFailed);
      });
    }, 1500);
    return () => clearTimeout(id);
    // Reset timer on doc changes -> save only after input pauses (debounced)
  }, [autoSave, lrcPath, isDirty, doc]);

  // Snapshot for unsaved recovery: debounced save when dirty, pruned when clean.
  // Operates independently of autoSave to protect even unsaved documents.
  useEffect(() => {
    if (!isDirty) { clearRecoverySnapshot(); return; }
    const id = setTimeout(() => {
      const st = useLrcStore.getState();
      saveRecoverySnapshot(st.doc, st.lrcPath, st.audioPath);
    }, 2000);
    return () => clearTimeout(id);
  }, [isDirty, doc]);
}

// Check silently at startup — store state becomes "available" only if an update exists,
// which triggers UpdateModal automatically. Silent if no update or on error.
function useAutoUpdateCheck(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    useUpdaterStore.getState().checkForUpdate(true);
  }, [enabled]);
}

function App() {
  useGlobalKeys();
  useAutoSave();

  // Capture snapshot at startup (before effects run) before clean effects clear it
  const [recovery, setRecovery] = useState<RecoverySnapshot | null>(() => {
    const snap = loadRecoverySnapshot();
    return snap && snap.doc.lines.length > 0 ? snap : null;
  });
  const [showHelp, setShowHelp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"general" | "models" | "spotify" | "youtube">("general");
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [showFormatChooser, setShowFormatChooser] = useState(false);
  const [showElrcNotice, setShowElrcNotice] = useState(false);
  const pendingSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [showSpotifySearch, setShowSpotifySearch] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropConflict, setDropConflict] = useState<
    { audio?: string; lyrics?: string; audioConflict: boolean; lyricsConflict: boolean } | null
  >(null);
  // Narrow selector to prevent entire App from re-rendering on per-frame currentTime updates
  const { lrcPath, isDirty, openLrc, openAudio, saveLrc, saveLrcAs, newLrc, undo, redo, _history, _future } = useLrcStore(
    useShallow((s) => ({
      lrcPath: s.lrcPath, isDirty: s.isDirty,
      openLrc: s.openLrc, openAudio: s.openAudio, saveLrc: s.saveLrc, saveLrcAs: s.saveLrcAs, newLrc: s.newLrc,
      undo: s.undo, redo: s.redo, _history: s._history, _future: s._future,
    }))
  );
  const hasGlyphSync = useLrcStore((s) => s.doc.lines.some((l) => l.syllables?.some((sy) => sy.time !== null)));
  const { t } = useI18nStore();
  const { autoCheckUpdate, uiScale, spotifyMode, youtubeMode, deviceMode, setSpotifyMode, setYoutubeMode, setDeviceMode, showElrcSaveNotice, setShowElrcSaveNotice } = useSettingsStore();
  const { isLoggedIn, handleCallback, tryRestoreSession, pausePlayback } = useServiceStore();
  const [ytdlpInstalled, setYtdlpInstalled] = useState(false);

  useAutoUpdateCheck(autoCheckUpdate);

  // Start/stop OS media polling upon entering/exiting device mode
  useEffect(() => {
    const store = useDeviceStore.getState();
    if (deviceMode) store.startPolling();
    else store.stopPolling();
    return () => store.stopPolling();
  }, [deviceMode]);

  // Attempt keychain lookup only upon entering Spotify mode (when stored session may exist).
  // Querying unconditionally on launch would prompt keychain access for non-Spotify users,
  // so defer lookup until mode is active (persisted spotifyMode in settings
  // may be true on startup, which this effect also handles).
  useEffect(() => {
    if (spotifyMode && !isLoggedIn) tryRestoreSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotifyMode]);

  // Listen for OAuth callback from local HTTP listener
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listen<string>("spotify-callback", async (e) => {
      try {
        await handleCallback(e.payload);
        initSpotifyPlayer();
      } catch {
        // OAuth failed — user can retry from settings
      }
    }).then((fn) => {
      if (cancelled) safeUnlisten(fn);
      else unlistenFn = fn;
    }).catch(() => {});
    return () => {
      cancelled = true;
      safeUnlisten(unlistenFn);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When session is restored on startup, init polling after refreshing token
  useEffect(() => {
    if (!isLoggedIn) return;
    useServiceStore.getState().ensureToken()
      .then(() => initSpotifyPlayer())
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Clear any zoom set by a previous version of the app
  useEffect(() => { document.documentElement.style.zoom = ""; }, []);

  const handleNewLrc = () => {
    if (isDirty) {
      setShowNewConfirm(true);
    } else {
      newLrc();
    }
  };

  // Notify save outcome via toast (silent on cancel, error on failure)
  const runSave = (p: Promise<boolean>) => {
    p.then((written) => { if (written) toast.success(t.toast.saved); })
     .catch(() => toast.error(t.toast.saveFailed));
  };

  // Prompt confirmation popup before saving as Enhanced LRC when syllable sync is present
  const requestSaveLrc = (fn: () => Promise<boolean>) => {
    if (hasGlyphSync && showElrcSaveNotice) {
      pendingSaveRef.current = fn;
      setShowElrcNotice(true);
    } else {
      runSave(fn());
    }
  };

  const handleSave = () => {
    if (lrcPath) {
      if (lrcPath.toLowerCase().endsWith(".lrc")) requestSaveLrc(() => saveLrc());
      else runSave(saveLrc());
    } else {
      setShowFormatChooser(true);
    }
  };

  const handleOpenLrc = () => openLrc().catch(() => toast.error(t.toast.openFailed));

  // Open dropped file (audio -> audio path, lrc/srt -> lyrics)
  const applyDrop = (d: { audio?: string; lyrics?: string }) => {
    const st = useLrcStore.getState();
    if (d.audio) st.setAudioPath(d.audio);
    if (d.lyrics) st.loadLyricsPath(d.lyrics).catch(() => toast.error(t.toast.openFailed));
  };

  // Drag & drop file opening (Tauri native drop event provides file paths)
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter") {
          // Show overlay only if at least one supported file is detected
          if (p.paths.some((x) => AUDIO_EXTS.includes(fileExt(x)) || LYRICS_EXTS.includes(fileExt(x)))) {
            setIsDragOver(true);
          }
          return;
        }
        if (p.type === "over") return;
        if (p.type === "leave") { setIsDragOver(false); return; }
        // drop
        setIsDragOver(false);
        const audio = p.paths.find((x) => AUDIO_EXTS.includes(fileExt(x)));
        const lyrics = p.paths.find((x) => LYRICS_EXTS.includes(fileExt(x)));
        if (!audio && !lyrics) return; // Ignore unsupported files

        const st = useLrcStore.getState();
        const audioConflict = !!audio && st.audioPath !== null;
        const lyricsConflict = !!lyrics && (st.lrcPath !== null || st.isDirty || st.doc.lines.length > 0);
        if (audioConflict || lyricsConflict) {
          setDropConflict({ audio, lyrics, audioConflict, lyricsConflict });
        } else {
          applyDrop({ audio, lyrics });
        }
      })
      .then((fn) => { if (cancelled) safeUnlisten(fn); else unlisten = fn; })
      .catch(() => {});
    return () => { cancelled = true; safeUnlisten(unlisten); };
  }, []);

  // yt-dlp installation state (determines YouTube mode availability in menu)
  useEffect(() => {
    let active = true;
    const check = () =>
      invoke<string | null>("check_ytdlp")
        .then((v) => { if (active) setYtdlpInstalled(v !== null); })
        .catch(() => {});
    check();
    let unlisten: (() => void) | null = null;
    listen<{ done: boolean }>("ytdlp-install-progress", (e) => {
      if (active && e.payload.done) check();
    }).then((fn) => { unlisten = fn; if (!active) safeUnlisten(fn); }).catch(() => {});
    return () => { active = false; safeUnlisten(unlisten); };
  }, []);

  // Switch mode (same behavior as ModeSelectButton — halts playback on switch)
  const stopCurrentPlaybackForModeSwitch = () => {
    if (spotifyMode && isLoggedIn) pausePlayback();
    else audioControls.pause();
  };
  const selectModeFile = () => {
    stopCurrentPlaybackForModeSwitch();
    setSpotifyMode(false); setYoutubeMode(false); setDeviceMode(false);
  };
  const selectModeSpotify = () => {
    audioControls.pause();
    setSpotifyMode(true); setYoutubeMode(false); setDeviceMode(false);
  };
  const selectModeYouTube = () => {
    stopCurrentPlaybackForModeSwitch();
    setSpotifyMode(false); setYoutubeMode(true); setDeviceMode(false);
  };

  // Select playback controls suited to current mode (local / Spotify / device)
  const isServiceMode = isLoggedIn && spotifyMode;
  const playbackControls = deviceMode ? deviceControls : isServiceMode ? serviceControls : audioControls;

  useMacMenu(
    {
      newFile: handleNewLrc,
      openLrc: handleOpenLrc,
      openAudio,
      save: handleSave,
      saveAsLrc: () => requestSaveLrc(() => saveLrcAs("lrc")),
      saveAsSrt: () => runSave(saveLrcAs("srt")),
      undo,
      redo,
      togglePlay: () => playbackControls.togglePlay(),
      skip: (d) => playbackControls.skip(d),
      stop: () => playbackControls.stopAndReset(),
      modeFile: selectModeFile,
      modeSpotify: selectModeSpotify,
      modeYouTube: selectModeYouTube,
      openSettings: () => { setSettingsInitialTab("general"); setShowSettings(true); },
      openPreview: () => setShowPreview(true),
      openHelp: () => setShowHelp(true),
    },
    { t, spotifyMode, youtubeMode, ytdlpInstalled }
  );

  const title = lrcPath
    ? lrcPath.split(/[\\/]/).pop()
    : t.newFileTitle;

  return (
    <div
      className="flex flex-col bg-zinc-950 text-white overflow-hidden"
      style={{
        transform: `scale(${uiScale})`,
        transformOrigin: "top left",
        width: `${(100 / uiScale).toFixed(4)}vw`,
        height: `${(100 / uiScale).toFixed(4)}vh`,
      }}
    >
      <header className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <span className="font-semibold text-indigo-400 mr-2 shrink-0">Lyrical Sync</span>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-zinc-400 text-sm truncate">
            {title}
            {isDirty && <span className="text-rose-400 ml-1">●</span>}
          </span>
          <div className="flex gap-1 shrink-0">
            <IconBtn onClick={undo} disabled={_history.length === 0} title={t.undo}><UndoIcon /></IconBtn>
            <IconBtn onClick={redo} disabled={_future.length === 0} title={t.redo}><RedoIcon /></IconBtn>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ModeSelectButton />
          <div className="w-px h-5 bg-zinc-700 mx-0.5" />
          {/* File actions group */}
          <IconBtn onClick={handleNewLrc} title={t.newFileBtn}><NewFileIcon /></IconBtn>
          <IconBtn onClick={handleOpenLrc} title={t.openLrc}><OpenFolderIcon /></IconBtn>
          <RecentFilesMenu />
          <IconBtn onClick={handleSave} accent title={t.save} tooltipAlign="right"><SaveIcon /></IconBtn>
          <IconBtn onClick={() => setShowFormatChooser(true)} title={t.saveAs} tooltipAlign="right"><SaveAsIcon /></IconBtn>
          <div className="w-px h-5 bg-zinc-700 mx-0.5" />
          <LangDropdown />
        </div>
      </header>

      {showHelp && (
        <Suspense fallback={null}>
          <HelpModal onClose={() => setShowHelp(false)} />
        </Suspense>
      )}
      {showPreview && (
        <Suspense fallback={null}>
          <PreviewModal onClose={() => setShowPreview(false)} />
        </Suspense>
      )}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            onClose={() => setShowSettings(false)}
            onUpdateFound={() => setShowSettings(false)}
            initialTab={settingsInitialTab}
          />
        </Suspense>
      )}
      <UpdateModal />
      {recovery && (
        <ConfirmModal
          title={t.recovery.title}
          message={`${t.recovery.message}${recovery.doc.metadata.title ? `\n\n「${recovery.doc.metadata.title}」 · ${recovery.doc.lines.length}${t.recovery.lines}` : ""}`}
          okLabel={t.recovery.restore}
          cancelLabel={t.recovery.discard}
          onOk={() => {
            useLrcStore.getState().restoreDoc(recovery.doc, recovery.lrcPath, recovery.audioPath);
            clearRecoverySnapshot();
            setRecovery(null);
          }}
          onCancel={() => { clearRecoverySnapshot(); setRecovery(null); }}
        />
      )}
      {showNewConfirm && (
        <ConfirmModal
          title={t.confirmNewTitle}
          message={t.confirmNewMessage}
          okLabel={t.confirmNewOk}
          cancelLabel={t.confirmNewCancel}
          onOk={() => { setShowNewConfirm(false); newLrc(); }}
          onCancel={() => setShowNewConfirm(false)}
        />
      )}
      {showFormatChooser && (
        <SaveFormatModal
          onSelect={(format) => {
            setShowFormatChooser(false);
            if (format === "lrc") requestSaveLrc(() => saveLrcAs("lrc"));
            else runSave(saveLrcAs(format));
          }}
          onCancel={() => setShowFormatChooser(false)}
        />
      )}
      {showElrcNotice && (
        <ELrcNoticeModal
          onConfirm={(dontShowAgain) => {
            if (dontShowAgain) setShowElrcSaveNotice(false);
            setShowElrcNotice(false);
            const fn = pendingSaveRef.current;
            pendingSaveRef.current = null;
            if (fn) runSave(fn());
          }}
          onCancel={() => { setShowElrcNotice(false); pendingSaveRef.current = null; }}
        />
      )}
      {showSpotifySearch && (
        <Suspense fallback={null}>
          <SpotifySearchModal onClose={() => setShowSpotifySearch(false)} />
        </Suspense>
      )}
      {dropConflict && (
        <ConfirmModal
          title={t.drop.replaceTitle}
          message={
            dropConflict.audioConflict && dropConflict.lyricsConflict
              ? t.drop.replaceBoth
              : dropConflict.audioConflict
              ? t.drop.replaceAudio
              : t.drop.replaceLyrics
          }
          okLabel={t.drop.replaceOk}
          cancelLabel={t.drop.replaceCancel}
          onOk={() => { applyDrop(dropConflict); setDropConflict(null); }}
          onCancel={() => setDropConflict(null)}
        />
      )}
      {isDragOver && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-indigo-950/60 backdrop-blur-sm pointer-events-none border-4 border-dashed border-indigo-400/70 m-2 rounded-2xl">
          <div className="text-center">
            <p className="text-xl font-semibold text-indigo-100">{t.drop.overlayHint}</p>
            <p className="text-sm text-indigo-300 mt-1 font-mono">Audio · LRC · SRT</p>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 gap-0">
        <div className="flex flex-col gap-3 p-3 w-80 shrink-0 overflow-y-auto border-r border-zinc-800">
          <AudioPlayer
            onSpotifySearch={() => setShowSpotifySearch(true)}
            onSpotifyNoClientId={() => { setSettingsInitialTab("spotify"); setShowSettings(true); }}
          />
          <MetaEditor />
        </div>
        <div className="flex flex-col flex-1 p-3 min-h-0">
          <LrcEditor onPreview={() => setShowPreview(true)} />
        </div>
      </div>

      <div className="fixed bottom-4 left-4 flex gap-2 z-10">
        <button
          onClick={() => { setSettingsInitialTab("general"); setShowSettings(true); }}
          title={t.settingsTitle}
          aria-label={t.settingsTitle}
          className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors flex items-center justify-center shadow-lg"
        >
          <GearIcon />
        </button>
        <button
          onClick={() => setShowHelp(true)}
          title={t.shortcutsTitle}
          aria-label={t.shortcutsTitle}
          className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white text-sm font-bold transition-colors flex items-center justify-center shadow-lg"
        >
          ?
        </button>
      </div>

      <ToastContainer />
    </div>
  );
}

export default App;
