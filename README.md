# Agent 会话管理器

一个本地只读的 Agent session 可视化管理器，在顶部一键切换 **Codex** 与 **Claude Code** 两套会话管理，功能完全一致。用来浏览 Codex Desktop、Codex CLI、`codex exec`、Claude Code CLI / SDK / 客户端、Obsidian / Claudian、Bridge 场景以及归档会话记录。

- Codex 模式读取本机 `~/.codex` 下的 session、日志和 rollout JSONL 文件。
- Claude Code 模式读取本机 `~/.claude/projects` 下的会话 JSONL 与 `~/.claude/stats-cache.json` 统计缓存。

帮助你快速找到历史会话、复制恢复命令、查看对话过程、分析 Token 消耗和 Skill 使用频率。

## 功能

- 双工具切换：顶部切换 Codex / Claude Code，作为大的模式切换，两边功能一模一样。
- 会话列表：按更新时间浏览本机会话。
- 多维筛选：支持按入口来源、场景标签、模型服务商、时间、重要性、归档状态筛选。
- 入口来源识别：
  - Codex：Codex 客户端、Terminal / Codex CLI、Terminal / codex exec、Obsidian / Claudian、Bridge / Lark、Bridge / Coze、子代理等。
  - Claude Code：SDK / CLI、SDK / TypeScript、Claude CLI、Claude IDE、Claude 客户端、交互式终端等。
- 场景标签识别：标记飞书 / Lark、Obsidian 笔记、Coze / Bridge、Skill 工作流、SDK 接入、终端项目、Codex 项目等场景。
- 自定义日期：可以用系统日期选择器按起止日期精确过滤会话。
- 会话恢复：一键复制恢复命令（Codex：`codex resume <id> --all`；Claude Code：`claude --resume <id>`）。
- 对话复现：按一轮一轮的用户提问、处理过程、最终回复展示历史会话。
- 处理过程折叠：每轮回复里的工具调用、Skill、执行结果可以展开或收起。
- Markdown 渲染：支持标题、列表、代码块、表格、引用、行内公式和块级公式。
- 技术索引：查看 rollout / JSONL 文件、Token、日志数量、行数、推理强度等信息。
- 会话重要性判断：用本地启发式规则标记“非常重要 / 重要 / 有用 / 不重要”。
- 用量统计弹窗：汇总累计 Token、单会话峰值、Token 活动热力图、最长任务、Skill 使用频率。

## 安装要求

- macOS 或其他可访问 Codex / Claude Code 本地数据目录的系统
- Node.js 18 或更高版本
- `sqlite3` 命令行工具（Codex 模式需要）
- 本机已有 Codex 或 Claude Code 使用记录，默认读取 `~/.codex` 与 `~/.claude`

检查依赖：

```bash
node --version
sqlite3 --version
```

## 安装和运行

克隆仓库：

```bash
git clone git@github.com:metafeng/agent-session-manager.git
cd agent-session-manager
```

启动本地服务：

```bash
npm start
```

打开浏览器：

```text
http://127.0.0.1:8787/
```

默认端口是 `8787`。如果需要换端口：

```bash
PORT=8899 npm start
```

## 数据来源

Codex 模式默认读取：

```text
~/.codex/state_5.sqlite
~/.codex/logs_2.sqlite
~/.codex/sessions/**/*.jsonl
~/.codex/archived_sessions/*.jsonl
```

Claude Code 模式默认读取：

```text
~/.claude/projects/**/*.jsonl
~/.claude/stats-cache.json
```

入口来源和场景标签来自本地字段与 rollout 内容的组合判断，包括 `source`、`originator`、`entrypoint`、`cwd`、标题和预览文本。没有稳定来源字段的第三方桥接环境会用路径和关键词启发式识别。

如果你使用自定义数据目录，可以设置环境变量：

```bash
CODEX_HOME=/path/to/.codex npm start
CLAUDE_HOME=/path/to/.claude npm start
```

## 安全边界

这个项目只读取本机 Codex / Claude Code 数据，不会修改、归档、删除任何 session。

不会上传你的会话内容到远端。GitHub 仓库只包含管理器代码，不包含 `~/.codex` 或 `~/.claude` 数据。

## 项目结构

```text
.
├── package.json
├── server.js
├── public
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── assets
│       ├── codex-icon.png
│       └── claude-icon.png
└── README.md
```

## 常用命令

```bash
npm start
node --check server.js
node --check public/app.js
```

## 说明

这是一个轻量本地工具，没有数据库迁移、构建流程和前端框架。所有界面逻辑在 `public/app.js`，服务端 API 在 `server.js`（Codex 路由 `/api/*`，Claude Code 路由 `/api/cc/*`）。

当前统计功能会在打开“用量统计”弹窗时扫描本地会话文件。会话很多时，第一次统计可能需要等待片刻。
