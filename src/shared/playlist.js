import { DEFAULT_CATEGORY_NAME } from "./messages.js";

export const STORAGE_KEY = "bilicast.state";
export const DEFAULT_CATEGORY_ID = "category-default";

export function createDefaultCategory() {
  return {
    id: DEFAULT_CATEGORY_ID,
    name: DEFAULT_CATEGORY_NAME,
    createdAt: Date.now(),
    videos: []
  };
}

export function createCategory(name = DEFAULT_CATEGORY_NAME) {
  const randomId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return {
    id: `cat-${randomId}`,
    name: name.trim() || DEFAULT_CATEGORY_NAME,
    createdAt: Date.now(),
    videos: []
  };
}

export function createDefaultState() {
  return {
    categories: {
      [DEFAULT_CATEGORY_ID]: createDefaultCategory()
    },
    categoryOrder: [DEFAULT_CATEGORY_ID],
    activeCategoryId: DEFAULT_CATEGORY_ID,
    playback: {
      categoryId: null,
      videoId: null,
      mode: "list",
      status: "paused",
      progress: 0,
      duration: 0,
      volume: 1,
      updatedAt: Date.now()
    }
  };
}

export function normalizeVideoUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("t", "0");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function makeVideoId({ bvid, page = 1 }) {
  const normalizedPage = Number(page) || 1;
  return `${bvid}-p${normalizedPage}`;
}

export function createVideoEntry(data) {
  const videoId = data.id || makeVideoId({ bvid: data.bvid, page: data.pageIndex });
  return {
    id: videoId,
    bvid: data.bvid,
    pageIndex: data.pageIndex || 1,
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
    url: normalizeVideoUrl(data.url),
    addedAt: Date.now()
  };
}
