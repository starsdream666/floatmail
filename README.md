<p align="center">
  <img src="icons/icon128.png" width="96" alt="FloatMail Logo" />
</p>

<h1 align="center">FloatMail</h1>

<p align="center">
  <strong>轻量级临时邮箱管理工具</strong> &mdash; 悬浮窗 &middot; 一键填表 &middot; AI 邮件洞察
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-120%2B-4285F4?logo=googlechrome&logoColor=white" alt="Chrome 120+" />
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?logo=googlechrome&logoColor=white" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
  <img src="https://img.shields.io/badge/vanilla-JS-f7df1e?logo=javascript&logoColor=black" alt="Vanilla JS" />
  <img src="https://img.shields.io/badge/zero-dependencies-brightgreen" alt="Zero Dependencies" />
</p>

---

## 📖 目录 | Table of Contents

- [✨ 功能亮点 | Features](#-功能亮点--features)
- [🎨 主题展示 | Themes](#-主题展示--themes)
- [📦 安装 | Installation](#-安装--installation)
- [🚀 快速开始 | Quick Start](#-快速开始--quick-start)
- [⚙️ 配置 | Configuration](#️-配置--configuration)
- [🏗️ 项目结构 | Project Structure](#️-项目结构--project-structure)
- [🛠️ 技术栈 | Tech Stack](#️-技术栈--tech-stack)
- [🤝 贡献 | Contributing](#-贡献--contributing)
- [📄 许可 | License](#-许可--license)

---

## ✨ 功能亮点 | Features

### 📬 临时邮箱 | Temp Email
- 通过自建 API 一键创建带自定义后缀的临时邮箱地址
- 自动轮询收件，桌面通知新邮件
- 邮件内容三模式查看：**原始 / 安全 HTML / 纯文本**
- 远程图片加载开关，保护隐私
- 邮箱有效性定时验证与过期自动清理

### 🐾 MoeMail 通道
- 额外对接 MoeMail API，提供第二路临时邮件服务
- 与主通道独立切换，互不干扰

### 🪟 悬浮窗 | Float Window
- 在任何网页注入可拖拽、可调整大小的悬浮面板
- 双视觉风格：**Legacy 经典** / **Modern 新拟物 Neumorphism**
- 一键钉住 / 复位 / 关闭
- 支持白名单 / 黑名单域名策略，精确控制注入范围

### ⚡ 一键填表 | Fast Fill
- 自动为页面表单生成并填入：邮箱、密码、姓名、生日、地址
- 按站点配置字段映射，支持 CSS 选择器向导（点击目标输入框绑定）
- 域名白名单 / 黑名单策略，灵活控制自动填充行为

### 🧰 工具箱 | Tools
- **密码生成器** — 可配长度与字符集（大小写字母、数字、符号）
- **姓名生成器** — 支持中文 / 英文 / 日文 / 韩文 / 英式姓名
- **地址 / 生日 / 年龄生成器** — 一键生成逼真的虚拟身份信息
- **历史记录** — 按类型筛选、搜索，随时复用

### 🔖 书签管理 | Bookmarks
- 内置常用网址收藏，支持拖拽排序
- 与主功能面板无缝切换

### 🤖 AI 邮件洞察 | AI Insights
- 对接 OpenAI 兼容 API，提供邮件摘要、关键词提取
- 支持邮件内容翻译

### 🎨 双层主题 | Dual-Layer Themes
- **风格层** `data-style`：新拟物 / 毛玻璃 / 经典扁平
- **配色层** `data-theme`：海洋蓝、樱花粉等多套配色
- 两层自由组合，即时预览

### 🔄 配置导入 / 导出 | Config I/O
- 按 16 个分类分别导出 / 导入 JSON 配置
- 方便备份、迁移、分享

---

## 🎨 主题展示 | Themes

FloatMail 内置 **双层主题系统**：风格 × 配色自由组合。

| 风格 `data-style` | 配色 `data-theme` (部分) |
| :-- | :-- |
| `neumorphism` — 新拟物浮雕 | `ocean` — 海洋蓝 |
| `glass` — 毛玻璃态 | `sakura` — 樱花粉 |
| `legacy` — 经典扁平 | `forest` — 森林绿 |
| | `sunset` — 日落橙 |
| | `midnight` — 午夜紫 |

---

## 📦 安装 | Installation

### 从源码加载 (开发者模式)

```bash
# 1. 克隆仓库
git clone https://github.com/starsdream666/floatmail.git

# 2. 打开 Chrome 扩展管理页面
#    地址栏输入：chrome://extensions/

# 3. 开启右上角「开发者模式」

# 4. 点击「加载已解压的扩展程序」
#    选择 floatmail 项目根目录
```

> **注意**：FloatMail 需要连接自建的后端 API（Temp Email Admin API）才能使用临时邮箱功能。
> 详见 [⚙️ 配置](#️-配置--configuration)。

### 从 Chrome Web Store 安装

> *即将上架 | Coming soon*

---

## 🚀 快速开始 | Quick Start

1. 点击浏览器工具栏的 FloatMail 图标，打开弹出面板
2. **创建邮箱**：在「Temp Email」页签输入后缀，点击创建
3. **查看邮件**：面板自动轮询，点击邮件查看详情
4. **悬浮窗**：浏览任意网页时，右侧会出现浮动按钮，点击展开面板
5. **一键填表**：在注册 / 登录页面，悬浮窗可一键填入生成的资料

---

## ⚙️ 配置 | Configuration

### 后端 API

FloatMail 依赖以下 API 服务（在扩展「设置」页面配置）：

| 服务 | 用途 | 必须 |
| :-- | :-- | :-- |
| **Temp Email Admin API** | 创建邮箱、获取邮件列表和内容 | ✅ 是 |
| **MoeMail API** | 第二路临时邮件服务 | ❌ 否 |
| **OpenAI 兼容 API** | AI 邮件洞察 / 翻译 | ❌ 否 |

### API 端点

在 `popup.js` 中搜索以下函数查看 API 调用细节：

- `createTempEmail()` — 创建临时邮箱
- `fetchMailList()` — 获取邮件列表
- `fetchMailDetail()` — 获取邮件详情
- `verifyEmails()` — 批量验证邮箱有效性

### 站点访问控制

在「设置」页签配置悬浮窗注入策略：

- **全部站点** — 所有页面均注入悬浮窗
- **白名单模式** — 仅指定域名注入
- **黑名单模式** — 除指定域名外均注入

---

## 🏗️ 项目结构 | Project Structure

```
floatmail/
├── manifest.json              # Chrome Extension Manifest V3
├── background.js              # Service Worker — 轮询、通知、角标
├── content.js                 # Content Script — 悬浮窗注入、填表
├── content.css                # 悬浮窗样式
├── popup.html                 # 弹出窗口 UI
├── popup.js                   # 弹出窗口主逻辑 (~6000 行)
├── popup.css                  # 全局样式 + 双层主题系统
├── popup-modules/
│   ├── config-io.js           # 配置导入 / 导出
│   ├── mail-render.js         # 邮件安全渲染
│   └── tool-generators.js     # 密码 / 姓名 / 地址生成器
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── LICENSE
└── README.md
```

### 通信架构 | Communication

```
popup.js  ←→  background.js    (chrome.runtime.sendMessage)
   ↕
content.js  ←→  popup.js       (tabs.sendMessage)
   ↕
content.js  ←→  background.js  (tabs.sendMessage)
```

---

## 🛠️ 技术栈 | Tech Stack

| 层 | 技术 |
| :-- | :-- |
| **语言** | 纯 JavaScript (ES2020+)、CSS3、HTML5 |
| **平台** | Chrome Extension Manifest V3 (≥ Chrome 120) |
| **后台** | Service Worker |
| **存储** | `chrome.storage.local` |
| **网络** | `fetch()` |
| **构建** | 零依赖、零打包器，纯原生 |
| **CSS** | `data-style` × `data-theme` 双层属性选择器主题系统 |

---

## 🤝 贡献 | Contributing

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/amazing-feature`
3. 提交更改：`git commit -m 'feat: add amazing feature'`
4. 推送分支：`git push origin feat/amazing-feature`
5. 发起 Pull Request

> 建议先开 Issue 讨论较大的改动。

---

## 📄 许可 | License

本项目基于 [MIT License](LICENSE) 开源。

---

<p align="center">
  <sub>Made with ❤️ for a more private web</sub>
</p>
