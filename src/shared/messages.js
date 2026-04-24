export const MESSAGE = {
  POPUP_INIT: "popup:init",
  POPUP_SELECT_CATEGORY: "popup:selectCategory",
  POPUP_PLAY_VIDEO: "popup:playVideo",
  POPUP_CONTROL: "popup:control",
  POPUP_SEEK: "popup:seek",
  POPUP_SET_MODE: "popup:setMode",
  POPUP_SET_VOLUME: "popup:setVolume",
  POPUP_SET_AUDIO_QUALITY: "popup:setAudioQuality",
  POPUP_ADD_ACTIVE_VIDEO: "popup:addActiveVideo",

  PLAYLIST_GET_CATEGORIES: "playlist:getCategories",
  PLAYLIST_ADD_VIDEO: "playlist:addVideo",
  PLAYLIST_CREATE_CATEGORY: "playlist:createCategory",
  PLAYLIST_DELETE_CATEGORY: "playlist:deleteCategory",
  PLAYLIST_DELETE_VIDEO: "playlist:deleteVideo",
  PLAYLIST_REORDER_VIDEOS: "playlist:reorderVideos",
  PLAYLIST_EXPORT: "playlist:export",
  PLAYLIST_IMPORT: "playlist:import",

  STORAGE_PUSH: "storage:push",
  POPUP_FEEDBACK: "popup:feedback",

  OFFSCREEN_READY: "offscreen:ready",
  OFFSCREEN_LOAD: "offscreen:load",
  OFFSCREEN_CONTROL: "offscreen:control",
  OFFSCREEN_STATE: "offscreen:state",
  OFFSCREEN_ENDED: "offscreen:ended",
  OFFSCREEN_SOURCE_FAILED: "offscreen:sourceFailed",

  CONTENT_REQUEST_VIDEO_INFO: "content:requestVideoInfo"
};

export const PLAYBACK_MODES = [
  { id: "single", label: "单曲循环" },
  { id: "list", label: "列表循环" },
  { id: "all", label: "全部循环" },
  { id: "shuffle", label: "随机" }
];

export const AUDIO_QUALITY_OPTIONS = [
  { id: "auto", label: "智能" },
  { id: "high", label: "高音质" },
  { id: "standard", label: "均衡" },
  { id: "low", label: "省流" }
];

export const DEFAULT_CATEGORY_NAME = "稍后播放";
