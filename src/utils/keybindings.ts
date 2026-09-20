// User-configurable global shortcuts. Cmd/Ctrl combos (undo/find), Escape, etc.
// are reserved for the system; only single keys (without modifiers) are bindable.

export type KeyAction =
  | "skipBack5" | "skipBack1" | "playPause" | "skipFwd1" | "skipFwd5" | "stop"
  | "stamp" | "prevLine";

export const KEY_ACTIONS: KeyAction[] = [
  "skipBack5", "skipBack1", "playPause", "skipFwd1", "skipFwd5", "stop", "stamp", "prevLine",
];

// Playback transport actions (shared across line/syllable modes, active outside input elements)
export const PLAYBACK_ACTIONS: KeyAction[] = [
  "skipBack5", "skipBack1", "playPause", "skipFwd1", "skipFwd5", "stop",
];

export const DEFAULT_KEYBINDINGS: Record<KeyAction, string> = {
  skipBack5: "Digit1",
  skipBack1: "Digit2",
  playPause: "Digit3",
  skipFwd1: "Digit4",
  skipFwd5: "Digit5",
  stop: "Digit6",
  stamp: "Space",
  prevLine: "Backspace",
};

// Non-bindable (system reserved) keys
export const RESERVED_CODES = new Set(["Escape", "Tab"]);

// Treat numpad digits same as standard digits (preserves existing behavior)
function normalizeCode(code: string): string {
  const m = /^Numpad(\d)$/.exec(code);
  return m ? `Digit${m[1]}` : code;
}

// Normalize stored bindings against defaults (prevents missing keys)
export function normalizeKeybindings(kb?: Partial<Record<KeyAction, string>>): Record<KeyAction, string> {
  const out = { ...DEFAULT_KEYBINDINGS };
  if (kb) for (const a of KEY_ACTIONS) if (kb[a]) out[a] = kb[a] as string;
  return out;
}

// Identify which action corresponds to key code (null if none). Applies numpad normalization.
export function matchAction(code: string, kb: Record<KeyAction, string>): KeyAction | null {
  const c = normalizeCode(code);
  for (const a of KEY_ACTIONS) {
    if (normalizeCode(kb[a]) === c) return a;
  }
  return null;
}

// Returns conflicting action if key code is already in use by another action (excludes self).
export function conflictingAction(
  code: string,
  action: KeyAction,
  kb: Record<KeyAction, string>,
): KeyAction | null {
  const c = normalizeCode(code);
  for (const a of KEY_ACTIONS) {
    if (a !== action && normalizeCode(kb[a]) === c) return a;
  }
  return null;
}

// Display label
export function keyLabel(code: string): string {
  if (code === "Space") return "Space";
  if (code === "Backspace") return "⌫";
  if (code === "Enter") return "Enter";
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return `№${numpad[1]}`;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const fkey = /^(F\d{1,2})$/.exec(code);
  if (fkey) return fkey[1];
  const arrows: Record<string, string> = {
    ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  };
  if (arrows[code]) return arrows[code];
  const sym: Record<string, string> = {
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Backquote: "`",
  };
  if (sym[code]) return sym[code];
  return code;
}
