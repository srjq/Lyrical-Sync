import { LrcDocument, LrcLine } from "../types/lrc";

// Convert stamped lines to subtitle cues. Empty lines (text:"") only serve as end boundary for preceding cue.
// (Same rule as srtConverter — start=line time, end=next timestamp line/total length/+4s)
interface Cue { start: number; end: number; line: LrcLine; }

function buildCues(doc: LrcDocument, lastCueEnd?: number): Cue[] {
  const timed = doc.lines
    .filter((l) => l.timestamp !== null)
    .slice()
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number));

  const cues: Cue[] = [];
  for (let i = 0; i < timed.length; i++) {
    const line = timed[i];
    if (line.text.trim() === "") continue; // Empty line = boundary only
    const start = line.timestamp as number;
    const next = timed[i + 1];
    let end: number;
    if (next) end = next.timestamp as number;
    else if (lastCueEnd !== undefined && lastCueEnd > start) end = lastCueEnd;
    else end = start + 4;
    cues.push({ start, end, line });
  }
  return cues;
}

const p2 = (n: number) => String(n).padStart(2, "0");
const p3 = (n: number) => String(n).padStart(3, "0");

// WebVTT time format: HH:MM:SS.mmm
function vttTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${p2(Math.floor(ms / 1000) % 60)}.${p3(ms % 1000)}`;
}

// If syllable/word sync is present, represent karaoke via VTT inline timestamps (<HH:MM:SS.mmm>)
function vttText(line: LrcLine): string {
  if (line.syllables?.some((s) => s.time !== null)) {
    return line.syllables
      .map((s) => (s.time !== null ? `<${vttTime(s.time)}>` : "") + s.text)
      .join("");
  }
  return line.text;
}

export function serializeVtt(doc: LrcDocument, lastCueEnd?: number): string {
  const cues = buildCues(doc, lastCueEnd);
  const body = cues
    .map((c) => `${vttTime(c.start)} --> ${vttTime(c.end)}\n${vttText(c.line)}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

// ASS time format: H:MM:SS.cc (centiseconds)
function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${p2(Math.floor(cs / 6000) % 60)}:${p2(Math.floor(cs / 100) % 60)}.${p2(cs % 100)}`;
}

// ASS text: if syllable sync is present, emit with \k (centisecond duration) karaoke tags
function assText(line: LrcLine, cueEnd: number): string {
  const syl = line.syllables;
  if (syl?.some((s) => s.time !== null)) {
    let out = "";
    for (let i = 0; i < syl.length; i++) {
      const s = syl[i];
      if (s.time === null) { out += s.text; continue; }
      let nextT = cueEnd;
      for (let j = i + 1; j < syl.length; j++) {
        if (syl[j].time !== null) { nextT = syl[j].time as number; break; }
      }
      const durCs = Math.max(0, Math.round((nextT - (s.time as number)) * 100));
      out += `{\\k${durCs}}${s.text}`;
    }
    return out;
  }
  return line.text;
}

export function serializeAss(doc: LrcDocument, lastCueEnd?: number): string {
  const cues = buildCues(doc, lastCueEnd);
  const title = doc.metadata.title || "Lyrical Sync";
  const header =
`[Script Info]
Title: ${title}
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H00E8A33D,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,2,2,80,80,70,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = cues
    .map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.line, c.end)}`)
    .join("\n");
  return header + events + "\n";
}
