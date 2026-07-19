import { domainOf } from "./bookmarks.js";

/**
 * @typedef {import("./bookmarks.js").FlatItem} FlatItem
 */

/**
 * @param {{ folders: FlatItem[], bookmarks: FlatItem[] }} data
 */
export function analyzeBookmarks({ folders, bookmarks }) {
  const duplicates = findDuplicates(bookmarks);
  const emptyFolders = folders.filter(
    (f) => f.childCount === 0 && !isSystemRoot(f)
  );
  const tinyFolders = folders.filter(
    (f) => f.childCount > 0 && f.childCount <= 2 && !isSystemRoot(f)
  );
  const largeFolders = folders
    .filter((f) => f.childCount >= 20 && !isSystemRoot(f))
    .sort((a, b) => b.childCount - a.childCount);
  const overlaps = findOverlaps(folders);
  const domains = topDomains(bookmarks, 15);

  const issueCount =
    duplicates.length +
    emptyFolders.length +
    tinyFolders.length +
    overlaps.length;

  return {
    stats: {
      bookmarkCount: bookmarks.length,
      folderCount: folders.filter((f) => !isSystemRoot(f)).length,
      domainCount: new Set(bookmarks.map((b) => domainOf(b.url || "")).filter(Boolean)).size,
      issueCount,
      duplicateExtraCount: duplicates.reduce((n, g) => n + g.items.length - 1, 0),
    },
    duplicates,
    emptyFolders,
    tinyFolders,
    largeFolders,
    overlaps,
    domains,
  };
}

/** @param {FlatItem} f */
function isSystemRoot(f) {
  return f.parentId === "0" || f.id === "0" || f.id === "1" || f.id === "2" || f.id === "3";
}

/** @param {FlatItem[]} bookmarks */
function findDuplicates(bookmarks) {
  /** @type {Map<string, FlatItem[]>} */
  const byUrl = new Map();
  for (const b of bookmarks) {
    if (!b.url) continue;
    const key = normalizeUrl(b.url);
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key).push(b);
  }
  return [...byUrl.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([url, items]) => ({
      url,
      items,
      keepId: items[0].id,
      removeIds: items.slice(1).map((i) => i.id),
    }))
    .sort((a, b) => b.items.length - a.items.length);
}

/** @param {string} url */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    let href = u.href;
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href;
  } catch {
    return url;
  }
}

/** @param {FlatItem[]} folders */
function findOverlaps(folders) {
  const meaningful = folders.filter((f) => !isSystemRoot(f) && f.title.trim());
  /** @type {{ a: FlatItem, b: FlatItem, reason: string }[]} */
  const pairs = [];
  const seen = new Set();

  for (let i = 0; i < meaningful.length; i++) {
    for (let j = i + 1; j < meaningful.length; j++) {
      const a = meaningful[i];
      const b = meaningful[j];
      const reason = overlapReason(a.title, b.title);
      if (!reason) continue;
      const key = [a.id, b.id].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ a, b, reason });
    }
  }
  return pairs;
}

/** @param {string} ta @param {string} tb */
function overlapReason(ta, tb) {
  const a = normalizeTitle(ta);
  const b = normalizeTitle(tb);
  if (!a || !b) return "";
  if (a === b) return "reasonSameName";
  if (a.includes(b) || b.includes(a)) return "reasonContains";
  // light fuzzy: strip digits/year
  const aa = a.replace(/\d{2,4}/g, "").replace(/小程序|官网|学习|计划/g, "");
  const bb = b.replace(/\d{2,4}/g, "").replace(/小程序|官网|学习|计划/g, "");
  if (aa && bb && aa === bb && a !== b) return "reasonSimilar";
  // vue / vue3
  if (
    (a.includes("vue") && b.includes("vue")) ||
    (a.includes("装机") && b.includes("装机")) ||
    (a.includes("小程序") && b.includes("小程序"))
  ) {
    return "reasonSimilar";
  }
  return "";
}

/** @param {string} t */
function normalizeTitle(t) {
  return t
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]·・]/g, "");
}

/**
 * @param {FlatItem[]} bookmarks
 * @param {number} limit
 */
function topDomains(bookmarks, limit) {
  /** @type {Map<string, number>} */
  const map = new Map();
  for (const b of bookmarks) {
    const d = domainOf(b.url || "");
    if (!d) continue;
    map.set(d, (map.get(d) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
}
