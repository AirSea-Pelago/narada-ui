const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");
const path = require("path");
const { spawn, exec } = require("child_process");
const fs = require("fs");
const os = require("os");

let mainWindow;
let licenseCheckInterval;
let mediamtxProcess = null;
let currentLicense = null;

// Get MediaMTX path based on platform
function getMediaMTXPath() {
  const appPath = app.isPackaged ? process.resourcesPath : __dirname;

  let mediamtxDir, mediamtxExe;

  if (process.platform === "win32") {
    mediamtxDir = path.join(appPath, "mediamtx");
    mediamtxExe = path.join(mediamtxDir, "mediamtx.exe");
  } else if (process.platform === "darwin") {
    mediamtxDir = path.join(appPath, "mediamtx");
    mediamtxExe = path.join(mediamtxDir, "mediamtx");
  } else {
    mediamtxDir = path.join(appPath, "mediamtx");
    mediamtxExe = path.join(mediamtxDir, "mediamtx");
  }

  return { mediamtxDir, mediamtxExe };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
    autoHideMenuBar: true,
    resizable: true,
    backgroundColor: "#0f172a",
    show: false,
    icon: path.join(__dirname, "assets/icon.ico"),
  });

  mainWindow.loadFile("renderer/index.html");
  mainWindow.webContents.openDevTools();

  mainWindow.once("ready-to-show", () => {
    console.log("[Main] Window ready to show");
    mainWindow.show();

    mainWindow.webContents.on("did-finish-load", () => {
      console.log("[Main] Renderer finished loading");
      setTimeout(() => {
        checkLicenseAndStartMediaMTX();
      }, 500);
    });

    licenseCheckInterval = setInterval(() => {
      checkLicense();
    }, 180000);
  });

  createMenu();

  mainWindow.on("closed", () => {
    clearInterval(licenseCheckInterval);
    stopMediaMTX();
    mainWindow = null;
  });
}

function createMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Add Stream",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send("open-stream-dialog");
            }
          },
        },
        {
          label: "Refresh License",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            checkLicense();
          },
        },
        { type: "separator" },
        {
          label: "Exit",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Stream",
      submenu: [
        {
          label: "Quick Connect",
          accelerator: "CmdOrCtrl+K",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send("quick-connect");
            }
          },
        },
        {
          label: "Start All Streams",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send("start-all-streams");
            }
          },
        },
        {
          label: "Stop All Streams",
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send("stop-all-streams");
            }
          },
        },
      ],
    },
    {
      label: "MediaMTX",
      submenu: [
        {
          label: "Restart Server",
          click: () => {
            restartMediaMTX();
          },
        },
        {
          label: "Stop Server",
          click: () => {
            stopMediaMTX();
          },
        },
        {
          label: "Check Status",
          click: () => {
            checkMediaMTXStatus();
          },
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: () => {
            require("electron").shell.openExternal(
              "https://github.com/bluenviron/mediamtx"
            );
          },
        },
        {
          label: "View Logs",
          click: () => {
            showMediaMTXLogs();
          },
        },
        {
          label: "About",
          click: () => {
            showAboutDialog();
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function checkLicenseAndStartMediaMTX() {
  console.log("[Main] Starting license check...");
  const pythonScript = path.join(__dirname, "license-checker.py");

  try {
    const python = spawn("python", [pythonScript]);

    let dataString = "";
    let errorString = "";

    python.stdout.on("data", (data) => {
      dataString += data.toString();
      console.log(`[Main] Python Output: ${data}`);
    });

    python.stderr.on("data", (data) => {
      errorString += data.toString();
      console.error(`[Main] Python Error: ${data}`);
    });

    python.on("close", (code) => {
      console.log(`[Main] Python process closed with code ${code}`);

      try {
        const jsonStart = dataString.indexOf("{");
        if (jsonStart > 0) {
          dataString = dataString.substring(jsonStart);
        }

        const result = JSON.parse(dataString.trim());
        currentLicense = result;

        console.log("[Main] License check result:", result);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("license-status", result);
        }

        if (result.valid) {
          // Lisensi valid, start MediaMTX dari aplikasi
          startMediaMTX();

          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("load-default-streams");
            }
          }, 2000);
        } else {
          console.warn("[Main] License invalid, MediaMTX not started");
        }
      } catch (error) {
        console.error("[Main] Error parsing license result:", error);
        console.error("[Main] Raw output:", dataString);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("license-status", {
            valid: false,
            message: "Error checking license: " + error.message,
          });
        }
      }
    });

    python.on("error", (error) => {
      console.error("[Main] Python process error:", error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("license-status", {
          valid: false,
          message: "Failed to start Python: " + error.message,
        });
      }
    });
  } catch (error) {
    console.error("[Main] Failed to start license check:", error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("license-status", {
        valid: false,
        message: "Failed to start license check: " + error.message,
      });
    }
  }
}

function startMediaMTX() {
  console.log("[Main] Starting MediaMTX from application...");

  const { mediamtxDir, mediamtxExe } = getMediaMTXPath();
  const configPath = path.join(mediamtxDir, "mediamtx.yml");

  // Check if MediaMTX exists
  if (!fs.existsSync(mediamtxExe)) {
    console.error(`[Main] MediaMTX not found at: ${mediamtxExe}`);

    // Create default config if not exists
    if (!fs.existsSync(configPath)) {
      const defaultConfig = `# MediaMTX Configuration
paths:
  all:
    source: publisher
    sourceOnDemand: yes`;

      fs.writeFileSync(configPath, defaultConfig);
      console.log(`[Main] Created default config at: ${configPath}`);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mediamtx-status", {
        running: false,
        error: true,
        message: `MediaMTX executable not found. Please install MediaMTX to: ${mediamtxDir}`,
      });
    }
    return;
  }

  try {
    // Start MediaMTX
    mediamtxProcess = spawn(mediamtxExe, [configPath], {
      cwd: mediamtxDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    console.log(`[Main] MediaMTX started with PID: ${mediamtxProcess.pid}`);

    mediamtxProcess.stdout.on("data", (data) => {
      console.log(`[MediaMTX] ${data.toString()}`);
    });

    mediamtxProcess.stderr.on("data", (data) => {
      console.error(`[MediaMTX Error] ${data.toString()}`);
    });

    mediamtxProcess.on("close", (code) => {
      console.log(`[Main] MediaMTX process exited with code ${code}`);
      mediamtxProcess = null;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("mediamtx-status", {
          running: false,
          error: code !== 0,
          message: `MediaMTX stopped with code ${code}`,
        });
      }
    });

    mediamtxProcess.on("error", (error) => {
      console.error("[Main] Failed to start MediaMTX:", error);
      mediamtxProcess = null;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("mediamtx-status", {
          running: false,
          error: true,
          message: `Failed to start MediaMTX: ${error.message}`,
        });
      }
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mediamtx-status", {
        running: true,
        pid: mediamtxProcess.pid,
        message: "MediaMTX is running",
      });
    }
  } catch (error) {
    console.error("[Main] Error starting MediaMTX:", error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mediamtx-status", {
        running: false,
        error: true,
        message: `Error starting MediaMTX: ${error.message}`,
      });
    }
  }
}

function checkLicense() {
  console.log("[Main] Manual license check...");
  const pythonScript = path.join(__dirname, "license-checker.py");

  const python = spawn("python", [pythonScript]);

  let dataString = "";

  python.stdout.on("data", (data) => {
    dataString += data.toString();
  });

  python.stderr.on("data", (data) => {
    console.error(`[Main] Python Error: ${data}`);
  });

  python.on("close", () => {
    try {
      const jsonStart = dataString.indexOf("{");
      if (jsonStart > 0) {
        dataString = dataString.substring(jsonStart);
      }

      const result = JSON.parse(dataString.trim());

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("license-status", result);

        if (result.valid) {
          currentLicense = result;

          // Jika lisensi valid dan MediaMTX belum jalan, start
          if (!mediamtxProcess) {
            startMediaMTX();
          }
        }
      }
    } catch (error) {
      console.error("[Main] Error parsing license result:", error);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("license-status", {
          valid: false,
          message: "Error checking license: " + error.message,
        });
      }
    }
  });
}

async function restartMediaMTX() {
  console.log("[Main] Restarting MediaMTX...");
  stopMediaMTX();
  setTimeout(() => {
    startMediaMTX();
  }, 1000);
}

function stopMediaMTX() {
  console.log("[Main] Stopping MediaMTX...");

  if (mediamtxProcess) {
    try {
      if (process.platform === "win32") {
        exec(`taskkill /PID ${mediamtxProcess.pid} /T /F`);
      } else {
        mediamtxProcess.kill("SIGTERM");
      }
    } catch (error) {
      console.error("[Main] Error stopping MediaMTX:", error);
    }
    mediamtxProcess = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mediamtx-status", {
      running: false,
      message: "MediaMTX stopped",
    });
  }
}

function checkMediaMTXStatus() {
  if (!mediamtxProcess) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "MediaMTX Status",
      message: "MediaMTX is not running",
      buttons: ["OK"],
    });
    return;
  }

  const cmd =
    process.platform === "win32"
      ? `tasklist /FI "PID eq ${mediamtxProcess.pid}"`
      : `ps -p ${mediamtxProcess.pid}`;

  exec(cmd, (error, stdout) => {
    if (error || !stdout.includes(`${mediamtxProcess.pid}`)) {
      dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "MediaMTX Status",
        message: "MediaMTX is not running",
        buttons: ["OK"],
      });
    } else {
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "MediaMTX Status",
        message: `MediaMTX is running (PID: ${mediamtxProcess.pid})`,
        buttons: ["OK"],
      });
    }
  });
}

function showMediaMTXLogs() {
  const logWindow = new BrowserWindow({
    width: 800,
    height: 600,
    parent: mainWindow,
    modal: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  logWindow.loadFile("renderer/logs.html");
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "About SecureStream Pro",
    message:
      "SecureStream Pro\nVersion 2.0.0\n\nVideo Streaming Platform with Hardware License Protection\n\n© 2024 Your Company",
    buttons: ["OK"],
  });
}

// ==========================================
// IPC Handlers - TAMBAHKAN INI
// ==========================================

ipcMain.handle("check-license", async () => {
  console.log("[Main] IPC: check-license called");
  return new Promise((resolve) => {
    const pythonScript = path.join(__dirname, "license-checker.py");
    const python = spawn("python", [pythonScript]);

    let dataString = "";

    python.stdout.on("data", (data) => {
      dataString += data.toString();
    });

    python.on("close", () => {
      try {
        const jsonStart = dataString.indexOf("{");
        if (jsonStart > 0) {
          dataString = dataString.substring(jsonStart);
        }

        const result = JSON.parse(dataString.trim());
        console.log("[Main] IPC: License check result:", result);
        resolve(result);
      } catch (error) {
        console.error("[Main] IPC: Error parsing result:", error);
        resolve({
          valid: false,
          message: "Error checking license: " + error.message,
        });
      }
    });

    python.on("error", (error) => {
      console.error("[Main] IPC: Python process error:", error);
      resolve({
        valid: false,
        message: "Failed to start Python: " + error.message,
      });
    });
  });
});

ipcMain.handle("control-mediamtx", async (event, action) => {
  console.log("[Main] IPC: control-mediamtx action:", action);

  if (action === "restart") {
    restartMediaMTX();
    return { success: true, message: "MediaMTX restarting..." };
  } else if (action === "stop") {
    stopMediaMTX();
    return { success: true, message: "MediaMTX stopped" };
  } else if (action === "status") {
    const isRunning = mediamtxProcess !== null;
    return {
      success: true,
      running: isRunning,
      pid: mediamtxProcess?.pid,
    };
  }
});

ipcMain.handle("get-stream-url", async (event, streamName) => {
  const baseUrlHls = "http://localhost:8888";
  const baseUrlRtsp = "rtsp://localhost:8554";
  const baseUrlRtmp = "rtmp://localhost:1935";

  return {
    hls: `${baseUrlHls}/${streamName}/index.m3u8`,
    rtsp: `${baseUrlRtsp}/${streamName}`,
    rtmp: `${baseUrlRtmp}/${streamName}`,
  };
});

ipcMain.handle("test-stream", async (event, url) => {
  return new Promise((resolve) => {
    const net = require("net");
    const urlObj = new URL(url);

    const client = new net.Socket();
    client.setTimeout(5000);

    client.connect(Number.parseInt(urlObj.port) || 554, urlObj.hostname, () => {
      client.destroy();
      resolve({ success: true, message: "Connection successful" });
    });

    client.on("error", (err) => {
      resolve({ success: false, message: `Connection failed: ${err.message}` });
    });

    client.on("timeout", () => {
      client.destroy();
      resolve({ success: false, message: "Connection timeout" });
    });
  });
});

ipcMain.handle("save-stream-config", async (event, config) => {
  try {
    const configPath = path.join(app.getPath("userData"), "streams.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log("[Main] Stream config saved to:", configPath);
    return { success: true };
  } catch (error) {
    console.error("[Main] Error saving stream config:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("load-stream-config", async () => {
  try {
    const configPath = path.join(app.getPath("userData"), "streams.json");
    console.log("[Main] Loading stream config from:", configPath);

    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(data);
      console.log("[Main] Loaded", config.length, "streams");
      return { success: true, config: config };
    }

    console.log("[Main] No config file found, returning empty array");
    return { success: true, config: [] };
  } catch (error) {
    console.error("[Main] Error loading stream config:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("get-system-info", async () => {
  return {
    platform: os.platform(),
    arch: os.arch(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpus: os.cpus().length,
    hostname: os.hostname(),
    networkInterfaces: os.networkInterfaces(),
  };
});

app.whenReady().then(() => {
  console.log("[Main] App ready, creating window...");
  createWindow();
});

app.on("window-all-closed", () => {
  console.log("[Main] All windows closed");
  stopMediaMTX();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  console.log("[Main] App quitting, stopping MediaMTX...");
  stopMediaMTX();
});

console.log("[Main] Main.js loaded");
