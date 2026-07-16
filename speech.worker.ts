import { env, pipeline } from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/whisper-tiny';

// GitHub Pages cannot set cross-origin isolation headers. A single WASM thread
// avoids SharedArrayBuffer requirements and is the most reliable path on Safari.
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

let pipelinePromise: Promise<any> | null = null;

function initialize() {
  if (!pipelinePromise) {
    pipelinePromise = pipeline('automatic-speech-recognition', MODEL_ID, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (progress: Record<string, unknown>) => {
        self.postMessage({ type: 'progress', progress });
      },
    }).catch((error) => {
      pipelinePromise = null;
      throw error;
    });
  }
  return pipelinePromise;
}

self.addEventListener('message', async (event) => {
  const { type, requestId, samples } = event.data;
  try {
    if (type === 'initialize') {
      await initialize();
      self.postMessage({ type: 'result', requestId, result: null });
      return;
    }

    if (type === 'transcribe') {
      const transcriber = await initialize();
      const output = await transcriber(samples, {
        language: 'japanese',
        task: 'transcribe',
        max_new_tokens: 8,
        do_sample: false,
      });
      const text = Array.isArray(output) ? output[0]?.text : output?.text;
      self.postMessage({ type: 'result', requestId, result: text || '' });
      return;
    }

    throw new Error(`Unknown speech worker request: ${type}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'error', requestId, error: message });
  }
});
