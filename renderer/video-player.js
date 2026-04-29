// Video Stream Player - Browser Compatible with WebRTC Support
// HLS.js loaded from CDN in index.html

class VideoStreamPlayer {
  constructor(containerId, streamConfig, streamManager) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.streamManager = streamManager;

    if (!this.container) {
      console.error(`Container not found: ${containerId}`);
      return;
    }

    this.streamConfig = streamConfig;
    this.player = null;
    this.videoElement = null;
    this.hls = null;
    this.peerConnection = null;
    this.isPlaying = false;
    this.isMuted = false;
    this.volume = 1.0;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.manualMode = false;
    this.manualPoints = [];
    this.manualCanvas = null;
    this.zoneOverlay = null;
    this.zoneDrag = null;
    this.hasVideoFrame = false;
    this.boundZoneMove = (e) => this.moveZoneDrag(e);
    this.boundZoneEnd = () => this.endZoneDrag();
    this.boundResize = () => this.updateInteractiveLayers();
    this.resizeObserver = null;

    this.stats = {
      bitrate: 0,
      resolution: "N/A",
      fps: 0,
      buffer: 0,
      droppedFrames: 0,
    };

    this.init();
  }

  init() {
    this.container.innerHTML = "";

    this.container.innerHTML = `
      <div class="video-player-wrapper">
        <div class="video-header">
          <h4 class="video-title">${
            this.streamConfig.displayName || this.streamConfig.name
          }</h4>
          <div class="video-status">
            <span class="status-indicator offline"></span>
            <span class="status-text">Offline</span>
          </div>
        </div>
        
        <div class="video-container">
          <video id="video-${this.containerId}" class="video-element" 
                 playsinline webkit-playsinline muted></video>
          <div class="zone-edit-overlay">
            <div class="zone-box">
              <span class="zone-label">COUNTING ZONE</span>
              <span class="zone-handle zone-handle-nw" data-handle="nw"></span>
              <span class="zone-handle zone-handle-ne" data-handle="ne"></span>
              <span class="zone-handle zone-handle-sw" data-handle="sw"></span>
              <span class="zone-handle zone-handle-se" data-handle="se"></span>
            </div>
          </div>
          <canvas class="manual-count-canvas" title="Left click to add, right click or Shift+click to remove"></canvas>
          <div class="video-ai-stats-overlay">
            <div class="video-ai-stat">
              <span>Count</span>
              <strong class="stat-ai-count">0</strong>
            </div>
            <div class="video-ai-stat">
              <span>FPS</span>
              <strong class="stat-ai-fps">0.0</strong>
            </div>
            <div class="video-ai-stat">
              <span>Mode</span>
              <strong class="stat-ai-mode">DET</strong>
            </div>
            <div class="video-ai-stat">
              <span>Zone</span>
              <strong class="stat-ai-zone">Off</strong>
            </div>
          </div>
          
          <div class="video-overlay">
            <button class="overlay-btn play-btn" title="Play/Pause">
              <i class="fas fa-play"></i>
            </button>
            <div class="loading-spinner">
              <div class="spinner"></div>
              <p>Connecting...</p>
            </div>
          </div>
          
          <div class="video-controls">
            <div class="controls-left">
  <button class="control-btn prev-stream-btn" title="Previous Stream">
    <i class="fas fa-step-backward"></i>
  </button>
  <button class="control-btn play-pause-btn" title="Play/Pause">
    <i class="fas fa-play"></i>
  </button>
  <button class="control-btn next-stream-btn" title="Next Stream">
    <i class="fas fa-step-forward"></i>
  </button>
  <button class="control-btn volume-btn" title="Mute/Unmute">
    <i class="fas fa-volume-up"></i>
  </button>
  <div class="volume-slider-container">
    <input type="range" class="volume-slider" min="0" max="100" value="100">
  </div>
</div>
            
            <div class="controls-right">
              <button class="control-btn snapshot-btn" title="Take Snapshot">
                <i class="fas fa-camera"></i>
              </button>
              <button class="control-btn manual-count-btn" title="Manual Count Dots">
                <i class="fas fa-location-dot"></i>
              </button>
              <button class="control-btn zone-edit-btn" title="Edit Counting Zone">
                <i class="fas fa-vector-square"></i>
              </button>
              <button class="control-btn record-btn" title="Start Recording">
                <i class="fas fa-circle"></i>
              </button>
              <button class="control-btn fullscreen-btn" title="Fullscreen">
                <i class="fas fa-expand"></i>
              </button>
              <button class="control-btn settings-btn" title="Stream Settings">
                <i class="fas fa-cog"></i>
              </button>
            </div>
          </div>
        </div>
        
        <div class="video-stats">
          <div class="stat-item stat-ai">
            <span class="stat-label">AI Count:</span>
            <span class="stat-value stat-ai-count-strip">0</span>
          </div>
          <div class="stat-item stat-ai">
            <span class="stat-label">AI FPS:</span>
            <span class="stat-value stat-ai-fps-strip">0.0</span>
          </div>
          <div class="stat-item stat-ai">
            <span class="stat-label">AI Mode:</span>
            <span class="stat-value stat-ai-mode-strip">DET</span>
          </div>
          <div class="stat-item stat-ai">
            <span class="stat-label">Zone:</span>
            <span class="stat-value stat-ai-zone-strip">Off</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Protocol:</span>
            <span class="stat-value stat-protocol">${this.streamConfig.type.toUpperCase()}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Resolution:</span>
            <span class="stat-value stat-resolution">N/A</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Bitrate:</span>
            <span class="stat-value stat-bitrate">0 kbps</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Buffer:</span>
            <span class="stat-value stat-buffer">0s</span>
          </div>
        </div>
        
        <div class="video-footer">
          <div class="stream-info">
            <span class="stream-type ${
              this.streamConfig.type
            }">${this.streamConfig.type.toUpperCase()}</span>
            <span class="stream-url" title="${this.streamConfig.url}">${
      this.streamConfig.url
    }</span>
          </div>
          <div class="video-actions">
            <button class="action-btn refresh-btn" title="Refresh Stream">
              <i class="fas fa-sync-alt"></i>
            </button>
            <button class="action-btn edit-btn" title="Edit Stream" data-stream-id="${
              this.streamConfig.id
            }">
              <i class="fas fa-edit"></i>
            </button>
            <button class="action-btn delete-btn" title="Delete Stream" data-stream-id="${
              this.streamConfig.id
            }">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;

    this.videoElement = this.container.querySelector(".video-element");
    this.videoContainer = this.container.querySelector(".video-container");
    this.zoneOverlay = this.container.querySelector(".zone-edit-overlay");
    this.manualCanvas = this.container.querySelector(".manual-count-canvas");
    this.overlay = this.container.querySelector(".video-overlay");
    this.loadingSpinner = this.container.querySelector(".loading-spinner");
    this.statusIndicator = this.container.querySelector(".status-indicator");
    this.statusText = this.container.querySelector(".status-text");
    this.aiCountValues = this.container.querySelectorAll(".stat-ai-count, .stat-ai-count-strip");
    this.aiFpsValues = this.container.querySelectorAll(".stat-ai-fps, .stat-ai-fps-strip");
    this.aiModeValues = this.container.querySelectorAll(".stat-ai-mode, .stat-ai-mode-strip");
    this.aiZoneValues = this.container.querySelectorAll(".stat-ai-zone, .stat-ai-zone-strip");
    // Next/Previous Stream buttons
    const nextStreamBtn = this.container.querySelector(".next-stream-btn");
    const prevStreamBtn = this.container.querySelector(".prev-stream-btn");

    if (nextStreamBtn) {
      nextStreamBtn.addEventListener("click", () => {
        this.switchToNextStream();
      });
    }

    if (prevStreamBtn) {
      prevStreamBtn.addEventListener("click", () => {
        this.switchToPreviousStream();
      });
    }

    this.setupEventListeners();
    this.setupResizeObserver();
    this.updateZoneOverlay();
    this.resizeManualCanvas();
    this.drawManualPoints();
    this.startStream();
  }

  setupEventListeners() {
    const playBtn = this.container.querySelector(".play-btn");
    const playPauseBtn = this.container.querySelector(".play-pause-btn");

    const togglePlay = () => {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    };

    if (playBtn) playBtn.addEventListener("click", togglePlay);
    if (playPauseBtn) playPauseBtn.addEventListener("click", togglePlay);

    const volumeBtn = this.container.querySelector(".volume-btn");
    const volumeSlider = this.container.querySelector(".volume-slider");

    if (volumeBtn) {
      volumeBtn.addEventListener("click", () => this.toggleMute());
    }

    if (volumeSlider) {
      volumeSlider.addEventListener("input", (e) => {
        this.setVolume(e.target.value / 100);
      });
    }

    const fullscreenBtn = this.container.querySelector(".fullscreen-btn");
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener("click", () => this.toggleFullscreen());
    }

    const snapshotBtn = this.container.querySelector(".snapshot-btn");
    if (snapshotBtn) {
      snapshotBtn.addEventListener("click", () => this.takeSnapshot());
    }

    const manualCountBtn = this.container.querySelector(".manual-count-btn");
    if (manualCountBtn) {
      manualCountBtn.addEventListener("click", () => this.toggleManualMode());
    }

    const zoneEditBtn = this.container.querySelector(".zone-edit-btn");
    if (zoneEditBtn) {
      zoneEditBtn.addEventListener("click", () => {
        if (this.streamManager) {
          const enableZone = !this.streamManager.zoneEditing;
          if (window.crowdCounter && window.crowdCounter.setZoneEnabled) {
            window.crowdCounter.setZoneEnabled(enableZone, { markDirty: true });
            if (window.crowdCounter.applyZoneSettingsNow) {
              window.crowdCounter.applyZoneSettingsNow(enableZone ? "Enabling counting zone..." : "Disabling counting zone...");
            }
          }
          this.streamManager.setZoneEditing(enableZone, { skipApply: true });
        }
      });
    }

    if (this.zoneOverlay) {
      this.zoneOverlay.addEventListener("mousedown", (e) => this.startZoneDrag(e));
      window.addEventListener("mousemove", this.boundZoneMove);
      window.addEventListener("mouseup", this.boundZoneEnd);
    }

    if (this.manualCanvas) {
      this.manualCanvas.addEventListener("click", (e) => this.handleManualCanvasClick(e, false));
      this.manualCanvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.handleManualCanvasClick(e, true);
      });
    }

    window.addEventListener("resize", this.boundResize);

    const recordBtn = this.container.querySelector(".record-btn");
    if (recordBtn) {
      recordBtn.addEventListener("click", () => this.toggleRecording());
    }

    const settingsBtn = this.container.querySelector(".settings-btn");
    if (settingsBtn) {
      settingsBtn.addEventListener("click", () => this.showSettings());
    }

    const refreshBtn = this.container.querySelector(".refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => this.refreshStream());
    }

    const editBtn = this.container.querySelector(".edit-btn");
    const deleteBtn = this.container.querySelector(".delete-btn");

    if (editBtn) {
      editBtn.addEventListener("click", () => {
        if (window.streamManager) {
          window.streamManager.editStream(this.streamConfig.id);
        }
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (
          confirm(
            `Delete stream "${
              this.streamConfig.displayName || this.streamConfig.name
            }"?`
          )
        ) {
          if (window.streamManager) {
            window.streamManager.deleteStreamById(this.streamConfig.id);
          }
        }
      });
    }

    if (this.videoElement) {
      this.videoElement.addEventListener("play", () => {
        this.isPlaying = true;
        this.updatePlayButton(true);
        this.hideLoading();
      });

      this.videoElement.addEventListener("pause", () => {
        this.isPlaying = false;
        this.updatePlayButton(false);
      });

      this.videoElement.addEventListener("loadeddata", () => {
        this.hasVideoFrame = true;
        this.updateStatus("connected");
        this.updateStats();
        this.updateInteractiveLayers();
      });

      this.videoElement.addEventListener("loadedmetadata", () => {
        this.hasVideoFrame = true;
        this.updateStats();
        this.updateInteractiveLayers();
      });

      this.videoElement.addEventListener("error", (e) => {
        this.hasVideoFrame = false;
        console.error("Video error:", e);
        this.updateStatus("error");
        this.showError("Failed to load video stream");
      });

      this.videoElement.addEventListener("timeupdate", () => {
        this.updateTimeDisplay();
        this.updateStats();
      });

      this.videoElement.addEventListener("volumechange", () => {
        this.updateVolumeDisplay();
      });
    }
  }

  setupResizeObserver() {
    if (!this.videoContainer || typeof ResizeObserver === "undefined") return;

    this.resizeObserver = new ResizeObserver(() => {
      this.updateInteractiveLayers();
    });
    this.resizeObserver.observe(this.videoContainer);
  }

  getRenderedVideoRect() {
    if (!this.videoContainer) {
      return { left: 0, top: 0, width: 1, height: 1 };
    }

    const containerRect = this.videoContainer.getBoundingClientRect();
    const containerWidth = Math.max(1, containerRect.width);
    const containerHeight = Math.max(1, containerRect.height);
    const videoWidth = this.videoElement && this.videoElement.videoWidth ? this.videoElement.videoWidth : 16;
    const videoHeight = this.videoElement && this.videoElement.videoHeight ? this.videoElement.videoHeight : 9;
    const videoRatio = videoWidth / videoHeight;
    const containerRatio = containerWidth / containerHeight;

    let width = containerWidth;
    let height = containerHeight;
    let left = 0;
    let top = 0;

    if (containerRatio > videoRatio) {
      height = containerHeight;
      width = height * videoRatio;
      left = (containerWidth - width) / 2;
    } else {
      width = containerWidth;
      height = width / videoRatio;
      top = (containerHeight - height) / 2;
    }

    return { left, top, width, height };
  }

  syncInteractiveLayerGeometry() {
    const rect = this.getRenderedVideoRect();
    [this.zoneOverlay, this.manualCanvas].forEach((layer) => {
      if (!layer) return;
      layer.style.left = `${rect.left}px`;
      layer.style.top = `${rect.top}px`;
      layer.style.width = `${rect.width}px`;
      layer.style.height = `${rect.height}px`;
    });
  }

  updateInteractiveLayers() {
    this.syncInteractiveLayerGeometry();
    this.updateZoneOverlay();
    this.drawManualPoints();
  }

  updateZoneOverlay() {
    if (!this.zoneOverlay || !this.streamManager) return;

    this.syncInteractiveLayerGeometry();

    const settings = window.crowdCounter && window.crowdCounter.getSettings ? window.crowdCounter.getSettings() : {};
    const enabled = this.streamManager.zoneEditing && !!settings.zone_enabled && this.hasVideoFrame;
    const box = this.zoneOverlay.querySelector(".zone-box");
    const rect = this.streamManager.zoneRectNorm;

    this.zoneOverlay.classList.toggle("active", enabled);
    if (box) {
      box.style.left = `${rect.x1 * 100}%`;
      box.style.top = `${rect.y1 * 100}%`;
      box.style.width = `${(rect.x2 - rect.x1) * 100}%`;
      box.style.height = `${(rect.y2 - rect.y1) * 100}%`;
    }

    // If zone editing is enabled, turn off manual dot mode
    if (enabled && this.manualMode) {
      this.toggleManualMode();
    }

    const btn = this.container.querySelector(".zone-edit-btn");
    if (btn) {
      btn.classList.toggle("active", enabled);
    }

    this.updateCrowdStatsOverlay();
  }

  updateCrowdStatsOverlay(stats = null) {
    const state = window.crowdCounter && window.crowdCounter.getState ? window.crowdCounter.getState() : null;
    const settings = window.crowdCounter && window.crowdCounter.getSettings ? window.crowdCounter.getSettings() : {};
    const count = stats && stats.count !== undefined ? stats.count : state ? state.count : 0;
    const fps = stats && stats.fps !== undefined ? Number(stats.fps) : state ? Number(state.fps) : 0;
    const mode = stats && stats.mode ? stats.mode : state ? state.mode : "DET";
    const zoneEnabled = !!settings.zone_enabled;

    this.aiCountValues.forEach((el) => { el.textContent = String(Number.isFinite(Number(count)) ? count : 0); });
    this.aiFpsValues.forEach((el) => { el.textContent = Number.isFinite(fps) ? fps.toFixed(1) : "0.0"; });
    this.aiModeValues.forEach((el) => { el.textContent = mode || "DET"; });
    this.aiZoneValues.forEach((el) => {
      el.textContent = zoneEnabled ? "On" : "Off";
      el.classList.toggle("active", zoneEnabled);
    });
  }

  startZoneDrag(event) {
    if (!this.streamManager || !this.streamManager.zoneEditing) return;
    const box = event.target.closest(".zone-box");
    if (!box) return;

    event.preventDefault();
    if (window.crowdCounter && window.crowdCounter.beginZoneEdit) {
      window.crowdCounter.beginZoneEdit();
    }
    const bounds = this.zoneOverlay.getBoundingClientRect();
    this.zoneDrag = {
      handle: event.target.dataset.handle || "move",
      startX: (event.clientX - bounds.left) / bounds.width,
      startY: (event.clientY - bounds.top) / bounds.height,
      startRect: { ...this.streamManager.zoneRectNorm },
    };
  }

  moveZoneDrag(event) {
    if (!this.zoneDrag || !this.streamManager || !this.zoneOverlay) return;

    const bounds = this.zoneOverlay.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    const dx = x - this.zoneDrag.startX;
    const dy = y - this.zoneDrag.startY;
    const r = { ...this.zoneDrag.startRect };

    if (this.zoneDrag.handle === "move") {
      const width = r.x2 - r.x1;
      const height = r.y2 - r.y1;
      r.x1 = Math.min(Math.max(0, r.x1 + dx), 1 - width);
      r.y1 = Math.min(Math.max(0, r.y1 + dy), 1 - height);
      r.x2 = r.x1 + width;
      r.y2 = r.y1 + height;
    } else {
      if (this.zoneDrag.handle.includes("w")) r.x1 += dx;
      if (this.zoneDrag.handle.includes("e")) r.x2 += dx;
      if (this.zoneDrag.handle.includes("n")) r.y1 += dy;
      if (this.zoneDrag.handle.includes("s")) r.y2 += dy;
    }

    this.streamManager.setZoneRectNorm(r);
  }

  endZoneDrag() {
    if (this.zoneDrag && window.crowdCounter && window.crowdCounter.applyZoneSettingsNow) {
      window.crowdCounter.applyZoneSettingsNow("Applying counting zone to stream...");
    }
    this.zoneDrag = null;
  }

  toggleManualMode() {
    this.manualMode = !this.manualMode;
    // If manual mode is turned on, force zone editing off to avoid overlap
    if (this.manualMode && this.streamManager) {
      this.streamManager.setZoneEditing(false);
    }
    const btn = this.container.querySelector(".manual-count-btn");
    if (btn) {
      btn.classList.toggle("active", this.manualMode);
    }
    if (this.manualCanvas) {
      this.syncInteractiveLayerGeometry();
      this.manualCanvas.classList.toggle("active", this.manualMode);
    }
    this.drawManualPoints();
    this.showNotification(this.manualMode ? "Manual dot mode enabled" : "Manual dot mode disabled");
  }

  handleManualCanvasClick(event, forceRemove) {
    if (!this.manualMode || !this.manualCanvas) return;

    const rect = this.manualCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    if (x < 0 || x > 1 || y < 0 || y > 1) {
      return;
    }

    if (forceRemove || event.shiftKey) {
      this.removeNearestManualPoint(x, y);
    } else {
      this.manualPoints.push({ x, y });
    }

    this.syncManualCorrection();
    this.drawManualPoints();
  }

  removeNearestManualPoint(x, y) {
    if (!this.manualPoints.length) return;

    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;

    this.manualPoints.forEach((point, index) => {
      const dx = point.x - x;
      const dy = point.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestIndex = index;
      }
    });

    if (nearestIndex !== -1 && nearestDistance <= 0.04) {
      this.manualPoints.splice(nearestIndex, 1);
    }
  }

  resizeManualCanvas() {
    if (!this.manualCanvas) return;
    const rect = this.manualCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    if (this.manualCanvas.width !== width || this.manualCanvas.height !== height) {
      this.manualCanvas.width = width;
      this.manualCanvas.height = height;
    }
  }

  drawManualPoints() {
    if (!this.manualCanvas) return;
    this.resizeManualCanvas();

    const ctx = this.manualCanvas.getContext("2d");
    ctx.clearRect(0, 0, this.manualCanvas.width, this.manualCanvas.height);

    this.manualPoints.forEach((point, index) => {
      const x = point.x * this.manualCanvas.width;
      const y = point.y * this.manualCanvas.height;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "11px Arial";
      ctx.fillText(String(index + 1), x + 8, y - 8);
    });
  }

  syncManualCorrection() {
    if (window.crowdCounter && window.crowdCounter.setManualCorrection) {
      window.crowdCounter.setManualCorrection(this.manualPoints.length);
    }
  }

  clearManualCorrections() {
    this.manualPoints = [];
    this.syncManualCorrection();
    this.drawManualPoints();
  }
  // New methods for stream switching
  switchToNextStream() {
    if (!this.streamManager) {
      console.warn("StreamManager not available");
      return;
    }

    const allStreams = this.streamManager.getAllStreams();
    if (allStreams.length <= 1) {
      this.showNotification("No other streams available");
      return;
    }

    const currentIndex = allStreams.findIndex(
      (s) => s.id === this.streamConfig.id
    );
    const nextIndex = (currentIndex + 1) % allStreams.length;
    const nextStream = allStreams[nextIndex];

    this.showNotification(
      `Switching to: ${nextStream.displayName || nextStream.name}`
    );
    this.switchStream(nextStream);
  }

  switchToPreviousStream() {
    if (!this.streamManager) {
      console.warn("StreamManager not available");
      return;
    }

    const allStreams = this.streamManager.getAllStreams();
    if (allStreams.length <= 1) {
      this.showNotification("No other streams available");
      return;
    }

    const currentIndex = allStreams.findIndex(
      (s) => s.id === this.streamConfig.id
    );
    const prevIndex =
      currentIndex - 1 < 0 ? allStreams.length - 1 : currentIndex - 1;
    const prevStream = allStreams[prevIndex];

    this.showNotification(
      `Switching to: ${prevStream.displayName || prevStream.name}`
    );
    this.switchStream(prevStream);
  }

  async switchStream(newStreamConfig) {
    const wasPlaying = this.isPlaying;
    const currentVolume = this.volume;
    const wasMuted = this.isMuted;

    this.cleanupStream();
    this.streamConfig = newStreamConfig;

    // Update UI
    const titleEl = this.container.querySelector(".video-title");
    if (titleEl)
      titleEl.textContent = newStreamConfig.displayName || newStreamConfig.name;

    const streamTypeEl = this.container.querySelector(".stream-type");
    if (streamTypeEl) {
      streamTypeEl.textContent = newStreamConfig.type.toUpperCase();
      streamTypeEl.className = `stream-type ${newStreamConfig.type}`;
    }

    const streamUrlEl = this.container.querySelector(".stream-url");
    if (streamUrlEl) {
      streamUrlEl.textContent = newStreamConfig.url;
      streamUrlEl.title = newStreamConfig.url;
    }

    const protocolEl = this.container.querySelector(".stat-protocol");
    if (protocolEl) protocolEl.textContent = newStreamConfig.type.toUpperCase();

    await this.startStream();

    if (this.videoElement) {
      this.setVolume(currentVolume);
      this.videoElement.muted = wasMuted;
      if (wasPlaying) this.play();
    }
  }

  cleanupStream() {
    if (this.isRecording) this.stopRecording();
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = "";
      this.videoElement.srcObject = null;
      this.videoElement.load();
    }
    this.manualPoints = [];
  }

  async startStream() {
    this.showLoading();
    this.updateStatus("connecting");

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      console.log(
        `[VideoPlayer] Loading stream: ${this.streamConfig.name} (${this.streamConfig.type})`
      );

      // Pilih protocol berdasarkan type
      if (this.streamConfig.type === "webrtc") {
        // Untuk WebRTC, gunakan URL langsung dari config
        await this.setupWebRTCPlayer(this.streamConfig.url);
      } else {
        // Untuk HLS/RTSP/RTMP, gunakan electronAPI untuk get URL
        const streamUrls = await window.electronAPI.getStreamUrl(
          this.streamConfig
        );

        if (this.streamConfig.type === "hls") {
          await this.setupHLSPlayer(streamUrls.hls);
        } else if (this.streamConfig.type === "rtsp") {
          // RTSP via HLS transcoding
          await this.setupHLSPlayer(streamUrls.hls);
        } else if (this.streamConfig.type === "rtmp") {
          // RTMP via HLS transcoding
          await this.setupHLSPlayer(streamUrls.hls);
        } else {
          throw new Error(`Unsupported stream type: ${this.streamConfig.type}`);
        }
      }
    } catch (error) {
      console.error("Failed to start stream:", error);
      this.showError(`Failed to start stream: ${error.message}`);
    }
  }

  async setupWebRTCPlayer(streamUrl) {
    try {
      console.log("[VideoPlayer] Setting up WebRTC connection");
      console.log("[VideoPlayer] Stream URL:", streamUrl);

      // MediaMTX WebRTC endpoint format: http://localhost:8889/stream_name/whep
      // Dari config URL user bisa: http://localhost:8889/drone
      // Kita perlu tambahkan /whep
      let webrtcUrl = streamUrl;
      if (!webrtcUrl.endsWith("/whep")) {
        webrtcUrl = webrtcUrl + "/whep";
      }

      console.log("[VideoPlayer] WHEP endpoint:", webrtcUrl);

      this.peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });

      this.peerConnection.ontrack = (event) => {
        console.log("[VideoPlayer] Received track:", event.track.kind);
        if (event.streams && event.streams[0]) {
          this.videoElement.srcObject = event.streams[0];
          this.videoElement.play().catch((e) => {
            console.warn("Autoplay prevented:", e);
            this.showPlayButton();
          });
        }
      };

      this.peerConnection.oniceconnectionstatechange = () => {
        console.log(
          "[VideoPlayer] ICE state:",
          this.peerConnection.iceConnectionState
        );

        if (
          this.peerConnection.iceConnectionState === "connected" ||
          this.peerConnection.iceConnectionState === "completed"
        ) {
          this.updateStatus("connected");
          this.hideLoading();
        } else if (
          this.peerConnection.iceConnectionState === "disconnected" ||
          this.peerConnection.iceConnectionState === "failed"
        ) {
          this.updateStatus("error");
          this.showError("WebRTC connection failed");
        }
      };

      this.peerConnection.onconnectionstatechange = () => {
        console.log(
          "[VideoPlayer] Connection state:",
          this.peerConnection.connectionState
        );
      };

      // Create offer
      const offer = await this.peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: true,
      });

      await this.peerConnection.setLocalDescription(offer);

      console.log("[VideoPlayer] Sending WHEP request to:", webrtcUrl);

      // Send offer to MediaMTX WHEP endpoint
      const response = await fetch(webrtcUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[VideoPlayer] WHEP error response:", errorText);
        throw new Error(
          `WHEP request failed: ${response.status} - ${errorText}`
        );
      }

      const answerSdp = await response.text();
      console.log("[VideoPlayer] Received SDP answer");

      await this.peerConnection.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });

      console.log("[VideoPlayer] WebRTC connection established");
    } catch (error) {
      console.error("[VideoPlayer] WebRTC setup failed:", error);
      throw error;
    }
  }

  async setupHLSPlayer(streamUrl) {
    if (typeof Hls !== "undefined" && Hls.isSupported()) {
      if (this.hls) {
        this.hls.destroy();
      }

      this.hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        maxFragLookUpTolerance: 0.25,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        liveDurationInfinity: true,
        levelLoadingTimeOut: 10000,
        levelLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        fragLoadingTimeOut: 20000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        startFragPrefetch: true,
        testBandwidth: true,
      });

      this.hls.loadSource(streamUrl);
      this.hls.attachMedia(this.videoElement);

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log(
          `[VideoPlayer] HLS manifest parsed for ${this.streamConfig.name}`
        );
        this.videoElement.play().catch((e) => {
          console.warn("Autoplay prevented:", e);
          this.showPlayButton();
        });
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        console.error(
          `[VideoPlayer] HLS error for ${this.streamConfig.name}:`,
          data
        );

        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log("Network error, trying to recover...");
              this.hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log("Media error, trying to recover...");
              this.hls.recoverMediaError();
              break;
            default:
              console.log("Fatal error, cannot recover");
              this.showError("Stream error: " + data.details);
              break;
          }
        }
      });

      this.hls.on(Hls.Events.LEVEL_SWITCHED, () => {
        this.updateStats();
      });

      this.hls.on(Hls.Events.FRAG_BUFFERED, () => {
        this.updateStats();
      });
    } else if (this.videoElement.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari native HLS support
      this.videoElement.src = streamUrl;
      this.videoElement.load();
      this.videoElement.play().catch((e) => {
        console.warn("Autoplay prevented:", e);
        this.showPlayButton();
      });
    } else {
      throw new Error("HLS not supported in this browser");
    }
  }

  play() {
    if (this.videoElement) {
      this.videoElement.play().catch((e) => {
        console.error("Play failed:", e);
        this.showError("Playback failed: " + e.message);
      });
    }
  }

  pause() {
    if (this.videoElement) {
      this.videoElement.pause();
    }
  }

  toggleMute() {
    if (this.videoElement) {
      this.videoElement.muted = !this.videoElement.muted;
      this.isMuted = this.videoElement.muted;
      this.updateVolumeButton();
    }
  }

  setVolume(volume) {
    if (this.videoElement) {
      this.videoElement.volume = volume;
      this.volume = volume;
      if (volume > 0) {
        this.videoElement.muted = false;
        this.isMuted = false;
      }
      this.updateVolumeButton();
    }
  }

  toggleFullscreen() {
    const videoContainer = this.container.querySelector(".video-container");

    if (!document.fullscreenElement) {
      if (videoContainer.requestFullscreen) {
        videoContainer.requestFullscreen();
      } else if (videoContainer.webkitRequestFullscreen) {
        videoContainer.webkitRequestFullscreen();
      } else if (videoContainer.msRequestFullscreen) {
        videoContainer.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  }

  takeSnapshot() {
    if (!this.videoElement || this.videoElement.readyState < 2) {
      this.showNotification("Video not ready for snapshot");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = this.videoElement.videoWidth || 1280;
    canvas.height = this.videoElement.videoHeight || 720;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `snapshot_${this.streamConfig.name}_${Date.now()}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);

      this.showNotification("Snapshot saved!");
    }, "image/png");
  }

  toggleRecording() {
    if (!this.isRecording) {
      this.startRecording();
    } else {
      this.stopRecording();
    }
  }

  async startRecording() {
    try {
      const stream = this.videoElement.captureStream
        ? this.videoElement.captureStream()
        : this.videoElement.mozCaptureStream();

      if (!stream) {
        throw new Error("Cannot capture stream");
      }

      const options = { mimeType: "video/webm;codecs=vp8" };

      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = "video/webm";
      }

      this.mediaRecorder = new MediaRecorder(stream, options);
      this.recordedChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `recording_${
          this.streamConfig.name
        }_${Date.now()}.webm`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);

        this.showNotification("Recording saved!");
      };

      this.mediaRecorder.start(1000); // 1 second chunks
      this.isRecording = true;

      const recordBtn = this.container.querySelector(".record-btn");
      if (recordBtn) {
        recordBtn.style.color = "#ef4444";
        recordBtn.querySelector("i").className = "fas fa-stop";
      }

      this.showNotification("Recording started...");
    } catch (error) {
      console.error("Recording failed:", error);
      this.showNotification("Recording failed: " + error.message);
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;

      const recordBtn = this.container.querySelector(".record-btn");
      if (recordBtn) {
        recordBtn.style.color = "";
        recordBtn.querySelector("i").className = "fas fa-circle";
      }
    }
  }

  showSettings() {
    const settings = `
Stream Settings:
- Name: ${this.streamConfig.displayName || this.streamConfig.name}
- Type: ${this.streamConfig.type.toUpperCase()}
- URL: ${this.streamConfig.url}
- Resolution: ${this.videoElement?.videoWidth || 0}x${
      this.videoElement?.videoHeight || 0
    }
- State: ${this.isPlaying ? "Playing" : "Paused"}
    `.trim();

    alert(settings);
  }

  refreshStream() {
    console.log("[VideoPlayer] Refreshing stream...");
    this.destroy();
    setTimeout(() => {
      this.init();
    }, 500);
  }

  updateStatus(status) {
    if (this.statusIndicator && this.statusText) {
      this.statusIndicator.className = `status-indicator ${status}`;
      this.statusText.textContent = this.formatStatusText(status);
    }
  }

  formatStatusText(status) {
    const statusMap = {
      connecting: "Connecting...",
      connected: "Live",
      error: "Error",
      offline: "Offline",
      buffering: "Buffering...",
    };
    return statusMap[status] || status;
  }

  updatePlayButton(playing) {
    const playBtn = this.container.querySelector(".play-btn i");
    const playPauseBtn = this.container.querySelector(".play-pause-btn i");

    if (playing) {
      if (playBtn) playBtn.className = "fas fa-pause";
      if (playPauseBtn) playPauseBtn.className = "fas fa-pause";
    } else {
      if (playBtn) playBtn.className = "fas fa-play";
      if (playPauseBtn) playPauseBtn.className = "fas fa-play";
    }
  }

  updateVolumeButton() {
    const volumeBtn = this.container.querySelector(".volume-btn i");
    const volumeSlider = this.container.querySelector(".volume-slider");

    if (!volumeBtn || !volumeSlider) return;

    if (this.isMuted || this.volume === 0) {
      volumeBtn.className = "fas fa-volume-mute";
      volumeSlider.value = 0;
    } else if (this.volume < 0.5) {
      volumeBtn.className = "fas fa-volume-down";
      volumeSlider.value = this.volume * 100;
    } else {
      volumeBtn.className = "fas fa-volume-up";
      volumeSlider.value = this.volume * 100;
    }
  }

  updateVolumeDisplay() {
    this.updateVolumeButton();
  }

  updateTimeDisplay() {
    if (!this.videoElement) return;

    const currentTime = this.formatTime(this.videoElement.currentTime);
    const currentTimeEl = this.container.querySelector(".current-time");

    if (currentTimeEl) currentTimeEl.textContent = currentTime;
  }

  formatTime(seconds) {
    if (!isFinite(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }

  updateStats() {
    if (!this.videoElement) return;

    // Update resolution
    if (this.videoElement.videoWidth && this.videoElement.videoHeight) {
      const resolutionEl = this.container.querySelector(".stat-resolution");
      if (resolutionEl) {
        resolutionEl.textContent = `${this.videoElement.videoWidth}x${this.videoElement.videoHeight}`;
      }
    }

    // Update bitrate from HLS
    if (this.hls && this.hls.levels && this.hls.currentLevel !== -1) {
      const level = this.hls.levels[this.hls.currentLevel];
      if (level) {
        const bitrateEl = this.container.querySelector(".stat-bitrate");
        if (bitrateEl) {
          bitrateEl.textContent = `${Math.round(level.bitrate / 1000)} kbps`;
        }
      }
    }

    // Update buffer
    if (this.videoElement.buffered.length > 0) {
      const buffered =
        this.videoElement.buffered.end(this.videoElement.buffered.length - 1) -
        this.videoElement.currentTime;
      const bufferEl = this.container.querySelector(".stat-buffer");
      if (bufferEl) {
        bufferEl.textContent = `${buffered.toFixed(1)}s`;
      }
    }
  }

  showLoading() {
    if (this.loadingSpinner) {
      this.loadingSpinner.style.display = "flex";
    }
    if (this.overlay) {
      this.overlay.style.display = "flex";
    }

    const playBtn = this.container.querySelector(".play-btn");
    if (playBtn) {
      playBtn.style.display = "none";
    }
  }

  hideLoading() {
    if (this.loadingSpinner) {
      this.loadingSpinner.style.display = "none";
    }
    if (this.overlay) {
      this.overlay.style.display = "none";
    }
  }

  showPlayButton() {
    const playBtn = this.container.querySelector(".play-btn");
    if (playBtn) {
      playBtn.style.display = "flex";
    }
    if (this.loadingSpinner) {
      this.loadingSpinner.style.display = "none";
    }
    if (this.overlay) {
      this.overlay.style.display = "flex";
    }
  }

  showError(message) {
    this.hideLoading();

    const errorDiv = document.createElement("div");
    errorDiv.className = "video-error";
    errorDiv.innerHTML = `
      <i class="fas fa-exclamation-triangle"></i>
      <p>${message}</p>
      <button class="btn btn-sm btn-primary retry-btn">Retry</button>
    `;

    if (this.overlay) {
      this.overlay.innerHTML = "";
      this.overlay.appendChild(errorDiv);
      this.overlay.style.display = "flex";

      errorDiv.querySelector(".retry-btn").addEventListener("click", () => {
        this.refreshStream();
      });
    }
  }

  showNotification(message) {
    const notification = document.createElement("div");
    notification.className = "notification";
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(59, 130, 246, 0.9);
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      z-index: 10000;
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = "1";
      notification.style.transform = "translateY(0)";
    }, 10);

    setTimeout(() => {
      notification.style.opacity = "0";
      notification.style.transform = "translateY(20px)";
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 3000);
  }

  destroy() {
    // Stop recording if active
    if (this.isRecording) {
      this.stopRecording();
    }

    // Destroy HLS
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    // Close WebRTC connection
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }

    // Clean up video element
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = "";
      this.videoElement.srcObject = null;
      this.videoElement.load();
      this.videoElement = null;
    }
    window.removeEventListener("mousemove", this.boundZoneMove);
    window.removeEventListener("mouseup", this.boundZoneEnd);
    window.removeEventListener("resize", this.boundResize);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.container.innerHTML = "";
  }
}

// Stream Manager
class StreamManager {
  constructor() {
    this.players = new Map();
    this.streams = [];
    this.zoneEditing = false;
    this.zoneRectNorm = { x1: 0.1, y1: 0.1, x2: 0.9, y2: 0.9 };
  }

  async initialize() {
    const result = await window.electronAPI.loadStreamConfig();
    if (result.success && result.config) {
      this.streams = result.config;

      // Normalize saved stream names to match URL paths for non-WebRTC streams.
      let hasMigration = false;
      this.streams = this.streams.map((stream) => {
        if (!stream || stream.type === "webrtc" || !stream.url) {
          return stream;
        }

        try {
          const parsed = new URL(stream.url);
          const pathName = parsed.pathname.replace(/^\/+|\/+$/g, "");
          if (pathName && stream.name !== pathName) {
            hasMigration = true;
            return { ...stream, name: pathName };
          }
        } catch (error) {
          // Keep stream unchanged when URL parsing fails.
        }

        return stream;
      });

      if (hasMigration) {
        await this.saveConfig();
      }
    }

    if (this.streams.length === 0) {
      this.streams = this.getDefaultStreams();
      await this.saveConfig();
    }

    return this.streams;
  }

  getDefaultStreams() {
    return [
      {
        id: "1",
        name: "cognitiveOutput",
        displayName: "AI Crowd Count",
        type: "rtsp",
        url: "rtsp://localhost:8554/cognitiveOutput",
        enabled: true,
        position: 1,
      },
      {
        id: "2",
        name: "matrice4t",
        displayName: "Matrice 4T",
        type: "rtsp",
        url: "rtsp://localhost:8554/matrice4t",
        enabled: true,
        position: 2,
      },
    ];
  }

  async addStream(streamConfig) {
    const id = Date.now().toString();
    const newStream = {
      id,
      ...streamConfig,
      enabled: true,
      position: this.streams.length,
    };

    this.streams.push(newStream);
    await this.saveConfig();
    return newStream;
  }

  async updateStream(id, updates) {
    const index = this.streams.findIndex((s) => s.id === id);
    if (index !== -1) {
      this.streams[index] = { ...this.streams[index], ...updates };
      await this.saveConfig();

      // Reload the player if it exists
      const containerId = `video-player-${id}`;
      if (this.players.has(containerId)) {
        this.destroyPlayer(containerId);
        setTimeout(() => {
          this.createPlayer(containerId, id);
        }, 500);
      }

      return this.streams[index];
    }
    return null;
  }

  async deleteStreamById(id) {
    const index = this.streams.findIndex((s) => s.id === id);
    if (index !== -1) {
      const containerId = `video-player-${id}`;
      if (this.players.has(containerId)) {
        this.players.get(containerId).destroy();
        this.players.delete(containerId);
      }

      this.streams.splice(index, 1);
      await this.saveConfig();

      // Reload UI
      if (window.loadStreams) {
        window.loadStreams();
      }

      return true;
    }
    return false;
  }

  editStream(id) {
    const stream = this.getStream(id);
    if (stream && window.showEditStreamModal) {
      window.showEditStreamModal(stream);
    }
  }

  async saveConfig() {
    return await window.electronAPI.saveStreamConfig(this.streams);
  }

  getStream(id) {
    return this.streams.find((s) => s.id === id);
  }

  getAllStreams() {
    return this.streams.filter((s) => s.enabled);
  }

  createPlayer(containerId, streamId) {
    const stream = this.getStream(streamId);
    if (!stream) {
      console.error("Stream not found:", streamId);
      return null;
    }

    if (this.players.has(containerId)) {
      this.players.get(containerId).destroy();
    }

    const player = new VideoStreamPlayer(containerId, stream, this); // Pass 'this'
    this.players.set(containerId, player);
    return player;
  }

  destroyPlayer(containerId) {
    if (this.players.has(containerId)) {
      this.players.get(containerId).destroy();
      this.players.delete(containerId);
    }
  }

  destroyAllPlayers() {
    this.players.forEach((player) => player.destroy());
    this.players.clear();
  }

  startAllStreams() {
    this.getAllStreams().forEach((stream) => {
      const containerId = `video-player-${stream.id}`;
      if (!this.players.has(containerId)) {
        this.createPlayer(containerId, stream.id);
      }
    });
  }

  stopAllStreams() {
    this.destroyAllPlayers();
  }

  clearManualCorrections() {
    this.players.forEach((player) => {
      if (player.clearManualCorrections) {
        player.clearManualCorrections();
      }
    });
  }

  updateCrowdStats(stats) {
    this.players.forEach((player) => {
      if (player.updateCrowdStatsOverlay) {
        player.updateCrowdStatsOverlay(stats);
      }
    });
  }

  setZoneEditing(enabled, options = {}) {
    const wasEditing = this.zoneEditing;
    this.zoneEditing = enabled;
    if (enabled && window.crowdCounter && window.crowdCounter.setZoneEnabled) {
      window.crowdCounter.setZoneEnabled(true, { markDirty: true });
    }
    if (!options.skipApply && !enabled && wasEditing && window.crowdCounter && window.crowdCounter.applyZoneSettingsNow) {
      window.crowdCounter.applyZoneSettingsNow("Applying counting zone to stream...");
    }
    this.players.forEach((player) => {
      if (player.updateZoneOverlay) {
        player.updateZoneOverlay();
      }
    });
  }

  setZoneRectNorm(rect, options = {}) {
    const minSize = 0.05;
    let x1 = Math.max(0, Math.min(1, rect.x1));
    let y1 = Math.max(0, Math.min(1, rect.y1));
    let x2 = Math.max(0, Math.min(1, rect.x2));
    let y2 = Math.max(0, Math.min(1, rect.y2));

    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    if (x2 - x1 < minSize) {
      if (x1 + minSize <= 1) {
        x2 = x1 + minSize;
      } else {
        x1 = Math.max(0, x2 - minSize);
      }
    }
    if (y2 - y1 < minSize) {
      if (y1 + minSize <= 1) {
        y2 = y1 + minSize;
      } else {
        y1 = Math.max(0, y2 - minSize);
      }
    }

    this.zoneRectNorm = { x1, y1, x2, y2 };
    if (!options.silent && window.crowdCounter && window.crowdCounter.onZoneRectChanged) {
      window.crowdCounter.onZoneRectChanged(this.getZoneRectNorm());
    }
    this.players.forEach((player) => {
      if (player.updateZoneOverlay) {
        player.updateZoneOverlay();
      }
    });
  }

  getZoneRectNorm() {
    const r = this.zoneRectNorm;
    return [r.x1, r.y1, r.x2, r.y2].map((v) => v.toFixed(4)).join(",");
  }

  setZoneRectFromNormString(value, options = {}) {
    if (!value || typeof value !== "string") return false;
    const parts = value.split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return false;
    }
    this.setZoneRectNorm({ x1: parts[0], y1: parts[1], x2: parts[2], y2: parts[3] }, options);
    return true;
  }
}

// Global instance
window.streamManager = new StreamManager();
console.log("[VideoPlayer] StreamManager initialized with WebRTC support");
