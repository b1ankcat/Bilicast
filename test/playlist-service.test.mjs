import test from "node:test";
import assert from "node:assert/strict";

import { deleteVideosFromState } from "../src/background/playlist-service.js";

function createState() {
  return {
    categories: {
      cat: {
        id: "cat",
        videos: [
          { id: "v1" },
          { id: "v2" },
          { id: "v3" }
        ]
      }
    },
    playback: {
      categoryId: "cat",
      videoId: "v2",
      status: "playing",
      progress: 12,
      duration: 40
    }
  };
}

test("deleteVideosFromState removes multiple videos atomically", () => {
  const state = createState();
  const result = deleteVideosFromState(state, { categoryId: "cat", videoIds: ["v1", "v3"] });

  assert.equal(result.ok, true);
  assert.equal(result.deletedCount, 2);
  assert.deepEqual(state.categories.cat.videos.map((video) => video.id), ["v2"]);
});

test("deleteVideosFromState rejects missing videos without partial mutation", () => {
  const state = createState();
  const result = deleteVideosFromState(state, { categoryId: "cat", videoIds: ["v1", "missing"] });

  assert.equal(result.ok, false);
  assert.deepEqual(state.categories.cat.videos.map((video) => video.id), ["v1", "v2", "v3"]);
});

test("deleteVideosFromState clears playback when current video is deleted", () => {
  const state = createState();
  const result = deleteVideosFromState(state, { categoryId: "cat", videoIds: ["v2"] });

  assert.equal(result.ok, true);
  assert.equal(result.shouldStopPlayback, true);
  assert.equal(state.playback.videoId, null);
  assert.equal(state.playback.status, "paused");
});
