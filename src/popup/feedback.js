export function mountFeedback({ feedbackEl }) {
  let feedbackTimer = null;

  function show(text, isError = false) {
    if (!feedbackEl) {
      return;
    }
    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }
    feedbackEl.textContent = text || "";
    feedbackEl.classList.toggle("is-visible", Boolean(text));
    feedbackEl.classList.toggle("is-error", Boolean(text && isError));
    if (!text) {
      return;
    }
    feedbackTimer = setTimeout(() => {
      feedbackEl.textContent = "";
      feedbackEl.classList.remove("is-visible");
      feedbackEl.classList.remove("is-error");
      feedbackTimer = null;
    }, 2500);
  }

  return { show };
}
