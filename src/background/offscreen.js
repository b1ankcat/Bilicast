import { MESSAGE } from "../shared/messages.js";
import { fail, messageFromError } from "../shared/result.js";

const player = document.getElementById("offscreen-player");
player.preload = "auto";
player.autoplay = true;
const UPDATE_INTERVAL = 800;
const LOAD_TIMEOUT = 12000;
let lastUpdate = 0;
let suppressPlayerErrorFeedback = false;
let recoveringFromError = false;
let sourceState = createEmptySourceState();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return;
  }
  if (message.type === MESSAGE.OFFSCREEN_LOAD) {
    loadSource(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => {
        sendResponse(fail(messageFromError(error, "无法加载音频")));
      });
    return true;
  }
  if (message.type === MESSAGE.OFFSCREEN_CONTROL) {
    applyControl(message.payload || {})
      .then((result) => sendResponse?.(result || { ok: true }))
      .catch((error) => {
        sendResponse?.(fail(messageFromError(error, "播放控制失败")));
      });
    return true;
  }
});

chrome.runtime.sendMessage({ type: MESSAGE.OFFSCREEN_READY }).catch(() => {});

async function loadSource(payload = {}) {
  const candidates = collectCandidateUrls(payload);
  if (!candidates.length) {
    return fail("缺少播放地址");
  }
  sourceState = {
    videoId: payload.videoId || null,
    urls: candidates,
    activeIndex: -1
  };
  suppressPlayerErrorFeedback = true;
  try {
    const result = await tryLoadCandidates(candidates, payload.startAt || 0);
    sourceState.activeIndex = result.index;
    suppressPlayerErrorFeedback = false;
    return { ok: true };
  } catch (error) {
    suppressPlayerErrorFeedback = false;
    sourceState = createEmptySourceState();
    return fail(messageFromError(error, "无法加载音频"));
  }
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

async function tryLoadCandidates(candidates, startAt = 0, originalIndexes = []) {
  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      await attemptLoad(candidates[index], startAt);
      return {
        index: typeof originalIndexes[index] === "number" ? originalIndexes[index] : index
      };
    } catch (error) {
      lastError = error;
    }
  }
  return Promise.reject(lastError || "音频加载失败");
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
    const failLoad = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(typeof error === "string" ? error : error?.message || "音频加载失败");
    };
    const onError = () => {
      failLoad(formatMediaError(player.error) || "音频加载失败");
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
    const timer = setTimeout(() => failLoad("音频加载超时"), LOAD_TIMEOUT);

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
        playPromise.then(fulfill).catch(failLoad);
      } else {
        fulfill();
      }
    } catch (error) {
      failLoad(error);
    }
  });
}

async function applyControl(control) {
  switch (control.action) {
    case "play": {
      if (!player.src) {
        return fail("当前播放器没有可恢复音源，需重新拉取", { reloadRequired: true });
      }
      await player.play();
      return { ok: true };
    }
    case "pause":
      player.pause();
      return { ok: true };
    case "seek":
      if (typeof control.seconds === "number" && !Number.isNaN(control.seconds)) {
        player.currentTime = control.seconds;
      }
      return { ok: true };
    case "stop":
      player.pause();
      player.removeAttribute("src");
      player.load();
      sourceState = createEmptySourceState();
      return { ok: true };
    case "volume":
      if (typeof control.value === "number") {
        player.volume = Math.min(1, Math.max(0, control.value));
      }
      return { ok: true };
    default:
      return { ok: true };
  }
}

function createEmptySourceState() {
  return {
    videoId: null,
    urls: [],
    activeIndex: -1
  };
}

player.addEventListener("timeupdate", () => emitState());
player.addEventListener("playing", () => emitState(true));
player.addEventListener("pause", () => emitState(true));
player.addEventListener("ended", () => {
  emitState(true);
  chrome.runtime.sendMessage({ type: MESSAGE.OFFSCREEN_ENDED }).catch(() => {});
});
player.addEventListener("error", () => {
  if (suppressPlayerErrorFeedback) {
    return;
  }
  recoverFromPlaybackError(formatMediaError(player.error) || "播放失败").catch(() => {});
});

async function recoverFromPlaybackError(errorMessage) {
  if (recoveringFromError) {
    return;
  }
  recoveringFromError = true;
  try {
    const resumeAt = Math.max(0, Number(player.currentTime) || 0);
    const fallbackIndexes = sourceState.urls
      .map((_, index) => index)
      .filter((index) => index !== sourceState.activeIndex);
    const fallbackUrls = fallbackIndexes.map((index) => sourceState.urls[index]);
    if (fallbackUrls.length) {
      try {
        const result = await tryLoadCandidates(fallbackUrls, resumeAt, fallbackIndexes);
        sourceState.activeIndex = result.index;
        emitState(true);
        return;
      } catch {
        // continue to background recovery
      }
    }
    await chrome.runtime.sendMessage({
      type: MESSAGE.OFFSCREEN_SOURCE_FAILED,
      payload: {
        videoId: sourceState.videoId,
        currentTime: resumeAt,
        error: errorMessage
      }
    });
  } finally {
    recoveringFromError = false;
  }
}

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
