import { clearBulkSelection, bulkSelection, setBulkSelectionEnabled, state, syncBulkSelectionWithActiveCategory } from "./store.js";

export function mountPlaylistToolbar({ elements, actions, feedback, confirmDialog, categoryManager, requestRender }) {
  elements.categorySelect?.addEventListener("change", () => {
    const categoryId = elements.categorySelect.value;
    if (!categoryId) {
      setBulkSelectionEnabled(false);
      requestRender();
      return;
    }
    clearBulkSelection(categoryId);
    actions.selectCategory(categoryId).then(handleResult);
  });

  elements.manageCategoriesBtn?.addEventListener("click", () => {
    categoryManager.open();
  });

  elements.bulkToggle?.addEventListener("change", () => {
    setBulkSelectionEnabled(elements.bulkToggle.checked);
    syncBulkSelectionWithActiveCategory();
    requestRender();
  });

  elements.bulkDeleteBtn?.addEventListener("click", () => {
    if (!bulkSelection.enabled || !bulkSelection.ids.size) {
      feedback.show("请选择需要删除的视频", true);
      return;
    }
    if (!state.activeCategoryId) {
      feedback.show("请选择分类", true);
      return;
    }
    const count = bulkSelection.ids.size;
    confirmDialog.open(`确认删除选中的 ${count} 个视频吗？`, async () => {
      const result = await actions.deleteSelectedVideos(state.activeCategoryId, Array.from(bulkSelection.ids));
      if (!result.ok) {
        feedback.show(result.message || "删除失败", true);
        return;
      }
      clearBulkSelection(state.activeCategoryId);
      feedback.show("已删除选中视频");
      requestRender();
    });
  });

  elements.importBtn?.addEventListener("click", () => {
    if (!elements.importFileInput) {
      return;
    }
    elements.importFileInput.value = "";
    elements.importFileInput.click();
  });

  elements.exportBtn?.addEventListener("click", async () => {
    const result = await actions.exportPlaylist();
    if (!result.ok || !result.data) {
      feedback.show(result.message || "导出失败", true);
      return;
    }
    actions.downloadExportFile(result.data);
    feedback.show("已导出播放列表");
  });

  elements.importFileInput?.addEventListener("change", async () => {
    const file = elements.importFileInput.files?.[0];
    if (!file) {
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      feedback.show("导入文件不是有效的 JSON", true);
      return;
    }
    confirmDialog.open("导入将覆盖当前播放列表，确认继续吗？", async () => {
      const result = await actions.importPlaylist(data);
      if (!result.ok) {
        feedback.show(result.message || "导入失败", true);
        return;
      }
      feedback.show(`已导入 ${Number(result.categoryCount) || 0} 个分类 / ${Number(result.videoCount) || 0} 个视频`);
    });
  });

  function render() {
    renderCategories();
    updateBulkUI();
  }

  function renderCategories() {
    if (!elements.categorySelect) {
      return;
    }
    elements.categorySelect.innerHTML = "";
    state.categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = `${category.name} (${category.videos.length})`;
      if (category.id === state.activeCategoryId) {
        option.selected = true;
      }
      elements.categorySelect.appendChild(option);
    });
  }

  function updateBulkUI() {
    if (elements.bulkToggle) {
      elements.bulkToggle.checked = bulkSelection.enabled;
    }
    if (elements.bulkDeleteBtn) {
      elements.bulkDeleteBtn.disabled = !bulkSelection.enabled || bulkSelection.ids.size === 0;
    }
  }

  function handleResult(result) {
    if (!result?.ok) {
      feedback.show(result?.message || "操作失败", true);
      return;
    }
    requestRender();
  }

  return { render };
}
