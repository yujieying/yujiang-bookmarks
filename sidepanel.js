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
let selectedSearchIds = new Set();
let searchEditMode = false;
const FREE_BATCH_LIMIT = 50;
const MEMBERSHIP_STORAGE_KEY = "yjMembershipState";
const MEMBERSHIP_CONSENT_KEY = "yjMembershipIdentityConsent";
const LEGACY_MEMBERSHIP_SESSION_KEY = "yjMembershipSession";
const PAYMENT_CONFIG = globalThis.YJ_PAYMENT_CONFIG || { apiBaseUrl: "" };
let membershipState = { batchUsed: 0, vip: false, email: "", profileId: "" };
let pendingBatchMove = false;
let pendingBatchReservationId = null;
let pendingBatchLocal = false;
let membershipConsentGranted = false;
let membershipIdentity = null;
/** @type {Set<string>} */
let pendingMoveIds = new Set();
/** @type {Set<string>} */
let selectedTreeIds = new Set();
/** @type {Set<string>} */
let openFolderIds = new Set();
/** @type {string | null} */
let dragSourceId = null;
/** @type {{ targetId: string, place: 'before' | 'after' | 'into' | 'into-start' } | null} */
let lastDropIntent = null;
/** @type {string | null} */
let renamingId = null;
/** @type {string | null} */
let renamingOriginalTitle = null;
/** @type {Set<string>} */
let expandedDomains = new Set();
/** @type {Set<string>} */
let domainEditModes = new Set();
/** @type {Set<string>} */
let overviewSelectedIds = new Set();

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
  searchModeToggle: /** @type {HTMLButtonElement} */ (document.getElementById("search-mode-toggle")),
  searchBatchControls: document.getElementById("search-batch-controls"),
  searchSelectAll: /** @type {HTMLInputElement} */ (document.getElementById("search-select-all")),
  searchBatchMove: /** @type {HTMLButtonElement} */ (document.getElementById("search-batch-move")),
  searchBatchDelete: /** @type {HTMLButtonElement} */ (document.getElementById("search-batch-delete")),
  treeSelectAll: /** @type {HTMLInputElement} */ (document.getElementById("tree-select-all")),
  treeBatchMove: /** @type {HTMLButtonElement} */ (document.getElementById("tree-batch-move")),
  treeBatchDelete: /** @type {HTMLButtonElement} */ (document.getElementById("tree-batch-delete")),
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
  membershipBadge: document.getElementById("membership-badge"),
  membershipDialog: /** @type {HTMLDialogElement} */ (document.getElementById("membership-dialog")),
  membershipTitle: document.getElementById("membership-title"),
  membershipSummary: document.getElementById("membership-summary"),
  membershipPrivacyNote: document.getElementById("membership-privacy-note"),
  membershipEnable: /** @type {HTMLButtonElement} */ (document.getElementById("membership-enable")),
  membershipDisable: /** @type {HTMLButtonElement} */ (document.getElementById("membership-disable")),
  membershipUpgrade: /** @type {HTMLButtonElement} */ (document.getElementById("membership-upgrade")),
};

init();

async function init() {
  const lang = await loadSavedLang();
  await initI18n(lang);
  applyStaticI18n();
  els.langSelect.value = getLang();
  bindTabs();
  bindGlobal();
  await loadMembershipState();
  await refresh();
  chrome.bookmarks.onCreated.addListener(softRefresh);
  chrome.bookmarks.onRemoved.addListener(softRefresh);
  chrome.bookmarks.onChanged.addListener(softRefresh);
  chrome.bookmarks.onMoved.addListener(softRefresh);
}

async function loadMembershipState() {
  const saved = await chrome.storage.local.get([MEMBERSHIP_STORAGE_KEY, MEMBERSHIP_CONSENT_KEY]);
  await chrome.storage.local.remove(LEGACY_MEMBERSHIP_SESSION_KEY);
  membershipConsentGranted = saved[MEMBERSHIP_CONSENT_KEY] === true;
  const value = saved[MEMBERSHIP_STORAGE_KEY];
  if (value && typeof value === "object") {
    membershipState = {
      batchUsed: Number.isFinite(value.batchUsed) ? Math.max(0, value.batchUsed) : 0,
      vip: value.vip === true && typeof value.profileId === "string" && Boolean(value.profileId),
      email: typeof value.email === "string" && typeof value.profileId === "string" && value.profileId ? value.email : "",
      profileId: typeof value.profileId === "string" ? value.profileId : "",
    };
  }
  renderMembershipBadge();
  if (membershipConsentGranted && PAYMENT_CONFIG.apiBaseUrl) {
    try {
      membershipIdentity = await readChromeIdentity();
      if (membershipIdentity.profileId !== membershipState.profileId) {
        membershipState = { batchUsed: 0, vip: false, email: membershipIdentity.email, profileId: membershipIdentity.profileId };
        await chrome.storage.local.set({ [MEMBERSHIP_STORAGE_KEY]: membershipState });
      }
      if (await backendPermissionGranted()) await syncMembershipFromServer();
    } catch {
      /* Keep the cached membership label available while offline. */
    }
  }
}

function renderMembershipBadge() {
  els.membershipBadge.textContent = membershipState.vip ? "VIP 用户" : "普通用户";
  els.membershipBadge.classList.toggle("is-vip", membershipState.vip);
}

function openMembershipDialog() {
  els.membershipTitle.textContent = membershipState.vip ? "VIP 用户" : "普通用户";
  els.membershipSummary.textContent = membershipState.vip
    ? `会员身份：${membershipState.email || "当前 Chrome 账号"}。您已解锁批处理不限次数。`
    : `${membershipConsentGranted ? `会员身份：${membershipState.email || "当前 Chrome 账号"}。` : "启用同步后可跨设备同步会员身份和免费次数。"}批处理已使用 ${membershipState.batchUsed}/${FREE_BATCH_LIMIT} 次，剩余 ${Math.max(0, FREE_BATCH_LIMIT - membershipState.batchUsed)} 次。`;
  els.membershipPrivacyNote.hidden = membershipConsentGranted;
  els.membershipEnable.hidden = membershipConsentGranted;
  els.membershipDisable.hidden = !membershipConsentGranted;
  els.membershipUpgrade.hidden = membershipState.vip;
  els.membershipUpgrade.disabled = !membershipConsentGranted || !PAYMENT_CONFIG.apiBaseUrl;
  els.membershipUpgrade.textContent = "立即升级";
  if (typeof els.membershipDialog.showModal === "function") els.membershipDialog.showModal();
}

async function ensureBatchAccess() {
  if (!PAYMENT_CONFIG.apiBaseUrl) {
    if (membershipState.vip || membershipState.batchUsed < FREE_BATCH_LIMIT) {
      pendingBatchLocal = true;
      return true;
    }
    openMembershipDialog();
    toast("本机 50 次免费批处理额度已用完；连接会员服务后可升级 VIP");
    return false;
  }
  if (!membershipConsentGranted) {
    openMembershipDialog();
    toast("请先同意启用会员同步，才能使用服务端免费额度");
    return false;
  }
  try { membershipIdentity = membershipIdentity || await readChromeIdentity(); }
  catch (error) { toast(error.message); return false; }
  if (!(await backendPermissionGranted())) {
    membershipConsentGranted = false;
    await chrome.storage.local.set({ [MEMBERSHIP_CONSENT_KEY]: false });
    openMembershipDialog();
    toast("请先授权连接会员服务");
    return false;
  }
  try {
    const reservation = await membershipApi("/membership/batch-operation", { method: "POST", body: "{}" });
    applyRemoteMembership(reservation.user);
    pendingBatchReservationId = reservation.reservationId;
    pendingBatchLocal = false;
    return true;
  } catch (error) {
    if (error.status === 402) {
      await syncMembershipFromServer();
      openMembershipDialog();
      toast("免费批处理次数已用完，可升级 VIP 解锁不限次数");
      return false;
    }
    toast("会员服务暂时不可用，请稍后重试");
    return false;
  }
}

async function recordBatchOperation(completed) {
  const reservationId = pendingBatchReservationId;
  pendingBatchReservationId = null;
  if (pendingBatchLocal) {
    pendingBatchLocal = false;
    if (completed && !membershipState.vip) {
      membershipState.batchUsed += 1;
      await chrome.storage.local.set({ [MEMBERSHIP_STORAGE_KEY]: membershipState });
      renderMembershipBadge();
    }
    return;
  }
  if (!reservationId || !membershipIdentity) return;
  try {
    await membershipApi(`/membership/batch-operation/${encodeURIComponent(reservationId)}/${completed ? "complete" : "cancel"}`, { method: "POST", body: "{}" });
    await syncMembershipFromServer();
  } catch {
    toast("批处理额度同步失败；请打开会员信息刷新状态");
  }
}

function backendOriginPattern() {
  try { return `${new URL(PAYMENT_CONFIG.apiBaseUrl).origin}/*`; }
  catch { return null; }
}

async function backendPermissionGranted() {
  const origin = backendOriginPattern();
  return Boolean(origin && await chrome.permissions.contains({ origins: [origin] }));
}

function requestBackendPermission() {
  const origin = backendOriginPattern();
  if (!origin) return Promise.reject(new Error("会员服务地址未配置"));
  return chrome.permissions.request({ origins: [origin] });
}

async function membershipApi(path, options = {}) {
  const base = PAYMENT_CONFIG.apiBaseUrl.replace(/\/$/, "");
  let body = options.body;
  if (options.method === "POST" && path !== "/webhooks/waffo") {
    membershipIdentity = membershipIdentity || await readChromeIdentity();
    const data = typeof body === "string" ? JSON.parse(body || "{}") : (body || {});
    body = JSON.stringify({ ...data, ...membershipIdentity });
  }
  const response = await fetch(`${base}${path}`, {
    ...options,
    body,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

async function applyRemoteMembership(user) {
  if (!user || typeof user !== "object") return;
  membershipState = {
    batchUsed: Number.isFinite(user.batchUsed) ? Math.max(0, user.batchUsed) : 0,
    vip: user.vip === true,
    email: typeof user.email === "string" ? user.email : "",
    profileId: membershipIdentity?.profileId || "",
  };
  await chrome.storage.local.set({ [MEMBERSHIP_STORAGE_KEY]: membershipState });
  renderMembershipBadge();
}

async function syncMembershipFromServer() {
  const result = await membershipApi("/membership/status", { method: "POST", body: "{}" });
  await applyRemoteMembership(result.user);
  return result.user;
}

async function readChromeIdentity() {
  const profile = await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : "";
  const profileId = typeof profile.id === "string" ? profile.id.trim() : "";
  if (!email || !profileId) throw new Error("没有读取到 Chrome 主账号信息，请先在 Chrome 中登录 Google 账号后重试");
  return { email, profileId };
}

async function enableMembershipSync() {
  const permissionPromise = PAYMENT_CONFIG.apiBaseUrl ? requestBackendPermission() : Promise.resolve(true);
  membershipIdentity = await readChromeIdentity();
  if (!await permissionPromise) throw new Error("未授权连接会员服务");
  membershipConsentGranted = true;
  membershipState = { batchUsed: 0, vip: false, email: membershipIdentity.email, profileId: membershipIdentity.profileId };
  await chrome.storage.local.set({ [MEMBERSHIP_CONSENT_KEY]: true, [MEMBERSHIP_STORAGE_KEY]: membershipState });
  if (PAYMENT_CONFIG.apiBaseUrl) await syncMembershipFromServer();
}

async function startVipCheckout() {
  if (!membershipConsentGranted) throw new Error("请先启用会员同步");
  membershipIdentity = membershipIdentity || await readChromeIdentity();
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const orderToken = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const result = await membershipApi("/checkout", {
    method: "POST",
    body: JSON.stringify({ id: crypto.randomUUID(), orderToken }),
  });
  const url = new URL(result.checkoutUrl);
  if (url.protocol !== "https:" || !["checkout.waffo.ai", "pancake.waffo.ai"].includes(url.hostname)) {
    throw new Error("支付地址校验失败");
  }
  await chrome.tabs.create({ url: url.href });
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

  els.membershipBadge.addEventListener("click", async () => {
    try {
      if (membershipConsentGranted && PAYMENT_CONFIG.apiBaseUrl) {
        membershipIdentity = await readChromeIdentity();
        if (await backendPermissionGranted()) await syncMembershipFromServer();
      }
    }
    catch { /* Show the last known account state if offline. */ }
    openMembershipDialog();
  });
  els.membershipEnable.addEventListener("click", async () => {
    els.membershipEnable.disabled = true;
    try {
      await enableMembershipSync();
      openMembershipDialog();
      toast("会员同步已启用");
    } catch (error) {
      toast(`未能启用会员同步：${error.message}`);
    } finally { els.membershipEnable.disabled = false; }
  });
  els.membershipDisable.addEventListener("click", async () => {
    membershipConsentGranted = false;
    membershipIdentity = null;
    membershipState = { ...membershipState, vip: false, email: "", profileId: "" };
    await chrome.storage.local.set({ [MEMBERSHIP_CONSENT_KEY]: false, [MEMBERSHIP_STORAGE_KEY]: membershipState });
    renderMembershipBadge();
    openMembershipDialog();
    toast("会员同步已关闭；服务端会员记录不会被删除");
  });
  els.membershipUpgrade.addEventListener("click", async () => {
    els.membershipUpgrade.disabled = true;
    try {
      await startVipCheckout();
      els.membershipDialog.close();
      toast("已打开 Waffo 正式收银台；付款后回到插件刷新会员状态");
    } catch (error) {
      toast(`无法创建购买：${error.message}`);
    } finally { els.membershipUpgrade.disabled = false; }
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
    if (els.moveDialog.returnValue !== "ok" || (!pendingMoveId && !pendingMoveIds.size)) {
      if (pendingBatchMove) await recordBatchOperation(false);
      pendingMoveId = null;
      pendingMoveIds.clear();
      pendingBatchMove = false;
      return;
    }
    const parentId = els.moveSelect.value;
    const id = pendingMoveId;
    const ids = pendingMoveIds.size ? [...pendingMoveIds] : [id];
    const isBatchMove = pendingBatchMove;
    pendingMoveId = null;
    pendingMoveIds.clear();
    pendingBatchMove = false;
    if (!parentId) {
      if (isBatchMove) await recordBatchOperation(false);
      return;
    }
    try {
      for (const moveId of ids) await moveBookmark(moveId, { parentId });
      if (isBatchMove) await recordBatchOperation(true);
    } catch (error) {
      if (isBatchMove) await recordBatchOperation(false);
      toast(`移动失败：${error.message}`);
      return;
    }
    selectedSearchIds.clear();
    selectedTreeIds.clear();
    overviewSelectedIds.clear();
    await refresh({ silent: true });
    toast(t("toastMoved"));
  });

  els.searchSelectAll.addEventListener("change", () => {
    els.searchResults.querySelectorAll("input[data-search-select]").forEach((input) => {
      input.checked = els.searchSelectAll.checked;
      if (input.checked) selectedSearchIds.add(input.value);
      else selectedSearchIds.delete(input.value);
    });
    updateSearchBatchControls();
  });
  els.searchModeToggle.addEventListener("click", () => {
    searchEditMode = !searchEditMode;
    if (!searchEditMode) {
      selectedSearchIds.clear();
    }
    const q = els.searchInput.value.trim();
    if (q) renderSearch(q);
    else updateSearchBatchControls();
  });
  els.searchBatchMove.addEventListener("click", async () => {
    if (!selectedSearchIds.size) {
      toast("请先勾选要移动的书签");
      return;
    }
    if (!await ensureBatchAccess()) return;
    pendingBatchMove = true;
    openMoveDialog([...selectedSearchIds], `${selectedSearchIds.size} 个书签`);
  });
  els.searchBatchDelete.addEventListener("click", async () => {
    const ids = [...selectedSearchIds];
    if (!ids.length) {
      toast("请先勾选要删除的书签");
      return;
    }
    if (!(await confirmAction("删除选中书签", `确定删除选中的 ${ids.length} 个书签吗？`))) return;
    if (!await ensureBatchAccess()) return;
    await removeMany(ids);
    await recordBatchOperation(true);
    selectedSearchIds.clear();
    await refresh({ silent: true });
    toast(t("toastDeleted"));
  });
  els.treeSelectAll.addEventListener("change", () => {
    els.folderTree.querySelectorAll("input[data-tree-select]").forEach((input) => {
      input.checked = els.treeSelectAll.checked;
      if (input.checked) selectedTreeIds.add(input.value);
      else selectedTreeIds.delete(input.value);
    });
    updateTreeBatchControls();
  });
  els.treeBatchMove.addEventListener("click", async () => {
    if (!selectedTreeIds.size) return toast("请先勾选要移动的书签");
    if (!await ensureBatchAccess()) return;
    pendingBatchMove = true;
    openMoveDialog([...selectedTreeIds], `${selectedTreeIds.size} 个书签`);
  });
  els.treeBatchDelete.addEventListener("click", async () => {
    const ids = [...selectedTreeIds];
    if (!ids.length) return toast("请先勾选要删除的书签");
    if (!(await confirmAction("删除选中书签", `确定删除选中的 ${ids.length} 个书签吗？`))) return;
    if (!await ensureBatchAccess()) return;
    await removeMany(ids);
    await recordBatchOperation(true);
    selectedTreeIds.clear();
    await refresh({ silent: true });
    toast(t("toastDeleted"));
  });

  updateSearchBatchControls();

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
          const allSelected = items.length > 0 && items.every((item) => overviewSelectedIds.has(item.id));
          return `
      <li class="domain-row${open ? " is-open" : ""}">
        <button type="button" class="domain-row-head" data-toggle-domain="${escapeAttr(d.domain)}">
          <span class="domain-chevron" aria-hidden="true">▸</span>
          <span class="domain-name">${escapeHtml(d.domain)}</span>
          <span class="bar"><i style="width:${Math.round((d.count / max) * 100)}%"></i></span>
          <span class="domain-count">${d.count}</span>
        </button>
        <button type="button" class="domain-edit-toggle" data-domain-edit="${escapeAttr(d.domain)}" title="${domainEditModes.has(d.domain) ? "查看模式" : "编辑模式"}">${domainEditModes.has(d.domain) ? iconEyeSvg() : iconEditOutlineSvg()}</button>
        ${
          open
            ? `<ul class="domain-detail">
            ${domainEditModes.has(d.domain) ? `<li class="domain-batch-toolbar"><label><input type="checkbox" data-domain-select-all="${escapeAttr(d.domain)}" ${allSelected ? "checked" : ""} /> 全选</label><button type="button" class="btn tiny" data-domain-batch-move="${escapeAttr(d.domain)}" disabled>移动</button><button type="button" class="btn tiny danger" data-domain-batch-delete="${escapeAttr(d.domain)}" disabled>删除</button></li>` : ""}
            ${
              items.length
                ? items
                    .map(
                      (b) => `
              <li class="domain-item" data-node-id="${b.id}">
                ${domainEditModes.has(d.domain) ? `<input type="checkbox" class="overview-select" data-domain-select="${escapeAttr(d.domain)}" value="${escapeAttr(b.id)}" ${overviewSelectedIds.has(b.id) ? "checked" : ""} />` : ""}
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

  els.domainList.querySelectorAll("[data-domain-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const domain = btn.getAttribute("data-domain-edit");
      if (!domain) return;
      if (domainEditModes.has(domain)) domainEditModes.delete(domain);
      else domainEditModes.add(domain);
      overviewSelectedIds.clear();
      renderOverview();
    });
  });
  els.domainList.querySelectorAll("[data-domain-select-all]").forEach((input) => {
    input.addEventListener("change", () => {
      const domain = input.getAttribute("data-domain-select-all");
      const ids = bookmarksForDomain(domain).map((b) => b.id);
      ids.forEach((id) => input.checked ? overviewSelectedIds.add(id) : overviewSelectedIds.delete(id));
      renderOverview();
    });
  });
  els.domainList.querySelectorAll("[data-domain-select]").forEach((input) => {
    input.addEventListener("change", (e) => {
      e.stopPropagation();
      if (input.checked) overviewSelectedIds.add(input.value);
      else overviewSelectedIds.delete(input.value);
      renderOverview();
    });
  });
  els.domainList.querySelectorAll("[data-domain-batch-move]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!overviewSelectedIds.size) return toast("请先勾选书签");
      if (!await ensureBatchAccess()) return;
      pendingBatchMove = true;
      openMoveDialog([...overviewSelectedIds], `${overviewSelectedIds.size} 个书签`);
    });
  });
  els.domainList.querySelectorAll("[data-domain-batch-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ids = [...overviewSelectedIds];
      if (!ids.length) return toast("请先勾选书签");
      if (!(await confirmAction("删除选中书签", `确定删除选中的 ${ids.length} 个书签吗？`))) return;
      if (!await ensureBatchAccess()) return;
      await removeMany(ids);
      await recordBatchOperation(true);
      overviewSelectedIds.clear();
      await refresh({ silent: true });
      toast(t("toastDeleted"));
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
  const visibleIds = new Set(results.slice(0, 80).map((b) => b.id));
  selectedSearchIds = new Set([...selectedSearchIds].filter((id) => visibleIds.has(id)));
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
  els.searchResults.querySelectorAll("input[data-search-select]").forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) selectedSearchIds.add(input.value);
      else selectedSearchIds.delete(input.value);
      updateSearchBatchControls();
    });
  });
  els.searchBatchControls.hidden = !searchEditMode;
  els.searchModeToggle.innerHTML = searchEditMode ? iconEyeSvg() : iconEditOutlineSvg();
  els.searchModeToggle.title = searchEditMode ? "查看模式" : "编辑模式";
  els.searchModeToggle.setAttribute("aria-label", els.searchModeToggle.title);
  updateSearchBatchControls();
}

function updateSearchBatchControls() {
  const count = selectedSearchIds.size;
  els.searchBatchControls.hidden = !searchEditMode;
  els.searchResults.classList.toggle("is-edit-mode", searchEditMode);
  els.searchModeToggle.innerHTML = searchEditMode ? iconEyeSvg() : iconEditOutlineSvg();
  els.searchModeToggle.title = searchEditMode ? "查看模式" : "编辑模式";
  els.searchModeToggle.setAttribute("aria-label", els.searchModeToggle.title);
  const boxes = [...els.searchResults.querySelectorAll("input[data-search-select]")];
  els.searchSelectAll.checked = boxes.length > 0 && boxes.every((box) => box.checked);
  els.searchSelectAll.indeterminate = count > 0 && !els.searchSelectAll.checked;
}

function bookmarkRow(b) {
  const icon = b.url ? faviconUrl(b.url) : "";
  const title = escapeHtml(displayTitle(b.title, b.url));
  const url = escapeHtml(b.url || "");
  const openAttrs = `data-action="open" data-id="${b.id}" data-url="${escapeAttr(b.url || "")}"`;
  return `
    <li>
      ${searchEditMode ? `<input type="checkbox" class="search-select" data-search-select value="${escapeAttr(b.id)}" ${selectedSearchIds.has(b.id) ? "checked" : ""} aria-label="选择此书签" />` : ""}
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
        <button type="button" class="btn tiny" data-action="reveal" data-id="${b.id}">${escapeHtml(t("jumpToTree"))}</button>
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

function openMoveDialog(idOrIds, title) {
  if (!data) return;
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  pendingMoveIds = new Set(ids);
  pendingMoveId = ids.length === 1 ? ids[0] : null;
  els.moveTargetLabel.textContent = title;

  // Exclude self and descendants when moving a folder.
  const blocked = new Set(ids);
  const queue = [...ids];
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
  const bookmarkIds = new Set(data.bookmarks.map((bookmark) => bookmark.id));
  selectedTreeIds = new Set([...selectedTreeIds].filter((id) => bookmarkIds.has(id)));
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
  els.folderTree.querySelectorAll("input[data-tree-select]").forEach((input) => {
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("change", () => {
      if (input.checked) selectedTreeIds.add(input.value);
      else selectedTreeIds.delete(input.value);
      updateTreeBatchControls();
    });
  });
  updateTreeBatchControls();

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
  lastDropIntent = null;
}

function clearDropIndicators() {
  els.folderTree
    .querySelectorAll(".is-drop-target, .is-drop-before, .is-drop-after")
    .forEach((n) => n.classList.remove("is-drop-target", "is-drop-before", "is-drop-after"));
}

/**
 * @param {HTMLElement} el
 * @param {number} clientY
 * @returns {'before' | 'after' | 'into' | 'into-start'}
 */
function dropPlaceFor(el, clientY) {
  const rect = el.getBoundingClientRect();
  const ratio = (clientY - rect.top) / Math.max(rect.height, 1);
  const isFolder = el.tagName === "SUMMARY" || el.classList.contains("tree-folder-summary");
  if (isFolder) {
    if (ratio < 0.22) return "before";
    if (ratio > 0.78) {
      // Expanded folder: bottom edge looks like "insert above first child",
      // not "place after this folder among siblings".
      const details = el.closest("details");
      if (details?.open) return "into-start";
      return "after";
    }
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
  if (place === "into" || place === "into-start") {
    if (!canDropIntoFolder(sourceId, targetId)) return;
  } else if (!canReorderBeside(sourceId, targetId)) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

  clearDropIndicators();
  lastDropIntent = { targetId, place };
  if (place === "before") el.classList.add("is-drop-before");
  else if (place === "after" || place === "into-start") el.classList.add("is-drop-after");
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
  const sourceId = e.dataTransfer?.getData("text/plain") || dragSourceId;
  // Prefer last dragover intent — drop clientY often drifts out of thin before/after zones.
  const intent =
    lastDropIntent ||
    (() => {
      const targetId = el.getAttribute("data-node-id");
      if (!targetId) return null;
      return { targetId, place: dropPlaceFor(el, e.clientY) };
    })();
  clearDropIndicators();
  dragSourceId = null;
  lastDropIntent = null;
  if (!sourceId || !intent?.targetId || sourceId === intent.targetId) return;

  const { targetId, place } = intent;

  try {
    if (place === "into" || place === "into-start") {
      if (!canDropIntoFolder(sourceId, targetId)) {
        toast(t("toastCannotDrop"));
        return;
      }
      if (place === "into-start") {
        await moveBookmark(sourceId, { parentId: targetId, index: 0 });
      } else {
        await moveBookmark(sourceId, { parentId: targetId });
      }
      openFolderIds.add(targetId);
      await refresh({ silent: true });
      toast(t("toastMoved"));
      return;
    }

    if (!canReorderBeside(sourceId, targetId)) {
      toast(t("toastCannotDrop"));
      return;
    }
    const moved = await moveBeside(sourceId, targetId, place);
    if (moved) {
      const target = data?.flat.find((i) => i.id === targetId);
      if (target?.parentId) openFolderIds.add(target.parentId);
      await refresh({ silent: true });
    }
    toast(t("toastReordered"));
  } catch (err) {
    console.error(err);
    toast(t("toastMoveFail"));
  }
}

/**
 * @param {string} sourceId
 * @param {string} siblingId
 * @param {'before' | 'after'} place
 * @returns {Promise<boolean>} false if already in place (no-op)
 */
async function moveBeside(sourceId, siblingId, place) {
  const [sibling] = await chrome.bookmarks.get(siblingId);
  const [source] = await chrome.bookmarks.get(sourceId);
  const parentId = sibling.parentId;
  if (!parentId) throw new Error("no parent");
  const children = await chrome.bookmarks.getChildren(parentId);
  const siblingIndex = children.findIndex((c) => c.id === siblingId);
  if (siblingIndex < 0) throw new Error("sibling missing");

  // Index in the current child list (source still included if same parent).
  // Chrome expects this form; do not use a post-removal index.
  const destIndex = place === "after" ? siblingIndex + 1 : siblingIndex;

  if (source.parentId === parentId) {
    const oldIndex = children.findIndex((c) => c.id === sourceId);
    if (oldIndex < 0) throw new Error("source missing");
    if (place === "before" && oldIndex === siblingIndex - 1) return false;
    if (place === "after" && oldIndex === siblingIndex + 1) return false;
  }

  await moveBookmark(sourceId, { parentId, index: destIndex });
  return true;
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
        <input type="checkbox" class="tree-select" data-tree-select value="${escapeAttr(node.id)}" ${selectedTreeIds.has(node.id) ? "checked" : ""} aria-label="选择此书签" />
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

function updateTreeBatchControls() {
  const count = selectedTreeIds.size;
  els.treeBatchMove.disabled = count === 0;
  els.treeBatchDelete.disabled = count === 0;
  const boxes = [...els.folderTree.querySelectorAll("input[data-tree-select]")];
  els.treeSelectAll.checked = boxes.length > 0 && boxes.every((box) => box.checked);
  els.treeSelectAll.indeterminate = count > 0 && !els.treeSelectAll.checked;
}

function iconRenameSvg() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>`;
}

function iconEyeSvg() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 5C6.5 5 2.1 8.4 1 12c1.1 3.6 5.5 7 11 7s9.9-3.4 11-7c-1.1-3.6-5.5-7-11-7zm0 11.5A4.5 4.5 0 1 1 12 7a4.5 4.5 0 0 1 0 9.5zm0-2A2.5 2.5 0 1 0 12 9a2.5 2.5 0 0 0 0 5.5z"/></svg>`;
}

function iconEditOutlineSvg() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5 4h9M5 4v16h14v-8M5 20h14M16.5 4.5a2.12 2.12 0 0 1 3 3L11 16l-4 1 1-4 8.5-8.5z"/></svg>`;
}

function iconMoveSvg() {
  return `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M13 5V2l-5 5 5 5V9c3.31 0 6 2.69 6 6 0 1.1-.3 2.13-.81 3.01A7.98 7.98 0 0 0 21 15c0-4.42-3.58-8-8-8v-2zM6 9.99A7.98 7.98 0 0 0 3 15c0 4.42 3.58 8 8 8v-2c-3.31 0-6-2.69-6-6 0-1.1.3-2.13.81-3.01L6 9.99z"/></svg>`;
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
  const moveLabel = escapeAttr(t("move"));
  const deleteLabel = escapeAttr(t("delete"));
  return `
    <span class="tree-actions">
      ${!protectedFolder ? `<button
        type="button"
        class="icon-action"
        data-action="move"
        data-id="${id}"
        data-title="${escapeAttr(title)}"
        title="${moveLabel}"
        aria-label="${moveLabel}"
      >${iconMoveSvg()}</button>` : ""}
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
            <div class="issue-main">
              <div class="issue-title">${escapeHtml(t("dupesCount", { n: g.items.length }))}</div>
              <div class="issue-meta">${escapeHtml(g.url)}</div>
              <div class="issue-meta">${titles}</div>
            </div>
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
          <div class="issue-main">
            <div class="issue-title">${escapeHtml(f.title)}</div>
            <div class="issue-meta">${escapeHtml(f.pathLabel)}</div>
          </div>
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
          <div class="issue-main">
            <div class="issue-title">${escapeHtml(f.title)} · ${escapeHtml(t("items", { n: f.childCount }))}</div>
            <div class="issue-meta">${escapeHtml(f.pathLabel)}</div>
          </div>
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
          <div class="issue-main">
            <div class="issue-title">${escapeHtml(p.a.title)} ↔ ${escapeHtml(p.b.title)}</div>
            <div class="issue-meta">${escapeHtml(t(p.reason))} · ${escapeHtml(p.a.pathLabel)} / ${escapeHtml(p.b.pathLabel)}</div>
          </div>
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
