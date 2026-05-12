/* =====================================================
   Smart Overlay — Renderer Process
   Private AI interview assistant, invisible to screen share
   ===================================================== */

// ── State ─────────────────────────────────────────────────────
let isListening = false;
let recognition = null;          // SpeechRecognition instance
let mediaRecorder = null;        // For Whisper mode
let audioChunks = [];
let audioStream = null;
let processingChunkTimer = null;
let conversationHistory = [];    // [{role, content}]
let historyIndex = -1;           // current view index
let currentEntry = null;         // {question, answer}

// ── DOM ───────────────────────────────────────────────────────
const overlay          = document.getElementById('overlay');
const settingsPanel    = document.getElementById('settings-panel');
const listenBtn        = document.getElementById('listen-btn');
const clearBtn         = document.getElementById('clear-btn');
const questionText     = document.getElementById('question-text');
const answerText       = null; // replaced by two-column layout
const statusDot        = document.getElementById('status-dot');
const statusTextEl     = document.getElementById('status-text');
const interimBadge     = document.getElementById('interim-badge');
const settingsOpenBtn  = document.getElementById('settings-open-btn');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const saveSettingsBtn  = document.getElementById('save-settings-btn');
const compactBtn       = document.getElementById('compact-btn');
const audioSourceSel   = document.getElementById('audio-source-select');
const transcModeSel    = document.getElementById('transcription-mode');
const opacitySlider    = document.getElementById('opacity-slider');
const opacityVal       = document.getElementById('opacity-val');
const histPrev         = document.getElementById('hist-prev');
const histNext         = document.getElementById('hist-next');
const histLabel        = document.getElementById('hist-label');
const openaiKeyGroup   = document.getElementById('openai-key-group');

// ── Helpers ───────────────────────────────────────────────────
function setStatus(state, text) {
  statusDot.className = `dot ${state}`;
  statusTextEl.textContent = text;
}

function scrollToBottom() {
  const body = document.getElementById('body-content');
  body.scrollTop = body.scrollHeight;
}

function clearAnswerUI() {
  document.getElementById('answer-rows').innerHTML = '';
}

// Parse full AI text into approach objects — resilient to messy model formatting
// Each approach: { name, tag, context, bullets, usecase, code }
function parseApproaches(text) {
  if (!text) return [];

  // Primary split: explicit --- separators
  let blocks = text.split(/\n?---+\n?/).map(b => b.trim()).filter(Boolean);

  // Fallback: if model didn't use ---, split on every **Title** + [TAG] boundary
  if (blocks.length <= 1 && blocks[0]) {
    const fallback = blocks[0].split(/(?=\n\*\*[^\n*]+\*\*\s*\n\s*\[)/).map(b => b.trim()).filter(Boolean);
    if (fallback.length > 1) blocks = fallback;
  }

  // Last resort: split on every **Title** line at start of a section
  if (blocks.length <= 1 && blocks[0]) {
    const lastResort = blocks[0].split(/(?=^\*\*[^\n*]+\*\*)/m).map(b => b.trim()).filter(Boolean);
    if (lastResort.length > 1) blocks = lastResort;
  }

  return blocks.map(block => {
    // 1. Pull out ALL code blocks first
    const codeMatch = block.match(/```[\w]*\n?([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : '';
    const noCode = block.replace(/```[\s\S]*?```/g, '').trim();

    // 2. First **bold** line anywhere = title
    const nameMatch = noCode.match(/\*\*([^*\n]+?)\*\*/);
    const name = nameMatch ? nameMatch[1].replace(/:$/, '').trim() : '';

    // 3. Remove title from body
    const body = noCode.replace(/\*\*[^*\n]+?\*\*\n?/, '').trim();
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

    // 4. Special lines
    const tagLine     = lines.find(l => /^\[.+\]$/.test(l));
    const contextLine = lines.find(l => /^Context:/i.test(l));
    const ucLine      = lines.find(l => /^use cases?:/i.test(l));

    const tag     = tagLine     ? tagLine.replace(/[\[\]]/g, '').trim()       : '';
    const context = contextLine ? contextLine.replace(/^Context:\s*/i, '')     : '';
    const usecase = ucLine      ? ucLine.replace(/^use cases?:\s*/i, '')       : '';

    // 5. Explicit bullet lines (•, -, *)
    const explicitBullets = lines
      .filter(l => /^[•\-*]/.test(l))
      .map(l => l.replace(/^[•\-*]\s*/, '').trim())
      .filter(Boolean);

    // 6. If model used **Sub-header:** style, convert content lines to bullets
    let bullets = explicitBullets;
    if (!bullets.length) {
      const derived = [];
      for (const line of lines) {
        if (/^\[.+\]$/.test(line)) continue;            // skip [TAG]
        if (/^Context:/i.test(line)) continue;           // skip Context:
        if (/^use cases?:/i.test(line)) continue;        // skip Use case:
        if (/^(Example|Examples?):?$/i.test(line)) continue; // skip bare "Example:"

        const subHeader = line.match(/^\*\*([^*]+?)\*\*:?\s*(.*)/);
        if (subHeader) {
          const hText = subHeader[1].replace(/:$/, '').trim();
          const rest  = subHeader[2].trim();
          // Only add if not a generic label like "Example"
          if (!/^examples?$/i.test(hText)) {
            derived.push(rest ? `${hText}: ${rest}` : hText);
          }
        } else if (line.length > 3 && !line.startsWith('*')) {
          derived.push(line);
        }
      }
      bullets = derived;
    }

    return { name, tag, context, bullets, usecase, code, _raw: body };
  }).filter(a => a.name || a.bullets.length || a.code);
}

const TAG_COLORS = ['#5ab4ff','#7dd3a8','#f0a05a','#c084fc','#f87171','#facc15'];

function buildRowEl(approach, streaming = false, index = 0) {
  const color = TAG_COLORS[index % TAG_COLORS.length];
  const row = document.createElement('div');
  row.className = 'answer-row' + (streaming ? ' streaming' : '');
  row.style.setProperty('--card-color', color);

  // ── Card header ──────────────────────────────
  const header = document.createElement('div');
  header.className = 'answer-row-header';

  // Number badge
  const num = document.createElement('div');
  num.className = 'approach-num';
  num.textContent = index + 1;
  header.appendChild(num);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'answer-title-wrap';

  if (approach.name) {
    const label = document.createElement('div');
    label.className = 'answer-row-label';
    label.textContent = approach.name;
    titleWrap.appendChild(label);
  }
  if (approach.context) {
    const ctx = document.createElement('div');
    ctx.className = 'answer-row-context';
    ctx.textContent = approach.context;
    titleWrap.appendChild(ctx);
  }
  header.appendChild(titleWrap);

  if (approach.tag) {
    const tag = document.createElement('div');
    tag.className = 'answer-row-tag';
    tag.textContent = approach.tag;
    header.appendChild(tag);
  }

  row.appendChild(header);

  // ── Body: theory + code side by side ─────────
  const body = document.createElement('div');
  body.className = 'answer-row-body';

  // Left: bullets
  const theory = document.createElement('div');
  theory.className = 'row-theory';
  const hasTheory = approach.bullets.length || approach.usecase;

  if (approach.bullets.length) {
    const ul = document.createElement('ul');
    approach.bullets.forEach(b => {
      const li = document.createElement('li');
      li.textContent = b;
      ul.appendChild(li);
    });
    theory.appendChild(ul);
  } else if (!hasTheory) {
    const p = document.createElement('p');
    p.textContent = approach._raw || '';
    theory.appendChild(p);
  }

  if (approach.usecase) {
    const uc = document.createElement('div');
    uc.className = 'row-usecase';
    uc.innerHTML = `<span class="uc-icon">⚡</span><span>${escHtml(approach.usecase)}</span>`;
    theory.appendChild(uc);
  }

  // Right: code panel
  const codePanel = document.createElement('div');
  codePanel.className = 'row-code';

  if (approach.code && hasTheory) {
    const langBar = document.createElement('div');
    langBar.className = 'row-code-lang';
    langBar.innerHTML = `<span class="code-dot"></span>swift`;
    codePanel.appendChild(langBar);
    const pre = document.createElement('pre');
    pre.innerHTML = `<code>${escHtml(approach.code)}</code>`;
    codePanel.appendChild(pre);
  } else if (approach.code && !hasTheory) {
    const p = document.createElement('p');
    p.style.whiteSpace = 'pre-wrap';
    p.textContent = approach.code;
    theory.appendChild(p);
    codePanel.innerHTML = `<div class="no-code">—</div>`;
  } else if (!streaming) {
    codePanel.innerHTML = `<div class="no-code">—</div>`;
  }

  body.appendChild(theory);
  body.appendChild(codePanel);
  row.appendChild(body);
  return row;
}

// Final render — full parsed approaches
function renderAnswer(text) {
  const rowsEl = document.getElementById('answer-rows');
  rowsEl.innerHTML = '';
  const approaches = parseApproaches(text);
  if (!approaches.length) {
    // Fallback: show plain text
    const row = document.createElement('div');
    row.className = 'answer-row';
    row.innerHTML = `<div class="answer-row-body"><div class="row-theory"><p>${escHtml(text.replace(/```[\s\S]*?```/g,'').trim())}</p></div><div class="row-code"><div class="no-code">—</div></div></div>`;
    rowsEl.appendChild(row);
    return;
  }
  approaches.forEach((a, i) => rowsEl.appendChild(buildRowEl(a, false, i)));
}

// Streaming render — progressively build rows as text arrives
function renderStreaming(text) {
  const rowsEl = document.getElementById('answer-rows');

  // Split on --- to get partial blocks
  const blocks = text.split(/\n---+\n?/).map(b => b.trim()).filter(Boolean);
  // Sync DOM rows to block count
  while (rowsEl.children.length > blocks.length) rowsEl.removeChild(rowsEl.lastChild);
  while (rowsEl.children.length < blocks.length) rowsEl.appendChild(document.createElement('div'));

  blocks.forEach((block, i) => {
    const codeMatch = block.match(/```[\w]*\n?([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : '';
    const noCode = block.replace(/```[\s\S]*?```/g, '').trim();
    const nameMatch = noCode.match(/^\*\*(.+?)\*\*/);
    const name = nameMatch ? nameMatch[1].trim() : '';
    const body = noCode.replace(/^\*\*.+?\*\*\n?/, '').trim();
    const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
    const bullets = lines.filter(l => /^[•\-*]/.test(l)).map(l => l.replace(/^[•\-*]\s*/, ''));
    const usecaseLine = lines.find(l => /^use case:/i.test(l));
    const usecase = usecaseLine ? usecaseLine.replace(/^use case:\s*/i, '') : '';

    const approach = { name, bullets, usecase, code, _raw: body };
    const newRow = buildRowEl(approach, true, i);
    rowsEl.replaceChild(newRow, rowsEl.children[i]);
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Settings ──────────────────────────────────────────────────
async function loadSettings() {
  const s = await window.electronAPI.getSettings();
  document.getElementById('groq-key').value           = s.groqKey           || '';
  document.getElementById('openai-key').value         = s.openaiKey         || '';
  document.getElementById('system-prompt').value      = s.systemPrompt      || '';
  document.getElementById('interview-context').value  = s.interviewContext  || '';
  transcModeSel.value = s.transcriptionMode || 'webspeech';
  opacitySlider.value = s.overlayOpacity ?? 92;
  opacityVal.textContent = opacitySlider.value;

  updateTranscModeUI();
  applyOpacity(s.overlayOpacity ?? 92);

  return s;
}

function updateTranscModeUI() {
  // OpenAI key not needed — using local Whisper
  openaiKeyGroup.style.display = 'none';
}

function applyOpacity(val) {
  const pct = Math.max(40, Math.min(98, Number(val)));
  document.querySelectorAll('.panel').forEach(el => {
    el.style.background = `rgba(12, 14, 20, ${pct / 100})`;
  });
}

// ── Trial / License helpers ───────────────────────────────────
async function refreshTrialUI() {
  const t = await window.electronAPI.getTrialStatus();
  const pill = document.getElementById('trial-badge');
  pill.classList.remove('hidden');

  if (t.licensed) {
    pill.textContent = '✦ PRO';
    pill.className = 'trial-pill pro';
    document.getElementById('license-status-text').textContent = 'PrepAura Pro — unlimited access';
    document.getElementById('license-badge').textContent = 'PRO';
    document.getElementById('license-badge').className = 'license-badge pro';
    document.getElementById('license-status-box').className = 'license-status-box pro';
    document.getElementById('upgrade-btn').classList.add('hidden');
    document.getElementById('license-key-row').classList.add('hidden');
  } else if (t.trialExpired) {
    pill.textContent = 'TRIAL ENDED';
    pill.className = 'trial-pill';
    showUpgradeModal();
  } else {
    pill.textContent = `${t.trialRemaining} free left`;
    pill.className = 'trial-pill';
    document.getElementById('license-status-text').textContent = `Trial — ${t.trialRemaining} of 10 questions remaining`;
    document.getElementById('license-key-row').classList.remove('hidden');
  }
}

function showUpgradeModal() {
  document.getElementById('upgrade-modal').classList.remove('hidden');
}

// Activate from settings panel
document.getElementById('activate-btn').addEventListener('click', async () => {
  const key = document.getElementById('license-key-input').value.trim();
  const msg = document.getElementById('license-msg');
  const result = await window.electronAPI.activateLicense(key);
  if (result.isValid) {
    msg.textContent = '✓ License activated! Welcome to PrepAura Pro.';
    msg.className = 'success';
    await refreshTrialUI();
  } else {
    msg.textContent = '✗ Invalid key. Check your purchase email.';
    msg.className = 'error';
  }
});

// Activate from upgrade modal
document.getElementById('modal-activate-btn').addEventListener('click', async () => {
  const key = document.getElementById('modal-license-input').value.trim();
  const msg = document.getElementById('modal-license-msg');
  const result = await window.electronAPI.activateLicense(key);
  if (result.isValid) {
    msg.textContent = '✓ Activated! Welcome to PrepAura Pro.';
    msg.className = 'modal-msg success';
    msg.classList.remove('hidden');
    setTimeout(() => {
      document.getElementById('upgrade-modal').classList.add('hidden');
      refreshTrialUI();
    }, 1500);
  } else {
    msg.textContent = '✗ Invalid key. Check your purchase email and try again.';
    msg.className = 'modal-msg error';
    msg.classList.remove('hidden');
  }
});

document.getElementById('upgrade-btn').addEventListener('click', showUpgradeModal);

// ── Status display with auto-prompt on first launch ───────────
async function init() {
  const s = await loadSettings();
  if (!s.groqKey) {
    openSettings();
    setStatus('error', 'Setup required');
    document.getElementById('welcome-banner').classList.remove('hidden');
  } else {
    setStatus('ready', 'Ready');
  }
  await refreshTrialUI();

  // Auto-detect BlackHole and update dropdown
  const blackhole = await findBlackHoleDevice();
  const sysOption = audioSourceSel.querySelector('option[value="system"]');
  if (blackhole) {
    sysOption.textContent = '🎙+🔊 Mic + BlackHole (both voices)';
  } else {
    sysOption.textContent = '🎙+🔊 Mic + System (install BlackHole)';
    sysOption.disabled = true;
  }
}

// ── Settings panel ────────────────────────────────────────────
function openSettings() {
  loadSettings();
  settingsPanel.classList.remove('hidden');
  overlay.classList.add('hidden');
}

function closeSettings() {
  settingsPanel.classList.add('hidden');
  overlay.classList.remove('hidden');
}

settingsOpenBtn.addEventListener('click', openSettings);
closeSettingsBtn.addEventListener('click', closeSettings);

transcModeSel.addEventListener('change', updateTranscModeUI);

opacitySlider.addEventListener('input', () => {
  opacityVal.textContent = opacitySlider.value;
  applyOpacity(opacitySlider.value);
});

saveSettingsBtn.addEventListener('click', async () => {
  const result = await window.electronAPI.saveSettings({
    groqKey: document.getElementById('groq-key').value.trim(),
    openaiKey: document.getElementById('openai-key').value.trim(),
    systemPrompt: document.getElementById('system-prompt').value.trim(),
    interviewContext: document.getElementById('interview-context').value.trim(),
    transcriptionMode: transcModeSel.value,
    overlayOpacity: Number(opacitySlider.value),
  });
  if (result.success) {
    document.getElementById('welcome-banner').classList.add('hidden');
    closeSettings();
    setStatus('ready', 'Settings saved');
  }
});

document.getElementById('setup-audio-btn').addEventListener('click', async () => {
  const btn = document.getElementById('setup-audio-btn');
  const statusEl = document.getElementById('setup-audio-status');
  btn.disabled = true;
  btn.textContent = 'Setting up...';
  const result = await window.electronAPI.setupAudio();
  btn.disabled = false;
  btn.textContent = 'Auto Setup Multi-Output Device';
  if (result.success) {
    statusEl.textContent = 'Done! Multi-Output Device is active — both voices will be captured.';
    statusEl.style.color = '#4ade80';
  } else {
    statusEl.textContent = 'Failed: ' + result.message;
    statusEl.style.color = '#f87171';
  }
});

// ── Audio: start listening ────────────────────────────────────
async function startListening() {
  const settings = await window.electronAPI.getSettings();

  if (settings.transcriptionMode === 'webspeech') {
    startWebSpeech();
  } else {
    await startWhisperMode();
  }
}

// ── Web Speech API mode (free, real-time) ─────────────────────
function startWebSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    alert('Web Speech API not supported in this browser/OS. Use Whisper mode instead.');
    return;
  }

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  let finalTranscript = '';
  let silenceTimer = null;

  recognition.onstart = () => {
    setStatus('listen', 'Listening...');
    isListening = true;
    listenBtn.textContent = '⏹ Stop Listening';
    listenBtn.classList.add('active');
    questionText.textContent = '';
    questionText.classList.remove('muted');
    interimBadge.classList.remove('hidden');
  };

  recognition.onresult = (event) => {
    let interim = '';
    finalTranscript = '';

    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) {
        finalTranscript += res[0].transcript + ' ';
      } else {
        interim += res[0].transcript;
      }
    }

    questionText.textContent = (finalTranscript + interim).trim() || 'Listening...';
    scrollToBottom();

    // Auto-send after 2s of silence following final transcript
    clearTimeout(silenceTimer);
    if (finalTranscript.trim().length > 4) {
      silenceTimer = setTimeout(() => {
        const question = finalTranscript.trim();
        if (question) {
          recognition.stop(); // will trigger onend which restarts
          processQuestion(question);
        }
      }, 2000);
    }
  };

  recognition.onerror = (e) => {
    if (e.error === 'no-speech') return; // benign
    console.error('Speech recognition error:', e.error);
    if (e.error === 'not-allowed') {
      setStatus('error', 'Mic permission denied');
      stopListening();
    }
  };

  recognition.onend = () => {
    interimBadge.classList.add('hidden');
    if (isListening) {
      // Auto-restart to keep continuous listening
      try { recognition.start(); } catch (_) {}
    }
  };

  recognition.start();
}

// ── Detect BlackHole virtual audio device ──────────────────────
async function findBlackHoleDevice() {
  // Device labels are empty until mic permission is granted — request it first
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch (_) {}
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.find(d => d.kind === 'audioinput' && d.label.toLowerCase().includes('blackhole'));
}

// ── Mix mic + BlackHole into a single stream ───────────────────
async function getMixedStream(blackholeDevice) {
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
  });

  let blackholeStream = null;
  try {
    blackholeStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: blackholeDevice.deviceId }, echoCancellation: false, noiseSuppression: false }
    });
  } catch (e) {
    console.warn('BlackHole stream failed, mic only:', e.message);
    return micStream;
  }

  const mixCtx = new AudioContext({ sampleRate: 16000 });
  const dest = mixCtx.createMediaStreamDestination();
  mixCtx.createMediaStreamSource(micStream).connect(dest);
  mixCtx.createMediaStreamSource(blackholeStream).connect(dest);

  // Tag for cleanup
  dest.stream._mixCtx = mixCtx;
  dest.stream._rawTracks = [...micStream.getTracks(), ...blackholeStream.getTracks()];
  return dest.stream;
}

// ── Whisper mode (MediaRecorder + local Whisper) ───────────────
async function startWhisperMode() {
  try {
    let stream;
    const blackhole = await findBlackHoleDevice();

    if (blackhole) {
      setStatus('listen', 'Mixing mic + BlackHole...');
      stream = await getMixedStream(blackhole);
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
      });
    }

    if (!stream) throw new Error('Could not get audio stream');
    audioStream = stream;

    // ── Voice activity detection via Web Audio analyser ───────
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    let speechFrameCount = 0; // frames above threshold in current chunk
    const volumePoller = setInterval(() => {
      analyser.getByteFrequencyData(freqData);
      const rms = Math.sqrt(freqData.reduce((s, v) => s + v * v, 0) / freqData.length);
      if (rms > 30) speechFrameCount++; // ~30 = ignores background noise/breathing
    }, 100);
    audioStream._cleanup = () => { clearInterval(volumePoller); audioContext.close(); };

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      const frames = speechFrameCount;
      speechFrameCount = 0; // reset for next chunk

      // Require at least 1.5s of actual speech (15 frames × 100ms) before transcribing
      if (audioChunks.length && frames >= 15) {
        const blob = new Blob(audioChunks, { type: mimeType });
        audioChunks = [];
        if (blob.size > 2000) {
          await processAudioBlob(blob);
        }
      } else {
        audioChunks = [];
      }

      // Brief cooldown so room noise after the answer isn't captured
      if (isListening) {
        await new Promise(r => setTimeout(r, 2000));
        if (isListening) {
          mediaRecorder.start();
          scheduleNextChunk();
        }
      }
    };

    mediaRecorder.start();
    isListening = true;
    listenBtn.textContent = '⏹ Stop Listening';
    listenBtn.classList.add('active');
    setStatus('listen', 'Recording...');

    scheduleNextChunk();

  } catch (err) {
    console.error('Whisper mode error:', err);
    setStatus('error', 'Audio error: ' + err.message);
    alert('Could not start audio capture: ' + err.message);
  }
}

async function captureSystemAudio() {
  try {
    const sources = await window.electronAPI.getDesktopSources();
    const screenId = sources[0]?.id;
    if (!screenId) throw new Error('No screen source found');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenId,
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenId,
          maxWidth: 1, maxHeight: 1, minWidth: 1, minHeight: 1,
        }
      }
    });
    // Drop video tracks, keep audio only
    stream.getVideoTracks().forEach(t => t.stop());
    return stream;
  } catch (e) {
    console.warn('System audio failed, falling back to mic:', e.message);
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

function scheduleNextChunk() {
  clearTimeout(processingChunkTimer);
  processingChunkTimer = setTimeout(() => {
    if (isListening && mediaRecorder?.state === 'recording') {
      mediaRecorder.stop();
    }
  }, 7000);
}

async function processAudioBlob(blob) {
  setStatus('process', 'Transcribing...');

  const arrayBuffer = await blob.arrayBuffer();
  const result = await window.electronAPI.transcribeAudio(Array.from(new Uint8Array(arrayBuffer)));

  if (result.error) {
    setStatus('error', 'Transcription failed');
    if (isListening) setStatus('listen', 'Recording...');
    return;
  }

  const text = result.text?.trim();
  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
  if (!text || wordCount < 4) {
    // Too short — likely silence, noise, or Whisper hallucination
    if (isListening) setStatus('listen', 'Recording...');
    return;
  }

  questionText.textContent = text;
  questionText.classList.remove('muted');
  await processQuestion(text);
}

// ── Stop listening ────────────────────────────────────────────
function stopListening() {
  isListening = false;
  clearTimeout(processingChunkTimer);

  if (recognition) {
    try { recognition.stop(); } catch (_) {}
    recognition = null;
  }

  if (mediaRecorder?.state === 'recording') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  mediaRecorder = null;

  if (audioStream) {
    audioStream._cleanup?.();
    audioStream._mixCtx?.close();
    audioStream._rawTracks?.forEach(t => t.stop());
    audioStream.getTracks().forEach(t => t.stop());
    audioStream = null;
  }

  listenBtn.textContent = '🎤 Start Listening';
  listenBtn.classList.remove('active');
  interimBadge.classList.add('hidden');
  setStatus('ready', 'Ready');
}

// ── Process question → AI response ───────────────────────────
async function processQuestion(question) {
  if (!question.trim()) return;

  questionText.textContent = question;
  questionText.classList.remove('muted');
  clearAnswerUI();
  setStatus('process', 'Thinking...');

  // Add to conversation history context (last 6 turns for context)
  const historyContext = conversationHistory.slice(-12);

  let fullAnswer = '';

  window.electronAPI.onStreamChunk((chunk) => {
    if (chunk.trialExpired) {
      setStatus('error', 'Trial ended');
      showUpgradeModal();
      return;
    }
    if (chunk.error) {
      const rowsEl = document.getElementById('answer-rows');
      rowsEl.innerHTML = `<div class="answer-row"><div class="answer-row-body"><div class="row-theory"><p>⚠ ${escHtml(chunk.error)}</p></div><div class="row-code"></div></div></div>`;
      setStatus('error', 'Error');
      if (isListening) setTimeout(() => setStatus('listen', 'Listening...'), 2000);
      return;
    }
    if (chunk.done) {
      // Save to history
      currentEntry = { question, answer: fullAnswer };
      conversationHistory.push({ role: 'user', content: question });
      conversationHistory.push({ role: 'assistant', content: fullAnswer });
      historyIndex = conversationHistory.length / 2 - 1;
      updateHistoryNav();

      // Final structured render
      renderAnswer(fullAnswer);
      scrollToBottom();
      refreshTrialUI();

      if (isListening) setStatus('listen', 'Listening...');
      else setStatus('ready', 'Ready');
      return;
    }
    if (chunk.text) {
      fullAnswer += chunk.text;
      renderStreaming(fullAnswer);
      scrollToBottom();
    }
  });

  await window.electronAPI.streamAIResponse({
    transcript: question,
    history: historyContext,
  });
}

// ── Conversation history navigation ──────────────────────────
function updateHistoryNav() {
  const pairs = Math.floor(conversationHistory.length / 2);
  histLabel.textContent = pairs > 0 ? `${pairs} Q&A` : '—';
  histPrev.disabled = pairs <= 1;
  histNext.disabled = true; // at latest
}

histPrev.addEventListener('click', () => {
  const pairs = conversationHistory.length / 2;
  if (historyIndex > 0) {
    historyIndex--;
    const q = conversationHistory[historyIndex * 2].content;
    const a = conversationHistory[historyIndex * 2 + 1].content;
    questionText.textContent = q;
    renderAnswer(a);
    histNext.disabled = false;
    histPrev.disabled = historyIndex <= 0;
    histLabel.textContent = `${historyIndex + 1}/${pairs}`;
  }
});

histNext.addEventListener('click', () => {
  const pairs = conversationHistory.length / 2;
  if (historyIndex < pairs - 1) {
    historyIndex++;
    const q = conversationHistory[historyIndex * 2].content;
    const a = conversationHistory[historyIndex * 2 + 1].content;
    questionText.textContent = q;
    renderAnswer(a);
    histNext.disabled = historyIndex >= pairs - 1;
    histPrev.disabled = historyIndex <= 0;
    histLabel.textContent = `${historyIndex + 1}/${pairs}`;
  }
});

// ── Text input ────────────────────────────────────────────────
const textInput = document.getElementById('text-question-input');
const textSendBtn = document.getElementById('text-send-btn');

function submitTextQuestion() {
  const question = textInput.value.trim();
  if (!question) return;
  textInput.value = '';
  processQuestion(question);
}

textSendBtn.addEventListener('click', submitTextQuestion);
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submitTextQuestion();
  }
});

// ── Controls ──────────────────────────────────────────────────
listenBtn.addEventListener('click', () => {
  if (isListening) stopListening();
  else startListening();
});

clearBtn.addEventListener('click', () => {
  stopListening();
  questionText.textContent = 'Start listening to capture a question...';
  questionText.classList.add('muted');
  clearAnswerUI();
  conversationHistory = [];
  historyIndex = -1;
  updateHistoryNav();
  setStatus('ready', 'Ready');
});

compactBtn.addEventListener('click', () => {
  document.body.classList.toggle('compact');
});

// Toggle compact via global shortcut
window.electronAPI.onToggleCompact(() => {
  document.body.classList.toggle('compact');
});

// ── Screen capture & solve ────────────────────────────────────
async function captureAndSolve() {
  const captureBtn = document.getElementById('capture-btn');
  captureBtn.classList.add('scanning');
  captureBtn.title = 'Capturing…';

  questionText.textContent = 'Reading screen…';
  questionText.classList.remove('muted');
  clearAnswerUI();
  setStatus('process', 'Scanning screen...');

  let fullAnswer = '';

  // Timeout fallback — if no response in 20s show error
  const timeout = setTimeout(() => {
    setStatus('error', 'Screen scan timed out');
    questionText.textContent = 'Could not read screen. Make sure Screen Recording permission is granted.';
    captureBtn.classList.remove('scanning');
    captureBtn.title = 'Capture screen & solve (⌘⇧C)';
  }, 30000);

  window.electronAPI.onStreamChunk((chunk) => {
    if (chunk.trialExpired) {
      clearTimeout(timeout);
      captureBtn.classList.remove('scanning');
      captureBtn.title = 'Capture screen & solve (⌘⇧C)';
      showUpgradeModal();
      return;
    }
    if (chunk.error) {
      clearTimeout(timeout);
      document.getElementById('answer-rows').innerHTML =
        `<div class="answer-row"><div class="answer-row-body"><div class="row-theory"><p>⚠ ${escHtml(chunk.error)}</p></div><div class="row-code"></div></div></div>`;
      setStatus('error', 'Error');
      captureBtn.classList.remove('scanning');
      captureBtn.title = 'Capture screen & solve (⌘⇧C)';
      return;
    }
    if (chunk.done) {
      clearTimeout(timeout);
      renderAnswer(fullAnswer);
      questionText.textContent = 'Solved from screen capture';
      conversationHistory.push({ role: 'user', content: '[Screen capture — coding problem]' });
      conversationHistory.push({ role: 'assistant', content: fullAnswer });
      historyIndex = conversationHistory.length / 2 - 1;
      updateHistoryNav();
      scrollToBottom();
      setStatus('ready', 'Ready');
      captureBtn.classList.remove('scanning');
      captureBtn.title = 'Capture screen & solve (⌘⇧C)';
      return;
    }
    if (chunk.text) {
      clearTimeout(timeout);
      setStatus('process', 'Analysing...');
      fullAnswer += chunk.text;
      renderStreaming(fullAnswer);
      scrollToBottom();
    }
  });

  const language = document.getElementById('lang-select').value;
  await window.electronAPI.solveFromScreen({ language });
}

document.getElementById('capture-btn').addEventListener('click', captureAndSolve);
window.electronAPI.onTriggerCapture(captureAndSolve);

// Persist language selection
const langSelect = document.getElementById('lang-select');
const savedLang = localStorage.getItem('solveLang');
if (savedLang) langSelect.value = savedLang;
langSelect.addEventListener('change', () => localStorage.setItem('solveLang', langSelect.value));

// ── Boot ──────────────────────────────────────────────────────
init();
