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
const videoListEl = document.getElementById("videoList");
const feedbackEl = document.getElementById("categoryFeedback");

let seeking = false;
let pendingConfirmAction = null;
const bulkSelection = {
  enabled: false,
  categoryId: null,
  ids: new Set()
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
  }
});

chrome.runtime
  .sendMessage({ type: MESSAGE.POPUP_INIT })
  .then((snapshot) => refreshState(snapshot))
  .catch((error) => setFeedback(error.message || "无法初始化", true));

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
    chrome.runtime.sendMessage({
      type: MESSAGE.POPUP_SEEK,
      payload: { seconds }
    });
  });
});

playBtn.addEventListener("click", () => {
  const action = state.playback.status === "playing" ? "pause" : "play";
  chrome.runtime
    .sendMessage({ type: MESSAGE.POPUP_CONTROL, payload: { action } })
    .catch((error) => setFeedback(error.message || "播放失败", true));
});

prevBtn.addEventListener("click", () => {
  chrome.runtime
    .sendMessage({ type: MESSAGE.POPUP_CONTROL, payload: { action: "previous", manual: true } })
    .catch((error) => setFeedback(error.message || "没有上一条", true));
});

nextBtn.addEventListener("click", () => {
  chrome.runtime
    .sendMessage({ type: MESSAGE.POPUP_CONTROL, payload: { action: "next", manual: true } })
    .catch((error) => setFeedback(error.message || "没有下一条", true));
});

modeBtn.addEventListener("click", () => {
  const ids = PLAYBACK_MODES.map((mode) => mode.id);
  const currentIndex = ids.indexOf(state.playback.mode);
  const nextMode = ids[(currentIndex + 1) % ids.length];
  chrome.runtime
    .sendMessage({ type: MESSAGE.POPUP_SET_MODE, payload: { mode: nextMode } })
    .catch((error) => setFeedback(error.message || "切换模式失败", true));
});

addCurrentBtn.addEventListener("click", () => {
  addCurrentVideoToList().catch((error) => setFeedback(error.message || "添加失败", true));
});

volumeSlider?.addEventListener("input", () => {
  const value = Number(volumeSlider.value) / 100;
  chrome.runtime
    .sendMessage({ type: MESSAGE.POPUP_SET_VOLUME, payload: { volume: value } })
    .catch((error) => setFeedback(error.message || "音量调整失败", true));
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
  chrome.runtime
    .sendMessage({ type: MESSAGE.POPUP_SELECT_CATEGORY, payload: { categoryId } })
    .catch((error) => setFeedback(error.message || "切换失败", true));
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
    chrome.runtime
      .sendMessage({ type: MESSAGE.PLAYLIST_DELETE_CATEGORY, payload: { categoryId } })
      .then(() => setFeedback("已删除分类"))
      .catch((error) => setFeedback(error.message || "删除失败", true));
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
    if (video.id === state.playback.videoId) {
      card.classList.add("is-active");
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
    const cover = document.createElement("img");
    cover.className = "video-card__cover";
    cover.src = video.cover || "https://static.hdslb.com/images/base/icons/default.png";
    cover.alt = video.title;
    const meta = document.createElement("div");
    meta.className = "video-card__meta";
    const title = document.createElement("div");
    title.className = "video-card__title";
    title.textContent = video.title;
    const author = document.createElement("div");
    author.className = "video-card__author";
    author.textContent = video.author;
    const duration = document.createElement("div");
    duration.className = "video-card__duration";
    duration.textContent = formatTime(video.duration || 0);
    meta.appendChild(title);
    meta.appendChild(author);
    meta.appendChild(duration);
    card.appendChild(cover);
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "video-card__actions";
    const playButton = document.createElement("button");
    playButton.textContent = "播放";
    playButton.addEventListener("click", (event) => {
      event.stopPropagation();
      chrome.runtime
        .sendMessage({
          type: MESSAGE.POPUP_PLAY_VIDEO,
          payload: { categoryId: activeCategory.id, videoId: video.id }
        })
        .catch((error) => setFeedback(error.message || "播放失败", true));
    });
    const deleteButton = document.createElement("button");
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const message = `确认删除「${video.title}」吗？`;
      openConfirmDialog(message, () => {
        deleteVideo(activeCategory.id, video.id)
          .then(() => setFeedback("已删除视频"))
          .catch((error) => setFeedback(error.message || "删除失败", true));
      });
    });
    actions.appendChild(playButton);
    actions.appendChild(deleteButton);
    card.appendChild(actions);

    videoListEl.appendChild(card);
  });
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
  if (!feedbackEl) return;
  feedbackEl.textContent = text || "";
  feedbackEl.classList.toggle("is-error", Boolean(text && isError));
  if (text) {
    setTimeout(() => {
      feedbackEl.textContent = "";
      feedbackEl.classList.remove("is-error");
    }, 2500);
  }
}

async function addCurrentVideoToList() {
  addCurrentBtn.disabled = true;
  try {
    const video = await queryActiveTabVideo();
    const categoryId = state.activeCategoryId;
    if (!categoryId) {
      throw new Error("请先选择分类");
    }
    await chrome.runtime.sendMessage({
      type: MESSAGE.PLAYLIST_ADD_VIDEO,
      payload: { categoryId, video }
    });
    setFeedback("已添加当前视频");
  } catch (error) {
    setFeedback(error.message || "添加失败", true);
  } finally {
    addCurrentBtn.disabled = false;
  }
}

async function queryActiveTabVideo() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab) {
    throw new Error("未找到活动标签页");
  }
  if (!tab.url || !tab.url.includes("bilibili.com/video/")) {
    throw new Error("当前页不是 B 站视频页");
  }
  const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.CONTENT_REQUEST_VIDEO_INFO });
  if (!response?.ok) {
    throw new Error(response?.message || "无法获取视频信息");
  }
  return response.video;
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
  chrome.runtime
    .sendMessage({ type: MESSAGE.PLAYLIST_CREATE_CATEGORY, payload: { name } })
    .then(() => {
      setFeedback("已创建分类");
      closeCategoryPopover();
    })
    .catch((error) => setFeedback(error.message || "创建失败", true));
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
  try {
    for (const videoId of videoIds) {
      // eslint-disable-next-line no-await-in-loop
      await deleteVideo(categoryId, videoId);
    }
    setFeedback("已删除选中视频");
  } catch (error) {
    setFeedback(error.message || "删除失败", true);
  } finally {
    bulkSelection.ids.clear();
    updateBulkUI();
  }
}

function deleteVideo(categoryId, videoId) {
  return chrome.runtime.sendMessage({
    type: MESSAGE.PLAYLIST_DELETE_VIDEO,
    payload: { categoryId, videoId }
  });
}



