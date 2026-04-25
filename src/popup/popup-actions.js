import { AUDIO_QUALITY_OPTIONS, MESSAGE, PLAYBACK_MODES } from "../shared/messages.js";
import { buildExportFilename } from "./format.js";
import { queryActiveTabVideo, sendRuntimeCommand } from "./runtime.js";
import { isCurrentPlaybackVideo, state } from "./store.js";

export function createPopupActions() {
  async function initialize() {
    try {
      const snapshot = await chrome.runtime.sendMessage({ type: MESSAGE.POPUP_INIT });
      if (!snapshot) {
        return { ok: false, message: "无法初始化" };
      }
      return { ok: true, snapshot };
    } catch (error) {
      return { ok: false, message: error?.message || "无法初始化" };
    }
  }

  function togglePlayback() {
    const action = state.playback.status === "playing" ? "pause" : "play";
    return sendRuntimeCommand({ type: MESSAGE.POPUP_CONTROL, payload: { action } }, "播放失败");
  }

  function previousTrack() {
    return sendRuntimeCommand(
      { type: MESSAGE.POPUP_CONTROL, payload: { action: "previous", manual: true } },
      "没有上一条"
    );
  }

  function nextTrack() {
    return sendRuntimeCommand(
      { type: MESSAGE.POPUP_CONTROL, payload: { action: "next", manual: true } },
      "没有下一条"
    );
  }

  function cyclePlaybackMode() {
    const ids = PLAYBACK_MODES.map((mode) => mode.id);
    const currentIndex = ids.indexOf(state.playback.mode);
    const nextMode = ids[(currentIndex + 1) % ids.length];
    return sendRuntimeCommand({ type: MESSAGE.POPUP_SET_MODE, payload: { mode: nextMode } }, "切换模式失败");
  }

  function seek(seconds) {
    return sendRuntimeCommand({ type: MESSAGE.POPUP_SEEK, payload: { seconds } }, "拖动时间无效");
  }

  function setVolume(volume) {
    return sendRuntimeCommand({ type: MESSAGE.POPUP_SET_VOLUME, payload: { volume } }, "音量调整失败");
  }

  function setAudioQuality(audioQuality) {
    const allowedIds = new Set(AUDIO_QUALITY_OPTIONS.map((option) => option.id));
    const nextAudioQuality = allowedIds.has(audioQuality) ? audioQuality : "auto";
    return sendRuntimeCommand(
      { type: MESSAGE.POPUP_SET_AUDIO_QUALITY, payload: { audioQuality: nextAudioQuality } },
      "音质切换失败"
    );
  }

  async function addCurrentVideo(categoryId) {
    const videoResult = await queryActiveTabVideo();
    if (!videoResult.ok) {
      return videoResult;
    }
    if (!categoryId) {
      return { ok: false, message: "请先选择分类" };
    }
    return sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_ADD_VIDEO,
        payload: { categoryId, video: videoResult.video }
      },
      "添加失败"
    );
  }

  function selectCategory(categoryId) {
    return sendRuntimeCommand({ type: MESSAGE.POPUP_SELECT_CATEGORY, payload: { categoryId } }, "切换失败");
  }

  function playVideo(categoryId, videoId) {
    return sendRuntimeCommand(
      {
        type: MESSAGE.POPUP_PLAY_VIDEO,
        payload: { categoryId, videoId }
      },
      "播放失败"
    );
  }

  function playOrToggleVideo(categoryId, videoId) {
    if (isCurrentPlaybackVideo(videoId)) {
      return togglePlayback();
    }
    return playVideo(categoryId, videoId);
  }

  function reorderVideos(categoryId, videoIds) {
    return sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_REORDER_VIDEOS,
        payload: { categoryId, videoIds }
      },
      "排序失败"
    );
  }

  function reorderCategories(categoryOrder) {
    return sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_REORDER_CATEGORIES,
        payload: { categoryOrder }
      },
      "分类排序失败"
    );
  }

  function createCategory(name) {
    return sendRuntimeCommand({ type: MESSAGE.PLAYLIST_CREATE_CATEGORY, payload: { name } }, "创建失败");
  }

  function renameCategory(categoryId, name) {
    return sendRuntimeCommand(
      { type: MESSAGE.PLAYLIST_RENAME_CATEGORY, payload: { categoryId, name } },
      "重命名失败"
    );
  }

  function deleteCategory(categoryId) {
    return sendRuntimeCommand(
      { type: MESSAGE.PLAYLIST_DELETE_CATEGORY, payload: { categoryId } },
      "删除失败"
    );
  }

  function deleteVideo(categoryId, videoId) {
    return sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_DELETE_VIDEO,
        payload: { categoryId, videoId }
      },
      "删除失败"
    );
  }

  function deleteSelectedVideos(categoryId, videoIds) {
    return sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_DELETE_VIDEOS,
        payload: { categoryId, videoIds }
      },
      "删除失败"
    );
  }

  function moveVideo(fromCategoryId, toCategoryId, videoId) {
    return sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_MOVE_VIDEO,
        payload: { fromCategoryId, toCategoryId, videoId }
      },
      "移动失败"
    );
  }

  function exportPlaylist() {
    return sendRuntimeCommand({ type: MESSAGE.PLAYLIST_EXPORT }, "导出失败");
  }

  function importPlaylist(data) {
    return sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_IMPORT,
        payload: { data }
      },
      "导入失败"
    );
  }

  async function openVideoPage(url) {
    if (!url) {
      return { ok: false, message: "未找到视频地址" };
    }
    try {
      await chrome.tabs.create({ url, active: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error?.message || "打开视频页失败" };
    }
  }

  function downloadExportFile(data) {
    const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = buildExportFilename();
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return { ok: true };
  }

  return {
    initialize,
    togglePlayback,
    previousTrack,
    nextTrack,
    cyclePlaybackMode,
    seek,
    setVolume,
    setAudioQuality,
    addCurrentVideo,
    selectCategory,
    playOrToggleVideo,
    reorderVideos,
    reorderCategories,
    createCategory,
    renameCategory,
    deleteCategory,
    deleteVideo,
    deleteSelectedVideos,
    moveVideo,
    exportPlaylist,
    importPlaylist,
    openVideoPage,
    downloadExportFile
  };
}
