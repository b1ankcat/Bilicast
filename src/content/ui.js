export const BUTTON_ID = "bilicast-add-button";
const STYLE_ID = "bilicast-style";

export function injectContentStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      border: 1px solid var(--brand_pink, #fb7299);
      color: var(--brand_pink, #fb7299);
      background: transparent;
      border-radius: 16px;
      padding: 4px 12px;
      font-size: 13px;
      cursor: pointer;
      margin-left: 8px;
      transition: all 0.2s ease;
      position: absolute;
      display: none;
      pointer-events: auto;
      z-index: 9999;
    }
    #${BUTTON_ID}:hover {
      background: var(--brand_pink, #fb7299);
      color: #fff;
    }
    .bilicast-popover {
      position: absolute;
      z-index: 9999;
      width: 260px;
      background: rgba(25, 25, 25, 0.95);
      color: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      padding: 12px;
      display: none;
      flex-direction: column;
      gap: 8px;
    }
    .bilicast-popover.is-visible {
      display: flex;
    }
    .bilicast-popover label {
      font-size: 12px;
      color: #ccc;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bilicast-popover select,
    .bilicast-popover input[type="text"] {
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      padding: 6px;
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
      font-size: 13px;
    }
    .bilicast-popover button {
      border-radius: 8px;
      border: none;
      padding: 6px 10px;
      font-size: 13px;
      cursor: pointer;
    }
    .bilicast-popover__actions {
      display: flex;
      gap: 8px;
    }
    .bilicast-popover__actions button {
      flex: 1;
      background: #fb7299;
      color: #fff;
    }
    .bilicast-popover button:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }
    .bilicast-popover__actions button:disabled {
      background: rgba(255, 255, 255, 0.18);
      color: rgba(255, 255, 255, 0.72);
    }
    .bilicast-popover__new {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .bilicast-popover__new input {
      flex: 1;
    }
    .bilicast-popover__new button {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .bilicast-popover__status {
      min-height: 16px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.88);
    }
    .bilicast-popover__status.is-empty {
      color: rgba(255, 255, 255, 0.56);
    }
    .bilicast-popover__message {
      font-size: 12px;
      min-height: 16px;
      color: #9fe870;
    }
    .bilicast-popover__message.is-error {
      color: #ffb3c1;
    }
    .bilicast-toast {
      position: fixed;
      top: 24px;
      right: 24px;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 10px 16px;
      border-radius: 8px;
      z-index: 99999;
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
      animation: bilicast-fade 3s forwards;
    }
    @keyframes bilicast-fade {
      0% { opacity: 0; transform: translateY(-6px); }
      15% { opacity: 1; transform: translateY(0); }
      85% { opacity: 1; }
      100% { opacity: 0; transform: translateY(-6px); }
    }
  `;
  document.head.appendChild(style);
}

export function createFloatingButton({ id, onClick }) {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.textContent = "加入到播放列表";
  button.style.display = "none";
  button.addEventListener("click", onClick);
  document.body.appendChild(button);
  return button;
}

export function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = "bilicast-toast";
  toast.textContent = message;
  if (isError) {
    toast.style.background = "rgba(255,87,115,0.95)";
  }
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3200);
}
