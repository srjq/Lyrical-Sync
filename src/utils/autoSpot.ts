// Silence-based auto-spotting: places empty timestamp lines wherever speech appears to occur,
// starting from "someone begins speaking here" rather than a completely blank grid.
//
// Simply compares short-term RMS energy against a threshold without heavy VAD models.
// No machine learning model, no speech/music/noise classification. Intentionally an "80% tool":
// captures "is there sound here?" cheaply and predictably, while actual lyrics are reviewed and filled by human.
// False positives on noisy room tones or musical stings can be cleared in two clicks, and whispered
// dialogue requires threshold tuning even with sophisticated models.

export interface SpeechSegment {
  start: number;
  end: number;
}

/**
 * Finds intervals in `samples` (mono, [-1, 1], `sampleRate`) where local energy exceeds
 * `thresholdDb` for at least `minSpeechSec`. Silence gaps shorter than `minSilenceSec` are treated as
 * the same interval (breaths or brief mid-sentence pauses) and merged. Each interval is padded at both ends
 * by `paddingSec` (lead-in/lead-out beat) without encroaching on adjacent intervals.
 */
export function detectSpeechSegments(
  samples: Float32Array | number[],
  sampleRate: number,
  thresholdDb = -35,
  minSilenceSec = 0.3,
  minSpeechSec = 0.3,
  paddingSec = 0.1
): SpeechSegment[] {
  if (!(sampleRate > 0) || samples.length === 0) return [];

  const windowSec = 0.02; // 20ms analysis window — short enough not to miss word onsets
  const windowSize = Math.max(1, Math.round(windowSec * sampleRate));
  const windowCount = Math.ceil(samples.length / windowSize);

  const active: boolean[] = new Array(windowCount).fill(false);
  for (let w = 0; w < windowCount; w++) {
    const lo = w * windowSize;
    const hi = Math.min(samples.length, lo + windowSize);
    if (hi <= lo) continue;
    let sumSquares = 0;
    for (let i = lo; i < hi; i++) sumSquares += samples[i] * samples[i];
    const rms = Math.sqrt(sumSquares / (hi - lo));
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    active[w] = db >= thresholdDb;
  }

  // Raw active intervals (window units)
  const runs: { start: number; end: number }[] = [];
  let runStart: number | null = null;
  for (let w = 0; w < windowCount; w++) {
    if (active[w]) {
      if (runStart === null) runStart = w;
    } else if (runStart !== null) {
      runs.push({ start: runStart, end: w });
      runStart = null;
    }
  }
  if (runStart !== null) runs.push({ start: runStart, end: windowCount });
  if (runs.length === 0) return [];

  // Merge intervals separated by silence shorter than minSilenceSec
  const minSilenceWindows = Math.round(minSilenceSec / windowSec);
  const merged: { start: number; end: number }[] = [{ ...runs[0] }];
  for (let i = 1; i < runs.length; i++) {
    const run = runs[i];
    const last = merged[merged.length - 1];
    if (run.start - last.end <= minSilenceWindows) {
      last.end = run.end;
    } else {
      merged.push({ ...run });
    }
  }

  // Remove intervals too short to be speech, convert to seconds, and apply padding
  const inSeconds = merged
    .map((r) => ({ start: r.start * windowSec, end: r.end * windowSec }))
    .filter((s) => s.end - s.start >= minSpeechSec);
  const duration = samples.length / sampleRate;

  // End padding of one interval and start padding of the next compete for the same gap.
  // Splitting the gap in half rather than independently clamping each side to the outer boundary
  // guarantees neither padding encroaches on the other even if requested padding exceeds total gap.
  return inSeconds.map((seg, i) => {
    const prevEnd = i > 0 ? inSeconds[i - 1].end : 0;
    const nextStart = i + 1 < inSeconds.length ? inSeconds[i + 1].start : duration;
    const backHalf = Math.max(0, (seg.start - prevEnd) / 2);
    const fwdHalf = Math.max(0, (nextStart - seg.end) / 2);
    const start = Math.max(0, seg.start - Math.min(paddingSec, backHalf));
    const end = Math.min(duration, seg.end + Math.min(paddingSec, fwdHalf));
    return { start, end };
  });
}
