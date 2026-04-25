export function computeNextTrack(state, direction, options = {}) {
  const manual = Boolean(options.manual);
  const playableCategories = state.categoryOrder
    .map((id) => state.categories[id])
    .filter((category) => category && category.videos.length);

  if (!playableCategories.length) {
    return null;
  }

  let mode = state.playback.mode || "list";
  if (manual && mode === "single") {
    mode = "list";
  }

  const currentCategoryId = state.playback.categoryId || state.activeCategoryId || playableCategories[0].id;
  const currentCategory = state.categories[currentCategoryId] || playableCategories[0];

  if (mode === "single" && state.playback.videoId) {
    return { categoryId: currentCategoryId, videoId: state.playback.videoId };
  }

  if (mode === "shuffle") {
    const pool = playableCategories.flatMap((category) =>
      category.videos.map((video) => ({ categoryId: category.id, videoId: video.id }))
    );
    if (!pool.length) {
      return null;
    }
    if (pool.length === 1) {
      return pool[0];
    }
    let candidate = pool[Math.floor(Math.random() * pool.length)];
    if (state.playback.videoId) {
      let attempts = 0;
      while (candidate.videoId === state.playback.videoId && attempts < 5) {
        candidate = pool[Math.floor(Math.random() * pool.length)];
        attempts += 1;
      }
    }
    return candidate;
  }

  const loopWithinCategory = mode === "list" || (manual && mode === "single");
  const withinCategory = cycleWithinCategory(currentCategory, state.playback.videoId, direction, loopWithinCategory);
  if (withinCategory) {
    return withinCategory;
  }

  if (mode === "list") {
    return null;
  }

  const currentIndex = playableCategories.findIndex((category) => category.id === currentCategory.id);
  if (currentIndex === -1) {
    return { categoryId: playableCategories[0].id, videoId: playableCategories[0].videos[0].id };
  }

  const nextIndex = (currentIndex + direction + playableCategories.length) % playableCategories.length;
  const nextCategory = playableCategories[nextIndex];
  const nextVideo = nextCategory.videos[direction > 0 ? 0 : nextCategory.videos.length - 1];
  return { categoryId: nextCategory.id, videoId: nextVideo.id };
}

export function cycleWithinCategory(category, currentVideoId, direction, loop) {
  if (!category || !category.videos.length) {
    return null;
  }

  const currentIndex = category.videos.findIndex((video) => video.id === currentVideoId);
  if (currentIndex === -1) {
    return {
      categoryId: category.id,
      videoId: category.videos[direction > 0 ? 0 : category.videos.length - 1].id
    };
  }

  let nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= category.videos.length) {
    if (!loop) {
      return null;
    }
    nextIndex = (nextIndex + category.videos.length) % category.videos.length;
  }

  return { categoryId: category.id, videoId: category.videos[nextIndex].id };
}
