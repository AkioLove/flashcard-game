import { Model, type KaldiRecognizer } from 'vosk-browser';

export interface SpeechEngine {
  initialize(): Promise<void>;
  setVocabulary(terms: readonly string[]): void;
  transcribe(audio: Blob): Promise<string>;
}

export type SpeechProgress = {
  status: 'downloading' | 'initializing' | 'ready';
  progress?: number;
};

const TARGET_SAMPLE_RATE = 16_000;
const MIN_RMS = 0.002;
const MODEL_FILENAME = 'vosk-model-small-ja-0.22.tar.gz';
const MODEL_URL = `${import.meta.env.BASE_URL}models/${MODEL_FILENAME}`;
const MODEL_CACHE_KEY = 'kana-beat-vosk-ja-0.22-ready';
const INITIALIZE_TIMEOUT_MS = 180_000;
const TRANSCRIBE_TIMEOUT_MS = 20_000;

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

class VoskSpeechEngine implements SpeechEngine {
  private model: Model | null = null;
  private initializePromise: Promise<void> | null = null;
  private progressListener: ((progress: SpeechProgress) => void) | null = null;
  private diagnosticListener: ((message: string) => void) | null = null;
  private vocabulary: string[] = [];

  setProgressListener(listener: ((progress: SpeechProgress) => void) | null): void {
    this.progressListener = listener;
  }

  setDiagnosticListener(listener: ((message: string) => void) | null): void {
    this.diagnosticListener = listener;
  }

  setVocabulary(terms: readonly string[]): void {
    this.vocabulary = [...new Set(
      terms
        .map((term) => String(term).normalize('NFKC').trim())
        .filter((term) => term && term !== '[unk]'),
    )];
  }

  initialize(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeModel().catch((error) => {
        this.model?.terminate();
        this.model = null;
        this.initializePromise = null;
        throw error;
      });
    }
    return this.initializePromise;
  }

  async transcribe(audio: Blob): Promise<string> {
    await this.initialize();
    const samples = await decodeAudio(audio);
    const rms = rootMeanSquare(samples);
    this.diagnosticListener?.(`audio rms=${rms.toFixed(4)}; duration=${(samples.length / TARGET_SAMPLE_RATE).toFixed(2)}s`);
    if (rms < MIN_RMS) return '';
    if (!this.model?.ready) throw new Error('Vosk model is not ready.');

    const grammar = this.vocabulary.length
      ? JSON.stringify(this.vocabulary)
      : undefined;
    if (grammar) {
      try {
        const recognizer = new this.model.KaldiRecognizer(TARGET_SAMPLE_RATE, grammar);
        recognizer.setWords(true);
        const constrainedResult = await this.recognize(recognizer, samples);
        if (constrainedResult) return constrainedResult;
        this.diagnosticListener?.('Vosk constrained result empty; retrying without grammar');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.diagnosticListener?.(`Vosk constrained recognizer failed (${message}); retrying without grammar`);
      }
    }

    const fallbackRecognizer = new this.model.KaldiRecognizer(TARGET_SAMPLE_RATE);
    fallbackRecognizer.setWords(true);
    return this.recognize(fallbackRecognizer, samples);
  }

  private async initializeModel(): Promise<void> {
    if (!this.isModelCacheKnown()) {
      await this.prefetchModel();
    }

    this.progressListener?.({ status: 'initializing' });
    const model = new Model(MODEL_URL, -1);
    this.model = model;

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('Vosk initialization timed out after 180 seconds.'));
      }, INITIALIZE_TIMEOUT_MS);

      model.on('load', (message) => {
        window.clearTimeout(timeout);
        if (message.result) resolve();
        else reject(new Error('Vosk could not load the Japanese model.'));
      });
      model.on('error', (message) => {
        window.clearTimeout(timeout);
        reject(new Error(message.error || 'Vosk worker failed.'));
      });
    });

    this.markModelCacheReady();
    this.progressListener?.({ status: 'ready', progress: 100 });
  }

  private isModelCacheKnown(): boolean {
    try {
      return localStorage.getItem(MODEL_CACHE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private markModelCacheReady(): void {
    try {
      localStorage.setItem(MODEL_CACHE_KEY, 'true');
    } catch {
      // Safari privacy settings can disable persistent storage. The in-memory
      // singleton still prevents reloads during the current page session.
    }
  }

  private async prefetchModel(): Promise<void> {
    this.progressListener?.({ status: 'downloading', progress: 0 });

    try {
      const response = await fetch(MODEL_URL, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
      if (!response.body) return;

      const total = Number(response.headers.get('content-length')) || 0;
      const reader = response.body.getReader();
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (total > 0) {
          this.progressListener?.({
            status: 'downloading',
            progress: Math.min(100, Math.floor(received / total * 100)),
          });
        }
      }
    } catch {
      // Vosk maintains its own persistent IndexedDB cache. If that cache exists,
      // initialization can still succeed without a successful network preflight.
    }
  }

  private recognize(recognizer: KaldiRecognizer, samples: Float32Array): Promise<string> {
    return new Promise((resolve, reject) => {
      const texts: string[] = [];
      const rawTexts: string[] = [];
      let bestWord = '';
      let bestConfidence = -1;
      let waveformResponseReceived = false;
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        recognizer.remove();
        if (error) reject(error);
        else {
          const selected = bestWord || texts.join(' ').trim();
          this.diagnosticListener?.(`Vosk raw=${rawTexts.join(' | ') || '(empty)'}; selected=${selected || '(silence)'}; confidence=${bestConfidence < 0 ? 'n/a' : bestConfidence.toFixed(3)}`);
          resolve(selected);
        }
      };

      const timeout = window.setTimeout(() => {
        finish(new Error('Local transcription timed out.'));
      }, TRANSCRIBE_TIMEOUT_MS);

      recognizer.on('partialresult', () => {
        waveformResponseReceived = true;
      });
      recognizer.on('result', (message) => {
        const text = 'text' in message.result ? message.result.text.trim() : '';
        if (text) rawTexts.push(text);
        if (text && text !== '[unk]') texts.push(text);

        const words = 'result' in message.result && Array.isArray(message.result.result)
          ? message.result.result
          : [];
        for (const word of words) {
          if (word.word !== '[unk]' && word.conf > bestConfidence) {
            bestWord = word.word;
            bestConfidence = word.conf;
          }
        }

        if (waveformResponseReceived) finish();
        else waveformResponseReceived = true;
      });
      recognizer.on('error', (message) => {
        finish(new Error(message.error || 'Vosk recognizer failed.'));
      });

      recognizer.acceptWaveformFloat(samples, TARGET_SAMPLE_RATE);
      recognizer.retrieveFinalResult();
    });
  }
}

export const speechEngine = new VoskSpeechEngine();
