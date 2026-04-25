import { formatTime } from "./format.js";
import {
  bulkSelection,
  dragState,
  getActiveCategory,
  getCategoryById,
  getVideoPrimaryActionState,
  resetVideoDragState,
  setSelectedVideo,
  startVideoDrag,
  state,
  syncBulkSelectionWithActiveCategory,
  updateVideoDragTarget
} from "./store.js";

export function mountVideoList({ elements, actions, feedback, onSelectionChange, videoActionMenu }) {
  function render() {
    if (!elements.videoListEl) {
      return;
    }
    elements.videoListEl.innerHTML = "";
    const activeCategory = getActiveCategory();
    if (!activeCategory || !activeCategory.videos.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "该分类暂无视频";
      elements.videoListEl.appendChild(empty);
      return;
    }

    syncBulkSelectionWithActiveCategory();

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
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "video-select";
        checkbox.checked = bulkSelection.ids.has(video.id);
        checkbox.addEventListener("change", (event) => {
          setSelectedVideo(video.id, event.target.checked);
          onSelectionChange();
        });
        selectCell.appendChild(checkbox);
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

      const actionState = getVideoPrimaryActionState(video.id);
      const actionsWrap = document.createElement("div");
      actionsWrap.className = "video-card__actions";
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "video-card__action";
      actionButton.textContent = actionState.icon;
      actionButton.title = actionState.title;
      actionButton.addEventListener("click", (event) => {
        event.stopPropagation();
        actions.playOrToggleVideo(activeCategory.id, video.id).then(handleResult);
      });
      actionButton.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        videoActionMenu.open(activeCategory.id, video.id, event.clientX, event.clientY);
      });
      actionsWrap.appendChild(actionButton);
      card.appendChild(actionsWrap);

      card.addEventListener("click", () => {
        if (bulkSelection.enabled || Date.now() < dragState.suppressClickUntil) {
          return;
        }
        actions.openVideoPage(video.url).then(handleResult);
      });

      elements.videoListEl.appendChild(card);
    });
  }

  function attachDragEvents(card, categoryId, videoId) {
    card.addEventListener("dragstart", (event) => {
      startVideoDrag(videoId);
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
      const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (dragState.overVideoId !== videoId || dragState.position !== position) {
        updateVideoDragTarget(videoId, position);
        updateDragIndicators();
      }
    });

    card.addEventListener("drop", async (event) => {
      event.preventDefault();
      if (!dragState.videoId || dragState.videoId === videoId) {
        resetVideoDragState();
        updateDragIndicators();
        return;
      }
      const nextOrder = buildReorderedVideoIds(categoryId, dragState.videoId, videoId, dragState.position || "after");
      resetVideoDragState();
      updateDragIndicators();
      if (!nextOrder) {
        return;
      }
      const result = await actions.reorderVideos(categoryId, nextOrder);
      if (!result.ok) {
        feedback.show(result.message || "排序失败", true);
      }
    });

    card.addEventListener("dragend", () => {
      resetVideoDragState();
      updateDragIndicators();
    });
  }

  function updateDragIndicators() {
    const cards = elements.videoListEl?.querySelectorAll(".video-card") || [];
    cards.forEach((card) => {
      const isDragging = card.dataset.videoId === dragState.videoId;
      const isTarget = card.dataset.videoId === dragState.overVideoId;
      card.classList.toggle("is-dragging", isDragging);
      card.classList.toggle("is-drop-before", isTarget && dragState.position === "before");
      card.classList.toggle("is-drop-after", isTarget && dragState.position === "after");
    });
  }

  function buildReorderedVideoIds(categoryId, sourceVideoId, targetVideoId, position) {
    const category = getCategoryById(categoryId);
    const orderedIds = (category?.videos || []).map((video) => video.id);
    const sourceIndex = orderedIds.indexOf(sourceVideoId);
    const targetIndex = orderedIds.indexOf(targetVideoId);
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
      return null;
    }
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

  function handleResult(result) {
    if (!result?.ok) {
      feedback.show(result?.message || "操作失败", true);
    }
  }

  return { render };
}
