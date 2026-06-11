const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, systemPreferences, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Resolve paths for both dev and packaged (asar.unpacked) environments
function resourcePath(...segments) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : __dirname;
  return path.join(base, ...segments);
}

// Lazy-load heavy modules only when needed
let Store, Groq, OpenAI;

let overlayWindow;
let store;
let groq;
let openai;

function getStore() {
  if (!store) {
    if (!Store) Store = require('electron-store');
    store = new Store();
  }
  return store;
}

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width } = primaryDisplay.workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 820,
    height: 860,
    x: width - 800,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // ============================================================
  // KEY FEATURE: Exclude window from screen capture/sharing
  // Works on: macOS (NSWindowSharingNone) + Windows (WDA_EXCLUDEFROMCAPTURE)
  // ============================================================
  overlayWindow.setContentProtection(true);

  // Keep on top of everything including fullscreen apps
  overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  if (process.platform === 'darwin') {
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    app.dock.hide();
  }

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ─── License / Trial ─────────────────────────────────────────

const TRIAL_LIMIT = 10;

function validateLicense(key) {
  if (!key || typeof key !== 'string') return false;
  const clean = key.trim().toUpperCase();
  // Gumroad auto-generated format: XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX
  if (/^[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/.test(clean)) return true;
  // Legacy PREP-XXXX-XXXX-XXXX format with checksum
  if (!/^PREP-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) return false;
  const digits = clean.replace(/-/g, '').split('');
  const sum = digits.reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return sum % 11 === 0;
}

function getTrialStatus() {
  const s = getStore();
  const used      = s.get('questionsUsed', 0);
  const licKey    = s.get('licenseKey', '');
  const licensed  = validateLicense(licKey);
  return {
    used,
    licensed,
    trialRemaining: Math.max(0, TRIAL_LIMIT - used),
    trialExpired:   !licensed && used >= TRIAL_LIMIT,
  };
}

function initApiClients() {
  const s = getStore();
  const groqKey = s.get('groqKey');
  const openaiKey = s.get('openaiKey');

  if (groqKey) {
    if (!Groq) Groq = require('groq-sdk');
    groq = new Groq({ apiKey: groqKey });
  }
  if (openaiKey) {
    if (!OpenAI) OpenAI = require('openai');
    openai = new OpenAI({ apiKey: openaiKey });
  }
}

// ─── App lifecycle ───────────────────────────────────────────

// Enable Web Speech API in Electron
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('auto-select-desktop-capture-source', 'Entire screen');

app.whenReady().then(async () => {
  createOverlayWindow();
  initApiClients();

  // Allow microphone and media access in the renderer process
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture', 'desktopCapture'];
    callback(allowed.includes(permission));
  });

  // Explicitly request mic permission on macOS so it appears in System Settings
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    if (micStatus !== 'granted') {
      await systemPreferences.askForMediaAccess('microphone');
    }
  }

  // Cmd/Ctrl+Shift+Space → toggle visibility
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!overlayWindow) return;
    if (overlayWindow.isVisible()) {
      overlayWindow.hide();
    } else {
      overlayWindow.show();
      overlayWindow.focus();
    }
  });

  // Cmd/Ctrl+Shift+A → toggle compact mode
  globalShortcut.register('CommandOrControl+Shift+A', () => {
    overlayWindow?.webContents.send('toggle-compact');
  });

  // Cmd/Ctrl+Shift+C → capture screen & solve
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    overlayWindow?.webContents.send('trigger-capture');
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Window management ──────────────────────────────────

ipcMain.on('quit-app', () => {
  app.quit();
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  if (overlayWindow) {
    overlayWindow.setIgnoreMouseEvents(ignore, options || {});
  }
});

// ─── IPC: License / Trial ────────────────────────────────────

ipcMain.handle('get-trial-status', () => getTrialStatus());

ipcMain.handle('activate-license', (event, key) => {
  const isValid = validateLicense(key);
  if (isValid) {
    const s = getStore();
    s.set('licenseKey', key.trim().toUpperCase());
  }
  return { isValid };
});

// ─── IPC: Settings ──────────────────────────────────────────

ipcMain.handle('get-settings', () => {
  const s = getStore();
  return {
    groqKey: s.get('groqKey', ''),
    openaiKey: s.get('openaiKey', ''),
    systemPrompt: s.get('systemPrompt', ''),
    interviewContext: s.get('interviewContext', ''),
    transcriptionMode: s.get('transcriptionMode', 'whisper'),
    overlayOpacity: s.get('overlayOpacity', 92),
  };
});

ipcMain.handle('save-settings', (event, settings) => {
  const s = getStore();
  if (settings.groqKey !== undefined) s.set('groqKey', settings.groqKey);
  if (settings.openaiKey !== undefined) s.set('openaiKey', settings.openaiKey);
  if (settings.systemPrompt !== undefined) s.set('systemPrompt', settings.systemPrompt);
  if (settings.interviewContext !== undefined) s.set('interviewContext', settings.interviewContext);
  if (settings.transcriptionMode !== undefined) s.set('transcriptionMode', settings.transcriptionMode);
  if (settings.overlayOpacity !== undefined) s.set('overlayOpacity', settings.overlayOpacity);
  initApiClients();
  return { success: true };
});

// ─── IPC: Desktop sources for system audio ──────────────────

ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 }
    });
    return sources.map(s => ({ id: s.id, name: s.name }));
  } catch (e) {
    return [];
  }
});

// ─── IPC: Local Whisper transcription ───────────────────────

ipcMain.handle('transcribe-audio', async (event, audioData) => {
  if (!groq) return { error: 'Groq API key not configured' };
  try {
    const tmpFile = path.join(os.tmpdir(), `prepaura_audio_${Date.now()}.webm`);
    fs.writeFileSync(tmpFile, Buffer.from(audioData));

    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: 'whisper-large-v3-turbo',
      language: 'en',
      response_format: 'json',
    });

    try { fs.unlinkSync(tmpFile); } catch (_) {}
    return { text: transcription.text };
  } catch (error) {
    console.error('Groq Whisper error:', error);
    return { error: error.message };
  }
});

// ─── IPC: Screen capture + Claude Vision solve ───────────────

ipcMain.handle('solve-from-screen', async (event, { language } = {}) => {
  if (!groq) {
    event.sender.send('stream-chunk', { error: 'Groq API key not configured. Go to Settings.' });
    return;
  }

  try {
    // Hide overlay briefly so it doesn't appear in the screenshot
    overlayWindow.hide();
    await new Promise(r => setTimeout(r, 150));

    // Cross-platform screen capture using Electron's desktopCapturer
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });

    overlayWindow.show();

    if (!sources || sources.length === 0) {
      const permMsg = process.platform === 'darwin'
        ? 'Screen capture failed — grant Screen Recording permission in System Settings → Privacy & Security → Screen Recording'
        : 'Screen capture failed — grant Screen Recording permission in Windows Settings → Privacy & Security → Screen capture';
      throw new Error(permMsg);
    }

    // thumbnail is already a nativeImage — no temp file needed
    const img = sources[0].thumbnail;
    const { width: imgW } = img.getSize();
    const scale = Math.min(1, 1280 / imgW);
    const resized = img.resize({ width: Math.round(imgW * scale) });
    const base64 = resized.toJPEG(72).toString('base64');

    const s = getStore();
    const interviewContext = s.get('interviewContext', '');
    const contextBlock = interviewContext ? `\nInterview context: ${interviewContext}` : '';

    const langInstruction = (language && language !== 'auto')
      ? `Write ALL code solutions in ${language}.`
      : 'Use the same language as shown in the screenshot, or Python if none is shown.';

    const visionPrompt = `You are an expert Software Engineering Interview Assistant. Look at this screenshot, identify the coding problem or interview question, and respond with EXACTLY this structure:

🎯 Interview Answer

[Explain your approach in 50-120 words as you would speak it in a real interview. Confident, natural language. No intros.]

💡 Key Points

• time complexity
• space complexity
• key algorithmic insight
• edge case to mention

🔥 Follow-up Questions
• [likely interviewer follow-up]? → [one-sentence answer]
• [likely interviewer follow-up]? → [one-sentence answer]
${contextBlock}
${langInstruction}

Then provide the solution code. No text outside this format.`;

    const stream = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 2000,
      stream: true,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}` },
          },
          { type: 'text', text: visionPrompt },
        ],
      }],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) event.sender.send('stream-chunk', { text });
    }
    event.sender.send('stream-chunk', { done: true });

  } catch (err) {
    overlayWindow?.show();
    console.error('solve-from-screen error:', err.message);
    event.sender.send('stream-chunk', { error: err.message });
  }
});

// ─── IPC: BlackHole Multi-Output setup ──────────────────────

ipcMain.handle('setup-audio', async () => {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      message: process.platform === 'win32'
        ? 'Audio setup is macOS-only. On Windows, install VB-Audio Virtual Cable (vb-audio.com/Cable) and set it as your playback device. PrepAura will detect "CABLE Output" automatically.'
        : 'Audio setup is only available on macOS.'
    };
  }
  const { execFile } = require('child_process');
  const scriptPath = resourcePath('setup_audio.swift');
  const env = { ...process.env, PATH: `${process.env.PATH || ''}:/usr/bin:/usr/local/bin` };

  return new Promise((resolve) => {
    execFile('swift', [scriptPath], { timeout: 30000, env }, (err, stdout, stderr) => {
      const output = (stdout + stderr).trim();
      if (err && !output.includes('SUCCESS') && !output.includes('INFO')) {
        resolve({ success: false, message: output || err.message });
      } else {
        resolve({ success: true, message: output });
      }
    });
  });
});

// ─── IPC: Claude streaming response ─────────────────────────

ipcMain.handle('stream-ai-response', async (event, { transcript, history }) => {
  if (!groq) {
    event.sender.send('stream-chunk', { error: 'Groq API key not configured. Go to Settings.' });
    return;
  }
  const trial = getTrialStatus();
  if (trial.trialExpired) {
    event.sender.send('stream-chunk', { trialExpired: true });
    return;
  }
  // Increment usage count
  const s = getStore();
  s.set('questionsUsed', trial.used + 1);

  const interviewContext = s.get('interviewContext', '');
  const customPrompt = s.get('systemPrompt', '');

  const basePrompt = `You are an expert Software Engineering Interview Assistant. Your primary goal is to provide the BEST possible interview answer that a candidate can speak aloud during a real interview.

Respond with EXACTLY this structure and nothing else:

🎯 Interview Answer
[Write a clear, confident spoken answer in 50-120 words. Use natural interview language — as if speaking directly to an interviewer. Cover: what the concept is, why it matters, and a concrete example or use case. No bullet points here — flowing prose only.]

💡 Key Points
• [key algorithmic or conceptual insight]
• [time/space complexity if relevant, or a key trade-off]
• [an important API, method, or design pattern to name-drop]
• [an edge case or gotcha to mention]
• [optional 5th point if critical]

🔥 Follow-up Questions
• [most likely interviewer follow-up question]? → [one-sentence answer]
• [second likely follow-up]? → [one-sentence answer]
• [third likely follow-up — only if genuinely distinct]? → [one-sentence answer]

RULES:
• The 🎯 answer MUST be speakable — no markdown formatting inside it, no bullet points, no code blocks
• 💡 Key Points: 3-5 bullets max, each under 15 words
• 🔥 Follow-up Questions: 2-3 questions max; each line: question? → one-sentence answer (under 20 words)
• After the three sections, if a code example is helpful, add it as a plain code block — no extra label needed
• No intro text, no summary, no text outside this format`;
  const contextBlock = interviewContext ? `\n\nInterview context: ${interviewContext}` : '';
  const systemPrompt = (customPrompt || basePrompt) + contextBlock;

  // Build messages array with conversation history
  const messages = [];
  if (history && Array.isArray(history)) {
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: 'user', content: transcript });

  try {
    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 6000,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) event.sender.send('stream-chunk', { text });
    }
    event.sender.send('stream-chunk', { done: true });
  } catch (error) {
    console.error('Groq error:', error);
    event.sender.send('stream-chunk', { error: error.message });
  }
});
