# Kana Beat

A rhythm-based kana pronunciation prototype.

## Play online

After GitHub Pages deploys from `main`, open:

https://akiolove.github.io/flashcard-game/

No local setup is required.

## Current scope

- Vowels only: あ・い・う・え・お
- Fixed 80 BPM rhythm
- 20 prompts per round
- Local Japanese speech recognition with quantized Whisper Tiny and Transformers.js
- Correct / wrong feedback
- Score, combo, accuracy, and final results
- Manual fallback buttons when speech recognition is unavailable

## Local speech engine

- Audio is captured for 1.5 seconds with `MediaRecorder` and decoded to 16 kHz mono PCM.
- `onnx-community/whisper-tiny` runs locally in a Web Worker through the WASM backend at q8 precision.
- The model is initialized once per page and browser caching avoids downloading unchanged model files again.
- No recording or transcript is sent to a backend or cloud speech API.

## iPhone Safari

- Open the GitHub Pages URL in Safari, tap **開始**, and allow microphone access.
- The first run downloads the local model before the countdown begins. Keep the page open until it is ready.
- Later visits reuse the browser's model cache when available.
- If recording or local inference fails, the manual correct/wrong controls remain available.

## Local development

```bash
npm install --ignore-scripts
npm run dev
```

Microphone access requires HTTPS or `localhost`.
