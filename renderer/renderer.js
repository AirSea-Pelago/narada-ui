// Main Renderer Process - Simple 2-Stream Navigation
let streamManager;
let currentLicense;
let videoGrid;
let appContainer;
let errorScreen;
let loadingScreen;
let errorMessage;
let currentStreamIndex = 0; // Track current stream being displayed

// Initialize DOM elements
function initDOM() {
  videoGrid = document.getElementById("video-grid");
  appContainer = document.getElementById("app-container");
  errorScreen = document.getElementById("license-error-screen");
  loadingScreen = document.getElementById("loading-screen");
  errorMessage = document.getElementById("error-message");

  console.log("[Renderer] DOM elements initialized", {
    videoGrid: !!videoGrid,
    appContainer: !!appContainer,
    errorScreen: !!errorScreen,
    loadingScreen: !!loadingScreen,
  });
}

// Show specific screen
function showScreen(screen) {
  [loadingScreen, errorScreen, appContainer].forEach((s) => {
    if (s) s.classList.remove("active");
  });

  if (screen) {
    screen.classList.add("active");
  }

  console.log("[Renderer] Screen changed");
}

// Show error message
function showError(message) {
  console.error("[Renderer] Error:", message);

  if (errorMessage) {
    errorMessage.textContent = message;
  }

  showScreen(errorScreen);
}

// Initialize application
async function initializeApp() {
  try {
    console.log("[Renderer] Initializing app...");

    if (!window.streamManager) {
      console.error("[Renderer] StreamManager not available");
      showError("Failed to initialize: StreamManager not found");
      return;
    }

    streamManager = window.streamManager;
    const streams = await streamManager.initialize();

    console.log(`[Renderer] Initialized with ${streams.length} streams`);

    setupEventListeners();
    setupUI();
    loadStreams();
  } catch (error) {
    console.error("[Renderer] Failed to initialize app:", error);
    showError("Failed to initialize application: " + error.message);
  }
}

function updateMediaMTXUI(status) {
  const mediamtxStatus = document.getElementById("mediamtx-status");
  const serverStatus = document.getElementById("server-status");

  if (status.running) {
    if (mediamtxStatus) mediamtxStatus.textContent = "Running";
    if (serverStatus) {
      serverStatus.textContent = "Running";
      serverStatus.className = "status-badge success";
    }
  } else {
    if (mediamtxStatus) mediamtxStatus.textContent = "Stopped";
    if (serverStatus) {
      serverStatus.textContent = "Stopped";
      serverStatus.className = "status-badge danger";
    }
  }
}

async function loadAssets() {
  try {
    const logoPath = await window.electronAPI.getAssetPath("narada.png");
    const logoImg = document.getElementById("logo-img");
    const logoImg2 = document.getElementById("logo-img2");
    const logoIcon = document.getElementById("logo-icon");

    if (logoImg && logoPath) {
      const img = new Image();
      img.onload = () => {
        logoImg.src = `file://${logoPath}`;
        logoImg.style.display = "inline";
        logoImg2.src = `file://${logoPath}`;
        logoImg2.style.display = "inline";
        if (logoIcon) logoIcon.style.display = "none";
      };
      img.onerror = () => {
        console.warn("[Renderer] Logo image not found, using icon");
        if (logoImg) logoImg.style.display = "none";
        if (logoImg2) logoImg2.style.display = "none";
        if (logoIcon) logoIcon.style.display = "inline";
      };
      img.src = `file://${logoPath}`;
    }
  } catch (error) {
    console.error("[Renderer] Error loading assets:", error);
    const logoImg = document.getElementById("logo-img");
    const logoImg2 = document.getElementById("logo-img2");
    const logoIcon = document.getElementById("logo-icon");
    if (logoImg) logoImg.style.display = "none";
    if (logoImg2) logoImg2.style.display = "none";
    if (logoIcon) logoIcon.style.display = "inline";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    loadAssets();
  });
} else {
  loadAssets();
}

// Setup event listeners
function setupEventListeners() {
  console.log("[Renderer] Setting up event listeners");

  const retryBtn = document.getElementById("retry-btn");
  const helpBtn = document.getElementById("help-btn");

  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      console.log("[Renderer] Retry button clicked");
      checkLicense();
    });
  }

  if (helpBtn) {
    helpBtn.addEventListener("click", () => {
      alert(
        "Panduan Lisensi:\n\n1. Pastikan flashdisk lisensi terpasang\n2. File .license.sys harus ada di root drive\n3. Hubungi support jika masalah berlanjut"
      );
    });
  }

  const menuItems = document.querySelectorAll(".menu-item");
  menuItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      if (page) {
        switchPage(page);
      }
    });
  });

  if (window.electronAPI) {
    window.electronAPI.onLicenseStatus((status) => {
      console.log("[Renderer] License status received:", status);
      handleLicenseStatus(status);
    });

    window.electronAPI.onMediaMTXStatus((status) => {
      console.log("[Renderer] MediaMTX status received:", status);
      updateMediaMTXUI(status);
    });

    const refreshBtn = document.getElementById("refresh-btn");
    const fullscreenBtn = document.getElementById("fullscreen-btn");

    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        console.log("[Renderer] Refresh clicked");
        loadStreams();
      });
    }

    if (fullscreenBtn) {
      fullscreenBtn.addEventListener("click", () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
      });
    }

    window.electronAPI.onLoadDefaultStreams(() => {
      console.log("[Renderer] Load default streams event");
      setTimeout(() => {
        if (!streamManager) {
          initializeApp();
        } else {
          loadStreams();
        }
      }, 1000);
    });

    window.electronAPI.onStartAllStreams(() => {
      if (streamManager) {
        streamManager.startAllStreams();
      }
    });

    window.electronAPI.onStopAllStreams(() => {
      if (streamManager) {
        streamManager.stopAllStreams();
      }
    });

    window.electronAPI.onOpenStreamDialog(() => {
      showAddStreamModal();
    });
  }
}

// Setup UI
function setupUI() {
  console.log("[Renderer] Setting up UI");

  const modalCloseBtns = document.querySelectorAll(".modal-close");
  modalCloseBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      closeAllModals();
    });
  });

  const streamForm = document.getElementById("stream-form");
  if (streamForm) {
    streamForm.removeAttribute("onsubmit");
    streamForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      console.log("[Renderer] Form submitted");
      await handleAddStream(e);
    });
  }

  const modals = document.querySelectorAll(".modal");
  modals.forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        closeAllModals();
      }
    });
  });
}

// Switch page
function switchPage(pageName) {
  console.log("[Renderer] Switching to page:", pageName);

  document.querySelectorAll(".menu-item").forEach((item) => {
    item.classList.remove("active");
    if (item.dataset.page === pageName) {
      item.classList.add("active");
    }
  });

  document.querySelectorAll(".page-content").forEach((page) => {
    page.classList.remove("active");
  });

  const targetPage = document.getElementById(`${pageName}-page`);
  if (targetPage) {
    targetPage.classList.add("active");
  }

  const titles = {
    dashboard: "Dashboard",
    streams: "Streaming",
    cameras: "Kamera",
    recordings: "Rekaman",
    settings: "Pengaturan",
    license: "Lisensi",
  };

  const pageTitle = document.getElementById("page-title");
  const breadcrumbCurrent = document.getElementById("breadcrumb-current");

  if (pageTitle) pageTitle.textContent = titles[pageName] || pageName;
  if (breadcrumbCurrent)
    breadcrumbCurrent.textContent = titles[pageName] || pageName;
}

// Load streams - MODIFIED untuk single stream view
async function loadStreams() {
  console.log("[Renderer] Loading streams (single view mode)");

  if (!streamManager) {
    console.error("[Renderer] StreamManager not initialized");
    return;
  }

  const streams = streamManager.getAllStreams();
  console.log(`[Renderer] Available streams: ${streams.length}`);

  if (streams.length === 0) {
    showNoStreamsMessage();
    return;
  }

  // Update active streams count
  const activeStreamsEl = document.getElementById("active-streams");
  if (activeStreamsEl) {
    activeStreamsEl.textContent = streams.length;
  }

  // Reset ke stream pertama jika index melebihi
  if (currentStreamIndex >= streams.length) {
    currentStreamIndex = 0;
  }

  // Clear video grid
  if (videoGrid) {
    videoGrid.innerHTML = "";
    videoGrid.className = "video-grid single-stream-view";
  }

  // Create player hanya untuk stream yang aktif
  const stream = streams[currentStreamIndex];
  const playerId = `video-player-${stream.id}`;
  const playerContainer = document.createElement("div");
  playerContainer.id = playerId;
  playerContainer.className = "video-player-container active-stream";

  videoGrid.appendChild(playerContainer);

  // Tambahkan stream indicator
  addStreamIndicator(currentStreamIndex, streams.length);

  setTimeout(() => {
    try {
      console.log(
        `[Renderer] Creating player for stream: ${stream.name} (${
          currentStreamIndex + 1
        }/${streams.length})`
      );
      streamManager.createPlayer(playerId, stream.id);
    } catch (error) {
      console.error(`[Renderer] Failed to create player:`, error);
    }
  }, 300);
}

// Tambahkan indicator stream yang aktif
function addStreamIndicator(currentIndex, totalStreams) {
  if (!videoGrid) return;

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < totalStreams - 1;

  const indicator = document.createElement("div");
  indicator.className = "stream-indicator";
  indicator.innerHTML = `
    <div class="indicator-content">
      <button class="indicator-btn prev-btn" onclick="window.switchToPreviousStream()" ${
        !canGoPrev ? "disabled" : ""
      }>
        <i class="fas fa-chevron-left"></i>
      </button>
      <span class="indicator-text">
        Stream ${currentIndex + 1} of ${totalStreams}
      </span>
      <button class="indicator-btn next-btn" onclick="window.switchToNextStream()" ${
        !canGoNext ? "disabled" : ""
      }>
        <i class="fas fa-chevron-right"></i>
      </button>
    </div>
  `;

  videoGrid.appendChild(indicator);
}

// Function untuk switch ke stream berikutnya - FIXED
window.switchToNextStream = function () {
  if (!streamManager) return;

  const streams = streamManager.getAllStreams();

  // Cek apakah sudah di stream terakhir
  if (currentStreamIndex >= streams.length - 1) {
    console.log("[Renderer] Already at last stream");
    return;
  }

  currentStreamIndex++;
  console.log(
    `[Renderer] Switching to next stream: index ${currentStreamIndex}`
  );

  // Destroy semua player yang ada
  streamManager.destroyAllPlayers();

  // Load ulang dengan index baru
  loadStreams();
};

// Function untuk switch ke stream sebelumnya - FIXED
window.switchToPreviousStream = function () {
  if (!streamManager) return;

  const streams = streamManager.getAllStreams();

  // Cek apakah sudah di stream pertama
  if (currentStreamIndex <= 0) {
    console.log("[Renderer] Already at first stream");
    return;
  }

  currentStreamIndex--;
  console.log(
    `[Renderer] Switching to previous stream: index ${currentStreamIndex}`
  );

  // Destroy semua player yang ada
  streamManager.destroyAllPlayers();

  // Load ulang dengan index baru
  loadStreams();
};

// Show no streams message
function showNoStreamsMessage() {
  console.log("[Renderer] No streams available");

  if (videoGrid) {
    videoGrid.innerHTML = `
      <div class="video-placeholder">
        <i class="fas fa-video-slash"></i>
        <h3>Tidak ada stream aktif</h3>
        <p>Klik tombol di bawah untuk menambahkan stream pertama</p>
        <button class="btn btn-primary mt-2" onclick="window.showAddStreamModal()">
          <i class="fas fa-plus"></i> Tambah Stream Pertama
        </button>
      </div>
    `;
  }

  const activeStreamsEl = document.getElementById("active-streams");
  if (activeStreamsEl) {
    activeStreamsEl.textContent = "0";
  }
}

// Show add stream modal
window.showAddStreamModal = function () {
  console.log("[Renderer] Opening add stream modal");

  const modal = document.getElementById("add-stream-modal");
  if (modal) {
    modal.classList.add("active");

    const form = document.getElementById("stream-form");
    if (form) {
      form.reset();
      delete form.dataset.editId;

      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-plus"></i> Tambah Stream';
      }
    }
  }
};

// Show edit stream modal
window.showEditStreamModal = function (stream) {
  console.log("[Renderer] Opening edit stream modal for:", stream.id);

  const modal = document.getElementById("add-stream-modal");
  if (!modal) return;

  modal.classList.add("active");

  const nameInput = document.getElementById("stream-name");
  const typeSelect = document.getElementById("stream-type");
  const urlInput = document.getElementById("stream-url");

  if (nameInput) nameInput.value = stream.displayName || stream.name;
  if (typeSelect) typeSelect.value = stream.type;
  if (urlInput) urlInput.value = stream.url;

  const form = document.getElementById("stream-form");
  if (form) {
    form.dataset.editId = stream.id;
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fas fa-save"></i> Update Stream';
    }
  }
};

// Handle add/edit stream
async function handleAddStream(event) {
  console.log("[Renderer] Handling add/edit stream");

  if (event) {
    event.preventDefault();
  }

  const form = document.getElementById("stream-form");
  if (!form) {
    console.error("[Renderer] Form not found");
    return;
  }

  const nameInput = document.getElementById("stream-name");
  const typeSelect = document.getElementById("stream-type");
  const urlInput = document.getElementById("stream-url");

  const name = nameInput ? nameInput.value.trim() : "";
  const type = typeSelect ? typeSelect.value : "hls";
  const url = urlInput ? urlInput.value.trim() : "";

  console.log("[Renderer] Form values:", { name, type, url });

  if (!name || !url) {
    alert("Mohon lengkapi semua field yang diperlukan!");
    return;
  }

  try {
    new URL(url);
  } catch (e) {
    alert("URL tidak valid! Pastikan URL lengkap dengan http:// atau rtsp://");
    return;
  }

  try {
    const streamConfig = {
      name: name.toLowerCase().replace(/\s+/g, "_"),
      displayName: name,
      type: type,
      url: url,
    };

    console.log("[Renderer] Stream config:", streamConfig);

    if (form.dataset.editId) {
      console.log("[Renderer] Updating stream:", form.dataset.editId);
      await streamManager.updateStream(form.dataset.editId, streamConfig);
      delete form.dataset.editId;
      console.log("[Renderer] Stream updated successfully");
    } else {
      console.log("[Renderer] Adding new stream");
      await streamManager.addStream(streamConfig);
      console.log("[Renderer] Stream added successfully");
    }

    closeAllModals();

    setTimeout(() => {
      loadStreams();
    }, 300);
  } catch (error) {
    console.error("[Renderer] Error saving stream:", error);
    alert("Error menyimpan stream: " + error.message);
  }
}

// Close all modals
function closeAllModals() {
  console.log("[Renderer] Closing all modals");

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.classList.remove("active");
  });

  const forms = document.querySelectorAll(".modal form");
  forms.forEach((form) => {
    form.reset();
    delete form.dataset.editId;

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.innerHTML = '<i class="fas fa-plus"></i> Tambah Stream';
    }
  });
}

window.closeAllModals = closeAllModals;

// Handle license status
function handleLicenseStatus(status) {
  console.log("[Renderer] License status received:", status);

  if (status.valid) {
    showScreen(appContainer);
    currentLicense = status;

    updateLicenseInfo(status);

    if (window.electronAPI) {
      window.electronAPI
        .getMediaMTXStatus()
        .then((mediamtxStatus) => {
          console.log("[Renderer] MediaMTX status:", mediamtxStatus);

          if (mediamtxStatus.running) {
            console.log("[Renderer] MediaMTX is running, initializing app...");

            if (!streamManager) {
              setTimeout(() => {
                initializeApp();
              }, 1000);
            }
          } else {
            console.warn("[Renderer] MediaMTX not running");
            showMediaMTXWarning(
              "MediaMTX server is not running. Video streaming may not work."
            );
          }
        })
        .catch((error) => {
          console.error("[Renderer] Error getting MediaMTX status:", error);
          initializeApp();
        });
    } else {
      setTimeout(() => {
        initializeApp();
      }, 1000);
    }
  } else {
    console.log("[Renderer] License invalid:", status.message);
    showScreen(errorScreen);
    if (errorMessage) {
      errorMessage.textContent = status.message;
    }
  }
}

function showMediaMTXWarning(message) {
  const warning = document.createElement("div");
  warning.className = "media-mtx-warning";
  warning.innerHTML = `
    <div style="position: fixed; top: 20px; right: 20px; background: var(--warning); 
                color: white; padding: 15px 20px; border-radius: 8px; 
                font-size: 14px; font-weight: 600; z-index: 10000; 
                box-shadow: 0 4px 12px rgba(0,0,0,0.2); display: flex; 
                align-items: center; gap: 10px;">
      <i class="fas fa-exclamation-triangle"></i>
      <span>${message}</span>
      <button style="background: none; border: none; color: white; 
                     cursor: pointer; margin-left: 10px;" 
              onclick="this.parentElement.remove()">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;

  document.body.appendChild(warning);

  setTimeout(() => {
    if (warning.parentElement) {
      warning.remove();
    }
  }, 10000);
}

// Update license info
function updateLicenseInfo(status) {
  console.log("[Renderer] Updating license info");

  const licenseBadge = document.getElementById("license-badge");
  if (licenseBadge && status.valid) {
    licenseBadge.innerHTML = `
      <i class="fas fa-check-circle"></i>
      <span>Lisensi Aktif</span>
    `;
  }

  const licenseStatus = document.getElementById("license-status");
  if (licenseStatus) {
    licenseStatus.textContent = status.valid ? "Valid" : "Invalid";
    licenseStatus.className = `status-badge ${
      status.valid ? "success" : "danger"
    }`;
  }

  const flashdiskStatus = document.getElementById("flashdisk-status");
  if (flashdiskStatus) {
    flashdiskStatus.textContent = status.drive
      ? "Terkoneksi"
      : "Tidak Terkoneksi";
    flashdiskStatus.className = `status-badge ${
      status.drive ? "success" : "danger"
    }`;
  }

  const licenseDetails = document.getElementById("license-details");
  if (licenseDetails && status.data) {
    const expiryDate = status.data.expiry
      ? new Date(status.data.expiry).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "N/A";

    licenseDetails.innerHTML = `
      <div style="font-size: 13px; color: var(--gray); line-height: 1.8;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span>Customer:</span>
          <strong style="color: white;">${
            status.data.customer_name || "N/A"
          }</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span>Drive:</span>
          <strong style="color: white;">${status.drive || "N/A"}:</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span>Model:</span>
          <strong style="color: white;">${status.data.model || "N/A"}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span>Expired:</span>
          <strong style="color: var(--success);">${expiryDate}</strong>
        </div>
      </div>
    `;
  }
}

// Check license manually
async function checkLicense() {
  console.log("[Renderer] Checking license...");
  showScreen(loadingScreen);

  try {
    const status = await window.electronAPI.checkLicense();
    console.log("[Renderer] License check complete:", status);
    handleLicenseStatus(status);
  } catch (error) {
    console.error("[Renderer] Error checking license:", error);
    showScreen(errorScreen);
    if (errorMessage) {
      errorMessage.textContent = "Error checking license: " + error.message;
    }
  }
}

window.loadStreams = loadStreams;

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    console.log("[Renderer] DOM Content Loaded");
    initDOM();
    setupEventListeners();

    setTimeout(() => {
      checkLicense();
    }, 500);
  });
} else {
  console.log("[Renderer] DOM already loaded");
  initDOM();
  setupEventListeners();

  setTimeout(() => {
    checkLicense();
  }, 500);
}

console.log("[Renderer] Renderer.js loaded - Simple 2-Stream Navigation Mode");
console.log("[Renderer] electronAPI available:", !!window.electronAPI);
