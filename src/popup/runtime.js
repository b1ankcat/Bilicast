import { MESSAGE } from "../shared/messages.js";
import { isValidVideoPayload } from "../shared/video.js";

export async function sendRuntimeCommand(message, fallbackMessage) {
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

export async function queryActiveTabVideo() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab) {
      return { ok: false, message: "未找到活动标签页" };
    }

    if (tab.url) {
      const url = new URL(tab.url);
      if (url.hostname !== "www.bilibili.com") {
        return { ok: false, message: "当前页不是 B 站页面" };
      }
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: MESSAGE.CONTENT_REQUEST_VIDEO_INFO });
    if (!response?.ok || !isValidVideoPayload(response.video)) {
      return { ok: false, message: response?.message || "无法获取视频信息" };
    }
    return { ok: true, video: response.video };
  } catch (error) {
    return { ok: false, message: error?.message || "无法获取视频信息" };
  }
}
