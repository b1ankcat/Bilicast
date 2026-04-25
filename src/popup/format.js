export function formatTime(value) {
  const time = Math.max(0, Math.floor(value));
  const minutes = Math.floor(time / 60);
  const seconds = time % 60;
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    const mins = String(minutes % 60).padStart(2, "0");
    return `${hours}:${mins}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function buildExportFilename() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ];
  return `bilicast-playlist-${parts.join("")}.json`;
}

export function setTooltip(element, label) {
  if (!element) {
    return;
  }
  if (label) {
    element.dataset.tooltip = label;
    element.setAttribute("aria-label", label);
    element.title = label;
  } else {
    element.removeAttribute("data-tooltip");
    element.removeAttribute("aria-label");
    element.removeAttribute("title");
  }
}
