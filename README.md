# YJ书签管理小助手

Chrome 侧边栏书签整理扩展：搜索、查重、清理空夹、合并建议。支持 **中文 / English / Français**。

**Chrome Web Store 用链接（公开仓库）：**  
https://github.com/yujieying/yujiang-bookmarks

---

## 功能

- **目录**：浏览书签树；重命名、删除；拖拽排序 / 移入文件夹
- **概况**：书签 / 文件夹 / 域名统计；按域名展开；跳至目录定位
- **整理建议**：
  - 重复网址去重（每组保留最早一条）
  - 空文件夹清理
  - 过小文件夹（≤2 项）合并到上级
  - 名称重叠文件夹合并
- **搜索**：按标题、网址、路径搜索；跳至目录 / 移动 / 删除

## 安装（开发者模式）

1. 打开 `chrome://extensions`
2. 打开 **开发者模式**
3. **加载已解压的扩展程序** → 选择本仓库目录
4. 点击工具栏图标打开侧边栏

## 权限说明

| 权限 | 用途 |
|------|------|
| `bookmarks` | 读取与整理书签 |
| `sidePanel` | 侧边栏界面 |
| `favicon` | 显示站点图标 |
| `tabs` | 在新标签打开书签 |
| `storage` | 记住语言偏好 |

## Privacy Policy / 隐私政策

**Last updated: 2026-07-19**

YJ书签管理小助手是一款在本地运行的 Chrome 扩展。

### What we collect / 我们收集什么

- **不收集、不上传、不出售**你的书签内容、浏览历史或个人身份信息。
- 书签的读取与修改仅通过 Chrome 的 `chrome.bookmarks` API 在**你的设备本地**完成。
- 语言偏好保存在浏览器本地 `chrome.storage`，不会同步到开发者服务器（本扩展**没有**自有后端）。

### Permissions / 权限用途

- `bookmarks`：整理、搜索、去重、合并、重命名、删除书签与文件夹  
- `sidePanel`：在侧边栏展示界面  
- `tabs`：在新标签页打开书签链接  
- `favicon`：显示网站图标  
- `storage`：保存界面语言选择  

### Remote code / 远程代码

- 扩展**不执行**远程下载的 JavaScript。  
- 界面可能通过 Google Fonts 加载字体样式（非可执行代码）。

### Contact / 联系

如有隐私相关问题，请通过本仓库 Issues 联系：  
https://github.com/yujieying/yujiang-bookmarks/issues

---

## 安全提示

删除、合并、去重会**直接改写** Chrome 书签。重要数据请先导出备份：

`Chrome 菜单 → 书签 → 书签管理器 → ⋮ → 导出书签`

## License

见仓库内声明（若有）。个人使用与分享请遵守 Chrome 网上应用店政策。
