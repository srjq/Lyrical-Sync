// Returns true if any fullscreen backdrop modal is open.
// Excludes drag overlays (pointer-events-none) as they are not interactive modals.
// Used to prevent global shortcuts (Space stamp, Backspace, syllable mode keys)
// from executing unintended actions behind modals.
export function anyModalOpen(): boolean {
  return document.querySelector(".fixed.inset-0:not(.pointer-events-none)") !== null;
}
