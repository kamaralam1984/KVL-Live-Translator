/**
 * Combines microphone + system-audio MediaStreams into one mixed output via
 * the Web Audio graph, for consumers that want a single "both" stream —
 * while the caller is still free to also tap each source independently
 * (AudioCaptureManager does exactly that), per spec §8: separate streams
 * stay available internally even when a mixed output is also generated.
 */
export class AudioMixer {
  private readonly audioContext: AudioContext;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private sourceNodes: MediaStreamAudioSourceNode[] = [];

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  mix(streams: MediaStream[]): MediaStream {
    this.teardown();
    this.destination = this.audioContext.createMediaStreamDestination();

    for (const stream of streams) {
      const source = this.audioContext.createMediaStreamSource(stream);
      const gain = this.audioContext.createGain();
      gain.gain.value = 1 / Math.max(1, streams.length); // simple headroom-preserving mix
      source.connect(gain).connect(this.destination);
      this.sourceNodes.push(source);
    }

    return this.destination.stream;
  }

  teardown(): void {
    this.sourceNodes.forEach((node) => node.disconnect());
    this.sourceNodes = [];
    this.destination?.disconnect();
    this.destination = null;
  }
}
