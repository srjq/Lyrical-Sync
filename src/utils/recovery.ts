import type { LrcDocument } from "../types/lrc";

// Auto-recovery for unsaved work: periodically snapshots working document to localStorage
// and prompts recovery if state persists upon restart. Protects documents even without save path (lrcPath).
const KEY = "lyrical-sync-recovery";

export interface RecoverySnapshot {
  doc: LrcDocument;
  lrcPath: string | null;
  audioPath: string | null;
  savedAt: number;
}

export function saveRecoverySnapshot(doc: LrcDocument, lrcPath: string | null, audioPath: string | null): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ doc, lrcPath, audioPath, savedAt: Date.now() }));
  } catch {
    // Storage quota exceeded, etc. — recovery is best-effort
  }
}

export function loadRecoverySnapshot(): RecoverySnapshot | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.doc && Array.isArray(s.doc.lines)) return s as RecoverySnapshot;
    return null;
  } catch {
    return null;
  }
}

export function clearRecoverySnapshot(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
