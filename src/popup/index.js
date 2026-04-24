import { AUDIO_QUALITY_OPTIONS, MESSAGE, PLAYBACK_MODES } from "../shared/messages.js";
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
    audioQuality: "auto",
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
const manageCategoriesBtn = document.getElementById("manageCategoriesBtn");
const audioQualitySelect = document.getElementById("audioQualitySelect");
const categoryManagerDialog = document.getElementById("categoryManagerDialog");
const categoryManagerList = document.getElementById("categoryManagerList");
const managerCategoryInput = document.getElementById("managerCategoryInput");
const managerCategoryConfirmBtn = document.getElementById("managerCategoryConfirmBtn");
const closeCategoryManagerBtn = document.getElementById("closeCategoryManagerBtn");
const moveVideoDialog = document.getElementById("moveVideoDialog");
const moveVideoText = document.getElementById("moveVideoText");
const moveVideoSelect = document.getElementById("moveVideoSelect");
const moveVideoHint = document.getElementById("moveVideoHint");
const confirmMoveVideoBtn = document.getElementById("confirmMoveVideoBtn");
const cancelMoveVideoBtn = document.getElementById("cancelMoveVideoBtn");
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

const categoryManagerState = {
  dragCategoryId: null,
  overCategoryId: null,
  position: null
};

const moveVideoState = {
  videoId: null,
  fromCategoryId: null,
  title: ""
};

const actionMenuState = {
  videoId: null,
  categoryId: null,
  x: 0,
  y: 0
};

const videoActionMenuEl = createVideoActionMenu();

setTooltip(prevBtn, "上一条");
setTooltip(nextBtn, "下一条");
setTooltip(addCurrentBtn, "添加当前页视频");
setTooltip(manageCategoriesBtn, "管理分类");
setTooltip(playBtn, "播放");

renderAudioQualityOptions();

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

progressEl?.addEventListener("input", () => {
  seeking = true;
  updateProgressLabel(Number(progressEl.value), state.playback.duration || 0);
});

["change", "mouseup", "touchend"].forEach((eventName) => {
  progressEl?.addEventListener(eventName, () => {
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

playBtn?.addEventListener("click", () => {
  const action = state.playback.status === "playing" ? "pause" : "play";
  sendRuntimeCommand({ type: MESSAGE.POPUP_CONTROL, payload: { action } }, "播放失败").then(handleResultMessage);
});

prevBtn?.addEventListener("click", () => {
  sendRuntimeCommand(
    { type: MESSAGE.POPUP_CONTROL, payload: { action: "previous", manual: true } },
    "没有上一条"
  ).then(handleResultMessage);
});

nextBtn?.addEventListener("click", () => {
  sendRuntimeCommand(
    { type: MESSAGE.POPUP_CONTROL, payload: { action: "next", manual: true } },
    "没有下一条"
  ).then(handleResultMessage);
});

modeBtn?.addEventListener("click", () => {
  const ids = PLAYBACK_MODES.map((mode) => mode.id);
  const currentIndex = ids.indexOf(state.playback.mode);
  const nextMode = ids[(currentIndex + 1) % ids.length];
  sendRuntimeCommand({ type: MESSAGE.POPUP_SET_MODE, payload: { mode: nextMode } }, "切换模式失败").then(
    handleResultMessage
  );
});

addCurrentBtn?.addEventListener("click", () => {
  addCurrentVideoToList();
});

volumeSlider?.addEventListener("input", () => {
  const value = Number(volumeSlider.value) / 100;
  sendRuntimeCommand({ type: MESSAGE.POPUP_SET_VOLUME, payload: { volume: value } }, "音量调整失败").then(
    handleResultMessage
  );
});

audioQualitySelect?.addEventListener("change", () => {
  const audioQuality = audioQualitySelect.value;
  sendRuntimeCommand(
    { type: MESSAGE.POPUP_SET_AUDIO_QUALITY, payload: { audioQuality } },
    "音质切换失败"
  ).then(handleResultMessage);
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

categorySelect?.addEventListener("change", () => {
  const categoryId = categorySelect.value;
  if (!categoryId) {
    bulkSelection.enabled = false;
    bulkSelection.ids.clear();
    bulkSelection.categoryId = null;
    updateBulkUI();
    return;
  }
  bulkSelection.categoryId = categoryId;
  bulkSelection.ids.clear();
  updateBulkUI();
  sendRuntimeCommand({ type: MESSAGE.POPUP_SELECT_CATEGORY, payload: { categoryId } }, "切换失败").then(
    handleResultMessage
  );
});

manageCategoriesBtn?.addEventListener("click", () => {
  openCategoryManager();
});

closeCategoryManagerBtn?.addEventListener("click", () => {
  closeCategoryManager();
});
categoryManagerDialog?.addEventListener("click", (event) => {
  if (event.target === categoryManagerDialog) {
    closeCategoryManager();
  }
});

moveVideoSelect?.addEventListener("change", () => {
  updateMoveVideoHint();
});
confirmMoveVideoBtn?.addEventListener("click", () => {
  submitMoveVideo();
});
cancelMoveVideoBtn?.addEventListener("click", () => {
  closeMoveVideoDialog();
});
moveVideoDialog?.addEventListener("click", (event) => {
  if (event.target === moveVideoDialog) {
    closeMoveVideoDialog();
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

managerCategoryConfirmBtn?.addEventListener("click", () => submitNewCategory());
managerCategoryInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitNewCategory();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    managerCategoryInput.blur();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCategoryManager();
    closeMoveVideoDialog();
    closeVideoActionMenu();
    closeConfirmDialog();
  }
});

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

document.addEventListener("pointerdown", handleOutsideVideoActionMenuEvent, true);
document.addEventListener("click", handleOutsideVideoActionMenuEvent, true);
document.addEventListener("contextmenu", handleOutsideVideoActionMenuEvent, true);

updateBulkUI();

function handleOutsideVideoActionMenuEvent(event) {
  if (!videoActionMenuEl || videoActionMenuEl.hidden) {
    return;
  }
  if (isInsideVideoActionMenu(event.target) || isVideoActionButton(event.target)) {
    return;
  }
  closeVideoActionMenu();
}

function isInsideVideoActionMenu(target) {
  return target instanceof Node && videoActionMenuEl.contains(target);
}

function isVideoActionButton(target) {
  return target instanceof Element && Boolean(target.closest(".video-card__action"));
}

function refreshState(snapshot) {
  if (!snapshot) {
    return;
  }
  state.categories = Array.isArray(snapshot.categories) ? snapshot.categories : [];
  state.categoryOrder = Array.isArray(snapshot.categoryOrder)
    ? snapshot.categoryOrder
    : state.categories.map((category) => category.id);
  state.activeCategoryId = snapshot.activeCategoryId || state.categories[0]?.id || null;
  state.playback = { ...state.playback, ...(snapshot.playback || {}) };

  if (!getCategoryById(state.activeCategoryId)) {
    state.activeCategoryId = state.categories[0]?.id || null;
  }

  if (bulkSelection.enabled && bulkSelection.categoryId !== state.activeCategoryId) {
    bulkSelection.categoryId = state.activeCategoryId;
    bulkSelection.ids.clear();
    updateBulkUI();
  }

  renderCategories();
  renderPlayback();
  renderVideoList();
  syncVideoActionMenuState();

  if (isCategoryManagerOpen()) {
    renderCategoryManager();
  }
  if (isMoveVideoDialogOpen()) {
    renderMoveVideoDialog();
  }
}

function renderCategories() {
  if (!categorySelect) {
    return;
  }
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
}

function renderPlayback() {
  const duration = Number(state.playback.duration) || 0;
  const progress = Number(state.playback.progress) || 0;
  if (progressEl) {
    progressEl.max = Math.max(1, Math.floor(duration));
    if (!seeking) {
      progressEl.value = Math.min(progressEl.max, Math.floor(progress));
      updateProgressLabel(progress, duration);
    }
  }
  const isPlaying = state.playback.status === "playing";
  if (playBtn) {
    playBtn.textContent = isPlaying ? "\u23F8" : "\u25B6";
    setTooltip(playBtn, isPlaying ? "暂停" : "播放");
  }
  const mode = PLAYBACK_MODES.find((item) => item.id === state.playback.mode) || PLAYBACK_MODES[1];
  if (modeBtn) {
    modeBtn.textContent = MODE_ICONS[mode.id] || "\uD83D\uDD01";
    setTooltip(modeBtn, mode.label);
  }
  const volume = typeof state.playback.volume === "number" ? state.playback.volume : 1;
  if (volumeSlider) {
    volumeSlider.value = Math.round(Math.min(1, Math.max(0, volume)) * 100);
  }
  if (audioQualitySelect) {
    audioQualitySelect.value = state.playback.audioQuality || "auto";
  }
}

function renderVideoList() {
  if (!videoListEl) {
    return;
  }
  videoListEl.innerHTML = "";
  const activeCategory = getActiveCategory();
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

    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "video-card__action";
    actionButton.textContent = "▶";
    actionButton.title = "左键播放，右键管理";
    actionButton.addEventListener("click", (event) => {
      event.stopPropagation();
      closeVideoActionMenu();
      sendRuntimeCommand(
        {
          type: MESSAGE.POPUP_PLAY_VIDEO,
          payload: { categoryId: activeCategory.id, videoId: video.id }
        },
        "播放失败"
      ).then(handleResultMessage);
    });
    actionButton.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openVideoActionMenu(activeCategory.id, video.id, event.clientX, event.clientY);
    });

    actions.appendChild(actionButton);
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
  const category = getCategoryById(categoryId);
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
  const cards = videoListEl?.querySelectorAll(".video-card") || [];
  cards.forEach((card) => {
    const isDragging = card.dataset.videoId === dragState.videoId;
    const isTarget = card.dataset.videoId === dragState.overVideoId;
    card.classList.toggle("is-dragging", isDragging);
    card.classList.toggle("is-drop-before", isTarget && dragState.position === "before");
    card.classList.toggle("is-drop-after", isTarget && dragState.position === "after");
  });
}

function openCategoryManager() {
  if (!categoryManagerDialog) {
    return;
  }
  closeVideoActionMenu();
  categoryManagerDialog.hidden = false;
  renderCategoryManager();
}

function closeCategoryManager(resetDragState = true) {
  if (!categoryManagerDialog || categoryManagerDialog.hidden) {
    return;
  }
  categoryManagerDialog.hidden = true;
  if (resetDragState) {
    clearCategoryManagerDragState();
  }
}

function isCategoryManagerOpen() {
  return Boolean(categoryManagerDialog && !categoryManagerDialog.hidden);
}

function renderCategoryManager() {
  if (!categoryManagerList) {
    return;
  }
  categoryManagerList.innerHTML = "";

  state.categories.forEach((category) => {
    const isDefault = category.id === DEFAULT_CATEGORY_ID;
    const item = document.createElement("div");
    item.className = "category-manager__item";
    item.dataset.categoryId = category.id;

    item.draggable = true;
    item.classList.add("is-draggable");
    attachCategoryDragEvents(item, category.id);

    if (categoryManagerState.overCategoryId === category.id && categoryManagerState.position) {
      item.classList.add(categoryManagerState.position === "before" ? "is-drop-before" : "is-drop-after");
    }
    if (categoryManagerState.dragCategoryId === category.id) {
      item.classList.add("is-dragging");
    }

    const grip = document.createElement("div");
    grip.className = "category-manager__grip";
    grip.textContent = "\u22EE\u22EE";
    item.appendChild(grip);

    const body = document.createElement("div");
    body.className = "category-manager__body";
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "category-manager__name";
    nameInput.value = category.name;
    nameInput.disabled = isDefault;
    body.appendChild(nameInput);
    item.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "category-manager__actions";
    if (!isDefault) {
      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.textContent = "保存";
      syncRenameButtonState(saveButton, nameInput, category.name);
      saveButton.addEventListener("click", () => {
        submitCategoryRename(category.id, nameInput.value, category.name);
      });
      nameInput.addEventListener("input", () => {
        syncRenameButtonState(saveButton, nameInput, category.name);
      });
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (!saveButton.disabled) {
            submitCategoryRename(category.id, nameInput.value, category.name);
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          nameInput.value = category.name;
          syncRenameButtonState(saveButton, nameInput, category.name);
        }
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "删除";
      deleteButton.className = "category-manager__delete";
      deleteButton.addEventListener("click", () => {
        openConfirmDialog(`确认删除「${category.name}」吗？`, () => {
          sendRuntimeCommand(
            { type: MESSAGE.PLAYLIST_DELETE_CATEGORY, payload: { categoryId: category.id } },
            "删除失败"
          ).then((result) => {
            if (!result.ok) {
              setFeedback(result.message, true);
              return;
            }
            setFeedback("已删除分类");
          });
        });
      });

      actions.appendChild(saveButton);
      actions.appendChild(deleteButton);
    }
    item.appendChild(actions);
    categoryManagerList.appendChild(item);
  });
}

function attachCategoryDragEvents(item, categoryId) {
  item.addEventListener("dragstart", (event) => {
    categoryManagerState.dragCategoryId = categoryId;
    categoryManagerState.overCategoryId = null;
    categoryManagerState.position = null;
    item.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", categoryId);
  });

  item.addEventListener("dragover", (event) => {
    if (!categoryManagerState.dragCategoryId || categoryManagerState.dragCategoryId === categoryId) {
      return;
    }
    event.preventDefault();
    const rect = item.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    if (categoryManagerState.overCategoryId !== categoryId || categoryManagerState.position !== position) {
      categoryManagerState.overCategoryId = categoryId;
      categoryManagerState.position = position;
      updateCategoryDragIndicators();
    }
  });

  item.addEventListener("drop", async (event) => {
    event.preventDefault();
    if (!categoryManagerState.dragCategoryId || categoryManagerState.dragCategoryId === categoryId) {
      clearCategoryManagerDragState();
      updateCategoryDragIndicators();
      return;
    }
    const nextOrder = buildReorderedCategoryIds(
      categoryManagerState.dragCategoryId,
      categoryId,
      categoryManagerState.position || "after"
    );
    clearCategoryManagerDragState();
    updateCategoryDragIndicators();
    if (!nextOrder) {
      return;
    }
    const result = await sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_REORDER_CATEGORIES,
        payload: { categoryOrder: nextOrder }
      },
      "分类排序失败"
    );
    if (!result.ok) {
      setFeedback(result.message, true);
      return;
    }
    setFeedback("已更新分类顺序", false);
  });

  item.addEventListener("dragend", () => {
    clearCategoryManagerDragState();
    updateCategoryDragIndicators();
  });
}

function buildReorderedCategoryIds(sourceCategoryId, targetCategoryId, position) {
  const orderedIds = (state.categoryOrder.length ? state.categoryOrder : state.categories.map((category) => category.id)).filter(Boolean);
  const sourceIndex = orderedIds.indexOf(sourceCategoryId);
  const targetIndex = orderedIds.indexOf(targetCategoryId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return null;
  }
  const [movedId] = orderedIds.splice(sourceIndex, 1);
  let insertIndex = orderedIds.indexOf(targetCategoryId);
  if (insertIndex === -1) {
    return null;
  }
  if (position === "after") {
    insertIndex += 1;
  }
  orderedIds.splice(insertIndex, 0, movedId);
  return orderedIds;
}

function clearCategoryManagerDragState() {
  categoryManagerState.dragCategoryId = null;
  categoryManagerState.overCategoryId = null;
  categoryManagerState.position = null;
}

function updateCategoryDragIndicators() {
  const items = categoryManagerList?.querySelectorAll(".category-manager__item") || [];
  items.forEach((item) => {
    const isDragging = item.dataset.categoryId === categoryManagerState.dragCategoryId;
    const isTarget = item.dataset.categoryId === categoryManagerState.overCategoryId;
    item.classList.toggle("is-dragging", isDragging);
    item.classList.toggle("is-drop-before", isTarget && categoryManagerState.position === "before");
    item.classList.toggle("is-drop-after", isTarget && categoryManagerState.position === "after");
  });
}

function syncRenameButtonState(button, input, originalName) {
  if (!button || !input) {
    return;
  }
  const trimmed = input.value.trim();
  button.disabled = !trimmed || trimmed === originalName;
}

function submitCategoryRename(categoryId, nextName, originalName) {
  const trimmed = String(nextName || "").trim();
  if (!trimmed) {
    setFeedback("分类名称不能为空", true);
    return;
  }
  if (trimmed === originalName) {
    return;
  }
  sendRuntimeCommand(
    { type: MESSAGE.PLAYLIST_RENAME_CATEGORY, payload: { categoryId, name: trimmed } },
    "重命名失败"
  ).then((result) => {
    if (!result.ok) {
      setFeedback(result.message, true);
      return;
    }
    setFeedback("已重命名分类");
  });
}

function openMoveVideoDialog(fromCategoryId, video) {
  if (!fromCategoryId || !video?.id) {
    setFeedback("缺少视频信息", true);
    return;
  }
  if (state.categories.length < 2) {
    setFeedback("至少需要两个分类才能移动", true);
    return;
  }
  closeVideoActionMenu();
  moveVideoState.fromCategoryId = fromCategoryId;
  moveVideoState.videoId = video.id;
  moveVideoState.title = video.title || "该视频";
  renderMoveVideoDialog();
}

function renderMoveVideoDialog() {
  if (!moveVideoDialog || !moveVideoSelect) {
    return;
  }
  const sourceCategory = getCategoryById(moveVideoState.fromCategoryId);
  const sourceVideo = sourceCategory?.videos?.find((video) => video.id === moveVideoState.videoId);
  const targetCategories = state.categories.filter((category) => category.id !== moveVideoState.fromCategoryId);
  if (!sourceCategory || !sourceVideo || !targetCategories.length) {
    closeMoveVideoDialog(false);
    return;
  }

  moveVideoText.textContent = `移动「${moveVideoState.title}」到`;
  moveVideoSelect.innerHTML = "";
  targetCategories.forEach((category, index) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = `${category.name} (${category.videos.length})`;
    if (index === 0) {
      option.selected = true;
    }
    moveVideoSelect.appendChild(option);
  });
  updateMoveVideoHint();
  moveVideoDialog.hidden = false;
}

function updateMoveVideoHint() {
  if (!moveVideoSelect || !moveVideoHint || !confirmMoveVideoBtn) {
    return;
  }
  const targetCategory = getCategoryById(moveVideoSelect.value);
  const hasSameVideo = Boolean(targetCategory?.videos?.some((video) => video.id === moveVideoState.videoId));
  moveVideoHint.textContent = hasSameVideo ? "目标分类已有该视频，移动后会自动合并为一份" : "";
  confirmMoveVideoBtn.disabled = !moveVideoSelect.value;
}

function isMoveVideoDialogOpen() {
  return Boolean(moveVideoDialog && !moveVideoDialog.hidden);
}

function closeMoveVideoDialog(resetState = true) {
  if (!moveVideoDialog || moveVideoDialog.hidden) {
    return;
  }
  moveVideoDialog.hidden = true;
  if (resetState) {
    moveVideoState.videoId = null;
    moveVideoState.fromCategoryId = null;
    moveVideoState.title = "";
    if (moveVideoSelect) {
      moveVideoSelect.innerHTML = "";
    }
    if (moveVideoHint) {
      moveVideoHint.textContent = "";
    }
  }
}

function createVideoActionMenu() {
  const menu = document.createElement("div");
  menu.className = "video-action-menu";
  menu.hidden = true;

  const moveButton = document.createElement("button");
  moveButton.type = "button";
  moveButton.textContent = "移动到...";
  moveButton.addEventListener("click", () => {
    const categoryId = actionMenuState.categoryId;
    const videoId = actionMenuState.videoId;
    const video = getVideoById(categoryId, videoId);
    closeVideoActionMenu();
    if (!video) {
      setFeedback("未找到视频", true);
      return;
    }
    openMoveVideoDialog(categoryId, video);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "删除";
  deleteButton.className = "is-danger";
  deleteButton.addEventListener("click", () => {
    const categoryId = actionMenuState.categoryId;
    const videoId = actionMenuState.videoId;
    const video = getVideoById(categoryId, videoId);
    closeVideoActionMenu();
    if (!video) {
      setFeedback("未找到视频", true);
      return;
    }
    openConfirmDialog(`确认删除「${video.title}」吗？`, () => {
      deleteVideo(categoryId, videoId).then((result) => {
        if (!result.ok) {
          setFeedback(result.message, true);
          return;
        }
        setFeedback("已删除视频");
      });
    });
  });

  menu.appendChild(moveButton);
  menu.appendChild(deleteButton);
  document.body.appendChild(menu);
  return menu;
}

function openVideoActionMenu(categoryId, videoId, clientX, clientY) {
  const video = getVideoById(categoryId, videoId);
  if (!video || !videoActionMenuEl) {
    return;
  }
  const isSameTargetOpen = !videoActionMenuEl.hidden
    && actionMenuState.categoryId === categoryId
    && actionMenuState.videoId === videoId;
  if (isSameTargetOpen) {
    closeVideoActionMenu();
    return;
  }
  actionMenuState.categoryId = categoryId;
  actionMenuState.videoId = videoId;
  actionMenuState.x = clientX;
  actionMenuState.y = clientY;
  renderVideoActionMenu();
}

function renderVideoActionMenu() {
  if (!videoActionMenuEl || !actionMenuState.videoId) {
    return;
  }
  const [moveButton] = videoActionMenuEl.querySelectorAll("button");
  if (moveButton) {
    moveButton.disabled = state.categories.length < 2;
  }
  videoActionMenuEl.hidden = false;
  const margin = 10;
  const menuRect = videoActionMenuEl.getBoundingClientRect();
  const left = Math.min(actionMenuState.x, window.innerWidth - menuRect.width - margin);
  const top = Math.min(actionMenuState.y, window.innerHeight - menuRect.height - margin);
  videoActionMenuEl.style.left = `${Math.max(margin, left)}px`;
  videoActionMenuEl.style.top = `${Math.max(margin, top)}px`;
}

function closeVideoActionMenu() {
  if (!videoActionMenuEl || videoActionMenuEl.hidden) {
    return;
  }
  videoActionMenuEl.hidden = true;
  actionMenuState.categoryId = null;
  actionMenuState.videoId = null;
}

function syncVideoActionMenuState() {
  if (!actionMenuState.videoId) {
    return;
  }
  const video = getVideoById(actionMenuState.categoryId, actionMenuState.videoId);
  if (!video) {
    closeVideoActionMenu();
    return;
  }
  renderVideoActionMenu();
}

async function submitMoveVideo() {
  const fromCategoryId = moveVideoState.fromCategoryId;
  const videoId = moveVideoState.videoId;
  const toCategoryId = moveVideoSelect?.value;
  if (!fromCategoryId || !videoId || !toCategoryId) {
    setFeedback("请选择目标分类", true);
    return;
  }
  const result = await sendRuntimeCommand(
    {
      type: MESSAGE.PLAYLIST_MOVE_VIDEO,
      payload: { fromCategoryId, toCategoryId, videoId }
    },
    "移动失败"
  );
  if (!result.ok) {
    setFeedback(result.message, true);
    return;
  }
  closeMoveVideoDialog();
  setFeedback("已移动视频");
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
  } catch {
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
  if (currentTimeEl) {
    currentTimeEl.textContent = formatTime(progress);
  }
  if (durationTimeEl) {
    durationTimeEl.textContent = formatTime(duration);
  }
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

function renderAudioQualityOptions() {
  if (!audioQualitySelect) {
    return;
  }
  audioQualitySelect.innerHTML = "";
  AUDIO_QUALITY_OPTIONS.forEach((option) => {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.label;
    audioQualitySelect.appendChild(element);
  });
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
  if (!addCurrentBtn) {
    return;
  }
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
  if (!element) {
    return;
  }
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

function submitNewCategory() {
  const name = managerCategoryInput?.value.trim();
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
    if (managerCategoryInput) {
      managerCategoryInput.value = "";
      managerCategoryInput.focus();
    }
  });
}

function openConfirmDialog(message, action) {
  if (!deleteConfirmDialog || !deleteConfirmText) {
    return;
  }
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

function getCategoryById(categoryId) {
  return state.categories.find((category) => category.id === categoryId) || null;
}

function getVideoById(categoryId, videoId) {
  return getCategoryById(categoryId)?.videos?.find((video) => video.id === videoId) || null;
}

function getActiveCategory() {
  return getCategoryById(state.activeCategoryId);
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
