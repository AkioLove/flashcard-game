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
- Local Japanese speech recognition with Vosk WASM
- Correct / wrong feedback
- Score, combo, accuracy, and final results
- Manual fallback buttons when speech recognition is unavailable

## Local speech engine

- Audio is captured for 1.5 seconds with `MediaRecorder` and decoded to 16 kHz mono PCM.
- `vosk-model-small-ja-0.22` runs locally inside Vosk's Web Worker and supports general Japanese rather than only the current five vowels.
- The model is initialized once per page. Vosk stores it in IndexedDB so later rounds and visits do not reload it.
- No recording or transcript is sent to a backend or cloud speech API.
- `npm run build` downloads the official Apache-2.0 model, verifies its SHA-256 checksum, and packages it for same-origin GitHub Pages delivery. The generated model archive is not committed to Git.

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

Run `npm run build` once before local device testing so `public/models` contains the Vosk archive.
