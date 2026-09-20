// Registered when AudioPlayer mounts and invoked from global key handlers
export const audioControls = {
  togglePlay: () => {},
  pause: () => {},
  skip: (_delta: number) => {},
  stopAndReset: () => {},
  seekTo: (_seconds: number) => {},
  // Normalized waveform peaks for entire track (null if none). For syllable sync lane waveform.
  getPeaks: (): number[] | null => null,
};
