import { LrcDocument, defaultDocument } from "../types/lrc";

// SubRip time format: HH:MM:SS,mmm
function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const s = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const m = totalMins % 60;
  const h = Math.floor(totalMins / 60);
  return (
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:` +
    `${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`
  );
}

// Accepts HH:MM:SS,mmm or H:MM:SS.mmm (both comma and period)
const SRT_TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;

function parseSrtTime(str: string): number | null {
  const m = SRT_TIME_RE.exec(str.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const frac = parseInt(m[4].padEnd(3, "0").slice(0, 3), 10) / 1000;
  return h * 3600 + min * 60 + s + frac;
}

/**
 * Serialize LRC document to SubRip (SRT) string.
 * End time of each subtitle = start time of next (stamped) line.
 * Empty lines (text:"") are not emitted as subtitles, serving only as end boundary for preceding cue.
 * Final line has no subsequent line, so ends at lastCueEnd (if present) or start + 4s.
 */
export function serializeSrt(doc: LrcDocument, lastCueEnd?: number): string {
  const timed = doc.lines
    .filter((l) => l.timestamp !== null)
    .slice()
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const cues: { start: number; end: number; text: string }[] = [];
  for (let i = 0; i < timed.length; i++) {
    const line = timed[i];
    if (line.text.trim() === "") continue; // Empty line = boundary only
    const start = line.timestamp as number;
    const next = timed[i + 1];
    let end: number;
    if (next) {
      end = next.timestamp as number;
    } else if (lastCueEnd !== undefined && lastCueEnd > start) {
      end = lastCueEnd;
    } else {
      end = start + 4;
    }
    cues.push({ start, end, text: line.text });
  }

  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${c.text}`
      )
      .join("\n\n") + "\n"
  );
}

/**
 * Parse SubRip (SRT) string into LRC document.
 * Converts each subtitle cue start time into an LRC timestamp.
 * Multi-line cue bodies are joined with spaces into a single line.
 *
 * Gaps between lyrics: if there is silence between cue end and next cue start,
 * an empty timestamp line (LRC paragraph break) is inserted at that end time
 * to represent empty intervals in editor. serializeSrt uses this empty line
 * as the end boundary of the previous cue, preserving SRT->LRC->SRT roundtrips.
 */
export function parseSrt(raw: string): LrcDocument {
  const doc = defaultDocument();
  let lineId = 0;

  // Normalize CRLF and split into blocks by blank lines
  const blocks = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\s*\n/);

  // 1) Collect cues (start, end, text)
  const cues: { start: number; end: number; text: string }[] = [];
  for (const block of blocks) {
    const rows = block.split("\n").map((r) => r.trim()).filter((r) => r !== "");
    if (rows.length === 0) continue;

    // Find time line (containing -->). Preceding line is index number (if any), following is text body.
    const arrowIdx = rows.findIndex((r) => r.includes("-->"));
    if (arrowIdx === -1) continue;

    const [startStr, endStr] = rows[arrowIdx].split("-->");
    const start = parseSrtTime(startStr);
    if (start === null) continue;
    const end = parseSrtTime(endStr ?? "");

    const text = rows.slice(arrowIdx + 1).join(" ").trim();
    cues.push({ start, end: end ?? start, text });
  }

  cues.sort((a, b) => a.start - b.start);

  // 2) cues -> lyric lines + insert empty boundary lines in gaps
  const cs = (s: number) => Math.round(s * 100); // Comparison in centiseconds (LRC precision)
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    doc.lines.push({ id: String(lineId++), timestamp: cue.start, text: cue.text });

    // Insert blank line if next cue exists and end time is after current start and before next start (gap present)
    const next = cues[i + 1];
    if (next && cs(cue.end) > cs(cue.start) && cs(cue.end) < cs(next.start)) {
      doc.lines.push({ id: String(lineId++), timestamp: cue.end, text: "" });
    }
  }

  doc.lines.sort((a, b) => {
    if (a.timestamp === null && b.timestamp === null) return 0;
    if (a.timestamp === null) return 1;
    if (b.timestamp === null) return -1;
    return a.timestamp - b.timestamp;
  });

  return doc;
}
