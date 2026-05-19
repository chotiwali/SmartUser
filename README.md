**PrepAura (SmartOverlay)**
An Electron app that listens to interview questions and shows AI-generated answers in a floating overlay — invisible to screen sharing.

**How It Works**
Captures audio via microphone or system audio (BlackHole on macOS)
Transcribes speech using Web Speech API or OpenAI Whisper
Sends transcripts to Claude (Anthropic API) and streams back answers
Window is excluded from all screen captures using setContentProtection(true) (macOS: NSWindowSharingNone, Windows: WDA_EXCLUDEFROMCAPTURE)

**Requirements**
Node.js
Anthropic API key (required) — console.anthropic.com
OpenAI API key (optional, for Whisper transcription)
BlackHole (optional, macOS system audio capture)

**Setup**
bashcd smart-overlay
npm install
npm start
On first launch, the Settings panel opens automatically. Paste your Anthropic API key and save.

**Usage**
ActionShortcutToggle overlayCmd+Shift+Space / Ctrl+Shift+SpaceCompact modeCmd+Shift+ACapture screen & solveCmd+Shift+C / Ctrl+Shift+C

Click 🎤 Start Listening — the app transcribes speech in real time
After a 2-second pause, the transcript is sent to Claude automatically
Answers stream in with explanation on the left and code on the right
Optionally type questions manually or use screen capture for coding problems

**Build**
bashnpm run build:mac   # macOS DMG (arm64)
npm run build:win   # Windows NSIS installer

**Audio Modes**
Microphone — default; works best with speakers so the interviewer's voice is picked up
Mic + BlackHole — captures both mic and system audio; click Auto Setup Multi-Output Device in Settings

**Transcription Modes**
ModeAccuracyCostLatencyWeb Speech APIGoodFreeReal-timeOpenAI WhisperExcellent~$0.006/min~2–3s

**Privacy**
Audio is processed locally (Web Speech) or sent only to OpenAI/Anthropic APIs
API keys stored encrypted via electron-store
No telemetry or logging

**License**
Trial limited to 10 uses. Full access requires a license key.
