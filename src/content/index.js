(async () => {
  try {
    const [{ MESSAGE }, { initContentShell }] = await Promise.all([
      import(chrome.runtime.getURL("src/shared/messages.js")),
      import(chrome.runtime.getURL("src/content/content-shell.js"))
    ]);
    initContentShell({ MESSAGE });
  } catch {}
})();
