# 🔍 FloatMail 全面审查报告

> ⚠️ 此文件不上传 Git，仅供本地待处理参考  
> 审查日期：2025-06-18

---

## 一、安全漏洞

### 🔴 CRITICAL（阻塞发布）

#### 1. `popup-modules/mail-render.js:247` — iframe sandbox 含 `allow-same-origin`

邮件 HTML 经 `sanitizeEmailHtml()` 清洗后放入 srcdoc iframe，但 sandbox 属性包含 `allow-same-origin`。这意味着 iframe 内内容运行在 `chrome-extension://` 源上，一旦清洗器被绕过（SVG/math 元素、CSS 注入、DOM clobbering），攻击者可在扩展上下文中执行代码，窃取 API 密钥、劫持邮箱。

**修复**：移除 `allow-same-origin`，srcdoc iframe 的 scrollHeight 测量无需此标志。

```diff
- sandbox="allow-same-origin allow-popups ..."
+ sandbox="allow-popups allow-popups-to-escape-sandbox"
```

---

#### 2. `manifest.json:15` — `<all_urls>` 权限无 CSP 约束

内容脚本注入所有页面 + host_permissions 覆盖所有 URL，但未声明 `content_security_policy`（MV3 默认仅限制 script-src，未约束 connect-src）。fetch 可访问任意 URL，攻击面极大。

**修复**：添加 `content_security_policy` 约束 connect-src 至少为 https。

---

### 🟠 HIGH（强烈建议修复）

#### 3. `background.js:369` 等多处 — 邮箱地址明文输出到 console

```javascript
console.log('[Background] Auto-deleting expired temp addresses:', expiredAddrs);
```

邮箱地址和轮询状态直接暴露在控制台，调试/日志导出时泄露。

**修复**：生产构建中降级为不含敏感数据的摘要日志，或使用条件编译控制级别。

---

#### 4. `popup-modules/config-io.js:5-9` — 导出配置含明文 API 密钥

配置导出 JSON 包含 `adminToken`、`translationApiKey`、`mailInsightApiKey`、`moeApiKey` 等敏感字段，用户可能无意中分享泄露。

**修复**：导出时对已知密钥字段脱敏（仅保留前/后 4 位），或弹醒目警告。

---

#### 5. `popup-modules/mail-render.js:146-153` — CSS url() 清洗正则存在绕过

```javascript
.replace(/url\((?!['"]?(?:data:|cid:))[^)]+\)/gi, 'none')
```

未处理嵌套括号、URL 编码的 `%29` 等边缘情况，配合 `allow-same-origin` 问题放大风险。

**修复**：移除 `allow-same-origin` 后风险降至 LOW；也可改用 CSSOM 遍历替代正则。

---

### 🟡 MEDIUM（建议修复）

#### 6. `manifest.json:42-53` — `web_accessible_resources` 暴露完整应用代码

`popup.html`、`popup.js`、`popup.css`、`popup-modules/*.js` 对所有 URL 可访问，网页可加载识别扩展版本/功能，甚至伪造 UI 钓鱼。

**修复**：尽量缩小 `matches` 范围。

---

#### 7. `popup.js` 书签 URL 编辑时未重新验证

书签数据来自 `chrome.storage.local`（仅扩展可写），攻击面较低。但导入恶意配置 JSON 可导致打开恶意网页。

**修复**：打开书签前对 URL 做 `http:` / `https:` 白名单检查。

---

### 🔵 LOW / 信息提示

- `chrome.storage.local` 明文存储 API 密钥（Chrome 扩展通用做法，无可信执行环境）
- 邮件主题/发件人使用 `textContent` / `escapeHtml()` → 正确
- content script `postMessage` 处理正确验证了 `event.source`
- 无 `eval()` / `new Function()` / `setTimeout(string)` 动态代码执行

---

## 二、代码冗余

### 🔴 严重（逻辑重复 / 维护风险）

#### 1. popup.js Temp/MoeMail 全套函数镜像重复（~1200 行）

| 函数组 | 预估行数 |
|--------|---------|
| `loadDomains` / `moeLoadDomains` | ~60 |
| `renderHistory` / `renderMoeEmails` | ~300 |
| `fetchMails` / `moeFetchMails` | ~200 |
| `showMailDetail` / `moeShowMailDetail` | ~250 |
| `triggerTempMailAiInsights` / `triggerMoeMailAiInsights` | ~150 |
| `updateTempMailActionButtons` / `updateMoeMailActionButtons` | ~120 |
| 其他辅助函数 (`deleteAddress`/`moeDeleteEmail` 等) | ~120 |

总计 ~1200 行完全相同的结构，差异仅变量名。**应参数化合并为通用函数**。

---

#### 2. `buildAddressString` 重复实现

- popup.js:3747
- background.js:173

API 字段格式变更需同步两处，否则验证状态不一致。

---

#### 3. `normalizeFloatWindowStyle` 重复实现

- popup.js:1203
- content.js:88

新增浮窗风格需改两处，漏改导致面板尺寸错乱。

---

#### 4. `fastFillGenerateAndFill` 内联密码生成逻辑

popup.js:2102-2127 与 `tool-generators.js` 中的密码规则完全重复。调整规则时漏改一处 → 一键填充与工具生成的密码规则不一致。

---

#### 5. `handleCurrentSiteToggle` 单函数过长

popup.js:3040-3634 共 594 行，包含 UI 渲染、事件绑定、子功能逻辑，应拆分。

---

### 🟡 中等（CSS 冗余）

#### 6. popup.css — 93 个重复选择器

同一个页面 ID 在不同 section 中被散落定义多次（如 `#temp-email-page` 在 page hiding、theme adjustments、batch actions 等处各写一次）。**应合并为单一规则块**。

---

#### 7. popup.css — 10 个主题块结构完全相同

`[data-theme="..."]` × 10 + gradient preview × 3 种风格 × 10 = ~600 行纯重复。**应改用 CSS 变量 + 映射表**。

---

#### 8. popup.css — `.theme-swatch` 定义了 14 次

多次定义可合并。

---

#### 9. `popup-modules/mail-render.js:510-584` — `renderEmailBody` / `renderMoeEmailBody` 高度重叠

后者基本上是前者的子集，应让 `renderEmailBody` 支持 MoeMail 格式或抽为薄封装。

---

### 🟡 中等（工具函数分散）

#### 10. 多个文件中 Chrome API 包装器自维护

`storageGet`、`storageSet` 在 popup.js、background.js、content.js 各自独立维护，应抽至 `shared-utils.js`。

---

## 三、建议重构方案

| 抽出模块 | 迁移内容 | 预估缩减 |
|----------|---------|---------|
| `temp-email.js` | `loadDomains`, `renderHistory`, `verifyAddress`, `fetchMails`, `showMailDetail`, 批量操作等 | ~1500 行 |
| `moe-mail.js` | `moeLoadDomains`, `renderMoeEmails`, `moeFetchMails`, `moeShowMailDetail` 等 | ~1300 行 |
| `fast-fill.js` | `fastFillGenerateAndFill`, `renderFastFillPage`, `saveFastFillConfig` 等 | ~350 行 |
| `bookmarks.js` | `renderBookmarks` + 拖拽/编辑逻辑 | ~250 行 |
| `shared-utils.js` | `storageGet`, `storageSet`, `normalizeFloatWindowStyle`, `copyToClipboard`, `showMessage` 等 | 全局减少 ~150 行重复 |
| `mail-insight-shared.js` | `buildMailInsightRenderOptions`, `getMailInsightsOverride`, `translateTextWithApi` 等 | ~300 行 |

按此方案，popup.js 可从 6268 行缩减至约 2000-2500 行。

---

## 四、修复优先级

| 优先级 | 编号 | 问题 | 改动量 |
|--------|------|------|--------|
| 🔴 P0 | 安全#1 | mail-render.js sandbox 移除 allow-same-origin | **1 行** |
| 🔴 P1 | 安全#2 | manifest 添加 CSP | 数行 |
| 🟠 P2 | 安全#4 | 配置导出脱敏 | 小 |
| 🟠 P3 | 安全#3 | console.log 脱敏 | 中 |
| 🟡 P4 | 冗余#1 | Temp/MoeMail 合并 | 大（~1200 行重构） |
| 🟡 P5 | 冗余#6-8 | CSS 主题合并 | 中 |
| 🟡 P6 | 冗余#5 | handleCurrentSiteToggle 拆分 | 中 |
| 🔵 P7 | 其他 | 工具函数抽取、CSS 合并等 | 大 |

> **建议**：P0 立即修（一行改动消除最大安全风险），然后按优先级逐步推进。

---

## 五、已修复记录

> 最后更新：2025-07

### ✅ 已修复 — 稳定性 & 性能

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 1 | 页面 CSS 覆盖悬浮窗 z-index/显隐/尺寸 | 最大 z-index `2147483647` + 内联 `!important` | content.js/css |
| 2 | 页面动态插入元素遮挡悬浮 UI | MutationObserver 监听 body，自动将悬浮节点重新 append 到末尾 | content.js |
| 3 | `applyFloatTopLayerStyles` 每次调用 12 次 `setProperty` 引发无效样式重算 | WeakMap 样式缓存，值不变则跳过 setProperty | content.js |
| 4 | MutationObserver 自触发循环（appendChild → 再次触发 → 再次 appendChild） | `bringFloatUiToFront` 移动节点前断开、移动后重连 observer | content.js |
| 5 | SPA 页面高频 DOM 变更导致频繁重挂载 | scheduleReattach 默认 delay 0→150ms 防抖 | content.js |
| 6 | 保活定时器 1s 造成持续 CPU 消耗 | 恢复为 3s，作为 MutationObserver 兜底 | content.js |
| 7 | 扩展重载时多标签页同时加载 iframe → 请求风暴（N×5+ API 请求） | iframe 延迟加载：仅在用户首次点击悬浮按钮时才设置 src | content.js |
| 8 | 面板首次打开时闪烁（重复 toggle） | setFloatPanelVisible 加入 350ms 切换冷却锁 | content.js |
| 9 | 悬浮窗模型选择下拉栏错误锁定宿主页面滚动 | 选择框添加 `data-no-scroll-lock` 属性排除 | popup.js/html |
