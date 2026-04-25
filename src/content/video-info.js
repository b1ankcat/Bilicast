import { buildVideoUrl, isValidBvid, normalizeCoverUrl, normalizePageIndex } from "../shared/video.js";

const TITLE_SELECTORS = [
  ".video-title",
  ".media-title",
  ".media-info-title",
  "h1[data-title]"
];

const AUTHOR_SELECTORS = [
  ".up-info .name",
  ".up-detail .up-name",
  ".media-right .author"
];

export function collectVideoInfo() {
  const bvid = extractBvid();
  if (!bvid) {
    return null;
  }

  const url = new URL(location.href);
  const pageIndex = normalizePageIndex(url.searchParams.get("p"));
  return {
    bvid,
    title: extractTitle(),
    author: extractAuthor(),
    cover: normalizeCoverUrl(document.querySelector('meta[property="og:image"]')?.content || ""),
    duration: parseDuration(
      document.querySelector('meta[itemprop="duration"]')?.content
      || document.querySelector(".video-page-info .length")?.textContent
    ),
    pageIndex,
    url: buildVideoUrl({ bvid, pageIndex })
  };
}

function extractBvid() {
  const pathMatch = /\/video\/(BV[\w]+)/i.exec(location.pathname);
  if (pathMatch) {
    return pathMatch[1];
  }

  try {
    const url = new URL(location.href);
    const queryBvid = url.searchParams.get("bvid");
    if (isValidBvid(queryBvid)) {
      return queryBvid.trim();
    }
  } catch {}

  const dataBvid = document.querySelector("[data-bvid]")?.getAttribute("data-bvid");
  if (isValidBvid(dataBvid)) {
    return dataBvid.trim();
  }
  return null;
}

function extractTitle() {
  for (const selector of TITLE_SELECTORS) {
    const element = document.querySelector(selector);
    const text = selector === "h1[data-title]"
      ? element?.getAttribute("data-title")
      : element?.textContent;
    if (text?.trim()) {
      return text.trim();
    }
  }
  return document.title.replace(/_哔哩哔哩.*/, "").trim();
}

function extractAuthor() {
  for (const selector of AUTHOR_SELECTORS) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text) {
      return text;
    }
  }
  return "B 站创作者";
}

function parseDuration(input) {
  if (!input) {
    return 0;
  }
  if (input.startsWith("PT")) {
    const hours = Number(/([0-9]+)H/.exec(input)?.[1] || 0);
    const minutes = Number(/([0-9]+)M/.exec(input)?.[1] || 0);
    const seconds = Number(/([0-9]+)S/.exec(input)?.[1] || 0);
    return hours * 3600 + minutes * 60 + seconds;
  }
  if (/^[0-9]+:[0-9]+/.test(input)) {
    return input
      .split(":")
      .map((part) => Number(part))
      .reduce((total, value) => total * 60 + value, 0);
  }
  return 0;
}
