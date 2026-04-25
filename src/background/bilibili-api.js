import { fail, messageFromError, ok } from "../shared/result.js";

const API_HEADERS = {
  Referer: "https://www.bilibili.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
};

export async function fetchVideoMeta(bvid) {
  try {
    const endpoint = new URL("https://api.bilibili.com/x/web-interface/view");
    endpoint.searchParams.set("bvid", bvid);
    const response = await fetch(endpoint.toString(), { headers: API_HEADERS });
    const json = await response.json();
    if (json.code !== 0) {
      return fail(json.message || "获取视频信息失败");
    }
    return ok({
      meta: {
        cid: json.data?.cid,
        duration: json.data?.duration
      }
    });
  } catch (error) {
    return fail(messageFromError(error, "获取视频信息失败"));
  }
}

export async function fetchAudioStream(bvid, cid, qualityPreference = "auto") {
  try {
    const endpoint = new URL("https://api.bilibili.com/x/player/playurl");
    endpoint.searchParams.set("bvid", bvid);
    if (cid) {
      endpoint.searchParams.set("cid", cid);
    }
    endpoint.searchParams.set("fnval", "16");
    endpoint.searchParams.set("fnver", "0");
    endpoint.searchParams.set("fourk", "0");

    const response = await fetch(endpoint.toString(), { headers: API_HEADERS });
    const json = await response.json();
    if (json.code !== 0) {
      return fail(json.message || "获取播放地址失败");
    }

    const data = json.data || {};
    const dash = data.dash || {};
    const tracks = [];
    const dashAudios = [
      ...(Array.isArray(dash.audio) ? dash.audio : []),
      ...(Array.isArray(dash.dolby?.audio) ? dash.dolby.audio : []),
      ...(Array.isArray(dash.flac?.audio) ? dash.flac.audio : [])
    ];

    for (const track of dashAudios) {
      const urls = collectTrackUrls(track?.baseUrl, track?.backupUrl);
      if (!urls.length) {
        continue;
      }
      tracks.push({
        urls,
        bandwidth: Number(track?.bandwidth) || Number(track?.bandWidth) || 0,
        qualityId: Number(track?.id) || 0,
        source: resolveTrackSource(track?.codecs)
      });
    }

    if (Array.isArray(data.durl)) {
      for (const segment of data.durl) {
        const urls = collectTrackUrls(segment?.url, segment?.backup_url);
        if (!urls.length) {
          continue;
        }
        tracks.push({
          urls,
          bandwidth: Number(segment?.size) || 0,
          qualityId: 0,
          source: "durl"
        });
      }
    }

    const urls = flattenSortedTrackUrls(tracks, qualityPreference);
    const audioUrl = urls[0];
    if (!audioUrl) {
      return fail("未找到音频流");
    }

    const duration = dash.duration || (data.durl?.[0]?.length ? data.durl[0].length / 1000 : undefined);
    return ok({
      stream: {
        audioUrl,
        audioUrls: urls,
        duration
      }
    });
  } catch (error) {
    return fail(messageFromError(error, "获取播放地址失败"));
  }
}

function collectTrackUrls(primaryUrl, backupUrls) {
  const urls = [];
  const seen = new Set();

  const append = (value) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    urls.push(trimmed);
  };

  append(primaryUrl);
  if (Array.isArray(backupUrls)) {
    backupUrls.forEach(append);
  }

  return urls;
}

function flattenSortedTrackUrls(tracks, qualityPreference) {
  if (!tracks.length) {
    return [];
  }

  const sortedTracks = sortAudioTracks(tracks, qualityPreference);
  const urls = [];
  const seen = new Set();

  sortedTracks.forEach((track) => {
    track.urls.forEach((url) => {
      if (seen.has(url)) {
        return;
      }
      seen.add(url);
      urls.push(url);
    });
  });

  return urls;
}

function sortAudioTracks(tracks, qualityPreference) {
  const bandwidths = tracks
    .filter((track) => track.bandwidth > 0)
    .map((track) => track.bandwidth)
    .sort((left, right) => left - right);
  const minBandwidth = bandwidths[0] || 0;
  const maxBandwidth = bandwidths[bandwidths.length - 1] || 0;
  const medianBandwidth = bandwidths.length ? bandwidths[Math.floor((bandwidths.length - 1) / 2)] : 0;
  const targetBandwidth = qualityPreference === "low"
    ? minBandwidth
    : qualityPreference === "standard"
      ? medianBandwidth
      : maxBandwidth;

  return [...tracks].sort((left, right) => {
    const sourceScore = getTrackSourceScore(left.source, qualityPreference) - getTrackSourceScore(right.source, qualityPreference);
    if (sourceScore !== 0) {
      return sourceScore;
    }

    if (qualityPreference === "low") {
      if (left.bandwidth !== right.bandwidth) {
        return left.bandwidth - right.bandwidth;
      }
    } else if (qualityPreference === "standard") {
      const leftDistance = Math.abs((left.bandwidth || targetBandwidth) - targetBandwidth);
      const rightDistance = Math.abs((right.bandwidth || targetBandwidth) - targetBandwidth);
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      if (left.bandwidth !== right.bandwidth) {
        return right.bandwidth - left.bandwidth;
      }
    } else if (left.bandwidth !== right.bandwidth) {
      return right.bandwidth - left.bandwidth;
    }

    if (left.qualityId !== right.qualityId) {
      return right.qualityId - left.qualityId;
    }
    return 0;
  });
}

function getTrackSourceScore(source, qualityPreference) {
  if (qualityPreference === "low") {
    if (source === "durl") return 0;
    if (source === "dash") return 1;
    if (source === "dolby") return 2;
    if (source === "flac") return 3;
    return 4;
  }

  if (source === "flac") return 0;
  if (source === "dolby") return 1;
  if (source === "dash") return 2;
  if (source === "durl") return 3;
  return 4;
}

function resolveTrackSource(codec) {
  const normalized = String(codec || "").toLowerCase();
  if (normalized.includes("flac")) {
    return "flac";
  }
  if (normalized.includes("ec-3")) {
    return "dolby";
  }
  return "dash";
}
