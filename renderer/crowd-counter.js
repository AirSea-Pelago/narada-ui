// =============================================================================
// CROWD COUNTER UI - v4 (Complete with Fixed Locking)
// =============================================================================

var ccState = {
  running: false,
  editing: false,
  count: 0,
  fps: 0,
  mode: "DET",
  currentPreset: null,
  builtinPresets: [],
  customPresets:  [],
  pendingChanges:  false,
  previousSettings: null,
  logs: [],
  maxLogs: 500,
  presetToDelete: null,
};

var cc = {};

// All lockable input IDs
var LOCKABLE_INPUTS = [
  "cc-scale",
  "cc-scale-input",
  "cc-threshold",
  "cc-threshold-input",
  "cc-track",
  "cc-multiscale",
  "cc-fp16",
  "cc-stream-fps",
  "cc-stream-bitrate",
  "cc-stream-codec",
  "cc-stream-preset",
  "cc-stream-width",
  "cc-stream-height",
  "cc-ms-scales",
  "cc-ms-threshold",
  "cc-ms-nms-radius",
  "cc-detect-interval",
  "cc-max-drift",
  "cc-overlay-style",
  "cc-box-size",
  "cc-box-thickness",
  "cc-queue-size",
  "cc-gpu-id",
  "cc-out",
  "cc-browse-out",
  "cc-show-preview",
];

// =============================================================================
// INITIALIZATION
// =============================================================================

function initCrowdCounter() {
  console.log("[CrowdCounter] Initializing...");
  cacheElements();
  setupEventListeners();
  setupIPCListeners();
  loadPresets();
  setAllInputsDisabled(true);
  addLog("info", "Crowd Counter ready");
  console.log("[CrowdCounter] Initialized");
}

function cacheElements() {
  cc = {
    count: document.getElementById("cc-count"),
    fpsValue: document.getElementById("cc-fps-value"),
    modeValue: document.getElementById("cc-mode-value"),
    statusValue: document.getElementById("cc-status-value"),
    toggleBtn: document.getElementById("cc-toggle-btn"),
    toggleIcon: document.getElementById("cc-toggle-icon"),
    miniLogText: document.getElementById("cc-mini-log-text"),
    presetButtons: document.getElementById("cc-preset-buttons"),
    settingsContainer: document.getElementById("cc-settings-container"),
    advancedContainer: document.getElementById("cc-advanced-container"),
    editBtn: document.getElementById("cc-edit-btn"),
    editIcon: document.getElementById("cc-edit-icon"),
    editText: document.getElementById("cc-edit-text"),
    cancelBtn: document.getElementById("cc-cancel-btn"),
    applyBtn: document.getElementById("cc-apply-btn"),
    scale: document.getElementById("cc-scale"),
    scaleInput: document.getElementById("cc-scale-input"),
    threshold: document.getElementById("cc-threshold"),
    thresholdInput: document.getElementById("cc-threshold-input"),
    track: document.getElementById("cc-track"),
    trackStatus: document.getElementById("cc-track-status"),
    multiscale: document.getElementById("cc-multiscale"),
    multiscaleStatus:  document.getElementById("cc-multiscale-status"),
    fp16: document.getElementById("cc-fp16"),
    fp16Status: document.getElementById("cc-fp16-status"),
    advancedToggle: document.getElementById("cc-advanced-toggle"),
    streamFps: document.getElementById("cc-stream-fps"),
    streamBitrate: document.getElementById("cc-stream-bitrate"),
    streamCodec: document.getElementById("cc-stream-codec"),
    streamPreset: document.getElementById("cc-stream-preset"),
    streamWidth: document.getElementById("cc-stream-width"),
    streamHeight: document.getElementById("cc-stream-height"),
    msScales: document.getElementById("cc-ms-scales"),
    msThreshold: document.getElementById("cc-ms-threshold"),
    msNmsRadius: document.getElementById("cc-ms-nms-radius"),
    detectInterval: document. getElementById("cc-detect-interval"),
    maxDrift: document. getElementById("cc-max-drift"),
    overlayStyle: document. getElementById("cc-overlay-style"),
    boxSize: document.getElementById("cc-box-size"),
    boxThickness: document.getElementById("cc-box-thickness"),
    queueSize: document.getElementById("cc-queue-size"),
    gpuId: document.getElementById("cc-gpu-id"),
    out: document.getElementById("cc-out"),
    browseOut: document.getElementById("cc-browse-out"),
    showPreview: document.getElementById("cc-show-preview"),
    logToggle: document.getElementById("cc-log-toggle"),
    logContainer: document.getElementById("cc-log-container"),
    logTerminal: document.getElementById("cc-log-terminal"),
    logClear: document.getElementById("cc-log-clear"),
    logCopy: document.getElementById("cc-log-copy"),
    savePresetModal: document.getElementById("cc-save-preset-modal"),
    savePresetClose: document.getElementById("cc-save-preset-close"),
    savePresetCancel: document.getElementById("cc-save-preset-cancel"),
    savePresetConfirm: document.getElementById("cc-save-preset-confirm"),
    newPresetName: document.getElementById("cc-new-preset-name"),
    newPresetDescription: document.getElementById("cc-new-preset-description"),
    deletePresetModal: document.getElementById("cc-delete-preset-modal"),
    deletePresetClose: document.getElementById("cc-delete-preset-close"),
    deletePresetCancel: document.getElementById("cc-delete-preset-cancel"),
    deletePresetConfirm:  document.getElementById("cc-delete-preset-confirm"),
    deletePresetName: document.getElementById("cc-delete-preset-name"),
  };
}

// =============================================================================
// INPUT LOCKING
// =============================================================================

function setAllInputsDisabled(disabled) {
  LOCKABLE_INPUTS.forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.disabled = disabled;
    }
  });
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

function setupEventListeners() {
  if (cc.toggleBtn) {
    cc.toggleBtn.addEventListener("click", toggleCrowdCounter);
  }

  if (cc.editBtn) {
    cc.editBtn.addEventListener("click", toggleEditMode);
  }

  if (cc.cancelBtn) {
    cc.cancelBtn.addEventListener("click", cancelChanges);
  }

  if (cc.applyBtn) {
    cc.applyBtn.addEventListener("click", applySettings);
  }

  if (cc.scale && cc.scaleInput) {
    cc.scale.addEventListener("input", function () {
      cc.scaleInput.value = parseFloat(cc.scale.value).toFixed(2);
      markPendingChanges();
    });
    cc.scaleInput.addEventListener("input", function () {
      var val = parseFloat(cc.scaleInput.value);
      if (!isNaN(val) && val >= 0.2 && val <= 3.0) {
        cc.scale.value = val;
      }
      markPendingChanges();
    });
    cc.scaleInput.addEventListener("blur", function () {
      var val = parseFloat(cc.scaleInput.value);
      if (isNaN(val) || val < 0.2) val = 0.2;
      if (val > 3.0) val = 3.0;
      cc.scaleInput.value = val.toFixed(2);
      cc.scale.value = val;
    });
  }

  if (cc.threshold && cc.thresholdInput) {
    cc.threshold.addEventListener("input", function () {
      cc.thresholdInput.value = parseFloat(cc.threshold.value).toFixed(2);
      markPendingChanges();
    });
    cc.thresholdInput. addEventListener("input", function () {
      var val = parseFloat(cc.thresholdInput.value);
      if (!isNaN(val) && val >= 0.1 && val <= 0.9) {
        cc.threshold.value = val;
      }
      markPendingChanges();
    });
    cc.thresholdInput.addEventListener("blur", function () {
      var val = parseFloat(cc.thresholdInput.value);
      if (isNaN(val) || val < 0.1) val = 0.1;
      if (val > 0.9) val = 0.9;
      cc.thresholdInput.value = val.toFixed(2);
      cc.threshold. value = val;
    });
  }

  setupToggleSwitch(cc.track, cc.trackStatus);
  setupToggleSwitch(cc. multiscale, cc.multiscaleStatus);
  setupToggleSwitch(cc.fp16, cc. fp16Status);

  if (cc.advancedToggle) {
    cc.advancedToggle.addEventListener("change", function () {
      if (cc.advancedContainer) {
        cc.advancedContainer.style.display = cc. advancedToggle.checked ?  "block" : "none";
      }
    });
  }

  if (cc.logToggle) {
    cc.logToggle.addEventListener("change", function () {
      if (cc.logContainer) {
        cc.logContainer.style.display = cc.logToggle.checked ?  "block" : "none";
        if (cc.logToggle.checked) {
          scrollLogToBottom();
        }
      }
    });
  }

  if (cc.logClear) {
    cc.logClear.addEventListener("click", clearLogs);
  }

  if (cc.logCopy) {
    cc.logCopy.addEventListener("click", copyLogs);
  }

  if (cc.savePresetClose) {
    cc.savePresetClose.addEventListener("click", closeSavePresetModal);
  }

  if (cc.savePresetCancel) {
    cc.savePresetCancel.addEventListener("click", closeSavePresetModal);
  }

  if (cc.savePresetConfirm) {
    cc.savePresetConfirm.addEventListener("click", saveNewPreset);
  }

  if (cc.savePresetModal) {
    cc.savePresetModal.addEventListener("click", function (e) {
      if (e.target === cc.savePresetModal) {
        closeSavePresetModal();
      }
    });
  }

  if (cc. deletePresetClose) {
    cc.deletePresetClose.addEventListener("click", closeDeletePresetModal);
  }

  if (cc.deletePresetCancel) {
    cc.deletePresetCancel.addEventListener("click", closeDeletePresetModal);
  }

  if (cc.deletePresetConfirm) {
    cc.deletePresetConfirm.addEventListener("click", confirmDeletePreset);
  }

  if (cc.deletePresetModal) {
    cc.deletePresetModal.addEventListener("click", function (e) {
      if (e.target === cc.deletePresetModal) {
        closeDeletePresetModal();
      }
    });
  }

  var advInputs = [
    cc.streamFps, cc.streamBitrate, cc.streamCodec, cc.streamPreset,
    cc.streamWidth, cc.streamHeight, cc.msScales, cc.msThreshold,
    cc.msNmsRadius, cc.detectInterval, cc.maxDrift, cc.overlayStyle,
    cc.boxSize, cc.boxThickness, cc.queueSize, cc.gpuId, cc. out, cc.showPreview,
  ];

  advInputs.forEach(function (input) {
    if (input) {
      input.addEventListener("change", markPendingChanges);
      input.addEventListener("input", markPendingChanges);
    }
  });
}

function setupToggleSwitch(toggleEl, statusEl) {
  if (toggleEl && statusEl) {
    toggleEl.addEventListener("change", function () {
      statusEl.textContent = toggleEl.checked ? "On" : "Off";
      markPendingChanges();
    });
  }
}

// =============================================================================
// IPC LISTENERS
// =============================================================================

function setupIPCListeners() {
  if (! window.electronAPI) {
    console.warn("[CrowdCounter] electronAPI not available");
    return;
  }

  if (window.electronAPI.onCrowdCounterStatus) {
    window.electronAPI.onCrowdCounterStatus(function (status) {
      updateStatus(status);
      if (status.running) {
        addLog("success", "Crowd Counter started");
      } else if (status.error) {
        addLog("error", status.message || "Error occurred");
      } else {
        addLog("status", status.message || "Stopped");
      }
    });
  }

  if (window. electronAPI.onCrowdCounterStats) {
    window.electronAPI.onCrowdCounterStats(function (stats) {
      updateStats(stats);
    });
  }

  if (window.electronAPI.onCrowdCounterLog) {
    window.electronAPI.onCrowdCounterLog(function (log) {
      addLog(log. type || "info", log.message);
    });
  }
}

// =============================================================================
// EDIT MODE
// =============================================================================

function toggleEditMode() {
  if (ccState.editing) {
    exitEditMode();
  } else {
    enterEditMode();
  }
}

function enterEditMode() {
  ccState.editing = true;
  ccState.previousSettings = collectSettings();

  if (cc.editBtn) cc.editBtn.classList.add("editing");
  if (cc.editIcon) cc.editIcon.className = "fas fa-unlock";
  if (cc.editText) cc.editText.textContent = "Editing";
  if (cc.cancelBtn) cc.cancelBtn.style.display = "flex";
  if (cc.applyBtn) cc.applyBtn.style.display = "flex";
  if (cc.settingsContainer) cc.settingsContainer.classList.add("editing");
  if (cc.advancedContainer) cc.advancedContainer.classList.add("editing");

  setAllInputsDisabled(false);
  addLog("info", "Edit mode enabled - settings unlocked");
}

function exitEditMode() {
  ccState.editing = false;
  ccState.pendingChanges = false;

  if (cc.editBtn) cc.editBtn.classList.remove("editing");
  if (cc.editIcon) cc.editIcon.className = "fas fa-lock";
  if (cc.editText) cc.editText.textContent = "Locked";
  if (cc.cancelBtn) cc.cancelBtn.style.display = "none";
  if (cc.applyBtn) cc.applyBtn.style. display = "none";
  if (cc.settingsContainer) cc.settingsContainer.classList.remove("editing");
  if (cc.advancedContainer) cc.advancedContainer.classList.remove("editing");

  setAllInputsDisabled(true);
  updateApplyButton();
  addLog("info", "Edit mode disabled - settings locked");
}

function cancelChanges() {
  if (ccState.previousSettings) {
    applySettingsToUI(ccState.previousSettings);
    addLog("info", "Changes cancelled - settings restored");
  }
  exitEditMode();
}

// =============================================================================
// PRESETS
// =============================================================================

function loadPresets() {
  console.log("[CrowdCounter] Loading presets...");

  if (window.electronAPI && window.electronAPI.getBuiltinPresets) {
    window.electronAPI.getBuiltinPresets().then(function (presets) {
      ccState.builtinPresets = presets;
      loadUserPresetsAndFinish();
    }).catch(function (err) {
      console.error("[CrowdCounter] Error loading built-in presets:", err);
      ccState.builtinPresets = getDefaultPresets();
      loadUserPresetsAndFinish();
    });
  } else {
    ccState.builtinPresets = getDefaultPresets();
    loadUserPresetsAndFinish();
  }
}

function loadUserPresetsAndFinish() {
  if (window.electronAPI && window. electronAPI.loadUserPresets) {
    window.electronAPI.loadUserPresets().then(function (result) {
      if (result.success) {
        ccState.customPresets = result.customPresets || [];
      }
      finishLoadingPresets();
    }).catch(function (err) {
      console.error("[CrowdCounter] Error loading user presets:", err);
      finishLoadingPresets();
    });
  } else {
    finishLoadingPresets();
  }
}

function finishLoadingPresets() {
  if (window.electronAPI && window.electronAPI.getLastUsedPreset) {
    window.electronAPI.getLastUsedPreset().then(function (result) {
      var lastPresetId = result.presetId || "standard";
      populatePresetButtons();
      selectPreset(lastPresetId, false);
      addLog("success", "Presets loaded:  " + lastPresetId);
    }).catch(function (err) {
      populatePresetButtons();
      selectPreset("standard", false);
      addLog("success", "Presets loaded: standard");
    });
  } else {
    populatePresetButtons();
    selectPreset("standard", false);
    addLog("success", "Presets loaded: standard");
  }
}

function getDefaultPresets() {
  return [
    {
      id:  "standard",
      name: "Standard",
      description: "Fast detection for dense crowds",
      settings: {
        mode: "standard", scale: 0.7, threshold: 0.39, fp16: true, track: false,
        multiscale: false, detect_interval: 2, max_drift: 20.0, ms_scales: "1.0",
        ms_threshold: 0.39, ms_nms_radius:  12, overlay_style: "boxes", box_size: 14,
        box_thickness: 2, stream_fps: 30, stream_bitrate: "2500k", stream_codec: "libx264",
        queue_size: 5, gpu_id: "0",
      },
    },
    {
      id: "multiscale",
      name: "Multiscale",
      description: "Better for sparse/varied crowds",
      settings: {
        mode: "multiscale", scale: 0.75, threshold: 0.3, fp16: true, track:  false,
        multiscale:  true, detect_interval: 1, max_drift: 20.0, ms_scales: "0.75,1.0,1.25",
        ms_threshold: 0.3, ms_nms_radius: 12, overlay_style: "boxes", box_size:  14,
        box_thickness: 2, stream_fps:  30, stream_bitrate:  "2500k", stream_codec: "libx264",
        stream_preset: "ultrafast", queue_size: 2, gpu_id: "0",
      },
    },
    {
      id: "traffic",
      name: "Traffic",
      description: "Optimized for motorcycles/vehicles",
      settings: {
        mode: "traffic", scale: 0.75, threshold: 0.28, fp16: true, track:  true,
        multiscale: true, detect_interval: 10, max_drift: 25.0, ms_scales: "0.5,0.75,1.0,1.25",
        ms_threshold: 0.28, ms_nms_radius: 12, overlay_style: "boxes", box_size:  14,
        box_thickness: 2, stream_fps:  30, stream_bitrate:  "2500k", stream_codec: "libx264",
        stream_preset: "ultrafast", queue_size: 2, gpu_id: "0",
      },
    },
  ];
}

function populatePresetButtons() {
  if (! cc.presetButtons) return;

  cc.presetButtons.innerHTML = "";

  ccState.builtinPresets.forEach(function (preset) {
    var btn = createPresetButton(preset, false);
    cc.presetButtons.appendChild(btn);
  });

  ccState.customPresets.forEach(function (preset) {
    var btn = createPresetButton(preset, true);
    cc.presetButtons.appendChild(btn);
  });

  var addBtn = document.createElement("button");
  addBtn.className = "cc-preset-btn cc-preset-add";
  addBtn.innerHTML = '<i class="fas fa-plus"></i>';
  addBtn.title = "Add Custom Preset";
  addBtn. addEventListener("click", openSavePresetModal);
  cc.presetButtons.appendChild(addBtn);
}

function createPresetButton(preset, isCustom) {
  var btn = document.createElement("button");
  btn.className = "cc-preset-btn" + (isCustom ? " cc-preset-custom" : "");
  btn.dataset.preset = preset.id;
  btn.title = preset.description || "";

  if (isCustom) {
    btn.innerHTML = preset.name + '<span class="cc-preset-delete" title="Delete"><i class="fas fa-times"></i></span>';
    btn.addEventListener("click", function (e) {
      if (! e.target.closest(".cc-preset-delete")) {
        selectPreset(preset.id, true);
      }
    });
    var deleteBtn = btn.querySelector(".cc-preset-delete");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        openDeletePresetModal(preset);
      });
    }
  } else {
    btn.textContent = preset.name;
    btn.addEventListener("click", function () {
      selectPreset(preset.id, true);
    });
  }

  if (ccState.currentPreset && ccState.currentPreset.id === preset.id) {
    btn.classList.add("active");
  }

  return btn;
}

function selectPreset(presetId, saveLastUsed) {
  var preset = null;

  for (var i = 0; i < ccState.builtinPresets.length; i++) {
    if (ccState.builtinPresets[i].id === presetId) {
      preset = ccState.builtinPresets[i];
      break;
    }
  }

  if (! preset) {
    for (var i = 0; i < ccState.customPresets. length; i++) {
      if (ccState.customPresets[i].id === presetId) {
        preset = ccState. customPresets[i];
        break;
      }
    }
  }

  if (! preset && ccState.builtinPresets.length > 0) {
    preset = ccState.builtinPresets[0];
  }

  if (! preset) return;

  ccState.currentPreset = preset;

  var allBtns = document.querySelectorAll(".cc-preset-btn");
  allBtns.forEach(function (btn) {
    btn.classList.remove("active");
    if (btn.dataset.preset === preset.id) {
      btn.classList.add("active");
    }
  });

  applySettingsToUI(preset. settings);

  if (saveLastUsed && window.electronAPI && window.electronAPI.setLastUsedPreset) {
    window.electronAPI.setLastUsedPreset(preset.id);
  }

  ccState.pendingChanges = false;
  updateApplyButton();
  addLog("info", "Preset:  " + preset.name);
}

function applySettingsToUI(s) {
  if (cc.scale && s.scale !== undefined) {
    cc.scale.value = s.scale;
  }
  if (cc.scaleInput && s.scale !== undefined) {
    cc.scaleInput.value = parseFloat(s.scale).toFixed(2);
  }
  if (cc.threshold && s.threshold !== undefined) {
    cc.threshold.value = s.threshold;
  }
  if (cc.thresholdInput && s.threshold !== undefined) {
    cc.thresholdInput.value = parseFloat(s. threshold).toFixed(2);
  }
  if (cc. track && s.track !== undefined) {
    cc.track.checked = s.track;
  }
  if (cc.trackStatus && s.track !== undefined) {
    cc.trackStatus.textContent = s.track ? "On" : "Off";
  }
  if (cc.multiscale && s.multiscale !== undefined) {
    cc.multiscale.checked = s. multiscale;
  }
  if (cc.multiscaleStatus && s.multiscale !== undefined) {
    cc.multiscaleStatus.textContent = s. multiscale ? "On" :  "Off";
  }
  if (cc.fp16 && s.fp16 !== undefined) {
    cc.fp16.checked = s.fp16;
  }
  if (cc.fp16Status && s.fp16 !== undefined) {
    cc.fp16Status.textContent = s.fp16 ? "On" : "Off";
  }
  if (cc.streamFps && s.stream_fps !== undefined) {
    cc.streamFps.value = s. stream_fps;
  }
  if (cc.streamBitrate && s.stream_bitrate !== undefined) {
    cc.streamBitrate.value = s.stream_bitrate;
  }
  if (cc.streamCodec && s.stream_codec !== undefined) {
    cc.streamCodec.value = s. stream_codec;
  }
  if (cc.streamPreset && s.stream_preset !== undefined) {
    cc.streamPreset.value = s.stream_preset;
  }
  if (cc.streamWidth && s.stream_width !== undefined) {
    cc.streamWidth.value = s.stream_width;
  }
  if (cc.streamHeight && s. stream_height !== undefined) {
    cc.streamHeight.value = s.stream_height;
  }
  if (cc.msScales && s.ms_scales !== undefined) {
    cc.msScales.value = s. ms_scales;
  }
  if (cc.msThreshold && s.ms_threshold !== undefined) {
    cc.msThreshold.value = s.ms_threshold;
  }
  if (cc.msNmsRadius && s.ms_nms_radius !== undefined) {
    cc.msNmsRadius.value = s.ms_nms_radius;
  }
  if (cc.detectInterval && s.detect_interval !== undefined) {
    cc.detectInterval.value = s.detect_interval;
  }
  if (cc.maxDrift && s.max_drift !== undefined) {
    cc.maxDrift. value = s.max_drift;
  }
  if (cc.overlayStyle && s.overlay_style !== undefined) {
    cc.overlayStyle.value = s.overlay_style;
  }
  if (cc.boxSize && s.box_size !== undefined) {
    cc.boxSize.value = s.box_size;
  }
  if (cc.boxThickness && s.box_thickness !== undefined) {
    cc.boxThickness. value = s.box_thickness;
  }
  if (cc.queueSize && s.queue_size !== undefined) {
    cc.queueSize.value = s. queue_size;
  }
  if (cc.gpuId && s.gpu_id !== undefined) {
    cc.gpuId.value = s.gpu_id;
  }
}

// =============================================================================
// COLLECT SETTINGS
// =============================================================================

function collectSettings() {
  var s = {};
  s.mode = ccState.currentPreset ?  ccState.currentPreset.id : "standard";
  if (cc.scale) s.scale = parseFloat(cc.scale.value);
  if (cc.threshold) s.threshold = parseFloat(cc.threshold.value);
  if (cc.track) s.track = cc.track.checked;
  if (cc.multiscale) s.multiscale = cc.multiscale.checked;
  if (cc.fp16) s.fp16 = cc.fp16.checked;
  if (cc.streamFps) s.stream_fps = parseInt(cc.streamFps.value);
  if (cc.streamBitrate) s.stream_bitrate = cc.streamBitrate.value;
  if (cc.streamCodec) s.stream_codec = cc.streamCodec.value;
  if (cc.streamPreset) s.stream_preset = cc.streamPreset.value;
  if (cc.streamWidth) s.stream_width = parseInt(cc.streamWidth.value);
  if (cc.streamHeight) s.stream_height = parseInt(cc.streamHeight.value);
  if (cc.msScales) s.ms_scales = cc.msScales.value;
  if (cc.msThreshold) s.ms_threshold = parseFloat(cc.msThreshold.value);
  if (cc.msNmsRadius) s.ms_nms_radius = parseInt(cc.msNmsRadius. value);
  if (cc.detectInterval) s.detect_interval = parseInt(cc.detectInterval. value);
  if (cc.maxDrift) s.max_drift = parseFloat(cc.maxDrift.value);
  if (cc.overlayStyle) s.overlay_style = cc.overlayStyle.value;
  if (cc.boxSize) s.box_size = parseInt(cc. boxSize.value);
  if (cc.boxThickness) s.box_thickness = parseInt(cc.boxThickness.value);
  if (cc.queueSize) s.queue_size = parseInt(cc.queueSize.value);
  if (cc.gpuId) s.gpu_id = cc.gpuId.value;
  if (cc.out && cc.out.value) s.out = cc.out.value;
  if (cc.showPreview) s.show = cc.showPreview.checked;
  return s;
}

// =============================================================================
// CROWD COUNTER CONTROL
// =============================================================================

function toggleCrowdCounter() {
  if (ccState.running) {
    stopCrowdCounter();
  } else {
    startCrowdCounter();
  }
}

function startCrowdCounter() {
  addLog("info", "Starting Crowd Counter...");
  setLoading(true);

  var settings = collectSettings();

  if (window.electronAPI && window. electronAPI.startCrowdCounter) {
    window.electronAPI.startCrowdCounter(settings).then(function (result) {
      setLoading(false);
      if (! result.success) {
        addLog("error", "Failed to start");
      }
    }).catch(function (err) {
      setLoading(false);
      addLog("error", "Start error: " + err. message);
      updateStatus({ running: false, error: true, message: err.message });
    });
  } else {
    setTimeout(function () {
      setLoading(false);
      updateStatus({ running: true, message: "Running (demo)" });
      addLog("warning", "Demo mode - no backend");
    }, 500);
  }

  if (ccState.editing) {
    exitEditMode();
  }

  ccState.pendingChanges = false;
  updateApplyButton();
}

function stopCrowdCounter() {
  addLog("info", "Stopping Crowd Counter...");
  setLoading(true);

  if (window.electronAPI && window.electronAPI.stopCrowdCounter) {
    window.electronAPI.stopCrowdCounter().then(function () {
      setLoading(false);
    }).catch(function (err) {
      setLoading(false);
      addLog("error", "Stop error: " + err.message);
    });
  } else {
    setTimeout(function () {
      setLoading(false);
      updateStatus({ running: false, message: "Stopped" });
    }, 500);
  }
}

function applySettings() {
  addLog("info", "Applying settings...");

  if (ccState.running) {
    stopCrowdCounter();
    setTimeout(function () {
      startCrowdCounter();
    }, 600);
  } else {
    startCrowdCounter();
  }
}

// =============================================================================
// UI UPDATES
// =============================================================================

function updateStatus(status) {
  ccState.running = status.running;

  if (cc.statusValue) {
    cc.statusValue.className = "cc-stat-value cc-stat-status";
    if (status.running) {
      cc.statusValue.textContent = "Running";
      cc.statusValue.classList.add("running");
    } else if (status.error) {
      cc.statusValue.textContent = "Error";
      cc.statusValue.classList.add("error");
    } else {
      cc.statusValue.textContent = status.message || "Stopped";
    }
  }

  if (cc.toggleBtn && cc.toggleIcon) {
    if (status.running) {
      cc.toggleBtn.classList.add("running");
      cc.toggleIcon.className = "fas fa-stop";
    } else {
      cc. toggleBtn.classList.remove("running");
      cc.toggleIcon. className = "fas fa-play";
    }
  }
}

function updateStats(stats) {
  ccState.count = stats.count;
  ccState.fps = stats.fps;
  ccState.mode = stats.mode;

  if (cc.count) cc.count.textContent = stats.count;
  if (cc.fpsValue) cc.fpsValue.textContent = stats.fps;
  if (cc.modeValue) cc.modeValue.textContent = stats.mode;
}

function markPendingChanges() {
  if (! ccState.editing) return;
  ccState.pendingChanges = true;
  updateApplyButton();
}

function updateApplyButton() {
  if (cc.applyBtn) {
    if (ccState.pendingChanges) {
      cc.applyBtn.classList.add("has-changes");
      cc.applyBtn.innerHTML = '<i class="fas fa-check"></i> Apply';
    } else {
      cc.applyBtn.classList.remove("has-changes");
      cc.applyBtn.innerHTML = '<i class="fas fa-check"></i> Apply';
    }
  }
}

function setLoading(loading) {
  if (cc.applyBtn) {
    cc.applyBtn.disabled = loading;
    if (loading) {
      cc.applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }
  }
  if (cc.toggleBtn) {
    cc.toggleBtn.disabled = loading;
  }
}

// =============================================================================
// LOGS
// =============================================================================

function addLog(type, message) {
  var now = new Date();
  var time = now.toTimeString().split(" ")[0];

  ccState.logs.push({
    type: type,
    time: time,
    message: message,
    timestamp: now.getTime(),
  });

  if (ccState.logs.length > ccState.maxLogs) {
    ccState.logs.shift();
  }

  updateMiniLog(type, message);

  if (cc.logTerminal) {
    var entryEl = document.createElement("div");
    entryEl.className = "cc-log-entry cc-log-" + type;
    entryEl.innerHTML = '<span class="cc-log-time">[' + time + ']</span><span class="cc-log-message">' + escapeHtml(message) + '</span>';
    cc.logTerminal.appendChild(entryEl);
    scrollLogToBottom();
  }

  console.log("[CrowdCounter] [" + type. toUpperCase() + "] " + message);
}

function updateMiniLog(type, message) {
  if (cc.miniLogText) {
    cc.miniLogText.textContent = message;
    cc.miniLogText.className = "cc-mini-log-text " + type;
  }
}

function escapeHtml(text) {
  var div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function scrollLogToBottom() {
  if (cc.logTerminal) {
    cc.logTerminal.scrollTop = cc.logTerminal.scrollHeight;
  }
}

function clearLogs() {
  ccState.logs = [];
  if (cc.logTerminal) {
    cc.logTerminal. innerHTML = "";
  }
  addLog("info", "Logs cleared");
}

function copyLogs() {
  var logText = ccState.logs.map(function (log) {
    return "[" + log.time + "] [" + log.type. toUpperCase() + "] " + log.message;
  }).join("\n");

  navigator.clipboard.writeText(logText).then(function () {
    addLog("success", "Logs copied to clipboard");
  }).catch(function () {
    addLog("error", "Failed to copy logs");
  });
}

// =============================================================================
// SAVE PRESET MODAL
// =============================================================================

function openSavePresetModal() {
  if (! cc.savePresetModal) return;
  if (cc.newPresetName) cc.newPresetName.value = "";
  if (cc.newPresetDescription) cc.newPresetDescription. value = "";
  cc.savePresetModal. classList.add("active");
}

function closeSavePresetModal() {
  if (cc.savePresetModal) {
    cc.savePresetModal.classList.remove("active");
  }
}

function saveNewPreset() {
  var name = cc.newPresetName ?  cc.newPresetName.value. trim() : "";
  if (!name) {
    alert("Please enter a preset name");
    return;
  }

  var settings = collectSettings();
  var preset = {
    name: name,
    description: cc.newPresetDescription ?  cc.newPresetDescription.value.trim() : "",
    locked: false,
    settings: settings,
  };

  if (window.electronAPI && window.electronAPI.saveUserPreset) {
    window.electronAPI.saveUserPreset(preset).then(function (result) {
      if (result.success) {
        ccState.customPresets.push(result.preset);
        populatePresetButtons();
        selectPreset(result.preset. id, true);
        closeSavePresetModal();
        addLog("success", "Preset saved:  " + name);
      } else {
        addLog("error", "Failed to save preset");
      }
    }).catch(function (err) {
      addLog("error", "Save preset error: " + err.message);
    });
  } else {
    preset.id = "custom-" + Date.now();
    ccState.customPresets.push(preset);
    populatePresetButtons();
    selectPreset(preset.id, true);
    closeSavePresetModal();
    addLog("success", "Preset saved: " + name);
  }
}

// =============================================================================
// DELETE PRESET MODAL
// =============================================================================

function openDeletePresetModal(preset) {
  if (!cc.deletePresetModal) return;
  ccState.presetToDelete = preset;
  if (cc.deletePresetName) {
    cc.deletePresetName.textContent = preset.name;
  }
  cc.deletePresetModal.classList.add("active");
}

function closeDeletePresetModal() {
  if (cc.deletePresetModal) {
    cc.deletePresetModal. classList.remove("active");
  }
  ccState.presetToDelete = null;
}

function confirmDeletePreset() {
  if (!ccState.presetToDelete) return;

  var presetId = ccState.presetToDelete.id;
  var presetName = ccState.presetToDelete.name;

  if (window.electronAPI && window. electronAPI.deleteUserPreset) {
    window.electronAPI. deleteUserPreset(presetId).then(function (result) {
      if (result.success) {
        removePresetFromState(presetId);
      }
      finishDeletePreset(presetId, presetName);
    }).catch(function (err) {
      addLog("error", "Delete preset error: " + err.message);
    });
  } else {
    removePresetFromState(presetId);
    finishDeletePreset(presetId, presetName);
  }
}

function removePresetFromState(presetId) {
  ccState.customPresets = ccState.customPresets.filter(function (p) {
    return p.id !== presetId;
  });
}

function finishDeletePreset(presetId, presetName) {
  if (ccState.currentPreset && ccState.currentPreset.id === presetId) {
    selectPreset("standard", true);
  }
  populatePresetButtons();
  closeDeletePresetModal();
  addLog("success", "Preset deleted: " + presetName);
}

// =============================================================================
// INIT
// =============================================================================

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCrowdCounter);
} else {
  initCrowdCounter();
}

window.crowdCounter = {
  init: initCrowdCounter,
  start: startCrowdCounter,
  stop: stopCrowdCounter,
  apply: applySettings,
  getState: function () { return ccState; },
  getSettings: collectSettings,
  addLog: addLog,
};

console.log("[CrowdCounter] Module loaded");