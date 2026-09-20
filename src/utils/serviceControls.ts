import { useServiceStore } from "../stores/useServiceStore";

async function spotifySeekTo(seconds: number): Promise<void> {
  const posMs = Math.max(0, Math.round(seconds * 1000));
  // Update local state immediately for responsive UI
  useServiceStore.setState({
    positionMs: posMs,
    _lastKnownPositionMs: posMs,
    _lastStateTimestamp: Date.now(),
  });
  const token = await useServiceStore.getState().ensureToken();
  await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${posMs}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function spotifyTogglePlay(): Promise<void> {
  const store = useServiceStore.getState();
  const willPlay = !store.isPlaying;
  // Optimistic update: re-anchor from current position and immediately apply isPlaying/interpolation
  // to avoid display skew during API latency.
  useServiceStore.setState({
    isPlaying: willPlay,
    _lastKnownPositionMs: store.positionMs,
    _lastStateTimestamp: Date.now(),
  });
  if (willPlay) store._startInterpolation();
  else store._stopInterpolation();

  const token = await store.ensureToken();
  await fetch(`https://api.spotify.com/v1/me/player/${willPlay ? "play" : "pause"}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function spotifyStop(): Promise<void> {
  // Stop = pause + rewind to beginning. Stop interpolation and set isPlaying to false immediately.
  const store = useServiceStore.getState();
  store._stopInterpolation();
  useServiceStore.setState({ isPlaying: false });
  const token = await store.ensureToken();
  await fetch("https://api.spotify.com/v1/me/player/pause", {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
  await spotifySeekTo(0);
}

export const serviceControls = {
  togglePlay: () => { spotifyTogglePlay().catch(() => {}); },
  skip: (delta: number) => {
    const { positionMs } = useServiceStore.getState();
    spotifySeekTo((positionMs + delta * 1000) / 1000).catch(() => {});
  },
  seekTo: (seconds: number) => { spotifySeekTo(seconds).catch(() => {}); },
  stopAndReset: () => { spotifyStop().catch(() => {}); },
};
