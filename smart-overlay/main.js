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

    const visionPrompt = `Look at this screenshot and extract any coding problem or interview question visible.
Provide 2-3 distinct solution approaches.${contextBlock}
${langInstruction}

Format each approach separated by ---:

**[Approach name e.g. "Brute Force O(n²)", "Hash Map O(n)"]**
• key insight
• time/space complexity
Use case: when to use this
\`\`\`language
// working solution
\`\`\`

---

No intro. No text outside the format.`;

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

  const basePrompt = `You are an expert iOS/Swift interview coach. Answer every question with EXACTLY 5 blocks progressing from basic to expert, separated by ---.

FORMAT — copy this structure exactly for every block:

**[Specific descriptive title — not generic, names the exact concept]**
[TAG]
Context: one sentence explaining what angle this block covers and why an interviewer asks about it
• specific point — name actual Swift types, APIs, or method signatures
• specific point
• specific point
Use case: In a [real app type], [concrete scenario showing this in practice]
\`\`\`swift
// 5-8 lines of focused working Swift code that directly demonstrates the bullets
\`\`\`

---

TAGS (pick one per block): BASIC | CORE API | PATTERN | ADVANCED | GOTCHA | PERFORMANCE | vs ALTERNATIVE

BLOCK ORDER — always follow this progression:
Block 1 [BASIC]         — What each option is, why it exists, when to reach for it
Block 2 [CORE API]      — Key types, initializers, read/write methods an interviewer expects you to know by name
Block 3 [PATTERN]       — The most common real-world usage pattern with concrete app scenario
Block 4 [ADVANCED]      — Threading, memory, migrations, performance tradeoffs or edge cases
Block 5 [GOTCHA or vs ALTERNATIVE] — A common mistake developers make OR comparison with a modern alternative

MANDATORY RULES:
• Output ALL 5 blocks — never fewer
• EVERY block MUST be separated by a line containing only: ---
• Exactly ONE **Title** per block — no other **bold** text anywhere inside the block body
• Use bullet points (•) only — never use **Sub-header:** labels like **Use Cases:** **Benefits:** **Example:** inside a block
• Every block needs a \`\`\`swift code snippet — shows the concept, not a generic template
• No intro text before block 1, no summary after block 5

SEPARATOR REMINDER: after every single block (including the last), write --- on its own line. If you forget ---, all blocks merge into one and the UI breaks.

FULL EXAMPLE — question: "When to use Core Data, UserDefaults and FileManager?":

**Choosing the Right Storage — Decision Framework**
[BASIC]
Context: Helps interviewers see you think about storage as a decision, not just syntax
• Core Data — structured relational data, querying, relationships, large datasets (e.g. user posts, messages)
• UserDefaults — tiny primitives only: Bool, Int, String, Date; never store models or arrays of objects
• FileManager — raw files on disk: images, PDFs, audio, JSON blobs, custom formats
Use case: In a social app, messages go in Core Data, "dark mode on" goes in UserDefaults, avatar images go in FileManager
\`\`\`swift
// Rule of thumb in one place
let isOnboarded = UserDefaults.standard.bool(forKey: "onboarded")   // tiny flag
let avatar = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
                         .appendingPathComponent("avatar.jpg")       // file on disk
// Core Data via NSPersistentContainer for structured records
\`\`\`

---

**Core Data, UserDefaults & FileManager — Key APIs**
[CORE API]
Context: Interviewers expect you to name actual types and methods, not just describe concepts
• Core Data: NSPersistentContainer, NSManagedObjectContext, fetch(_:), save(), NSFetchRequest<T>
• UserDefaults: standard.set(_:forKey:), standard.bool/integer/string(forKey:), synchronize() is legacy — not needed iOS 12+
• FileManager: default, urls(for:in:), createDirectory(at:withIntermediateDirectories:), copyItem(at:to:), removeItem(at:)
Use case: In a task manager app, fetch incomplete tasks with NSFetchRequest, store sort preference in UserDefaults
\`\`\`swift
// Core Data fetch
let request = NSFetchRequest<Task>(entityName: "Task")
request.predicate = NSPredicate(format: "isComplete == NO")
let tasks = try context.fetch(request)

// UserDefaults
UserDefaults.standard.set("date", forKey: "sortOrder")

// FileManager write
let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                     .appendingPathComponent("export.json")
try data.write(to: url)
\`\`\`

---

**Persisting User-Generated Content — Real-World Pattern**
[PATTERN]
Context: Shows you can apply the right storage to a realistic feature, not just recite theory
• combine all three in one feature: settings in UserDefaults, metadata in Core Data, blobs in FileManager
• store only the file path/URL in Core Data — never the binary data itself (keeps DB small and fast)
• use background NSManagedObjectContext for writes so the main thread stays responsive
Use case: In a photo journal app, photo metadata (date, caption, tags) in Core Data; the JPEG file in FileManager; grid layout preference in UserDefaults
\`\`\`swift
let bgContext = persistentContainer.newBackgroundContext()
bgContext.perform {
    let entry = JournalEntry(context: bgContext)
    entry.caption = "Sunset"
    entry.imagePath = savedFileURL.path   // path only, not the image data
    try? bgContext.save()
}
UserDefaults.standard.set("grid", forKey: "layoutStyle")
\`\`\`

---

**Threading, Migration & Performance Edge Cases**
[ADVANCED]
Context: This separates mid-level from senior — knowing the failure modes of each storage layer
• NSManagedObjectContext is not thread-safe — always use perform { } or a dedicated background context; never pass NSManagedObject across threads
• UserDefaults is synchronous on the main thread — reading large custom objects (via NSKeyedArchiver) causes jank; keep values tiny
• FileManager operations are blocking — always dispatch to a background queue; use coordinated reads for iCloud-backed files
Use case: In a data-heavy fitness app, migrating Core Data schema requires NSMigratePersistentStoresAutomatically + a mapping model to avoid crashes on update
\`\`\`swift
// Safe Core Data background write
persistentContainer.performBackgroundTask { ctx in
    // do work here — ctx is thread-confined
    try? ctx.save()
}

// FileManager off main thread
DispatchQueue.global(qos: .utility).async {
    try? FileManager.default.copyItem(at: src, to: dst)
}
\`\`\`

---

**Common Mistake — Storing Objects in UserDefaults**
[GOTCHA]
Context: The single most common UserDefaults misuse seen in iOS code reviews
• storing custom objects directly in UserDefaults crashes at runtime — it only accepts plist-compatible types
• workaround is JSONEncoder → Data → set(forKey:), but that is a sign you should use Core Data or FileManager instead
• another gotcha: calling synchronize() is redundant since iOS 12 and blocks the main thread unnecessarily
Use case: Storing a User model in UserDefaults "because it's simple" — then hitting a crash in production when a new property is added without migration
\`\`\`swift
// WRONG — crashes: "attempt to insert non-property list object"
UserDefaults.standard.set(myUserObject, forKey: "user")  // ❌

// RIGHT — encode first, but consider Core Data for anything this complex
let data = try? JSONEncoder().encode(myUserObject)
UserDefaults.standard.set(data, forKey: "user")          // ✅ works, but smell
\`\`\`

---`;
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
