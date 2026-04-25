export const state = {
  categories: [],
  categoryOrder: [],
  activeCategoryId: null,
  playback: {
    mode: "list",
    audioQuality: "auto",
    status: "paused",
    progress: 0,
    duration: 0,
    videoId: null,
    volume: 1
  }
};

export const bulkSelection = {
  enabled: false,
  categoryId: null,
  ids: new Set()
};

export const dragState = {
  videoId: null,
  overVideoId: null,
  position: null,
  suppressClickUntil: 0
};

export const categoryManagerState = {
  dragCategoryId: null,
  overCategoryId: null,
  position: null
};

export const moveVideoState = {
  videoId: null,
  fromCategoryId: null,
  title: ""
};

export const actionMenuState = {
  videoId: null,
  categoryId: null,
  x: 0,
  y: 0
};

export function applySnapshot(snapshot) {
  if (!snapshot) {
    return;
  }
  state.categories = Array.isArray(snapshot.categories) ? snapshot.categories : [];
  state.categoryOrder = Array.isArray(snapshot.categoryOrder)
    ? snapshot.categoryOrder
    : state.categories.map((category) => category.id);
  state.activeCategoryId = snapshot.activeCategoryId || state.categories[0]?.id || null;
  state.playback = { ...state.playback, ...(snapshot.playback || {}) };
}

export function ensureActiveCategory() {
  if (getCategoryById(state.activeCategoryId)) {
    return state.activeCategoryId;
  }
  state.activeCategoryId = state.categories[0]?.id || null;
  return state.activeCategoryId;
}

export function getCategoryById(categoryId) {
  return state.categories.find((category) => category.id === categoryId) || null;
}

export function getVideoById(categoryId, videoId) {
  return getCategoryById(categoryId)?.videos?.find((video) => video.id === videoId) || null;
}

export function getActiveCategory() {
  return getCategoryById(state.activeCategoryId);
}

export function isCurrentPlaybackVideo(videoId) {
  return state.playback.videoId === videoId;
}

export function getVideoPrimaryActionState(videoId) {
  if (!isCurrentPlaybackVideo(videoId)) {
    return { icon: "\u25B6", title: "从头播放" };
  }
  if (state.playback.status === "playing") {
    return { icon: "\u23F8", title: "暂停" };
  }
  return { icon: "\u25B6", title: "继续播放" };
}

export function setBulkSelectionEnabled(enabled) {
  bulkSelection.enabled = Boolean(enabled);
  if (!bulkSelection.enabled) {
    bulkSelection.categoryId = null;
    bulkSelection.ids.clear();
  }
}

export function syncBulkSelectionWithActiveCategory() {
  if (!bulkSelection.enabled) {
    return;
  }
  if (bulkSelection.categoryId !== state.activeCategoryId) {
    bulkSelection.categoryId = state.activeCategoryId;
    bulkSelection.ids.clear();
  }
}

export function clearBulkSelection(categoryId = bulkSelection.categoryId) {
  bulkSelection.categoryId = categoryId;
  bulkSelection.ids.clear();
}

export function setSelectedVideo(videoId, checked) {
  if (checked) {
    bulkSelection.ids.add(videoId);
  } else {
    bulkSelection.ids.delete(videoId);
  }
}

export function resetVideoDragState() {
  dragState.videoId = null;
  dragState.overVideoId = null;
  dragState.position = null;
  dragState.suppressClickUntil = Date.now() + 250;
}

export function startVideoDrag(videoId) {
  dragState.videoId = videoId;
  dragState.overVideoId = null;
  dragState.position = null;
  dragState.suppressClickUntil = Date.now() + 400;
}

export function updateVideoDragTarget(videoId, position) {
  dragState.overVideoId = videoId;
  dragState.position = position;
}

export function resetCategoryManagerDragState() {
  categoryManagerState.dragCategoryId = null;
  categoryManagerState.overCategoryId = null;
  categoryManagerState.position = null;
}

export function startCategoryManagerDrag(categoryId) {
  categoryManagerState.dragCategoryId = categoryId;
  categoryManagerState.overCategoryId = null;
  categoryManagerState.position = null;
}

export function updateCategoryManagerDragTarget(categoryId, position) {
  categoryManagerState.overCategoryId = categoryId;
  categoryManagerState.position = position;
}

export function setMoveVideoTarget({ fromCategoryId, videoId, title }) {
  moveVideoState.fromCategoryId = fromCategoryId;
  moveVideoState.videoId = videoId;
  moveVideoState.title = title;
}

export function resetMoveVideoState() {
  moveVideoState.fromCategoryId = null;
  moveVideoState.videoId = null;
  moveVideoState.title = "";
}

export function setActionMenuTarget({ categoryId, videoId, x, y }) {
  actionMenuState.categoryId = categoryId;
  actionMenuState.videoId = videoId;
  actionMenuState.x = x;
  actionMenuState.y = y;
}

export function resetActionMenuState() {
  actionMenuState.categoryId = null;
  actionMenuState.videoId = null;
  actionMenuState.x = 0;
  actionMenuState.y = 0;
}
