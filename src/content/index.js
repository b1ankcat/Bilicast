(async () => {
  try {
    const [messageModule] = await Promise.all([
      import(chrome.runtime.getURL("src/shared/messages.js"))
    ]);
    initContentScript(messageModule.MESSAGE);
  } catch {}
})();

function initContentScript(MESSAGE) {
  const BUTTON_ID = "bilicast-add-button";
  const STYLE_ID = "bilicast-style";

  const popover = new PlaylistPopover();
  const actionButton = createFloatingButton();
  let anchorElement = null;
  let resizeObserver = null;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === MESSAGE.CONTENT_REQUEST_VIDEO_INFO) {
      const video = collectVideoInfo();
      if (video) {
        sendResponse({ ok: true, video });
      } else {
        sendResponse({ ok: false, message: "未找到视频信息" });
      }
      return false;
    }
    return false;
  });

  init();

  function init() {
    injectStyles();
    mountButton();
    observeToolbar();
    observeUrlChanges();
    window.addEventListener(
      "scroll",
      () => positionButton(),
      { passive: true }
    );
    window.addEventListener("resize", () => positionButton());
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${BUTTON_ID} {
        border: 1px solid var(--brand_pink, #fb7299);
        color: var(--brand_pink, #fb7299);
        background: transparent;
        border-radius: 16px;
        padding: 4px 12px;
        font-size: 13px;
        cursor: pointer;
        margin-left: 8px;
        transition: all 0.2s ease;
        position: absolute;
        display: none;
        pointer-events: auto;
      }
      #${BUTTON_ID}:hover {
        background: var(--brand_pink, #fb7299);
        color: #fff;
      }
      .bilicast-popover {
        position: absolute;
        z-index: 9999;
        width: 260px;
        background: rgba(25, 25, 25, 0.95);
        color: #fff;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
        padding: 12px;
        display: none;
        flex-direction: column;
        gap: 8px;
      }
      .bilicast-popover.is-visible {
        display: flex;
      }
      .bilicast-popover label {
        font-size: 12px;
        color: #ccc;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .bilicast-popover select,
      .bilicast-popover input[type="text"] {
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        padding: 6px;
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
        font-size: 13px;
      }
      .bilicast-popover button {
        border-radius: 8px;
        border: none;
        padding: 6px 10px;
        font-size: 13px;
        cursor: pointer;
      }
      .bilicast-popover__actions {
        display: flex;
        gap: 8px;
      }
      .bilicast-popover__actions button {
        flex: 1;
        background: #fb7299;
        color: #fff;
      }
      .bilicast-popover__actions button:nth-child(2) {
        background: rgba(255, 255, 255, 0.15);
      }
      .bilicast-popover__new {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .bilicast-popover__new input {
        flex: 1;
      }
      .bilicast-popover__new button {
        background: rgba(255, 255, 255, 0.15);
        color: #fff;
      }
      .bilicast-popover__message {
        font-size: 12px;
        min-height: 16px;
        color: #9fe870;
      }
      .bilicast-popover__message.is-error {
        color: #ffb3c1;
      }
      .bilicast-toast {
        position: fixed;
        top: 24px;
        right: 24px;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        padding: 10px 16px;
        border-radius: 8px;
        z-index: 99999;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
        animation: bilicast-fade 3s forwards;
      }
      @keyframes bilicast-fade {
        0% { opacity: 0; transform: translateY(-6px); }
        15% { opacity: 1; transform: translateY(0); }
        85% { opacity: 1; }
        100% { opacity: 0; transform: translateY(-6px); }
      }
    `;
    document.head.appendChild(style);
  }

  function mountButton() {
    const anchorTarget = findToolbarAnchor();
    if (!anchorTarget) {
      hideFloatingButton();
      return;
    }
    if (anchorElement !== anchorTarget) {
      anchorElement = anchorTarget;
      if (!resizeObserver) {
        resizeObserver = new ResizeObserver(() => positionButton());
      }
      resizeObserver.disconnect();
      resizeObserver.observe(anchorElement);
    }
    showFloatingButton();
    positionButton();
  }

  function createFloatingButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.textContent = "添加到播放列表";
    button.style.position = "absolute";
    button.style.display = "none";
    button.style.zIndex = "9999";
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const video = collectVideoInfo();
      if (!video) {
        showToast("未找到视频信息", true);
        return;
      }
      popover.open(button, video);
    });
    document.body.appendChild(button);
    return button;
  }

  function showFloatingButton() {
    actionButton.style.display = "inline-flex";
  }

  function hideFloatingButton() {
    actionButton.style.display = "none";
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    anchorElement = null;
  }

  function positionButton() {
    if (!anchorElement || actionButton.style.display === "none") {
      return;
    }
    const rect = anchorElement.getBoundingClientRect();
    const buttonHeight = actionButton.offsetHeight || 28;
    const buttonWidth = actionButton.offsetWidth || 120;
    const offset = 16;
    const top = window.scrollY + rect.top + rect.height / 2 - buttonHeight / 2;
    const left = window.scrollX + rect.right + offset;
    actionButton.style.top = `${Math.max(0, top)}px`;
    actionButton.style.left = `${Math.max(0, left)}px`;
  }

  function observeToolbar() {
    const observer = new MutationObserver(() => mountButton());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function observeUrlChanges() {
    let lastUrl = location.href;
    setInterval(() => {
      if (lastUrl !== location.href) {
        lastUrl = location.href;
        hideFloatingButton();
        mountButton();
      }
    }, 1000);
  }

  function findToolbarAnchor() {
    const toolbarMain = document.querySelector(".video-toolbar-left .video-toolbar-left-main");
    if (!toolbarMain) {
      return null;
    }
    const items = toolbarMain.querySelectorAll(":scope > .toolbar-left-item-wrap");
    return items[3] || null;
  }

  function collectVideoInfo() {
    const bvid = extractBvid();
    if (!bvid) {
      return null;
    }
    const search = new URL(location.href);
    const pageIndex = Number(search.searchParams.get("p") || 1);
    const canonicalUrl = `https://www.bilibili.com/video/${bvid}?p=${pageIndex}&t=0`;
    const title = (
      document.querySelector(".video-title")?.textContent ||
      document.querySelector(".media-title")?.textContent ||
      document.querySelector(".media-info-title")?.textContent ||
      document.querySelector("h1[data-title]")?.getAttribute("data-title") ||
      document.title.replace(/_哔哩哔哩.*/, "")
    ).trim();
    const author = (
      document.querySelector(".up-info .name")?.textContent ||
      document.querySelector(".up-detail .up-name")?.textContent ||
      document.querySelector(".media-right .author")?.textContent ||
      "B 站创作者"
    ).trim();
    const coverRaw = document.querySelector('meta[property="og:image"]')?.content || "";
    const cover = normalizeCover(coverRaw);
    const durationRaw =
      document.querySelector('meta[itemprop="duration"]')?.content ||
      document.querySelector(".video-page-info .length")?.textContent;
    const duration = parseDuration(durationRaw);
    return {
      bvid,
      title,
      author,
      cover,
      duration,
      pageIndex,
      url: canonicalUrl
    };
  }

  function normalizeCover(url) {
    if (!url) return "";
    if (url.startsWith("//")) {
      return `https:${url}`;
    }
    return url;
  }

  function parseDuration(input) {
    if (!input) return 0;
    if (input.startsWith("PT")) {
      const hours = /([0-9]+)H/.exec(input)?.[1] || 0;
      const mins = /([0-9]+)M/.exec(input)?.[1] || 0;
      const secs = /([0-9]+)S/.exec(input)?.[1] || 0;
      return Number(hours) * 3600 + Number(mins) * 60 + Number(secs);
    }
    if (/^[0-9]+:[0-9]+/.test(input)) {
      return input
        .split(":")
        .map((part) => Number(part))
        .reduce((acc, value) => acc * 60 + value, 0);
    }
    return 0;
  }

  function extractBvid() {
    const pathMatch = /\/video\/(BV[\w]+)/i.exec(location.pathname);
    if (pathMatch) {
      return pathMatch[1];
    }
    try {
      const search = new URL(location.href).searchParams;
      const queryBvid = search.get("bvid");
      if (queryBvid && /^BV/i.test(queryBvid)) {
        return queryBvid;
      }
    } catch {}
    const dataBvid = document.querySelector("[data-bvid]")?.getAttribute("data-bvid");
    if (dataBvid && /^BV/i.test(dataBvid)) {
      return dataBvid;
    }
    return null;
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = "bilicast-toast";
    toast.textContent = message;
    if (isError) {
      toast.style.background = "rgba(255,87,115,0.95)";
    }
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function PlaylistPopover() {
    this.root = document.createElement("div");
    this.root.className = "bilicast-popover";
    this.root.innerHTML = `
      <label>分类
        <select class="bilicast-popover__select"></select>
      </label>
      <div class="bilicast-popover__actions">
        <button data-action="add">添加</button>
        <button data-action="delete">删除</button>
      </div>
      <div class="bilicast-popover__new">
        <input type="text" placeholder="新分类名称" class="bilicast-popover__input" />
        <button data-action="create">新建</button>
      </div>
      <div class="bilicast-popover__message"></div>
    `;
    document.body.appendChild(this.root);
    this.select = this.root.querySelector("select");
    this.newInput = this.root.querySelector(".bilicast-popover__input");
    this.message = this.root.querySelector(".bilicast-popover__message");
    this.categories = [];
    this.messageTimer = null;
    this.root.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("click", (event) => {
      if (!this.root.contains(event.target) && !event.target.closest?.(`#${BUTTON_ID}`)) {
        this.hide();
      }
    });
    this.root.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", (event) => {
        const action = event.currentTarget.getAttribute("data-action");
        this.handleAction(action);
      });
    });
  }

  PlaylistPopover.prototype.setMessage = function (text, isError = false) {
    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
    this.message.textContent = text || "";
    this.message.classList.toggle("is-error", isError);
    if (text && !isError) {
      this.messageTimer = setTimeout(() => {
        this.setMessage("", false);
      }, 2000);
    }
  };

  PlaylistPopover.prototype.open = async function (anchor, video) {
    this.video = video;
    await this.refreshCategories();
    const categories = Array.isArray(this.categories) ? this.categories : [];
    if (!categories.length) {
      this.setMessage("请先新建分类", true);
    } else {
      this.setMessage("", false);
    }
    this.root.classList.add("is-visible");
    const rect = anchor.getBoundingClientRect();
    const popHeight = this.root.offsetHeight || 200;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    let top = window.scrollY + rect.bottom + 8;
    if (spaceBelow < popHeight && spaceAbove > popHeight) {
      top = window.scrollY + rect.top - popHeight - 8;
    }
    this.root.style.top = `${Math.max(0, top)}px`;
    this.root.style.left = `${window.scrollX + rect.left}px`;
  };

  PlaylistPopover.prototype.hide = function () {
    this.root.classList.remove("is-visible");
    this.setMessage("", false);
  };

  PlaylistPopover.prototype.refreshCategories = async function () {
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE.PLAYLIST_GET_CATEGORIES });
      this.categories = response?.categories || [];
      const active = response?.activeCategoryId;
      this.select.innerHTML = "";
      this.categories.forEach((category) => {
        const option = document.createElement("option");
        option.value = category.id;
        option.textContent = `${category.name} (${category.count})`;
        if (category.id === active) {
          option.selected = true;
        }
        this.select.appendChild(option);
      });
    } catch (error) {
      this.categories = [];
      this.setMessage(error.message || "加载分类失败", true);
    }
  };

  PlaylistPopover.prototype.handleAction = async function (action) {
    if (action === "add") {
      await this.addToCategory();
      return;
    }
    if (action === "delete") {
      await this.deleteCategory();
      return;
    }
    if (action === "create") {
      await this.createCategory();
    }
  };

  PlaylistPopover.prototype.addToCategory = async function (options = {}) {
    const categoryId = this.select.value;
    if (!categoryId) {
      this.setMessage("请选择分类", true);
      return;
    }
    try {
      await chrome.runtime.sendMessage({
        type: MESSAGE.PLAYLIST_ADD_VIDEO,
        payload: { categoryId, video: this.video }
      });
      this.setMessage(options.message || "已添加", false);
      if (!options.skipToast) {
        showToast(options.toastText || "已加入播放列表");
      }
      if (!options.keepOpen) {
        this.hide();
      }
    } catch (error) {
      this.setMessage(error.message || "添加失败", true);
    }
  };

  PlaylistPopover.prototype.createCategory = async function () {
    const name = this.newInput.value.trim();
    if (!name) {
      this.setMessage("请输入分类名", true);
      return;
    }
    try {
      const res = await chrome.runtime.sendMessage({
        type: MESSAGE.PLAYLIST_CREATE_CATEGORY,
        payload: { name }
      });
      this.newInput.value = "";
      await this.refreshCategories();
      const newId = res?.category?.id;
      this.select.value = newId || this.select.value;
      if (newId) {
        await this.addToCategory({
          message: "分类已创建并已添加",
          toastText: "已添加到新分类"
        });
      } else {
        this.setMessage("分类已创建");
      }
    } catch (error) {
      this.setMessage(error.message || "创建失败", true);
    }
  };

  PlaylistPopover.prototype.deleteCategory = async function () {
    const categoryId = this.select.value;
    if (!categoryId) {
      this.setMessage("请选择分类", true);
      return;
    }
    if (!confirm("确定要删除该分类吗？")) {
      return;
    }
    try {
      await chrome.runtime.sendMessage({
        type: MESSAGE.PLAYLIST_DELETE_CATEGORY,
        payload: { categoryId }
      });
      await this.refreshCategories();
      this.setMessage("已删除，重新选择分类");
    } catch (error) {
      this.setMessage(error.message || "删除失败", true);
    }
  };
}
