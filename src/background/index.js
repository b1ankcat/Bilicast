import { MESSAGE } from "../shared/messages.js";
import {
  STORAGE_KEY,
  createDefaultState,
  createCategory,
  createVideoEntry,
  DEFAULT_CATEGORY_ID,
  exportPortablePlaylist,
  makeVideoId,
  parsePortablePlaylist
} from "../shared/playlist.js";
import { fail, isFailure, messageFromError, ok } from "../shared/result.js";
import { buildVideoReferer, sanitizeVideoUrlOrReferer } from "../shared/video.js";
import { fetchAudioStream, fetchVideoMeta } from "./bilibili-api.js";
import { computeNextTrack } from "./playback-service.js";
import { deleteVideosFromState, moveVideoBetweenCategories } from "./playlist-service.js";
import { createStateStore, deepClone } from "./state-store.js";

const OFFSCREEN_PATH = "src/background/offscreen.html";
const AUDIO_REFERER_RULES = [
  { id: 1, regexFilter: "^https?:\\/\\/([\\w-]+\\.)*bilivideo\\.com(:\\d+)?\\/.*" },
  { id: 2, regexFilter: "^https?:\\/\\/([\\w-]+\\.)*bilivideo\\.cn(:\\d+)?\\/.*" }
];
const PLAYBACK_REFERER_RULES = [
  { id: 1001, regexFilter: "^https?:\\/\\/([\\w-]+\\.)*bilivideo\\.com(:\\d+)?\\/.*" },
  { id: 1002, regexFilter: "^https?:\\/\\/([\\w-]+\\.)*bilivideo\\.cn(:\\d+)?\\/.*" }
];
const popupPorts = new Set();
const OFFSCREEN_READY_TIMEOUT = 5000;

let offscreenReady = false;
let offscreenCreation = null;
let offscreenReadyWaiters = [];
let lastRecoveryAttempt = {
  videoId: null,
  at: 0
};

const stateStore = createStateStore({
  storage: chrome.storage.local,
  storageKey: STORAGE_KEY,
  onStateChange: pushSnapshot
});

const messageRouter = {
  [MESSAGE.POPUP_INIT]: async () => formatSnapshot(await ensureState()),
  [MESSAGE.PLAYLIST_GET_CATEGORIES]: async () => listCategorySummary(),
  [MESSAGE.PLAYLIST_GET_VIDEO_MEMBERSHIPS]: async ({ payload }) => getVideoMembershipsFlow(payload),
  [MESSAGE.PLAYLIST_CREATE_CATEGORY]: async ({ payload }) => createCategoryFlow(payload?.name),
  [MESSAGE.PLAYLIST_RENAME_CATEGORY]: async ({ payload }) => renameCategoryFlow(payload?.categoryId, payload?.name),
  [MESSAGE.PLAYLIST_DELETE_CATEGORY]: async ({ payload }) => deleteCategoryFlow(payload?.categoryId),
  [MESSAGE.PLAYLIST_ADD_VIDEO]: async ({ payload }) => addVideoFlow(payload),
  [MESSAGE.PLAYLIST_DELETE_VIDEO]: async ({ payload }) => deleteVideoFlow(payload),
  [MESSAGE.PLAYLIST_DELETE_VIDEOS]: async ({ payload }) => deleteVideosFlow(payload),
  [MESSAGE.PLAYLIST_REORDER_VIDEOS]: async ({ payload }) => reorderVideosFlow(payload),
  [MESSAGE.PLAYLIST_REORDER_CATEGORIES]: async ({ payload }) => reorderCategoriesFlow(payload?.categoryOrder),
  [MESSAGE.PLAYLIST_MOVE_VIDEO]: async ({ payload }) => moveVideoFlow(payload),
  [MESSAGE.PLAYLIST_EXPORT]: async () => exportPlaylistFlow(),
  [MESSAGE.PLAYLIST_IMPORT]: async ({ payload }) => importPlaylistFlow(payload?.data),
  [MESSAGE.POPUP_SELECT_CATEGORY]: async ({ payload }) => selectCategoryFlow(payload?.categoryId),
  [MESSAGE.POPUP_PLAY_VIDEO]: async ({ payload }) => playVideoFlow(payload),
  [MESSAGE.POPUP_CONTROL]: async ({ payload }) => controlPlaybackFlow(payload?.action, payload?.manual),
  [MESSAGE.POPUP_SEEK]: async ({ payload }) => seekFlow(payload?.seconds),
  [MESSAGE.POPUP_SET_MODE]: async ({ payload }) => setModeFlow(payload?.mode),
  [MESSAGE.POPUP_SET_VOLUME]: async ({ payload }) => setVolumeFlow(payload?.volume),
  [MESSAGE.POPUP_SET_AUDIO_QUALITY]: async ({ payload }) => setAudioQualityFlow(payload?.audioQuality)
};

chrome.runtime.onInstalled.addListener(async () => {
  await initializeState();
  await ensureRequestRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeState();
  await ensureRequestRules();
});

if (chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    stateStore.flushPendingPersist().catch(() => {});
  });
}

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

  if (message.type === MESSAGE.OFFSCREEN_SOURCE_FAILED) {
    handleOffscreenSourceFailed(message.payload)
      .then(() => sendResponse?.({ ok: true }))
      .catch((error) => {
        sendResponse?.(fail(messageFromError(error, "音频恢复失败")));
      });
    return true;
  }

  const handler = messageRouter[message.type];
  if (!handler) {
    return;
  }

  handler(message, sender)
    .then((result) => sendResponse?.(result ?? ok()))
    .catch((error) => {
      sendResponse?.(fail(messageFromError(error, "操作失败")));
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
    const addRules = AUDIO_REFERER_RULES.map(({ id, regexFilter }) => ({
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
            value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
          }
        ]
      }
    }));
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: AUDIO_REFERER_RULES.map((rule) => rule.id),
      addRules
    });
  } catch {}
}

async function updatePlaybackRefererRules(refererValue) {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) {
    return;
  }
  const removeRuleIds = PLAYBACK_REFERER_RULES.map((rule) => rule.id);
  const addRules = refererValue
    ? PLAYBACK_REFERER_RULES.map(({ id, regexFilter }) => ({
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
            value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
          }
        ]
      }
    }))
    : [];
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });
  } catch {}
}

async function ensureState() {
  return stateStore.ensureState();
}

async function setState(nextState) {
  return stateStore.setState(nextState);
}

async function mutateState(mutator) {
  return stateStore.mutateState(mutator);
}

async function updatePlaybackRuntime(partial, options = {}) {
  return stateStore.updatePlaybackRuntime(partial, options);
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

async function pushSnapshot() {
  if (!popupPorts.size) {
    return;
  }
  const state = stateStore.getCachedState() || (await ensureState());
  const snapshot = formatSnapshot(state);
  for (const port of popupPorts) {
    try {
      port.postMessage({ type: MESSAGE.STORAGE_PUSH, payload: snapshot });
    } catch {}
  }
}

function pushPopupFeedback(message, isError = true) {
  if (!popupPorts.size || !message) {
    return;
  }
  for (const port of popupPorts) {
    try {
      port.postMessage({
        type: MESSAGE.POPUP_FEEDBACK,
        payload: { message, isError }
      });
    } catch {}
  }
}

async function sendSnapshotToPort(port) {
  const snapshot = formatSnapshot(await ensureState());
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
  return ok({ categories, activeCategoryId: state.activeCategoryId });
}

function resolveRequestedVideoId(payload = {}) {
  const directVideoId = typeof payload?.videoId === "string" ? payload.videoId.trim() : "";
  if (directVideoId) {
    return directVideoId;
  }
  const bvid = typeof payload?.bvid === "string" ? payload.bvid.trim() : "";
  if (!bvid) {
    return null;
  }
  return makeVideoId({
    bvid,
    page: payload?.pageIndex ?? payload?.page ?? 1
  });
}

async function getVideoMembershipsFlow(payload) {
  const videoId = resolveRequestedVideoId(payload);
  if (!videoId) {
    return fail("缺少视频标识");
  }
  const state = await ensureState();
  const categories = state.categoryOrder
    .map((id) => state.categories[id])
    .filter((category) => category?.videos?.some((video) => video.id === videoId))
    .map((category) => ({
      id: category.id,
      name: category.name
    }));
  return ok({ categories });
}

async function createCategoryFlow(name) {
  const category = createCategory((name || "").trim());
  await mutateState((draft) => {
    draft.categories[category.id] = category;
    draft.categoryOrder.push(category.id);
    draft.activeCategoryId = category.id;
  });
  return ok({ category });
}

async function renameCategoryFlow(categoryId, name) {
  if (!categoryId) {
    return fail("缺少分类标识");
  }
  if (categoryId === DEFAULT_CATEGORY_ID) {
    return fail("默认分类无法重命名");
  }
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    return fail("分类名称不能为空");
  }

  const draft = deepClone(await ensureState());
  const category = draft.categories[categoryId];
  if (!category) {
    return fail("分类不存在");
  }
  category.name = trimmed;
  await setState(draft);
  return ok({ category: { id: category.id, name: category.name } });
}

async function deleteCategoryFlow(categoryId) {
  if (!categoryId) {
    return fail("categoryId is required");
  }
  if (categoryId === DEFAULT_CATEGORY_ID) {
    return fail("默认分类无法删除");
  }

  const draft = deepClone(await ensureState());
  if (!draft.categories[categoryId]) {
    return fail("分类不存在");
  }

  const remaining = draft.categoryOrder.filter((id) => id !== categoryId);
  if (!remaining.length) {
    return fail("至少保留一个分类");
  }

  let shouldStopPlayback = false;
  delete draft.categories[categoryId];
  draft.categoryOrder = remaining;
  if (draft.activeCategoryId === categoryId) {
    draft.activeCategoryId = remaining[0];
  }
  if (draft.playback.categoryId === categoryId) {
    draft.playback.categoryId = null;
    draft.playback.videoId = null;
    draft.playback.status = "paused";
    draft.playback.progress = 0;
    draft.playback.duration = 0;
    shouldStopPlayback = true;
  }

  await setState(draft);
  if (shouldStopPlayback) {
    await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "stop" } }).catch(() => {});
  }
  return ok();
}

async function addVideoFlow(payload) {
  if (!payload?.video) {
    return fail("缺少视频数据");
  }

  const targetCategoryId = payload.categoryId;
  const videoEntry = createVideoEntry(payload.video);
  const enrichedVideo = await ensureVideoMeta(videoEntry);
  const draft = deepClone(await ensureState());
  const category = draft.categories[targetCategoryId] || draft.categories[draft.activeCategoryId] || draft.categories[DEFAULT_CATEGORY_ID];
  if (!category) {
    return fail("未找到分类");
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

  await setState(draft);
  return ok({ video: enrichedVideo });
}

async function deleteVideoFlow(payload) {
  const result = await deleteVideosFlow({
    categoryId: payload?.categoryId,
    videoIds: [payload?.videoId]
  });
  if (!result.ok) {
    return result;
  }
  return ok();
}

async function deleteVideosFlow(payload) {
  const draft = deepClone(await ensureState());
  const result = deleteVideosFromState(draft, payload);
  if (!result.ok) {
    return fail(result.message);
  }

  await setState(draft);
  if (result.shouldStopPlayback) {
    await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "stop" } }).catch(() => {});
  }

  return ok({ deletedCount: result.deletedCount });
}

async function reorderVideosFlow(payload) {
  const categoryId = payload?.categoryId;
  const videoIds = Array.isArray(payload?.videoIds) ? payload.videoIds : null;
  if (!categoryId || !videoIds?.length) {
    return fail("排序数据无效");
  }

  const draft = deepClone(await ensureState());
  const category = draft.categories[categoryId];
  if (!category) {
    return fail("分类不存在");
  }
  if (category.videos.length !== videoIds.length) {
    return fail("排序数据不完整");
  }

  const videosById = new Map(category.videos.map((video) => [video.id, video]));
  if (videosById.size !== videoIds.length || videoIds.some((videoId) => !videosById.has(videoId))) {
    return fail("排序目标不存在");
  }

  category.videos = videoIds.map((videoId) => videosById.get(videoId));
  await setState(draft);
  return ok();
}

async function reorderCategoriesFlow(categoryOrder) {
  if (!Array.isArray(categoryOrder) || !categoryOrder.length) {
    return fail("排序数据无效");
  }

  const draft = deepClone(await ensureState());
  const currentIds = draft.categoryOrder.filter((id) => draft.categories[id]);
  if (categoryOrder.length !== currentIds.length) {
    return fail("排序数据不完整");
  }

  const uniqueIds = new Set(categoryOrder);
  if (uniqueIds.size !== categoryOrder.length) {
    return fail("排序数据重复");
  }
  if (categoryOrder.some((id) => !draft.categories[id])) {
    return fail("排序目标不存在");
  }
  if (currentIds.some((id) => !uniqueIds.has(id))) {
    return fail("排序数据不完整");
  }

  draft.categoryOrder = [...categoryOrder];
  if (!draft.categories[draft.activeCategoryId]) {
    draft.activeCategoryId = draft.categoryOrder[0] || DEFAULT_CATEGORY_ID;
  }
  await setState(draft);
  return ok({ categoryOrder: draft.categoryOrder });
}

async function exportPlaylistFlow() {
  const state = await ensureState();
  return ok({ data: exportPortablePlaylist(state) });
}

async function importPlaylistFlow(rawData) {
  const parsedResult = parsePortablePlaylist(rawData);
  if (!parsedResult?.ok) {
    return fail(parsedResult?.message || "导入失败");
  }

  const parsed = parsedResult.data;
  const currentState = await ensureState();
  const nextState = createDefaultState();
  nextState.categories = {};
  nextState.categoryOrder = [];

  parsed.categories.forEach((inputCategory) => {
    const category = createCategory(inputCategory.name);
    const uniqueVideos = [];
    const seen = new Set();
    inputCategory.videos.forEach((video) => {
      const entry = createVideoEntry({
        bvid: video.bvid,
        pageIndex: video.page,
        title: video.title
      });
      if (seen.has(entry.id)) {
        return;
      }
      seen.add(entry.id);
      uniqueVideos.push(entry);
    });
    category.videos = uniqueVideos;
    nextState.categories[category.id] = category;
    nextState.categoryOrder.push(category.id);
  });

  if (!nextState.categoryOrder.length) {
    return fail("导入失败：没有可用分类");
  }

  nextState.activeCategoryId = nextState.categoryOrder[parsed.activeCategoryIndex] || nextState.categoryOrder[0];
  nextState.playback = {
    ...nextState.playback,
    mode: currentState.playback?.mode || nextState.playback.mode,
    volume: typeof currentState.playback?.volume === "number" ? currentState.playback.volume : nextState.playback.volume,
    updatedAt: Date.now()
  };

  await setState(nextState);
  await updatePlaybackRefererRules(null);
  await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "stop" } }).catch(() => {});

  const videoCount = parsed.categories.reduce((total, category) => total + category.videos.length, 0);
  return ok({
    categoryCount: parsed.categories.length,
    videoCount
  });
}

async function moveVideoFlow(payload) {
  const draft = deepClone(await ensureState());
  const result = moveVideoBetweenCategories(draft, {
    fromCategoryId: payload?.fromCategoryId,
    toCategoryId: payload?.toCategoryId,
    videoId: resolveRequestedVideoId(payload)
  });
  if (!result.ok) {
    return fail(result.message);
  }
  await setState(draft);
  return ok({ video: result.video });
}

async function ensureVideoMeta(video) {
  if (video.duration && video.duration > 0 && video.cid) {
    return video;
  }
  const metaResult = await fetchVideoMeta(video.bvid);
  if (isFailure(metaResult)) {
    return video;
  }
  return {
    ...video,
    duration: metaResult.meta.duration || video.duration,
    cid: metaResult.meta.cid || video.cid
  };
}

async function ensureAudioStream(categoryId, videoId, options = {}) {
  const state = await ensureState();
  const category = state.categories[categoryId];
  if (!category) {
    return fail("分类不存在");
  }

  const video = category.videos.find((item) => item.id === videoId);
  if (!video) {
    return fail("未找到视频");
  }

  const qualityPreference = options.qualityPreference || state.playback.audioQuality || "auto";
  const forceRefresh = Boolean(options.forceRefresh);
  if (!forceRefresh && video.audioUrl && video.cid && video.audioQuality === qualityPreference) {
    return ok({ video });
  }

  const metaResult = video.cid && !forceRefresh
    ? ok({ meta: { cid: video.cid, duration: video.duration } })
    : await fetchVideoMeta(video.bvid);
  if (isFailure(metaResult)) {
    return metaResult;
  }

  const cid = metaResult.meta.cid || video.cid;
  const streamResult = await fetchAudioStream(video.bvid, cid, qualityPreference);
  if (isFailure(streamResult)) {
    return streamResult;
  }

  const stream = streamResult.stream;
  const duration = stream.duration || metaResult.meta.duration || video.duration;
  await mutateState((draft) => {
    const targetCategory = draft.categories[categoryId];
    if (!targetCategory) {
      return;
    }
    const index = targetCategory.videos.findIndex((item) => item.id === videoId);
    if (index === -1) {
      return;
    }
    targetCategory.videos[index] = {
      ...targetCategory.videos[index],
      cid,
      audioUrl: stream.audioUrl,
      audioUrls: Array.isArray(stream.audioUrls) && stream.audioUrls.length
        ? stream.audioUrls
        : targetCategory.videos[index].audioUrls || (stream.audioUrl ? [stream.audioUrl] : []),
      audioQuality: qualityPreference,
      duration: duration || targetCategory.videos[index].duration,
      audioFetchedAt: Date.now()
    };
  });

  const refreshed = await ensureState();
  const refreshedVideo = refreshed.categories[categoryId]?.videos.find((item) => item.id === videoId);
  if (!refreshedVideo) {
    return fail("未找到视频");
  }
  return ok({ video: refreshedVideo });
}

async function selectCategoryFlow(categoryId) {
  if (!categoryId) {
    return fail("categoryId 不能为空");
  }
  const draft = deepClone(await ensureState());
  if (!draft.categories[categoryId]) {
    return fail("分类不存在");
  }
  draft.activeCategoryId = categoryId;
  await setState(draft);
  return ok();
}

async function playVideoFlow(payload) {
  const state = await ensureState();
  const categoryId = payload?.categoryId || state.activeCategoryId;
  const videoId = payload?.videoId || state.categories[categoryId]?.videos[0]?.id;
  if (!categoryId || !videoId) {
    return fail("没有可播放的视频");
  }
  return playVideoById(categoryId, videoId, payload?.startAt || 0);
}

async function controlPlaybackFlow(action = "play", manual = false) {
  const state = await ensureState();
  if (action === "play") {
    if (state.playback.videoId) {
      return resumePlayback(state);
    }
    const category = state.categories[state.activeCategoryId];
    const firstVideo = category?.videos[0];
    if (firstVideo) {
      return playVideoById(state.activeCategoryId, firstVideo.id, 0);
    }
    return fail("当前分类没有视频");
  }

  if (action === "pause") {
    await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "pause" } });
    await updatePlaybackRuntime({ status: "paused" }, { immediate: true });
    return ok();
  }

  if (action === "next" || action === "previous") {
    const direction = action === "next" ? 1 : -1;
    const nextTarget = computeNextTrack(await ensureState(), direction, { manual });
    if (!nextTarget) {
      return fail("没有更多视频");
    }
    return playVideoById(nextTarget.categoryId, nextTarget.videoId, 0);
  }

  return fail(`未知操作 ${action}`);
}

async function setModeFlow(mode) {
  const allowedModes = new Set(["single", "list", "all", "shuffle"]);
  if (!allowedModes.has(mode)) {
    return fail("不支持的播放模式");
  }
  await mutateState((draft) => {
    draft.playback.mode = mode;
  });
  return ok();
}

async function seekFlow(seconds) {
  if (typeof seconds !== "number" || Number.isNaN(seconds)) {
    return fail("拖动时间无效");
  }
  await ensureOffscreenDocument();
  await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "seek", seconds } });
  await updatePlaybackRuntime({ progress: seconds }, { immediate: true });
  return ok();
}

async function setVolumeFlow(volume) {
  const value = typeof volume === "number" ? Math.min(1, Math.max(0, volume)) : null;
  if (value === null) {
    return fail("音量设置无效");
  }
  await mutateState((draft) => {
    draft.playback.volume = value;
  });
  await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "volume", value } });
  return ok();
}

async function setAudioQualityFlow(audioQuality) {
  const allowed = new Set(["auto", "high", "standard", "low"]);
  if (!allowed.has(audioQuality)) {
    return fail("音质设置无效");
  }
  await mutateState((draft) => {
    draft.playback.audioQuality = audioQuality;
  });

  const state = await ensureState();
  if (state.playback.status !== "playing" || !state.playback.categoryId || !state.playback.videoId) {
    return ok();
  }

  return playVideoByIdInternal(state.playback.categoryId, state.playback.videoId, state.playback.progress || 0, {
    forceRefresh: true,
    allowStreamRefreshRetry: true
  });
}

async function playVideoById(categoryId, videoId, startAt = 0) {
  return playVideoByIdInternal(categoryId, videoId, startAt, {
    forceRefresh: false,
    allowStreamRefreshRetry: true
  });
}

async function playVideoByIdInternal(categoryId, videoId, startAt = 0, options = {}) {
  const state = await ensureState();
  const category = state.categories[categoryId];
  if (!category) {
    return fail("分类不存在");
  }

  const video = category.videos.find((item) => item.id === videoId);
  if (!video) {
    return fail("未找到视频");
  }

  const streamResult = await ensureAudioStream(categoryId, video.id, { forceRefresh: Boolean(options.forceRefresh) });
  if (isFailure(streamResult)) {
    return streamResult;
  }

  const resolvedVideo = streamResult.video;
  if (!resolvedVideo?.audioUrl) {
    return fail("无法解析音频地址");
  }

  await ensureOffscreenDocument();
  const referer = buildVideoReferer(resolvedVideo) || sanitizeVideoUrlOrReferer(resolvedVideo.url);
  await updatePlaybackRefererRules(referer);

  const candidateUrls = Array.isArray(resolvedVideo.audioUrls) && resolvedVideo.audioUrls.length
    ? resolvedVideo.audioUrls
    : resolvedVideo.audioUrl
      ? [resolvedVideo.audioUrl]
      : [];
  if (!candidateUrls.length) {
    return fail("缺少音频地址");
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
  }).catch((error) => fail(messageFromError(error, "音频加载失败")));

  if (!response?.ok) {
    if (options.allowStreamRefreshRetry !== false && !options.forceRefresh) {
      return playVideoByIdInternal(categoryId, videoId, startAt, {
        forceRefresh: true,
        allowStreamRefreshRetry: false
      });
    }
    return fail(response?.message || "音频加载失败");
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
      lastResolvedAt: Date.now(),
      updatedAt: Date.now()
    };
  });
  return ok();
}

async function resumePlayback(state) {
  const categoryId = state.playback.categoryId || state.activeCategoryId;
  const videoId = state.playback.videoId;
  if (!categoryId || !videoId) {
    return fail("没有可恢复的视频");
  }

  await ensureOffscreenDocument();
  const response = await queueOffscreenMessage({ type: MESSAGE.OFFSCREEN_CONTROL, payload: { action: "play" } }).catch((error) =>
    fail(messageFromError(error, "恢复播放失败"))
  );
  if (response?.ok) {
    await updatePlaybackRuntime({ status: "playing" }, { immediate: true });
    return ok();
  }

  return playVideoByIdInternal(categoryId, videoId, state.playback.progress || 0, {
    forceRefresh: true,
    allowStreamRefreshRetry: false
  });
}

function handleOffscreenReady() {
  offscreenReady = true;
  const waiters = [...offscreenReadyWaiters];
  offscreenReadyWaiters = [];
  waiters.forEach((entry) => {
    clearTimeout(entry.timer);
    entry.resolve(true);
  });
}

function handleOffscreenState(payload = {}) {
  if (payload?.error) {
    pushPopupFeedback(payload.error, true);
  }
  updatePlaybackRuntime(
    {
      progress: typeof payload.currentTime === "number" ? payload.currentTime : undefined,
      duration: typeof payload.duration === "number" ? payload.duration : undefined,
      status: payload.paused ? "paused" : "playing"
    },
    { immediate: false }
  ).catch(() => {});
}

function handleOffscreenEnded() {
  updatePlaybackRuntime({ status: "paused", progress: 0 }, { immediate: true }).catch(() => {});
  controlPlaybackFlow("next")
    .then((result) => {
      if (isFailure(result) && result.message && result.message !== "没有更多视频") {
        pushPopupFeedback(result.message, true);
      }
    })
    .catch(() => {});
}

async function handleOffscreenSourceFailed(payload = {}) {
  const state = await ensureState();
  const categoryId = state.playback.categoryId;
  const videoId = state.playback.videoId;
  if (!categoryId || !videoId) {
    if (payload?.error) {
      pushPopupFeedback(payload.error, true);
    }
    return;
  }

  const now = Date.now();
  if (lastRecoveryAttempt.videoId === videoId && now - lastRecoveryAttempt.at < 30000) {
    pushPopupFeedback(payload?.error || "音频恢复失败", true);
    return;
  }

  lastRecoveryAttempt = { videoId, at: now };
  const resumeAt = Math.max(0, Number(payload?.currentTime) || state.playback.progress || 0);
  const result = await playVideoByIdInternal(categoryId, videoId, resumeAt, {
    forceRefresh: true,
    allowStreamRefreshRetry: false
  });
  if (isFailure(result)) {
    await updatePlaybackRuntime({ status: "paused" }, { immediate: true });
    pushPopupFeedback(result.message || payload?.error || "音频恢复失败", true);
    return;
  }

  pushPopupFeedback("音频已自动恢复", false);
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
    return Promise.reject(messageFromError(error, "offscreen 初始化失败"));
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
      offscreenReady = false;
      await ensureOffscreenDocument({ forceRecreate: true });
      return dispatchOffscreenMessage(message, true);
    }
    return Promise.reject(messageFromError(error, "与播放组件通信失败"));
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
    return Promise.reject(messageFromError(error, "创建 offscreen 失败"));
  }
  await waitForOffscreenReady();
}

async function closeOffscreenDocument() {
  if (!chrome.offscreen?.closeDocument) {
    return;
  }
  try {
    await chrome.offscreen.closeDocument();
  } catch {}
}

function waitForOffscreenReady(timeout = OFFSCREEN_READY_TIMEOUT) {
  if (offscreenReady) {
    return Promise.resolve(true);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      offscreenReadyWaiters = offscreenReadyWaiters.filter((entry) => entry.resolve !== resolve);
      reject("等待 offscreen 就绪超时");
    }, timeout);
    offscreenReadyWaiters.push({ resolve, reject, timer });
  });
}

function rejectOffscreenReadyWaiters(error) {
  const waiters = [...offscreenReadyWaiters];
  offscreenReadyWaiters = [];
  waiters.forEach((entry) => {
    clearTimeout(entry.timer);
    entry.reject(error);
  });
}

function isMissingOffscreenReceiverError(error) {
  const message = error?.message || String(error || "");
  return message.includes("Could not establish connection") || message.includes("Receiving end does not exist");
}

function isExistingOffscreenDocumentError(error) {
  const message = error?.message || String(error || "");
  return message.includes("Only a single offscreen document may be created");
}
