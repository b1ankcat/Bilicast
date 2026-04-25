import assert from "node:assert/strict";

import { computeNextTrack } from "../src/background/playback-service.js";
import { deleteVideosFromState } from "../src/background/playlist-service.js";
import { hydrateState } from "../src/background/state-store.js";
import {
  DEFAULT_CATEGORY_ID,
  STATE_VERSION,
  createVideoEntry,
  parsePortablePlaylist
} from "../src/shared/playlist.js";
import { fail, isFailure, messageFromError, ok } from "../src/shared/result.js";
import {
  buildVideoReferer,
  buildVideoUrl,
  isValidVideoPayload,
  sanitizeVideoUrlOrReferer
} from "../src/shared/video.js";

const tests = [
  {
    name: "parsePortablePlaylist rejects invalid schema",
    run() {
      const result = parsePortablePlaylist({
        schema: "other",
        version: 1,
        categories: [{ name: "A", videos: [] }]
      });
      assert.equal(result.ok, false);
    }
  },
  {
    name: "parsePortablePlaylist rejects invalid version",
    run() {
      const result = parsePortablePlaylist({
        schema: "bilicast.playlist",
        version: 999,
        categories: [{ name: "A", videos: [] }]
      });
      assert.equal(result.ok, false);
    }
  },
  {
    name: "parsePortablePlaylist rejects empty category list",
    run() {
      const result = parsePortablePlaylist({
        schema: "bilicast.playlist",
        version: 1,
        categories: []
      });
      assert.equal(result.ok, false);
    }
  },
  {
    name: "parsePortablePlaylist de-duplicates repeated videos",
    run() {
      const result = parsePortablePlaylist({
        schema: "bilicast.playlist",
        version: 1,
        categories: [
          {
            name: "收藏",
            videos: [
              { bvid: "BV1xx411c7mD", page: 1, title: "A" },
              { bvid: "BV1xx411c7mD", page: 1, title: "B" }
            ]
          }
        ]
      });
      assert.equal(result.ok, true);
      assert.equal(result.data.categories[0].videos.length, 1);
    }
  },
  {
    name: "computeNextTrack loops single mode for autoplay",
    run() {
      const next = computeNextTrack(createPlaybackState("single"), 1, { manual: false });
      assert.deepEqual(next, { categoryId: "a", videoId: "v1" });
    }
  },
  {
    name: "computeNextTrack advances within list mode",
    run() {
      const next = computeNextTrack(createPlaybackState("list"), 1, { manual: false });
      assert.deepEqual(next, { categoryId: "a", videoId: "v2" });
    }
  },
  {
    name: "computeNextTrack crosses categories in all mode",
    run() {
      const state = createPlaybackState("all");
      state.playback.videoId = "v2";
      const next = computeNextTrack(state, 1, { manual: false });
      assert.deepEqual(next, { categoryId: "b", videoId: "v3" });
    }
  },
  {
    name: "computeNextTrack returns a valid alternative in shuffle mode",
    run() {
      const next = computeNextTrack(createPlaybackState("shuffle"), 1, { manual: false });
      assert.ok(next);
      assert.ok(next.videoId);
    }
  },
  {
    name: "deleteVideosFromState removes multiple videos atomically",
    run() {
      const state = createPlaylistState();
      const result = deleteVideosFromState(state, { categoryId: "cat", videoIds: ["v1", "v3"] });
      assert.equal(result.ok, true);
      assert.equal(result.deletedCount, 2);
      assert.deepEqual(state.categories.cat.videos.map((video) => video.id), ["v2"]);
    }
  },
  {
    name: "deleteVideosFromState rejects missing videos without partial mutation",
    run() {
      const state = createPlaylistState();
      const result = deleteVideosFromState(state, { categoryId: "cat", videoIds: ["v1", "missing"] });
      assert.equal(result.ok, false);
      assert.deepEqual(state.categories.cat.videos.map((video) => video.id), ["v1", "v2", "v3"]);
    }
  },
  {
    name: "deleteVideosFromState clears playback when current video is deleted",
    run() {
      const state = createPlaylistState();
      const result = deleteVideosFromState(state, { categoryId: "cat", videoIds: ["v2"] });
      assert.equal(result.ok, true);
      assert.equal(result.shouldStopPlayback, true);
      assert.equal(state.playback.videoId, null);
      assert.equal(state.playback.status, "paused");
    }
  },
  {
    name: "hydrateState migrates legacy state to current version",
    run() {
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
    }
  },
  {
    name: "result helpers preserve response contract",
    run() {
      assert.deepEqual(ok({ value: 1 }), { ok: true, value: 1 });
      assert.deepEqual(fail("bad", { code: 400 }), { ok: false, message: "bad", code: 400 });
      assert.equal(isFailure({ ok: false }), true);
      assert.equal(isFailure({ ok: true }), false);
      assert.equal(messageFromError(new Error("boom"), "fallback"), "boom");
      assert.equal(messageFromError("direct", "fallback"), "direct");
      assert.equal(messageFromError(null, "fallback"), "fallback");
    }
  },
  {
    name: "isValidVideoPayload validates required fields",
    run() {
      assert.equal(isValidVideoPayload({ bvid: "BV1xx411c7mD", pageIndex: 1 }), true);
      assert.equal(isValidVideoPayload({ bvid: "av123", pageIndex: 1 }), false);
      assert.equal(isValidVideoPayload({ bvid: "BV1xx411c7mD" }), false);
    }
  },
  {
    name: "video URL helpers normalize bilibili URLs",
    run() {
      assert.equal(
        buildVideoUrl({ bvid: "BV1xx411c7mD", pageIndex: 2 }),
        "https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=0"
      );
      assert.equal(
        buildVideoReferer({ bvid: "BV1xx411c7mD", pageIndex: 3 }),
        "https://www.bilibili.com/video/BV1xx411c7mD?p=3&t=0"
      );
      assert.equal(
        sanitizeVideoUrlOrReferer("https://www.bilibili.com/video/BV1xx411c7mD?p=2#part"),
        "https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=0"
      );
    }
  },
  {
    name: "createVideoEntry normalizes id url and pageIndex",
    run() {
      const entry = createVideoEntry({
        bvid: "BV1xx411c7mD",
        pageIndex: 0,
        title: "Demo"
      });
      assert.equal(entry.id, "BV1xx411c7mD-p1");
      assert.equal(entry.pageIndex, 1);
      assert.equal(entry.url, "https://www.bilibili.com/video/BV1xx411c7mD?p=1&t=0");
    }
  }
];

let failures = 0;
for (const test of tests) {
  try {
    await test.run();
    console.log(`PASS ${test.name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${test.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}

function createPlaybackState(mode = "list") {
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

function createPlaylistState() {
  return {
    categories: {
      cat: {
        id: "cat",
        videos: [{ id: "v1" }, { id: "v2" }, { id: "v3" }]
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
