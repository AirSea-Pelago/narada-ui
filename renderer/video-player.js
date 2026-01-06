// Video Stream Player - Browser Compatible with WebRTC Support
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
    this.peerConnection = null;
    this.isPlaying = false;
    this.isMuted = false;
    this.volume = 1.0;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.recordedChunks = [];

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
                <span class="duration">LIVE</span>
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
        this.updateStatus("connected");
        this.updateStats();
      });

      this.videoElement.addEventListener("loadedmetadata", () => {
        this.updateStats();
      });

      this.videoElement.addEventListener("error", (e) => {
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
          this.streamConfig.name
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
        name: "drone_webrtc",
        displayName: "Drone Live (WebRTC)",
        type: "webrtc",
        url: "http://localhost:8889/drone",
        enabled: true,
        position: 1,
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
console.log("[VideoPlayer] StreamManager initialized with WebRTC support");
