import { getCategoryById, moveVideoState, resetMoveVideoState, setMoveVideoTarget, state } from "./store.js";

export function mountMoveVideoDialog({ elements, actions, feedback }) {
  elements.moveVideoSelect?.addEventListener("change", () => {
    renderHint();
  });

  elements.confirmMoveVideoBtn?.addEventListener("click", async () => {
    const fromCategoryId = moveVideoState.fromCategoryId;
    const videoId = moveVideoState.videoId;
    const toCategoryId = elements.moveVideoSelect?.value;
    if (!fromCategoryId || !videoId || !toCategoryId) {
      feedback.show("请选择目标分类", true);
      return;
    }

    const result = await actions.moveVideo(fromCategoryId, toCategoryId, videoId);
    if (!result.ok) {
      feedback.show(result.message || "移动失败", true);
      return;
    }

    close();
    feedback.show("已移动视频");
  });

  elements.cancelMoveVideoBtn?.addEventListener("click", () => close());
  elements.moveVideoDialog?.addEventListener("click", (event) => {
    if (event.target === elements.moveVideoDialog) {
      close();
    }
  });

  function open(fromCategoryId, video) {
    if (!fromCategoryId || !video?.id) {
      feedback.show("缺少视频信息", true);
      return;
    }
    if (state.categories.length < 2) {
      feedback.show("至少需要两个分类才能移动", true);
      return;
    }

    setMoveVideoTarget({
      fromCategoryId,
      videoId: video.id,
      title: video.title || "该视频"
    });
    render();
  }

  function render() {
    if (!elements.moveVideoDialog || !elements.moveVideoSelect) {
      return;
    }

    const sourceCategory = getCategoryById(moveVideoState.fromCategoryId);
    const sourceVideo = sourceCategory?.videos?.find((video) => video.id === moveVideoState.videoId);
    const targetCategories = state.categories.filter((category) => category.id !== moveVideoState.fromCategoryId);
    if (!sourceCategory || !sourceVideo || !targetCategories.length) {
      close();
      return;
    }

    if (elements.moveVideoText) {
      elements.moveVideoText.textContent = `移动《${moveVideoState.title}》到`;
    }

    elements.moveVideoSelect.innerHTML = "";
    targetCategories.forEach((category, index) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = `${category.name} (${category.videos.length})`;
      option.selected = index === 0;
      elements.moveVideoSelect.appendChild(option);
    });

    renderHint();
    elements.moveVideoDialog.hidden = false;
  }

  function renderHint() {
    if (!elements.moveVideoSelect || !elements.moveVideoHint || !elements.confirmMoveVideoBtn) {
      return;
    }

    const targetCategory = getCategoryById(elements.moveVideoSelect.value);
    const hasSameVideo = Boolean(targetCategory?.videos?.some((video) => video.id === moveVideoState.videoId));
    elements.moveVideoHint.textContent = hasSameVideo
      ? "目标分类已有该视频，移动后会自动合并为一份"
      : "";
    elements.confirmMoveVideoBtn.disabled = !elements.moveVideoSelect.value;
  }

  function close(resetState = true) {
    if (!elements.moveVideoDialog || elements.moveVideoDialog.hidden) {
      if (resetState) {
        resetMoveVideoState();
      }
      return;
    }

    elements.moveVideoDialog.hidden = true;
    if (!resetState) {
      return;
    }

    resetMoveVideoState();
    if (elements.moveVideoSelect) {
      elements.moveVideoSelect.innerHTML = "";
    }
    if (elements.moveVideoHint) {
      elements.moveVideoHint.textContent = "";
    }
  }

  function isOpen() {
    return Boolean(elements.moveVideoDialog && !elements.moveVideoDialog.hidden);
  }

  return { open, render, close, isOpen };
}
