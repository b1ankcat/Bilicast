import { createDefaultState, DEFAULT_CATEGORY_ID, STATE_VERSION } from "../shared/playlist.js";

const PLAYBACK_RUNTIME_PERSIST_DELAY = 1000;

export function deepClone(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function hydrateState(raw) {
  const defaults = createDefaultState();
  const rawCategories = isPlainObject(raw?.categories) ? raw.categories : {};
  const categoryEntries = Object.entries(rawCategories)
    .filter(([id, category]) => id && category && typeof category === "object")
    .map(([id, category]) => [id, hydrateCategory(id, category)]);

  const categories = Object.fromEntries(categoryEntries);
  if (!Object.keys(categories).length) {
    categories[DEFAULT_CATEGORY_ID] = defaults.categories[DEFAULT_CATEGORY_ID];
  }

  const seen = new Set();
  const categoryOrder = Array.isArray(raw?.categoryOrder)
    ? raw.categoryOrder.filter((id) => {
      if (!categories[id] || seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    })
    : [];

  Object.keys(categories).forEach((id) => {
    if (!seen.has(id)) {
      seen.add(id);
      categoryOrder.push(id);
    }
  });

  const playback = {
    ...defaults.playback,
    ...(isPlainObject(raw?.playback) ? raw.playback : {})
  };

  return {
    stateVersion: STATE_VERSION,
    categories,
    categoryOrder,
    activeCategoryId: categories[raw?.activeCategoryId] ? raw.activeCategoryId : categoryOrder[0] || DEFAULT_CATEGORY_ID,
    playback
  };
}

export function createStateStore({ storage, storageKey, onStateChange }) {
  let cachedState = null;
  let persistTimer = null;
  let persistPromise = Promise.resolve();

  async function ensureState() {
    if (cachedState) {
      return cachedState;
    }

    const stored = await storage.get(storageKey);
    if (!stored[storageKey]) {
      cachedState = createDefaultState();
      await storage.set({ [storageKey]: cachedState });
      return cachedState;
    }

    cachedState = hydrateState(stored[storageKey]);
    if (stored[storageKey]?.stateVersion !== cachedState.stateVersion) {
      await storage.set({ [storageKey]: cachedState });
    }
    return cachedState;
  }

  async function setState(nextState) {
    clearPendingPersist();
    cachedState = hydrateState(nextState);
    await storage.set({ [storageKey]: cachedState });
    await notifyStateChange();
    return cachedState;
  }

  async function mutateState(mutator) {
    const working = deepClone(await ensureState());
    const result = (await mutator(working)) || working;
    return setState(result);
  }

  async function updatePlaybackRuntime(partial, options = {}) {
    const state = cachedState || (await ensureState());
    state.playback = {
      ...state.playback,
      ...Object.fromEntries(Object.entries(partial).filter(([, value]) => typeof value !== "undefined")),
      updatedAt: Date.now()
    };
    cachedState = hydrateState(state);
    if (options.immediate) {
      await persistPlaybackRuntime();
    } else {
      schedulePersist();
    }
    await notifyStateChange();
    return cachedState;
  }

  function getCachedState() {
    return cachedState;
  }

  function schedulePersist() {
    clearPendingPersist();
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistPromise = persistPlaybackRuntime().catch(() => {});
    }, PLAYBACK_RUNTIME_PERSIST_DELAY);
  }

  function clearPendingPersist() {
    if (!persistTimer) {
      return;
    }
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  async function persistPlaybackRuntime() {
    if (!cachedState) {
      return;
    }
    await storage.set({ [storageKey]: cachedState });
  }

  async function flushPendingPersist() {
    clearPendingPersist();
    await persistPromise;
    await persistPlaybackRuntime();
  }

  async function notifyStateChange() {
    if (typeof onStateChange === "function") {
      await onStateChange(cachedState);
    }
  }

  return {
    ensureState,
    setState,
    mutateState,
    updatePlaybackRuntime,
    getCachedState,
    flushPendingPersist
  };
}

function hydrateCategory(id, category) {
  return {
    id,
    name: String(category?.name || "").trim() || defaultsForCategoryName(id),
    createdAt: Number(category?.createdAt) || Date.now(),
    videos: Array.isArray(category?.videos) ? category.videos : []
  };
}

function defaultsForCategoryName(id) {
  return id === DEFAULT_CATEGORY_ID ? "稍后播放" : "未命名分类";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
