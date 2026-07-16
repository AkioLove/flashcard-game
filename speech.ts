export interface SpeechEngine {
  initialize(): Promise<void>;
  setVocabulary(terms: readonly string[]): void;
  startListening(): void;
  stopListening(): void;
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
  final: boolean;
  sessionId: number;
  resultIndex: number;
};

export type SpeechEngineEvent = {
  type: string;
  phase: 'initialize' | 'stream';
  detail?: string;
};

type Recognition = any;

const INITIALIZE_TIMEOUT_MS = 20_000;
const RESTART_DELAY_MS = 300;
const NETWORK_RESTART_DELAY_MS = 1_500;
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

function recognitionConstructor(): any {
  const browserWindow = window as any;
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
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
  private resultListener: ((result: SpeechResult) => void) | null = null;
  private activeRecognition: Recognition | null = null;
  private restartTimer = 0;
  private shouldListen = false;
  private sessionId = 0;

  setEventListener(listener: ((event: SpeechEngineEvent) => void) | null): void {
    this.eventListener = listener;
  }

  setResultListener(listener: ((result: SpeechResult) => void) | null): void {
    this.resultListener = listener;
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
      // Start a short probe synchronously inside the Start-button gesture so iOS
      // can show its microphone / speech-recognition permission prompt.
      this.initializePromise = this.probeMicrophone().catch((error) => {
        this.initializePromise = null;
        throw error;
      });
    }
    return this.initializePromise;
  }

  startListening(): void {
    if (!canRecognizeSpeech()) throw new Error('Web Speech API is unavailable in this browser.');
    if (this.shouldListen) return;

    this.shouldListen = true;
    window.clearTimeout(this.restartTimer);
    this.startSession();
  }

  stopListening(): void {
    this.shouldListen = false;
    window.clearTimeout(this.restartTimer);
    this.restartTimer = 0;

    const recognition = this.activeRecognition;
    this.activeRecognition = null;
    if (recognition) {
      try {
        recognition.abort();
      } catch {
        // The browser may already have closed the session.
      }
    }
    this.emit('stop', 'stream');
  }

  private startSession(): void {
    if (!this.shouldListen || this.activeRecognition) return;

    const recognition = this.createRecognition(true);
    const sessionId = ++this.sessionId;
    let restartDelay = RESTART_DELAY_MS;
    let lastResultSignature = '';
    this.activeRecognition = recognition;

    const isCurrent = () => this.activeRecognition === recognition;

    recognition.onstart = () => {
      if (!isCurrent()) return;
      this.emit('start', 'stream', `session=${sessionId}`);
    };
    recognition.onaudiostart = () => {
      if (!isCurrent()) return;
      this.emit('audiostart', 'stream', `session=${sessionId}`);
    };
    recognition.onsoundstart = () => {
      if (isCurrent()) this.emit('soundstart', 'stream', `session=${sessionId}`);
    };
    recognition.onspeechstart = () => {
      if (isCurrent()) this.emit('speechstart', 'stream', `session=${sessionId}`);
    };
    recognition.onspeechend = () => {
      if (isCurrent()) this.emit('speechend', 'stream', `session=${sessionId}`);
    };
    recognition.onsoundend = () => {
      if (isCurrent()) this.emit('soundend', 'stream', `session=${sessionId}`);
    };
    recognition.onaudioend = () => {
      if (isCurrent()) this.emit('audioend', 'stream', `session=${sessionId}`);
    };
    recognition.onnomatch = () => {
      if (isCurrent()) this.emit('nomatch', 'stream', `session=${sessionId}`);
    };
    recognition.onresult = (event: any) => {
      if (!isCurrent()) return;

      for (let resultIndex = event.resultIndex; resultIndex < event.results.length; resultIndex += 1) {
        const browserResult = event.results[resultIndex];
        const alternatives: SpeechAlternative[] = [];
        for (let rank = 0; rank < browserResult.length; rank += 1) {
          const candidate = browserResult[rank];
          const transcript = String(candidate.transcript || '').trim();
          if (!transcript) continue;
          alternatives.push({
            transcript,
            confidence: Number.isFinite(candidate.confidence) ? candidate.confidence : null,
            final: Boolean(browserResult.isFinal),
            rank,
          });
        }

        if (!alternatives.length) continue;
        const signature = `${resultIndex}:${Boolean(browserResult.isFinal)}:${alternatives.map((item) => item.transcript).join('|')}`;
        if (signature === lastResultSignature) continue;
        lastResultSignature = signature;

        const result: SpeechResult = {
          transcript: alternatives[0]?.transcript || '',
          alternatives,
          final: Boolean(browserResult.isFinal),
          sessionId,
          resultIndex,
        };
        this.emit('result', 'stream', `${result.final ? 'final' : 'interim'} => ${alternatives.map((item) => item.transcript).join(' | ')}`);
        this.resultListener?.(result);
      }
    };
    recognition.onerror = (event: any) => {
      if (!isCurrent()) return;
      const code = event?.error || 'unknown';
      if (code === 'aborted' && !this.shouldListen) return;

      this.emit('error', 'stream', errorMessage(event));
      if (FATAL_ERRORS.has(code)) this.shouldListen = false;
      if (code === 'network') restartDelay = NETWORK_RESTART_DELAY_MS;
    };
    recognition.onend = () => {
      if (isCurrent()) this.activeRecognition = null;
      this.emit('end', 'stream', `session=${sessionId}`);
      this.scheduleRestart(restartDelay);
    };

    try {
      recognition.start();
    } catch (error) {
      if (isCurrent()) this.activeRecognition = null;
      const message = error instanceof Error ? error.message : String(error);
      this.emit('error', 'stream', `start: ${message}`);
      this.scheduleRestart(RESTART_DELAY_MS);
    }
  }

  private scheduleRestart(delay: number): void {
    if (!this.shouldListen || this.activeRecognition) return;
    window.clearTimeout(this.restartTimer);
    this.emit('restart', 'stream', `in=${delay}ms`);
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = 0;
      this.startSession();
    }, delay);
  }

  private probeMicrophone(): Promise<void> {
    const recognition = this.createRecognition(false);

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

  private createRecognition(continuous: boolean): Recognition {
    const Constructor = recognitionConstructor();
    const recognition = new Constructor();
    recognition.lang = 'ja-JP';
    recognition.continuous = continuous;
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
