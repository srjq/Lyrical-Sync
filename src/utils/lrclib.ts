// LRCLIB (lrclib.net) lyrics search — free, no auth, CORS supported, called directly from frontend fetch.

const BASE = "https://lrclib.net/api";

export interface LrcLibResult {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export interface LrcLibQuery {
  title?: string;
  artist?: string;
  album?: string;
}

// Search: field search if track_name exists, fallback to composite q otherwise.
export async function lrclibSearch(q: LrcLibQuery): Promise<LrcLibResult[]> {
  const title = q.title?.trim() ?? "";
  const artist = q.artist?.trim() ?? "";
  const album = q.album?.trim() ?? "";

  const params = new URLSearchParams();
  if (title) {
    params.set("track_name", title);
    if (artist) params.set("artist_name", artist);
    if (album) params.set("album_name", album);
  } else {
    const query = [artist, album].filter(Boolean).join(" ").trim();
    if (!query) return [];
    params.set("q", query);
  }

  // 10s timeout to prevent modal from infinite loading during network delay
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${BASE}/search?${params.toString()}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? (data as LrcLibResult[]) : [];
  } finally {
    clearTimeout(timer);
  }
}

// 0-1 similarity score after string normalization
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}
function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.7;
  const sa = new Set(na.split(" "));
  const sb = new Set(nb.split(" "));
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const uni = new Set([...sa, ...sb]).size;
  return uni ? (inter / uni) * 0.6 : 0;
}

// Accuracy score against current track with priority Title > Artist > Album.
// Only user-entered fields affect score (empty fields do not impact sorting).
export function scoreResult(r: LrcLibResult, q: LrcLibQuery): number {
  let s = 0;
  if (q.title?.trim()) s += 100 * similarity(r.trackName, q.title);
  if (q.artist?.trim()) s += 10 * similarity(r.artistName, q.artist);
  if (q.album?.trim()) s += 1 * similarity(r.albumName, q.album);
  return s;
}

export function sortByAccuracy(results: LrcLibResult[], q: LrcLibQuery): LrcLibResult[] {
  return results
    .map((r) => ({ r, s: scoreResult(r, q) }))
    .sort((a, b) => {
      if (b.s !== a.s) return b.s - a.s;
      // Prefer synced lyrics when accuracy scores match
      return (b.r.syncedLyrics ? 1 : 0) - (a.r.syncedLyrics ? 1 : 0);
    })
    .map((x) => x.r);
}
