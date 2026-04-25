import { DEFAULT_CATEGORY_NAME } from "./messages.js";
import {
  buildVideoUrl,
  isValidBvid,
  makeVideoId,
  normalizePageIndex,
  normalizeVideoUrl
} from "./video.js";

export const STORAGE_KEY = "bilicast.state";
export const DEFAULT_CATEGORY_ID = "category-default";
export const PORTABLE_PLAYLIST_SCHEMA = "bilicast.playlist";
export const PORTABLE_PLAYLIST_VERSION = 1;
export const STATE_VERSION = 1;

export { buildVideoUrl, makeVideoId, normalizeVideoUrl } from "./video.js";

export function createDefaultCategory() {
  return {
    id: DEFAULT_CATEGORY_ID,
    name: DEFAULT_CATEGORY_NAME,
    createdAt: Date.now(),
    videos: []
  };
}

export function createCategory(name = DEFAULT_CATEGORY_NAME) {
  const randomId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return {
    id: `cat-${randomId}`,
    name: name.trim() || DEFAULT_CATEGORY_NAME,
    createdAt: Date.now(),
    videos: []
  };
}

export function createDefaultState() {
  return {
    stateVersion: STATE_VERSION,
    categories: {
      [DEFAULT_CATEGORY_ID]: createDefaultCategory()
    },
    categoryOrder: [DEFAULT_CATEGORY_ID],
    activeCategoryId: DEFAULT_CATEGORY_ID,
    playback: {
      categoryId: null,
      videoId: null,
      mode: "list",
      audioQuality: "auto",
      status: "paused",
      progress: 0,
      duration: 0,
      lastResolvedAt: 0,
      volume: 1,
      updatedAt: Date.now()
    }
  };
}

export function createVideoEntry(data) {
  const videoId = data.id || makeVideoId({ bvid: data.bvid, page: data.pageIndex });
  const normalizedUrl = data.url || buildVideoUrl({ bvid: data.bvid, pageIndex: data.pageIndex });
  return {
    id: videoId,
    bvid: data.bvid,
    pageIndex: normalizePageIndex(data.pageIndex),
    title: data.title,
    author: data.author,
    cover: data.cover,
    duration: data.duration || 0,
    cid: data.cid || null,
    audioUrl: data.audioUrl || null,
    audioUrls: Array.isArray(data.audioUrls)
      ? data.audioUrls
      : data.audioUrl
        ? [data.audioUrl]
        : [],
    url: normalizeVideoUrl(normalizedUrl),
    addedAt: Date.now()
  };
}

export function exportPortablePlaylist(state) {
  const categories = (state?.categoryOrder || [])
    .map((id) => state?.categories?.[id])
    .filter(Boolean)
    .map((category) => ({
      name: category.name || DEFAULT_CATEGORY_NAME,
      videos: (category.videos || []).map((video) => ({
        bvid: String(video.bvid || "").trim(),
        page: normalizePageIndex(video.pageIndex),
        title: String(video.title || "").trim() || buildVideoTitleFallback(video.bvid, video.pageIndex)
      }))
    }));
  const activeCategoryIndex = Math.max(0, (state?.categoryOrder || []).indexOf(state?.activeCategoryId));
  return {
    schema: PORTABLE_PLAYLIST_SCHEMA,
    version: PORTABLE_PLAYLIST_VERSION,
    activeCategoryIndex,
    categories
  };
}

export function parsePortablePlaylist(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "导入文件格式无效" };
  }
  if (raw.schema !== PORTABLE_PLAYLIST_SCHEMA) {
    return { ok: false, message: "不支持的播放列表格式" };
  }
  if (raw.version !== PORTABLE_PLAYLIST_VERSION) {
    return { ok: false, message: "不支持的播放列表版本" };
  }
  if (!Array.isArray(raw.categories) || raw.categories.length === 0) {
    return { ok: false, message: "播放列表至少包含一个分类" };
  }

  const categories = raw.categories.map((category, categoryIndex) => {
    const name = String(category?.name || "").trim() || `${DEFAULT_CATEGORY_NAME} ${categoryIndex + 1}`;
    const inputVideos = Array.isArray(category?.videos) ? category.videos : [];
    const seenVideoIds = new Set();
    const videos = [];

    for (const video of inputVideos) {
      const bvid = String(video?.bvid || "").trim();
      if (!isValidBvid(bvid)) {
        return { ok: false, message: `分类「${name}」存在无效 BV 号` };
      }
      const page = normalizePageIndex(video?.page);
      const id = makeVideoId({ bvid, page });
      if (seenVideoIds.has(id)) {
        continue;
      }
      seenVideoIds.add(id);
      const title = String(video?.title || "").trim() || buildVideoTitleFallback(bvid, page);
      videos.push({ bvid, page, title });
    }

    return { ok: true, category: { name, videos } };
  });

  const invalidCategory = categories.find((entry) => entry?.ok === false);
  if (invalidCategory) {
    return invalidCategory;
  }

  const rawIndex = Number(raw.activeCategoryIndex);
  const activeCategoryIndex = Number.isInteger(rawIndex)
    ? Math.min(Math.max(rawIndex, 0), categories.length - 1)
    : 0;
  return {
    ok: true,
    data: {
      schema: PORTABLE_PLAYLIST_SCHEMA,
      version: PORTABLE_PLAYLIST_VERSION,
      activeCategoryIndex,
      categories: categories.map((entry) => entry.category)
    }
  };
}

function buildVideoTitleFallback(bvid, pageIndex) {
  return `${String(bvid || "").trim() || "BV"} P${normalizePageIndex(pageIndex)}`;
}
