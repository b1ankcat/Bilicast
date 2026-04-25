export async function sendRuntimeCommand(message, fallbackMessage) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (response?.ok === false) {
      return { ok: false, message: response.message || fallbackMessage };
    }
    return { ok: true, ...(response || {}) };
  } catch (error) {
    return { ok: false, message: error?.message || fallbackMessage };
  }
}
