/** @typedef {{ id: string, title: string, url?: string, parentId?: string, children?: BookmarkNode[], dateAdded?: number }} BookmarkNode */

/**
 * @returns {Promise<{ tree: BookmarkNode[], flat: FlatItem[], folders: FlatItem[], bookmarks: FlatItem[] }>}
 */
export async function loadBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  /** @type {FlatItem[]} */
  const flat = [];
  walk(tree[0], [], flat);

  const folders = flat.filter((i) => i.isFolder);
  const bookmarks = flat.filter((i) => !i.isFolder);
  return { tree, flat, folders, bookmarks };
}

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   url?: string,
 *   parentId: string,
 *   path: string[],
 *   pathLabel: string,
 *   isFolder: boolean,
 *   childCount: number,
 *   depth: number,
 *   dateAdded?: number
 * }} FlatItem
 */

/**
 * @param {BookmarkNode} node
 * @param {string[]} path
 * @param {FlatItem[]} out
 */
function walk(node, path, out) {
  const children = node.children || [];
  const isFolder = !node.url;
  const nextPath = node.id === "0" ? path : [...path, node.title || "(未命名)"];

  if (node.id !== "0") {
    out.push({
      id: node.id,
      title: node.title || "(未命名)",
      url: node.url,
      parentId: node.parentId || "0",
      path: path.slice(),
      pathLabel: path.join(" / ") || "根",
      isFolder,
      childCount: children.length,
      depth: path.length,
      dateAdded: node.dateAdded,
    });
  }

  for (const child of children) {
    walk(child, nextPath, out);
  }
}

/**
 * @param {string} query
 * @param {FlatItem[]} bookmarks
 */
export function searchBookmarks(query, bookmarks) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);

  return bookmarks
    .map((b) => {
      const hay = `${b.title} ${b.url || ""} ${b.pathLabel}`.toLowerCase();
      const hit = tokens.every((t) => hay.includes(t));
      if (!hit) return null;
      let score = 0;
      if (b.title.toLowerCase().includes(q)) score += 40;
      if ((b.url || "").toLowerCase().includes(q)) score += 25;
      if (b.pathLabel.toLowerCase().includes(q)) score += 10;
      for (const t of tokens) {
        if (b.title.toLowerCase().includes(t)) score += 8;
        if ((b.url || "").toLowerCase().includes(t)) score += 5;
      }
      return { item: b, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

/** @param {string} url */
export function faviconUrl(url) {
  try {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", url);
    u.searchParams.set("size", "64");
    return u.toString();
  } catch {
    return "";
  }
}

/** @param {string} url */
export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function removeBookmark(id) {
  await chrome.bookmarks.remove(id);
}

export async function removeTree(id) {
  await chrome.bookmarks.removeTree(id);
}

export async function moveBookmark(id, destination) {
  await chrome.bookmarks.move(id, destination);
}

/** @param {string} id @param {string} title */
export async function renameBookmark(id, title) {
  await chrome.bookmarks.update(id, { title });
}

/** System root folders that cannot be removed. */
export function isProtectedFolder(id) {
  return id === "0" || id === "1" || id === "2" || id === "3";
}

/**
 * Move all children of sourceFolderId into targetFolderId, then remove source if empty.
 * @param {string} sourceFolderId
 * @param {string} targetFolderId
 */
export async function mergeFolderInto(sourceFolderId, targetFolderId) {
  if (sourceFolderId === targetFolderId) {
    throw new Error("不能合并到自身");
  }
  const [source] = await chrome.bookmarks.getSubTree(sourceFolderId);
  const children = source.children || [];
  for (const child of children) {
    await chrome.bookmarks.move(child.id, { parentId: targetFolderId });
  }
  await chrome.bookmarks.remove(sourceFolderId);
}

/**
 * Keep the first bookmark in each duplicate group; remove the rest.
 * @param {string[]} idsToRemove
 */
export async function removeMany(idsToRemove) {
  for (const id of idsToRemove) {
    try {
      await chrome.bookmarks.remove(id);
    } catch {
      // already gone
    }
  }
}
