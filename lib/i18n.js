const SUPPORTED = ["zh-CN", "en", "fr"];
const DEFAULT_LANG = "zh-CN";
const STORAGE_KEY = "uiLang";

/** @type {Record<string, string>} */
let messages = {};
let currentLang = DEFAULT_LANG;

/**
 * @param {string} lang
 */
export async function initI18n(lang) {
  const next = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
  const res = await fetch(chrome.runtime.getURL(`locales/${next}.json`));
  messages = await res.json();
  currentLang = next;
  document.documentElement.lang = next === "zh-CN" ? "zh-CN" : next;
  return currentLang;
}

export function getLang() {
  return currentLang;
}

export function supportedLangs() {
  return SUPPORTED.slice();
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars) {
  let text = messages[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}

/** Apply data-i18n / data-i18n-placeholder / data-i18n-title on the page. */
export function applyStaticI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    el.textContent = t(key);
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (!key) return;
    el.innerHTML = t(key);
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    /** @type {HTMLInputElement} */ (el).placeholder = t(key);
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) return;
    el.setAttribute("title", t(key));
    if (el.hasAttribute("aria-label")) {
      el.setAttribute("aria-label", t(key));
    }
  });
}

export async function loadSavedLang() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const lang = stored[STORAGE_KEY];
    if (SUPPORTED.includes(lang)) return lang;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

/**
 * @param {string} lang
 */
export async function saveLang(lang) {
  await chrome.storage.local.set({ [STORAGE_KEY]: lang });
}
