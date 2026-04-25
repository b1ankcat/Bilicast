export function isValidBvid(value) {
  return typeof value === "string" && /^BV[\w]+$/i.test(value.trim());
}

export function normalizePageIndex(value) {
  return Math.max(1, Number(value) || 1);
}

export function buildVideoUrl({ bvid, pageIndex = 1 }) {
  return `https://www.bilibili.com/video/${bvid}?p=${normalizePageIndex(pageIndex)}&t=0`;
}

export function buildVideoReferer(video) {
  if (!isValidBvid(video?.bvid)) {
    return null;
  }
  return buildVideoUrl({
    bvid: String(video.bvid).trim(),
    pageIndex: video.pageIndex
  });
}

export function normalizeVideoUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("t", "0");
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function sanitizeVideoUrlOrReferer(rawUrl) {
  try {
    const url = rawUrl ? new URL(rawUrl) : new URL("https://www.bilibili.com");
    url.hash = "";
    if (!url.searchParams.has("t")) {
      url.searchParams.set("t", "0");
    }
    return url.toString();
  } catch {
    return "https://www.bilibili.com";
  }
}

export function makeVideoId({ bvid, page = 1 }) {
  return `${bvid}-p${normalizePageIndex(page)}`;
}

export function normalizeCoverUrl(url) {
  if (!url) {
    return "";
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  return url;
}

export function isValidVideoPayload(video) {
  return Boolean(
    video
    && isValidBvid(video.bvid)
    && Number(video.pageIndex) >= 1
  );
}
