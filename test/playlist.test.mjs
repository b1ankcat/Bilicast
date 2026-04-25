import test from "node:test";
import assert from "node:assert/strict";

import { parsePortablePlaylist } from "../src/shared/playlist.js";

test("parsePortablePlaylist rejects invalid schema", () => {
  const result = parsePortablePlaylist({
    schema: "other",
    version: 1,
    categories: [{ name: "A", videos: [] }]
  });
  assert.equal(result.ok, false);
});

test("parsePortablePlaylist rejects invalid version", () => {
  const result = parsePortablePlaylist({
    schema: "bilicast.playlist",
    version: 999,
    categories: [{ name: "A", videos: [] }]
  });
  assert.equal(result.ok, false);
});

test("parsePortablePlaylist rejects empty category list", () => {
  const result = parsePortablePlaylist({
    schema: "bilicast.playlist",
    version: 1,
    categories: []
  });
  assert.equal(result.ok, false);
});

test("parsePortablePlaylist de-duplicates repeated videos", () => {
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
});
