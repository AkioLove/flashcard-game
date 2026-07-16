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
- Japanese speech recognition through `SpeechRecognition` / `webkitSpeechRecognition`
- Correct / wrong feedback
- Score, combo, accuracy, and final results
- Manual fallback buttons when speech recognition is unavailable

## iPhone Safari

- Open the GitHub Pages URL in Safari.
- Tap **開始** and allow microphone access.
- The app requests microphone permission from the tap event before the countdown, which is required for reliable iOS behavior.
- Browser speech-recognition availability still depends on the installed iOS/Safari version and Apple services. If recognition is unavailable or fails, the game remains playable with manual correct/wrong controls.

## Local development

```bash
npm install
npm run dev
```

Microphone access requires HTTPS or `localhost`.
