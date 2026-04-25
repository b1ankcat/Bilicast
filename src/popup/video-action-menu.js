import { actionMenuState, getVideoById, resetActionMenuState, setActionMenuTarget, state } from "./store.js";

export function mountVideoActionMenu({ actions, confirmDialog, feedback, moveVideoDialog }) {
  const menu = createMenu();

  function createMenu() {
    const root = document.createElement("div");
    root.className = "video-action-menu";
    root.hidden = true;

    const moveButton = document.createElement("button");
    moveButton.type = "button";
    moveButton.textContent = "移动到...";
    moveButton.addEventListener("click", () => {
      const categoryId = actionMenuState.categoryId;
      const videoId = actionMenuState.videoId;
      const video = getVideoById(categoryId, videoId);
      close();
      if (!video) {
        feedback.show("未找到视频", true);
        return;
      }
      moveVideoDialog.open(categoryId, video);
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "is-danger";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => {
      const categoryId = actionMenuState.categoryId;
      const videoId = actionMenuState.videoId;
      const video = getVideoById(categoryId, videoId);
      close();
      if (!video) {
        feedback.show("未找到视频", true);
        return;
      }
      confirmDialog.open(`确认删除《${video.title}》吗？`, async () => {
        const result = await actions.deleteVideo(categoryId, videoId);
        if (!result.ok) {
          feedback.show(result.message || "删除失败", true);
          return;
        }
        feedback.show("已删除视频");
      });
    });

    root.appendChild(moveButton);
    root.appendChild(deleteButton);
    document.body.appendChild(root);
    return root;
  }

  function open(categoryId, videoId, clientX, clientY) {
    const video = getVideoById(categoryId, videoId);
    if (!video) {
      return;
    }

    const isSameTargetOpen = !menu.hidden
      && actionMenuState.categoryId === categoryId
      && actionMenuState.videoId === videoId;
    if (isSameTargetOpen) {
      close();
      return;
    }

    setActionMenuTarget({ categoryId, videoId, x: clientX, y: clientY });
    render();
  }

  function render() {
    if (!actionMenuState.videoId) {
      return;
    }

    const moveButton = menu.querySelector("button");
    if (moveButton) {
      moveButton.disabled = state.categories.length < 2;
    }

    menu.hidden = false;
    const margin = 10;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(actionMenuState.x, window.innerWidth - rect.width - margin);
    const top = Math.min(actionMenuState.y, window.innerHeight - rect.height - margin);
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.style.top = `${Math.max(margin, top)}px`;
  }

  function close() {
    if (menu.hidden) {
      return;
    }
    menu.hidden = true;
    resetActionMenuState();
  }

  function sync() {
    if (!actionMenuState.videoId) {
      return;
    }

    const video = getVideoById(actionMenuState.categoryId, actionMenuState.videoId);
    if (!video) {
      close();
      return;
    }

    render();
  }

  function handleOutsideEvent(event) {
    if (menu.hidden) {
      return;
    }
    if (event.target instanceof Node && menu.contains(event.target)) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(".video-card__action")) {
      return;
    }
    close();
  }

  return { open, close, sync, handleOutsideEvent, root: menu };
}
