import { readAudioBytes } from "./readAudioBytes";

// Extract raw PCM samples for auto-spotting (RMS energy analysis). Wavesurfer exportPeaks()
// is downsampled to min/max per pixel, lacking precision for 20ms window RMS calculation.
export async function decodeAudioSamples(audioPath: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  const { bytes } = await readAudioBytes(audioPath);
  const ctx = new AudioContext();
  try {
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channels = audioBuffer.numberOfChannels;
    const { length, sampleRate } = audioBuffer;
    // Convert to mono via channel average
    const samples = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) samples[i] += data[i] / channels;
    }
    return { samples, sampleRate };
  } finally {
    ctx.close();
  }
}
