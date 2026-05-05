const PAGE_ANCHOR_SELECTORS = {
  video: [
    ".video-toolbar-left .video-toolbar-left-main > .toolbar-left-item-wrap:nth-child(4)",
    ".video-toolbar-left .video-toolbar-left-main > .toolbar-left-item-wrap:last-child",
  ],
  list: [
    ".video-toolbar-left .video-toolbar-left-main > .toolbar-left-item-wrap:nth-child(4)",
    ".video-toolbar-left .video-toolbar-left-main > .toolbar-left-item-wrap:last-child",
  ]
};

export function detectPageKind() {
  if (/^\/list\//.test(location.pathname)) {
    return "list";
  }
  return "video";
}

export function findToolbarAnchor() {
  const selectors = PAGE_ANCHOR_SELECTORS[detectPageKind()] || PAGE_ANCHOR_SELECTORS.video;
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
}
