import { sendRuntimeCommand } from "./runtime.js";
import { showToast } from "./ui.js";

export function createPlaylistPopover({ MESSAGE, buttonId }) {
  const root = document.createElement("div");
  root.className = "bilicast-popover";
  root.innerHTML = `
    <label>分类
      <select class="bilicast-popover__select"></select>
    </label>
    <div class="bilicast-popover__status is-empty">未收藏</div>
    <div class="bilicast-popover__actions">
      <button type="button" data-action="add">添加</button>
    </div>
    <div class="bilicast-popover__new">
      <input type="text" placeholder="新分类名称" class="bilicast-popover__input" />
      <button type="button" data-action="create">新建</button>
    </div>
    <div class="bilicast-popover__message"></div>
  `;
  document.body.appendChild(root);

  const select = root.querySelector(".bilicast-popover__select");
  const status = root.querySelector(".bilicast-popover__status");
  const newInput = root.querySelector(".bilicast-popover__input");
  const message = root.querySelector(".bilicast-popover__message");
  const addButton = root.querySelector('[data-action="add"]');

  let categories = [];
  let memberships = [];
  let video = null;
  let messageTimer = null;

  root.addEventListener("click", (event) => {
    event.stopPropagation();
  });
  select.addEventListener("change", () => {
    syncSelectedCategoryState();
  });
  document.addEventListener("click", (event) => {
    const clickedTrigger = event.target instanceof Element && event.target.closest(`#${buttonId}`);
    if (!root.contains(event.target) && !clickedTrigger) {
      hide();
    }
  });
  root.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      handleAction(button.getAttribute("data-action"));
    });
  });

  return {
    open,
    hide
  };

  function setMessage(text, isError = false) {
    if (messageTimer) {
      clearTimeout(messageTimer);
      messageTimer = null;
    }

    message.textContent = text || "";
    message.classList.toggle("is-error", isError);
    if (text && !isError) {
      messageTimer = setTimeout(() => {
        setMessage("", false);
      }, 2000);
    }
  }

  async function open(anchor, nextVideo) {
    video = nextVideo;
    await refreshCategories();
    if (!categories.length) {
      setMessage("请先新建分类", true);
    }

    root.classList.add("is-visible");
    const rect = anchor.getBoundingClientRect();
    const height = root.offsetHeight || 200;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    let top = window.scrollY + rect.bottom + 8;
    if (spaceBelow < height && spaceAbove > height) {
      top = window.scrollY + rect.top - height - 8;
    }
    root.style.top = `${Math.max(window.scrollY + 8, top)}px`;
    root.style.left = `${window.scrollX + rect.left}px`;
  }

  function hide() {
    root.classList.remove("is-visible");
    setMessage("", false);
  }

  function renderMembershipStatus() {
    const names = memberships.map((category) => category.name).filter(Boolean);
    if (!names.length) {
      status.textContent = "未收藏";
      status.classList.add("is-empty");
      return;
    }
    status.textContent = `已在：${names.join("、")}`;
    status.classList.remove("is-empty");
  }

  function syncSelectedCategoryState() {
    const selectedCategoryId = select.value;
    const existsInSelected = memberships.some((category) => category.id === selectedCategoryId);
    addButton.disabled = !selectedCategoryId || existsInSelected;
    addButton.textContent = existsInSelected ? "已在该分类" : "添加";
  }

  function renderCategoryOptions(activeCategoryId) {
    const membershipIds = new Set(memberships.map((category) => category.id));
    select.innerHTML = "";
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category.id;
      option.textContent = `${category.name} (${category.count})${membershipIds.has(category.id) ? " · 已有" : ""}`;
      option.selected = category.id === activeCategoryId;
      select.appendChild(option);
    });
  }

  async function refreshCategories() {
    const [categoriesResponse, membershipsResponse] = await Promise.all([
      sendRuntimeCommand({ type: MESSAGE.PLAYLIST_GET_CATEGORIES }, "加载分类失败"),
      sendRuntimeCommand(
        {
          type: MESSAGE.PLAYLIST_GET_VIDEO_MEMBERSHIPS,
          payload: {
            bvid: video?.bvid,
            pageIndex: video?.pageIndex
          }
        },
        "读取收藏状态失败"
      )
    ]);

    if (!categoriesResponse.ok) {
      categories = [];
      memberships = [];
      select.innerHTML = "";
      renderMembershipStatus();
      syncSelectedCategoryState();
      setMessage(categoriesResponse.message || "加载分类失败", true);
      return;
    }

    categories = Array.isArray(categoriesResponse.categories) ? categoriesResponse.categories : [];
    memberships = membershipsResponse.ok && Array.isArray(membershipsResponse.categories)
      ? membershipsResponse.categories
      : [];

    renderCategoryOptions(categoriesResponse.activeCategoryId);
    renderMembershipStatus();
    syncSelectedCategoryState();
    if (!membershipsResponse.ok) {
      setMessage(membershipsResponse.message || "读取收藏状态失败", true);
    }
  }

  async function handleAction(action) {
    if (action === "add") {
      await addToCategory();
      return;
    }
    if (action === "create") {
      await createCategory();
    }
  }

  async function addToCategory(options = {}) {
    const categoryId = select.value;
    if (!categoryId) {
      setMessage("请选择分类", true);
      return;
    }
    if (memberships.some((category) => category.id === categoryId)) {
      syncSelectedCategoryState();
      return;
    }

    const result = await sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_ADD_VIDEO,
        payload: { categoryId, video }
      },
      "添加失败"
    );
    if (!result.ok) {
      setMessage(result.message || "添加失败", true);
      return;
    }

    setMessage(options.message || "已添加");
    if (!options.skipToast) {
      showToast(options.toastText || "已加入播放列表");
    }
    if (!options.keepOpen) {
      hide();
    }
  }

  async function createCategory() {
    const name = newInput.value.trim();
    if (!name) {
      setMessage("请输入分类名", true);
      return;
    }

    const response = await sendRuntimeCommand(
      {
        type: MESSAGE.PLAYLIST_CREATE_CATEGORY,
        payload: { name }
      },
      "创建失败"
    );
    if (!response.ok) {
      setMessage(response.message || "创建失败", true);
      return;
    }

    newInput.value = "";
    await refreshCategories();
    const newId = response?.category?.id;
    select.value = newId || select.value;
    syncSelectedCategoryState();
    if (newId) {
      await addToCategory({
        message: "分类已创建并已添加",
        toastText: "已添加到新分类"
      });
    } else {
      setMessage("分类已创建");
    }
  }
}
