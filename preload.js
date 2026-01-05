const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // License management
  checkLicense: () => ipcRenderer.invoke("check-license"),

  // MediaMTX control
  // controlMediaMTX: (action) => ipcRenderer.invoke("control-mediamtx", action),
  // getMediaMTXStatus: () => ipcRenderer.invoke("control-mediamtx", "status"),

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
});
