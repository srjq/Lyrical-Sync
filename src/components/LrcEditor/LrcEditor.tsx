import { useRef, useEffect, useCallback, useState, useMemo, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "../../stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { formatTimestamp, parseTimestampInput, validateTimestamps, type SyncUnit } from "../../utils/lrcParser";
import { audioControls } from "../../utils/audioControls";
import { serviceControls } from "../../utils/serviceControls";
import { MODEL_DEFS } from "../../utils/modelDefs";
import { safeUnlisten } from "../../utils/safeUnlisten";
import { CurrentTimeFooter } from "./CurrentTimeFooter";
import { MiniConfirm } from "./MiniConfirm";
import { FindReplaceBar } from "./FindReplaceBar";
import { TimeShiftBar } from "./TimeShiftBar";
import { ValidationPanel } from "./ValidationPanel";
import { ScaleBar } from "./ScaleBar";
import { LrcLineRow } from "./LrcLineRow";
import { SyncModeToggle } from "./SyncModeToggle";
import { EditorToolsMenu } from "./EditorToolsMenu";
import { BulkActionsBar } from "./BulkActionsBar";
// Syllable sync view and auto-spotting modal are lazy loaded on demand
const CharSyncView = lazy(() => import("./CharSyncView").then((m) => ({ default: m.CharSyncView })));
const AutoSpotModal = lazy(() => import("../AudioPlayer/AutoSpotModal").then((m) => ({ default: m.AutoSpotModal })));

// ISO 639-3 codes used by ctc-forced-aligner / MMS model
const LANG_CODE: Record<string, string> = { ko: "kor", en: "eng", ja: "jpn" };

export function LrcEditor({ onPreview }: { onPreview: () => void }) {
  // Exclude currentTime from subscription to prevent line list from re-rendering every frame
  const {
    doc, activeLineId,
    addLine, insertLinesAfter, updateLine, deleteLine,
    duplicateLine, mergeLineUp, splitLine, moveLine, scaleTimestamps,
    deleteLines, shiftLines, clearTimestamps,
    stampCurrentLine, setActiveLineId,
    aiSyncStatus, aiSyncMessage, aiSyncProgressStatus, aiDraftConfidence,
    runAiSync, cancelAiSync, clearAiDraft,
    replaceInLines, shiftTimeRange,
    audioPath,
    syncMode, syncUnit, setSyncMode, setSyncUnit, clearLineSyllables,
    loopLineId, setLoopLine,
  } = useLrcStore(
    useShallow((s) => ({
      doc: s.doc, activeLineId: s.activeLineId,
      addLine: s.addLine, insertLinesAfter: s.insertLinesAfter, updateLine: s.updateLine, deleteLine: s.deleteLine,
      duplicateLine: s.duplicateLine, mergeLineUp: s.mergeLineUp, splitLine: s.splitLine, moveLine: s.moveLine, scaleTimestamps: s.scaleTimestamps,
      deleteLines: s.deleteLines, shiftLines: s.shiftLines, clearTimestamps: s.clearTimestamps,
      stampCurrentLine: s.stampCurrentLine, setActiveLineId: s.setActiveLineId,
      aiSyncStatus: s.aiSyncStatus, aiSyncMessage: s.aiSyncMessage, aiSyncProgressStatus: s.aiSyncProgressStatus, aiDraftConfidence: s.aiDraftConfidence,
      runAiSync: s.runAiSync, cancelAiSync: s.cancelAiSync, clearAiDraft: s.clearAiDraft,
      replaceInLines: s.replaceInLines, shiftTimeRange: s.shiftTimeRange,
      audioPath: s.audioPath,
      syncMode: s.syncMode, syncUnit: s.syncUnit, setSyncMode: s.setSyncMode, setSyncUnit: s.setSyncUnit, clearLineSyllables: s.clearLineSyllables,
      loopLineId: s.loopLineId, setLoopLine: s.setLoopLine,
    }))
  );
  const { t, lang } = useI18nStore();
  const { blankLineOffset, spotifyMode, deviceMode, lyricsFontScale, useVocalSeparation, useVad } = useSettingsStore();
  const serviceLoggedIn = useServiceStore((s) => s.isLoggedIn);
  // Consider service mode active only when logged in and spotifyMode is active.
  // Uses spotifyMode rather than isReady so account connection alone does not block AI sync.
  const isServiceMode = serviceLoggedIn && spotifyMode;
  const serviceActive = isServiceMode;
  // AI Auto-Sync is only applicable in file/YouTube modes with local audio.
  // Blocks both Spotify and device detection modes as they lack local audio files
  // (judged by spotifyMode itself, unlike isServiceMode).
  const aiSyncModeUnsupported = spotifyMode || deviceMode;
  const { lines } = doc;

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingFocusId = useRef<string | null>(null);

  const [pythonReady, setPythonReady] = useState(false);
  const [missingModels, setMissingModels] = useState<string[]>([]);

  // Find/Replace state
  const [showFR, setShowFR] = useState(false);

  // Time Shift state
  const [showTS, setShowTS] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [showAutoSpot, setShowAutoSpot] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  // Multi-line selection (bulk actions)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selAnchor, setSelAnchor] = useState<string | null>(null);

  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchPos, setMatchPos] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Inline timestamp editing state (direct time input on left click)
  const [editingTsId, setEditingTsId] = useState<string | null>(null);
  const [editTsValue, setEditTsValue] = useState("");

  // Guard against onBlur triggering commit when input unmounts on Esc cancellation
  const tsEditCancel = useRef(false);

  // Warning when editing text or changing units of syllable-synced lines
  const [pendingTextEdit, setPendingTextEdit] = useState<{ id: string; text: string } | null>(null);
  const [pendingUnit, setPendingUnit] = useState<SyncUnit | null>(null);
  const [pendingAiSync, setPendingAiSync] = useState(false);
  // Drag reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const charMode = syncMode === "char";

  // Text edit: prompt confirmation before re-tokenizing if line has syllable timings
  const handleTextChange = (id: string, value: string) => {
    const ln = lines.find((l) => l.id === id);
    if (ln?.syllables?.some((s) => s.time !== null)) {
      setPendingTextEdit({ id, text: value });
      return;
    }
    updateLine(id, { text: value });
  };
  const confirmTextEdit = () => {
    if (pendingTextEdit) updateLine(pendingTextEdit.id, { text: pendingTextEdit.text, syllables: undefined });
    setPendingTextEdit(null);
  };

  // Unit change: prompt confirmation and reset line if active line has syllable timings
  const handleUnitChange = (u: SyncUnit) => {
    if (u === syncUnit) return;
    const active = lines.find((l) => l.id === activeLineId);
    if (active?.syllables?.some((s) => s.time !== null)) {
      setPendingUnit(u);
      return;
    }
    setSyncUnit(u);
  };
  const confirmUnitChange = () => {
    if (pendingUnit) {
      const active = lines.find((l) => l.id === activeLineId);
      if (active) clearLineSyllables(active.id);
      setSyncUnit(pendingUnit);
    }
    setPendingUnit(null);
  };

  const startTsEdit = (id: string, timestamp: number | null) => {
    tsEditCancel.current = false;
    setActiveLineId(id);
    setEditTsValue(timestamp !== null ? formatTimestamp(timestamp) : "");
    setEditingTsId(id);
  };
  const commitTsEdit = (id: string) => {
    if (tsEditCancel.current) { tsEditCancel.current = false; return; }
    const parsed = parseTimestampInput(editTsValue.trim());
    if (parsed !== null) updateLine(id, { timestamp: parsed });
    setEditingTsId(null);
  };
  const cancelTsEdit = () => {
    tsEditCancel.current = true;
    setEditingTsId(null);
  };

  const checkAiRequirements = useCallback(async () => {
    try {
      const v = await invoke<{ packagesReady: boolean }>("get_python_env_info");
      setPythonReady(v.packagesReady);
    } catch {
      setPythonReady(false);
    }
    const missing: string[] = [];
    for (const model of MODEL_DEFS.filter((m) => m.required)) {
      try {
        const results = await invoke<boolean[]>("check_model_files", { filenames: model.files.map((f) => f.filename) });
        if (!results.every(Boolean)) missing.push(model.name);
      } catch {
        missing.push(model.name);
      }
    }
    setMissingModels(missing);
  }, []);

  useEffect(() => { checkAiRequirements(); }, [checkAiRequirements]);

  useEffect(() => {
    let unlistenModel: (() => void) | null = null;
    let unlistenPip: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ done: boolean }>("model-download-progress", (e) => {
        if (e.payload.done) checkAiRequirements();
      }).then((fn) => { unlistenModel = fn; }).catch(() => {});
      listen<{ done: boolean }>("pip-install-progress", (e) => {
        if (e.payload.done) checkAiRequirements();
      }).then((fn) => { unlistenPip = fn; }).catch(() => {});
    });
    return () => { safeUnlisten(unlistenModel); safeUnlisten(unlistenPip); };
  }, [checkAiRequirements]);

  const canRunAi = pythonReady && missingModels.length === 0;

  useEffect(() => {
    if (!activeLineId) return;
    rowRefs.current.get(activeLineId)?.scrollIntoView({ block: "nearest" });
  }, [activeLineId]);

  useEffect(() => {
    if (pendingFocusId.current) {
      inputRefs.current.get(pendingFocusId.current)?.focus();
      pendingFocusId.current = null;
    }
  });

  const setInputRef = useCallback((id: string) => (el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  }, []);

  const setRowRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === "Enter" && e.shiftKey) {
      // Shift+Enter = split line at cursor position
      e.preventDefault();
      const caret = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
      const newId = splitLine(id, caret);
      setActiveLineId(newId);
      pendingFocusId.current = newId;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const newId = insertLinesAfter(id, [""]);
      setActiveLineId(newId);
      pendingFocusId.current = newId;
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, id: string, currentText: string) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.includes("\n")) return;

    e.preventDefault();
    const input = e.currentTarget;
    const selStart = input.selectionStart ?? currentText.length;
    const selEnd = input.selectionEnd ?? currentText.length;
    const before = currentText.slice(0, selStart);
    const after = currentText.slice(selEnd);
    const pasteLines = pasted.split(/\r?\n/);

    // Invalidate syllable sync tokens since text has changed
    updateLine(id, { text: before + pasteLines[0], syllables: undefined });

    const restTexts = pasteLines.slice(1);
    restTexts[restTexts.length - 1] += after;
    const newId = insertLinesAfter(id, restTexts);
    setActiveLineId(newId);
    pendingFocusId.current = newId;
  };

  // Timestamp validation warnings
  const warnings = useMemo(() => validateTimestamps(lines), [lines]);

  // Completion stats: ratio of stamped lines among text-containing lines
  const stats = useMemo(() => {
    const nonEmpty = lines.filter((l) => l.text.trim() !== "");
    const stamped = nonEmpty.filter((l) => l.timestamp !== null).length;
    return { total: nonEmpty.length, stamped, pct: nonEmpty.length ? Math.round((stamped / nonEmpty.length) * 100) : 0 };
  }, [lines]);

  // Issues: warnings (duplicates/ordering) + unstamped (text without timestamp)
  type Issue = { id: string; lineNo: number; text: string; type: "duplicate" | "outOfOrder" | "unstamped" };
  const issues = useMemo(() => {
    const out: Issue[] = [];
    lines.forEach((l, i) => {
      const w = warnings.get(l.id);
      if (w) out.push({ id: l.id, lineNo: i + 1, text: l.text, type: w });
      else if (l.text.trim() !== "" && l.timestamp === null) out.push({ id: l.id, lineNo: i + 1, text: l.text, type: "unstamped" });
    });
    return out;
  }, [lines, warnings]);

  const jumpToLine = (id: string) => {
    setActiveLineId(id);
    rowRefs.current.get(id)?.scrollIntoView({ block: "center" });
    setShowValidation(false);
  };

  // Line click: Shift=range select, Ctrl/Cmd=toggle, click=single select + seek
  const handleRowClick = (e: React.MouseEvent, id: string, idx: number) => {
    if (e.shiftKey && selAnchor) {
      const aIdx = lines.findIndex((l) => l.id === selAnchor);
      if (aIdx >= 0) {
        const [lo, hi] = aIdx <= idx ? [aIdx, idx] : [idx, aIdx];
        setSelectedIds(new Set(lines.slice(lo, hi + 1).map((l) => l.id)));
      }
      setActiveLineId(id);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
      });
      setSelAnchor(id);
      setActiveLineId(id);
      return;
    }
    // Normal click: clear multi-selection + standard action (select/seek)
    if (selectedIds.size > 0) setSelectedIds(new Set());
    setSelAnchor(id);
    setActiveLineId(id);
    const ln = lines.find((l) => l.id === id);
    if (ln && ln.timestamp !== null) {
      (serviceActive ? serviceControls : audioControls).seekTo(ln.timestamp);
    }
    if (showFR) {
      const mi = matchIds.indexOf(id);
      if (mi !== -1) setMatchPos(mi);
    }
  };

  // Matched line ID list
  const matchIds = useMemo(() => {
    if (!findText) return [];
    const needle = caseSensitive ? findText : findText.toLowerCase();
    return lines
      .filter((l) => (caseSensitive ? l.text : l.text.toLowerCase()).includes(needle))
      .map((l) => l.id);
  }, [lines, findText, caseSensitive]);

  // Clamp matchPos within bounds
  useEffect(() => {
    if (matchIds.length === 0) return;
    setMatchPos((p) => Math.min(p, matchIds.length - 1));
  }, [matchIds.length]);

  // Scroll to current match (maintains focus in find input)
  useEffect(() => {
    if (!showFR || !findText || matchIds.length === 0) return;
    const id = matchIds[matchPos];
    rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
  }, [matchPos, matchIds, findText, caseSensitive, showFR]);

  // Open via Ctrl/Cmd+F
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyF") {
        e.preventDefault();
        setShowFR(true);
        setTimeout(() => findInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleAddLine = useCallback(() => {
    addLine();
    const allLines = useLrcStore.getState().doc.lines;
    const lastId = allLines[allLines.length - 1]?.id;
    if (lastId) {
      setActiveLineId(lastId);
      pendingFocusId.current = lastId;
    }
  }, [addLine, setActiveLineId]);

  const handleFRClose = useCallback(() => {
    setShowFR(false);
    setMatchPos(0);
  }, []);

  const handleFRPrev = useCallback(() => {
    setMatchPos((p) => (p > 0 ? p - 1 : matchIds.length - 1));
  }, [matchIds.length]);

  const handleFRNext = useCallback(() => {
    setMatchPos((p) => (p < matchIds.length - 1 ? p + 1 : 0));
  }, [matchIds.length]);

  const handleReplace = useCallback(() => {
    if (!matchIds.length || !findText) return;
    const id = matchIds[matchPos];
    const line = lines.find((l) => l.id === id);
    if (!line) return;
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, caseSensitive ? "" : "i");
    const newText = line.text.replace(re, replaceText);
    if (newText !== line.text) updateLine(id, { text: newText });
    // Move to next match (auto-advances after next render as matchIds updates)
    setMatchPos((p) => (p < matchIds.length - 1 ? p + 1 : 0));
  }, [matchIds, matchPos, findText, replaceText, caseSensitive, lines, updateLine]);

  const handleReplaceAll = useCallback(() => {
    if (!findText) return;
    replaceInLines(findText, replaceText, caseSensitive);
    setMatchPos(0);
  }, [findText, replaceText, caseSensitive, replaceInLines]);

  const handleShiftApply = useCallback((fromIdx: number, toIdx: number, delta: number) => {
    shiftTimeRange(fromIdx, toIdx, delta);
    setShowTS(false);
  }, [shiftTimeRange]);

  const runAiSyncNow = () => {
    const language = LANG_CODE[lang] ?? "eng";
    runAiSync(language, blankLineOffset, useVocalSeparation, useVad);
  };
  const handleAiSync = () => {
    // AI alignment re-aligns at line level -> strips syllable sync. Confirm first if present.
    const hasGlyph = lines.some((l) => l.syllables?.some((s) => s.time !== null));
    if (hasGlyph) { setPendingAiSync(true); return; }
    runAiSyncNow();
  };

  const isRunning = aiSyncStatus === "running";

  const PROGRESS_STATUS_MAP: Record<string, string> = {
    loading_model: t.aiSyncStatusLoadingModel,
    loading_audio: t.aiSyncStatusLoadingAudio,
    analyzing: t.aiSyncStatusAnalyzing,
    aligning: t.aiSyncStatusAligning,
    postprocessing: t.aiSyncStatusPostprocessing,
    separating: t.aiSyncStatusAnalyzing,
    done: t.aiSyncStatusDone,
  };

  const displayMessage = aiSyncStatus === "error"
    ? aiSyncMessage
    : (PROGRESS_STATUS_MAP[aiSyncProgressStatus] ?? aiSyncMessage);


  return (
    <div className="flex flex-col gap-2 p-4 bg-zinc-900 rounded-xl border border-zinc-700 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-300">{t.lyricsEditor}</h2>
          {!charMode && stats.total > 0 && (
            <button
              onClick={() => setShowValidation(true)}
              title={t.validationTitle}
              className="flex items-center gap-1.5 text-xs rounded-full border px-2 py-0.5 transition-colors border-zinc-700 hover:bg-zinc-800"
            >
              <span className={stats.pct === 100 ? "text-emerald-400" : "text-zinc-400"}>{stats.pct}%</span>
              {warnings.size > 0 && <span className="text-amber-400">⚠ {warnings.size}</span>}
            </button>
          )}
        </div>
        <div className="flex gap-2 items-center flex-wrap justify-end">

          <SyncModeToggle
            t={t} charMode={charMode} onSetSyncMode={setSyncMode}
            syncUnit={syncUnit} onUnitChange={handleUnitChange} isRunning={isRunning}
          />

          {!charMode && (<>
          {/* AI Auto Sync */}
          <div className="relative group">
            <button
              onClick={isRunning ? undefined : handleAiSync}
              disabled={isRunning || !canRunAi || !audioPath || aiSyncModeUnsupported}
              className={[
                "px-3 py-1 text-xs rounded-lg transition-colors",
                isRunning
                  ? "bg-indigo-800 text-indigo-300 cursor-not-allowed"
                  : canRunAi && audioPath && !aiSyncModeUnsupported
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                  : "bg-zinc-700 text-zinc-500 cursor-not-allowed",
              ].join(" ")}
            >
              {isRunning ? t.aiSyncRunning : t.aiAutoSync}
            </button>
            {!isRunning && (aiSyncModeUnsupported || !canRunAi || !audioPath) && (
              <div className="absolute top-full right-0 mt-1.5 hidden group-hover:block z-20 w-60 bg-zinc-800 border border-zinc-600 text-xs text-zinc-300 rounded-lg px-3 py-2 shadow-xl pointer-events-none">
                {aiSyncModeUnsupported ? (
                  t.aiSyncModeUnsupported
                ) : !canRunAi ? (
                  <>
                    <p className="font-medium text-zinc-200 mb-1">{t.aiSyncNoModel}</p>
                    <ul className="flex flex-col gap-0.5 text-zinc-400">
                      {!pythonReady && <li>· {t.settingsVenvTitle}</li>}
                      {missingModels.map((name) => <li key={name}>· {name}</li>)}
                    </ul>
                  </>
                ) : (
                  t.aiSyncNoAudio
                )}
              </div>
            )}
          </div>

          {/* Cancel (only while running) */}
          {isRunning && (
            <button
              onClick={cancelAiSync}
              className="px-3 py-1 text-xs rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              {t.aiSyncCancel}
            </button>
          )}

          {/* Clear AI draft */}
          {aiDraftConfidence && !isRunning && (
            <button
              onClick={clearAiDraft}
              className="px-3 py-1 text-xs rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              {t.aiSyncClear}
            </button>
          )}

          <EditorToolsMenu
            t={t} showFR={showFR} showTS={showTS} showScale={showScale} showAutoSpot={showAutoSpot}
            onToggleFR={() => { setShowFR((v) => !v); setTimeout(() => findInputRef.current?.focus(), 0); }}
            onToggleTS={() => setShowTS((v) => !v)}
            onToggleScale={() => setShowScale((v) => !v)}
            onOpenAutoSpot={() => setShowAutoSpot(true)}
          />
          </>)}
          <button
            onClick={onPreview}
            className="px-3 py-1 text-xs rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            {t.previewBtn}
          </button>
          {!charMode && (
          <button
            onClick={handleAddLine}
            className="px-3 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            {t.addLine}
          </button>
          )}
        </div>
      </div>

      {charMode && (
        <Suspense fallback={null}>
          <CharSyncView />
        </Suspense>
      )}

      {!charMode && (<>
      {/* AI progress message */}
      {(isRunning || aiSyncStatus === "error") && displayMessage && (
        <div className={[
          "text-xs px-2 py-1 rounded",
          aiSyncStatus === "error"
            ? "text-red-300 bg-red-900/30"
            : "text-indigo-300 bg-indigo-900/30",
        ].join(" ")}>
          {displayMessage}
        </div>
      )}

      {showTS && (
        <TimeShiftBar
          lineCount={lines.length}
          defaultFrom={(activeLineId ? lines.findIndex((l) => l.id === activeLineId) : 0) + 1}
          onApply={handleShiftApply}
          onClose={() => setShowTS(false)}
        />
      )}

      {showScale && (
        <ScaleBar
          onApply={(factor) => { scaleTimestamps(factor); setShowScale(false); }}
          onClose={() => setShowScale(false)}
        />
      )}

      <BulkActionsBar
        t={t} count={selectedIds.size}
        onShiftMinus={() => shiftLines([...selectedIds], -0.1)}
        onShiftPlus={() => shiftLines([...selectedIds], 0.1)}
        onClearTs={() => clearTimestamps([...selectedIds])}
        onDelete={() => { deleteLines([...selectedIds]); setSelectedIds(new Set()); }}
        onDeselect={() => setSelectedIds(new Set())}
      />

      {showFR && (
        <FindReplaceBar
          findText={findText}
          replaceText={replaceText}
          caseSensitive={caseSensitive}
          matchCount={matchIds.length}
          matchPos={matchPos}
          onFindChange={(v) => { setFindText(v); setMatchPos(0); }}
          onReplaceChange={setReplaceText}
          onCaseSensitiveToggle={() => setCaseSensitive((v) => !v)}
          onPrev={handleFRPrev}
          onNext={handleFRNext}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
          onClose={handleFRClose}
          findInputRef={findInputRef}
        />
      )}

      <div
        className="flex-1 overflow-y-auto flex flex-col gap-1 px-1 py-1"
        onDoubleClick={(e) => { if (e.target === e.currentTarget) handleAddLine(); }}
      >
        {lines.length === 0 && (
          <p
            className="text-zinc-500 text-sm text-center py-8 cursor-pointer"
            onDoubleClick={handleAddLine}
          >{t.noLines}</p>
        )}
        {lines.map((line, idx) => {
          const isActive = line.id === activeLineId;
          const confidence = aiDraftConfidence?.[line.id];
          const isMatch = showFR && matchIds.includes(line.id);
          const isCurrentMatch = showFR && matchIds[matchPos] === line.id;
          const warning = warnings.get(line.id);

          return (
            <LrcLineRow
              key={line.id}
              t={t}
              line={line}
              idx={idx}
              isActive={isActive}
              isSelected={selectedIds.has(line.id)}
              confidence={confidence}
              isMatch={isMatch}
              isCurrentMatch={isCurrentMatch}
              warning={warning}
              loopLineId={loopLineId}
              lyricsFontScale={lyricsFontScale}
              dragIdx={dragIdx}
              dragOverIdx={dragOverIdx}
              onDragStart={(e) => { e.stopPropagation(); setDragIdx(idx); }}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
              onDragOver={(e) => { if (dragIdx !== null) { e.preventDefault(); if (dragOverIdx !== idx) setDragOverIdx(idx); } }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx !== null && dragIdx !== idx) moveLine(dragIdx, idx);
                setDragIdx(null); setDragOverIdx(null);
              }}
              editingTsId={editingTsId}
              editTsValue={editTsValue}
              onEditTsChange={setEditTsValue}
              onStartTsEdit={() => startTsEdit(line.id, line.timestamp)}
              onCommitTsEdit={() => commitTsEdit(line.id)}
              onCancelTsEdit={cancelTsEdit}
              onStampCurrentLine={() => stampCurrentLine(line.id)}
              onRowClick={(e) => handleRowClick(e, line.id, idx)}
              onToggleLoop={(e) => {
                e.stopPropagation();
                if (loopLineId === line.id) { setLoopLine(null); return; }
                if (line.timestamp === null) return;
                setLoopLine(line.id);
                (serviceActive ? serviceControls : audioControls).seekTo(line.timestamp);
              }}
              onTextChange={(value) => handleTextChange(line.id, value)}
              onKeyDown={(e) => handleKeyDown(e, line.id)}
              onPaste={(e) => handlePaste(e, line.id, line.text)}
              onFocus={() => setActiveLineId(line.id)}
              onMergeUp={(e) => {
                e.stopPropagation();
                if (idx === 0) return;
                const pid = mergeLineUp(line.id);
                if (pid) { setActiveLineId(pid); pendingFocusId.current = pid; }
              }}
              onDuplicate={(e) => {
                e.stopPropagation();
                const nid = duplicateLine(line.id);
                setActiveLineId(nid); pendingFocusId.current = nid;
              }}
              onDelete={(e) => { e.stopPropagation(); deleteLine(line.id); }}
              inputRef={setInputRef(line.id)}
              rowRef={setRowRef(line.id)}
            />
          );
        })}
      </div>
      </>)}

      <CurrentTimeFooter />

      {pendingTextEdit && (
        <MiniConfirm
          title={t.charSync.retokenizeTitle}
          message={t.charSync.retokenizeMsg}
          okLabel={t.charSync.retokenizeOk}
          cancelLabel={t.charSync.retokenizeCancel}
          onOk={confirmTextEdit}
          onCancel={() => setPendingTextEdit(null)}
        />
      )}
      {pendingUnit && (
        <MiniConfirm
          title={t.charSync.retokenizeTitle}
          message={t.charSync.unitChangeMsg}
          okLabel={t.charSync.retokenizeOk}
          cancelLabel={t.charSync.retokenizeCancel}
          onOk={confirmUnitChange}
          onCancel={() => setPendingUnit(null)}
        />
      )}
      {pendingAiSync && (
        <MiniConfirm
          title={t.aiSyncGlyphWarnTitle}
          message={t.aiSyncGlyphWarnMsg}
          okLabel={t.aiSyncGlyphWarnOk}
          cancelLabel={t.charSync.retokenizeCancel}
          onOk={() => { setPendingAiSync(false); runAiSyncNow(); }}
          onCancel={() => setPendingAiSync(false)}
        />
      )}
      {showValidation && (
        <ValidationPanel
          stats={stats}
          issues={issues}
          onJump={jumpToLine}
          onClose={() => setShowValidation(false)}
        />
      )}
      {showAutoSpot && (
        <Suspense fallback={null}>
          <AutoSpotModal onClose={() => setShowAutoSpot(false)} />
        </Suspense>
      )}
    </div>
  );
}

