# SmartOverlay — Private AI Interview Assistant

A floating overlay that listens to interview questions and shows AI answers — **invisible to screen sharing**.

## How Screen Invisibility Works
- **macOS**: Uses `NSWindowSharingNone` — window is excluded from all screen captures, recordings, and shares (Teams, Zoom, Meet, etc.)
- **Windows**: Uses `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` — same result

> The window is fully visible to you on your monitor but appears as a black/blank rectangle (or is absent entirely) in any screen share or recording.

## Getting Started (DMG Install)

### 1. Install
Open the `.dmg` file → drag **SmartOverlay** into your **Applications** folder.

### 2. Bypass Gatekeeper (unsigned app)
Right-click **SmartOverlay** in Applications → **Open** → click **Open anyway** when macOS warns you.
> This prompt only appears once. After that the app opens normally.

### 3. Get your API key & add credit
The app opens to a welcome screen with setup instructions. In parallel:
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create a new API key
3. Add at least **$5 credit** under Billing
4. Copy the key, paste it into the **Anthropic API Key** field in the app → click **Save**

---

## Setup (run from source)

### 1. Install dependencies
```bash
cd smart-overlay
npm install
```

### 2. Get API Keys
- **Anthropic API key** (required): https://console.anthropic.com
- **OpenAI API key** (optional, for Whisper transcription): https://platform.openai.com

### 3. Run
```bash
npm start
```

On first launch, the Settings panel opens automatically — paste your Anthropic key and save.

## Step-by-Step Usage

### Before your interview

**Step 1 — Launch the app**
```bash
npm start
```

**Step 2 — Configure Settings (first launch only)**

The Settings panel opens automatically on first launch. Fill in:
- **Anthropic API Key** (required) — paste your key from https://console.anthropic.com and click **Save**
- **Interview Context** (optional but recommended) — paste the job description, tech stack, or anything you want the AI to keep in mind when answering
- **Custom System Prompt** (optional) — override the default AI instructions if needed

**Step 3 — Choose your audio source**

In Settings, pick the audio mode that fits your setup:
- **Microphone** (default) — captures your mic; works best with speakers so the interviewer's voice is picked up too
- **Mic + BlackHole** — captures both your mic and system audio (requires BlackHole installed). Click **Auto Setup Multi-Output Device** to configure it automatically.

**Step 4 — Choose transcription mode**

- **Web Speech API** — free, real-time, no extra setup
- **Whisper** — higher accuracy, uses local Whisper model, ~2–3s latency

---

### During the interview

**Step 5 — Show/hide the overlay**

Press `Cmd+Shift+Space` (Mac) / `Ctrl+Shift+Space` (Win) to toggle the overlay on or off at any time. It is invisible to screen sharing.

**Step 6 — Start listening**

Click **🎤 Start Listening**. The app will begin capturing audio and transcribing speech in real time.

**Step 7 — Let the AI answer**

When the interviewer finishes a question, the app detects a 2-second pause and automatically sends the transcript to Claude. Answers stream in with explanations on the left and code on the right.

**Step 8 — Ask questions manually (optional)**

Type any question into the text box at the bottom and press **Enter** or click **Send** — useful for follow-up questions or when audio capture isn't ideal.

**Step 9 — Solve coding problems from screen (optional)**

If a coding problem appears on your screen (e.g. in a shared IDE or HackerRank), press `Cmd+Shift+C` (Mac) / `Ctrl+Shift+C` (Win) or click the **📷 Capture** button. The app reads your screen and returns a solution in your chosen language.

**Step 10 — Navigate history**

Use the **‹** and **›** buttons to scroll back through previous questions and answers during the session.

**Step 11 — Stay compact**

Press `Cmd+Shift+A` or click **⊟** to toggle compact mode and keep the overlay out of the way between questions.

**Step 12 — Clear between rounds (optional)**

Click 🗑 to wipe the transcript and history before a new interview round.

---

## Quick Reference

| Action | How |
|--------|-----|
| Toggle overlay | `Cmd+Shift+Space` (Mac) / `Ctrl+Shift+Space` (Win) |
| Compact mode | `Cmd+Shift+A` or click `⊟` |
| Start listening | Click **🎤 Start Listening** |
| Stop | Click **⏹ Stop Listening** |
| Capture screen & solve | `Cmd+Shift+C` or click **📷 Capture** |
| Clear history | Click 🗑 |

## Audio Modes

### Microphone (default)
Captures your microphone. Works best if you use speakers (not headphones) so the mic picks up the interviewer's voice. Or use open-back headphones.

### System Audio (Whisper mode only)
Captures your computer's audio output directly — captures exactly what the interviewer says regardless of headphones.

**For best system audio on macOS**, install [BlackHole](https://github.com/ExistingMetahorn/BlackHole) and set it as your audio output, then route your video call through it.

**On Windows**, system audio loopback capture is built-in.

## Transcription Modes

| Mode | Accuracy | Cost | Latency |
|------|----------|------|---------|
| Web Speech API | Good | Free | Real-time |
| OpenAI Whisper | Excellent | ~$0.006/min | ~2-3s |

## Build

```bash
# macOS DMG
npm run build:mac

# Windows installer
npm run build:win
```

## Privacy
- All audio processing is local (Web Speech) or sent only to OpenAI/Anthropic APIs
- API keys stored encrypted in your OS keychain via electron-store
- No telemetry, no logging
