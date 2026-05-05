import { findToolbarAnchor } from "./page-anchor.js";
import { createPlaylistPopover } from "./playlist-popover.js";
import { injectContentStyles, createFloatingButton, BUTTON_ID, showToast } from "./ui.js";
import { collectVideoInfo } from "./video-info.js";

export function initContentShell({ MESSAGE }) {
  const popover = createPlaylistPopover({ MESSAGE, buttonId: BUTTON_ID });
  const actionButton = createFloatingButton({
    id: BUTTON_ID,
    onClick(event) {
      event.stopPropagation();
      const video = collectVideoInfo();
      if (!video) {
        showToast("未找到视频信息", true);
        return;
      }
      popover.open(actionButton, video);
    }
  });

  let anchorElement = null;
  let resizeObserver = null;
  let scheduledFrame = 0;
  let lastUrl = location.href;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== MESSAGE.CONTENT_REQUEST_VIDEO_INFO) {
      return false;
    }

    const video = collectVideoInfo();
    if (video) {
      sendResponse({ ok: true, video });
    } else {
      sendResponse({ ok: false, message: "未找到视频信息" });
    }
    return false;
  });

  injectContentStyles();
  observeDomChanges();
  observeRouteChanges();
  window.addEventListener("scroll", scheduleLayoutUpdate, { passive: true });
  window.addEventListener("resize", scheduleLayoutUpdate, { passive: true });
  scheduleLayoutUpdate();

  function observeDomChanges() {
    const observer = new MutationObserver(() => {
      scheduleLayoutUpdate();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function observeRouteChanges() {
    ["pushState", "replaceState"].forEach((name) => {
      const original = history[name];
      history[name] = function wrappedHistoryMethod(...args) {
        const result = original.apply(this, args);
        handleRouteChange();
        return result;
      };
    });
    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("hashchange", handleRouteChange);
  }

  function handleRouteChange() {
    if (lastUrl === location.href) {
      return;
    }
    lastUrl = location.href;
    popover.hide();
    scheduleLayoutUpdate();
  }

  function scheduleLayoutUpdate() {
    if (scheduledFrame) {
      return;
    }
    scheduledFrame = requestAnimationFrame(() => {
      scheduledFrame = 0;
      refreshAnchorAndPosition();
    });
  }

  function refreshAnchorAndPosition() {
    const video = collectVideoInfo();
    const nextAnchor = video ? findToolbarAnchor() : null;
    if (!nextAnchor) {
      hideFloatingButton();
      return;
    }

    // Hide button when toolbar has scrolled out of viewport
    const anchorRect = nextAnchor.getBoundingClientRect();
    if (anchorRect.bottom < 0) {
      hideFloatingButton();
      return;
    }

    if (anchorElement !== nextAnchor) {
      anchorElement = nextAnchor;
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => scheduleLayoutUpdate());
      }
      resizeObserver.disconnect();
      resizeObserver.observe(anchorElement);
    }

    showFloatingButton();
    positionButton();
  }

  function showFloatingButton() {
    actionButton.style.display = "inline-flex";
  }

  function hideFloatingButton() {
    actionButton.style.display = "none";
    popover.hide();
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    anchorElement = null;
  }

  function positionButton() {
    if (!anchorElement || actionButton.style.display === "none") {
      return;
    }

    const rect = anchorElement.getBoundingClientRect();
    const buttonHeight = actionButton.offsetHeight || 28;
    const buttonWidth = actionButton.offsetWidth || 120;
    const offset = 16;
    const top = window.scrollY + rect.top + rect.height / 2 - buttonHeight / 2;
    let left = window.scrollX + rect.right + offset;

    if (left + buttonWidth > window.scrollX + window.innerWidth - 12) {
      left = Math.max(window.scrollX + 12, window.scrollX + rect.left - buttonWidth - offset);
    }

    actionButton.style.top = `${Math.max(window.scrollY + 8, top)}px`;
    actionButton.style.left = `${left}px`;
  }
}
