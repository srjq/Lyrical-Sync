import { create } from "zustand";
import { LrcDocument, LrcLine, LrcMetadata, LrcSyllable, defaultDocument } from "../types/lrc";
import { parseLrc, serializeLrc, type SyncUnit } from "../utils/lrcParser";
import { serializeSrt, parseSrt } from "../utils/srtConverter";
import { serializeVtt, serializeAss } from "../utils/exportFormats";
import { toast } from "./useToastStore";
import { useI18nStore } from "./useI18nStore";
import { useSettingsStore } from "./useSettingsStore";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

type AiSyncStatus = "idle" | "running" | "done" | "error";

interface AlignmentResult {
  index: number;
  start: number;
  end: number;
  confidence: number;
}

interface AlignmentProgressEvent {
  status: string;
  message: string;
  percent: number;
}

interface LrcStore {
  doc: LrcDocument;
  _history: LrcDocument[];
  _future: LrcDocument[];
  undo: () => void;
  redo: () => void;
  audioPath: string | null;
  lrcPath: string | null;
  currentTime: number;
  isDirty: boolean;
  activeLineId: string | null;

  isPlaying: boolean;
  duration: number;
  setIsPlaying: (v: boolean) => void;
  setDuration: (d: number) => void;
  setCurrentTime: (t: number) => void;
  setActiveLineId: (id: string | null) => void;
  stampAndAdvance: () => void;
  goToPreviousLine: () => void;

  // Line repeat playback: when playback position reaches end of line interval,
  // loops back to line start (handled in AudioPlayer audioprocess handler)
  loopLineId: string | null;
  setLoopLine: (id: string | null) => void;

  // Syllable/word sync (Enhanced LRC) editing mode
  syncMode: "line" | "char";
  syncUnit: SyncUnit;
  activeSyllableIndex: number;
  setSyncMode: (m: "line" | "char") => void;
  setSyncUnit: (u: SyncUnit) => void;
  setActiveSyllable: (i: number) => void;
  // Replace all line tokens. line.timestamp synchronizes with earliest token time.
  // recordHistory=false prevents recording history (to bundle drag painting into single undo).
  commitSyllables: (lineId: string, syllables: LrcSyllable[], recordHistory?: boolean) => void;
  // Remove syllable sync from line (reverts to standard line). line.timestamp preserved.
  clearLineSyllables: (lineId: string) => void;

  setMetadata: (meta: Partial<LrcMetadata>, silent?: boolean) => void;
  setLines: (lines: LrcLine[]) => void;
  addLine: (text?: string) => void;
  insertLinesAfter: (afterId: string, texts: string[]) => string;
  /** Silence-based auto-spotting: inserts empty text stamped lines chronologically for detected intervals.
   *  Existing unstamped lines are excluded from sorting criteria, preserving their positions.
   *  Return value: number of inserted lines */
  addLinesFromSpeechSegments: (segments: { start: number; end: number }[]) => number;
  updateLine: (id: string, patch: Partial<Omit<LrcLine, "id">>) => void;
  deleteLine: (id: string) => void;
  /** Duplicate line (text only, unstamped, inserted directly below). Returns new line ID */
  duplicateLine: (id: string) => string;
  /** Merge line with previous line (combines text, keeps previous timestamp). Returns merged line ID or null */
  mergeLineUp: (id: string) => string | null;
  /** Split line into two at cursor position. Returns new (second) line ID */
  splitLine: (id: string, caretPos: number) => string;
  /** Reorder lines (drag reordering) */
  moveLine: (fromIndex: number, toIndex: number) => void;
  /** Scale all timestamps (+ syllable sync) by factor — corrects tempo/version discrepancy */
  scaleTimestamps: (factor: number) => void;
  /** Batch delete multiple lines */
  deleteLines: (ids: string[]) => void;
  /** Shift timestamps (+ syllable sync) of multiple lines by delta seconds */
  shiftLines: (ids: string[], delta: number) => void;
  /** Strip timestamps and syllable sync from multiple lines (preserves text) */
  clearTimestamps: (ids: string[]) => void;
  stampCurrentLine: (id: string) => void;
  applyOffset: () => void;
  loadFromRawText: (raw: string) => void;
  /** Auto-recovery: restores snapshot document and path completely (in unsaved state) */
  restoreDoc: (doc: LrcDocument, lrcPath: string | null, audioPath: string | null) => void;

  setAudioPath: (path: string | null) => void;
  openAudio: () => Promise<void>;
  openLrc: () => Promise<void>;
  loadLyricsPath: (path: string) => Promise<void>;
  applyFetchedLyrics: (lrcText: string, meta?: { title: string; artist: string; album: string }) => void;
  // Return value: true if file was written, false if user cancelled save dialog
  saveLrc: () => Promise<boolean>;
  // enhanced: one-time override for current save (if unspecified, defaults to E-LRC when syllable data exists)
  saveLrcAs: (format: "lrc" | "srt" | "vtt" | "ass", enhanced?: boolean) => Promise<boolean>;
  newLrc: () => void;
  replaceInLines: (find: string, replace: string, caseSensitive: boolean) => number;
  shiftTimeRange: (fromIdx: number, toIdx: number, deltaSeconds: number) => void;

  // AI Auto Sync
  aiSyncStatus: AiSyncStatus;
  aiSyncMessage: string;
  /** Python progress status code (e.g. "loading_model", "analyzing", "error") */
  aiSyncProgressStatus: string;
  /** lineId → confidence (0–1). null = no AI draft active */
  aiDraftConfidence: Record<string, number> | null;
  runAiSync: (language: string, blankLineOffset: number, useSeparation: boolean, useVad: boolean) => Promise<void>;
  cancelAiSync: () => void;
  clearAiDraft: () => void;
}

let nextId = 1;
const genId = () => String(nextId++);

// Serialize to LRC or SRT based on the file extension of the save path
function serializeForPath(path: string, doc: LrcDocument, duration: number): string {
  const p = path.toLowerCase();
  const end = duration > 0 ? duration : undefined;
  if (p.endsWith(".srt")) return serializeSrt(doc, end);
  if (p.endsWith(".vtt")) return serializeVtt(doc, end);
  if (p.endsWith(".ass")) return serializeAss(doc, end);
  // Preserves syllable/word sync if present (auto E-LRC), otherwise outputs standard LRC
  return serializeLrc(doc, true);
}

const MAX_HISTORY = 50;

export const useLrcStore = create<LrcStore>((set, get) => ({
  doc: defaultDocument(),
  _history: [],
  _future: [],
  audioPath: null,
  lrcPath: null,
  currentTime: 0,
  isDirty: false,
  activeLineId: null,
  isPlaying: false,
  duration: 0,
  loopLineId: null,
  setLoopLine: (id) => set({ loopLineId: id }),

  aiSyncStatus: "idle",
  aiSyncMessage: "",
  aiSyncProgressStatus: "",
  aiDraftConfidence: null,

  syncMode: "line",
  syncUnit: "char",
  activeSyllableIndex: 0,

  setSyncMode: (m) => set({ syncMode: m }),
  setSyncUnit: (u) => set({ syncUnit: u }),
  setActiveSyllable: (i) => set({ activeSyllableIndex: i }),

  commitSyllables: (lineId, syllables, recordHistory = true) => {
    const { doc, _history } = get();
    const times = syllables.filter((s) => s.time !== null).map((s) => s.time as number);
    const lineTs = times.length > 0 ? Math.min(...times) : null;
    const lines = doc.lines.map((l) =>
      l.id === lineId
        ? { ...l, syllables, timestamp: lineTs !== null ? lineTs : l.timestamp }
        : l
    );
    set({
      ...(recordHistory
        ? { _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] }
        : {}),
      doc: { ...doc, lines },
      isDirty: true,
    });
  },

  clearLineSyllables: (lineId) => {
    const { doc, _history } = get();
    const lines = doc.lines.map((l) =>
      l.id === lineId ? { ...l, syllables: undefined } : l
    );
    set({
      _history: [..._history.slice(-(MAX_HISTORY - 1)), doc],
      _future: [],
      doc: { ...doc, lines },
      isDirty: true,
    });
  },

  undo: () => {
    const { doc, _history, _future } = get();
    if (_history.length === 0) return;
    const prev = _history[_history.length - 1];
    set({
      doc: prev,
      _history: _history.slice(0, -1),
      _future: [doc, ..._future].slice(0, MAX_HISTORY),
      isDirty: true,
    });
  },

  redo: () => {
    const { doc, _history, _future } = get();
    if (_future.length === 0) return;
    const next = _future[0];
    set({
      doc: next,
      _history: [..._history, doc].slice(-MAX_HISTORY),
      _future: _future.slice(1),
      isDirty: true,
    });
  },

  setIsPlaying: (v) => set({ isPlaying: v }),
  setDuration: (d) => set({ duration: d }),
  setCurrentTime: (t) => set({ currentTime: t }),

  setActiveLineId: (id) => set({ activeLineId: id }),

  stampAndAdvance: () => {
    const { activeLineId, currentTime, doc, aiDraftConfidence, _history } = get();
    const lines = doc.lines;
    if (lines.length === 0) return;

    // If no active line, select only (no document change -> do not record history)
    if (!activeLineId) {
      set({ activeLineId: lines[0].id });
      return;
    }

    const idx = lines.findIndex((l) => l.id === activeLineId);
    const stamped = lines.map((l) =>
      l.id === activeLineId ? { ...l, timestamp: currentTime } : l
    );
    const next = stamped[idx + 1];

    // Remove AI confidence for manually stamped line
    let newConfidence = aiDraftConfidence;
    if (newConfidence && activeLineId in newConfidence) {
      newConfidence = { ...newConfidence };
      delete newConfidence[activeLineId];
    }

    // Record history only when actually stamping
    set({
      _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [],
      doc: { ...doc, lines: stamped },
      activeLineId: next ? next.id : activeLineId,
      aiDraftConfidence: newConfidence,
      isDirty: true,
    });
  },

  goToPreviousLine: () => {
    const { activeLineId, doc } = get();
    const lines = doc.lines;
    if (lines.length === 0) return;
    if (!activeLineId) {
      set({ activeLineId: lines[0].id });
      return;
    }
    const idx = lines.findIndex((l) => l.id === activeLineId);
    if (idx > 0) set({ activeLineId: lines[idx - 1].id });
  },

  setMetadata: (meta, silent = false) =>
    set((s) => ({
      doc: { ...s.doc, metadata: { ...s.doc.metadata, ...meta } },
      // silent: automated sync (e.g. Spotify) rather than user edit does not mark dirty
      isDirty: silent ? s.isDirty : true,
    })),

  setLines: (lines) => {
    const { doc, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  addLine: (text = "") => {
    const { doc, _history } = get();
    set({
      _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [],
      doc: { ...doc, lines: [...doc.lines, { id: genId(), timestamp: null, text }] },
      isDirty: true,
    });
  },

  insertLinesAfter: (afterId, texts) => {
    const newLines = texts.map((t) => ({ id: genId(), timestamp: null as null, text: t }));
    const lastId = newLines[newLines.length - 1].id;
    const { doc, _history } = get();
    const idx = doc.lines.findIndex((l) => l.id === afterId);
    const lines = [...doc.lines];
    lines.splice(idx + 1, 0, ...newLines);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
    return lastId;
  },

  addLinesFromSpeechSegments: (segments) => {
    if (segments.length === 0) return 0;
    const { doc, _history } = get();
    let lines = doc.lines;
    for (const seg of segments) {
      const ts = Math.round(seg.start * 1000) / 1000;
      const newLine: LrcLine = { id: genId(), timestamp: ts, text: "" };
      // Only lines with existing timestamps are considered for sorting — unentered lines keep position
      const idx = lines.findIndex((l) => l.timestamp !== null && (l.timestamp as number) > ts);
      const insertAt = idx === -1 ? lines.length : idx;
      lines = [...lines.slice(0, insertAt), newLine, ...lines.slice(insertAt)];
    }
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
    return segments.length;
  },

  updateLine: (id, patch) =>
    set((s) => ({
      doc: {
        ...s.doc,
        lines: s.doc.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      },
      isDirty: true,
    })),

  deleteLine: (id) => {
    const { doc, _history, activeLineId, loopLineId } = get();
    const lines = doc.lines.filter((l) => l.id !== id);
    const newActiveLineId = activeLineId === id ? (lines[0]?.id ?? null) : activeLineId;
    set({
      _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines },
      activeLineId: newActiveLineId, loopLineId: loopLineId === id ? null : loopLineId, isDirty: true,
    });
  },

  duplicateLine: (id) => {
    const { doc, _history } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx < 0) return id;
    const newId = genId();
    // Duplicate text only — clear timestamps and syllable sync to avoid duplicate times
    const copy: LrcLine = { id: newId, timestamp: null, text: doc.lines[idx].text };
    const lines = [...doc.lines];
    lines.splice(idx + 1, 0, copy);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
    return newId;
  },

  mergeLineUp: (id) => {
    const { doc, _history } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx <= 0) return null;
    const prev = doc.lines[idx - 1];
    const cur = doc.lines[idx];
    const sep = prev.text && cur.text ? " " : "";
    // Keep previous line timestamp, merge text, invalidate syllable sync (text modified)
    const merged: LrcLine = { ...prev, text: prev.text + sep + cur.text, syllables: undefined };
    const lines = [...doc.lines];
    lines.splice(idx - 1, 2, merged);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, activeLineId: prev.id, isDirty: true });
    return prev.id;
  },

  splitLine: (id, caretPos) => {
    const { doc, _history } = get();
    const idx = doc.lines.findIndex((l) => l.id === id);
    if (idx < 0) return id;
    const cur = doc.lines[idx];
    const newId = genId();
    // First part: keep timestamp / Second part: new line (no timestamp). Both invalidate syllable sync
    const first: LrcLine = { ...cur, text: cur.text.slice(0, caretPos), syllables: undefined };
    const second: LrcLine = { id: newId, timestamp: null, text: cur.text.slice(caretPos) };
    const lines = [...doc.lines];
    lines.splice(idx, 1, first, second);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, activeLineId: newId, isDirty: true });
    return newId;
  },

  moveLine: (fromIndex, toIndex) => {
    const { doc, _history } = get();
    const n = doc.lines.length;
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= n || toIndex >= n) return;
    const lines = [...doc.lines];
    const [moved] = lines.splice(fromIndex, 1);
    lines.splice(toIndex, 0, moved);
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  scaleTimestamps: (factor) => {
    if (!(factor > 0) || factor === 1) return;
    const { doc, _history } = get();
    const sc = (t: number | null) => (t !== null ? Math.max(0, Math.round(t * factor * 1000) / 1000) : null);
    const lines = doc.lines.map((l) => ({
      ...l,
      timestamp: sc(l.timestamp),
      syllables: l.syllables?.map((s) => ({ ...s, time: sc(s.time) })),
    }));
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  deleteLines: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const { doc, _history, activeLineId, loopLineId } = get();
    const lines = doc.lines.filter((l) => !idSet.has(l.id));
    const newActiveLineId = activeLineId && idSet.has(activeLineId) ? (lines[0]?.id ?? null) : activeLineId;
    set({
      _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines },
      activeLineId: newActiveLineId, loopLineId: loopLineId && idSet.has(loopLineId) ? null : loopLineId, isDirty: true,
    });
  },

  shiftLines: (ids, delta) => {
    if (delta === 0 || ids.length === 0) return;
    const idSet = new Set(ids);
    const { doc, _history } = get();
    const sh = (t: number | null) => (t !== null ? Math.max(0, Math.round((t + delta) * 1000) / 1000) : null);
    const lines = doc.lines.map((l) =>
      idSet.has(l.id)
        ? { ...l, timestamp: sh(l.timestamp), syllables: l.syllables?.map((s) => ({ ...s, time: sh(s.time) })) }
        : l
    );
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  clearTimestamps: (ids) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const { doc, _history } = get();
    const lines = doc.lines.map((l) => (idSet.has(l.id) ? { ...l, timestamp: null, syllables: undefined } : l));
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines }, isDirty: true });
  },

  stampCurrentLine: (id) => {
    const { currentTime, doc, aiDraftConfidence, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
    let newConfidence = aiDraftConfidence;
    if (newConfidence && id in newConfidence) {
      newConfidence = { ...newConfidence };
      delete newConfidence[id];
    }
    set({
      doc: {
        ...doc,
        lines: doc.lines.map((l) =>
          l.id === id ? { ...l, timestamp: currentTime } : l
        ),
      },
      aiDraftConfidence: newConfidence,
      isDirty: true,
    });
  },

  loadFromRawText: (raw) => {
    const { doc, _history } = get();
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
    const parsed = parseLrc(raw);
    let id = nextId;
    parsed.lines = parsed.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    const firstId = parsed.lines[0]?.id ?? null;
    set({ doc: parsed, activeLineId: firstId, loopLineId: null, isDirty: true });
  },

  restoreDoc: (doc, lrcPath, audioPath) => {
    // Assign new line IDs to avoid collision with nextId counter
    let id = 1;
    const lines = doc.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    set({
      doc: { ...doc, lines },
      lrcPath,
      audioPath,
      activeLineId: lines[0]?.id ?? null,
      loopLineId: null,
      isDirty: true, // Recovered work is not yet saved
      _history: [],
      _future: [],
    });
  },

  applyOffset: () => {
    const { doc, _history } = get();
    const deltaSeconds = doc.metadata.offset / 1000;
    if (deltaSeconds === 0) return; // No change -> do not record history (prevents empty undo)
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [] });
    set({
      doc: {
        ...doc,
        metadata: { ...doc.metadata, offset: 0 },
        lines: doc.lines.map((l) => ({
          ...l,
          timestamp: l.timestamp !== null
            ? Math.max(0, l.timestamp + deltaSeconds)
            : null,
          // Shift syllable sync token timestamps as well
          syllables: l.syllables?.map((s) => ({
            ...s,
            time: s.time !== null ? Math.max(0, s.time + deltaSeconds) : null,
          })),
        })),
      },
      isDirty: true,
    });
  },

  setAudioPath: (path) => {
    set({ audioPath: path });
    if (path) useSettingsStore.getState().addRecentFile({ audioPath: path, lrcPath: get().lrcPath });
  },

  openAudio: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Audio", extensions: ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "aiff", "aif"] }],
    });
    if (typeof selected === "string") get().setAudioPath(selected);
  },

  // Load lyrics by path (branch LRC/SRT by extension). Shared by dialog and drag & drop.
  loadLyricsPath: async (path) => {
    const content: string = await invoke("read_lrc_file", { path });
    const isSrt = path.split(".").pop()?.toLowerCase() === "srt";
    const doc = isSrt ? parseSrt(content) : parseLrc(content);
    let id = 1;
    doc.lines = doc.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    const firstId = doc.lines[0]?.id ?? null;
    set({ doc, lrcPath: path, isDirty: false, activeLineId: firstId, loopLineId: null, _history: [], _future: [] });
    useSettingsStore.getState().addRecentFile({ lrcPath: path, audioPath: get().audioPath });
  },

  // Apply lyrics fetched externally (e.g. LRCLIB). Replace lines while preserving metadata:
  // Keep existing title/artist/album, only filling in empty fields.
  // (preserves by/offset). Unrelated to local file -> clear lrcPath.
  applyFetchedLyrics: (lrcText, meta) => {
    const parsed = parseLrc(lrcText);
    let id = 1;
    parsed.lines = parsed.lines.map((l) => ({ ...l, id: String(id++) }));
    nextId = id;
    const current = get().doc.metadata;
    const metadata = meta
      ? {
          ...current,
          title: current.title.trim() || meta.title,
          artist: current.artist.trim() || meta.artist,
          album: current.album.trim() || meta.album,
        }
      : current;
    const firstId = parsed.lines[0]?.id ?? null;
    set({
      doc: { ...parsed, metadata },
      lrcPath: null,
      isDirty: true,
      activeLineId: firstId,
      loopLineId: null,
      _history: [],
      _future: [],
    });
  },

  // Open lyrics: supports both LRC and SRT.
  openLrc: async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Lyrics", extensions: ["lrc", "srt"] }],
    });
    if (typeof selected === "string") await get().loadLyricsPath(selected);
  },

  saveLrc: async () => {
    const { lrcPath, doc, duration } = get();
    if (!lrcPath) return get().saveLrcAs("lrc");
    await invoke("write_lrc_file", { path: lrcPath, content: serializeForPath(lrcPath, doc, duration) });
    set({ isDirty: false });
    return true;
  },

  saveLrcAs: async (format, enhanced) => {
    const { doc, duration } = get();
    const FILTERS: Record<string, { name: string; extensions: string[] }> = {
      lrc: { name: "LRC", extensions: ["lrc"] },
      srt: { name: "SubRip", extensions: ["srt"] },
      vtt: { name: "WebVTT", extensions: ["vtt"] },
      ass: { name: "Advanced SubStation Alpha", extensions: ["ass"] },
    };
    const path = await save({
      filters: [FILTERS[format]],
      defaultPath: doc.metadata.title || "untitled",
    });
    if (path) {
      const end = duration > 0 ? duration : undefined;
      const content =
        format === "srt" ? serializeSrt(doc, end)
        : format === "vtt" ? serializeVtt(doc, end)
        : format === "ass" ? serializeAss(doc, end)
        : serializeLrc(doc, enhanced ?? true);
      await invoke("write_lrc_file", { path, content });
      // Saving secondary format does not alter working file path (lrcPath) or dirty state
      if (format === "lrc" || format === "srt") set({ lrcPath: path, isDirty: false });
      return true;
    }
    return false; // User cancelled save dialog
  },

  newLrc: () =>
    set({ doc: defaultDocument(), lrcPath: null, isDirty: false, activeLineId: null, loopLineId: null, _history: [], _future: [] }),

  shiftTimeRange: (fromIdx, toIdx, deltaSeconds) => {
    if (deltaSeconds === 0) return;
    const { doc, _history } = get();
    const newLines = doc.lines.map((l, i) => {
      if (i < fromIdx || i > toIdx || l.timestamp === null) return l;
      return {
        ...l,
        timestamp: Math.max(0, l.timestamp + deltaSeconds),
        syllables: l.syllables?.map((s) => ({
          ...s,
          time: s.time !== null ? Math.max(0, s.time + deltaSeconds) : null,
        })),
      };
    });
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines: newLines }, isDirty: true });
  },

  replaceInLines: (find, replace, caseSensitive) => {
    if (!find) return 0;
    const { doc, _history } = get();
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, caseSensitive ? "g" : "gi");
    let count = 0;
    const newLines = doc.lines.map((l) => {
      const matches = l.text.match(re);
      if (!matches) return l;
      count += matches.length;
      // Invalidate syllable sync when text changes as old token boundaries become invalid
      return { ...l, text: l.text.replace(re, replace), syllables: undefined };
    });
    if (count === 0) return 0;
    set({ _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [], doc: { ...doc, lines: newLines }, isDirty: true });
    return count;
  },

  runAiSync: async (language, blankLineOffset, useSeparation, useVad) => {
    const { audioPath, doc } = get();
    if (!audioPath) return;

    set({ aiSyncStatus: "running", aiSyncMessage: "" });

    const unlisten = await listen<AlignmentProgressEvent>("alignment-progress", (e) => {
      set({ aiSyncProgressStatus: e.payload.status, aiSyncMessage: e.payload.message });
    });

    try {
      // Only pass non-empty lines to Python; track their original indices
      const nonBlank = doc.lines
        .map((line, idx) => ({ line, idx }))
        .filter(({ line }) => line.text.trim() !== "");

      const linesInput = nonBlank.map(({ line, idx }) => ({
        index: idx,
        text: line.text,
      }));

      const resultJson = await invoke<string>("run_alignment", {
        audioPath,
        linesJson: JSON.stringify(linesInput),
        language,
        useSeparation,
        useVad,
      });

      // align.py returns { lines, vocal_segments, separated } object (array in legacy versions).
      const parsed = JSON.parse(resultJson);
      const results: AlignmentResult[] = Array.isArray(parsed) ? parsed : parsed.lines;
      const vocalSegments: [number, number][] = Array.isArray(parsed) ? [] : (parsed.vocal_segments ?? []);
      const separated: boolean = Array.isArray(parsed) ? false : !!parsed.separated;
      const byIndex = new Map(results.map((r) => [r.index, r]));

      // Point where vocals resume after interlude (separated stem VAD). Start of first vocal segment after prevEnd.
      const vocalResumeAfter = (t: number): number | null => {
        if (!separated || vocalSegments.length === 0) return null;
        for (const [s] of vocalSegments) {
          if (s > t + 0.1) return s; // Only resume after actual silence (excludes tail of previous line)
        }
        return null;
      };

      // Overlap ratio (0-1) between aligned line [start, end] and vocal activity segments.
      // 1 without VAD (no penalty). Low overlap suggests likely misaligned during non-vocal sections.
      const vocalOverlapRatio = (start: number, end: number): number => {
        if (!separated || vocalSegments.length === 0) return 1;
        const dur = Math.max(end - start, 0.05);
        let ov = 0;
        for (const [s, e] of vocalSegments) {
          if (s > end) break; // Sorted, so early termination possible
          ov += Math.max(0, Math.min(end, e) - Math.max(start, s));
        }
        return Math.max(0, Math.min(1, ov / dur));
      };

      const confidence: Record<string, number> = {};
      const newLines = doc.lines.map((line, idx) => {
        const r = byIndex.get(idx);
        if (r) {
          // VAD correction: lower confidence for lines with low vocal overlap (suspected non-vocal misalignment).
          // Keep timestamp and downgrade badge color to indicate "review needed" (auto-shift omitted due to accuracy risk).
          const ratio = vocalOverlapRatio(r.start, r.end);
          const adjusted = r.confidence * (0.4 + 0.6 * ratio);
          confidence[line.id] = Math.round(adjusted * 1000) / 1000;
          // Invalidate existing syllable sync as AI realigns at line level
          return { ...line, timestamp: r.start, syllables: undefined };
        }
        return line;
      });

      // Timestamp placement for empty lines (paragraph breaks):
      //  - If separated stem VAD is available, precisely place at vocal resumption point after interlude
      //  - Otherwise (or if unsuitable), use previous line end + offset heuristic
      //  Always clamp to not exceed start of next non-empty line.
      for (let i = 0; i < newLines.length; i++) {
        if (doc.lines[i].text.trim() !== "") continue;
        let prevEnd = 0;
        let nextStart: number | null = null;
        for (let j = i - 1; j >= 0; j--) {
          const r = byIndex.get(j);
          if (r) { prevEnd = r.end; break; }
        }
        for (let j = i + 1; j < newLines.length; j++) {
          const r = byIndex.get(j);
          if (r) { nextStart = r.start; break; }
        }
        const resume = vocalResumeAfter(prevEnd);
        const useResume = resume !== null && (nextStart === null || resume < nextStart);
        const desired = useResume ? (resume as number) : prevEnd + blankLineOffset;
        const ts = nextStart !== null ? Math.min(desired, nextStart) : desired;
        newLines[i] = { ...newLines[i], timestamp: Math.round(ts * 1000) / 1000 };
        confidence[doc.lines[i].id] = 1.0;
      }

      const { _history } = get();
      set({
        _history: [..._history.slice(-(MAX_HISTORY - 1)), doc], _future: [],
        doc: { ...doc, lines: newLines },
        aiSyncStatus: "done",
        aiSyncProgressStatus: "done",
        aiDraftConfidence: confidence,
        isDirty: true,
      });
      toast.success(useI18nStore.getState().t.toast.aiSyncDone);
    } catch (err) {
      const msg = String(err);
      if (msg === "cancelled") {
        set({ aiSyncStatus: "idle", aiSyncMessage: "", aiSyncProgressStatus: "" });
      } else {
        set({ aiSyncStatus: "error", aiSyncProgressStatus: "error", aiSyncMessage: msg });
        toast.error(useI18nStore.getState().t.toast.aiSyncFailed);
      }
    } finally {
      unlisten();
    }
  },

  cancelAiSync: () => {
    invoke("cancel_alignment").catch(() => {});
  },

  clearAiDraft: () => set({ aiDraftConfidence: null }),
}));
