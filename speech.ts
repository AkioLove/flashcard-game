export interface SpeechEngine {
  initialize(): Promise<void>;
  setVocabulary(terms: readonly string[]): void;
  recognize(): Promise<SpeechResult>;
  abort(): void;
}

export type SpeechAlternative = {
  transcript: string;
  confidence: number | null;
  final: boolean;
  rank: number;
};

export type SpeechResult = {
  transcript: string;
  alternatives: SpeechAlternative[];
};

export type SpeechEngineEvent = {
  type: string;
  phase: 'initialize' | 'recognize';
  detail?: string;
};

type Recognition = any;

const INITIALIZE_TIMEOUT_MS = 20_000;
const AUDIO_WINDOW_MS = 3_500;
const RESULT_GRACE_MS = 1_200;
const RECOGNITION_TIMEOUT_MS = 9_000;

function recognitionConstructor(): any {
  const browserWindow = window as any;
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
}

function emptyResult(): SpeechResult {
  return { transcript: '', alternatives: [] };
}

function errorMessage(event: any): string {
  return [event?.error, event?.message].filter(Boolean).join(': ') || 'unknown speech recognition error';
}

export function canRecognizeSpeech(): boolean {
  return Boolean(window.isSecureContext && recognitionConstructor());
}

export function recognitionImplementation(): string {
  const browserWindow = window as any;
  if (browserWindow.SpeechRecognition) return 'SpeechRecognition';
  if (browserWindow.webkitSpeechRecognition) return 'webkitSpeechRecognition';
  return 'unavailable';
}

class BrowserSpeechEngine implements SpeechEngine {
  private initializePromise: Promise<void> | null = null;
  private vocabulary: string[] = [];
  private eventListener: ((event: SpeechEngineEvent) => void) | null = null;
  private active: { abort: () => void } | null = null;

  setEventListener(listener: ((event: SpeechEngineEvent) => void) | null): void {
    this.eventListener = listener;
  }

  setVocabulary(terms: readonly string[]): void {
    this.vocabulary = [...new Set(
      terms
        .map((term) => String(term).normalize('NFKC').trim())
        .filter(Boolean),
    )];
  }

  initialize(): Promise<void> {
    if (!canRecognizeSpeech()) {
      return Promise.reject(new Error('Web Speech API is unavailable in this browser.'));
    }

    if (!this.initializePromise) {
      // This probe starts synchronously inside the Start-button gesture. That is
      // important on iOS, where microphone permission may require user activation.
      this.initializePromise = this.probeMicrophone().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    return this.initializePromise;
  }

  recognize(): Promise<SpeechResult> {
    if (!canRecognizeSpeech()) {
      return Promise.reject(new Error('Web Speech API is unavailable in this browser.'));
    }

    this.abort();
    const recognition = this.createRecognition();
    const resultGroups = new Map<number, SpeechAlternative[]>();

    return new Promise((resolve, reject) => {
      let settled = false;
      let audioTimer = 0;
      let resultTimer = 0;

      const clearTimers = () => {
        window.clearTimeout(audioTimer);
        window.clearTimeout(resultTimer);
        window.clearTimeout(timeout);
      };

      const buildResult = (): SpeechResult => {
        const all = [...resultGroups.entries()]
          .sort(([left], [right]) => left - right)
          .flatMap(([, alternatives]) => alternatives);
        const final = all.filter((alternative) => alternative.final);
        const source = final.length ? final : all;
        const unique = new Map<string, SpeechAlternative>();

        for (const alternative of source) {
          const key = alternative.transcript.normalize('NFKC').trim();
          if (!key) continue;
          const previous = unique.get(key);
          if (!previous || alternative.rank < previous.rank) unique.set(key, alternative);
        }

        const alternatives = [...unique.values()];
        return {
          transcript: alternatives[0]?.transcript || '',
          alternatives,
        };
      };

      const finish = (result: SpeechResult, error?: Error, shouldAbort = false) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (this.active?.abort === abort) this.active = null;
        if (shouldAbort) {
          try {
            recognition.abort();
          } catch {
            // The browser may already have closed this recognition session.
          }
        }
        if (error) reject(error);
        else resolve(result);
      };

      const stopForResult = () => {
        if (settled) return;
        this.emit('stop', 'recognize');
        try {
          recognition.stop();
        } catch {
          finish(buildResult(), undefined, true);
          return;
        }
        window.clearTimeout(resultTimer);
        resultTimer = window.setTimeout(() => finish(buildResult(), undefined, true), RESULT_GRACE_MS);
      };

      const abort = () => finish(emptyResult(), undefined, true);
      this.active = { abort };

      const timeout = window.setTimeout(() => {
        this.emit('timeout', 'recognize');
        finish(buildResult(), undefined, true);
      }, RECOGNITION_TIMEOUT_MS);

      recognition.onstart = () => this.emit('start', 'recognize');
      recognition.onaudiostart = () => {
        this.emit('audiostart', 'recognize');
        window.clearTimeout(audioTimer);
        audioTimer = window.setTimeout(stopForResult, AUDIO_WINDOW_MS);
      };
      recognition.onsoundstart = () => this.emit('soundstart', 'recognize');
      recognition.onspeechstart = () => this.emit('speechstart', 'recognize');
      recognition.onspeechend = () => {
        this.emit('speechend', 'recognize');
        window.clearTimeout(resultTimer);
        resultTimer = window.setTimeout(stopForResult, 250);
      };
      recognition.onsoundend = () => this.emit('soundend', 'recognize');
      recognition.onaudioend = () => this.emit('audioend', 'recognize');
      recognition.onnomatch = () => this.emit('nomatch', 'recognize');
      recognition.onresult = (event: any) => {
        let hasFinal = false;
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const alternatives: SpeechAlternative[] = [];
          for (let rank = 0; rank < result.length; rank += 1) {
            const candidate = result[rank];
            const transcript = String(candidate.transcript || '').trim();
            if (!transcript) continue;
            alternatives.push({
              transcript,
              confidence: Number.isFinite(candidate.confidence) ? candidate.confidence : null,
              final: Boolean(result.isFinal),
              rank,
            });
          }
          resultGroups.set(index, alternatives);
          hasFinal ||= Boolean(result.isFinal);
        }

        const current = buildResult();
        this.emit('result', 'recognize', current.alternatives.map((item) => item.transcript).join(' | ') || '(empty)');
        if (hasFinal) finish(current, undefined, true);
      };
      recognition.onerror = (event: any) => {
        if (settled) return;
        const message = errorMessage(event);
        this.emit('error', 'recognize', message);

        if (event?.error === 'no-speech' || event?.error === 'aborted') {
          finish(buildResult());
          return;
        }
        finish(buildResult(), new Error(message), true);
      };
      recognition.onend = () => {
        this.emit('end', 'recognize');
        finish(buildResult());
      };

      try {
        recognition.start();
      } catch (error) {
        finish(emptyResult(), error instanceof Error ? error : new Error(String(error)), true);
      }
    });
  }

  abort(): void {
    const active = this.active;
    this.active = null;
    active?.abort();
  }

  private probeMicrophone(): Promise<void> {
    const recognition = this.createRecognition();

    return new Promise((resolve, reject) => {
      let settled = false;
      let started = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        try {
          recognition.abort();
        } catch {
          // The probe may already have ended.
        }
        if (error) reject(error);
        else resolve();
      };

      const timeout = window.setTimeout(() => {
        if (started) finish();
        else finish(new Error('Web Speech API did not start within 20 seconds.'));
      }, INITIALIZE_TIMEOUT_MS);

      recognition.onstart = () => {
        started = true;
        this.emit('start', 'initialize');
      };
      recognition.onaudiostart = () => {
        this.emit('audiostart', 'initialize');
        finish();
      };
      recognition.onerror = (event: any) => {
        if (settled) return;
        const message = errorMessage(event);
        this.emit('error', 'initialize', message);
        if (event?.error === 'aborted' && started) finish();
        else finish(new Error(message));
      };
      recognition.onend = () => {
        if (settled) return;
        this.emit('end', 'initialize');
        if (started) finish();
        else finish(new Error('Web Speech API ended before it could start.'));
      };

      try {
        recognition.start();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private createRecognition(): Recognition {
    const Constructor = recognitionConstructor();
    const recognition = new Constructor();
    recognition.lang = 'ja-JP';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 10;

    if ('processLocally' in recognition) {
      try {
        recognition.processLocally = false;
      } catch {
        // This experimental option is read-only in some implementations.
      }
    }

    const Phrase = (window as any).SpeechRecognitionPhrase;
    if (Phrase && 'phrases' in recognition && this.vocabulary.length) {
      try {
        recognition.phrases = this.vocabulary.map((term) => new Phrase(term, 10));
      } catch {
        // Contextual biasing is experimental; recognition still works without it.
      }
    }

    return recognition;
  }

  private emit(type: string, phase: SpeechEngineEvent['phase'], detail?: string): void {
    this.eventListener?.({ type, phase, detail });
  }
}

export const speechEngine = new BrowserSpeechEngine();
