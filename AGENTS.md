# FloatMail

轻量级 Chrome 扩展：临时邮箱 + 页面悬浮窗 + 一键填表。

## Project

- 栈：Chrome MV3 扩展，纯 JS（无打包器）
- 入口：`manifest.json` → `background.js` / `popup.html` / `content.js`
- 主要文件：
  - `content.js` / `content.css`：页面悬浮窗、字段选取、页面填充
  - `popup.js` + `popup-modules/*`：主 UI（邮箱、工具、规则、设置）
  - `background.js`：轮询、通知、storage 代理

## Commands

- 语法检查：`node --check content.js` / `node --check popup.js` / `node --check background.js`
- 无单元测试脚本；本地用 Chrome 加载未打包扩展验证

## Architecture

- 悬浮窗由 content script 注入：按钮 + 含 `popup.html` 的 iframe
- 填充 / 字段选取通过 `chrome.tabs.sendMessage`（popup → content）
- 仅「规则页选取输入框」应 `hide/restore` 悬浮窗；填充类按钮不应开关面板
- 置顶依赖最大 z-index，避免页面 DOM 变更时反复 `appendChild` 重挂 iframe

## Conventions

- 回复与项目内注释优先简体中文
- 改动尽量局部，避免大范围重写 `popup.js`
- 悬浮窗可见性切换走 `setFloatPanelVisible`；入场动画用一次性 `panel-enter`

## Notes

- 填充按钮闪烁根因：body MutationObserver + 末尾节点重挂触发 iframe 重绘/动画重播
