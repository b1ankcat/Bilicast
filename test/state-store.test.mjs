import test from "node:test";
import assert from "node:assert/strict";

import { hydrateState } from "../src/background/state-store.js";
import { DEFAULT_CATEGORY_ID, STATE_VERSION } from "../src/shared/playlist.js";

test("hydrateState migrates legacy state to current version", () => {
  const state = hydrateState({
    categories: {
      [DEFAULT_CATEGORY_ID]: {
        id: DEFAULT_CATEGORY_ID,
        name: "稍后播放",
        videos: []
      }
    },
    categoryOrder: [DEFAULT_CATEGORY_ID],
    activeCategoryId: DEFAULT_CATEGORY_ID,
    playback: {
      mode: "list",
      status: "paused"
    }
  });

  assert.equal(state.stateVersion, STATE_VERSION);
  assert.equal(state.playback.lastResolvedAt, 0);
  assert.deepEqual(state.categoryOrder, [DEFAULT_CATEGORY_ID]);
});
