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

// ── Platform detection ────────────────────────────────────────
const isMac = navigator.platform.toLowerCase().startsWith('mac');
const captureShortcut = isMac ? '⌘⇧C' : 'Ctrl+Shift+C';

// Apply platform-correct labels on page load
document.getElementById('capture-btn').title = `Capture screen & solve (${captureShortcut})`;

// ── Quit button ───────────────────────────────────────────────
document.getElementById('close-app-btn').addEventListener('click', () => {
  window.electronAPI.quitApp();
});

// ── Click-through for transparent areas ──────────────────────
// When the cursor is over the solid UI panel, receive mouse events normally.
// When it moves into the transparent gap around the panel, forward events
// to whatever window sits below so other apps remain clickable.
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const overUI = el && (el.closest('.panel') || el.closest('#upgrade-modal'));
  window.electronAPI.setIgnoreMouseEvents(!overUI, { forward: true });
});
if (!isMac) {
  const kbdEls = document.querySelectorAll('.shortcuts-info .shortcut kbd');
  if (kbdEls[0]) kbdEls[0].textContent = 'Ctrl+Shift+Space';
  if (kbdEls[1]) kbdEls[1].textContent = 'Ctrl+Shift+A';
  if (kbdEls[2]) kbdEls[2].textContent = 'Ctrl+Shift+C';
}

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
// ── Interview response parser ──────────────────────────────────
function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function parseInterviewResponse(text) {
  if (!text) return null;
  const result = { answer: '', keyPoints: [], followUps: [], code: '' };

  // Extract code block first
  const codeMatch = text.match(/```[\w]*\n?([\s\S]*?)```/);
  if (codeMatch) {
    result.code = codeMatch[1].trim();
    text = text.replace(/```[\s\S]*?```/, '').trim();
  }

  const answerMatch = text.match(/🎯\s*Interview Answer\s*\n([\s\S]*?)(?=💡|🔥|$)/);
  if (answerMatch) result.answer = answerMatch[1].trim();

  const keyPointsMatch = text.match(/💡\s*Key Points\s*\n([\s\S]*?)(?=🔥|$)/);
  if (keyPointsMatch) {
    result.keyPoints = keyPointsMatch[1]
      .split('\n').map(l => l.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);
  }

  const followUpMatch = text.match(/🔥\s*Follow-up Questions\s*\n([\s\S]*?)$/);
  if (followUpMatch) {
    result.followUps = followUpMatch[1]
      .split('\n').map(l => l.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean)
      .map(l => {
        const sep = l.indexOf(' → ');
        return sep !== -1
          ? { q: l.slice(0, sep).trim(), hint: l.slice(sep + 3).trim() }
          : { q: l, hint: '' };
      });
  }

  // Fallback: treat entire text as answer if no sections found
  if (!result.answer && !result.keyPoints.length) {
    result.answer = text.replace(/```[\s\S]*?```/g, '').trim();
  }

  return result;
}

function buildInterviewEl(parsed, streaming = false) {
  const container = document.createElement('div');
  container.className = 'interview-response' + (streaming ? ' streaming' : '');

  const wc = wordCount(parsed.answer);
  const isLong = wc > 120;

  // 🎯 Spoken answer block
  if (parsed.answer) {
    const answerBlock = document.createElement('div');
    answerBlock.className = 'spoken-answer-block';

    const label = document.createElement('div');
    label.className = 'ir-label';
    label.textContent = '🎯 Interview Answer';
    answerBlock.appendChild(label);

    const answerEl = document.createElement('div');
    answerEl.className = 'spoken-answer';
    answerEl.textContent = parsed.answer;
    answerBlock.appendChild(answerEl);

    if (!streaming && wc > 0) {
      const wEl = document.createElement('div');
      wEl.className = 'word-count';
      wEl.textContent = `${wc} words`;
      answerBlock.appendChild(wEl);
    }

    container.appendChild(answerBlock);
  }

  // Details panel (key points + follow-ups + code)
  const details = document.createElement('div');
  details.className = 'answer-details' + (isLong && !streaming ? ' hidden' : '');

  if (parsed.keyPoints.length) {
    const kpSection = document.createElement('div');
    kpSection.className = 'ir-section';
    const kpLabel = document.createElement('div');
    kpLabel.className = 'ir-label';
    kpLabel.textContent = '💡 Key Points';
    kpSection.appendChild(kpLabel);
    const ul = document.createElement('ul');
    ul.className = 'ir-bullets';
    parsed.keyPoints.forEach(pt => {
      const li = document.createElement('li');
      li.textContent = pt;
      ul.appendChild(li);
    });
    kpSection.appendChild(ul);
    details.appendChild(kpSection);
  }

  if (parsed.followUps.length) {
    const fuSection = document.createElement('div');
    fuSection.className = 'ir-section';
    const fuLabel = document.createElement('div');
    fuLabel.className = 'ir-label';
    fuLabel.textContent = '🔥 Follow-up Questions';
    fuSection.appendChild(fuLabel);
    const ul = document.createElement('ul');
    ul.className = 'ir-bullets followup';
    parsed.followUps.forEach(({ q, hint }) => {
      const li = document.createElement('li');
      const qEl = document.createElement('span');
      qEl.className = 'fu-question';
      qEl.textContent = q;
      li.appendChild(qEl);
      if (hint) {
        const hEl = document.createElement('span');
        hEl.className = 'fu-hint';
        hEl.textContent = hint;
        li.appendChild(hEl);
      }
      ul.appendChild(li);
    });
    fuSection.appendChild(ul);
    details.appendChild(fuSection);
  }

  if (parsed.code) {
    const codeSection = document.createElement('div');
    codeSection.className = 'ir-code-section';
    const pre = document.createElement('pre');
    pre.className = 'ir-code';
    pre.innerHTML = `<code>${escHtml(parsed.code)}</code>`;
    codeSection.appendChild(pre);
    details.appendChild(codeSection);
  }

  container.appendChild(details);

  // Expand button — only when answer is long and not streaming
  if (isLong && !streaming && (parsed.keyPoints.length || parsed.followUps.length || parsed.code)) {
    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-btn';
    expandBtn.textContent = 'Expand Details ▾';
    expandBtn.addEventListener('click', () => {
      const hidden = details.classList.toggle('hidden');
      expandBtn.textContent = hidden ? 'Expand Details ▾' : 'Collapse ▴';
    });
    container.appendChild(expandBtn);
  }

  return container;
}

// Final render — full parsed interview response
function renderAnswer(text) {
  const rowsEl = document.getElementById('answer-rows');
  rowsEl.innerHTML = '';
  const parsed = parseInterviewResponse(text);
  if (!parsed || (!parsed.answer && !parsed.keyPoints.length && !parsed.code)) {
    const fallback = document.createElement('div');
    fallback.className = 'interview-response';
    fallback.innerHTML = `<div class="spoken-answer-block"><div class="spoken-answer">${escHtml(text.replace(/```[\s\S]*?```/g,'').trim())}</div></div>`;
    rowsEl.appendChild(fallback);
    return;
  }
  rowsEl.appendChild(buildInterviewEl(parsed, false));
}

// Streaming render — show as text arrives
function renderStreaming(text) {
  const rowsEl = document.getElementById('answer-rows');
  rowsEl.innerHTML = '';
  const parsed = parseInterviewResponse(text) ||
    { answer: text.replace(/```[\s\S]*?```/g, '').trim(), keyPoints: [], followUps: [], code: '' };
  rowsEl.appendChild(buildInterviewEl(parsed, true));
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

  // Auto-detect virtual loopback device and update dropdown
  const blackhole = await findBlackHoleDevice();
  const sysOption = audioSourceSel.querySelector('option[value="system"]');
  if (blackhole) {
    const l = blackhole.label.toLowerCase();
    const isVbAudio = l.includes('cable') || l.includes('voicemeeter') || l.includes('vb-audio');
    sysOption.textContent = isVbAudio
      ? '🎙+🔊 Mic + VB-Audio Cable (both voices)'
      : '🎙+🔊 Mic + BlackHole (both voices)';
  } else {
    sysOption.textContent = isMac
      ? '🎙+🔊 Mic + System (install BlackHole)'
      : '🎙+🔊 Mic + System (install VB-Audio Cable)';
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

// ── Detect virtual audio loopback device (BlackHole on macOS, VB-Audio on Windows) ─
async function findBlackHoleDevice() {
  // Device labels are empty until mic permission is granted — request it first
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ audio: true });
    tmp.getTracks().forEach(t => t.stop());
  } catch (_) {}
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.find(d => {
    if (d.kind !== 'audioinput') return false;
    const l = d.label.toLowerCase();
    return l.includes('blackhole') || l.includes('cable output') || l.includes('voicemeeter') || l.includes('vb-audio');
  });
}

// ── Mix mic + BlackHole into a single stream ───────────────────
async function getMixedStream(blackholeDevice) {
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true }
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

  const mixCtx = new AudioContext();
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
        audio: { echoCancellation: true, noiseSuppression: true }
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
      rowsEl.innerHTML = `<div class="interview-response"><div class="spoken-answer-block"><div class="spoken-answer">⚠ ${escHtml(chunk.error)}</div></div></div>`;
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
    captureBtn.title = `Capture screen & solve (${captureShortcut})`;
  }, 30000);

  window.electronAPI.onStreamChunk((chunk) => {
    if (chunk.trialExpired) {
      clearTimeout(timeout);
      captureBtn.classList.remove('scanning');
      captureBtn.title = `Capture screen & solve (${captureShortcut})`;
      showUpgradeModal();
      return;
    }
    if (chunk.error) {
      clearTimeout(timeout);
      document.getElementById('answer-rows').innerHTML =
        `<div class="interview-response"><div class="spoken-answer-block"><div class="spoken-answer">⚠ ${escHtml(chunk.error)}</div></div></div>`;
      setStatus('error', 'Error');
      captureBtn.classList.remove('scanning');
      captureBtn.title = `Capture screen & solve (${captureShortcut})`;
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
      captureBtn.title = `Capture screen & solve (${captureShortcut})`;
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
