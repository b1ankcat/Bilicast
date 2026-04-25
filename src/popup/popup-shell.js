import { applySnapshot, ensureActiveCategory, syncBulkSelectionWithActiveCategory } from "./store.js";
import { getPopupElements } from "./elements.js";
import { mountFeedback } from "./feedback.js";
import { mountConfirmDialog } from "./confirm-dialog.js";
import { createPopupActions } from "./popup-actions.js";
import { mountPlaybackBar } from "./playback-bar.js";
import { mountMoveVideoDialog } from "./move-video-dialog.js";
import { mountVideoActionMenu } from "./video-action-menu.js";
import { mountVideoList } from "./video-list.js";
import { mountCategoryManager } from "./category-manager.js";
import { mountPlaylistToolbar } from "./playlist-toolbar.js";
import { MESSAGE } from "../shared/messages.js";

export function initPopupShell() {
  const elements = getPopupElements();
  const feedback = mountFeedback({ feedbackEl: elements.feedbackEl });
  const confirmDialog = mountConfirmDialog({ elements });
  const actions = createPopupActions();
  const moveVideoDialog = mountMoveVideoDialog({ elements, actions, feedback });
  const videoActionMenu = mountVideoActionMenu({ actions, confirmDialog, feedback, moveVideoDialog });
  const categoryManager = mountCategoryManager({ actions, confirmDialog, elements, feedback, videoActionMenu });

  const requestRender = () => renderAll();
  const playbackBar = mountPlaybackBar({ elements, actions, feedback });
  const playlistToolbar = mountPlaylistToolbar({
    elements,
    actions,
    feedback,
    confirmDialog,
    categoryManager,
    requestRender
  });
  const videoList = mountVideoList({
    elements,
    actions,
    feedback,
    onSelectionChange: () => playlistToolbar.render(),
    videoActionMenu
  });

  const port = chrome.runtime.connect({ name: "popup" });
  port.onMessage.addListener((message) => {
    if (message?.type === MESSAGE.STORAGE_PUSH) {
      applySnapshot(message.payload);
      renderAll();
      return;
    }
    if (message?.type === MESSAGE.POPUP_FEEDBACK) {
      feedback.show(message.payload?.message, message.payload?.isError !== false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    categoryManager.close();
    moveVideoDialog.close();
    videoActionMenu.close();
    confirmDialog.close();
  });

  document.addEventListener("pointerdown", videoActionMenu.handleOutsideEvent, true);
  document.addEventListener("click", videoActionMenu.handleOutsideEvent, true);
  document.addEventListener("contextmenu", videoActionMenu.handleOutsideEvent, true);

  actions.initialize().then((result) => {
    if (!result.ok) {
      feedback.show(result.message || "无法初始化", true);
      return;
    }
    applySnapshot(result.snapshot);
    renderAll();
  });

  function renderAll() {
    ensureActiveCategory();
    syncBulkSelectionWithActiveCategory();
    playlistToolbar.render();
    playbackBar.render();
    videoList.render();
    videoActionMenu.sync();
    if (categoryManager.isOpen()) {
      categoryManager.render();
    }
    if (moveVideoDialog.isOpen()) {
      moveVideoDialog.render();
    }
  }
}
