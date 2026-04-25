export function deleteVideosFromState(state, payload = {}) {
  const categoryId = payload.categoryId;
  const requestedVideoIds = Array.isArray(payload.videoIds) ? payload.videoIds : [];
  const videoIds = Array.from(
    new Set(
      requestedVideoIds
        .filter((videoId) => typeof videoId === "string")
        .map((videoId) => videoId.trim())
        .filter(Boolean)
    )
  );

  if (!categoryId || !videoIds.length) {
    return { ok: false, message: "缺少分类或视频信息" };
  }

  const category = state.categories[categoryId];
  if (!category) {
    return { ok: false, message: "分类不存在" };
  }

  const existingVideoIds = new Set(category.videos.map((video) => video.id));
  const missingVideoId = videoIds.find((videoId) => !existingVideoIds.has(videoId));
  if (missingVideoId) {
    return { ok: false, message: "视频不存在" };
  }

  category.videos = category.videos.filter((video) => !videoIds.includes(video.id));

  const shouldStopPlayback = videoIds.includes(state.playback.videoId);
  if (shouldStopPlayback) {
    state.playback.categoryId = null;
    state.playback.videoId = null;
    state.playback.status = "paused";
    state.playback.progress = 0;
    state.playback.duration = 0;
  }

  return {
    ok: true,
    deletedCount: videoIds.length,
    shouldStopPlayback
  };
}

export function moveVideoBetweenCategories(state, payload = {}) {
  const fromCategoryId = payload.fromCategoryId;
  const toCategoryId = payload.toCategoryId;
  const videoId = payload.videoId;

  if (!fromCategoryId || !toCategoryId || !videoId) {
    return { ok: false, message: "移动参数无效" };
  }
  if (fromCategoryId === toCategoryId) {
    return { ok: false, message: "请选择其他分类" };
  }

  const sourceCategory = state.categories[fromCategoryId];
  const targetCategory = state.categories[toCategoryId];
  if (!sourceCategory || !targetCategory) {
    return { ok: false, message: "分类不存在" };
  }

  const sourceIndex = sourceCategory.videos.findIndex((video) => video.id === videoId);
  if (sourceIndex === -1) {
    return { ok: false, message: "视频不存在" };
  }

  const [movedVideo] = sourceCategory.videos.splice(sourceIndex, 1);
  targetCategory.videos = [movedVideo, ...targetCategory.videos.filter((video) => video.id !== videoId)];

  if (state.playback.videoId === videoId) {
    state.playback.categoryId = toCategoryId;
  }

  return {
    ok: true,
    video: movedVideo
  };
}
