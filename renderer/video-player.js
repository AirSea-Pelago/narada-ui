// Video Stream Player - Browser Compatible (No ES6 imports)
// HLS.js loaded from CDN in index.html

class VideoStreamPlayer {
  constructor(containerId, streamConfig) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);

    if (!this.container) {
      console.error(`Container not found: ${containerId}`);
      return;
    }

    this.streamConfig = streamConfig;
    this.player = null;
    this.videoElement = null;
    this.hls = null;
    this.isPlaying = false;
    this.isMuted = false;
    this.volume = 1.0;

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
                 playsinline webkit-playsinline></video>
          
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
              <button class="control-btn play-pause-btn" title="Play/Pause">
                <i class="fas fa-play"></i>
              </button>
              <button class="control-btn volume-btn" title="Mute/Unmute">
                <i class="fas fa-volume-up"></i>
              </button>
              <div class="volume-slider-container">
                <input type="range" class="volume-slider" min="0" max="100" value="100">
              </div>
              <div class="time-display">
                <span class="current-time">00:00</span> / 
                <span class="duration">00:00</span>
              </div>
            </div>
            
            <div class="controls-right">
              <button class="control-btn snapshot-btn" title="Take Snapshot">
                <i class="fas fa-camera"></i>
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
          <div class="stat-item">
            <span class="stat-label">Resolution:</span>
            <span class="stat-value stat-resolution">N/A</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Bitrate:</span>
            <span class="stat-value stat-bitrate">0 kbps</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">FPS:</span>
            <span class="stat-value stat-fps">0</span>
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
    this.overlay = this.container.querySelector(".video-overlay");
    this.loadingSpinner = this.container.querySelector(".loading-spinner");
    this.statusIndicator = this.container.querySelector(".status-indicator");
    this.statusText = this.container.querySelector(".status-text");

    this.setupEventListeners();
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

    if (volumeBtn) volumeBtn.addEventListener("click", () => this.toggleMute());
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

    const recordBtn = this.container.querySelector(".record-btn");
    if (recordBtn) {
      recordBtn.addEventListener("click", () => this.toggleRecording());
    }

    // Edit and Delete buttons
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
        this.updateStatus("connected");
      });

      this.videoElement.addEventListener("error", (e) => {
        console.error("Video error:", e);
        this.updateStatus("error");
        this.showError("Failed to load video stream");
      });

      this.videoElement.addEventListener("timeupdate", () => {
        this.updateTimeDisplay();
      });

      this.videoElement.addEventListener("volumechange", () => {
        this.updateVolumeDisplay();
      });
    }
  }

  async startStream() {
    this.showLoading();
    this.updateStatus("connecting");

    try {
      await new Promise((resolve) => setTimeout(resolve, 500));

      const streamUrls = await window.electronAPI.getStreamUrl(
        this.streamConfig.name
      );
      let streamUrl = streamUrls.hls;

      if (this.streamConfig.type === "rtmp") {
        streamUrl = streamUrls.rtmp;
      } else if (this.streamConfig.type === "rtsp") {
        streamUrl = streamUrls.rtsp;
      }

      console.log(
        `[VideoPlayer] Loading stream: ${this.streamConfig.name} (${this.streamConfig.type})`
      );
      console.log(`[VideoPlayer] Stream URL: ${streamUrl}`);

      // Check if HLS.js is available
      if (typeof Hls !== "undefined" && Hls.isSupported()) {
        this.setupHLSPlayer(streamUrl);
      } else if (
        this.videoElement.canPlayType("application/vnd.apple.mpegurl")
      ) {
        // Safari native HLS support
        this.videoElement.src = streamUrl;
        this.videoElement.load();
      } else {
        throw new Error("HLS not supported in this browser");
      }
    } catch (error) {
      console.error("Failed to start stream:", error);
      this.showError(`Failed to start stream: ${error.message}`);
    }
  }

  setupHLSPlayer(streamUrl) {
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

    this.hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
      this.updateStats();
    });

    this.hls.on(Hls.Events.FRAG_BUFFERED, (event, data) => {
      this.updateStats();
    });
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
      this.updateVolumeButton();
    }
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.container.requestFullscreen().catch((err) => {
        console.error("Fullscreen failed:", err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  takeSnapshot() {
    if (!this.videoElement || this.videoElement.readyState < 2) return;

    const canvas = document.createElement("canvas");
    canvas.width = this.videoElement.videoWidth;
    canvas.height = this.videoElement.videoHeight;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(this.videoElement, 0, 0);

    const link = document.createElement("a");
    link.download = `snapshot_${this.streamConfig.name}_${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();

    this.showNotification("Snapshot saved!");
  }

  toggleRecording() {
    this.showNotification("Recording feature coming soon!");
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
    const duration = this.formatTime(this.videoElement.duration || 0);

    const currentTimeEl = this.container.querySelector(".current-time");
    const durationEl = this.container.querySelector(".duration");

    if (currentTimeEl) currentTimeEl.textContent = currentTime;
    if (durationEl) durationEl.textContent = duration;
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

    if (this.videoElement.videoWidth && this.videoElement.videoHeight) {
      const resolutionEl = this.container.querySelector(".stat-resolution");
      if (resolutionEl) {
        resolutionEl.textContent = `${this.videoElement.videoWidth}x${this.videoElement.videoHeight}`;
      }
    }

    if (this.hls && this.hls.levels && this.hls.currentLevel !== -1) {
      const level = this.hls.levels[this.hls.currentLevel];
      if (level) {
        const bitrateEl = this.container.querySelector(".stat-bitrate");
        if (bitrateEl) {
          bitrateEl.textContent = `${Math.round(level.bitrate / 1000)} kbps`;
        }
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
        this.startStream();
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
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = "";
      this.videoElement.load();
      this.videoElement = null;
    }

    this.container.innerHTML = "";
  }
}

// Stream Manager
class StreamManager {
  constructor() {
    this.players = new Map();
    this.streams = [];
  }

  async initialize() {
    const result = await window.electronAPI.loadStreamConfig();
    if (result.success && result.config) {
      this.streams = result.config;
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
        name: "drone",
        displayName: "Drone Live",
        type: "hls", // Pakai HLS bukan RTMP
        url: "http://localhost:8888/drone/index.m3u8", // HLS dari localhost
        enabled: true,
        position: 0,
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
      return this.streams[index];
    }
    return null;
  }

  async deleteStreamById(id) {
    const index = this.streams.findIndex((s) => s.id === id);
    if (index !== -1) {
      if (this.players.has(id)) {
        this.players.get(id).destroy();
        this.players.delete(id);
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

    const player = new VideoStreamPlayer(containerId, stream);
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
}

// Global instance
window.streamManager = new StreamManager();
console.log("[VideoPlayer] StreamManager initialized");
