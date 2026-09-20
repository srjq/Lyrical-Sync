import { readFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

// AIFF transcoding is Windows WebView2-specific (unsupported format) — macOS supports AIFF natively.
// Also, macOS temp directory (/var/folders/...) is outside $HOME so readFile fails, making transcoding unnecessary.
async function resolveReadablePath(audioPath: string): Promise<{ path: string; transcoded: boolean }> {
  const ext = audioPath.split(".").pop()?.toLowerCase() ?? "";
  const isAiff = ext === "aiff" || ext === "aif";
  const isWindows = navigator.platform.startsWith("Win");
  if (isAiff && isWindows) {
    return { path: await invoke<string>("decode_audio_to_wav", { path: audioPath }), transcoded: true };
  }
  return { path: audioPath, transcoded: false };
}

// Read audio file as bytes. Files within fs scope (media directories) use plugin readFile
// (fast binary IPC channel); out-of-scope files (temp folders, external drives) fallback to custom Rust command.
export async function readAudioBytes(audioPath: string): Promise<{ bytes: Uint8Array; transcoded: boolean }> {
  const { path, transcoded } = await resolveReadablePath(audioPath);
  try {
    return { bytes: await readFile(path), transcoded };
  } catch {
    const buf = await invoke<ArrayBuffer>("read_audio_file", { path });
    return { bytes: new Uint8Array(buf), transcoded };
  }
}
