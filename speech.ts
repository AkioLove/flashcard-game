export interface SpeechEngine {
  initialize(): Promise<void>;
  transcribe(audio: Blob): Promise<string>;
}

export type SpeechProgress = {
  status: string;
  file?: string;
  progress?: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

const TARGET_SAMPLE_RATE = 16_000;
const MIN_RMS = 0.002;

function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

function resample(input: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === TARGET_SAMPLE_RATE) return input;

  const outputLength = Math.max(1, Math.round(input.length * TARGET_SAMPLE_RATE / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / TARGET_SAMPLE_RATE;

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = position - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

function rootMeanSquare(samples: Float32Array): number {
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  return Math.sqrt(energy / Math.max(1, samples.length));
}

async function decodeAudio(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext();
  try {
    const encoded = await blob.arrayBuffer();
    const buffer = await context.decodeAudioData(encoded.slice(0));
    return resample(mixToMono(buffer), buffer.sampleRate);
  } finally {
    await context.close().catch(() => undefined);
  }
}

class WhisperSpeechEngine implements SpeechEngine {
  private worker: Worker | null = null;
  private initializePromise: Promise<void> | null = null;
  private nextRequestId = 1;
  private pending = new Map<number, PendingRequest>();
  private progressListener: ((progress: SpeechProgress) => void) | null = null;

  setProgressListener(listener: ((progress: SpeechProgress) => void) | null): void {
    this.progressListener = listener;
  }

  initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.request('initialize').then(() => undefined).catch((error) => {
        this.initializePromise = null;
        this.terminateWorker();
        throw error;
      });
    }
    return this.initializePromise;
  }

  async transcribe(audio: Blob): Promise<string> {
    await this.initialize();
    const samples = await decodeAudio(audio);
    if (rootMeanSquare(samples) < MIN_RMS) return '';

    const result = await this.request('transcribe', { samples }, [samples.buffer]);
    return String(result || '').trim();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('./speech.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'progress') {
        this.progressListener?.(message.progress);
        return;
      }

      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      if (message.type === 'error') pending.reject(new Error(message.error));
      else pending.resolve(message.result);
    });
    worker.addEventListener('error', (event) => {
      const error = new Error(event.message || 'The local speech worker failed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.initializePromise = null;
      this.terminateWorker();
    });
    this.worker = worker;
    return worker;
  }

  private request(type: string, payload = {}, transfer: Transferable[] = []): Promise<unknown> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.ensureWorker().postMessage({ type, requestId, ...payload }, transfer);
    });
  }

  private terminateWorker(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

export const speechEngine = new WhisperSpeechEngine();
