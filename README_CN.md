# ColaMD

**Agent Native 的 Markdown 编辑器。**

人类与 AI Agent 的实时协作 — Agent 的每一次修改，你都能即时看到。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/release/marswaveai/colamd.svg)](https://github.com/marswaveai/colamd/releases)

[下载](#下载) | [为什么做 ColaMD](#为什么做-colamd) | [功能](#功能) | [开发](#开发) | [English](README.md)

---

## 为什么做 ColaMD？

AI Agent 正在改变我们的工作方式。它们编辑文件、生成文档、产出报��� — 全是 Markdown。

但你怎么**看到** Agent 的工作？关掉文件？再打开？等着？

**ColaMD 改变了这一切。** 用 ColaMD 打开 `.md` 文件，让 Agent 去编辑它，内容会实时更新 — 就像和 AI 结对编程。不需要刷新，不需要重新加载，零摩擦。

这就是 **Agent Native** 的含义：从底层为人类和 Agent 协作而生。

## 功能

### Agent Native

- **实时 Agent 同步** — AI Agent（Claude Code、Cursor、Copilot 等）修改 `.md` 文件时，ColaMD 自动检测并即时刷新。这是核心功能。
- **Agent 活动指示器** — 标题栏的小圆点告诉你 Agent 的状态：橙色呼吸闪烁表示正在写入，绿色闪现表示写入完成。你随时知道 Agent 是否在工作。
- **Cmd+点击链接** — 点击编辑器中的链接直接在浏览器打开。

### 编辑器

- **真正的所见即所得** — 输入 Markdown，直接看到富文本，无需分屏预览。
- **智能换行** — 单个换行即渲染为换行，匹配 AI Agent 写 Markdown 的习惯。
- **富文本复制** — 复制内容后可直接粘贴到公众号、邮件等富文本编辑器，格式完整保留。
- **极简设计** — 没有工具栏，没有侧边栏，没有干扰。只有你的内容。

### 主题与导出

- **主题** — 4 个内置主题 + [可下载主题](themes/) + 自定义 CSS 导入。
- **导出** — PDF 和 HTML。
- **跨平台** — macOS、Windows、Linux。

## 下载

> 查看 [Releases](https://github.com/marswaveai/colamd/releases) 获取最新构建。

| 平台 | 格式 |
|------|------|
| macOS | `.dmg` |
| Windows | `.exe` |
| Linux | `.AppImage` / `.deb` |

## 工作原理

```
┌─────────────┐     写入      ┌──────────────┐
│  AI Agent   │ ──────────────▶│  .md 文件    │
│ (Claude,    │                │              │
│  Cursor...) │                └──────┬───────┘
└─────────────┘                       │
                              fs.watch 检测变化
                                      │
                              ┌───────▼───────┐
                              │    ColaMD     │
                              │   自动刷新    │
                              │   ✨ 实时！   │
                              └───────────────┘
```

1. 用 ColaMD 打开任意 `.md` 文件
2. 让 AI Agent 编辑这个文件
3. 看着内容实时更新 — 标题栏的指示器会在 Agent 写入时亮起橙色脉冲

不需要任何配置，开箱即用。

## ColaMD 不做的事

ColaMD 有意保持简单：

- 没有文件管理器或工作区
- 没有云同步或协作编辑
- 没有内置 AI 功能 — 它是 AI 生成内容的**查看器/编辑器**
- 没有插件系统

一件事，做到极致。

## 自定义主题

ColaMD 支持自定义 CSS 主题。从 [`themes/`](themes/) 文件夹下载主题，或自己创建后通过 **Theme > Import Theme** 导入。

导入的主题会保存到 `~/.colamd/themes/`，重启后仍然可用。

## 开发

```bash
git clone https://github.com/marswaveai/colamd.git
cd colamd
npm install
npm run dev
```

### 构建

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

### 技术栈

- **Electron** — 跨平台桌面
- **Milkdown** — 所见即所得 Markdown（基于 ProseMirror）
- **TypeScript** — 严格模式
- **electron-vite** — 快速构建

## 路线图

ColaMD 将随 Agent 生态一起演进：

- v1.1 — 实时文件热更新、文件关联、拖拽打开、主题系统
- v1.2 — 新图标
- v1.3 — Agent 活动指示器、Cmd+点击链接、富文本复制、智能换行、PDF/HTML 导出、主题持久化（当前版本）
- 未来 — 双向同步、多文件监听

## 开源协议

[MIT](LICENSE) — 永久免费。

---

由 [marswave.ai](https://marswave.ai) 为 Agent Native 的未来而造。
