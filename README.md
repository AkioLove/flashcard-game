# Kana Beat

A rhythm-based kana pronunciation prototype.

## Play online

After GitHub Pages deploys from `main`, open:

https://akiolove.github.io/flashcard-game/

No local setup, speech model download, backend, or API key is required.

## Current scope

- Vowels only: あ・い・う・え・お
- Fixed 80 BPM rhythm
- 20 prompts per round
- Japanese recognition through the browser's Web Speech API
- Correct / wrong feedback
- Score, combo, accuracy, and final results
- Manual fallback buttons when speech recognition is unavailable

## Speech engine

- Kana Beat uses `SpeechRecognition` or the prefixed `webkitSpeechRecognition` implementation exposed by the browser.
- Recognition is configured for `ja-JP`, up to ten alternatives, interim results, and contextual vocabulary hints where the browser supports them.
- The green **現在唸！** cue appears only after the browser fires `audiostart`, so it reflects the actual listening window rather than a fixed recording timer.
- Each prompt uses a fresh recognition session. The game checks the first three alternatives and accepts safe recognition variants such as repeated vowels, trailing small kana, and common single-vowel homophones.
- This is a frontend-only integration with no application server and no API key. The browser vendor may still process speech on its servers, so it is not guaranteed to be offline or device-local.

## Browser notes

- Desktop Chrome is the recommended test target.
- On iPhone, Chrome and Safari use Apple's browser engine in most regions and expose the same underlying Web Speech support. Availability and server-side recognition can therefore differ from desktop Chrome.
- The in-game Debug panel records `start`, `audiostart`, `speechstart`, `result`, error, and timeout events. Copy it when reporting a device failure.
- Manual correct/wrong controls remain available if the browser does not expose or complete speech recognition.

## Local development

```bash
npm install --ignore-scripts
npm run dev
```

`npm` is only used to install the Vite build tool and create the static GitHub Pages files. It does not add a Node.js server to the deployed app.

Microphone and speech-recognition access require HTTPS or `localhost`.
