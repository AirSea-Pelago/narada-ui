const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // License management
  checkLicense: () => ipcRenderer.invoke("check-license"),

  // MediaMTX control
  controlMediaMTX: (action) => ipcRenderer.invoke("control-mediamtx", action),
  getMediaMTXStatus: () => ipcRenderer.invoke("control-mediamtx", "status"),

  // Stream management
  getStreamUrl: (streamName) =>
    ipcRenderer.invoke("get-stream-url", streamName),
  testStream: (url) => ipcRenderer.invoke("test-stream", url),
  saveStreamConfig: (config) =>
    ipcRenderer.invoke("save-stream-config", config),
  loadStreamConfig: () => ipcRenderer.invoke("load-stream-config"),

  // System info
  getSystemInfo: () => ipcRenderer.invoke("get-system-info"),

  // Asset path resolver
  getAssetPath: (assetName) => ipcRenderer.invoke("get-asset-path", assetName),

  // Event listeners
  onLicenseStatus: (callback) => {
    ipcRenderer.on("license-status", (event, status) => callback(status));
  },
  onMediaMTXStatus: (callback) => {
    ipcRenderer.on("mediamtx-status", (event, status) => callback(status));
  },
  onOpenStreamDialog: (callback) => {
    ipcRenderer.on("open-stream-dialog", () => callback());
  },
  onLoadDefaultStreams: (callback) => {
    ipcRenderer.on("load-default-streams", () => callback());
  },
  onQuickConnect: (callback) => {
    ipcRenderer.on("quick-connect", () => callback());
  },
  onStartAllStreams: (callback) => {
    ipcRenderer.on("start-all-streams", () => callback());
  },
  onStopAllStreams: (callback) => {
    ipcRenderer.on("stop-all-streams", () => callback());
  },

    // =============================================================================
  // CROWD COUNTER APIs (NEW)
  // =============================================================================

  // Crowd Counter Control
  startCrowdCounter:  (config) => ipcRenderer.invoke("start-crowd-counter", config),
  stopCrowdCounter: () => ipcRenderer.invoke("stop-crowd-counter"),
  getCrowdCounterStatus: () => ipcRenderer.invoke("get-crowd-counter-status"),

  // Preset Management
  getBuiltinPresets: () => ipcRenderer.invoke("get-builtin-presets"),
  loadUserPresets: () => ipcRenderer.invoke("load-user-presets"),
  saveUserPreset: (preset) => ipcRenderer.invoke("save-user-preset", preset),
  deleteUserPreset: (presetId) => ipcRenderer.invoke("delete-user-preset", presetId),
  getLastUsedPreset: () => ipcRenderer.invoke("get-last-used-preset"),
  setLastUsedPreset: (presetId) => ipcRenderer.invoke("set-last-used-preset", presetId),

  // Crowd Counter Event Listeners
  onCrowdCounterStatus: (callback) => {
    ipcRenderer.on("crowd-counter-status", (event, status) => callback(status));
  },
  onCrowdCounterStats:  (callback) => {
    ipcRenderer.on("crowd-counter-stats", (event, stats) => callback(stats));
  },
  
});
