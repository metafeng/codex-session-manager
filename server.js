import { createServer } from "node:http";
import { readFile, writeFile, access, readdir, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);
const __dirname = resolve(fileURLToPath(new URL(".", import.meta.url)));
const publicDir = join(__dirname, "public");
const codexHome = process.env.CODEX_HOME || join(os.homedir(), ".codex");
const stateDb = join(codexHome, "state_5.sqlite");
const logsDb = join(codexHome, "logs_2.sqlite");
const archivedDir = join(codexHome, "archived_sessions");
const claudeHome = process.env.CLAUDE_HOME || join(os.homedir(), ".claude");
const claudeProjectsDir = join(claudeHome, "projects");
const claudeStatsCache = join(claudeHome, "stats-cache.json");
const port = Number(process.env.PORT || 8787);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

// ─── archive overlay ─────────────────────────────────────────────────────────
// The manager never modifies ~/.codex or ~/.claude. Manual archive state is kept
// as a thin overlay in its own JSON store and OR-ed onto each session's native
// archived flag, so it is fully reversible and never touches original data.
const archiveStoreDir = join(os.homedir(), ".agent-session-manager");
const archiveStorePath = join(archiveStoreDir, "archive.json");
let archiveCache = null;

async function loadArchiveStore() {
  if (archiveCache) return archiveCache;
  try {
    const data = JSON.parse(await readFile(archiveStorePath, "utf8"));
    archiveCache = {
      codex: new Set(Array.isArray(data.codex) ? data.codex : []),
      claude: new Set(Array.isArray(data.claude) ? data.claude : [])
    };
  } catch {
    archiveCache = { codex: new Set(), claude: new Set() };
  }
  return archiveCache;
}

async function setArchive(tool, id, archived) {
  const store = await loadArchiveStore();
  const set = store[tool] || (store[tool] = new Set());
  if (archived) set.add(id);
  else set.delete(id);
  await mkdir(archiveStoreDir, { recursive: true });
  await writeFile(
    archiveStorePath,
    JSON.stringify({ codex: [...store.codex], claude: [...store.claude] }, null, 2)
  );
  return Boolean(archived);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function textFromContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "input_text" || part?.type === "output_text") return part.text || "";
      if (part?.text) return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function compactText(value, max = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function preserveText(value, max = 4000) {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function extractTaggedBlock(text, tag) {
  const match = String(text || "").match(new RegExp(`<${tag}(?:\\s[^>]*)?>\\n?([\\s\\S]*?)\\n?<\\/${tag}>`));
  return match?.[1]?.trim() || "";
}

function bridgeUserInputText(text) {
  const raw = String(text || "");
  if (!raw.includes("<user_input>")) return raw;

  const userInput = extractTaggedBlock(raw, "user_input");
  if (!userInput) return raw;

  try {
    const parsed = JSON.parse(userInput);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed?.text === "string" && parsed.text.trim()) return parsed.text;
  } catch {
    // Keep the raw <user_input> payload when it is not valid JSON.
  }

  return userInput;
}

function visibleMessageText(role, text) {
  if (role !== "user") return text;
  return bridgeUserInputText(text);
}

function sourceInfo(source, originator, threadSource) {
  if (originator) {
    return {
      key: source === "vscode" ? "desktop" : source || "desktop",
      label: originator,
      raw: source || "unknown"
    };
  }

  if (source === "cli") return { key: "cli", label: "Codex CLI", raw: source };
  if (source === "exec") return { key: "exec", label: "codex exec", raw: source };
  if (source === "vscode") return { key: "desktop", label: "Codex Desktop / IDE", raw: source };
  if (!source || source === "unknown") return { key: "unknown", label: "Unknown source", raw: source || "unknown" };

  if (source.startsWith("{")) {
    try {
      const parsed = JSON.parse(source);
      const subagent = parsed.subagent;
      if (subagent?.other) {
        return {
          key: `subagent:${subagent.other}`,
          label: `Subagent: ${subagent.other}`,
          raw: source
        };
      }
      const spawn = subagent?.thread_spawn;
      if (spawn) {
        const name = spawn.agent_nickname || `depth ${spawn.depth ?? 1}`;
        return {
          key: `subagent:${name}`,
          label: `Subagent: ${name}`,
          raw: source
        };
      }
    } catch {
      return { key: "subagent", label: "Subagent", raw: source };
    }
  }

  if (threadSource === "subagent") return { key: "subagent", label: "Subagent", raw: source };
  return { key: source, label: source, raw: source };
}

async function readSessionMeta(path) {
  if (!path) return {};
  const input = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "session_meta") return event.payload || {};
      return {};
    }
  } catch {
    return {};
  } finally {
    rl.close();
    input.destroy();
  }
  return {};
}

function combinedContext({ title = "", preview = "", cwd = "", originator = "", source = "" }) {
  return `${title}\n${preview}\n${cwd}\n${originator}\n${source}`;
}

function entrySourceInfo({ source, originator, threadSource, title, preview, cwd }) {
  const context = combinedContext({ title, preview, cwd, originator, source });
  const lower = context.toLowerCase();

  if (threadSource === "subagent" || String(source || "").includes("\"subagent\"")) {
    return { key: "subagent", label: "子代理" };
  }
  if (/claudian/.test(lower)) {
    return { key: "obsidian-claudian", label: "Obsidian / Claudian" };
  }
  if (/lark-channel-bridge|feishu.*bridge|lark.*bridge/.test(lower)) {
    return { key: "bridge-lark", label: "Bridge / Lark" };
  }
  if (/<coze-context>|\/\.coze\/agents|coze/.test(lower)) {
    return { key: "bridge-coze", label: "Bridge / Coze" };
  }
  if (source === "exec" || /codex_exec/.test(lower)) {
    return { key: "terminal-exec", label: "Terminal / codex exec" };
  }
  if (source === "cli" || /codex-tui/.test(lower)) {
    return { key: "terminal-cli", label: "Terminal / Codex CLI" };
  }
  if (source === "vscode" || /codex desktop|codex_vscode|codex_cli_rs/.test(lower)) {
    return { key: "codex-desktop", label: "Codex 客户端" };
  }
  return { key: "unknown", label: "未识别入口" };
}

function sceneTagsFor({ source, entrySourceKey, title, preview, cwd, originator }) {
  const context = combinedContext({ title, preview, cwd, originator, source });
  const lower = context.toLowerCase();
  const tags = [];
  const add = (key, label) => {
    if (!tags.some((item) => item.key === key)) tags.push({ key, label });
  };

  if (/lark-channel-bridge|飞书|feishu|lark/.test(lower)) add("lark", "飞书 / Lark");
  if (/claudian|current note:|obsidian|icloud~md~obsidian|\.obsidian/.test(lower)) add("obsidian", "Obsidian 笔记");
  if (/<coze-context>|\/\.coze\/agents|coze/.test(lower)) add("coze", "Coze / Bridge");
  if (/\[\$|plugin:\/\/|\/skills\/|skill/.test(lower)) add("skill", "Skill 工作流");
  if (entrySourceKey?.startsWith("terminal") || /\/vibecoding|\/workbuddy|terminal|shell/.test(lower)) add("terminal-project", "终端项目");
  if (/\/documents\/codex|\/outputs\//.test(lower)) add("codex-project", "Codex 项目");
  if (!tags.length) add("general", "普通会话");

  return tags;
}

function shouldHideMessage(role, text) {
  const normalized = String(text || "").trim();
  if (!normalized) return true;
  if (role === "user" && normalized.startsWith("# AGENTS.md instructions")) return true;
  if (role === "user" && normalized.startsWith("<environment_context>")) return true;
  if (role === "user" && normalized.includes("<environment_context>") && normalized.includes("<workspace_roots>")) return true;
  if (role === "user" && normalized.startsWith("<plugins_instructions>")) return true;
  if (role === "user" && normalized.startsWith("## Memory")) return true;
  return false;
}

function withoutDuplicateEvents(messages) {
  return messages.filter((message, index) => {
    if (message.role !== "event") return true;
    const previous = messages[index - 1];
    const next = messages[index + 1];
    if (previous?.text === message.text) return false;
    if (next?.text === message.text) return false;
    return true;
  });
}

function processText(value, max = 500) {
  return compactText(String(value || "").replace(/\n{3,}/g, "\n\n"), max);
}

function extractSkills(text) {
  const value = String(text || "");
  const names = new Set();
  for (const match of value.matchAll(/\[\$([^\]]+)\]/g)) names.add(match[1]);
  for (const match of value.matchAll(/\/skills\/([^/\s]+)\/SKILL\.md/g)) names.add(match[1]);
  for (const match of value.matchAll(/\b([A-Za-z0-9][A-Za-z0-9_-]{2,})\s+Skill\b/g)) names.add(match[1]);
  return [...names];
}

function pushProcess(processEvents, event) {
  if (!event?.title) return;
  const previous = processEvents[processEvents.length - 1];
  if (previous?.title === event.title && previous?.kind === event.kind) return;
  processEvents.push({
    ...event,
    skills: [...new Set([...(event.skills || []), ...extractSkills(`${event.title}\n${event.detail || ""}`)])]
  });
}

function summarizeFunctionCall(argsText) {
  let args = {};
  try {
    args = JSON.parse(argsText || "{}");
  } catch {
    return processText(argsText, 360);
  }

  if (args.cmd) return args.cmd;
  if (args.query) return args.query;
  if (args.code) return processText(args.code, 360);
  if (args.path) return args.path;
  if (args.url) return args.url;
  return processText(JSON.stringify(args), 360);
}

function summarizeToolOutput(output) {
  const text = String(output || "");
  const status = text.match(/Process exited with code\s+(-?\d+)/)?.[0];
  const wall = text.match(/Wall time:\s*([^\n]+)/)?.[0];
  const firstOutput = text.split("Output:\n")[1]?.split("\n").find((line) => line.trim());
  return processText([status, wall, firstOutput].filter(Boolean).join("\n") || text, 420);
}

function durationLabel(firstTimestamp, lastTimestamp) {
  if (!firstTimestamp || !lastTimestamp) return null;
  const ms = new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function durationSecondsFromLabel(label) {
  const value = String(label || "");
  const minutes = value.match(/(\d+)m/)?.[1] || 0;
  const seconds = value.match(/(\d+)s/)?.[1] || 0;
  return Number(minutes) * 60 + Number(seconds);
}

function summarizeProcess(events) {
  const skills = [...new Set((events || []).flatMap((event) => event.skills || []))].slice(0, 16);
  return {
    event_count: events?.length || 0,
    tool_count: (events || []).filter((event) => event.kind === "tool").length,
    skill_count: skills.length,
    skills,
    duration: durationLabel(events?.[0]?.timestamp, events?.[events.length - 1]?.timestamp)
  };
}

function dayKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

async function getAnalytics() {
  const sessions = await getSessions();
  const tokenByDay = {};
  const skillCounts = {};
  const reasoningCounts = {};
  let totalTokens = 0;
  let peakTokens = 0;
  let longestSeconds = 0;
  let skillEvents = 0;

  for (const session of sessions) {
    const tokens = Number(session.tokens_used || 0);
    totalTokens += tokens;
    peakTokens = Math.max(peakTokens, tokens);
    const key = dayKey(session.updated_at || session.created_at);
    if (key) tokenByDay[key] = (tokenByDay[key] || 0) + tokens;
    const reasoning = session.reasoning_effort || "unknown";
    reasoningCounts[reasoning] = (reasoningCounts[reasoning] || 0) + 1;

    if (!session.rollout_path) continue;
    try {
      const rollout = await parseRollout(session.rollout_path, 900);
      longestSeconds = Math.max(longestSeconds, durationSecondsFromLabel(rollout.process_summary?.duration));
      for (const event of rollout.process_events || []) {
        for (const skill of event.skills || []) {
          skillCounts[skill] = (skillCounts[skill] || 0) + 1;
          skillEvents += 1;
        }
      }
    } catch {
      // Ignore unreadable rollout files in aggregate analytics.
    }
  }

  const topSkills = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));

  const topReasoning = Object.entries(reasoningCounts).sort((a, b) => b[1] - a[1])[0] || ["unknown", 0];

  return {
    generated_at: new Date().toISOString(),
    totals: {
      tokens: totalTokens,
      peak_tokens: peakTokens,
      sessions: sessions.length,
      active: sessions.filter((item) => !item.archived).length,
      archived: sessions.filter((item) => item.archived).length,
      unique_skills: Object.keys(skillCounts).length,
      skill_events: skillEvents,
      top_reasoning: topReasoning[0],
      top_reasoning_count: topReasoning[1],
      longest_task_seconds: longestSeconds
    },
    token_by_day: Object.entries(tokenByDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, tokens]) => ({ date, tokens })),
    top_skills: topSkills,
    reasoning_counts: reasoningCounts
  };
}

function buildTurns(messages, processEvents) {
  const turns = [];
  let active = null;
  let processIndex = 0;
  const events = [...(processEvents || [])].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  function attachEventsUntil(timestamp) {
    if (!active || !timestamp) return;
    const end = new Date(timestamp).getTime();
    while (processIndex < events.length) {
      const current = events[processIndex];
      const time = new Date(current.timestamp || 0).getTime();
      if (Number.isFinite(end) && Number.isFinite(time) && time > end) break;
      active.process_events.push(current);
      processIndex += 1;
    }
  }

  for (const message of messages || []) {
    if (message.role === "user") {
      if (active) turns.push(active);
      active = {
        user: message,
        assistant: null,
        process_events: []
      };
      attachEventsUntil(message.timestamp);
      continue;
    }

    if (message.role === "assistant") {
      if (!active) {
        active = { user: null, assistant: null, process_events: [] };
      }
      attachEventsUntil(message.timestamp);
      active.assistant = message;
      turns.push(active);
      active = null;
    }
  }

  if (active) turns.push(active);

  if (turns.length) {
    while (processIndex < events.length) {
      turns[turns.length - 1].process_events.push(events[processIndex]);
      processIndex += 1;
    }
  }

  return turns.map((turn, index) => ({
    id: `turn-${index + 1}`,
    user: turn.user,
    assistant: turn.assistant,
    process_events: turn.process_events.slice(0, 120),
    process_summary: summarizeProcess(turn.process_events)
  }));
}

function importanceFromScore(score) {
  if (score >= 85) return { level: "critical", label: "非常重要" };
  if (score >= 60) return { level: "important", label: "重要" };
  if (score >= 35) return { level: "useful", label: "有用" };
  return { level: "low", label: "不重要" };
}

function judgeImportance({ title = "", preview = "", cwd = "", tokens = 0, turns = null, processSummary = null }) {
  const text = `${title}\n${preview}`.trim();
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  let score = 20;
  const reasons = [];

  const trivial = /^(hi|hello|hey|你好|您好|哈喽|测试|test|ping|1|11|111|hh|哈哈|用三个字打个招呼)[。！!.\s]*$/i;
  if (trivial.test(normalized) || normalized.length <= 12) {
    score -= 35;
    reasons.push("像连通性测试或短问候");
  }

  if (text.length > 120) {
    score += 15;
    reasons.push("用户目标描述较完整");
  }
  if (text.length > 500) {
    score += 10;
    reasons.push("上下文信息较多");
  }

  const strongKeywords = [
    "session管理器",
    "session manager",
    "可视化",
    "管理器",
    "安装",
    "修复",
    "生成",
    "创建",
    "网页",
    "skill",
    "插件",
    "api",
    "部署",
    "下载",
    "文档",
    "课程",
    "报价",
    "视频",
    "代码",
    "codex"
  ];
  const matched = strongKeywords.filter((keyword) => normalized.includes(keyword.toLowerCase()));
  if (matched.length) {
    score += Math.min(30, matched.length * 6);
    reasons.push(`包含任务关键词：${matched.slice(0, 4).join("、")}`);
  }

  if (cwd.includes("/outputs/") || cwd.includes("/Documents/Codex/")) {
    score += 6;
  }

  if (Number(tokens) > 100000) {
    score += 12;
    reasons.push("消耗 token 较多");
  }
  if (Number(tokens) > 1000000) {
    score += 12;
    reasons.push("长任务会话");
  }

  if (turns) {
    if (turns.length >= 3) {
      score += 12;
      reasons.push(`多轮对话：${turns.length} 轮`);
    }
    if (turns.length >= 6) score += 8;
  }

  if (processSummary) {
    if (processSummary.tool_count >= 5) {
      score += 14;
      reasons.push(`执行工具 ${processSummary.tool_count} 次`);
    }
    if (processSummary.skill_count > 0) {
      score += 10;
      reasons.push(`使用 Skill：${processSummary.skills.slice(0, 3).join("、")}`);
    }
    if (processSummary.event_count >= 50) score += 8;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const bucket = importanceFromScore(score);
  return {
    score,
    ...bucket,
    reasons: reasons.length ? reasons.slice(0, 5) : ["信息量较少，暂未发现明确产出"]
  };
}

async function sqliteJson(dbPath, sql) {
  await access(dbPath);
  const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
    maxBuffer: 1024 * 1024 * 64
  });
  return stdout.trim() ? JSON.parse(stdout) : [];
}

async function getSessions() {
  const rows = await sqliteJson(
    stateDb,
    `select
      id,
      rollout_path,
      created_at_ms,
      updated_at_ms,
      source,
      thread_source,
      model_provider,
      cwd,
      title,
      preview,
      archived,
      cli_version,
      model,
      reasoning_effort,
      tokens_used,
      has_user_event,
      agent_nickname,
      agent_role
    from threads
    order by updated_at_ms desc`
  );

  const overrides = await loadArchiveStore();
  return Promise.all(rows.map(async (row) => {
    const meta = await readSessionMeta(row.rollout_path);
    const originator = meta.originator || null;
    const cwd = row.cwd || meta.cwd || "";
    const source = sourceInfo(row.source, originator, row.thread_source);
    const entrySource = entrySourceInfo({
      source: row.source,
      originator,
      threadSource: row.thread_source,
      title: row.title,
      preview: row.preview,
      cwd
    });
    const sceneTags = sceneTagsFor({
      source: row.source,
      entrySourceKey: entrySource.key,
      title: row.title,
      preview: row.preview,
      cwd,
      originator
    });
    const importance = judgeImportance({
      title: row.title,
      preview: row.preview,
      cwd,
      tokens: row.tokens_used
    });
    return {
      ...row,
      title: compactText(row.title || row.preview || "Untitled", 180),
      preview: compactText(row.preview || row.title || "", 420),
      created_at: row.created_at_ms ? new Date(row.created_at_ms).toISOString() : null,
      updated_at: row.updated_at_ms ? new Date(row.updated_at_ms).toISOString() : null,
      archived: Boolean(row.archived) || overrides.codex.has(row.id),
      has_user_event: Boolean(row.has_user_event),
      originator,
      source_key: entrySource.key,
      source_label: entrySource.label,
      codex_source_key: source.key,
      codex_source_label: source.label,
      raw_source: source.raw,
      scene_keys: sceneTags.map((item) => item.key),
      scene_labels: sceneTags.map((item) => item.label),
      importance,
      resume_command: `codex resume ${row.id} --all`
    };
  }));
}

async function parseRollout(path, lineLimit = 1200) {
  const meta = {};
  const counts = {};
  const messages = [];
  const processEvents = [];
  const toolCalls = [];
  let lineCount = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;

  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    lineCount += 1;
    if (lineCount > lineLimit) {
      rl.close();
      break;
    }
    if (!line.trim()) continue;

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    firstTimestamp ||= event.timestamp || null;
    lastTimestamp = event.timestamp || lastTimestamp;
    counts[event.type] = (counts[event.type] || 0) + 1;

    if (event.type === "session_meta") {
      Object.assign(meta, event.payload || {});
    }

    if (event.type === "response_item") {
      const payload = event.payload || {};
      if (payload.type === "message" && ["user", "assistant"].includes(payload.role)) {
        const rawText = textFromContent(payload.content);
        const text = preserveText(visibleMessageText(payload.role, rawText), payload.role === "assistant" ? 6000 : 4000);
        if (payload.role === "assistant" && payload.phase === "commentary") {
          pushProcess(processEvents, {
            kind: "agent",
            title: compactText(text, 520),
            timestamp: event.timestamp || null
          });
        } else if (!shouldHideMessage(payload.role, text)) {
          messages.push({
            role: payload.role,
            text,
            timestamp: event.timestamp || null
          });
        }
      }

      const name = payload.name || payload.recipient_name;
      if (payload.type === "function_call") {
        const item = {
          name: name || payload.type || "tool",
          status: "called",
          timestamp: event.timestamp || null
        };
        toolCalls.push(item);
        pushProcess(processEvents, {
          kind: "tool",
          title: `调用 ${item.name}`,
          detail: summarizeFunctionCall(payload.arguments),
          timestamp: event.timestamp || null
        });
      } else if (payload.type === "function_call_output") {
        pushProcess(processEvents, {
          kind: "result",
          title: "工具返回结果",
          detail: summarizeToolOutput(payload.output),
          timestamp: event.timestamp || null
        });
      } else if (payload.type?.includes("tool") || name) {
        const item = {
          name: name || payload.type || "tool",
          status: payload.status || null,
          timestamp: event.timestamp || null
        };
        toolCalls.push(item);
        pushProcess(processEvents, {
          kind: "tool",
          title: item.name,
          detail: item.status || "",
          timestamp: event.timestamp || null
        });
      }
    }

    if (event.type === "event_msg") {
      const payload = event.payload || {};
      if (payload.type === "agent_message" && payload.message) {
        pushProcess(processEvents, {
          kind: "agent",
          title: processText(payload.message, 520),
          timestamp: event.timestamp || null
        });
      } else if (payload.type === "task_started") {
        pushProcess(processEvents, {
          kind: "system",
          title: "开始处理",
          detail: `context window ${payload.model_context_window || "unknown"}`,
          timestamp: event.timestamp || null
        });
      } else if (payload.type === "token_count") {
        pushProcess(processEvents, {
          kind: "system",
          title: "Token usage updated",
          detail: `${payload.info?.total_token_usage?.total_tokens || 0} total tokens`,
          timestamp: event.timestamp || null
        });
      } else if (payload.type && payload.type !== "user_message") {
        pushProcess(processEvents, {
          kind: "system",
          title: payload.type,
          detail: processText(JSON.stringify(payload), 420),
          timestamp: event.timestamp || null
        });
      }
    }
  }

  const visibleMessages = withoutDuplicateEvents(messages)
    .filter((message) => message.role !== "assistant" || !shouldHideMessage(message.role, message.text))
    .slice(0, 80);
  const skills = [...new Set(processEvents.flatMap((event) => event.skills || []))].slice(0, 16);
  const visibleProcessEvents = processEvents.slice(0, 240);
  const turns = buildTurns(visibleMessages, visibleProcessEvents);
  const processSummary = {
    event_count: processEvents.length,
    tool_count: toolCalls.length,
    skill_count: skills.length,
    skills,
    duration: durationLabel(firstTimestamp, lastTimestamp)
  };

  return {
    meta,
    counts,
    messages: visibleMessages,
    turns,
    process_events: visibleProcessEvents,
    process_summary: processSummary,
    tool_calls: toolCalls.slice(0, 80),
    line_count: lineCount,
    truncated: lineCount > lineLimit
  };
}

async function getLogCount(threadId) {
  try {
    const rows = await sqliteJson(logsDb, `select count(*) as count from logs where thread_id = '${threadId.replaceAll("'", "''")}'`);
    return rows[0]?.count || 0;
  } catch {
    return null;
  }
}

// ─── Claude Code session support ─────────────────────────────────────────────

function ccTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text") return part.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function ccEntrySourceInfo(entrypoint) {
  if (!entrypoint || entrypoint === "unknown") return { key: "cc-unknown", label: "未识别入口" };
  if (entrypoint === "sdk-cli") return { key: "cc-sdk-cli", label: "SDK / CLI" };
  if (entrypoint === "sdk-ts") return { key: "cc-sdk-ts", label: "SDK / TypeScript" };
  if (entrypoint === "cli") return { key: "cc-cli", label: "Claude CLI" };
  if (entrypoint === "ide") return { key: "cc-ide", label: "Claude IDE" };
  if (entrypoint === "interactive") return { key: "cc-interactive", label: "交互式终端" };
  if (entrypoint === "claude-desktop") return { key: "cc-claude-desktop", label: "Claude 客户端" };
  return { key: `cc-${entrypoint}`, label: entrypoint };
}

function ccSceneTagsFor({ entrypoint, cwd, title, preview }) {
  const context = `${cwd}\n${title}\n${preview}`.toLowerCase();
  const tags = [];
  const add = (key, label) => {
    if (!tags.some((t) => t.key === key)) tags.push({ key, label });
  };
  if (/lark|feishu|飞书/.test(context)) add("lark", "飞书 / Lark");
  if (/obsidian|icloud~md~obsidian|\.obsidian/.test(context)) add("obsidian", "Obsidian 笔记");
  if (/coze/.test(context)) add("coze", "Coze / Bridge");
  if (/\[\$|\/skills\/|skill/.test(context)) add("skill", "Skill 工作流");
  if (entrypoint === "sdk-cli" || entrypoint === "sdk-ts") add("sdk", "SDK 接入");
  if (!tags.length) add("general", "普通会话");
  return tags;
}

function ccProviderFromModel(model) {
  if (!model) return "unknown";
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("gemini")) return "google";
  return "unknown";
}

function ccShouldHideUserContent(content) {
  if (Array.isArray(content)) return true;  // tool_result arrays → not real user turns
  const text = String(content || "").trim();
  if (!text || text.length < 3) return true;
  if (text.startsWith("# AGENTS")) return true;
  if (text.startsWith("<environment_context>")) return true;
  if (text.startsWith("<plugins_instructions>")) return true;
  if (text.startsWith("## Memory")) return true;
  // Slash-command plumbing and local-command echoes are not real user turns.
  if (text.startsWith("<command-name>")) return true;
  if (text.startsWith("<command-message>")) return true;
  if (text.startsWith("<command-args>")) return true;
  if (text.startsWith("<local-command-stdout>")) return true;
  if (text.startsWith("<local-command-caveat>")) return true;
  if (text.startsWith("Caveat: The messages below")) return true;
  return false;
}

async function parseCCSession(filePath, lineLimit = 400) {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let sessionId = null;
  let cwd = null;
  let entrypoint = null;
  let version = null;
  let firstUserText = null;
  let lastPrompt = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let model = null;
  let lineCount = 0;
  let turnCount = 0;

  for await (const line of rl) {
    lineCount += 1;
    if (lineCount > lineLimit) { rl.close(); break; }
    if (!line.trim()) continue;

    let event;
    try { event = JSON.parse(line); } catch { continue; }

    const ts = event.timestamp;
    if (ts) {
      firstTimestamp = firstTimestamp || ts;
      lastTimestamp = ts;
    }

    if (!sessionId) sessionId = event.sessionId;

    if (event.type === "last-prompt") {
      lastPrompt = String(event.lastPrompt || "").trim() || null;
    }

    if (event.type === "user" && !event.isMeta && !event.isSidechain) {
      if (!cwd) cwd = event.cwd || null;
      if (!entrypoint) entrypoint = event.entrypoint || null;
      if (!version) version = event.version || null;

      const userContent = event.message?.content ?? event.content;
      if (!firstUserText && typeof userContent === "string" && !ccShouldHideUserContent(userContent)) {
        firstUserText = userContent.trim();
        turnCount += 1;
      }
    }

    if (event.type === "assistant" && !event.isSidechain) {
      const msg = event.message || {};
      if (!model && msg.model) model = msg.model;
      const usage = msg.usage || {};
      totalInputTokens += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      totalOutputTokens += usage.output_tokens || 0;
      if (turnCount > 0) turnCount += 1;
    }
  }

  rl.close();

  if (!sessionId) {
    sessionId = filePath.split("/").pop().replace(".jsonl", "");
  }

  const rawTitle = lastPrompt || firstUserText || "";
  const rawPreview = firstUserText || lastPrompt || "";

  return {
    id: sessionId,
    title: compactText(rawTitle, 180),
    preview: compactText(rawPreview, 420),
    cwd: cwd || "",
    entrypoint: entrypoint || "unknown",
    version: version || null,
    model: model || null,
    model_provider: ccProviderFromModel(model),
    tokens_used: totalInputTokens + totalOutputTokens,
    created_at: firstTimestamp,
    updated_at: lastTimestamp,
    archived: false,
    rollout_path: filePath,
    turn_count: turnCount
  };
}

async function parseCCRollout(filePath, lineLimit = 1200) {
  const meta = {};
  const counts = {};
  const messages = [];
  const processEvents = [];
  const toolCalls = [];
  let lineCount = 0;
  let firstTimestamp = null;
  let lastTimestamp = null;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    lineCount += 1;
    if (lineCount > lineLimit) { rl.close(); break; }
    if (!line.trim()) continue;

    let event;
    try { event = JSON.parse(line); } catch { continue; }

    const ts = event.timestamp || null;
    if (ts) {
      firstTimestamp = firstTimestamp || ts;
      lastTimestamp = ts;
    }
    counts[event.type] = (counts[event.type] || 0) + 1;

    if (!meta.cwd && event.cwd) meta.cwd = event.cwd;
    if (!meta.sessionId && event.sessionId) meta.sessionId = event.sessionId;
    if (!meta.entrypoint && event.entrypoint) meta.entrypoint = event.entrypoint;

    if (event.type === "user" && !event.isMeta && !event.isSidechain) {
      const content = event.message?.content ?? event.content;

      if (Array.isArray(content)) {
        for (const part of content) {
          if (part?.type === "tool_result") {
            const resultText = typeof part.content === "string"
              ? part.content
              : ccTextFromContent(part.content);
            pushProcess(processEvents, {
              kind: "result",
              title: "工具返回结果",
              detail: summarizeToolOutput(resultText),
              timestamp: ts
            });
          }
        }
      } else {
        const rawText = String(content || "");
        const text = preserveText(visibleMessageText("user", rawText), 4000);
        if (!shouldHideMessage("user", text) && !ccShouldHideUserContent(content)) {
          messages.push({ role: "user", text, timestamp: ts });
        }
      }
    }

    if (event.type === "assistant" && !event.isSidechain) {
      const msg = event.message || {};
      const content = msg.content;
      if (!Array.isArray(content)) continue;

      for (const part of content) {
        if (part.type === "text" && part.text) {
          const text = preserveText(part.text, 6000);
          if (text) messages.push({ role: "assistant", text, timestamp: ts });
        } else if (part.type === "tool_use") {
          const name = part.name || "tool";
          toolCalls.push({ name, status: "called", timestamp: ts });
          const inputText = typeof part.input === "string"
            ? part.input
            : JSON.stringify(part.input || {});
          pushProcess(processEvents, {
            kind: "tool",
            title: `调用 ${name}`,
            detail: summarizeFunctionCall(inputText),
            timestamp: ts
          });
        }
      }
    }
  }

  const visibleMessages = withoutDuplicateEvents(messages).slice(0, 80);
  const skills = [...new Set(processEvents.flatMap((e) => e.skills || []))].slice(0, 16);
  const visibleProcessEvents = processEvents.slice(0, 240);
  const turns = buildTurns(visibleMessages, visibleProcessEvents);
  const processSummary = {
    event_count: processEvents.length,
    tool_count: toolCalls.length,
    skill_count: skills.length,
    skills,
    duration: durationLabel(firstTimestamp, lastTimestamp)
  };

  return {
    meta,
    counts,
    messages: visibleMessages,
    turns,
    process_events: visibleProcessEvents,
    process_summary: processSummary,
    tool_calls: toolCalls.slice(0, 80),
    line_count: lineCount,
    truncated: lineCount > lineLimit
  };
}

async function getCCSessions() {
  const sessions = [];
  let projectDirs = [];

  try {
    projectDirs = await readdir(claudeProjectsDir);
  } catch {
    return [];
  }

  const overrides = await loadArchiveStore();

  for (const dirName of projectDirs) {
    const projectPath = join(claudeProjectsDir, dirName);
    let files = [];
    try {
      const entries = await readdir(projectPath);
      files = entries.filter((f) => f.endsWith(".jsonl")).map((f) => join(projectPath, f));
    } catch {
      continue;
    }

    for (const filePath of files) {
      try {
        const raw = await parseCCSession(filePath);
        const entrySource = ccEntrySourceInfo(raw.entrypoint);
        const sceneTags = ccSceneTagsFor({
          entrypoint: raw.entrypoint,
          cwd: raw.cwd,
          title: raw.title,
          preview: raw.preview
        });
        const importance = judgeImportance({
          title: raw.title,
          preview: raw.preview,
          cwd: raw.cwd,
          tokens: raw.tokens_used
        });
        sessions.push({
          ...raw,
          archived: Boolean(raw.archived) || overrides.claude.has(raw.id),
          source_key: entrySource.key,
          source_label: entrySource.label,
          scene_keys: sceneTags.map((t) => t.key),
          scene_labels: sceneTags.map((t) => t.label),
          importance,
          resume_command: `claude --resume ${raw.id}`
        });
      } catch {
        // skip unreadable sessions
      }
    }
  }

  return sessions.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
}

async function getCCAnalytics() {
  let statsCache = {};
  try {
    const data = await readFile(claudeStatsCache, "utf8");
    statsCache = JSON.parse(data);
  } catch {
    // stats-cache.json unavailable
  }

  const rawDailyTokens = statsCache.dailyModelTokens || [];
  const tokenByDay = rawDailyTokens.map((item) => ({
    date: item.date,
    tokens: Object.values(item.tokensByModel || {}).reduce((a, b) => Number(a) + Number(b), 0)
  }));

  const modelUsage = statsCache.modelUsage || {};
  let totalTokens = 0;
  const modelReasoningCounts = {};
  for (const [modelName, data] of Object.entries(modelUsage)) {
    const t = (data.inputTokens || 0) + (data.outputTokens || 0) +
               (data.cacheReadInputTokens || 0) + (data.cacheCreationInputTokens || 0);
    totalTokens += t;
    const sessions = data.sessions || 0;
    if (sessions) modelReasoningCounts[modelName] = sessions;
  }

  const peakTokens = tokenByDay.reduce((max, d) => Math.max(max, d.tokens), 0);

  const sessions = await getCCSessions();
  const skillCounts = {};
  let skillEvents = 0;
  let longestSeconds = 0;
  for (const session of sessions.slice(0, 60)) {
    try {
      const rollout = await parseCCRollout(session.rollout_path, 900);
      longestSeconds = Math.max(longestSeconds, durationSecondsFromLabel(rollout.process_summary?.duration));
      for (const event of rollout.process_events || []) {
        for (const skill of event.skills || []) {
          skillCounts[skill] = (skillCounts[skill] || 0) + 1;
          skillEvents += 1;
        }
      }
    } catch {
      // ignore
    }
  }

  const topSkills = Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));

  const topReasoning = Object.entries(modelReasoningCounts).sort((a, b) => b[1] - a[1])[0] || ["unknown", 0];

  return {
    generated_at: new Date().toISOString(),
    totals: {
      tokens: totalTokens,
      peak_tokens: peakTokens,
      sessions: statsCache.totalSessions || sessions.length,
      active: sessions.length,
      archived: 0,
      unique_skills: Object.keys(skillCounts).length,
      skill_events: skillEvents,
      top_reasoning: topReasoning[0],
      top_reasoning_count: topReasoning[1],
      longest_task_seconds: longestSeconds
    },
    token_by_day: tokenByDay,
    top_skills: topSkills,
    reasoning_counts: modelReasoningCounts
  };
}

async function handleCCApi(req, res, url) {
  if (url.pathname === "/api/cc/health") {
    return json(res, 200, {
      ok: true,
      claude_home: claudeHome,
      projects_dir: claudeProjectsDir,
      stats_cache: claudeStatsCache
    });
  }

  if (url.pathname === "/api/cc/sessions") {
    const sessions = await getCCSessions();
    const bySource = {};
    const byProvider = {};
    for (const item of sessions) {
      bySource[item.source_key || "unknown"] = (bySource[item.source_key || "unknown"] || 0) + 1;
      byProvider[item.model_provider || "unknown"] = (byProvider[item.model_provider || "unknown"] || 0) + 1;
    }
    return json(res, 200, {
      sessions,
      stats: {
        total: sessions.length,
        archived: sessions.filter((s) => s.archived).length,
        active: sessions.filter((s) => !s.archived).length,
        by_source: bySource,
        by_provider: byProvider
      }
    });
  }

  if (url.pathname === "/api/cc/analytics") {
    try {
      return json(res, 200, await getCCAnalytics());
    } catch (error) {
      return json(res, 500, { error: error.message || "Analytics failed" });
    }
  }

  if (url.pathname === "/api/cc/archive" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)) || "{}"); }
    catch { return json(res, 400, { error: "Invalid JSON body" }); }
    if (!body.id) return json(res, 400, { error: "Missing id" });
    const archived = await setArchive("claude", String(body.id), Boolean(body.archived));
    return json(res, 200, { id: body.id, archived });
  }

  const detailMatch = url.pathname.match(/^\/api\/cc\/sessions\/([0-9a-f-]+)$/);
  if (detailMatch) {
    const id = detailMatch[1];
    const allSessions = await getCCSessions();
    const session = allSessions.find((s) => s.id === id);
    if (!session) return json(res, 404, { error: "Session not found" });

    let rollout = null;
    let rolloutError = null;
    try {
      rollout = await parseCCRollout(session.rollout_path);
    } catch (error) {
      rolloutError = error.message;
    }

    const importance = judgeImportance({
      title: session.title,
      preview: session.preview,
      cwd: session.cwd,
      tokens: session.tokens_used,
      turns: rollout?.turns || [],
      processSummary: rollout?.process_summary || null
    });

    return json(res, 200, {
      session: {
        ...session,
        title: compactText(session.title || session.id, 220),
        preview: compactText(session.preview || session.title || "", 720),
        importance,
        log_count: null,
        cli_version: session.version,
        reasoning_effort: null,
        thread_source: null,
        agent_nickname: null,
        agent_role: null
      },
      rollout,
      rollout_error: rolloutError
    });
  }

  return json(res, 404, { error: "Unknown CC API route" });
}

// ─── end Claude Code session support ─────────────────────────────────────────

async function handleApi(req, res, url) {
  if (url.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      codex_home: codexHome,
      state_db: stateDb,
      archived_dir: archivedDir
    });
  }

  if (url.pathname === "/api/sessions") {
    const sessions = await getSessions();
    const bySource = {};
    const byProvider = {};
    for (const item of sessions) {
      bySource[item.source_key || "unknown"] = (bySource[item.source_key || "unknown"] || 0) + 1;
      byProvider[item.model_provider || "unknown"] = (byProvider[item.model_provider || "unknown"] || 0) + 1;
    }
    return json(res, 200, {
      sessions,
      stats: {
        total: sessions.length,
        archived: sessions.filter((item) => item.archived).length,
        active: sessions.filter((item) => !item.archived).length,
        by_source: bySource,
        by_provider: byProvider
      }
    });
  }

  if (url.pathname === "/api/analytics") {
    try {
      return json(res, 200, await getAnalytics());
    } catch (error) {
      return json(res, 500, { error: error.message || "Analytics failed" });
    }
  }

  if (url.pathname === "/api/archive" && req.method === "POST") {
    let body;
    try { body = JSON.parse((await readBody(req)) || "{}"); }
    catch { return json(res, 400, { error: "Invalid JSON body" }); }
    if (!body.id) return json(res, 400, { error: "Missing id" });
    const archived = await setArchive("codex", String(body.id), Boolean(body.archived));
    return json(res, 200, { id: body.id, archived });
  }

  const detailMatch = url.pathname.match(/^\/api\/sessions\/([0-9a-f-]+)$/);
  if (detailMatch) {
    const id = detailMatch[1];
    const rows = await sqliteJson(
      stateDb,
      `select * from threads where id = '${id.replaceAll("'", "''")}' limit 1`
    );
    if (!rows.length) return json(res, 404, { error: "Session not found" });
    const session = rows[0];
    let rollout = null;
    let rolloutError = null;
    try {
      rollout = await parseRollout(session.rollout_path);
    } catch (error) {
      rolloutError = error.message;
    }
    const originator = rollout?.meta?.originator || null;
    const source = sourceInfo(session.source, originator, session.thread_source);
    const cwd = session.cwd || rollout?.meta?.cwd || "";
    const entrySource = entrySourceInfo({
      source: session.source,
      originator,
      threadSource: session.thread_source,
      title: session.title,
      preview: session.preview,
      cwd
    });
    const sceneTags = sceneTagsFor({
      source: session.source,
      entrySourceKey: entrySource.key,
      title: session.title,
      preview: session.preview,
      cwd,
      originator
    });
    const importance = judgeImportance({
      title: session.title,
      preview: session.preview,
      cwd,
      tokens: session.tokens_used,
      turns: rollout?.turns || [],
      processSummary: rollout?.process_summary || null
    });
    return json(res, 200, {
      session: {
        ...session,
        title: compactText(session.title || session.preview || "Untitled", 220),
        preview: compactText(session.preview || session.title || "", 720),
        created_at: session.created_at_ms ? new Date(session.created_at_ms).toISOString() : null,
        updated_at: session.updated_at_ms ? new Date(session.updated_at_ms).toISOString() : null,
        archived: Boolean(session.archived),
        originator,
        source_key: entrySource.key,
        source_label: entrySource.label,
        codex_source_key: source.key,
        codex_source_label: source.label,
        raw_source: source.raw,
        scene_keys: sceneTags.map((item) => item.key),
        scene_labels: sceneTags.map((item) => item.label),
        importance,
        resume_command: `codex resume ${session.id} --all`,
        log_count: await getLogCount(session.id)
      },
      rollout,
      rollout_error: rolloutError
    });
  }

  return json(res, 404, { error: "Unknown API route" });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = normalize(join(publicDir, requested));
  if (!target.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(target)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/cc/")) {
      await handleCCApi(req, res, url);
    } else if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Agent Session Manager running at http://127.0.0.1:${port}`);
  console.log(`Reading Codex home: ${codexHome}`);
});
