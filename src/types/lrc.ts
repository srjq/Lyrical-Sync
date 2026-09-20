export interface LrcMetadata {
  title: string;
  artist: string;
  album: string;
  by: string;
  offset: number;
}

// Enhanced LRC (A2) word/syllable token. Concatenating all text forms full line text.
// time=null = not stamped yet. Whitespace tokens are excluded from stamping.
export interface LrcSyllable {
  text: string;
  time: number | null; // seconds
}

export interface LrcLine {
  id: string;
  timestamp: number | null; // seconds
  text: string;
  // If present, Enhanced LRC (syllable/word synced) line. Otherwise, standard line-by-line.
  syllables?: LrcSyllable[];
}

export interface LrcDocument {
  metadata: LrcMetadata;
  lines: LrcLine[];
  extraTags: Record<string, string>;
}

export const defaultMetadata = (): LrcMetadata => ({
  title: "",
  artist: "",
  album: "",
  by: "",
  offset: 0,
});

export const defaultDocument = (): LrcDocument => ({
  metadata: defaultMetadata(),
  lines: [],
  extraTags: {},
});
