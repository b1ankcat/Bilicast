import { MESSAGE, PLAYBACK_MODES } from "../shared/messages.js";
import { DEFAULT_CATEGORY_ID } from "../shared/playlist.js";

const MODE_ICONS = {
  single: "\uD83D\uDD02",
  list: "\uD83D\uDD01",
  all: "\uD83D\uDD04",
  shuffle: "\uD83D\uDD00"
};

const state = {
  categories: [],
  categoryOrder: [],
  activeCategoryId: null,
  playback: {
    mode: "list",
    status: "paused",
    progress: 0,
    duration: 0,
    videoId: null,
    volume: 1
  }
};

const progressEl = document.getElementById("progress");
const currentTimeEl = document.getElementById("currentTime");
const durationTimeEl = document.getElementById("durationTime");
const playBtn = document.getElementById("playBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const modeBtn = document.getElementById("modeBtn");
const addCurrentBtn = document.getElementById("addCurrentBtn");
const categorySelect = document.getElementById("categorySelect");
const newCategoryInput = document.getElementById("newCategoryInput");
const addCategoryBtn = document.getElementById("addCategoryBtn");
const deleteCategoryBtn = document.getElementById("deleteCategoryBtn");
const categoryPopover = document.getElementById("categoryCreatePopover");
const confirmCategoryBtn = document.getElementById("confirmCategoryBtn");
const cancelCategoryBtn = document.getElementById("cancelCategoryBtn");
const deleteConfirmDialog = document.getElementById("deleteConfirmDialog");
const deleteConfirmText = document.getElementById("deleteConfirmText");
const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
const volumeSlider = document.getElementById("volumeSlider");
const bulkToggle = document.getElementById("bulkSelectToggle");
const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
const importBtn = document.getElementById("importBtn");
const exportBtn = document.getElementById("exportBtn");
const importFileInput = document.getElementById("importFileInput");
const videoListEl = document.getElementById("videoList");
const feedbackEl = document.getElementById("categoryFeedback");

let seeking = false;
let pendingConfirmAction = null;
let feedbackTimer = null;
const bulkSelection = {
  enabled: false,
  categoryId: null,
  ids: new Set()
};
const dragState = {
  videoId: null,
  overVideoId: null,
  position: null,
  suppressClickUntil: 0
};

setTooltip(prevBtn, "上一条");
setTooltip(nextBtn, "下一条");
setTooltip(addCurrentBtn, "添加当前页视频");
setTooltip(deleteCategoryBtn, "删除分类");
setTooltip(addCategoryBtn, "新建分类");
setTooltip(playBtn, "播放");

const port = chrome.runtime.connect({ name: "popup" });
port.onMessage.addListener((message) => {
  if (message?.type === MESSAGE.STORAGE_PUSH) {
    refreshState(message.payload);
    return;
  }
  if (message?.type === MESSAGE.POPUP_FEEDBACK) {
    setFeedback(message.payload?.message, message.payload?.isError !== false);
  }
});

initializePopup();

progressEl.addEventListener("input", () => {
  seeking = true;
  updateProgressLabel(Number(progressEl.value), state.playback.duration || 0);
});
["change", "mouseup", "touchend"].forEach((eventName) => {
  progressEl.addEventListener(eventName, () => {
    if (!seeking) {
      return;
    }
    seeking = false;
    const seconds = Number(progressEl.value);
    sendRuntimeCommand(
      {
        type: MESSAGE.POPUP_SEEK,
        payload: { seconds }
      },
      "拖动时间无效"
    ).then(handleResultMessage);
  });
});

playBtn.addEventListener("click", () => {
  const action = state.playback.status === "playing" ? "pause" : "play";
  sendRuntimeCommand({ type: MESSAGE.POPUP_CONTROL, payload: { action } }, "播放失败").then(handleResultMessage);
});

prevBtn.addEventListener("click", () => {
  sendRuntimeCommand(
    { type: MESSAGE.POPUP_CONTROL, payload: { action: "previous", manual: true } },
    "没有上一条"
  ).then(handleResultMessage);
});

nextBtn.addEventListener("click", () => {
  sendRuntimeCommand(
    { type: MESSAGE.POPUP_CONTROL, payload: { action: "next", manual: true } },
    "没有下一条"
  ).then(handleResultMessage);
});

modeBtn.addEventListener("click", () => {
  const ids = PLAYBACK_MODES.map((mode) => mode.id);
  const currentIndex = ids.indexOf(state.playback.mode);
  const nextMode = ids[(currentIndex + 1) % ids.length];
  sendRuntimeCommand({ type: MESSAGE.POPUP_SET_MODE, payload: { mode: nextMode } }, "切换模式失败").then(
    handleResultMessage
  );
});

addCurrentBtn.addEventListener("click", () => {
  addCurrentVideoToList();
});

volumeSlider?.addEventListener("input", () => {
  const value = Number(volumeSlider.value) / 100;
  sendRuntimeCommand({ type: MESSAGE.POPUP_SET_VOLUME, payload: { volume: value } }, "音量调整失败").then(
    handleResultMessage
  );
});

bulkToggle?.addEventListener("change", () => {
  bulkSelection.enabled = Boolean(bulkToggle.checked);
  bulkSelection.ids.clear();
  bulkSelection.categoryId = bulkSelection.enabled ? state.activeCategoryId : null;
  updateBulkUI();
  renderVideoList();
});

bulkDeleteBtn?.addEventListener("click", () => {
  if (!bulkSelection.enabled || !bulkSelection.ids.size) {
    setFeedback("请选择需要删除的视频", true);
    return;
  }
  const categoryId = state.activeCategoryId;
  if (!categoryId) {
    setFeedback("请选择分类", true);
    return;
  }
  const count = bulkSelection.ids.size;
  openConfirmDialog(`确认删除选中的 ${count} 个视频吗？`, () => {
    performBulkDelete(categoryId, Array.from(bulkSelection.ids));
  });
});

importBtn?.addEventListener("click", () => {
  if (!importFileInput) {
    return;
  }
  importFileInput.value = "";
  importFileInput.click();
});

exportBtn?.addEventListener("click", () => {
  exportPlaylistFile();
});

importFileInput?.addEventListener("change", () => {
  const file = importFileInput.files?.[0];
  if (!file) {
    return;
  }
  prepareImportPlaylist(file);
});

updateBulkUI();

categorySelect.addEventListener("change", () => {
  const categoryId = categorySelect.value;
  deleteCategoryBtn.disabled = !categoryId || categoryId === DEFAULT_CATEGORY_ID;
  if (!categoryId) {
    bulkSelection.enabled = false;
    bulkSelection.ids.clear();
    bulkSelection.categoryId = null;
    updateBulkUI();
  } else {
    bulkSelection.categoryId = categoryId;
    bulkSelection.ids.clear();
    updateBulkUI();
  }
  sendRuntimeCommand({ type: MESSAGE.POPUP_SELECT_CATEGORY, payload: { categoryId } }, "切换失败").then(
    handleResultMessage
  );
});

addCategoryBtn.addEventListener("click", () => {
  toggleCategoryPopover();
});

confirmCategoryBtn?.addEventListener("click", () => submitNewCategory());
cancelCategoryBtn?.addEventListener("click", () => closeCategoryPopover());
categoryPopover?.addEventListener("click", (event) => {
  if (event.target === categoryPopover) {
    closeCategoryPopover(false);
  }
});
deleteConfirmDialog?.addEventListener("click", (event) => {
  if (event.target === deleteConfirmDialog) {
    closeConfirmDialog();
  }
});
confirmDeleteBtn?.addEventListener("click", () => {
  const action = pendingConfirmAction;
  pendingConfirmAction = null;
  closeConfirmDialog(false);
  action?.();
});
cancelDeleteBtn?.addEventListener("click", () => {
  pendingConfirmAction = null;
  closeConfirmDialog(false);
});
newCategoryInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitNewCategory();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeCategoryPopover();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCategoryPopover(false);
    closeConfirmDialog();
  }
});

deleteCategoryBtn.addEventListener("click", () => {
  const categoryId = categorySelect.value;
  if (!categoryId) {
    setFeedback("请选择分类", true);
    return;
  }
  if (categoryId === DEFAULT_CATEGORY_ID) {
    setFeedback("默认分类无法删除", true);
    return;
  }
  const category = state.categories.find((item) => item.id === categoryId);
  const name = category?.name ? `「${category.name}」` : "该分类";
  openConfirmDialog(`确认删除${name}吗？`, () => {
    sendRuntimeCommand({ type: MESSAGE.PLAYLIST_DELETE_CATEGORY, payload: { categoryId } }, "删除失败").then((result) => {
      if (!result.ok) {
        setFeedback(result.message, true);
        return;
      }
      setFeedback("已删除分类");
    });
  });
});

function refreshState(snapshot) {
  if (!snapshot) {
    return;
  }
  state.categories = snapshot.categories || [];
  state.categoryOrder = snapshot.categoryOrder || [];
  state.activeCategoryId = snapshot.activeCategoryId || state.activeCategoryId;
  state.playback = { ...state.playback, ...(snapshot.playback || {}) };
  renderCategories();
  renderPlayback();
  renderVideoList();
}

function renderCategories() {
  categorySelect.innerHTML = "";
  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = `${category.name} (${category.videos.length})`;
    if (category.id === state.activeCategoryId) {
      option.selected = true;
    }
    categorySelect.appendChild(option);
  });
  deleteCategoryBtn.disabled = !categorySelect.value || categorySelect.value === DEFAULT_CATEGORY_ID;
}

function renderPlayback() {
  const duration = Number(state.playback.duration) || 0;
  const progress = Number(state.playback.progress) || 0;
  progressEl.max = Math.max(1, Math.floor(duration));
  if (!seeking) {
    progressEl.value = Math.min(progressEl.max, Math.floor(progress));
    updateProgressLabel(progress, duration);
  }
  const isPlaying = state.playback.status === "playing";
  playBtn.textContent = isPlaying ? "\u23F8" : "\u25B6";
  setTooltip(playBtn, isPlaying ? "暂停" : "播放");
  const mode = PLAYBACK_MODES.find((item) => item.id === state.playback.mode) || PLAYBACK_MODES[1];
  modeBtn.textContent = MODE_ICONS[mode.id] || "\uD83D\uDD01";
  setTooltip(modeBtn, mode.label);
  const volume = typeof state.playback.volume === "number" ? state.playback.volume : 1;
  if (volumeSlider) {
    volumeSlider.value = Math.round(Math.min(1, Math.max(0, volume)) * 100);
  }
}

function renderVideoList() {
  videoListEl.innerHTML = "";
  const activeCategory = state.categories.find((category) => category.id === state.activeCategoryId);
  if (!activeCategory || !activeCategory.videos.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "该分类暂无视频";
    videoListEl.appendChild(empty);
    return;
  }
  if (bulkSelection.enabled && bulkSelection.categoryId !== activeCategory.id) {
    bulkSelection.categoryId = activeCategory.id;
    bulkSelection.ids.clear();
    updateBulkUI();
  }
  activeCategory.videos.forEach((video) => {
    const card = document.createElement("div");
    card.className = "video-card";
    card.dataset.videoId = video.id;
    if (video.id === state.playback.videoId) {
      card.classList.add("is-active");
    }
    if (!bulkSelection.enabled) {
      card.draggable = true;
      card.classList.add("is-draggable");
      attachDragEvents(card, activeCategory.id, video.id);
    }
    if (dragState.overVideoId === video.id && dragState.position) {
      card.classList.add(dragState.position === "before" ? "is-drop-before" : "is-drop-after");
    }
    if (bulkSelection.enabled) {
      card.classList.add("has-selection");
      const selectCell = document.createElement("div");
      selectCell.className = "video-select-cell";
      const selectBox = document.createElement("input");
      selectBox.type = "checkbox";
      selectBox.className = "video-select";
      selectBox.checked = bulkSelection.ids.has(video.id);
      selectBox.addEventListener("change", (event) => {
        handleVideoSelection(video.id, event.target.checked);
      });
      selectCell.appendChild(selectBox);
      card.appendChild(selectCell);
    }
    const meta = document.createElement("div");
    meta.className = "video-card__meta";
    const title = document.createElement("div");
    title.className = "video-card__title";
    title.textContent = video.title;
    title.title = video.title;
    meta.appendChild(title);
    card.appendChild(meta);

    const duration = document.createElement("div");
    duration.className = "video-card__duration";
    duration.textContent = formatTime(video.duration || 0);
    card.appendChild(duration);

    const actions = document.createElement("div");
    actions.className = "video-card__actions";
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.textContent = "播放";
    playButton.addEventListener("click", (event) => {
      event.stopPropagation();
      sendRuntimeCommand(
        {
          type: MESSAGE.POPUP_PLAY_VIDEO,
          payload: { categoryId: activeCategory.id, videoId: video.id }
        },
        "播放失败"
      ).then(handleResultMessage);
    });
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const message = `确认删除「${video.title}」吗？`;
      openConfirmDialog(message, () => {
        deleteVideo(activeCategory.id, video.id).then((result) => {
          if (!result.ok) {
            setFeedback(result.message, true);
            return;
          }
          setFeedback("已删除视频");
        });
      });
    });
    actions.appendChild(playButton);
    actions.appendChild(deleteButton);
    card.appendChild(actions);
    card.addEventListener("click", () => {
      if (bulkSelection.enabled || Date.now() < dragState.suppressClickUntil) {
        return;
      }
      openVideoPage(video.url);
    });

    videoListEl.appendChild(card);
  });
}

function attachDragEvents(card, categoryId, videoId) {
  card.addEventListener("dragstart", (event) => {
    dragState.videoId = videoId;
    dragState.overVideoId = null;
    dragState.position = null;
    dragState.suppressClickUntil = Date.now() + 400;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", videoId);
  });
  card.addEventListener("dragover", (event) => {
    if (!dragState.videoId || dragState.videoId === videoId) {
      return;
    }
    event.preventDefault();
    const rect = card.getBoundingClientRect();
    const isBefore = event.clientY < rect.top + rect.height / 2;
    const position = isBefore ? "before" : "after";
    if (dragState.overVideoId !== videoId || dragState.position !== position) {
      dragState.overVideoId = videoId;
      dragState.position = position;
      updateDragIndicators();
    }
  });
  card.addEventListener("drop", async (event) => {
    event.preventDefault();
    if (!dragState.videoId || dragState.videoId === videoId) {
      clearDragState();
      updateDragIndicators();
      return;
    }
    const nextOrder = buildReorderedVideoIds(categoryId, dragState.videoId, videoId, dragState.position || "after");
    clearDragState();
    updateDragIndicators();
    if (!nextOrder) {
      return;
    }
    const result = await sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_REORDER_VIDEOS,
        payload: { categoryId, videoIds: nextOrder }
      },
      "排序失败"
    );
    if (!result.ok) {
      setFeedback(result.message, true);
    }
  });
  card.addEventListener("dragend", () => {
    clearDragState();
    updateDragIndicators();
  });
}

function buildReorderedVideoIds(categoryId, sourceVideoId, targetVideoId, position) {
  const category = state.categories.find((item) => item.id === categoryId);
  const videos = category?.videos || [];
  const sourceIndex = videos.findIndex((video) => video.id === sourceVideoId);
  const targetIndex = videos.findIndex((video) => video.id === targetVideoId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return null;
  }
  const orderedIds = videos.map((video) => video.id);
  const [movedId] = orderedIds.splice(sourceIndex, 1);
  let insertIndex = orderedIds.indexOf(targetVideoId);
  if (insertIndex === -1) {
    return null;
  }
  if (position === "after") {
    insertIndex += 1;
  }
  orderedIds.splice(insertIndex, 0, movedId);
  return orderedIds;
}

function clearDragState() {
  dragState.videoId = null;
  dragState.overVideoId = null;
  dragState.position = null;
  dragState.suppressClickUntil = Date.now() + 250;
}

function updateDragIndicators() {
  const cards = videoListEl.querySelectorAll(".video-card");
  cards.forEach((card) => {
    const isDragging = card.dataset.videoId === dragState.videoId;
    const isTarget = card.dataset.videoId === dragState.overVideoId;
    card.classList.toggle("is-dragging", isDragging);
    card.classList.toggle("is-drop-before", isTarget && dragState.position === "before");
    card.classList.toggle("is-drop-after", isTarget && dragState.position === "after");
  });
}

async function openVideoPage(url) {
  if (!url) {
    setFeedback("未找到视频地址", true);
    return;
  }
  try {
    await chrome.tabs.create({ url, active: true });
  } catch (error) {
    setFeedback(error?.message || "打开视频页失败", true);
  }
}

async function exportPlaylistFile() {
  const result = await sendRuntimeCommand({ type: MESSAGE.PLAYLIST_EXPORT }, "导出失败");
  if (!result.ok || !result.data) {
    setFeedback(result.message || "导出失败", true);
    return;
  }
  try {
    const blob = new Blob([`${JSON.stringify(result.data, null, 2)}\n`], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = buildExportFilename();
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    setFeedback("已导出播放列表");
  } catch (error) {
    setFeedback(error?.message || "导出失败", true);
  }
}

async function prepareImportPlaylist(file) {
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text);
  } catch (error) {
    setFeedback("导入文件不是有效的 JSON", true);
    return;
  }
  openConfirmDialog("导入将覆盖当前播放列表，确认继续吗？", async () => {
    const result = await sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_IMPORT,
        payload: { data }
      },
      "导入失败"
    );
    if (!result.ok) {
      setFeedback(result.message || "导入失败", true);
      return;
    }
    const categoryCount = Number(result.categoryCount) || 0;
    const videoCount = Number(result.videoCount) || 0;
    setFeedback(`已导入 ${categoryCount} 个分类 / ${videoCount} 个视频`);
  });
}

function buildExportFilename() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ];
  return `bilicast-playlist-${parts.join("")}.json`;
}

function updateProgressLabel(progress, duration) {
  currentTimeEl.textContent = formatTime(progress);
  durationTimeEl.textContent = formatTime(duration);
}

function formatTime(value) {
  const time = Math.max(0, Math.floor(value));
  const minutes = Math.floor(time / 60);
  const seconds = time % 60;
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    const mins = String(minutes % 60).padStart(2, "0");
    return `${hours}:${mins}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function setFeedback(text, isError = false) {
  if (!feedbackEl) {
    return;
  }
  if (feedbackTimer) {
    clearTimeout(feedbackTimer);
    feedbackTimer = null;
  }
  feedbackEl.textContent = text || "";
  feedbackEl.classList.toggle("is-visible", Boolean(text));
  feedbackEl.classList.toggle("is-error", Boolean(text && isError));
  if (text) {
    feedbackTimer = setTimeout(() => {
      feedbackEl.textContent = "";
      feedbackEl.classList.remove("is-visible");
      feedbackEl.classList.remove("is-error");
      feedbackTimer = null;
    }, 2500);
  } else {
    feedbackEl.classList.remove("is-visible");
  }
}

async function addCurrentVideoToList() {
  addCurrentBtn.disabled = true;
  const videoResult = await queryActiveTabVideo();
  if (!videoResult.ok) {
    setFeedback(videoResult.message, true);
    addCurrentBtn.disabled = false;
    return;
  }
  const categoryId = state.activeCategoryId;
  if (!categoryId) {
    setFeedback("请先选择分类", true);
    addCurrentBtn.disabled = false;
    return;
  }
  const result = await sendRuntimeCommand(
    {
      type: MESSAGE.PLAYLIST_ADD_VIDEO,
      payload: { categoryId, video: videoResult.video }
    },
    "添加失败"
  );
  if (!result.ok) {
    setFeedback(result.message, true);
    addCurrentBtn.disabled = false;
    return;
  }
  setFeedback("已添加当前视频");
  addCurrentBtn.disabled = false;
}

async function queryActiveTabVideo() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) {
      return { ok: false, message: "未找到活动标签页" };
    }
    if (!tab.url || !tab.url.includes("bilibili.com/video/")) {
      return { ok: false, message: "当前页不是 B 站视频页" };
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.CONTENT_REQUEST_VIDEO_INFO });
    if (!response?.ok) {
      return { ok: false, message: response?.message || "无法获取视频信息" };
    }
    return { ok: true, video: response.video };
  } catch (error) {
    return { ok: false, message: error?.message || "无法获取视频信息" };
  }
}

function setTooltip(element, label) {
  if (!element) return;
  if (label) {
    element.dataset.tooltip = label;
    element.setAttribute("aria-label", label);
    element.title = label;
  } else {
    element.removeAttribute("data-tooltip");
    element.removeAttribute("aria-label");
    element.removeAttribute("title");
  }
}

function toggleCategoryPopover() {
  if (!categoryPopover) return;
  if (categoryPopover.hidden) {
    openCategoryPopover();
  } else {
    closeCategoryPopover();
  }
}

function openCategoryPopover() {
  if (!categoryPopover) return;
  categoryPopover.hidden = false;
  categoryPopover.classList.add("is-open");
  requestAnimationFrame(() => {
    newCategoryInput?.focus();
  });
}

function closeCategoryPopover(resetInput = true) {
  if (!categoryPopover || categoryPopover.hidden) {
    return;
  }
  categoryPopover.classList.remove("is-open");
  categoryPopover.hidden = true;
  if (resetInput && newCategoryInput) {
    newCategoryInput.value = "";
  }
}

function submitNewCategory() {
  const name = newCategoryInput?.value.trim();
  if (!name) {
    setFeedback("请输入分类名", true);
    return;
  }
  sendRuntimeCommand({ type: MESSAGE.PLAYLIST_CREATE_CATEGORY, payload: { name } }, "创建失败").then((result) => {
    if (!result.ok) {
      setFeedback(result.message, true);
      return;
    }
    setFeedback("已创建分类");
    closeCategoryPopover();
  });
}

function openConfirmDialog(message, action) {
  if (!deleteConfirmDialog) return;
  deleteConfirmText.textContent = message || "确认执行该操作吗？";
  pendingConfirmAction = typeof action === "function" ? action : null;
  deleteConfirmDialog.hidden = false;
}

function closeConfirmDialog(resetAction = true) {
  if (!deleteConfirmDialog || deleteConfirmDialog.hidden) {
    return;
  }
  if (resetAction) {
    pendingConfirmAction = null;
  }
  deleteConfirmDialog.hidden = true;
}

function handleVideoSelection(videoId, checked) {
  if (!bulkSelection.enabled) {
    return;
  }
  if (checked) {
    bulkSelection.ids.add(videoId);
  } else {
    bulkSelection.ids.delete(videoId);
  }
  updateBulkUI();
}

function updateBulkUI() {
  if (bulkToggle) {
    bulkToggle.checked = bulkSelection.enabled;
  }
  if (bulkDeleteBtn) {
    bulkDeleteBtn.disabled = !bulkSelection.enabled || bulkSelection.ids.size === 0;
  }
}

async function performBulkDelete(categoryId, videoIds) {
  if (!videoIds.length) {
    setFeedback("请选择需要删除的视频", true);
    return;
  }
  for (const videoId of videoIds) {
    // eslint-disable-next-line no-await-in-loop
    const result = await deleteVideo(categoryId, videoId);
    if (!result.ok) {
      setFeedback(result.message, true);
      bulkSelection.ids.clear();
      updateBulkUI();
      return;
    }
  }
  setFeedback("已删除选中视频");
  bulkSelection.ids.clear();
  updateBulkUI();
}

function deleteVideo(categoryId, videoId) {
  return sendRuntimeCommand(
    {
      type: MESSAGE.PLAYLIST_DELETE_VIDEO,
      payload: { categoryId, videoId }
    },
    "删除失败"
  );
}

async function initializePopup() {
  try {
    const snapshot = await chrome.runtime.sendMessage({ type: MESSAGE.POPUP_INIT });
    if (!snapshot) {
      setFeedback("无法初始化", true);
      return;
    }
    refreshState(snapshot);
  } catch (error) {
    setFeedback(error?.message || "无法初始化", true);
  }
}

async function sendRuntimeCommand(message, fallbackMessage) {
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (result?.ok === false) {
      return { ok: false, message: result.message || fallbackMessage };
    }
    return { ok: true, ...(result || {}) };
  } catch (error) {
    return { ok: false, message: error?.message || fallbackMessage };
  }
}

function handleResultMessage(result) {
  if (!result?.ok) {
    setFeedback(result?.message || "操作失败", true);
  }
}



