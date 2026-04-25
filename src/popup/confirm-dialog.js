export function mountConfirmDialog({ elements }) {
  let pendingAction = null;

  elements.deleteConfirmDialog?.addEventListener("click", (event) => {
    if (event.target === elements.deleteConfirmDialog) {
      close();
    }
  });

  elements.confirmDeleteBtn?.addEventListener("click", () => {
    const action = pendingAction;
    pendingAction = null;
    close(false);
    action?.();
  });

  elements.cancelDeleteBtn?.addEventListener("click", () => {
    pendingAction = null;
    close(false);
  });

  function open(message, action) {
    if (!elements.deleteConfirmDialog || !elements.deleteConfirmText) {
      return;
    }
    elements.deleteConfirmText.textContent = message || "确认执行该操作吗？";
    pendingAction = typeof action === "function" ? action : null;
    elements.deleteConfirmDialog.hidden = false;
  }

  function close(resetAction = true) {
    if (!elements.deleteConfirmDialog || elements.deleteConfirmDialog.hidden) {
      return;
    }
    if (resetAction) {
      pendingAction = null;
    }
    elements.deleteConfirmDialog.hidden = true;
  }

  function isOpen() {
    return Boolean(elements.deleteConfirmDialog && !elements.deleteConfirmDialog.hidden);
  }

  return { open, close, isOpen };
}
