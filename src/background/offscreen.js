import { MESSAGE } from "../shared/messages.js";

const player = document.getElementById("offscreen-player");
player.preload = "auto";
player.autoplay = true;
const UPDATE_INTERVAL = 800;
const LOAD_TIMEOUT = 12000;
let lastUpdate = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return;
  }
  if (message.type === MESSAGE.OFFSCREEN_LOAD) {
    loadSource(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("Failed to load source", error);
        sendResponse({ ok: false, message: error.message });
      });
    return true;
  }
  if (message.type === MESSAGE.OFFSCREEN_CONTROL) {
    applyControl(message.payload || {});
    sendResponse?.({ ok: true });
    return;
  }
});

chrome.runtime.sendMessage({ type: MESSAGE.OFFSCREEN_READY }).catch((error) => {
  console.error("Failed to notify readiness", error);
});

async function loadSource(payload = {}) {
  const candidates = collectCandidateUrls(payload);
  if (!candidates.length) {
    throw new Error("缺少播放地址");
  }
  let lastError = null;
  for (const url of candidates) {
    try {
      await attemptLoad(url, payload.startAt || 0);
      return;
    } catch (error) {
      lastError = error;
      console.warn("Failed to load candidate", url, formatMediaError(error));
    }
  }
  throw lastError || new Error("无法加载音频");
}

function collectCandidateUrls(payload) {
  const urls = [];
  const append = (value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (urls.includes(trimmed)) return;
    urls.push(trimmed);
  };
  if (payload.url) {
    append(payload.url);
  }
  if (Array.isArray(payload.urls)) {
    payload.urls.forEach(append);
  }
  return urls;
}

function formatMediaError(error) {
  if (!error) {
    return "未知错误";
  }
  if (error instanceof Error) {
    return `${error.name || "Error"}: ${error.message}`;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error.message === "string") {
    return error.message;
  }
  if (player?.error) {
    return `MediaError(code=${player.error.code || "unknown"})`;
  }
  return String(error);
}

function attemptLoad(url, startAt = 0) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const startSeconds = Math.max(0, Number(startAt) || 0);
    const cleanup = () => {
      clearTimeout(timer);
      player.removeEventListener("error", onError);
      player.removeEventListener("stalled", onError);
      player.removeEventListener("abort", onError);
      player.removeEventListener("loadedmetadata", onLoadedMeta);
    };
    const fulfill = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const detail = error instanceof Error ? error : new Error("音频加载失败");
      reject(detail);
    };
    const onError = () => {
      fail(player.error || new Error("音频加载失败"));
    };
    const onLoadedMeta = () => {
      try {
        if (startSeconds > 0) {
          player.currentTime = startSeconds;
        }
      } catch {
        // ignore
      }
    };
    const timer = setTimeout(() => fail(new Error("音频加载超时")), LOAD_TIMEOUT);

    player.pause();
    player.removeAttribute("src");
    player.load();
    player.addEventListener("error", onError);
    player.addEventListener("stalled", onError);
    player.addEventListener("abort", onError);
    player.addEventListener("loadedmetadata", onLoadedMeta, { once: true });

    try {
      player.removeAttribute("crossorigin");
      player.crossOrigin = "";
      player.src = url;
      player.load();
      if (player.readyState >= 1) {
        onLoadedMeta();
      }
      const playPromise = player.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.then(fulfill).catch(fail);
      } else {
        fulfill();
      }
    } catch (error) {
      fail(error);
    }
  });
}

function applyControl(control) {
  switch (control.action) {
    case "play":
      player.play().catch((error) => console.warn("play failed", error));
      break;
    case "pause":
      player.pause();
      break;
    case "seek":
      if (typeof control.seconds === "number" && !Number.isNaN(control.seconds)) {
        player.currentTime = control.seconds;
      }
      break;
    case "stop":
      player.pause();
      player.removeAttribute("src");
      player.load();
      break;
    case "volume":
      if (typeof control.value === "number") {
        player.volume = Math.min(1, Math.max(0, control.value));
      }
      break;
    default:
      break;
  }
}

player.addEventListener("timeupdate", () => emitState());
player.addEventListener("playing", () => emitState(true));
player.addEventListener("pause", () => emitState(true));
player.addEventListener("ended", () => {
  emitState(true);
  chrome.runtime.sendMessage({ type: MESSAGE.OFFSCREEN_ENDED }).catch((error) =>
    console.error("Failed to notify ended", error)
  );
});
player.addEventListener("error", () => {
  const error = player.error;
  chrome.runtime.sendMessage({
    type: MESSAGE.OFFSCREEN_STATE,
    payload: { error: error?.message || "播放失败", paused: true }
  });
});

function emitState(force = false) {
  const now = Date.now();
  if (!force && now - lastUpdate < UPDATE_INTERVAL) {
    return;
  }
  lastUpdate = now;
  chrome.runtime.sendMessage({
    type: MESSAGE.OFFSCREEN_STATE,
    payload: {
      currentTime: player.currentTime || 0,
      duration: Number.isFinite(player.duration) ? player.duration : 0,
      paused: player.paused
    }
  });
}
