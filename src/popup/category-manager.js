import { DEFAULT_CATEGORY_ID } from "../shared/playlist.js";
import {
  categoryManagerState,
  resetCategoryManagerDragState,
  startCategoryManagerDrag,
  state,
  updateCategoryManagerDragTarget
} from "./store.js";

export function mountCategoryManager({ actions, confirmDialog, elements, feedback, videoActionMenu }) {
  elements.closeCategoryManagerBtn?.addEventListener("click", () => close());
  elements.categoryManagerDialog?.addEventListener("click", (event) => {
    if (event.target === elements.categoryManagerDialog) {
      close();
    }
  });

  elements.managerCategoryConfirmBtn?.addEventListener("click", () => {
    createCategory();
  });
  elements.managerCategoryInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createCategory();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      elements.managerCategoryInput.blur();
    }
  });

  function open() {
    if (!elements.categoryManagerDialog) {
      return;
    }
    videoActionMenu.close();
    elements.categoryManagerDialog.hidden = false;
    render();
  }

  function close(resetState = true) {
    if (!elements.categoryManagerDialog || elements.categoryManagerDialog.hidden) {
      return;
    }
    elements.categoryManagerDialog.hidden = true;
    if (resetState) {
      resetCategoryManagerDragState();
    }
  }

  function isOpen() {
    return Boolean(elements.categoryManagerDialog && !elements.categoryManagerDialog.hidden);
  }

  function render() {
    if (!elements.categoryManagerList) {
      return;
    }

    elements.categoryManagerList.innerHTML = "";
    state.categories.forEach((category) => {
      elements.categoryManagerList.appendChild(createCategoryItem(category));
    });
  }

  function createCategoryItem(category) {
    const isDefault = category.id === DEFAULT_CATEGORY_ID;
    const item = document.createElement("div");
    item.className = "category-manager__item";
    item.dataset.categoryId = category.id;
    item.draggable = true;
    item.classList.add("is-draggable");

    if (categoryManagerState.overCategoryId === category.id && categoryManagerState.position) {
      item.classList.add(categoryManagerState.position === "before" ? "is-drop-before" : "is-drop-after");
    }
    if (categoryManagerState.dragCategoryId === category.id) {
      item.classList.add("is-dragging");
    }

    attachCategoryDragEvents(item, category.id);

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

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "category-manager__actions";
    if (!isDefault) {
      actionsWrap.appendChild(createSaveButton(category, nameInput));
      actionsWrap.appendChild(createDeleteButton(category));
    }
    item.appendChild(actionsWrap);

    return item;
  }

  function createSaveButton(category, nameInput) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "保存";
    syncRenameButtonState(button, nameInput, category.name);

    button.addEventListener("click", () => {
      renameCategory(category.id, nameInput.value, category.name);
    });
    nameInput.addEventListener("input", () => {
      syncRenameButtonState(button, nameInput, category.name);
    });
    nameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (!button.disabled) {
          renameCategory(category.id, nameInput.value, category.name);
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        nameInput.value = category.name;
        syncRenameButtonState(button, nameInput, category.name);
      }
    });

    return button;
  }

  function createDeleteButton(category) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-manager__delete";
    button.textContent = "删除";
    button.addEventListener("click", () => {
      confirmDialog.open(`确认删除《${category.name}》吗？`, async () => {
        const result = await actions.deleteCategory(category.id);
        if (!result.ok) {
          feedback.show(result.message || "删除失败", true);
          return;
        }
        feedback.show("已删除分类");
      });
    });
    return button;
  }

  async function createCategory() {
    const name = elements.managerCategoryInput?.value.trim();
    if (!name) {
      feedback.show("请输入分类名", true);
      return;
    }

    const result = await actions.createCategory(name);
    if (!result.ok) {
      feedback.show(result.message || "创建失败", true);
      return;
    }

    feedback.show("已创建分类");
    if (elements.managerCategoryInput) {
      elements.managerCategoryInput.value = "";
      elements.managerCategoryInput.focus();
    }
  }

  async function renameCategory(categoryId, nextName, originalName) {
    const trimmed = String(nextName || "").trim();
    if (!trimmed) {
      feedback.show("分类名称不能为空", true);
      return;
    }
    if (trimmed === originalName) {
      return;
    }

    const result = await actions.renameCategory(categoryId, trimmed);
    if (!result.ok) {
      feedback.show(result.message || "重命名失败", true);
      return;
    }

    feedback.show("已重命名分类");
  }

  function attachCategoryDragEvents(item, categoryId) {
    item.addEventListener("dragstart", (event) => {
      startCategoryManagerDrag(categoryId);
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
        updateCategoryManagerDragTarget(categoryId, position);
        updateCategoryDragIndicators();
      }
    });

    item.addEventListener("drop", async (event) => {
      event.preventDefault();
      if (!categoryManagerState.dragCategoryId || categoryManagerState.dragCategoryId === categoryId) {
        resetCategoryManagerDragState();
        updateCategoryDragIndicators();
        return;
      }

      const nextOrder = buildReorderedCategoryIds(
        categoryManagerState.dragCategoryId,
        categoryId,
        categoryManagerState.position || "after"
      );
      resetCategoryManagerDragState();
      updateCategoryDragIndicators();
      if (!nextOrder) {
        return;
      }

      const result = await actions.reorderCategories(nextOrder);
      if (!result.ok) {
        feedback.show(result.message || "分类排序失败", true);
        return;
      }
      feedback.show("已更新分类顺序");
    });

    item.addEventListener("dragend", () => {
      resetCategoryManagerDragState();
      updateCategoryDragIndicators();
    });
  }

  function updateCategoryDragIndicators() {
    const items = elements.categoryManagerList?.querySelectorAll(".category-manager__item") || [];
    items.forEach((item) => {
      const isDragging = item.dataset.categoryId === categoryManagerState.dragCategoryId;
      const isTarget = item.dataset.categoryId === categoryManagerState.overCategoryId;
      item.classList.toggle("is-dragging", isDragging);
      item.classList.toggle("is-drop-before", isTarget && categoryManagerState.position === "before");
      item.classList.toggle("is-drop-after", isTarget && categoryManagerState.position === "after");
    });
  }

  function buildReorderedCategoryIds(sourceCategoryId, targetCategoryId, position) {
    const orderedIds = (state.categoryOrder.length
      ? state.categoryOrder
      : state.categories.map((category) => category.id)).filter(Boolean);
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

  function syncRenameButtonState(button, input, originalName) {
    const trimmed = input.value.trim();
    button.disabled = !trimmed || trimmed === originalName;
  }

  return { open, close, render, isOpen };
}
