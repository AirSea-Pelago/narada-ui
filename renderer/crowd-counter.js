// =============================================================================
// CROWD COUNTER UI – No Lock, Experimental Settings, Log Mirror
// =============================================================================

var ccState = {
  running: false,
  dirty: false,               // true when settings differ from last Apply
  count: 0,
  rawCount: 0,
  viewportCount: 0,
  sweepTotal: 0,
  manualCorrection: 0,
  fps: 0,
  mode: "DET",
  currentPreset: null,
  builtinPresets: [],
  customPresets: [],
  logs: [],
  maxLogs: 500,
  presetToDelete: null,
};

var cc = {};

// =============================================================================
// INITIALIZATION
// =============================================================================

function initCrowdCounter() {
  console.log("[CrowdCounter] Initializing...");
  cacheElements();
  setupEventListeners();
  setupIPCListeners();
  loadPresets();
  addLog("info", "Crowd Counter ready");
}

function cacheElements() {
  cc = {
    count: document.getElementById("cc-count"),
    countLabel: document.getElementById("cc-count-label"),
    sweepTotal: document.getElementById("cc-sweep-total"),
    sweepReset: document.getElementById("cc-sweep-reset"),
    fpsValue: document.getElementById("cc-fps-value"),
    modeValue: document.getElementById("cc-mode-value"),
    statusValue: document.getElementById("cc-status-value"),
    correctionReset: document.getElementById("cc-correction-reset"),
    correctionValue: document.getElementById("cc-correction-value"),
    toggleBtn: document.getElementById("cc-toggle-btn"),
    toggleIcon: document.getElementById("cc-toggle-icon"),
    miniLogText: document.getElementById("cc-mini-log-text"),
    presetButtons: document.getElementById("cc-preset-buttons"),
    settingsContainer: document.getElementById("cc-settings-container"),
    advancedContainer: document.getElementById("cc-advanced-container"),
    cancelBtn: document.getElementById("cc-cancel-btn"),
    applyBtn: document.getElementById("cc-apply-btn"),
    scale: document.getElementById("cc-scale"),
    scaleInput: document.getElementById("cc-scale-input"),
    threshold: document.getElementById("cc-threshold"),
    thresholdInput: document.getElementById("cc-threshold-input"),
    advancedToggle: document.getElementById("cc-advanced-toggle"),
    sourceUrl: document.getElementById("cc-source-url"),
    browseSource: document.getElementById("cc-browse-source"),
    streamOut: document.getElementById("cc-stream-out"),
    streamCodec: document.getElementById("cc-stream-codec"),
    streamBitrate: document.getElementById("cc-stream-bitrate"),
    sweepMode: document.getElementById("cc-sweep-mode"),
    sweepStatus: document.getElementById("cc-sweep-status"),
    zoneEnabled: document.getElementById("cc-zone-enabled"),
    zoneStatus: document.getElementById("cc-zone-status"),
    zoneOverlay: document.getElementById("cc-zone-overlay"),
    zoneMargin: document.getElementById("cc-zone-margin"),
    overlayStyle: document.getElementById("cc-overlay-style"),
    boxSize: document.getElementById("cc-box-size"),
    boxThickness: document.getElementById("cc-box-thickness"),
    showPreview: document.getElementById("cc-show-preview"),
    streamFps: document.getElementById("cc-stream-fps"),
    streamPreset: document.getElementById("cc-stream-preset"),
    queueSize: document.getElementById("cc-queue-size"),
    gpuId: document.getElementById("cc-gpu-id"),
    detectInterval: document.getElementById("cc-detect-interval"),
    maxDrift: document.getElementById("cc-max-drift"),
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
    deletePresetConfirm: document.getElementById("cc-delete-preset-confirm"),
    deletePresetName: document.getElementById("cc-delete-preset-name"),
  };
}

// =============================================================================
// EVENT LISTENERS
// =============================================================================

function setupEventListeners() {
  if (cc.toggleBtn) cc.toggleBtn.addEventListener("click", toggleCrowdCounter);
  if (cc.cancelBtn) cc.cancelBtn.addEventListener("click", cancelChanges);
  if (cc.applyBtn) cc.applyBtn.addEventListener("click", applySettings);

  if (cc.scale && cc.scaleInput) {
    cc.scale.addEventListener("input", function () {
      cc.scaleInput.value = parseFloat(cc.scale.value).toFixed(2);
      markDirty();
    });
    cc.scaleInput.addEventListener("input", function () {
      var val = parseFloat(cc.scaleInput.value);
      if (!isNaN(val) && val >= 0.2 && val <= 3.0) cc.scale.value = val;
      markDirty();
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
      markDirty();
    });
    cc.thresholdInput.addEventListener("input", function () {
      var val = parseFloat(cc.thresholdInput.value);
      if (!isNaN(val) && val >= 0.1 && val <= 0.9) cc.threshold.value = val;
      markDirty();
    });
    cc.thresholdInput.addEventListener("blur", function () {
      var val = parseFloat(cc.thresholdInput.value);
      if (isNaN(val) || val < 0.1) val = 0.1;
      if (val > 0.9) val = 0.9;
      cc.thresholdInput.value = val.toFixed(2);
      cc.threshold.value = val;
    });
  }

  if (cc.sweepMode && cc.sweepStatus) {
    cc.sweepMode.addEventListener("change", function () {
      cc.sweepStatus.textContent = cc.sweepMode.checked ? "On" : "Off";
      if (cc.sweepMode.checked) {
        setZoneEnabled(true, { markDirty: false });
        if (window.streamManager) {
          window.streamManager.setZoneEditing(true, { skipApply: true });
        }
      }
      markDirty();
      if (ccState.running) addLog("warning", "Apply changes to switch street sweep mode");
      updateCountLabels();
    });
  }

  if (cc.zoneEnabled && cc.zoneStatus) {
    cc.zoneEnabled.addEventListener("change", function () {
      cc.zoneStatus.textContent = cc.zoneEnabled.checked ? "On" : "Off";
      markDirty();
      if (!cc.zoneEnabled.checked && window.streamManager) {
        window.streamManager.setZoneEditing(false, { skipApply: true });
      }
      applyZoneSettingsNow(cc.zoneEnabled.checked ? "Enabling counting zone..." : "Disabling counting zone...");
      updateVideoPlayerCrowdStats();
    });
  }

  if (cc.correctionReset) {
    cc.correctionReset.addEventListener("click", function () {
      setManualCorrection(0);
      if (window.streamManager) window.streamManager.clearManualCorrections();
    });
  }

  if (cc.sweepReset) cc.sweepReset.addEventListener("click", resetSweepCounter);

  if (cc.browseSource) {
    cc.browseSource.addEventListener("click", function () {
      if (!window.electronAPI || !window.electronAPI.selectVideoFile) return;
      window.electronAPI.selectVideoFile().then(function (result) {
        if (!result || result.canceled || !result.path) return;
        if (cc.sourceUrl) {
          cc.sourceUrl.value = result.path;
          markDirty();
        }
      });
    });
  }

  if (cc.advancedToggle) {
    cc.advancedToggle.addEventListener("change", function () {
      if (cc.advancedContainer) {
        cc.advancedContainer.style.display = cc.advancedToggle.checked ? "block" : "none";
      }
    });
  }

  if (cc.logToggle) {
    cc.logToggle.addEventListener("change", function () {
      if (cc.logContainer) {
        cc.logContainer.style.display = cc.logToggle.checked ? "block" : "none";
        if (cc.logToggle.checked) scrollLogToBottom();
      }
    });
  }

  if (cc.logClear) cc.logClear.addEventListener("click", clearLogs);
  if (cc.logCopy) cc.logCopy.addEventListener("click", copyLogs);

  // Preset modals (unchanged)
  if (cc.savePresetClose) cc.savePresetClose.addEventListener("click", closeSavePresetModal);
  if (cc.savePresetCancel) cc.savePresetCancel.addEventListener("click", closeSavePresetModal);
  if (cc.savePresetConfirm) cc.savePresetConfirm.addEventListener("click", saveNewPreset);
  if (cc.savePresetModal) {
    cc.savePresetModal.addEventListener("click", function (e) {
      if (e.target === cc.savePresetModal) closeSavePresetModal();
    });
  }
  if (cc.deletePresetClose) cc.deletePresetClose.addEventListener("click", closeDeletePresetModal);
  if (cc.deletePresetCancel) cc.deletePresetCancel.addEventListener("click", closeDeletePresetModal);
  if (cc.deletePresetConfirm) cc.deletePresetConfirm.addEventListener("click", confirmDeletePreset);
  if (cc.deletePresetModal) {
    cc.deletePresetModal.addEventListener("click", function (e) {
      if (e.target === cc.deletePresetModal) closeDeletePresetModal();
    });
  }

  // Mark dirty on all other inputs
  var allInputs = [
    cc.sourceUrl, cc.streamOut, cc.streamCodec, cc.streamBitrate,
    cc.sweepMode, cc.zoneOverlay, cc.zoneMargin,
    cc.overlayStyle, cc.boxSize, cc.boxThickness, cc.showPreview,
    cc.streamFps, cc.streamPreset, cc.queueSize, cc.gpuId,
    cc.detectInterval, cc.maxDrift,
  ];
  allInputs.forEach(function (input) {
    if (input) {
      input.addEventListener("change", markDirty);
      input.addEventListener("input", markDirty);
    }
  });
}

// =============================================================================
// IPC LISTENERS
// =============================================================================

function setupIPCListeners() {
  if (!window.electronAPI) return;
  window.electronAPI.onCrowdCounterStatus(function (status) {
    updateStatus(status);
    if (status.running) addLog("success", "Crowd Counter started");
    else if (status.error) addLog("error", status.message || "Error occurred");
    else addLog("status", status.message || "Stopped");
  });
  window.electronAPI.onCrowdCounterStats(function (stats) {
    updateStats(stats);
  });
  window.electronAPI.onCrowdCounterLog(function (log) {
    addLog(log.type || "info", log.message);
  });
}

// =============================================================================
// PRESETS (unchanged)
// =============================================================================

function getDefaultPresets() {
  return [
    {
      id: "standard",
      name: "Standard",
      description: "Fast detection for dense crowds",
      settings: {
        mode: "standard", scale: 0.7, threshold: 0.39,
        source_url: "rtmp://localhost:1935/matrice4t", stream_out: "rtmp://localhost:1935/cognitiveOutput",
        zone_enabled: false, zone_overlay: true, zone_margin: 80,
        zone_rect_norm: "0.1000,0.1000,0.9000,0.9000", sweep_mode: false,
        overlay_style: "boxes", box_size: 14, box_thickness: 2,
        stream_codec: "libx264", stream_bitrate: "5000k",
        stream_fps: 24, stream_preset: "ultrafast", queue_size: 2, gpu_id: "0",
        detect_interval: 2, max_drift: 20.0, show: false,
        track: false, multiscale: false, ms_scales: "1.0", ms_threshold: 0.39, ms_nms_radius: 12,
        stream_width: 0, stream_height: 0, fp16: true,
      },
    },
    {
      id: "traffic",
      name: "Traffic",
      description: "Optimized for motorcycles/vehicles",
      settings: {
        mode: "traffic", scale: 0.75, threshold: 0.28,
        source_url: "rtmp://localhost:1935/matrice4t", stream_out: "rtmp://localhost:1935/cognitiveOutput",
        zone_enabled: true, zone_overlay: true, zone_margin: 80,
        zone_rect_norm: "0.1000,0.1000,0.9000,0.9000", sweep_mode: true,
        overlay_style: "boxes", box_size: 14, box_thickness: 2,
        stream_codec: "libx264", stream_bitrate: "5000k",
        stream_fps: 24, stream_preset: "ultrafast", queue_size: 2, gpu_id: "0",
        detect_interval: 10, max_drift: 25.0, show: false,
        track: true, multiscale: false, ms_scales: "0.5,0.75,1.0,1.25", ms_threshold: 0.28, ms_nms_radius: 12,
        stream_width: 0, stream_height: 0, fp16: true,
      },
    },
  ];
}

function loadPresets() {
  if (window.electronAPI && window.electronAPI.getBuiltinPresets) {
    window.electronAPI.getBuiltinPresets().then(function (presets) {
      ccState.builtinPresets = presets.length ? presets : getDefaultPresets();
      loadUserPresetsAndFinish();
    }).catch(function () {
      ccState.builtinPresets = getDefaultPresets();
      loadUserPresetsAndFinish();
    });
  } else {
    ccState.builtinPresets = getDefaultPresets();
    loadUserPresetsAndFinish();
  }
}

function loadUserPresetsAndFinish() {
  if (window.electronAPI && window.electronAPI.loadUserPresets) {
    window.electronAPI.loadUserPresets().then(function (result) {
      if (result.success) ccState.customPresets = result.customPresets || [];
      finishLoadingPresets();
    }).catch(function () { finishLoadingPresets(); });
  } else {
    finishLoadingPresets();
  }
}

function finishLoadingPresets() {
  var lastPresetId = "standard";
  if (window.electronAPI && window.electronAPI.getLastUsedPreset) {
    window.electronAPI.getLastUsedPreset().then(function (result) {
      lastPresetId = result.presetId || "standard";
      populatePresetButtons();
      selectPreset(lastPresetId, false);
    }).catch(function () { populatePresetButtons(); selectPreset("standard", false); });
  } else {
    populatePresetButtons();
    selectPreset("standard", false);
  }
}

function populatePresetButtons() {
  if (!cc.presetButtons) return;
  cc.presetButtons.innerHTML = "";
  ccState.builtinPresets.forEach(function (p) { cc.presetButtons.appendChild(createPresetButton(p, false)); });
  ccState.customPresets.forEach(function (p) { cc.presetButtons.appendChild(createPresetButton(p, true)); });
  var addBtn = document.createElement("button");
  addBtn.className = "cc-preset-btn cc-preset-add";
  addBtn.innerHTML = '<i class="fas fa-plus"></i>';
  addBtn.title = "Add Custom Preset";
  addBtn.addEventListener("click", openSavePresetModal);
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
      if (!e.target.closest(".cc-preset-delete")) selectPreset(preset.id, true);
    });
    var deleteBtn = btn.querySelector(".cc-preset-delete");
    if (deleteBtn) deleteBtn.addEventListener("click", function (e) { e.stopPropagation(); openDeletePresetModal(preset); });
  } else {
    btn.textContent = preset.name;
    btn.addEventListener("click", function () { selectPreset(preset.id, true); });
  }
  if (ccState.currentPreset && ccState.currentPreset.id === preset.id) btn.classList.add("active");
  return btn;
}

function selectPreset(presetId, saveLastUsed) {
  var preset = null;
  for (var i = 0; i < ccState.builtinPresets.length; i++) {
    if (ccState.builtinPresets[i].id === presetId) { preset = ccState.builtinPresets[i]; break; }
  }
  if (!preset) {
    for (var i = 0; i < ccState.customPresets.length; i++) {
      if (ccState.customPresets[i].id === presetId) { preset = ccState.customPresets[i]; break; }
    }
  }
  if (!preset && ccState.builtinPresets.length > 0) preset = ccState.builtinPresets[0];
  if (!preset) return;
  ccState.currentPreset = preset;
  var btns = document.querySelectorAll(".cc-preset-btn");
  btns.forEach(function (b) { b.classList.remove("active"); if (b.dataset.preset === preset.id) b.classList.add("active"); });
  applySettingsToUI(preset.settings);
  if (saveLastUsed && window.electronAPI && window.electronAPI.setLastUsedPreset) {
    window.electronAPI.setLastUsedPreset(preset.id);
  }
  ccState.dirty = false;
  updateApplyButton();
  addLog("info", "Preset: " + preset.name);
}

function getPresetOptions() {
  var presets = [];
  ccState.builtinPresets.forEach(function (preset) {
    presets.push({ id: preset.id, name: preset.name, type: "builtin" });
  });
  ccState.customPresets.forEach(function (preset) {
    presets.push({ id: preset.id, name: preset.name, type: "custom" });
  });
  return presets;
}

function setBasicSetting(key, value, options) {
  options = options || {};
  if (key === "scale" && cc.scale && cc.scaleInput) {
    var scale = Math.max(0.2, Math.min(3.0, parseFloat(value)));
    if (isNaN(scale)) return;
    cc.scale.value = scale;
    cc.scaleInput.value = scale.toFixed(2);
  } else if (key === "threshold" && cc.threshold && cc.thresholdInput) {
    var threshold = Math.max(0.1, Math.min(0.9, parseFloat(value)));
    if (isNaN(threshold)) return;
    cc.threshold.value = threshold;
    cc.thresholdInput.value = threshold.toFixed(2);
  } else if (key === "sweep_mode" && cc.sweepMode && cc.sweepStatus) {
    cc.sweepMode.checked = !!value;
    cc.sweepStatus.textContent = cc.sweepMode.checked ? "On" : "Off";
    if (cc.sweepMode.checked && cc.zoneEnabled && !cc.zoneEnabled.checked) {
      setZoneEnabled(true, { markDirty: false });
    }
    if (cc.sweepMode.checked && window.streamManager) {
      window.streamManager.setZoneEditing(true, { skipApply: true });
    }
    if (ccState.running) addLog("warning", "Apply changes to switch street sweep mode");
    updateCountLabels();
  } else if (key === "zone_enabled") {
    setZoneEnabled(!!value, { markDirty: false });
    if (!cc.zoneEnabled.checked && window.streamManager) {
      window.streamManager.setZoneEditing(false, { skipApply: true });
    }
    applyZoneSettingsNow(cc.zoneEnabled.checked ? "Enabling counting zone..." : "Disabling counting zone...");
  } else {
    return;
  }
  markDirty();
  updateVideoPlayerCrowdStats();
  if (options.apply && !ccState.running) applySettings();
}

function applySettingsToUI(s) {
  if (cc.scale && s.scale !== undefined) cc.scale.value = s.scale;
  if (cc.scaleInput && s.scale !== undefined) cc.scaleInput.value = parseFloat(s.scale).toFixed(2);
  if (cc.threshold && s.threshold !== undefined) cc.threshold.value = s.threshold;
  if (cc.thresholdInput && s.threshold !== undefined) cc.thresholdInput.value = parseFloat(s.threshold).toFixed(2);
  if (cc.sourceUrl && s.source_url !== undefined) cc.sourceUrl.value = s.source_url;
  if (cc.streamOut && s.stream_out !== undefined) cc.streamOut.value = s.stream_out;
  if (cc.sweepMode && s.sweep_mode !== undefined) { cc.sweepMode.checked = s.sweep_mode; cc.sweepStatus.textContent = s.sweep_mode ? "On" : "Off"; }
  if (cc.zoneEnabled && s.zone_enabled !== undefined) { cc.zoneEnabled.checked = s.zone_enabled; cc.zoneStatus.textContent = s.zone_enabled ? "On" : "Off"; }
  if (cc.zoneOverlay && s.zone_overlay !== undefined) cc.zoneOverlay.checked = s.zone_overlay;
  if (cc.zoneMargin && s.zone_margin !== undefined) cc.zoneMargin.value = s.zone_margin;
  if (cc.overlayStyle && s.overlay_style !== undefined) cc.overlayStyle.value = s.overlay_style;
  if (cc.boxSize && s.box_size !== undefined) cc.boxSize.value = s.box_size;
  if (cc.boxThickness && s.box_thickness !== undefined) cc.boxThickness.value = s.box_thickness;
  if (cc.streamCodec && s.stream_codec !== undefined) cc.streamCodec.value = s.stream_codec;
  if (cc.streamBitrate && s.stream_bitrate !== undefined) cc.streamBitrate.value = s.stream_bitrate;
  if (cc.showPreview && s.show !== undefined) cc.showPreview.checked = s.show;
  if (cc.streamFps && s.stream_fps !== undefined) cc.streamFps.value = s.stream_fps;
  if (cc.streamPreset && s.stream_preset !== undefined) cc.streamPreset.value = s.stream_preset;
  if (cc.queueSize && s.queue_size !== undefined) cc.queueSize.value = s.queue_size;
  if (cc.gpuId && s.gpu_id !== undefined) cc.gpuId.value = s.gpu_id;
  if (cc.detectInterval && s.detect_interval !== undefined) cc.detectInterval.value = s.detect_interval;
  if (cc.maxDrift && s.max_drift !== undefined) cc.maxDrift.value = s.max_drift;
  if (s.zone_rect_norm && window.streamManager && window.streamManager.setZoneRectFromNormString) {
    window.streamManager.setZoneRectFromNormString(s.zone_rect_norm, { silent: true });
  }
}

// =============================================================================
// COLLECT SETTINGS (no hardcoded defaults – pull from UI)
// =============================================================================

function collectSettings() {
  var s = {};
  s.mode = ccState.currentPreset ? ccState.currentPreset.id : "standard";
  s.fp16 = true;
  s.stream_width = 0;
  s.stream_height = 0;
  if (cc.sourceUrl) s.source_url = cc.sourceUrl.value.trim();
  if (cc.streamOut) s.stream_out = cc.streamOut.value.trim();
  if (cc.scale) s.scale = parseFloat(cc.scale.value);
  if (cc.threshold) s.threshold = parseFloat(cc.threshold.value);
  if (cc.sweepMode) s.sweep_mode = cc.sweepMode.checked;
  if (cc.zoneEnabled) s.zone_enabled = cc.zoneEnabled.checked;
  if (cc.zoneOverlay) s.zone_overlay = cc.zoneOverlay.checked;
  if (cc.zoneMargin) s.zone_margin = parseInt(cc.zoneMargin.value);
  if (window.streamManager && window.streamManager.getZoneRectNorm) s.zone_rect_norm = window.streamManager.getZoneRectNorm();
  if (cc.overlayStyle) s.overlay_style = cc.overlayStyle.value;
  if (cc.boxSize) s.box_size = parseInt(cc.boxSize.value);
  if (cc.boxThickness) s.box_thickness = parseInt(cc.boxThickness.value);
  if (cc.streamCodec) s.stream_codec = cc.streamCodec.value;
  if (cc.streamBitrate) s.stream_bitrate = cc.streamBitrate.value.trim();
  if (cc.showPreview) s.show = cc.showPreview.checked;
  if (cc.streamFps) s.stream_fps = parseInt(cc.streamFps.value);
  if (cc.streamPreset) s.stream_preset = cc.streamPreset.value.trim();
  if (cc.queueSize) s.queue_size = parseInt(cc.queueSize.value);
  if (cc.gpuId) s.gpu_id = cc.gpuId.value.trim();
  if (cc.detectInterval) s.detect_interval = parseInt(cc.detectInterval.value);
  if (cc.maxDrift) s.max_drift = parseFloat(cc.maxDrift.value);
  return s;
}

// =============================================================================
// CROWD COUNTER CONTROL
// =============================================================================

function toggleCrowdCounter() {
  if (ccState.running) stopCrowdCounter();
  else startCrowdCounter();
}

function startCrowdCounter() {
  addLog("info", "Starting Crowd Counter...");
  setLoading(true);
  var settings = collectSettings();
  if (window.electronAPI && window.electronAPI.startCrowdCounter) {
    window.electronAPI.startCrowdCounter(settings).then(function (result) {
      setLoading(false);
      if (!result.success) addLog("error", "Failed to start");
      else ccState.dirty = false;
      updateApplyButton();
    }).catch(function (err) {
      setLoading(false);
      addLog("error", "Start error: " + err.message);
      updateStatus({ running: false, error: true, message: err.message });
    });
  } else {
    setTimeout(function () {
      setLoading(false);
      updateStatus({ running: true, message: "Running (demo)" });
      addLog("warning", "Demo mode - no backend");
    }, 500);
  }
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
  if (ccState.running) {
    addLog("info", "Restarting with new settings...");
    stopCrowdCounter();
    setTimeout(function () { startCrowdCounter(); }, 600);
  } else {
    startCrowdCounter();
  }
}

function cancelChanges() {
  if (ccState.currentPreset) {
    applySettingsToUI(ccState.currentPreset.settings);
    addLog("info", "Settings reverted to current preset");
  }
  ccState.dirty = false;
  updateApplyButton();
}

function applyZoneSettingsNow(message) {
  if (!ccState.running) return;
  var settings = collectSettings();
  addLog("info", message || "Applying counting zone...");
  window.electronAPI.updateCrowdCounterConfig({
    zone_enabled: settings.zone_enabled,
    zone_overlay: false,
    zone_margin: settings.zone_margin,
    zone_rect_norm: settings.zone_rect_norm,
  }).then(function (result) {
    if (!result || !result.success) {
      addLog("error", "Zone update failed");
      return;
    }
    addLog("success", "Counting zone updated");
  }).catch(function (err) {
    addLog("error", "Zone update failed: " + err.message);
  });
}

function updateVideoPlayerCrowdStats() {
  if (window.streamManager && window.streamManager.updateCrowdStats) {
    window.streamManager.updateCrowdStats({
      count: ccState.count,
      current: ccState.count,
      total: ccState.sweepTotal + ccState.manualCorrection,
      viewport: ccState.viewportCount,
      fps: ccState.fps,
      mode: ccState.mode,
    });
  }
}

// =============================================================================
// UI UPDATES
// =============================================================================

function updateStatus(status) {
  ccState.running = status.running;
  if (cc.statusValue) {
    cc.statusValue.className = "cc-stat-value cc-stat-status";
    if (status.running) { cc.statusValue.textContent = "Running"; cc.statusValue.classList.add("running"); }
    else if (status.error) { cc.statusValue.textContent = "Error"; cc.statusValue.classList.add("error"); }
    else cc.statusValue.textContent = status.message || "Stopped";
  }
  if (cc.toggleBtn && cc.toggleIcon) {
    if (status.running) { cc.toggleBtn.classList.add("running"); cc.toggleIcon.className = "fas fa-stop"; }
    else { cc.toggleBtn.classList.remove("running"); cc.toggleIcon.className = "fas fa-play"; }
  }
  updateCountLabels();
  var panelStatus = document.getElementById("cc-panel-status-label");
  if (panelStatus) {
    if (status.running) panelStatus.textContent = "Running";
    else if (status.error) panelStatus.textContent = "Error";
    else panelStatus.textContent = status.message || "Ready";
  }
}

function updateStats(stats) {
  var mode = (stats.mode || "").toUpperCase();
  var rawCount = Number(stats.count);
  var viewportCount = stats.viewport !== undefined && stats.viewport !== null ? Number(stats.viewport) : rawCount;
  var sweepTotal = stats.total !== undefined && stats.total !== null ? Number(stats.total) : rawCount;
  if (mode === "SWEEP") {
    rawCount = viewportCount;
  }
  if (!Number.isFinite(rawCount)) rawCount = 0;
  if (!Number.isFinite(viewportCount)) viewportCount = rawCount;
  if (!Number.isFinite(sweepTotal)) sweepTotal = rawCount;
  ccState.rawCount = rawCount;
  ccState.viewportCount = viewportCount;
  ccState.sweepTotal = mode === "SWEEP" ? sweepTotal : rawCount;
  ccState.count = ccState.rawCount + ccState.manualCorrection;
  ccState.fps = Number.isFinite(Number(stats.fps)) ? Number(stats.fps) : 0;
  ccState.mode = mode || "DET";
  updateCountLabels();
  if (cc.fpsValue) cc.fpsValue.textContent = ccState.fps.toFixed(1);
  if (cc.modeValue) cc.modeValue.textContent = ccState.mode;
  updateVideoPlayerCrowdStats();
}

function setManualCorrection(value) {
  var correction = parseInt(value, 10);
  ccState.manualCorrection = Number.isFinite(correction) ? Math.max(0, correction) : 0;
  ccState.count = ccState.rawCount + ccState.manualCorrection;
  updateCountLabels();
  if (cc.correctionValue) cc.correctionValue.textContent = String(ccState.manualCorrection);
  updateVideoPlayerCrowdStats();
  addLog("info", "Manual correction: " + ccState.manualCorrection);
}

function updateCountLabels() {
  var sweepEnabled = ccState.mode === "SWEEP" || (cc.sweepMode && cc.sweepMode.checked);
  if (cc.countLabel) cc.countLabel.textContent = sweepEnabled ? "Current In Zone" : "Current Count";
  if (cc.count) cc.count.textContent = String(ccState.count);
  if (cc.sweepTotal) {
    var total = sweepEnabled ? ccState.sweepTotal + ccState.manualCorrection : ccState.count;
    cc.sweepTotal.textContent = String(total);
  }
  if (cc.sweepReset) cc.sweepReset.disabled = !ccState.running || !sweepEnabled;
}

function resetSweepCounter() {
  if (!ccState.running || !window.electronAPI || !window.electronAPI.updateCrowdCounterConfig) return;
  addLog("info", "Resetting street sweep total...");
  window.electronAPI.updateCrowdCounterConfig({ reset_sweep: true }).then(function (result) {
    if (!result || !result.success) {
      addLog("error", "Street sweep reset failed");
      return;
    }
    ccState.viewportCount = 0;
    ccState.sweepTotal = 0;
    ccState.rawCount = 0;
    ccState.count = ccState.manualCorrection;
    updateCountLabels();
    updateVideoPlayerCrowdStats();
    addLog("success", "Street sweep total reset");
  }).catch(function (err) {
    addLog("error", "Street sweep reset failed: " + err.message);
  });
}

function markDirty() {
  ccState.dirty = true;
  updateApplyButton();
}

function setZoneEnabled(enabled, options) {
  options = options || {};
  if (cc.zoneEnabled) cc.zoneEnabled.checked = !!enabled;
  if (cc.zoneStatus) cc.zoneStatus.textContent = enabled ? "On" : "Off";
  if (!enabled && window.streamManager) window.streamManager.setZoneEditing(false, { skipApply: true });
  if (options.markDirty) markDirty();
  updateVideoPlayerCrowdStats();
}

function beginZoneEdit() {
  setZoneEnabled(true, { markDirty: true });
}

function onZoneRectChanged() {
  markDirty();
}

function updateApplyButton() {
  if (cc.applyBtn && cc.cancelBtn) {
    if (ccState.dirty) {
      cc.applyBtn.style.display = "flex";
      cc.cancelBtn.style.display = "flex";
      cc.applyBtn.classList.add("has-changes");
    } else {
      cc.applyBtn.style.display = "none";
      cc.cancelBtn.style.display = "none";
      cc.applyBtn.classList.remove("has-changes");
    }
  }
}

function setLoading(loading) {
  if (cc.applyBtn) cc.applyBtn.disabled = loading;
  if (cc.cancelBtn) cc.cancelBtn.disabled = loading;
  if (cc.toggleBtn) cc.toggleBtn.disabled = loading;
}

// =============================================================================
// LOGS (unchanged except added "stdout" visual)
// =============================================================================

function addLog(type, message) {
  var now = new Date();
  var time = now.toTimeString().split(" ")[0];
  ccState.logs.push({ type: type, time: time, message: message, timestamp: now.getTime() });
  if (ccState.logs.length > ccState.maxLogs) ccState.logs.shift();
  updateMiniLog(type, message);
  if (cc.logTerminal) {
    var entryEl = document.createElement("div");
    entryEl.className = "cc-log-entry cc-log-" + type;
    entryEl.innerHTML = '<span class="cc-log-time">[' + time + ']</span><span class="cc-log-message">' + escapeHtml(message) + '</span>';
    cc.logTerminal.appendChild(entryEl);
    scrollLogToBottom();
  }
}

function updateMiniLog(type, message) {
  if (cc.miniLogText) {
    cc.miniLogText.textContent = message;
    cc.miniLogText.className = "cc-mini-log-text " + type;
  }
}
function escapeHtml(text) { var div = document.createElement("div"); div.textContent = text; return div.innerHTML; }
function scrollLogToBottom() { if (cc.logTerminal) cc.logTerminal.scrollTop = cc.logTerminal.scrollHeight; }
function clearLogs() { ccState.logs = []; if (cc.logTerminal) cc.logTerminal.innerHTML = ""; addLog("info", "Logs cleared"); }
function copyLogs() {
  var logText = ccState.logs.map(function (l) { return "[" + l.time + "] [" + l.type.toUpperCase() + "] " + l.message; }).join("\n");
  navigator.clipboard.writeText(logText).then(function () { addLog("success", "Logs copied"); }).catch(function () { addLog("error", "Failed to copy logs"); });
}

// =============================================================================
// SAVE/DELETE PRESET MODALS (unchanged)
// =============================================================================

function openSavePresetModal() {
  if (!cc.savePresetModal) return;
  if (cc.newPresetName) cc.newPresetName.value = "";
  if (cc.newPresetDescription) cc.newPresetDescription.value = "";
  cc.savePresetModal.classList.add("active");
}
function closeSavePresetModal() { if (cc.savePresetModal) cc.savePresetModal.classList.remove("active"); }
function saveNewPreset() {
  var name = cc.newPresetName ? cc.newPresetName.value.trim() : "";
  if (!name) { alert("Please enter a preset name"); return; }
  var settings = collectSettings();
  var preset = { name: name, description: cc.newPresetDescription ? cc.newPresetDescription.value.trim() : "", locked: false, settings: settings };
  if (window.electronAPI && window.electronAPI.saveUserPreset) {
    window.electronAPI.saveUserPreset(preset).then(function (result) {
      if (result.success) { ccState.customPresets.push(result.preset); populatePresetButtons(); selectPreset(result.preset.id, true); closeSavePresetModal(); addLog("success", "Preset saved: " + name); }
      else addLog("error", "Failed to save preset");
    }).catch(function (err) { addLog("error", "Save preset error: " + err.message); });
  } else {
    preset.id = "custom-" + Date.now(); ccState.customPresets.push(preset); populatePresetButtons(); selectPreset(preset.id, true); closeSavePresetModal(); addLog("success", "Preset saved: " + name);
  }
}
function openDeletePresetModal(preset) { if (!cc.deletePresetModal) return; ccState.presetToDelete = preset; if (cc.deletePresetName) cc.deletePresetName.textContent = preset.name; cc.deletePresetModal.classList.add("active"); }
function closeDeletePresetModal() { if (cc.deletePresetModal) cc.deletePresetModal.classList.remove("active"); ccState.presetToDelete = null; }
function confirmDeletePreset() {
  if (!ccState.presetToDelete) return;
  var presetId = ccState.presetToDelete.id; var presetName = ccState.presetToDelete.name;
  if (window.electronAPI && window.electronAPI.deleteUserPreset) {
    window.electronAPI.deleteUserPreset(presetId).then(function (result) { if (result.success) removePresetFromState(presetId); finishDeletePreset(presetId, presetName); }).catch(function (err) { addLog("error", "Delete preset error: " + err.message); });
  } else { removePresetFromState(presetId); finishDeletePreset(presetId, presetName); }
}
function removePresetFromState(presetId) { ccState.customPresets = ccState.customPresets.filter(function (p) { return p.id !== presetId; }); }
function finishDeletePreset(presetId, presetName) { if (ccState.currentPreset && ccState.currentPreset.id === presetId) selectPreset("standard", true); populatePresetButtons(); closeDeletePresetModal(); addLog("success", "Preset deleted: " + presetName); }

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
  getPresets: getPresetOptions,
  getCurrentPresetId: function () { return ccState.currentPreset ? ccState.currentPreset.id : ""; },
  selectPreset: function (presetId) { selectPreset(presetId, true); },
  setBasicSetting: setBasicSetting,
  setManualCorrection: setManualCorrection,
  getManualCorrection: function () { return ccState.manualCorrection; },
  setZoneEnabled: setZoneEnabled,
  beginZoneEdit: beginZoneEdit,
  onZoneRectChanged: onZoneRectChanged,
  applyZoneSettingsNow: applyZoneSettingsNow,
  resetSweepCounter: resetSweepCounter,
  markDirty: markDirty,
  addLog: addLog,
};

console.log("[CrowdCounter] Module loaded");
