const { app, BrowserWindow, ipcMain, Menu, dialog } = require("electron");
const path = require("path");
const { spawn, exec } = require("child_process");
const fs = require("fs");
const os = require("os");

console.log("[Main] Main.js loaded");

// =============================================================================
// GLOBAL VARIABLES
// =============================================================================

let mainWindow;
let licenseCheckInterval;
let mediamtxProcess = null;
let currentLicense = null;
let crowdCounterProcess = null;
let currentCrowdCounterConfig = null;

// =============================================================================
// PYTHON RESOLVER
// =============================================================================

/**
 * Find a working Python executable on this machine.
 * Tries: bundled python.exe -> "python" -> "python3" -> "py" (Windows launcher).
 * Returns a Promise that resolves to the executable string, or rejects if none found.
 */
function resolvePython(bundledPath) {
  const candidates = [];
  if (bundledPath && bundledPath !== "python") candidates.push(bundledPath);
  candidates.push("python", "python3", "py");

  return new Promise((resolve, reject) => {
    let index = 0;

    function tryNext() {
      if (index >= candidates.length) {
        reject(new Error(
          "Python not found. Tried: " + candidates.join(", ") +
          ". Please install Python and ensure it is on your PATH."
        ));
        return;
      }

      const candidate = candidates[index++];
      const probe = spawn(candidate, ["--version"], { windowsHide: true });

      probe.on("close", (code) => {
        if (code === 0 || code === null) {
          console.log(`[Main] Python resolved: ${candidate}`);
          resolve(candidate);
        } else {
          tryNext();
        }
      });

      probe.on("error", () => tryNext());
    }

    tryNext();
  });
}

// =============================================================================
// PATH HELPERS
// =============================================================================

function getAppPaths() {
  const isDev = ! app.isPackaged;

  if (isDev) {
    return {
      root: __dirname,
      assets: path.join(__dirname, "assets"),
      renderer: path.join(__dirname, "renderer"),
      python: "python",
      licenseChecker: path.join(__dirname, "license-checker.py"),
      mediamtxDir: path.join(__dirname, "mediamtx"),
    };
  } else {
    return {
      root: process.resourcesPath,
      assets: path.join(process.resourcesPath, "assets"),
      renderer: path.join(process.resourcesPath, "app.asar", "renderer"),
      python: "python",
      licenseChecker: path.join(process.resourcesPath, "license-checker.py"),
      mediamtxDir: path.join(process.resourcesPath, "mediamtx"),
    };
  }
}

function getMediaMTXPath() {
  const paths = getAppPaths();

  // In a packaged build, mediamtx can live in one of two places depending on
  // the electron-builder config used:
  //   1. extraResources -> <resources>/mediamtx/mediamtx.exe   (preferred)
  //   2. asarUnpack     -> <resources>/app.asar.unpacked/mediamtx/mediamtx.exe
  //
  // We try both so either config works.
  const exeName = process.platform === "win32" ? "mediamtx.exe" : "mediamtx";

  const candidates = [
    // Primary: extraResources location (directly under resources/)
    path.join(paths.mediamtxDir, exeName),
  ];

  if (app.isPackaged) {
    // Secondary: asarUnpack location
    const unpackedDir = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "mediamtx"
    );
    candidates.push(path.join(unpackedDir, exeName));
  }

  // Pick the first path that actually exists on disk
  let mediamtxExe = candidates[0];
  let mediamtxDir = path.dirname(mediamtxExe);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      mediamtxExe = candidate;
      mediamtxDir = path.dirname(candidate);
      console.log(`[Main] MediaMTX found at: ${mediamtxExe}`);
      break;
    }
  }

  if (!fs.existsSync(mediamtxExe)) {
    console.error("[Main] MediaMTX not found. Searched:");
    candidates.forEach((c) => console.error("  -", c));
  }

  return { mediamtxDir, mediamtxExe };
}

function getCrowdCounterPaths() {
  const isDev = !app.isPackaged;

  if (isDev) {
    return {
      script: path.join(__dirname, "crowd_counter", "live_feed_stream.py"),
      model: path.join(__dirname, "crowd_counter", "models", "model.pth"),
      python: path.join(__dirname, "python", "python.exe"),
      cwd: path.join(__dirname, "crowd_counter"),
    };
  } else {
    return {
      script: path.join(process. resourcesPath, "crowd_counter", "live_feed_stream.py"),
      model: path. join(process.resourcesPath, "crowd_counter", "models", "model.pth"),
      python: path.join(process. resourcesPath, "python", "python.exe"),
      cwd: path.join(process.resourcesPath, "crowd_counter"),
    };
  }
}

function getPresetsFilePath() {
  return path.join(app.getPath("userData"), "crowd-counter-presets.json");
}

// =============================================================================
// CROWD COUNTER
// =============================================================================

function startCrowdCounter(config) {
  console.log("[Main] Starting Crowd Counter...");

  if (crowdCounterProcess) {
    console.log("[Main] Crowd Counter already running, stopping first...");
    stopCrowdCounter();
  }

  const paths = getCrowdCounterPaths();

  // Check if script exists
  if (!fs. existsSync(paths.script)) {
    console.error(`[Main] Script not found: ${paths.script}`);
    if (mainWindow && !mainWindow. isDestroyed()) {
      mainWindow.webContents.send("crowd-counter-status", {
        running: false,
        error: true,
        message:  `Script not found: ${paths.script}`,
      });
    }
    return false;
  }

  // Check if model exists
  if (!fs.existsSync(paths.model)) {
    console.error(`[Main] Model not found: ${paths. model}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("crowd-counter-status", {
        running: false,
        error:  true,
        message: `Model not found: ${paths.model}`,
      });
    }
    return false;
  }

  // Check if Python exists
  if (!fs.existsSync(paths.python)) {
    console.error(`[Main] Python not found: ${paths.python}`);
    if (mainWindow && ! mainWindow.isDestroyed()) {
      mainWindow. webContents.send("crowd-counter-status", {
        running: false,
        error: true,
        message: `Python not found: ${paths.python}. Run 'npm run setup-python' first.`,
      });
    }
    return false;
  }

  const args = [
    paths.script,
    "--pre", paths.model,
    "--source", config.source_url || "rtmp://localhost:1935/matrice4t",
    "--stream_out", config.stream_out || "rtmp://localhost:1935/cognitiveOutput",
    "--json_output",
  ];

  // Add config options
  if (config. mode) {
    args.push("--mode", config.mode);
  }
  if (config.fp16) {
    args.push("--fp16");
  }
  if (config. scale !== undefined && config.scale !== null) {
    args.push("--scale", config.scale. toString());
  }
  if (config.threshold !== undefined && config.threshold !== null) {
    args.push("--threshold", config.threshold.toString());
  }
  if (config.gpu_id !== undefined) {
    args.push("--gpu_id", config.gpu_id.toString());
  }
  if (config.queue_size !== undefined) {
    args.push("--queue_size", config.queue_size.toString());
  }
  if (config.track !== undefined) {
    args.push("--track", config.track ?  "True" : "False");
  }
  if (config. multiscale !== undefined) {
    args.push("--multiscale", config.multiscale ?  "True" : "False");
  }
  if (config. detect_interval !== undefined) {
    args.push("--detect_interval", config.detect_interval. toString());
  }
  if (config.max_drift !== undefined) {
    args.push("--max_drift", config.max_drift.toString());
  }
  if (config.zone_enabled !== undefined) {
    args.push("--zone_enabled", config.zone_enabled ? "True" : "False");
  }
  if (config.zone_overlay !== undefined) {
    args.push("--zone_overlay", config.zone_overlay ? "True" : "False");
  }
  if (config.zone_margin !== undefined) {
    args.push("--zone_margin", config.zone_margin.toString());
  }
  if (config.zone_rect_norm) {
    args.push("--zone_rect_norm", config.zone_rect_norm);
  }
  if (config.sweep_mode !== undefined) {
    args.push("--sweep_mode", config.sweep_mode ? "True" : "False");
  }
  if (config.ms_scales) {
    args.push("--ms_scales", config. ms_scales);
  }
  if (config.ms_threshold !== undefined) {
    args.push("--ms_threshold", config.ms_threshold.toString());
  }
  if (config. ms_nms_radius !== undefined) {
    args.push("--ms_nms_radius", config.ms_nms_radius.toString());
  }
  if (config.overlay_style) {
    args.push("--overlay_style", config.overlay_style);
  }
  if (config.box_size !== undefined) {
    args.push("--box_size", config.box_size.toString());
  }
  if (config.box_thickness !== undefined) {
    args.push("--box_thickness", config.box_thickness.toString());
  }
  if (config.stream_fps !== undefined) {
    args.push("--stream_fps", config.stream_fps.toString());
  }
  if (config.stream_bitrate) {
    args.push("--stream_bitrate", config. stream_bitrate);
  }
  if (config.stream_codec) {
    args.push("--stream_codec", config. stream_codec);
  }
  if (config.stream_preset) {
    args.push("--stream_preset", config.stream_preset);
  }
  if (config.stream_width !== undefined && config.stream_width > 0) {
    args.push("--stream_width", config.stream_width.toString());
  }
  if (config. stream_height !== undefined && config. stream_height > 0) {
    args.push("--stream_height", config.stream_height.toString());
  }
  if (config.out) {
    args.push("--out", config.out);
  }
  if (config.show) {
    args.push("--show");
  }

  console.log("[Main] Crowd Counter Python:", paths.python);
  console.log("[Main] Crowd Counter CWD:", paths.cwd);
  console.log("[Main] Crowd Counter args:", args. join(" "));

  try {
    const pythonDir = path.dirname(paths.python);
    const pythonPathEntries = [
      pythonDir,
      path.join(pythonDir, "Scripts"),
      path.join(pythonDir, "Library", "bin"),
      process.env.PATH || "",
    ];

    crowdCounterProcess = spawn(paths.python, args, {
      cwd: paths.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONPATH:  paths.cwd,
        PYTHONUNBUFFERED:  "1",
        PATH: pythonPathEntries.join(path.delimiter),
      },
    });

    currentCrowdCounterConfig = config;

    console.log(`[Main] Crowd Counter started with PID: ${crowdCounterProcess.pid}`);

    let stdoutBuffer = "";

    // Handle stdout (JSON output)
    crowdCounterProcess.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);

          if (msg.type === "status") {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("crowd-counter-status", {
                running: msg.running,
                message: msg.message,
                error: msg.error || false,
              });
            }
          } else if (msg.type === "stats") {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow. webContents.send("crowd-counter-stats", {
                count: msg.count,
                total: msg.total,
                viewport: msg.viewport,
                fps: msg.fps,
                mode: msg.mode,
              });
            }
          } else if (msg.type === "error") {
            console.error(`[CrowdCounter] Error: ${msg.message}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("crowd-counter-log", {
                type: "error",
                message:  msg.message,
              });
            }
          } else if (msg.type === "log") {
            console.log(`[CrowdCounter] ${msg.message}`);
            if (mainWindow && !mainWindow. isDestroyed()) {
              mainWindow.webContents.send("crowd-counter-log", {
                type: "info",
                message: msg.message,
              });
            }
          }
        } catch (e) {
          // Not JSON, just log it
          console.log(`[CrowdCounter] ${line}`);
        }
      }
    });

    // Handle stderr
    crowdCounterProcess.stderr.on("data", (data) => {
      const message = data.toString().trim();
      console.error(`[CrowdCounter Error] ${message}`);

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("crowd-counter-log", {
          type: "error",
          message: message,
        });
      }
    });

    // Handle process exit
    crowdCounterProcess.on("close", (code) => {
      console.log(`[Main] Crowd Counter exited with code ${code}`);
      crowdCounterProcess = null;
      currentCrowdCounterConfig = null;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("crowd-counter-status", {
          running: false,
          error: code !== 0,
          message:  code === 0 ? "Stopped" : `Exited with code ${code}`,
        });
      }
    });

    // Handle process error
    crowdCounterProcess. on("error", (error) => {
      console.error("[Main] Crowd Counter process error:", error);
      crowdCounterProcess = null;
      currentCrowdCounterConfig = null;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("crowd-counter-status", {
          running: false,
          error:  true,
          message: `Failed to start: ${error.message}`,
        });
      }
    });

    // Send initial status
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow. webContents.send("crowd-counter-status", {
        running: true,
        pid: crowdCounterProcess.pid,
        message: "Starting...",
      });
    }

    return true;
  } catch (error) {
    console.error("[Main] Failed to start Crowd Counter:", error);
    if (mainWindow && !mainWindow. isDestroyed()) {
      mainWindow.webContents.send("crowd-counter-status", {
        running: false,
        error: true,
        message:  `Failed to start: ${error.message}`,
      });
    }
    return false;
  }
}

function updateCrowdCounterConfig(config) {
  if (!crowdCounterProcess || !crowdCounterProcess.stdin || crowdCounterProcess.stdin.destroyed) {
    return { success: false, error: "Crowd Counter is not running" };
  }

  currentCrowdCounterConfig = {
    ...(currentCrowdCounterConfig || {}),
    ...config,
  };

  try {
    crowdCounterProcess.stdin.write(JSON.stringify({
      type: "config",
      config,
    }) + "\n");
    return { success: true };
  } catch (error) {
    console.error("[Main] Failed to update Crowd Counter config:", error);
    return { success: false, error: error.message };
  }
}

function stopCrowdCounter() {
  console.log("[Main] Stopping Crowd Counter...");

  if (crowdCounterProcess) {
    try {
      if (process.platform === "win32") {
        exec(`taskkill /PID ${crowdCounterProcess. pid} /T /F`);
      } else {
        crowdCounterProcess.kill("SIGTERM");
      }
    } catch (error) {
      console.error("[Main] Error stopping Crowd Counter:", error);
    }
    crowdCounterProcess = null;
    currentCrowdCounterConfig = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("crowd-counter-status", {
      running: false,
      message: "Stopped",
    });
  }
}

// =============================================================================
// PRESET MANAGEMENT
// =============================================================================

function getBuiltInPresets() {
  return [
    {
      id: "standard",
      name: "Standard",
      description: "Fast detection for dense crowds",
      locked: true,
      settings: {
        mode: "standard",
        source_url: "rtmp://localhost:1935/matrice4t",
        stream_out: "rtmp://localhost:1935/cognitiveOutput",
        scale: 0.7,
        threshold: 0.39,
        fp16: true,
        track: false,
        multiscale: false,
        detect_interval: 2,
        max_drift: 20.0,
        zone_enabled: false,
        zone_overlay: true,
        zone_margin: 80,
        zone_rect_norm: "0.1000,0.1000,0.9000,0.9000",
        sweep_mode: false,
        ms_scales:  "1.0",
        ms_threshold:  0.39,
        ms_nms_radius: 12,
        overlay_style: "boxes",
        box_size: 14,
        box_thickness: 2,
        stream_fps:  24,
        stream_bitrate:  "5000k",
        stream_codec: "libx264",
        stream_preset: "ultrafast",
        queue_size: 5,
        gpu_id: "0",
      },
    },
    {
      id: "multiscale",
      name: "Multiscale",
      description: "Better for sparse/varied crowds",
      locked: true,
      settings: {
        mode: "multiscale",
        source_url: "rtmp://localhost:1935/matrice4t",
        stream_out: "rtmp://localhost:1935/cognitiveOutput",
        scale: 0.75,
        threshold: 0.30,
        fp16: true,
        track: false,
        multiscale: true,
        detect_interval: 2,
        max_drift: 20.0,
        zone_enabled: false,
        zone_overlay: true,
        zone_margin: 80,
        zone_rect_norm: "0.1000,0.1000,0.9000,0.9000",
        sweep_mode: false,
        ms_scales:  "0.75,1.0,1.25",
        ms_threshold: 0.30,
        ms_nms_radius: 12,
        overlay_style: "boxes",
        box_size: 14,
        box_thickness: 2,
        stream_fps:  24,
        stream_bitrate: "5000k",
        stream_codec: "libx264",
        stream_preset:  "ultrafast",
        queue_size: 5,
        gpu_id: "0",
      },
    },
    {
      id: "traffic",
      name: "Traffic",
      description: "Optimized for motorcycles/vehicles",
      locked: true,
      settings: {
        mode:  "traffic",
        source_url: "rtmp://localhost:1935/matrice4t",
        stream_out: "rtmp://localhost:1935/cognitiveOutput",
        scale: 0.75,
        threshold: 0.28,
        fp16: true,
        track: true,
        multiscale: true,
        detect_interval: 10,
        max_drift: 25.0,
        zone_enabled: true,
        zone_overlay: true,
        zone_margin: 80,
        zone_rect_norm: "0.1000,0.1000,0.9000,0.9000",
        sweep_mode: true,
        ms_scales: "0.5,0.75,1.0,1.25",
        ms_threshold: 0.28,
        ms_nms_radius: 12,
        overlay_style: "boxes",
        box_size: 14,
        box_thickness: 2,
        stream_fps:  24,
        stream_bitrate: "5000k",
        stream_codec: "libx264",
        stream_preset:  "ultrafast",
        queue_size: 5,
        gpu_id: "0",
      },
    },
  ];
}

function loadPresetsData() {
  const filePath = getPresetsFilePath();

  try {
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return data;
    }
  } catch (error) {
    console.error("[Main] Error loading presets:", error);
  }

  return {
    lastUsedPreset: "standard",
    customPresets: [],
  };
}

function savePresetsData(data) {
  const filePath = getPresetsFilePath();

  try {
    fs.writeFileSync(filePath, JSON. stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error("[Main] Error saving presets:", error);
    return false;
  }
}

// =============================================================================
// MEDIAMTX
// =============================================================================

function startMediaMTX() {
  console.log("[Main] Starting MediaMTX from application...");

  const { mediamtxDir, mediamtxExe } = getMediaMTXPath();
  const configPath = path.join(mediamtxDir, "mediamtx.yml");

  console.log("[Main] MediaMTX exe:", mediamtxExe);
  console.log("[Main] MediaMTX config:", configPath);
  console.log("[Main] MediaMTX dir:", mediamtxDir);

  if (!fs.existsSync(mediamtxExe)) {
    console.error(`[Main] MediaMTX not found at:  ${mediamtxExe}`);

    if (! fs.existsSync(configPath)) {
      const defaultConfig = `# MediaMTX Configuration
paths:
  all: 
    source: publisher
    sourceOnDemand: yes`;

      try {
        fs.writeFileSync(configPath, defaultConfig);
        console.log(`[Main] Created default config at: ${configPath}`);
      } catch (err) {
        console.error("[Main] Failed to create config:", err);
      }
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mediamtx-status", {
        running: false,
        error: true,
        message: `MediaMTX executable not found.  Please install MediaMTX to:  ${mediamtxDir}`,
      });
    }
    return;
  }

  try {
    mediamtxProcess = spawn(mediamtxExe, [configPath], {
      cwd: mediamtxDir,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,   // prevent black console window flashing on Windows
    });

    console.log(`[Main] MediaMTX started with PID: ${mediamtxProcess.pid}`);

    mediamtxProcess.stdout.on("data", (data) => {
      console.log(`[MediaMTX] ${data.toString()}`);
    });

    mediamtxProcess.stderr.on("data", (data) => {
      console.error(`[MediaMTX Error] ${data.toString()}`);
    });

    mediamtxProcess.on("close", (code) => {
      console. log(`[Main] MediaMTX process exited with code ${code}`);
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

    if (mainWindow && !mainWindow. isDestroyed()) {
      mainWindow.webContents.send("mediamtx-status", {
        running: true,
        pid: mediamtxProcess.pid,
        message: "MediaMTX is running",
      });
    }
  } catch (error) {
    console.error("[Main] Error starting MediaMTX:", error);
    if (mainWindow && ! mainWindow.isDestroyed()) {
      mainWindow.webContents.send("mediamtx-status", {
        running:  false,
        error: true,
        message: `Error starting MediaMTX: ${error.message}`,
      });
    }
  }
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

function restartMediaMTX() {
  console.log("[Main] Restarting MediaMTX...");
  stopMediaMTX();
  setTimeout(() => {
    startMediaMTX();
  }, 1000);
}

function checkMediaMTXStatus() {
  if (! mediamtxProcess) {
    dialog.showMessageBox(mainWindow, {
      type:  "info",
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
    if (error || !stdout. includes(`${mediamtxProcess.pid}`)) {
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

// =============================================================================
// LICENSE
// =============================================================================

function checkLicenseAndStartMediaMTX() {
  console.log("[Main] Starting license check...");
  const paths = getAppPaths();
  const pythonScript = paths.licenseChecker;

  console.log("[Main] Python script path:", pythonScript);
  console.log("[Main] Script exists:", fs.existsSync(pythonScript));

  resolvePython(paths.python).then((pythonExe) => {
    const python = spawn(pythonExe, [pythonScript], { windowsHide: true });

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

      const trimmed = dataString.trim();
      if (!trimmed) {
        console.error("[Main] Python produced no output (stderr:", errorString.trim(), ")");
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("license-status", {
            valid: false,
            message: "License check failed: Python script produced no output. " +
                     (errorString.trim() || `Exit code ${code}`),
          });
        }
        return;
      }

      try {
        const jsonStart = trimmed.indexOf("{");
        const jsonString = jsonStart > 0 ? trimmed.substring(jsonStart) : trimmed;
        const result = JSON.parse(jsonString);
        currentLicense = result;

        console.log("[Main] License check result:", result);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("license-status", result);
        }

        if (result.valid) {
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
            message: "Error parsing license response: " + error.message,
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

  }).catch((error) => {
    console.error("[Main] Could not resolve Python:", error.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("license-status", {
        valid: false,
        message: error.message,
      });
    }
  });
}

function checkLicense() {
  console.log("[Main] Manual license check...");
  const paths = getAppPaths();
  const pythonScript = paths.licenseChecker;

  resolvePython(paths.python).then((pythonExe) => {
    const python = spawn(pythonExe, [pythonScript], { windowsHide: true });

    let dataString = "";

    python.stdout.on("data", (data) => {
      dataString += data.toString();
    });

    python.stderr.on("data", (data) => {
      console.error(`[Main] Python Error: ${data}`);
    });

    python.on("close", (code) => {
      const trimmed = dataString.trim();
      if (!trimmed) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("license-status", {
            valid: false,
            message: `License check failed: no output from Python (exit ${code})`,
          });
        }
        return;
      }

      try {
        const jsonStart = trimmed.indexOf("{");
        const jsonString = jsonStart > 0 ? trimmed.substring(jsonStart) : trimmed;
        const result = JSON.parse(jsonString);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("license-status", result);

          if (result.valid) {
            currentLicense = result;

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
            message: "Error parsing license response: " + error.message,
          });
        }
      }
    });

  }).catch((error) => {
    console.error("[Main] Could not resolve Python:", error.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("license-status", {
        valid: false,
        message: error.message,
      });
    }
  });
}

// =============================================================================
// WINDOW
// =============================================================================

function createWindow() {
  const paths = getAppPaths();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation:  true,
      webSecurity:  false,
    },
    autoHideMenuBar: true,
    resizable: true,
    backgroundColor: "#0f172a",
    show: false,
    icon: path.join(paths.assets, "icon.ico"),
  });

  const indexPath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "renderer", "index.html")
    : path.join(__dirname, "renderer", "index.html");

  console.log("[Main] Loading index from:", indexPath);
  mainWindow.loadFile(indexPath);

  if (! app.isPackaged) {
    mainWindow.webContents. openDevTools();
  }

  mainWindow.once("ready-to-show", () => {
    console.log("[Main] Window ready to show");
    mainWindow.show();

    mainWindow.webContents.on("did-finish-load", () => {
      console.log("[Main] Renderer finished loading");
      setTimeout(() => {
        checkLicenseAndStartMediaMTX();
      }, 500);

      licenseCheckInterval = setInterval(() => {
        checkLicense();
      }, 180000);
    });
  });

  createMenu();

  mainWindow.on("closed", () => {
    clearInterval(licenseCheckInterval);
    stopMediaMTX();
    stopCrowdCounter();
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
        { role:  "zoomOut" },
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
          label:  "View Logs",
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

  const menu = Menu. buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showMediaMTXLogs() {
  const logWindow = new BrowserWindow({
    width: 800,
    height: 600,
    parent: mainWindow,
    modal:  true,
    webPreferences:  {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const logsPath = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "renderer", "logs.html")
    : path.join(__dirname, "renderer", "logs.html");

  logWindow.loadFile(logsPath);
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: "info",
    title: "About AirSea Drone Narada",
    message: 
      "AirSea Drone Narada\nVersion 2.0.0\n\nVideo Streaming Platform with Hardware License Protection and Crowd Counting\n\n© 2024 AirSea Drone",
    buttons: ["OK"],
  });
}

// =============================================================================
// IPC HANDLERS - CROWD COUNTER
// =============================================================================

ipcMain.handle("start-crowd-counter", async (event, config) => {
  console.log("[Main] IPC: start-crowd-counter", config);
  const success = startCrowdCounter(config);
  return { success };
});

ipcMain.handle("stop-crowd-counter", async () => {
  console.log("[Main] IPC: stop-crowd-counter");
  stopCrowdCounter();
  return { success: true };
});

ipcMain.handle("update-crowd-counter-config", async (event, config) => {
  console.log("[Main] IPC: update-crowd-counter-config", config);
  return updateCrowdCounterConfig(config);
});

ipcMain.handle("get-crowd-counter-status", async () => {
  const isRunning = crowdCounterProcess !== null;
  return {
    running: isRunning,
    pid: crowdCounterProcess?.pid,
    config: currentCrowdCounterConfig,
  };
});

// =============================================================================
// IPC HANDLERS - PRESETS
// =============================================================================

ipcMain.handle("get-builtin-presets", async () => {
  return getBuiltInPresets();
});

ipcMain.handle("load-user-presets", async () => {
  const data = loadPresetsData();
  return {
    success: true,
    customPresets: data. customPresets || [],
  };
});

ipcMain.handle("save-user-preset", async (event, preset) => {
  const data = loadPresetsData();

  const existingIndex = data.customPresets.findIndex((p) => p.id === preset.id);

  if (existingIndex !== -1) {
    data.customPresets[existingIndex] = preset;
  } else {
    preset.id = `custom-${Date.now()}`;
    preset.createdAt = new Date().toISOString();
    data.customPresets.push(preset);
  }

  const success = savePresetsData(data);
  return { success, preset };
});

ipcMain.handle("delete-user-preset", async (event, presetId) => {
  const data = loadPresetsData();
  data.customPresets = data.customPresets.filter((p) => p.id !== presetId);
  const success = savePresetsData(data);
  return { success };
});

ipcMain.handle("get-last-used-preset", async () => {
  const data = loadPresetsData();
  return { presetId: data.lastUsedPreset || "standard" };
});

ipcMain.handle("set-last-used-preset", async (event, presetId) => {
  const data = loadPresetsData();
  data.lastUsedPreset = presetId;
  const success = savePresetsData(data);
  return { success };
});

// =============================================================================
// IPC HANDLERS - LICENSE & MEDIAMTX
// =============================================================================

ipcMain.handle("check-license", async () => {
  console.log("[Main] IPC:  check-license called");
  const paths = getAppPaths();
  const pythonScript = paths.licenseChecker;

  let pythonExe;
  try {
    pythonExe = await resolvePython(paths.python);
  } catch (err) {
    console.error("[Main] IPC: Could not resolve Python:", err.message);
    return { valid: false, message: err.message };
  }

  return new Promise((resolve) => {
    const python = spawn(pythonExe, [pythonScript], { windowsHide: true });

    let dataString = "";
    let stderrString = "";

    python.stdout.on("data", (data) => {
      dataString += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderrString += data.toString();
      console.error(`[Main] IPC: Python stderr: ${data}`);
    });

    python.on("close", (code) => {
      const trimmed = dataString.trim();
      if (!trimmed) {
        // Include stderr in message to help diagnose missing modules, etc.
        const detail = stderrString.trim()
          ? stderrString.trim().split("\n").pop()   // last line of stderr
          : `exit ${code}`;
        console.error(`[Main] IPC: Python produced no output. stderr: ${stderrString}`);
        resolve({
          valid: false,
          message: `License check failed: ${detail}`,
        });
        return;
      }

      try {
        const jsonStart = trimmed.indexOf("{");
        const jsonString = jsonStart > 0 ? trimmed.substring(jsonStart) : trimmed;
        const result = JSON.parse(jsonString);
        console.log("[Main] IPC: License check result:", result);
        resolve(result);
      } catch (error) {
        console.error("[Main] IPC:  Error parsing result:", error);
        resolve({
          valid: false,
          message: "Error parsing license response: " + error.message,
        });
      }
    });

    python.on("error", (error) => {
      console.error("[Main] IPC: Python process error:", error);
      resolve({
        valid: false,
        message: "Failed to start Python:  " + error.message,
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

// =============================================================================
// IPC HANDLERS - STREAMS
// =============================================================================

ipcMain.handle("get-stream-url", async (event, streamInput) => {
  const baseUrlHls = "http://localhost:8888";
  const baseUrlRtsp = "rtsp://localhost:8554";
  const baseUrlRtmp = "rtmp://localhost:1935";

  // Accept both legacy string input and richer object input from renderer.
  const stream =
    typeof streamInput === "string"
      ? { name: streamInput }
      : streamInput || {};

  const explicitHlsUrl = (stream.hlsUrl || stream.hls || "").trim();
  const explicitHlsPath = (stream.hlsPath || stream.path || "").trim();
  const streamName = (stream.name || "").trim();
  const sourceUrl = (stream.url || "").trim();

  if (explicitHlsUrl.startsWith("http://") || explicitHlsUrl.startsWith("https://")) {
    return {
      hls: explicitHlsUrl,
      rtsp: sourceUrl || `${baseUrlRtsp}/${streamName}`,
      rtmp: sourceUrl || `${baseUrlRtmp}/${streamName}`,
    };
  }

  let streamPath = explicitHlsPath || streamName;

  if (!explicitHlsPath && sourceUrl) {
    try {
      const parsed = new URL(sourceUrl);
      const fromUrlPath = parsed.pathname.replace(/^\/+|\/+$/g, "");
      if (fromUrlPath) {
        streamPath = fromUrlPath;
      }
    } catch (error) {
      // Keep fallback value when sourceUrl is not a valid URL.
    }
  }

  streamPath = streamPath.replace(/^\/+|\/+$/g, "");

  return {
    hls: `${baseUrlHls}/${streamPath}/index.m3u8`,
    rtsp: sourceUrl || `${baseUrlRtsp}/${streamPath}`,
    rtmp: sourceUrl || `${baseUrlRtmp}/${streamPath}`,
  };
});

ipcMain.handle("test-stream", async (event, url) => {
  return new Promise((resolve) => {
    const net = require("net");
    const urlObj = new URL(url);

    const client = new net.Socket();
    client.setTimeout(5000);

    client.connect(Number. parseInt(urlObj.port) || 554, urlObj.hostname, () => {
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
      console.log("[Main] Loaded", config. length, "streams");
      return { success: true, config:  config };
    }

    console.log("[Main] No config file found, returning empty array");
    return { success: true, config: [] };
  } catch (error) {
    console.error("[Main] Error loading stream config:", error);
    return { success: false, error: error. message };
  }
});

// =============================================================================
// IPC HANDLERS - SYSTEM
// =============================================================================

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

ipcMain.handle("get-asset-path", async (event, assetName) => {
  const paths = getAppPaths();
  return path.join(paths.assets, assetName);
});

// =============================================================================
// APP LIFECYCLE
// =============================================================================

app. whenReady().then(() => {
  console.log("[Main] App ready, creating window...");
  console.log("[Main] App packaged:", app.isPackaged);
  console.log("[Main] Resources path:", process.resourcesPath);
  createWindow();
});

app.on("window-all-closed", () => {
  console.log("[Main] All windows closed");
  stopMediaMTX();
  stopCrowdCounter();
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
  console.log("[Main] App quitting, stopping services...");
  stopMediaMTX();
  stopCrowdCounter();
});

ipcMain.handle("select-video-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select video source",
    properties: ["openFile"],
    filters: [
      { name: "Video Files", extensions: ["mp4", "mov", "mkv", "avi", "m4v", "webm"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }

  return { canceled: false, path: result.filePaths[0] };
});
