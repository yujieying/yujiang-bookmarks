const API = "http://127.0.0.1:8787";
const STORAGE_KEY = "yjPaymentTestOrder";
const $ = (id) => document.getElementById(id);
let order = null;
let connected = false;
let busy = false;
let timer;
let checks = 0;

$("extension-id").textContent = chrome.runtime.id;

function message(text) { $("status").textContent = text; }
function buttons() {
  $("connect").disabled = busy;
  const canStartNewOrder = !order || ["paid", "refund_received"].includes(order.status);
  $("buy").disabled = busy || !connected || !$("test-confirmed").checked || (!canStartNewOrder && Boolean(order?.checkoutUrl));
  $("reopen").disabled = busy || !order?.checkoutUrl || !$("test-confirmed").checked;
  $("refresh-order").disabled = busy || !connected || !order;
  $("clear-order").disabled = busy;
  $("order-id").textContent = order ? `测试订单：${order.id}` : "";
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Test-Token": $("test-token").value.trim(),
      ...(order ? { "X-Order-Token": order.orderToken } : {}),
    },
    signal: AbortSignal.timeout(25000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function task(action) {
  if (busy) return;
  busy = true;
  buttons();
  try { await action(); }
  catch (error) {
    message(`未完成：${error.message}。请检查服务、口令和测试配置；没有确认支付结果，不代表付款失败。`);
  } finally { busy = false; buttons(); }
}

async function openCheckout() {
  const url = new URL(order.checkoutUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["checkout.waffo.ai", "pancake.waffo.ai"].includes(url.hostname) ||
      url.searchParams.get("test") !== "true") throw new Error("收银台地址不符合测试要求");
  await chrome.tabs.create({ url: url.href });
}

async function refreshOrder() {
  const result = await request(`/orders/${order.id}`);
  order.status = result.status;
  await chrome.storage.local.set({ [STORAGE_KEY]: order });
  if (result.mode !== "test") throw new Error("拒绝生产环境结果");
  const text = {
    creating: "订单创建中或上次创建结果未知，可用同一订单重试。",
    pending: "等待付款通知。请用模拟卡付款，确认测试 Webhook 已配置。",
    paid: "测试支付成功：后端已验证付款通知。没有开通正式会员，也没有改变书签功能。",
    refund_received: "后端已收到测试退款通知（可能是部分退款）。请在 Pancake 后台查看详情。",
  };
  message(text[result.status] || "未知订单状态，请检查后端。");
  if (result.status === "pending" && Date.parse(result.expiresAt) < Date.now()) {
    message("收银台会话已过期，暂未收到成功通知。请先在 Pancake 后台确认，勿据此认定付款失败。");
    return false;
  }
  return result.status === "pending";
}

function startPolling() {
  clearTimeout(timer);
  checks = 0;
  const next = async () => {
    if (!connected || !order || document.hidden) return;
    if (busy) { timer = setTimeout(next, 3000); return; }
    let pending = false;
    await task(async () => { pending = await refreshOrder(); });
    checks += 1;
    if (pending && checks < 40) timer = setTimeout(next, 3000);
  };
  timer = setTimeout(next, 3000);
}

$("connect").addEventListener("click", () => {
  // Permission request remains directly inside the user gesture.
  const permission = chrome.permissions.request({ origins: ["http://127.0.0.1/*"] });
  task(async () => {
    connected = false;
    if (!await permission) throw new Error("未授权访问本地测试服务");
    const info = await request("/health");
    if (info.mode !== "test") throw new Error("仅允许测试服务");
    connected = true;
    message("已连接测试服务。确认勾选后，可以创建模拟购买。");
    if (order) await refreshOrder();
  });
});
$("test-token").addEventListener("input", () => { connected = false; clearTimeout(timer); buttons(); });
$("test-confirmed").addEventListener("change", buttons);
$("buy").addEventListener("click", () => task(async () => {
  if (!connected || !$("test-confirmed").checked) return;
  if (order?.status === "paid" || order?.status === "refund_received") {
    order = null;
    await chrome.storage.local.remove(STORAGE_KEY);
  }
  if (!order) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    order = { id: crypto.randomUUID(), orderToken: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") };
  }
  // Persist before the request; after a timeout retry the same order/idempotency key.
  await chrome.storage.local.set({ [STORAGE_KEY]: order });
  const result = await request("/checkout", { method: "POST", body: JSON.stringify({ id: order.id, orderToken: order.orderToken }) });
  order.checkoutUrl = result.checkoutUrl;
  await chrome.storage.local.set({ [STORAGE_KEY]: order });
  await openCheckout();
  message("测试收银台已打开，请仅输入模拟卡。付款后回到此页查询。若收银台不显示 Test，请立即停止。");
  startPolling();
}));
$("reopen").addEventListener("click", () => task(openCheckout));
$("refresh-order").addEventListener("click", () => task(refreshOrder));
$("clear-order").addEventListener("click", () => task(async () => {
  if (!confirm("仅清除本机查询凭据，不取消远端订单。确认已在后台检查上一笔订单？")) return;
  await chrome.storage.local.remove(STORAGE_KEY);
  order = null;
  clearTimeout(timer);
  message("本机订单记录已清除，可开始下一笔测试。");
}));
document.addEventListener("visibilitychange", () => { if (!document.hidden && connected && order) startPolling(); });
window.addEventListener("pagehide", () => clearTimeout(timer));
chrome.storage.local.get(STORAGE_KEY).then((saved) => {
  order = saved[STORAGE_KEY] || null;
  buttons();
}).catch(() => message("无法读取本机订单记录，请检查扩展存储权限。"));
