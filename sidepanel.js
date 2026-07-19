import {
  loadBookmarks,
  searchBookmarks,
  faviconUrl,
  removeBookmark,
  removeTree,
  moveBookmark,
  mergeFolderInto,
  removeMany,
  renameBookmark,
  isProtectedFolder,
  domainOf,
} from "./lib/bookmarks.js";
import { analyzeBookmarks } from "./lib/analyze.js";
import {
  initI18n,
  applyStaticI18n,
  t,
  loadSavedLang,
  saveLang,
  getLang,
} from "./lib/i18n.js";

/** @type {Awaited<ReturnType<typeof loadBookmarks>> | null} */
let data = null;
/** @type {ReturnType<typeof analyzeBookmarks> | null} */
let report = null;
/** @type {string | null} */
let pendingMoveId = null;
/** @type {Set<string>} */
let openFolderIds = new Set();
/** @type {string | null} */
let dragSourceId = null;
/** @type {string | null} */
let renamingId = null;
/** @type {string | null} */
let renamingOriginalTitle = null;
/** @type {Set<string>} */
let expandedDomains = new Set();

const els = {
  statBookmarks: document.getElementById("stat-bookmarks"),
  statFolders: document.getElementById("stat-folders"),
  statDomains: document.getElementById("stat-domains"),
  statIssues: document.getElementById("stat-issues"),
  blockDupes: document.getElementById("block-dupes"),
  blockEmpty: document.getElementById("block-empty"),
  blockTiny: document.getElementById("block-tiny"),
  blockOverlap: document.getElementById("block-overlap"),
  insightsEmpty: document.getElementById("insights-empty"),
  searchInput: /** @type {HTMLInputElement} */ (document.getElementById("search-input")),
  searchMeta: document.getElementById("search-meta"),
  searchResults: document.getElementById("search-results"),
  domainList: document.getElementById("domain-list"),
  largeList: document.getElementById("large-list"),
  folderTree: document.getElementById("folder-tree"),
  listDupes: document.getElementById("list-dupes"),
  listEmpty: document.getElementById("list-empty"),
  listTiny: document.getElementById("list-tiny"),
  listOverlap: document.getElementById("list-overlap"),
  btnCleanDupes: /** @type {HTMLButtonElement} */ (document.getElementById("btn-clean-dupes")),
  btnCleanEmpty: /** @type {HTMLButtonElement} */ (document.getElementById("btn-clean-empty")),
  btnRefresh: document.getElementById("btn-refresh"),
  toast: document.getElementById("toast"),
  confirmDialog: /** @type {HTMLDialogElement} */ (document.getElementById("confirm-dialog")),
  confirmTitle: document.getElementById("confirm-title"),
  confirmMsg: document.getElementById("confirm-msg"),
  confirmOk: document.getElementById("confirm-ok"),
  moveDialog: /** @type {HTMLDialogElement} */ (document.getElementById("move-dialog")),
  moveSelect: /** @type {HTMLInputElement} */ (document.getElementById("move-select")),
  moveFolderList: /** @type {HTMLElement} */ (document.getElementById("move-folder-list")),
  moveTargetLabel: document.getElementById("move-target-label"),
  langSelect: /** @type {HTMLSelectElement} */ (document.getElementById("lang-select")),
};

init();

async function init() {
  const lang = await loadSavedLang();
  await initI18n(lang);
  applyStaticI18n();
  els.langSelect.value = getLang();
  bindTabs();
  bindGlobal();
  await refresh();
  chrome.bookmarks.onCreated.addListener(softRefresh);
  chrome.bookmarks.onRemoved.addListener(softRefresh);
  chrome.bookmarks.onChanged.addListener(softRefresh);
  chrome.bookmarks.onMoved.addListener(softRefresh);
}

let refreshTimer = 0;
function softRefresh() {
  if (renamingId) return;
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => refresh({ silent: true }), 250);
}

async function refresh({ silent = false } = {}) {
  data = await loadBookmarks();
  report = analyzeBookmarks(data);
  renderStats();
  renderOverview();
  renderInsights();
  renderTree();
  const q = els.searchInput.value.trim();
  if (q) renderSearch(q);
  else {
    els.searchMeta.textContent = t("searchStart");
    els.searchResults.innerHTML = "";
  }
  if (!silent) toast(t("synced"));
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.getAttribute("data-tab");
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      document.querySelectorAll(".panel").forEach((p) => {
        p.classList.toggle("is-active", p.id === `panel-${name}`);
      });
      if (name === "search") els.searchInput.focus();
    });
  });
}

function bindGlobal() {
  let debounceTimer = 0;

  const runSearch = () => {
    const q = els.searchInput.value.trim();
    if (q) {
      switchTab("search");
      renderSearch(q);
    } else {
      els.searchMeta.textContent = t("searchStart");
      els.searchResults.innerHTML = "";
    }
  };

  els.searchInput.addEventListener("input", () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(runSearch, 120);
  });

  els.searchInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    window.clearTimeout(debounceTimer);
    runSearch();
  });

  els.langSelect.addEventListener("change", async () => {
    const value = els.langSelect.value;
    await saveLang(value);
    await initI18n(value);
    applyStaticI18n();
    await refresh({ silent: true });
  });

  els.btnRefresh.addEventListener("click", () => refresh());

  document.querySelectorAll(".stat.is-link[data-tab]").forEach((card) => {
    card.addEventListener("click", () => {
      const tab = card.getAttribute("data-tab");
      if (tab) switchTab(tab);
    });
  });

  els.btnCleanDupes.addEventListener("click", async () => {
    if (!report?.duplicates.length) return;
    const ids = report.duplicates.flatMap((g) => g.removeIds);
    const ok = await confirmAction(
      t("confirmDedupTitle"),
      t("confirmDedupMsg", { n: ids.length })
    );
    if (!ok) return;
    await removeMany(ids);
    await refresh({ silent: true });
    toast(t("toastDeletedN", { n: ids.length }));
  });

  els.btnCleanEmpty.addEventListener("click", async () => {
    if (!report?.emptyFolders.length) return;
    const ok = await confirmAction(
      t("confirmEmptyTitle"),
      t("confirmEmptyMsg", { n: report.emptyFolders.length })
    );
    if (!ok) return;
    for (const f of report.emptyFolders) {
      try {
        await removeTree(f.id);
      } catch {
        /* ignore */
      }
    }
    await refresh({ silent: true });
    toast(t("toastEmptyCleaned"));
  });

  els.moveDialog.addEventListener("close", async () => {
    if (els.moveDialog.returnValue !== "ok" || !pendingMoveId) {
      pendingMoveId = null;
      return;
    }
    const parentId = els.moveSelect.value;
    const id = pendingMoveId;
    pendingMoveId = null;
    if (!parentId) return;
    await moveBookmark(id, { parentId });
    await refresh({ silent: true });
    toast(t("toastMoved"));
  });

}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("is-active", t.getAttribute("data-tab") === name);
  });
  document.querySelectorAll(".panel").forEach((p) => {
    p.classList.toggle("is-active", p.id === `panel-${name}`);
  });
}

function renderStats() {
  if (!report) return;
  els.statBookmarks.textContent = String(report.stats.bookmarkCount);
  els.statFolders.textContent = String(report.stats.folderCount);
  els.statDomains.textContent = String(report.stats.domainCount);
  els.statIssues.textContent = String(report.stats.issueCount);
}

function renderOverview() {
  if (!report || !data) return;
  const max = report.domains[0]?.count || 1;
  els.domainList.innerHTML = report.domains.length
    ? report.domains
        .map((d) => {
          const open = expandedDomains.has(d.domain);
          const items = open ? bookmarksForDomain(d.domain) : [];
          return `
      <li class="domain-row${open ? " is-open" : ""}">
        <button type="button" class="domain-row-head" data-toggle-domain="${escapeAttr(d.domain)}">
          <span class="domain-chevron" aria-hidden="true">▸</span>
          <span class="domain-name">${escapeHtml(d.domain)}</span>
          <span class="bar"><i style="width:${Math.round((d.count / max) * 100)}%"></i></span>
          <span class="domain-count">${d.count}</span>
        </button>
        ${
          open
            ? `<ul class="domain-detail">
            ${
              items.length
                ? items
                    .map(
                      (b) => `
              <li class="domain-item" data-node-id="${b.id}">
                <img src="${faviconUrl(b.url || "")}" alt="" width="16" height="16" />
                <div class="domain-item-main">
                  <button type="button" class="domain-item-title tree-title" data-action="open" data-id="${b.id}" data-url="${escapeAttr(b.url || "")}">${escapeHtml(displayTitle(b.title, b.url))}</button>
                  ${
                    b.url
                      ? `<button type="button" class="domain-item-url" data-action="open" data-id="${b.id}" data-url="${escapeAttr(b.url || "")}">${escapeHtml(b.url)}</button>`
                      : ""
                  }
                  <div class="domain-item-path">${escapeHtml(b.pathLabel)}</div>
                </div>
                <div class="domain-item-actions">
                  <button type="button" class="btn tiny" data-action="reveal" data-id="${b.id}">${escapeHtml(t("jumpToTree"))}</button>
                  <button type="button" class="btn tiny" data-action="move" data-id="${b.id}" data-title="${escapeAttr(b.title || "")}">${escapeHtml(t("move"))}</button>
                  <button type="button" class="btn tiny" data-action="delete" data-id="${b.id}" data-title="${escapeAttr(b.title || "")}" data-folder="0">${escapeHtml(t("delete"))}</button>
                </div>
              </li>`
                    )
                    .join("")
                : `<li class="empty">${escapeHtml(t("noMatch"))}</li>`
            }
          </ul>`
            : ""
        }
      </li>`;
        })
        .join("")
    : `<li class="empty">${escapeHtml(t("noData"))}</li>`;

  els.domainList.querySelectorAll("[data-toggle-domain]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const domain = btn.getAttribute("data-toggle-domain");
      if (!domain) return;
      if (expandedDomains.has(domain)) expandedDomains.delete(domain);
      else expandedDomains.add(domain);
      renderOverview();
    });
  });

  els.domainList.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onItemAction(btn);
    });
  });

  els.largeList.innerHTML = report.largeFolders.length
    ? report.largeFolders
        .slice(0, 8)
        .map(
          (f) => `
      <li>
        <span>${escapeHtml(f.pathLabel ? f.pathLabel + " / " : "")}${escapeHtml(f.title)}</span>
        <span>${escapeHtml(t("items", { n: f.childCount }))}</span>
      </li>`
        )
        .join("")
    : `<li class="empty">${escapeHtml(t("noLargeFolders"))}</li>`;
}

/** @param {string} domain */
function bookmarksForDomain(domain) {
  if (!data) return [];
  return data.bookmarks.filter((b) => domainOf(b.url || "") === domain);
}

/** Expand ancestors, switch to directory tab, scroll to node. */
async function revealInTree(id) {
  if (!data) {
    await refresh({ silent: true });
  }
  if (!data) {
    toast(t("toastNotFound"));
    return;
  }

  const item = data.flat.find((i) => i.id === id);
  if (!item) {
    toast(t("toastNotFound"));
    return;
  }

  // Keep existing opens, then force-open every ancestor of the target.
  let pid = item.parentId;
  while (pid && pid !== "0") {
    openFolderIds.add(pid);
    const parent = data.flat.find((i) => i.id === pid);
    if (!parent) break;
    pid = parent.parentId;
  }

  switchTab("tree");
  // Do not sync open state from old DOM — it would wipe the path we just prepared.
  renderTree({ preserveOpenFromDom: false });

  window.setTimeout(() => {
    const el = /** @type {HTMLElement | null} */ (
      els.folderTree.querySelector(`[data-node-id="${CSS.escape(id)}"]`)
    );
    if (!el) {
      toast(t("toastNotFound"));
      return;
    }

    // Ensure every wrapping <details> is open even if attribute missed.
    let details = el.closest("details");
    while (details) {
      details.open = true;
      const folderId = details.getAttribute("data-folder-id");
      if (folderId) openFolderIds.add(folderId);
      details = details.parentElement?.closest("details") || null;
    }

    el.classList.remove("is-flash");
    // Force reflow so animation restarts.
    void el.offsetWidth;
    el.classList.add("is-flash");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => el.classList.remove("is-flash"), 3200);
  }, 60);
}

function renderSearch(query) {
  if (!data) return;
  const results = searchBookmarks(query, data.bookmarks);
  els.searchMeta.textContent = t("searchFound", { n: results.length });
  els.searchResults.innerHTML = results.length
    ? results
        .slice(0, 80)
        .map((b) => bookmarkRow(b))
        .join("")
    : `<li class="empty">${escapeHtml(t("noMatch"))}</li>`;

  els.searchResults.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => onItemAction(btn));
  });
}

function bookmarkRow(b) {
  const icon = b.url ? faviconUrl(b.url) : "";
  const title = escapeHtml(displayTitle(b.title, b.url));
  const url = escapeHtml(b.url || "");
  const openAttrs = `data-action="open" data-id="${b.id}" data-url="${escapeAttr(b.url || "")}"`;
  return `
    <li>
      ${icon ? `<img src="${icon}" alt="" width="24" height="24" />` : `<span></span>`}
      <div class="result-main">
        <button type="button" class="result-title is-link" ${openAttrs}>${title}</button>
        ${
          b.url
            ? `<button type="button" class="result-url is-link" ${openAttrs}>${url}</button>`
            : ""
        }
        <div class="result-path">${escapeHtml(b.pathLabel)}</div>
      </div>
      <div class="result-actions">
        <button type="button" class="btn tiny" data-action="move" data-id="${b.id}" data-title="${escapeAttr(b.title || "")}">${escapeHtml(t("move"))}</button>
        <button type="button" class="btn tiny" data-action="delete" data-id="${b.id}" data-title="${escapeAttr(b.title || "")}" data-folder="0">${escapeHtml(t("delete"))}</button>
      </div>
    </li>`;
}

async function onItemAction(btn) {
  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  if (!id || !action) return;

  if (action === "open") {
    const url = btn.getAttribute("data-url");
    if (url) await chrome.tabs.create({ url });
    return;
  }

  if (action === "reveal") {
    await revealInTree(id);
    return;
  }

  if (action === "rename") {
    startInlineRename(id, btn.getAttribute("data-title") || "");
    return;
  }

  if (action === "delete") {
    const title = btn.getAttribute("data-title") || "";
    const isFolder = btn.getAttribute("data-folder") === "1";
    if (isProtectedFolder(id)) {
      toast(t("toastProtected"));
      return;
    }
    const ok = await confirmAction(
      isFolder ? t("confirmDeleteFolderTitle") : t("confirmDeleteBookmarkTitle"),
      isFolder
        ? t("confirmDeleteFolderMsg", { title })
        : t("confirmDeleteBookmarkMsg", { title })
    );
    if (!ok) return;
    if (isFolder) await removeTree(id);
    else await removeBookmark(id);
    await refresh({ silent: true });
    toast(t("toastDeleted"));
    return;
  }

  if (action === "move") {
    openMoveDialog(id, btn.getAttribute("data-title") || "");
  }
}

/** @param {string | undefined} title @param {string | undefined} url */
function displayTitle(title, url) {
  const trimmed = (title || "").trim();
  if (trimmed) return trimmed;
  return url || t("untitled");
}

function folderIconSvg() {
  return `
    <svg viewBox="0 0 24 24" width="22" height="22" focusable="false">
      <path fill="#E8A317" d="M3 6.25A1.75 1.75 0 0 1 4.75 4.5h4.1L10.7 6.5h8.55A1.75 1.75 0 0 1 21 8.25V9.5H3V6.25Z"/>
      <path fill="#F5C84C" d="M3 9h18v8.25A1.75 1.75 0 0 1 19.25 19H4.75A1.75 1.75 0 0 1 3 17.25V9Z"/>
    </svg>`;
}

/**
 * @param {string} id
 * @param {string} title
 */
function startInlineRename(id, title) {
  if (renamingId && renamingId !== id) {
    void commitInlineRename(false);
  }

  const host =
    els.folderTree.querySelector(`[data-node-id="${id}"]`) ||
    els.domainList.querySelector(`[data-node-id="${id}"]`);
  const titleEl = host?.querySelector(".tree-title");
  if (!host || !titleEl) {
    toast(t("toastNotFound"));
    return;
  }

  const looksLikeUrl = /^https?:\/\//i.test(title) || /^[\w.-]+\.[a-z]{2,}\//i.test(title);
  const initial = looksLikeUrl && title.length > 40 ? "" : title;

  renamingId = id;
  renamingOriginalTitle = titleEl.textContent || title;

  if (host.getAttribute("draggable") === "true") {
    host.setAttribute("data-was-draggable", "1");
    host.setAttribute("draggable", "false");
  }

  const wrap = document.createElement("div");
  wrap.className = "tree-rename-edit";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tree-rename-input";
  input.value = initial;
  input.maxLength = 300;
  input.setAttribute("aria-label", t("rename"));

  const btnSave = document.createElement("button");
  btnSave.type = "button";
  btnSave.className = "btn tiny primary";
  btnSave.textContent = t("save");

  const btnCancel = document.createElement("button");
  btnCancel.type = "button";
  btnCancel.className = "btn tiny ghost";
  btnCancel.textContent = t("cancel");

  wrap.append(input, btnSave, btnCancel);
  titleEl.replaceWith(wrap);
  host.classList.add("is-renaming");

  let settled = false;
  const finish = (save) => {
    if (settled) return;
    settled = true;
    void commitInlineRename(save, input);
  };

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());
  wrap.addEventListener("click", (e) => e.stopPropagation());

  btnSave.addEventListener("mousedown", (e) => e.preventDefault());
  btnCancel.addEventListener("mousedown", (e) => e.preventDefault());
  btnSave.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    finish(true);
  });
  btnCancel.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  });

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

/**
 * @param {boolean} save
 * @param {HTMLInputElement} [inputEl]
 */
async function commitInlineRename(save, inputEl) {
  const id = renamingId;
  if (!id) return;

  const input =
    inputEl ||
    /** @type {HTMLInputElement | null} */ (
      els.folderTree.querySelector(".tree-rename-input") ||
      els.domainList.querySelector(".tree-rename-input")
    );
  const nextTitle = input?.value.trim() || "";
  const original = renamingOriginalTitle || "";

  renamingId = null;
  renamingOriginalTitle = null;

  if (!save || !nextTitle || nextTitle === original) {
    await refresh({ silent: true });
    return;
  }

  try {
    await renameBookmark(id, nextTitle);
    await refresh({ silent: true });
    toast(t("toastRenamed"));
  } catch (err) {
    console.error(err);
    await refresh({ silent: true });
    toast(t("toastRenameFail"));
  }
}

function openMoveDialog(id, title) {
  if (!data) return;
  pendingMoveId = id;
  els.moveTargetLabel.textContent = title;

  // Exclude self and descendants when moving a folder.
  const blocked = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const child of data.flat.filter((i) => i.parentId === cur && i.isFolder)) {
      if (!blocked.has(child.id)) {
        blocked.add(child.id);
        queue.push(child.id);
      }
    }
  }

  const folders = data.folders.filter((f) => !blocked.has(f.id));
  const firstId = folders[0]?.id || "";
  els.moveSelect.value = firstId;

  els.moveFolderList.innerHTML = folders.length
    ? folders
        .map((f) => {
          const depth = Math.max(0, f.depth || 0);
          const name = f.title || t("untitled");
          const selected = f.id === firstId;
          return `
      <button
        type="button"
        role="option"
        class="move-folder-option${selected ? " is-selected" : ""}"
        data-folder-id="${escapeAttr(f.id)}"
        style="--depth:${depth}"
        aria-selected="${selected ? "true" : "false"}"
      >
        <span class="move-folder-icon" aria-hidden="true">${folderIconSvg()}</span>
        <span class="move-folder-name">${escapeHtml(name)}</span>
      </button>`;
        })
        .join("")
    : `<div class="move-folder-empty">${escapeHtml(t("noData"))}</div>`;

  els.moveFolderList.querySelectorAll(".move-folder-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const folderId = btn.getAttribute("data-folder-id") || "";
      els.moveSelect.value = folderId;
      els.moveFolderList.querySelectorAll(".move-folder-option").forEach((el) => {
        const on = el === btn;
        el.classList.toggle("is-selected", on);
        el.setAttribute("aria-selected", on ? "true" : "false");
      });
    });
  });

  els.moveDialog.returnValue = "";
  els.moveDialog.showModal();
}

function renderTree({ preserveOpenFromDom = true } = {}) {
  if (!data) return;
  if (preserveOpenFromDom) rememberOpenFolders();
  const roots = data.tree[0]?.children || [];
  els.folderTree.innerHTML = roots.map((n) => renderFolderNode(n)).join("");
  bindTreeInteractions();
}

function rememberOpenFolders() {
  if (!els.folderTree.querySelector("details")) return;
  const fromDom = [
    ...els.folderTree.querySelectorAll("details[open][data-folder-id]"),
  ].map((el) => el.getAttribute("data-folder-id"));
  // Merge so intentional opens (e.g. reveal) are not lost.
  for (const id of fromDom) {
    if (id) openFolderIds.add(id);
  }
}

function bindTreeInteractions() {
  els.folderTree.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onItemAction(btn);
    });
  });

  els.folderTree.querySelectorAll("[data-node-id]").forEach((el) => {
    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("dragend", onDragEnd);
    el.addEventListener("dragover", onDragOverItem);
    el.addEventListener("dragleave", onDragLeaveItem);
    el.addEventListener("drop", onDropItem);
  });

  els.folderTree.querySelectorAll(".tree-actions").forEach((actions) => {
    actions.addEventListener("mousedown", (e) => e.stopPropagation());
    actions.addEventListener("dragstart", (e) => e.preventDefault());
  });

  els.folderTree.querySelectorAll("details[data-folder-id]").forEach((details) => {
    details.addEventListener("toggle", () => {
      const id = details.getAttribute("data-folder-id");
      if (!id) return;
      if (details.open) openFolderIds.add(id);
      else openFolderIds.delete(id);
    });
  });
}

/** @param {DragEvent} e */
function onDragStart(e) {
  const el = /** @type {HTMLElement} */ (e.currentTarget);
  const id = el.getAttribute("data-node-id");
  if (renamingId || el.classList.contains("is-renaming")) {
    e.preventDefault();
    return;
  }
  if (!id || isProtectedFolder(id)) {
    e.preventDefault();
    return;
  }
  dragSourceId = id;
  el.classList.add("is-dragging");
  e.dataTransfer?.setData("text/plain", id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

/** @param {DragEvent} e */
function onDragEnd(e) {
  const el = /** @type {HTMLElement} */ (e.currentTarget);
  el.classList.remove("is-dragging");
  clearDropIndicators();
  dragSourceId = null;
}

function clearDropIndicators() {
  els.folderTree
    .querySelectorAll(".is-drop-target, .is-drop-before, .is-drop-after")
    .forEach((n) => n.classList.remove("is-drop-target", "is-drop-before", "is-drop-after"));
}

/**
 * @param {HTMLElement} el
 * @param {number} clientY
 * @returns {'before' | 'after' | 'into'}
 */
function dropPlaceFor(el, clientY) {
  const rect = el.getBoundingClientRect();
  const ratio = (clientY - rect.top) / Math.max(rect.height, 1);
  const isFolder = el.tagName === "SUMMARY" || el.classList.contains("tree-folder-summary");
  if (isFolder) {
    if (ratio < 0.28) return "before";
    if (ratio > 0.72) return "after";
    return "into";
  }
  return ratio < 0.5 ? "before" : "after";
}

/** @param {DragEvent} e */
function onDragOverItem(e) {
  if (renamingId) return;
  const el = /** @type {HTMLElement} */ (e.currentTarget);
  const targetId = el.getAttribute("data-node-id");
  const sourceId = dragSourceId;
  if (!sourceId || !targetId || sourceId === targetId) return;

  const place = dropPlaceFor(el, e.clientY);
  if (place === "into") {
    if (!canDropIntoFolder(sourceId, targetId)) return;
  } else if (!canReorderBeside(sourceId, targetId)) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

  clearDropIndicators();
  if (place === "before") el.classList.add("is-drop-before");
  else if (place === "after") el.classList.add("is-drop-after");
  else el.classList.add("is-drop-target");
}

/** @param {DragEvent} e */
function onDragLeaveItem(e) {
  const el = /** @type {HTMLElement} */ (e.currentTarget);
  const related = /** @type {Node | null} */ (e.relatedTarget);
  if (related && el.contains(related)) return;
  el.classList.remove("is-drop-target", "is-drop-before", "is-drop-after");
}

/** @param {DragEvent} e */
async function onDropItem(e) {
  if (renamingId) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const el = /** @type {HTMLElement} */ (e.currentTarget);
  const targetId = el.getAttribute("data-node-id");
  const sourceId = e.dataTransfer?.getData("text/plain") || dragSourceId;
  const place = dropPlaceFor(el, e.clientY);
  clearDropIndicators();
  dragSourceId = null;
  if (!sourceId || !targetId || sourceId === targetId) return;

  try {
    if (place === "into") {
      if (!canDropIntoFolder(sourceId, targetId)) {
        toast(t("toastCannotDrop"));
        return;
      }
      await moveBookmark(sourceId, { parentId: targetId });
      openFolderIds.add(targetId);
    } else {
      if (!canReorderBeside(sourceId, targetId)) {
        toast(t("toastCannotDrop"));
        return;
      }
      await moveBeside(sourceId, targetId, place);
      const target = data?.flat.find((i) => i.id === targetId);
      if (target?.parentId) openFolderIds.add(target.parentId);
    }
    await refresh({ silent: true });
    toast(place === "into" ? t("toastMoved") : t("toastReordered"));
  } catch (err) {
    console.error(err);
    toast(t("toastMoveFail"));
  }
}

/**
 * @param {string} sourceId
 * @param {string} siblingId
 * @param {'before' | 'after'} place
 */
async function moveBeside(sourceId, siblingId, place) {
  const [sibling] = await chrome.bookmarks.get(siblingId);
  const parentId = sibling.parentId;
  if (!parentId) throw new Error("no parent");
  const children = await chrome.bookmarks.getChildren(parentId);
  const withoutSource = children.filter((c) => c.id !== sourceId);
  let index = withoutSource.findIndex((c) => c.id === siblingId);
  if (index < 0) throw new Error("sibling missing");
  if (place === "after") index += 1;
  await moveBookmark(sourceId, { parentId, index });
}

/** @param {string} sourceId @param {string} folderId */
function canDropIntoFolder(sourceId, folderId) {
  if (!sourceId || !folderId) return false;
  if (sourceId === folderId) return false;
  if (isProtectedFolder(sourceId)) return false;
  if (!data) return false;
  const folder = data.flat.find((i) => i.id === folderId);
  if (!folder?.isFolder) return false;
  const source = data.flat.find((i) => i.id === sourceId);
  if (!source) return false;
  if (source.isFolder) {
    const sourcePathPrefix = [...source.path, source.title].join(" / ");
    const targetFull = [...folder.path, folder.title].join(" / ");
    if (targetFull === sourcePathPrefix || targetFull.startsWith(sourcePathPrefix + " / ")) {
      return false;
    }
  }
  return true;
}

/** @param {string} sourceId @param {string} siblingId */
function canReorderBeside(sourceId, siblingId) {
  if (!sourceId || !siblingId) return false;
  if (sourceId === siblingId) return false;
  if (isProtectedFolder(sourceId)) return false;
  if (!data) return false;
  const source = data.flat.find((i) => i.id === sourceId);
  const sibling = data.flat.find((i) => i.id === siblingId);
  if (!source || !sibling) return false;
  // cannot place a folder next to something inside itself
  if (source.isFolder) {
    const sourcePathPrefix = [...source.path, source.title].join(" / ");
    const siblingFull = [...sibling.path, sibling.title].join(" / ");
    if (siblingFull === sourcePathPrefix || siblingFull.startsWith(sourcePathPrefix + " / ")) {
      return false;
    }
  }
  return true;
}

/**
 * @param {chrome.bookmarks.BookmarkTreeNode} node
 * @param {number} [depth]
 */
function renderFolderNode(node, depth = 0) {
  if (node.url) {
    return `
      <div
        class="tree-row"
        draggable="true"
        data-node-id="${node.id}"
        title="${escapeAttr(t("dragToMove"))}"
      >
        <img class="tree-fav" src="${faviconUrl(node.url)}" alt="" width="22" height="22" />
        <span
          class="tree-title"
          data-action="open"
          data-id="${node.id}"
          data-url="${escapeAttr(node.url)}"
          role="link"
        >${escapeHtml(displayTitle(node.title, node.url))}</span>
        ${treeActionButtons(node.id, node.title || "", false)}
      </div>`;
  }

  const children = node.children || [];
  const links = children.filter((c) => c.url).length;
  const folders = children.filter((c) => !c.url).length;
  const isTop = !node.parentId || node.parentId === "0";
  const shouldOpen = isTop || openFolderIds.has(node.id) || (openFolderIds.size === 0 && depth === 0);
  const canDrag = !isProtectedFolder(node.id);

  return `
    <details class="tree-folder" data-folder-id="${node.id}" ${shouldOpen ? "open" : ""}>
      <summary
        class="tree-folder-summary"
        draggable="${canDrag ? "true" : "false"}"
        data-node-id="${node.id}"
        title="${escapeAttr(t("dropHere"))}"
      >
        <span class="tree-folder-icon" aria-hidden="true">${folderIconSvg()}</span>
        <span class="tree-title">${escapeHtml(node.title || t("folder"))}</span>
        <span class="tree-count">${escapeHtml(t("linksFolders", { links, folders }))}</span>
        ${treeActionButtons(node.id, node.title || "", true)}
      </summary>
      ${children.map((c) => renderFolderNode(c, depth + 1)).join("")}
    </details>`;
}

function iconRenameSvg() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>`;
}

function iconDeleteSvg() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
}

/**
 * @param {string} id
 * @param {string} title
 * @param {boolean} isFolder
 */
function treeActionButtons(id, title, isFolder) {
  const protectedFolder = isFolder && isProtectedFolder(id);
  const renameLabel = escapeAttr(t("rename"));
  const deleteLabel = escapeAttr(t("delete"));
  return `
    <span class="tree-actions">
      <button
        type="button"
        class="icon-action"
        data-action="rename"
        data-id="${id}"
        data-title="${escapeAttr(title)}"
        title="${renameLabel}"
        aria-label="${renameLabel}"
      >${iconRenameSvg()}</button>
      ${
        protectedFolder
          ? ""
          : `<button
        type="button"
        class="icon-action is-danger"
        data-action="delete"
        data-id="${id}"
        data-title="${escapeAttr(title)}"
        data-folder="${isFolder ? "1" : "0"}"
        title="${deleteLabel}"
        aria-label="${deleteLabel}"
      >${iconDeleteSvg()}</button>`
      }
    </span>`;
}

function renderInsights() {
  if (!report) return;

  const hasDupes = report.duplicates.length > 0;
  const hasEmpty = report.emptyFolders.length > 0;
  const hasTiny = report.tinyFolders.length > 0;
  const hasOverlap = report.overlaps.length > 0;

  // 重复网址始终展示；其余分类无内容时整块隐藏
  els.insightsEmpty.hidden = true;
  els.blockDupes.hidden = false;
  els.blockDupes.classList.toggle("is-empty", !hasDupes);
  els.blockEmpty.hidden = !hasEmpty;
  els.blockTiny.hidden = !hasTiny;
  els.blockOverlap.hidden = !hasOverlap;

  // duplicates
  els.btnCleanDupes.hidden = !hasDupes;
  if (hasDupes) {
    els.listDupes.innerHTML = report.duplicates
      .map((g) => {
        const titles = g.items
          .map((i) => `· ${escapeHtml(i.title)}（${escapeHtml(i.pathLabel)}）`)
          .join("<br/>");
        return `
          <div class="issue">
            <div class="issue-title">${escapeHtml(t("dupesCount", { n: g.items.length }))}</div>
            <div class="issue-meta">${escapeHtml(g.url)}</div>
            <div class="issue-meta">${titles}</div>
            <div class="issue-actions">
              <button type="button" class="btn tiny danger" data-clean-dupe="${g.removeIds.join(",")}">${escapeHtml(t("removeExtra"))}</button>
            </div>
          </div>`;
      })
      .join("");

    els.listDupes.querySelectorAll("[data-clean-dupe]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ids = (btn.getAttribute("data-clean-dupe") || "").split(",").filter(Boolean);
        const ok = await confirmAction(
          t("confirmDeleteDupeTitle"),
          t("confirmDeleteDupeMsg", { n: ids.length })
        );
        if (!ok) return;
        await removeMany(ids);
        await refresh({ silent: true });
        toast(t("toastDeduped"));
      });
    });
  } else {
    els.listDupes.innerHTML = `<span class="empty-inline">${escapeHtml(t("noneFound"))}</span>`;
  }

  // empty
  els.btnCleanEmpty.hidden = !hasEmpty;
  if (hasEmpty) {
    els.listEmpty.innerHTML = report.emptyFolders
      .map(
        (f) => `
        <div class="issue">
          <div class="issue-title">${escapeHtml(f.title)}</div>
          <div class="issue-meta">${escapeHtml(f.pathLabel)}</div>
          <div class="issue-actions">
            <button type="button" class="btn tiny danger" data-del-folder="${f.id}">${escapeHtml(t("delete"))}</button>
          </div>
        </div>`
      )
      .join("");

    els.listEmpty.querySelectorAll("[data-del-folder]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del-folder");
        if (!id) return;
        const ok = await confirmAction(t("confirmEmptyTitle"), t("confirmDeleteEmptyOne"));
        if (!ok) return;
        await removeTree(id);
        await refresh({ silent: true });
        toast(t("toastEmptyDeleted"));
      });
    });
  } else {
    els.listEmpty.innerHTML = "";
  }

  // tiny
  if (hasTiny) {
    els.listTiny.innerHTML = report.tinyFolders
      .map((f) => {
        const parentId = f.parentId;
        return `
        <div class="issue">
          <div class="issue-title">${escapeHtml(f.title)} · ${escapeHtml(t("items", { n: f.childCount }))}</div>
          <div class="issue-meta">${escapeHtml(f.pathLabel)}</div>
          <div class="issue-actions">
            <button type="button" class="btn tiny" data-merge-into-parent="${f.id}" data-parent="${parentId}">${escapeHtml(t("mergeToParent"))}</button>
          </div>
        </div>`;
      })
      .join("");

    els.listTiny.querySelectorAll("[data-merge-into-parent]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-merge-into-parent");
        const parent = btn.getAttribute("data-parent");
        if (!id || !parent || parent === "0") return;
        const ok = await confirmAction(
          t("confirmMergeParentTitle"),
          t("confirmMergeParentMsg")
        );
        if (!ok) return;
        await mergeFolderInto(id, parent);
        await refresh({ silent: true });
        toast(t("toastMerged"));
      });
    });
  } else {
    els.listTiny.innerHTML = "";
  }

  // overlap
  if (hasOverlap) {
    els.listOverlap.innerHTML = report.overlaps
      .map(
        (p) => `
        <div class="issue">
          <div class="issue-title">${escapeHtml(p.a.title)} ↔ ${escapeHtml(p.b.title)}</div>
          <div class="issue-meta">${escapeHtml(t(p.reason))} · ${escapeHtml(p.a.pathLabel)} / ${escapeHtml(p.b.pathLabel)}</div>
          <div class="issue-actions">
            <button type="button" class="btn tiny" data-merge-a="${p.a.id}" data-merge-b="${p.b.id}" data-dir="a-into-b">${escapeHtml(t("mergeAIntoB", { a: p.a.title, b: p.b.title }))}</button>
            <button type="button" class="btn tiny" data-merge-a="${p.a.id}" data-merge-b="${p.b.id}" data-dir="b-into-a">${escapeHtml(t("mergeAIntoB", { a: p.b.title, b: p.a.title }))}</button>
          </div>
        </div>`
      )
      .join("");

    els.listOverlap.querySelectorAll("[data-merge-a]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const a = btn.getAttribute("data-merge-a");
        const b = btn.getAttribute("data-merge-b");
        const dir = btn.getAttribute("data-dir");
        if (!a || !b) return;
        const source = dir === "a-into-b" ? a : b;
        const target = dir === "a-into-b" ? b : a;
        const ok = await confirmAction(t("confirmMergeFolderTitle"), t("confirmMergeFolderMsg"));
        if (!ok) return;
        await mergeFolderInto(source, target);
        await refresh({ silent: true });
        toast(t("toastFolderMerged"));
      });
    });
  } else {
    els.listOverlap.innerHTML = "";
  }
}

/**
 * @param {string} title
 * @param {string} msg
 * @returns {Promise<boolean>}
 */
function confirmAction(title, msg) {
  els.confirmTitle.textContent = title;
  els.confirmMsg.textContent = msg;
  els.confirmDialog.returnValue = "";
  els.confirmDialog.showModal();
  return new Promise((resolve) => {
    const onClose = () => {
      els.confirmDialog.removeEventListener("close", onClose);
      resolve(els.confirmDialog.returnValue === "ok");
    };
    els.confirmDialog.addEventListener("close", onClose);
  });
}

let toastTimer = 0;
function toast(text) {
  els.toast.hidden = false;
  els.toast.textContent = text;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 1800);
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** @param {string} s */
function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", "&#39;");
}
