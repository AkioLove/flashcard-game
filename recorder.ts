const MIME_TYPES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
];

function supportedMimeType(): string | undefined {
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export function canRecordAudio(): boolean {
  return Boolean(
    navigator.mediaDevices?.getUserMedia
      && window.MediaRecorder
      && window.AudioContext,
  );
}

export class AudioRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  async requestPermission(): Promise<void> {
    if (!canRecordAudio()) {
      throw new Error('This browser does not support local audio recording.');
    }

    await this.ensureStream();
  }

  async start(): Promise<void> {
    if (!canRecordAudio()) {
      throw new Error('This browser does not support local audio recording.');
    }
    if (this.recorder?.state === 'recording') {
      throw new Error('Audio recording is already in progress.');
    }

    const stream = await this.ensureStream();
    this.chunks = [];

    try {
      const mimeType = supportedMimeType();
      this.recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      this.recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      });
      await new Promise<void>((resolve, reject) => {
        const recorder = this.recorder!;
        recorder.addEventListener('start', () => resolve(), { once: true });
        recorder.addEventListener('error', () => reject(new Error('Audio recording failed to start.')), { once: true });
        recorder.start();
      });
    } catch (error) {
      this.releaseStream();
      this.recorder = null;
      throw error;
    }
  }

  stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      return Promise.reject(new Error('No audio recording is in progress.'));
    }

    return new Promise((resolve, reject) => {
      const finish = () => {
        const type = recorder.mimeType || this.chunks[0]?.type || 'audio/mp4';
        const blob = new Blob(this.chunks, { type });
        this.recorder = null;
        this.chunks = [];
        if (blob.size === 0) reject(new Error('The browser returned an empty recording.'));
        else resolve(blob);
      };

      recorder.addEventListener('stop', finish, { once: true });
      recorder.addEventListener('error', () => {
        this.recorder = null;
        this.chunks = [];
        this.releaseStream();
        reject(new Error('Audio recording failed.'));
      }, { once: true });

      try {
        recorder.stop();
      } catch (error) {
        this.recorder = null;
        this.chunks = [];
        this.releaseStream();
        reject(error);
      }
    });
  }

  async cancel(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') {
      return;
    }

    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    this.recorder = null;
    this.chunks = [];
  }

  async dispose(): Promise<void> {
    await this.cancel();
    this.releaseStream();
  }

  private async ensureStream(): Promise<MediaStream> {
    const liveStream = this.stream?.getAudioTracks().some((track) => track.readyState === 'live');
    if (this.stream && liveStream) return this.stream;

    this.releaseStream();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    return this.stream;
  }

  private releaseStream(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
