import { MESSAGE } from "../shared/messages.js";
import {
  STORAGE_KEY,
  createDefaultState,
  createCategory,
  createVideoEntry,
  DEFAULT_CATEGORY_ID
} from "../shared/playlist.js";

const OFFSCREEN_PATH = "src/background/offscreen.html";
const API_HEADERS = {
  Referer: "https://www.bilibili.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
};
const AUDIO_REFERER_RULES = [
  { id: 1, regexFilter: "^https?:\\/\\/([\\w-]+\\.)*bilivideo\\.com(:\\d+)?\\/.*" },
  { id: 2, regexFilter: "^https?:\\/\\/([\\w-]+\\.)*bilivideo\\.cn(:\\d+)?\\/.*" }
];
const PLAYBACK_REFERER_RULES = [
  { id: 1001, regexFilter: "^https?:\\/\\/([\\w-]+\\.)*bilivideo\\.com(:\\d+)?\\/.*" },
  { id: 1002, regexFilter: "^https?:\\/\\/([\\w-]+\\.)*bilivideo\\.cn(:\\d+)?\\/.*" }
];
const popupPorts = new Set();
let cachedState = null;
let offscreenReady = false;
let offscreenCreation = null;
let offscreenReadyWaiters = [];
const OFFSCREEN_READY_TIMEOUT = 5000;

chrome.runtime.onInstalled.addListener(async () => {
  await initializeState();
  await ensureRequestRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeState();
  await ensureRequestRules();
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "popup") {
    return;
  }
  popupPorts.add(port);
  sendSnapshotToPort(port);
  port.onDisconnect.addListener(() => {
    popupPorts.delete(port);
  });
});

const messageRouter = {
  [MESSAGE.POPUP_INIT]: async () => formatSnapshot(await ensureState()),
  [MESSAGE.PLAYLIST_GET_CATEGORIES]: async () => listCategorySummary(),
  [MESSAGE.PLAYLIST_CREATE_CATEGORY]: async ({ payload }) => createCategoryFlow(payload?.name),
  [MESSAGE.PLAYLIST_DELETE_CATEGORY]: async ({ payload }) => deleteCategoryFlow(payload?.categoryId),
  [MESSAGE.PLAYLIST_ADD_VIDEO]: async ({ payload }) => addVideoFlow(payload),
  [MESSAGE.PLAYLIST_DELETE_VIDEO]: async ({ payload }) => deleteVideoFlow(payload),
  [MESSAGE.POPUP_SELECT_CATEGORY]: async ({ payload }) => selectCategoryFlow(payload?.categoryId),
  [MESSAGE.POPUP_PLAY_VIDEO]: async ({ payload }) => playVideoFlow(payload),
  [MESSAGE.POPUP_CONTROL]: async ({ payload }) => controlPlaybackFlow(payload?.action, payload?.manual),
  [MESSAGE.POPUP_SEEK]: async ({ payload }) => seekFlow(payload?.seconds),
  [MESSAGE.POPUP_SET_MODE]: async ({ payload }) => setModeFlow(payload?.mode),
  [MESSAGE.POPUP_SET_VOLUME]: async ({ payload }) => setVolumeFlow(payload?.volume)
};

if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    console.debug("DNR matched", info.rule.ruleId, info.request.url);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) {
    return;
  }

  if (message.type === MESSAGE.OFFSCREEN_READY) {
    handleOffscreenReady();
    sendResponse?.({ ok: true });
    return;
  }

  if (message.type === MESSAGE.OFFSCREEN_STATE) {
    handleOffscreenState(message.payload);
    sendResponse?.({ ok: true });
    return;
  }

  if (message.type === MESSAGE.OFFSCREEN_ENDED) {
    handleOffscreenEnded();
    sendResponse?.({ ok: true });
    return;
  }

  const handler = messageRouter[message.type];
  if (!handler) {
    return;
  }

  handler(message, sender)
    .then((result) => sendResponse?.(result))
    .catch((error) => {
      console.error("Message handler failed", message.type, error);
      sendResponse?.({ ok: false, message: error.message });
    });
  return true;
});

async function initializeState() {
  await ensureState();
  await updatePlaybackRefererRules(null);
}

async function ensureRequestRules() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }
  try {
    const ruleDefinitions = AUDIO_REFERER_RULES.map(({ id, regexFilter }) => ({
      id,
      priority: 1,
      condition: {
        regexFilter,
        resourceTypes: ["xmlhttprequest", "media", "other"]
      },
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "referer",
            operation: "set",
            value: "https://www.bilibili.com"
          },
          {
            header: "origin",
            operation: "set",
            value: "https://www.bilibili.com"
          },
          {
            header: "user-agent",
            operation: "set",
            value: API_HEADERS["User-Agent"]
          }
        ]
      }
    }));
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: AUDIO_REFERER_RULES.map((rule) => rule.id),
      addRules: ruleDefinitions
    });
  } catch (error) {
    console.warn("Failed to update DNR rules", error);
  }
}

async function updatePlaybackRefererRules(refererValue) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }
  const removeRuleIds = PLAYBACK_REFERER_RULES.map((rule) => rule.id);
  let addRules = [];
  if (refererValue) {
    addRules = PLAYBACK_REFERER_RULES.map(({ id, regexFilter }) => ({
      id,
      priority: 100,
      condition: {
        regexFilter,
        resourceTypes: ["xmlhttprequest", "media", "other"]
      },
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "referer",
            operation: "set",
            value: refererValue
          },
          {
            header: "origin",
            operation: "set",
            value: "https://www.bilibili.com"
          },
          {
            header: "user-agent",
            operation: "set",
            value: API_HEADERS["User-Agent"]
          }
        ]
      }
    }));
  }
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });
  } catch (error) {
    console.warn("Failed to update playback referer", error);
  }
}

function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

async function ensureState() {
  if (cachedState) {
    return cachedState;
  }
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  if (!stored[STORAGE_KEY]) {
    cachedState = createDefaultState();
    await chrome.storage.local.set({ [STORAGE_KEY]: cachedState });
  } else {
    cachedState = hydrateState(stored[STORAGE_KEY]);
  }
  return cachedState;
}

function hydrateState(raw) {
  const defaults = createDefaultState();
  const categories = { ...defaults.categories, ...(raw?.categories || {}) };
  const order = Array.isArray(raw?.categoryOrder) && raw.categoryOrder.length
    ? raw.categoryOrder.filter((id) => categories[id])
    : Object.keys(categories);
  const activeCategoryId = categories[raw?.activeCategoryId] ? raw.activeCategoryId : order[0] || DEFAULT_CATEGORY_ID;
  return {
    categories,
    categoryOrder: order,
    activeCategoryId,
    playback: { ...defaults.playback, ...(raw?.playback || {}) }
  };
}

async function setState(nextState) {
  cachedState = nextState;
  await chrome.storage.local.set({ [STORAGE_KEY]: cachedState });
  await pushSnapshot();
  return cachedState;
}

async function mutateState(mutator) {
  const working = deepClone(await ensureState());
  const result = (await mutator(working)) || working;
  return setState(result);
}

async function pushSnapshot() {
  if (!popupPorts.size) {
    return;
  }
  const snapshot = formatSnapshot(cachedState || (await ensureState()));
  for (const port of popupPorts) {
    try {
      port.postMessage({ type: MESSAGE.STORAGE_PUSH, payload: snapshot });
    } catch (error) {
      console.warn("Failed to update popup", error);
    }
  }
}

function formatSnapshot(state) {
  const clone = deepClone(state);
  return {
    categories: clone.categoryOrder.map((id) => clone.categories[id]).filter(Boolean),
    categoryOrder: clone.categoryOrder,
    activeCategoryId: clone.activeCategoryId,
    playback: clone.playback
  };
}

async function sendSnapshotToPort(port) {
  const snapshot = await formatSnapshot(await ensureState());
  port.postMessage({ type: MESSAGE.STORAGE_PUSH, payload: snapshot });
}

async function listCategorySummary() {
  const state = await ensureState();
  const categories = state.categoryOrder
    .map((id) => state.categories[id])
    .filter(Boolean)
    .map((category) => ({
      id: category.id,
      name: category.name,
      count: category.videos.length
    }));
  return { ok: true, categories, activeCategoryId: state.activeCategoryId };
}

async function createCategoryFlow(name) {
  const trimmed = (name || "").trim();
  const newCategory = createCategory(trimmed);
  await mutateState((draft) => {
    draft.categories[newCategory.id] = newCategory;
    draft.categoryOrder.push(newCategory.id);
    draft.activeCategoryId = newCategory.id;
  });
  return { ok: true, category: newCategory };
}

async function deleteCategoryFlow(categoryId) {
  if (!categoryId) {
    throw new Error("categoryId is required");
  }
  if (categoryId === DEFAULT_CATEGORY_ID) {
    throw new Error("默认分类无法删除");
  }
  let shouldStopPlayback = false;
  await mutateState((draft) => {
    if (!draft.categories[categoryId]) {
      throw new Error("分类不存在");
    }
    const remaining = draft.categoryOrder.filter((id) => id !== categoryId);
    if (!remaining.length) {
      throw new Error("至少保留一个分类");
    }
    delete draft.categories[categoryId];
    draft.categoryOrder = remaining;
    if (draft.activeCategoryId === categoryId) {
      draft.activeCategoryId = remaining[0];
    }
    if (draft.playback.categoryId === categoryId) {
      draft.playback.categoryId = null;
      draft.playback.videoId = null;
      draft.playback.status = "paused";
      shouldStopPlayback = true;
    }
  });
  if (shouldStopPlayback) {
    await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "stop" } }).catch((error) =>
      console.warn("Failed to stop playback after deleting category", error)
    );
  }
  return { ok: true };
}

async function addVideoFlow(payload) {
  if (!payload?.video) {
    throw new Error("缺少视频数据");
  }
  const targetCategoryId = payload.categoryId;
  const videoEntry = createVideoEntry(payload.video);
  const enrichedVideo = await ensureVideoMeta(videoEntry);
  await mutateState((draft) => {
    const category = draft.categories[targetCategoryId] || draft.categories[draft.activeCategoryId] || draft.categories[DEFAULT_CATEGORY_ID];
    if (!category) {
      throw new Error("未找到分类");
    }
    const existingIndex = category.videos.findIndex((video) => video.id === enrichedVideo.id);
    if (existingIndex >= 0) {
      category.videos.splice(existingIndex, 1, enrichedVideo);
    } else {
      category.videos.unshift(enrichedVideo);
    }
    if (!draft.activeCategoryId) {
      draft.activeCategoryId = category.id;
    }
  });
  return { ok: true, video: enrichedVideo };
}

async function deleteVideoFlow(payload) {
  const categoryId = payload?.categoryId;
  const videoId = payload?.videoId;
  if (!categoryId || !videoId) {
    throw new Error("缺少分类或视频信息");
  }
  let shouldStopPlayback = false;
  await mutateState((draft) => {
    const category = draft.categories[categoryId];
    if (!category) {
      throw new Error("分类不存在");
    }
    const index = category.videos.findIndex((video) => video.id === videoId);
    if (index === -1) {
      throw new Error("视频不存在");
    }
    category.videos.splice(index, 1);
    if (draft.playback.videoId === videoId) {
      draft.playback.videoId = null;
      draft.playback.status = "paused";
      draft.playback.progress = 0;
      shouldStopPlayback = true;
    }
  });
  if (shouldStopPlayback) {
    await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "stop" } }).catch((error) =>
      console.warn("Failed to stop playback after deleting video", error)
    );
  }
  return { ok: true };
}

async function ensureAudioStream(categoryId, videoId, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const state = await ensureState();
  const category = state.categories[categoryId];
  if (!category) {
    throw new Error("分类不存在");
  }
  const video = category.videos.find((item) => item.id === videoId);
  if (!video) {
    throw new Error("未找到视频");
  }
  if (!forceRefresh && video.audioUrl && video.cid) {
    return video;
  }
  const meta = video.cid && !forceRefresh
    ? { cid: video.cid, duration: video.duration }
    : await fetchVideoMeta(video.bvid);
  const cid = meta.cid || video.cid;
  const stream = await fetchAudioStream(video.bvid, cid);
  const duration = stream.duration || meta.duration || video.duration;
  await mutateState((draft) => {
    const targetCategory = draft.categories[categoryId];
    if (!targetCategory) return;
    const index = targetCategory.videos.findIndex((item) => item.id === videoId);
    if (index === -1) return;
    targetCategory.videos[index] = {
      ...targetCategory.videos[index],
      cid,
      audioUrl: stream.audioUrl,
      audioUrls: Array.isArray(stream.audioUrls) && stream.audioUrls.length
        ? stream.audioUrls
        : targetCategory.videos[index].audioUrls || (stream.audioUrl ? [stream.audioUrl] : []),
      duration: duration || targetCategory.videos[index].duration,
      audioFetchedAt: Date.now()
    };
  });
  const refreshed = await ensureState();
  return refreshed.categories[categoryId].videos.find((item) => item.id === videoId);
}

async function fetchVideoMeta(bvid) {
  const endpoint = new URL("https://api.bilibili.com/x/web-interface/view");
  endpoint.searchParams.set("bvid", bvid);
  const res = await fetch(endpoint.toString(), { headers: API_HEADERS });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message || "获取视频信息失败");
  }
  return {
    cid: json.data?.cid,
    duration: json.data?.duration
  };
}

async function ensureVideoMeta(video) {
  if (video.duration && video.duration > 0 && video.cid) {
    return video;
  }
  try {
    const meta = await fetchVideoMeta(video.bvid);
    return {
      ...video,
      duration: meta.duration || video.duration,
      cid: meta.cid || video.cid
    };
  } catch (error) {
    console.warn("Failed to fetch video meta", error);
    return video;
  }
}

async function fetchAudioStream(bvid, cid) {
  const endpoint = new URL("https://api.bilibili.com/x/player/playurl");
  endpoint.searchParams.set("bvid", bvid);
  if (cid) endpoint.searchParams.set("cid", cid);
  endpoint.searchParams.set("fnval", "16");
  endpoint.searchParams.set("fnver", "0");
  endpoint.searchParams.set("fourk", "0");
  const res = await fetch(endpoint.toString(), { headers: API_HEADERS });
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message || "获取播放地址失败");
  }
  const data = json.data || {};
  const dash = data.dash || {};
  const urls = [];
  const seen = new Set();
  const pushUrl = (value) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    urls.push(trimmed);
  };
  const dashAudios = [
    ...(Array.isArray(dash.audio) ? dash.audio : []),
    ...(Array.isArray(dash.dolby?.audio) ? dash.dolby.audio : []),
    ...(Array.isArray(dash.flac?.audio) ? dash.flac.audio : [])
  ];
  for (const track of dashAudios) {
    pushUrl(track?.baseUrl);
    if (Array.isArray(track?.backupUrl)) {
      track.backupUrl.forEach(pushUrl);
    }
  }
  if (Array.isArray(data.durl)) {
    for (const segment of data.durl) {
      pushUrl(segment?.url);
      if (Array.isArray(segment?.backup_url)) {
        segment.backup_url.forEach(pushUrl);
      }
    }
  }
  const audioUrl = urls[0];
  if (!audioUrl) {
    throw new Error("未找到音频流");
  }
  const duration = dash.duration || (data.durl?.[0]?.length ? data.durl[0].length / 1000 : undefined);
  return { audioUrl, audioUrls: urls, duration };
}

async function selectCategoryFlow(categoryId) {
  if (!categoryId) {
    throw new Error("categoryId 不能为空");
  }
  await mutateState((draft) => {
    if (!draft.categories[categoryId]) {
      throw new Error("分类不存在");
    }
    draft.activeCategoryId = categoryId;
  });
  return { ok: true };
}

async function playVideoFlow(payload) {
  const state = await ensureState();
  const categoryId = payload?.categoryId || state.activeCategoryId;
  const videoId = payload?.videoId || state.categories[categoryId]?.videos[0]?.id;
  if (!categoryId || !videoId) {
    throw new Error("没有可播放的视频");
  }
  await playVideoById(categoryId, videoId, payload?.startAt || 0);
  return { ok: true };
}

async function controlPlaybackFlow(action = "play", manual = false) {
  const state = await ensureState();
  if (action === "play") {
    if (state.playback.videoId) {
      await resumePlayback(state);
      return { ok: true };
    }
    const category = state.categories[state.activeCategoryId];
    const firstVideo = category?.videos[0];
    if (firstVideo) {
      await playVideoById(state.activeCategoryId, firstVideo.id, 0);
      return { ok: true };
    }
    throw new Error("当前分类没有视频");
  }

  if (action === "pause") {
    await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "pause" } });
    await updatePlaybackRuntime({ status: "paused" });
    return { ok: true };
  }

  if (action === "next" || action === "previous") {
    const direction = action === "next" ? 1 : -1;
    const nextTarget = computeNextTrack(await ensureState(), direction, { manual });
    if (!nextTarget) {
      throw new Error("没有更多视频");
    }
    await playVideoById(nextTarget.categoryId, nextTarget.videoId, 0);
    return { ok: true };
  }

  throw new Error(`未知操作 ${action}`);
}

async function setModeFlow(mode) {
  if (!mode) {
    throw new Error("缺少播放模式");
  }
  const allowedModes = new Set(["single", "list", "all", "shuffle"]);
  if (!allowedModes.has(mode)) {
    throw new Error("不支持的播放模式");
  }
  await mutateState((draft) => {
    draft.playback.mode = mode;
  });
  return { ok: true };
}

async function seekFlow(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    throw new Error("拖动时间无效");
  }
  await ensureOffscreenDocument();
  await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "seek", seconds } });
  await updatePlaybackRuntime({ progress: seconds });
  return { ok: true };
}

async function setVolumeFlow(volume) {
  const value = typeof volume === "number" ? Math.min(1, Math.max(0, volume)) : null;
  if (value === null) {
    throw new Error("音量设置无效");
  }
  await mutateState((draft) => {
    draft.playback.volume = value;
  });
  await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "volume", value } });
  return { ok: true };
}

async function playVideoById(categoryId, videoId, startAt = 0) {
  return playVideoByIdInternal(categoryId, videoId, startAt, {
    forceRefresh: false,
    allowStreamRefreshRetry: true
  });
}

async function playVideoByIdInternal(categoryId, videoId, startAt = 0, options = {}) {
  const forceRefresh = Boolean(options.forceRefresh);
  const allowStreamRefreshRetry = options.allowStreamRefreshRetry !== false;
  const state = await ensureState();
  const category = state.categories[categoryId];
  if (!category) {
    throw new Error("分类不存在");
  }
  const video = category.videos.find((item) => item.id === videoId);
  if (!video) {
    throw new Error("未找到视频");
  }
  const resolvedVideo = await ensureAudioStream(categoryId, video.id, { forceRefresh });
  if (!resolvedVideo?.audioUrl) {
    throw new Error("无法解析音频地址");
  }
  await ensureOffscreenDocument();
  const referer = buildVideoReferer(resolvedVideo) || sanitizeReferer(resolvedVideo.url);
  await updatePlaybackRefererRules(referer);
  const candidateUrls = Array.isArray(resolvedVideo.audioUrls) && resolvedVideo.audioUrls.length
    ? resolvedVideo.audioUrls
    : resolvedVideo.audioUrl
      ? [resolvedVideo.audioUrl]
      : [];
  if (!candidateUrls.length) {
    throw new Error("缺少音频地址");
  }
  const response = await queueOffscreenMessage({
    type: MESSAGE.OFFSCREEN_LOAD,
    payload: {
      videoId: resolvedVideo.id,
      url: candidateUrls[0],
      urls: candidateUrls,
      title: resolvedVideo.title,
      cover: resolvedVideo.cover,
      startAt
    }
  });
  if (!response?.ok) {
    if (allowStreamRefreshRetry && !forceRefresh) {
      console.warn("Playback load failed, refreshing audio stream", categoryId, videoId, response?.message);
      return playVideoByIdInternal(categoryId, videoId, startAt, {
        forceRefresh: true,
        allowStreamRefreshRetry: false
      });
    }
    throw new Error(response?.message || "音频加载失败");
  }
  await mutateState((draft) => {
    draft.activeCategoryId = categoryId;
    draft.playback = {
      ...draft.playback,
      categoryId,
      videoId: resolvedVideo.id,
      status: "playing",
      progress: startAt,
      duration: resolvedVideo.duration || draft.playback.duration,
      updatedAt: Date.now()
    };
  });
}

async function resumePlayback(state) {
  const categoryId = state.playback.categoryId || state.activeCategoryId;
  const videoId = state.playback.videoId;
  if (!categoryId || !videoId) {
    throw new Error("没有可恢复的视频");
  }
  await ensureOffscreenDocument();
  const response = await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "play" } });
  if (response?.ok) {
    await updatePlaybackRuntime({ status: "playing" });
    return;
  }
  if (response?.reloadRequired) {
    console.warn("Resume requested stream reload", categoryId, videoId, response?.message);
  } else {
    console.warn("Resume failed, refreshing audio stream", categoryId, videoId, response?.message);
  }
  await playVideoByIdInternal(categoryId, videoId, state.playback.progress || 0, {
    forceRefresh: true,
    allowStreamRefreshRetry: false
  });
}

function computeNextTrack(state, direction, options = {}) {
  const manual = Boolean(options.manual);
  const playableCategories = state.categoryOrder
    .map((id) => state.categories[id])
    .filter((cat) => cat && cat.videos.length);
  if (!playableCategories.length) {
    return null;
  }
  let mode = state.playback.mode || "list";
  if (manual && mode === "single") {
    mode = "list";
  }
  const currentCategoryId = state.playback.categoryId || state.activeCategoryId || playableCategories[0].id;
  const currentCategory = state.categories[currentCategoryId] || playableCategories[0];

  if (mode === "single" && state.playback.videoId) {
    return { categoryId: currentCategoryId, videoId: state.playback.videoId };
  }

  if (mode === "shuffle") {
    const pool = playableCategories.flatMap((cat) => cat.videos.map((video) => ({ categoryId: cat.id, videoId: video.id })));
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    let candidate = pool[Math.floor(Math.random() * pool.length)];
    if (state.playback.videoId && pool.length > 1) {
      let attempts = 0;
      while (candidate.videoId === state.playback.videoId && attempts < 5) {
        candidate = pool[Math.floor(Math.random() * pool.length)];
        attempts++;
      }
    }
    return candidate;
  }

  const loopWithinCategory = mode === "list" || (manual && mode === "single");
  const withinCategory = cycleWithinCategory(currentCategory, state.playback.videoId, direction, loopWithinCategory);
  if (withinCategory) {
    return withinCategory;
  }

  if (mode === "list") {
    return null;
  }

  const currentIndex = playableCategories.findIndex((cat) => cat.id === currentCategory.id);
  if (currentIndex === -1) {
    return { categoryId: playableCategories[0].id, videoId: playableCategories[0].videos[0].id };
  }
  let nextIndex = (currentIndex + direction + playableCategories.length) % playableCategories.length;
  const nextCategory = playableCategories[nextIndex];
  const nextVideo = nextCategory.videos[direction > 0 ? 0 : nextCategory.videos.length - 1];
  return { categoryId: nextCategory.id, videoId: nextVideo.id };
}

function cycleWithinCategory(category, currentVideoId, direction, loop) {
  if (!category || !category.videos.length) {
    return null;
  }
  const index = category.videos.findIndex((video) => video.id === currentVideoId);
  if (index === -1) {
    return { categoryId: category.id, videoId: category.videos[direction > 0 ? 0 : category.videos.length - 1].id };
  }
  let nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= category.videos.length) {
    if (!loop) {
      return null;
    }
    nextIndex = (nextIndex + category.videos.length) % category.videos.length;
  }
  return { categoryId: category.id, videoId: category.videos[nextIndex].id };
}

function buildVideoReferer(video) {
  if (!video?.bvid) {
    return null;
  }
  try {
    const url = new URL(`https://www.bilibili.com/video/${video.bvid}`);
    const page = Number(video.pageIndex) || 1;
    url.searchParams.set("p", page);
    url.searchParams.set("t", "0");
    return url.toString();
  } catch (error) {
    console.warn("Failed to build referer", error);
    return null;
  }
}

function sanitizeReferer(rawUrl) {
  try {
    const url = rawUrl ? new URL(rawUrl) : new URL("https://www.bilibili.com");
    url.hash = "";
    if (!url.searchParams.has("t")) {
      url.searchParams.set("t", "0");
    }
    return url.toString();
  } catch {
    return "https://www.bilibili.com";
  }
}

function handleOffscreenReady() {
  offscreenReady = true;
  const waiters = [...offscreenReadyWaiters];
  offscreenReadyWaiters = [];
  for (const entry of waiters) {
    clearTimeout(entry.timer);
    entry.resolve(true);
  }
}

function handleOffscreenState(payload = {}) {
  updatePlaybackRuntime({
    progress: typeof payload.currentTime === "number" ? payload.currentTime : undefined,
    duration: typeof payload.duration === "number" ? payload.duration : undefined,
    status: payload.paused ? "paused" : "playing"
  }).catch((error) => console.error("Failed to sync playback", error));
}

function handleOffscreenEnded() {
  updatePlaybackRuntime({ status: "paused", progress: 0 }).catch((error) =>
    console.error("Failed to stop playback", error)
  );
  controlPlaybackFlow("next").catch((error) => console.error("Auto next failed", error));
}

async function ensureOffscreenDocument(options = {}) {
  const forceRecreate = Boolean(options.forceRecreate);
  if (offscreenReady && !forceRecreate) {
    return true;
  }
  if (offscreenCreation) {
    await offscreenCreation;
    return true;
  }
  offscreenCreation = (async () => {
    const hasExistingDocument = await hasOffscreenDocument();
    if (hasExistingDocument && !forceRecreate) {
      offscreenReady = true;
      return;
    }
    offscreenReady = false;
    if (forceRecreate && hasExistingDocument) {
      await closeOffscreenDocument();
    }
    await createOffscreenDocument();
  })();
  try {
    await offscreenCreation;
    return true;
  } catch (error) {
    rejectOffscreenReadyWaiters(error);
    throw error;
  } finally {
    offscreenCreation = null;
  }
}

function queueOffscreenMessage(message) {
  return ensureOffscreenDocument().then(() => dispatchOffscreenMessage(message));
}

async function dispatchOffscreenMessage(message, retried = false) {
  try {
    return await chrome.runtime.sendMessage({ ...message, target: "offscreen" });
  } catch (error) {
    if (!retried && isMissingOffscreenReceiverError(error)) {
      console.warn("Offscreen receiver missing, recreating document");
      offscreenReady = false;
      await ensureOffscreenDocument({ forceRecreate: true });
      return dispatchOffscreenMessage(message, true);
    }
    console.error("Failed to talk to offscreen", error);
    throw error;
  }
}

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) {
    return false;
  }
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
  });
  return contexts.length > 0;
}

async function createOffscreenDocument() {
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ["AUDIO_PLAYBACK"],
      justification: "播放 B 站播放列表"
    });
  } catch (error) {
    if (isExistingOffscreenDocumentError(error)) {
      offscreenReady = true;
      return;
    }
    throw error;
  }
  await waitForOffscreenReady();
}

async function closeOffscreenDocument() {
  if (!chrome.offscreen?.closeDocument) {
    return;
  }
  try {
    await chrome.offscreen.closeDocument();
  } catch (error) {
    console.warn("Failed to close offscreen document", error);
  }
}

function waitForOffscreenReady(timeout = OFFSCREEN_READY_TIMEOUT) {
  if (offscreenReady) {
    return Promise.resolve(true);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      offscreenReadyWaiters = offscreenReadyWaiters.filter((entry) => entry.resolve !== resolve);
      reject(new Error("等待 offscreen 就绪超时"));
    }, timeout);
    offscreenReadyWaiters.push({ resolve, reject, timer });
  });
}

function rejectOffscreenReadyWaiters(error) {
  const waiters = [...offscreenReadyWaiters];
  offscreenReadyWaiters = [];
  for (const entry of waiters) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
}

function isMissingOffscreenReceiverError(error) {
  const message = error?.message || String(error || "");
  return message.includes("Could not establish connection") || message.includes("Receiving end does not exist");
}

function isExistingOffscreenDocumentError(error) {
  const message = error?.message || String(error || "");
  return message.includes("Only a single offscreen document may be created");
}

async function updatePlaybackRuntime(partial) {
  const state = cachedState || (await ensureState());
  state.playback = {
    ...state.playback,
    ...Object.fromEntries(
      Object.entries(partial).filter(([, value]) => typeof value !== "undefined")
    ),
    updatedAt: Date.now()
  };
  cachedState = state;
  await pushSnapshot();
}
