const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  // Audio sources
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),

  // Transcription
  transcribeAudio: (audioData) => ipcRenderer.invoke('transcribe-audio', audioData),

  // AI response streaming
  streamAIResponse: (data) => ipcRenderer.invoke('stream-ai-response', data),
  onStreamChunk: (cb) => {
    ipcRenderer.removeAllListeners('stream-chunk');
    ipcRenderer.on('stream-chunk', (_, data) => cb(data));
  },
  removeStreamListener: () => ipcRenderer.removeAllListeners('stream-chunk'),

  // Audio setup
  setupAudio: () => ipcRenderer.invoke('setup-audio'),

  // Screen capture & solve
  solveFromScreen: (opts) => ipcRenderer.invoke('solve-from-screen', opts),

  // Window events
  onToggleCompact: (cb) => ipcRenderer.on('toggle-compact', () => cb()),
  onTriggerCapture: (cb) => ipcRenderer.on('trigger-capture', () => cb()),

  // License / Trial
  getTrialStatus:    ()    => ipcRenderer.invoke('get-trial-status'),
  activateLicense:   (key) => ipcRenderer.invoke('activate-license', key),
});
