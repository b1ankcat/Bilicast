import { AUDIO_QUALITY_OPTIONS, PLAYBACK_MODES } from "../shared/messages.js";
import { formatTime, setTooltip } from "./format.js";
import { state } from "./store.js";

const MODE_ICONS = {
  single: "\uD83D\uDD02",
  list: "\uD83D\uDD01",
  all: "\uD83D\uDD04",
  shuffle: "\uD83D\uDD00"
};

export function mountPlaybackBar({ elements, actions, feedback }) {
  let seeking = false;

  setTooltip(elements.prevBtn, "上一条");
  setTooltip(elements.nextBtn, "下一条");
  setTooltip(elements.addCurrentBtn, "添加当前页视频");
  setTooltip(elements.playBtn, "播放");

  renderAudioQualityOptions();

  elements.progressEl?.addEventListener("input", () => {
    seeking = true;
    updateProgressLabel(Number(elements.progressEl.value), state.playback.duration || 0);
  });

  ["change", "mouseup", "touchend"].forEach((eventName) => {
    elements.progressEl?.addEventListener(eventName, () => {
      if (!seeking) {
        return;
      }
      seeking = false;
      const seconds = Number(elements.progressEl.value);
      actions.seek(seconds).then(handleResult);
    });
  });

  elements.playBtn?.addEventListener("click", () => {
    actions.togglePlayback().then(handleResult);
  });

  elements.prevBtn?.addEventListener("click", () => {
    actions.previousTrack().then(handleResult);
  });

  elements.nextBtn?.addEventListener("click", () => {
    actions.nextTrack().then(handleResult);
  });

  elements.modeBtn?.addEventListener("click", () => {
    actions.cyclePlaybackMode().then(handleResult);
  });

  elements.addCurrentBtn?.addEventListener("click", () => {
    actions.addCurrentVideo(state.activeCategoryId).then((result) => {
      if (!result.ok) {
        feedback.show(result.message || "添加失败", true);
        return;
      }
      feedback.show("已添加当前视频");
    });
  });

  elements.volumeSlider?.addEventListener("input", () => {
    const value = Number(elements.volumeSlider.value) / 100;
    actions.setVolume(value).then(handleResult);
  });

  elements.audioQualitySelect?.addEventListener("change", () => {
    actions.setAudioQuality(elements.audioQualitySelect.value).then(handleResult);
  });

  function render() {
    const duration = Number(state.playback.duration) || 0;
    const progress = Number(state.playback.progress) || 0;
    if (elements.progressEl) {
      elements.progressEl.max = Math.max(1, Math.floor(duration));
      if (!seeking) {
        elements.progressEl.value = Math.min(elements.progressEl.max, Math.floor(progress));
        updateProgressLabel(progress, duration);
      }
    }

    const isPlaying = state.playback.status === "playing";
    if (elements.playBtn) {
      elements.playBtn.textContent = isPlaying ? "\u23F8" : "\u25B6";
      setTooltip(elements.playBtn, isPlaying ? "暂停" : "播放");
    }

    const mode = PLAYBACK_MODES.find((item) => item.id === state.playback.mode) || PLAYBACK_MODES[1];
    if (elements.modeBtn) {
      elements.modeBtn.textContent = MODE_ICONS[mode.id] || "\uD83D\uDD01";
      setTooltip(elements.modeBtn, mode.label);
    }

    if (elements.volumeSlider) {
      const volume = typeof state.playback.volume === "number" ? state.playback.volume : 1;
      elements.volumeSlider.value = Math.round(Math.min(1, Math.max(0, volume)) * 100);
    }

    if (elements.audioQualitySelect) {
      elements.audioQualitySelect.value = state.playback.audioQuality || "auto";
    }
  }

  function updateProgressLabel(progress, duration) {
    if (elements.currentTimeEl) {
      elements.currentTimeEl.textContent = formatTime(progress);
    }
    if (elements.durationTimeEl) {
      elements.durationTimeEl.textContent = formatTime(duration);
    }
  }

  function renderAudioQualityOptions() {
    if (!elements.audioQualitySelect) {
      return;
    }
    elements.audioQualitySelect.innerHTML = "";
    AUDIO_QUALITY_OPTIONS.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.id;
      element.textContent = option.label;
      elements.audioQualitySelect.appendChild(element);
    });
  }

  function handleResult(result) {
    if (!result?.ok) {
      feedback.show(result?.message || "操作失败", true);
    }
  }

  return { render };
}
