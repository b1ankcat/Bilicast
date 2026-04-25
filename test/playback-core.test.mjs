import test from "node:test";
import assert from "node:assert/strict";

import { computeNextTrack } from "../src/background/playback-service.js";

function createState(mode = "list") {
  return {
    categoryOrder: ["a", "b"],
    activeCategoryId: "a",
    categories: {
      a: {
        id: "a",
        videos: [{ id: "v1" }, { id: "v2" }]
      },
      b: {
        id: "b",
        videos: [{ id: "v3" }]
      }
    },
    playback: {
      mode,
      categoryId: "a",
      videoId: "v1"
    }
  };
}

test("computeNextTrack loops single mode for autoplay", () => {
  const next = computeNextTrack(createState("single"), 1, { manual: false });
  assert.deepEqual(next, { categoryId: "a", videoId: "v1" });
});

test("computeNextTrack advances within list mode", () => {
  const next = computeNextTrack(createState("list"), 1, { manual: false });
  assert.deepEqual(next, { categoryId: "a", videoId: "v2" });
});

test("computeNextTrack crosses categories in all mode", () => {
  const state = createState("all");
  state.playback.videoId = "v2";
  const next = computeNextTrack(state, 1, { manual: false });
  assert.deepEqual(next, { categoryId: "b", videoId: "v3" });
});

test("computeNextTrack returns a valid alternative in shuffle mode", () => {
  const next = computeNextTrack(createState("shuffle"), 1, { manual: false });
  assert.ok(next);
  assert.notEqual(next.videoId, "");
});
