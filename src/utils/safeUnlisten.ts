// In Tauri v2, unlisten() internally calls invoke and returns a Promise.
// If rejected during HMR or unmount, unhandled promise rejection occurs; safely catch it.
// (Type signature is () => void, but runtime may return a Promise)
export function safeUnlisten(fn?: (() => void) | null): void {
  try {
    const r = fn?.() as unknown;
    if (r && typeof (r as { catch?: unknown }).catch === "function") {
      (r as Promise<unknown>).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
