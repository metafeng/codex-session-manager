const state = {
  sessions: [],
  filtered: [],
  selectedId: null,
  archive: "all",
  stats: null,
  technicalCollapsed: false,
  sessionInfoCollapsed: true,
  mode: "codex"  // "codex" | "claude"
};

function apiBase() {
  return state.mode === "claude" ? "api/cc" : "api";
}

const els = {
  searchInput: document.querySelector("#searchInput"),
  sourceFilter: document.querySelector("#sourceFilter"),
  sceneFilter: document.querySelector("#sceneFilter"),
  providerFilter: document.querySelector("#providerFilter"),
  timeFilter: document.querySelector("#timeFilter"),
  importanceFilter: document.querySelector("#importanceFilter"),
  customDateRange: document.querySelector("#customDateRange"),
  dateStart: document.querySelector("#dateStart"),
  dateEnd: document.querySelector("#dateEnd"),
  sessionList: document.querySelector("#sessionList"),
  summaryGrid: document.querySelector("#summaryGrid"),
  statsButton: document.querySelector("#statsButton"),
  statsModal: document.querySelector("#statsModal"),
  closeStatsButton: document.querySelector("#closeStatsButton"),
  statsModalBody: document.querySelector("#statsModalBody"),
  statsSubtitle: document.querySelector("#statsSubtitle"),
  refreshButton: document.querySelector("#refreshButton"),
  copyButton: document.querySelector("#copyButton"),
  emptyState: document.querySelector("#emptyState"),
  emptyStateSub: document.querySelector("#emptyStateSub"),
  detailBody: document.querySelector("#detailBody"),
  detailTitle: document.querySelector("#detailTitle"),
  detailEyebrow: document.querySelector("#detailEyebrow"),
  brandTitle: document.querySelector("#brandTitle"),
  brandSub: document.querySelector("#brandSub"),
  brandIcon: document.querySelector("#brandIcon"),
  sessionInfoSummary: document.querySelector("#sessionInfoSummary"),
  sessionInfoContent: document.querySelector("#sessionInfoContent"),
  toggleSessionInfoButton: document.querySelector("#toggleSessionInfoButton"),
  resumeCommand: document.querySelector("#resumeCommand"),
  importanceTopCard: document.querySelector("#importanceTopCard"),
  metaGrid: document.querySelector("#metaGrid"),
  split: document.querySelector(".split"),
  timeline: document.querySelector("#timeline"),
  messageCount: document.querySelector("#messageCount"),
  eventCount: document.querySelector("#eventCount"),
  technicalList: document.querySelector("#technicalList"),
  technicalPanel: document.querySelector("#technicalPanel"),
  toggleTechnicalButton: document.querySelector("#toggleTechnicalButton"),
  expandTechnicalButton: document.querySelector("#expandTechnicalButton")
};

const sourceOrder = [
  "codex-desktop",
  "terminal-cli",
  "terminal-exec",
  "obsidian-claudian",
  "bridge-lark",
  "bridge-coze",
  "subagent",
  "cc-claude-desktop",
  "cc-sdk-cli",
  "cc-sdk-ts",
  "cc-cli",
  "cc-ide",
  "cc-interactive",
  "cc-unknown",
  "unknown"
];
const sourceLabels = {
  "codex-desktop": "Codex 客户端",
  "terminal-cli": "Terminal / Codex CLI",
  "terminal-exec": "Terminal / codex exec",
  "obsidian-claudian": "Obsidian / Claudian",
  "bridge-lark": "Bridge / Lark",
  "bridge-coze": "Bridge / Coze",
  subagent: "子代理",
  unknown: "未识别入口",
  desktop: "Codex 客户端",
  cli: "Terminal / Codex CLI",
  exec: "Terminal / codex exec",
  "cc-sdk-cli": "SDK / CLI",
  "cc-sdk-ts": "SDK / TypeScript",
  "cc-cli": "Claude CLI",
  "cc-ide": "Claude IDE",
  "cc-interactive": "交互式终端",
  "cc-claude-desktop": "Claude 客户端",
  "cc-unknown": "未识别入口"
};

const sceneOrder = ["lark", "obsidian", "coze", "skill", "sdk", "terminal-project", "codex-project", "general"];
const sceneLabels = {
  lark: "飞书 / Lark",
  obsidian: "Obsidian 笔记",
  coze: "Coze / Bridge",
  skill: "Skill 工作流",
  sdk: "SDK 接入",
  "terminal-project": "终端项目",
  "codex-project": "Codex 项目",
  general: "普通会话"
};

function sourceDisplayLabel(value, label) {
  if (sourceLabels[value]) return sourceLabels[value];
  if (String(value || "").startsWith("subagent:")) return String(label || value).replace(/^Subagent:/, "子代理：");
  if (label === "Codex Desktop / IDE") return sourceLabels["codex-desktop"];
  if (label === "Subagent") return sourceLabels.subagent;
  if (label === "Unknown source") return sourceLabels.unknown;
  if (String(label || "").startsWith("Subagent:")) return String(label).replace(/^Subagent:/, "子代理：");
  return label || sourceLabels.unknown;
}

function fmtDate(value) {
  if (!value) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function fmtFullDate(value) {
  if (!value) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function fmtCompactNumber(value) {
  const number = Number(value || 0);
  if (number >= 100000000) return `${(number / 100000000).toFixed(number >= 1000000000 ? 1 : 2)} 亿`;
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 1 : 2)} 万`;
  return new Intl.NumberFormat("zh-CN").format(number);
}

function fmtDuration(seconds) {
  const value = Number(seconds || 0);
  if (!value) return "0 秒";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  if (minutes) return `${minutes} 分 ${rest} 秒`;
  return `${rest} 秒`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\$([^$\n]+)\$/g, '<span class="math-inline">$1</span>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return html;
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line) {
  const cells = parseTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line) {
  const trimmed = line.trim();
  return trimmed.includes("|") && parseTableRow(trimmed).length > 1;
}

function tableAlignments(divider) {
  return parseTableRow(divider).map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    return "left";
  });
}

function renderTable(rows) {
  if (rows.length < 2) return "";
  const [headerLine, dividerLine, ...bodyLines] = rows;
  const headers = parseTableRow(headerLine);
  const alignments = tableAlignments(dividerLine);
  const body = bodyLines.map(parseTableRow);
  const alignAttr = (index) => ` style="text-align: ${alignments[index] || "left"}"`;
  return `
    <div class="markdown-table-wrap">
      <table>
        <thead>
          <tr>${headers.map((cell, index) => `<th${alignAttr(index)}>${renderInlineMarkdown(cell)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${body
            .map((row) => `<tr>${headers.map((_, index) => `<td${alignAttr(index)}>${renderInlineMarkdown(row[index] || "")}</td>`).join("")}</tr>`)
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function normalizeMarkdownTables(value) {
  return String(value || "")
    .replace(/(\|[^\n|]+(?:\|[^\n|]+)+\|)\s+(?=\|:?-{3,}:?)/g, "$1\n")
    .replace(/(\|:?-{3,}:?(?:\|:?-{3,}:?)+\|)\s+(?=\|)/g, "$1\n")
    .replace(/(\|[^\n|]+(?:\|[^\n|]+)+\|)\s+(?=\|[^\n|]+(?:\|[^\n|]+)+\|)/g, "$1\n");
}

function renderMarkdown(value) {
  const text = normalizeMarkdownTables(value).trim();
  if (!text) return "";
  const blocks = [];
  const lines = text.split("\n");
  let paragraph = [];
  let list = [];
  let orderedList = [];
  let code = [];
  let math = [];
  let inCode = false;
  let inMath = false;

  function flushParagraph() {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  }

  function flushOrderedList() {
    if (!orderedList.length) return;
    blocks.push(`<ol>${orderedList.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
    orderedList = [];
  }

  function flushCode() {
    if (!code.length) return;
    blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  }

  function flushMath() {
    if (!math.length) return;
    blocks.push(`<div class="math-block">${escapeHtml(math.join("\n"))}</div>`);
    math = [];
  }

  function flushAllTextBlocks() {
    flushParagraph();
    flushList();
    flushOrderedList();
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushAllTextBlocks();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    const mathFence = line.trim();
    if (mathFence.startsWith("$$")) {
      if (inMath) {
        const inlineEnd = mathFence.replace(/^\$\$/, "").replace(/\$\$$/, "").trim();
        if (inlineEnd) math.push(inlineEnd);
        flushMath();
        inMath = false;
      } else if (mathFence.endsWith("$$") && mathFence.length > 4) {
        flushAllTextBlocks();
        blocks.push(`<div class="math-block">${escapeHtml(mathFence.slice(2, -2).trim())}</div>`);
      } else {
        flushAllTextBlocks();
        const inlineStart = mathFence.replace(/^\$\$/, "").trim();
        if (inlineStart) math.push(inlineStart);
        inMath = true;
      }
      continue;
    }

    if (inMath) {
      math.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushAllTextBlocks();
      continue;
    }

    if (index + 1 < lines.length && isTableRow(trimmed) && isTableDivider(lines[index + 1])) {
      flushAllTextBlocks();
      const tableRows = [trimmed, lines[index + 1].trim()];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        tableRows.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      blocks.push(renderTable(tableRows));
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushAllTextBlocks();
      const level = Math.min(heading[1].length + 2, 4);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      flushAllTextBlocks();
      blocks.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      flushOrderedList();
      list.push(bullet[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushList();
      orderedList.push(ordered[1]);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushOrderedList();
  flushCode();
  flushMath();
  return blocks.join("");
}

function shortPath(path) {
  if (!path) return "未知";
  return path.replace(/^\/Users\/[^/]+/, "~");
}

function setOptions(select, options, label) {
  const current = select.value || "all";
  select.innerHTML = [
    `<option value="all">${label}</option>`,
    ...options.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
  ].join("");
  select.value = options.some((item) => item.value === current) ? current : "all";
}

function sourceSort(a, b) {
  const ai = sourceOrder.indexOf(a.value);
  const bi = sourceOrder.indexOf(b.value);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  return a.label.localeCompare(b.label);
}

function sceneSort(a, b) {
  const ai = sceneOrder.indexOf(a.value);
  const bi = sceneOrder.indexOf(b.value);
  if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  return a.label.localeCompare(b.label);
}

function optionCounts(items, keyField, labelField) {
  const map = new Map();
  for (const item of items) {
    const value = item[keyField] || "unknown";
    const label = keyField === "source_key"
      ? sourceDisplayLabel(value, item[labelField])
      : item[labelField] || sourceLabels[value] || value;
    const current = map.get(value) || { value, label, count: 0 };
    current.count += 1;
    map.set(value, current);
  }
  return [...map.values()].map((item) => ({
    ...item,
    label: `${item.label} (${item.count})`
  }));
}

function sceneOptionCounts(items) {
  const map = new Map();
  for (const item of items) {
    const keys = item.scene_keys?.length ? item.scene_keys : ["general"];
    const labels = item.scene_labels?.length ? item.scene_labels : ["普通会话"];
    keys.forEach((value, index) => {
      const label = labels[index] || sceneLabels[value] || value;
      const current = map.get(value) || { value, label, count: 0 };
      current.count += 1;
      map.set(value, current);
    });
  }
  return [...map.values()].map((item) => ({
    ...item,
    label: `${item.label} (${item.count})`
  }));
}

function dateValueAtStart(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function dateValueAtEnd(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999`);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function matchesTimeRange(item, range, startDate, endDate) {
  if (range === "all") return true;
  const value = item.updated_at || item.created_at;
  if (!value) return false;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  if (range === "custom") {
    const start = dateValueAtStart(startDate);
    const end = dateValueAtEnd(endDate);
    if (start === null && end === null) return true;
    const lower = start !== null && end !== null ? Math.min(start, end) : start;
    const upper = start !== null && end !== null ? Math.max(start, end) : end;
    if (lower !== null && time < lower) return false;
    if (upper !== null && time > upper) return false;
    return true;
  }
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === "today") return time >= startOfToday;
  if (range === "year") return time >= new Date(now.getFullYear(), 0, 1).getTime();
  const days = Number(range.replace("d", ""));
  if (!Number.isFinite(days)) return true;
  return time >= now.getTime() - days * 24 * 60 * 60 * 1000;
}

function matchesImportance(item, filter) {
  if (filter === "all") return true;
  const level = item.importance?.level || "low";
  const rank = { low: 0, useful: 1, important: 2, critical: 3 };
  if (filter === "critical") return level === "critical";
  if (filter === "important_plus") return (rank[level] ?? 0) >= rank.important;
  if (filter === "useful_plus") return (rank[level] ?? 0) >= rank.useful;
  if (filter === "low") return level === "low";
  return true;
}

function renderSummary(stats) {
  if (!stats) return;
  els.summaryGrid.innerHTML = [
    ["总数", stats.total],
    ["当前", state.filtered.length],
    ["未归档", stats.active],
    ["已归档", stats.archived]
  ]
    .map(([label, value]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`)
    .join("");
}

function applyFilters() {
  const q = els.searchInput.value.trim().toLowerCase();
  const source = els.sourceFilter.value;
  const scene = els.sceneFilter.value;
  const provider = els.providerFilter.value;
  const timeRange = els.timeFilter.value;
  const importance = els.importanceFilter.value;
  const startDate = els.dateStart.value;
  const endDate = els.dateEnd.value;

  state.filtered = state.sessions.filter((item) => {
    if (state.archive === "active" && item.archived) return false;
    if (state.archive === "archived" && !item.archived) return false;
    if (source !== "all" && item.source_key !== source) return false;
    if (scene !== "all" && !(item.scene_keys || []).includes(scene)) return false;
    if (provider !== "all" && item.model_provider !== provider) return false;
    if (!matchesTimeRange(item, timeRange, startDate, endDate)) return false;
    if (!matchesImportance(item, importance)) return false;
    if (!q) return true;
    const haystack = [
      item.id,
      item.title,
      item.preview,
      item.importance?.label,
      item.importance?.score,
      item.source,
      item.source_key,
      item.source_label,
      item.codex_source_key,
      item.codex_source_label,
      ...(item.scene_keys || []),
      ...(item.scene_labels || []),
      item.model_provider,
      item.cwd,
      item.rollout_path,
      item.model
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  renderList();
  renderSummary(state.stats);
}

function updateCustomDateVisibility() {
  const custom = els.timeFilter.value === "custom";
  els.customDateRange.classList.toggle("is-hidden", !custom);
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fmtActivityDate(key) {
  const [, month, day] = String(key || "").split("-");
  return `${Number(month || 0)}月${Number(day || 0)}日`;
}

function buildActivityCalendar(tokenByDay, days = 365) {
  const tokenMap = new Map((tokenByDay || []).map((item) => [item.date, Number(item.tokens || 0)]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const firstDay = new Date(today);
  firstDay.setDate(today.getDate() - days + 1);

  const start = new Date(firstDay);
  start.setDate(firstDay.getDate() - firstDay.getDay());

  const cells = [];
  const monthLabels = [];
  const seenMonths = new Set();
  const cursor = new Date(start);
  let index = 0;

  while (cursor <= today) {
    const col = Math.floor(index / 7) + 1;
    const row = cursor.getDay() + 1;
    if (cursor >= firstDay) {
      const date = localDateKey(cursor);
      const monthKey = date.slice(0, 7);
      if (!seenMonths.has(monthKey)) {
        monthLabels.push({ label: `${cursor.getMonth() + 1}月`, col });
        seenMonths.add(monthKey);
      }
      cells.push({
        date,
        tokens: tokenMap.get(date) || 0,
        col,
        row
      });
    }
    cursor.setDate(cursor.getDate() + 1);
    index += 1;
  }

  return {
    cells,
    monthLabels,
    weekCount: Math.ceil(index / 7)
  };
}

function tokenLevel(tokens, peak) {
  if (!tokens) return 0;
  if (!peak) return 1;
  const ratio = tokens / peak;
  if (ratio > 0.7) return 4;
  if (ratio > 0.35) return 3;
  if (ratio > 0.12) return 2;
  return 1;
}

function renderAnalytics(data) {
  const totals = data.totals || {};
  const calendar = buildActivityCalendar(data.token_by_day, 365);
  const peak = Math.max(...calendar.cells.map((item) => item.tokens), 0);
  const highReasoningPercent = totals.sessions
    ? Math.round(((data.reasoning_counts?.high || 0) / totals.sessions) * 100)
    : 0;
  const cells = calendar.cells
    .map((item) => {
      const level = tokenLevel(item.tokens, peak);
      const tooltip = item.tokens
        ? `${fmtActivityDate(item.date)} 使用了 ${fmtCompactNumber(item.tokens)} 个 Token`
        : `${fmtActivityDate(item.date)} 没有 Token 使用记录`;
      return `<span class="activity-cell level-${level}" style="grid-column:${item.col};grid-row:${item.row}" data-tooltip="${escapeHtml(tooltip)}" title="${escapeHtml(tooltip)}"></span>`;
    })
    .join("");
  const monthLabels = calendar.monthLabels
    .map((item) => `<span style="grid-column:${item.col}">${escapeHtml(item.label)}</span>`)
    .join("");
  const skills = data.top_skills?.length
    ? data.top_skills
        .map(
          (skill, index) => `
            <div class="skill-rank-row">
              <span class="skill-badge">${index + 1}</span>
              <strong>${escapeHtml(skill.name)}</strong>
              <span>${escapeHtml(skill.count)} 次</span>
            </div>
          `
        )
        .join("")
    : `<div class="stats-empty">暂未解析到 Skill 使用记录。</div>`;

  els.statsSubtitle.textContent = `统计生成于 ${fmtFullDate(data.generated_at)}`;
  els.statsModalBody.innerHTML = `
    <div class="stats-strip">
      <div><strong>${escapeHtml(fmtCompactNumber(totals.tokens))}</strong><span>累计 Token</span></div>
      <div><strong>${escapeHtml(fmtCompactNumber(totals.peak_tokens))}</strong><span>单会话峰值</span></div>
      <div><strong>${escapeHtml(fmtDuration(totals.longest_task_seconds))}</strong><span>最长任务</span></div>
      <div><strong>${escapeHtml(totals.sessions)}</strong><span>会话总数</span></div>
      <div><strong>${escapeHtml(totals.unique_skills)}</strong><span>已探索 Skill</span></div>
    </div>

    <section class="stats-section">
      <div class="stats-section-head">
        <h3>Token 活动</h3>
        <div class="activity-legend"><span>低</span><i class="level-1"></i><i class="level-2"></i><i class="level-3"></i><i class="level-4"></i><span>高</span></div>
      </div>
      <div class="activity-board" style="--activity-weeks:${calendar.weekCount}">
        <div class="activity-grid">${cells}</div>
        <div class="activity-months">${monthLabels}</div>
      </div>
    </section>

    <div class="stats-columns">
      <section class="stats-section">
        <h3>活动洞察</h3>
        <div class="insight-list">
          <div><span>最常用推理强度</span><strong>${escapeHtml(totals.top_reasoning || "未知")}</strong></div>
          <div><span>高推理占比</span><strong>${escapeHtml(highReasoningPercent)}%</strong></div>
          <div><span>Skill 调用记录</span><strong>${escapeHtml(totals.skill_events || 0)}</strong></div>
          <div><span>未归档会话</span><strong>${escapeHtml(totals.active || 0)}</strong></div>
        </div>
      </section>
      <section class="stats-section">
        <h3>最常用的 Skill</h3>
        <div class="skill-rank">${skills}</div>
      </section>
    </div>
  `;
}

async function openStatsModal() {
  els.statsModal.classList.remove("is-hidden");
  els.statsModalBody.innerHTML = `<div class="stats-loading">正在汇总本机会话...</div>`;
  els.statsSubtitle.textContent = "Token 消耗与 Skill 使用频率";
  try {
    const response = await fetch(`${apiBase()}/analytics`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "统计载入失败");
    renderAnalytics(data);
  } catch (error) {
    els.statsModalBody.innerHTML = `<div class="stats-empty">统计载入失败：${escapeHtml(error.message)}</div>`;
  }
}

function closeStatsModal() {
  els.statsModal.classList.add("is-hidden");
}

function renderList() {
  if (!state.filtered.length) {
    els.sessionList.innerHTML = `<div class="session-card"><div class="title-line">没有找到符合当前筛选条件的会话。</div></div>`;
    return;
  }

  els.sessionList.innerHTML = state.filtered
    .map((item) => {
      const providerClass = item.model_provider === "openai" ? "provider-openai" : "provider-custom";
      const sourceClass = item.source_key?.startsWith("terminal") ? "source-cli" : item.source_key === "codex-desktop" ? "source-desktop" : "";
      const sceneLabel = (item.scene_labels || []).find((label) => label !== "普通会话") || item.scene_labels?.[0] || "普通会话";
      const importance = item.importance || { level: "low", label: "未判断", score: 0 };
      return `
        <button class="session-card ${item.id === state.selectedId ? "is-selected" : ""}" data-id="${escapeHtml(item.id)}">
          <div class="card-top">
            <div class="title-line">${escapeHtml(item.title)}</div>
            <span class="importance-dot importance-${escapeHtml(importance.level)}" title="${escapeHtml(importance.label)}"></span>
          </div>
          <div class="card-meta">
            <span>${escapeHtml(fmtDate(item.updated_at))}</span>
            <span>${escapeHtml(shortPath(item.cwd))}</span>
          </div>
          <div class="pill-row">
            <span class="pill ${sourceClass}">${escapeHtml(sourceDisplayLabel(item.source_key, item.source_label || item.source))}</span>
            <span class="pill scene-pill">${escapeHtml(sceneLabel)}</span>
            <span class="pill ${providerClass}">${escapeHtml(item.model_provider || "服务商")}</span>
            <span class="pill">${escapeHtml(item.model || "模型")}</span>
            <span class="pill importance-pill importance-${escapeHtml(importance.level)}">${escapeHtml(importance.label)}</span>
            ${item.archived ? `<span class="pill archive-pill">已归档</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");

  for (const button of els.sessionList.querySelectorAll(".session-card[data-id]")) {
    button.addEventListener("click", () => selectSession(button.dataset.id));
  }
}

function renderMeta(session) {
  const sceneText = session.scene_labels?.length ? session.scene_labels.join("、") : "普通会话";
  const items = [
    ["会话 ID", session.id, "copy"],
    ["入口来源", sourceDisplayLabel(session.source_key, session.source_label || session.source)],
    ["场景标签", sceneText],
    ["模型服务商", session.model_provider],
    ["模型", session.model || "未知"],
    ["创建时间", fmtFullDate(session.created_at)],
    ["更新时间", fmtFullDate(session.updated_at)],
    ["工作目录", shortPath(session.cwd)],
    ["Codex 版本", session.cli_version || "未知"]
  ];
  els.metaGrid.innerHTML = items
    .map(([label, value, action]) => {
      const button = action === "copy" ? `<button class="meta-copy" data-copy-resume="${escapeHtml(session.resume_command)}" title="复制恢复命令">复制命令</button>` : "";
      return `
        <div class="meta-item ${action === "copy" ? "meta-item-copyable" : ""}">
          <span>${escapeHtml(label)}</span>
          <div class="meta-value-row">
            <strong title="${escapeHtml(value)}">${escapeHtml(value)}</strong>
            ${button}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderResumeBox(session) {
  const importance = session.importance || { label: "未判断", score: 0, level: "low", reasons: [] };
  const primaryReason = importance.reasons?.[0] || "本地启发式判断";
  els.resumeCommand.textContent = session.resume_command;
  els.importanceTopCard.className = `importance-top-card importance-${importance.level}`;
  els.importanceTopCard.innerHTML = `
    <span>重要性</span>
    <strong>${escapeHtml(importance.label)} · ${escapeHtml(importance.score)}/100</strong>
    <p>${escapeHtml(primaryReason)}</p>
  `;
}

function renderProcess(processEvents, summary) {
  if (!processEvents?.length) return "";
  const skills = summary?.skills?.length
    ? `<div class="skill-strip">${summary.skills.map((skill) => `<span>${escapeHtml(skill)}</span>`).join("")}</div>`
    : "";
  const label = summary?.duration ? `已处理 ${summary.duration}` : "处理过程";
  const countLabel = `${processEvents.length} 个事件${summary?.tool_count ? `，${summary.tool_count} 次工具调用` : ""}`;
  return `
    <details class="process-trace">
      <summary>
        <span class="chevron" aria-hidden="true"></span>
        <span>${escapeHtml(label)}</span>
        <small>${escapeHtml(countLabel)}</small>
      </summary>
      ${skills}
      <div class="process-list">
        ${processEvents
          .map(
            (item) => `
            <div class="process-item process-${escapeHtml(item.kind || "event")}">
              <div class="process-dot" aria-hidden="true"></div>
              <div class="process-content">
                <div class="process-title">${escapeHtml(item.title)}</div>
                ${item.detail ? `<pre>${escapeHtml(item.detail)}</pre>` : ""}
                ${item.skills?.length ? `<div class="skill-strip inline">${item.skills.map((skill) => `<span>${escapeHtml(skill)}</span>`).join("")}</div>` : ""}
              </div>
              <time>${escapeHtml(fmtDate(item.timestamp))}</time>
            </div>
          `
          )
          .join("")}
      </div>
    </details>
  `;
}

function renderTurn(turn) {
  return `
    <section class="turn">
      ${turn.user ? `
        <article class="message message-user">
          <div class="message-head">
            <span>用户</span>
            <time>${escapeHtml(fmtDate(turn.user.timestamp))}</time>
          </div>
          <div class="message-body markdown-body">${renderMarkdown(turn.user.text)}</div>
        </article>
      ` : ""}
      ${renderProcess(turn.process_events || [], turn.process_summary || {})}
      ${turn.assistant ? `
        <article class="message message-assistant">
          <div class="message-head">
            <span></span>
            <time>${escapeHtml(fmtDate(turn.assistant.timestamp))}</time>
          </div>
          <div class="message-body markdown-body">${renderMarkdown(turn.assistant.text)}</div>
        </article>
      ` : ""}
    </section>
  `;
}

function renderTimeline(messages, processEvents, summary, turns = []) {
  if (turns?.length) {
    els.messageCount.textContent = `${turns.length} 轮`;
    els.timeline.innerHTML = turns.map(renderTurn).join("");
    return;
  }

  if (!messages?.length) {
    els.timeline.innerHTML = `${renderProcess(processEvents, summary)}<div class="conversation-empty">没有解析到可见的用户对话内容。</div>`;
    els.messageCount.textContent = "0 条消息";
    return;
  }
  els.messageCount.textContent = `${messages.length} 条消息`;
  const processHtml = renderProcess(processEvents, summary);
  const messagesHtml = messages
    .map((item) => {
      const role = item.role || "event";
      const roleLabel = role === "user" ? "用户" : role === "event" ? "事件" : role;
      return `
      <article class="message message-${escapeHtml(role)}">
        <div class="message-head">
          <span>${escapeHtml(role === "assistant" ? "" : roleLabel)}</span>
          <time>${escapeHtml(fmtDate(item.timestamp))}</time>
        </div>
        <div class="message-body ${role === "assistant" || role === "user" ? "markdown-body" : ""}">${renderMarkdown(item.text)}</div>
      </article>
    `;
    })
    .join("");
  els.timeline.innerHTML = `${processHtml}${messagesHtml}`;
}

function renderTechnical(session, rollout, rolloutError) {
  const counts = rollout?.counts || {};
  const eventTotal = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  els.eventCount.textContent = rolloutError ? "解析出错" : `${eventTotal} 个事件`;

  const countText = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");

  const items = [
    ["记录文件", shortPath(session.rollout_path)],
    ["是否归档", session.archived ? "是" : "否"],
    ["线程来源", session.thread_source || "未知"],
    ["推理强度", session.reasoning_effort || "未知"],
    ["Token 用量", session.tokens_used || "0"],
    ["日志数量", session.log_count ?? "未知"],
    ["JSONL 行数", rollout?.line_count ?? "未知"],
    ["事件统计", rolloutError || countText || "无"]
  ];

  els.technicalList.innerHTML = items
    .map(([key, value]) => `<div class="kv"><span>${escapeHtml(key)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function setTechnicalCollapsed(collapsed) {
  state.technicalCollapsed = collapsed;
  els.split.classList.toggle("technical-collapsed", collapsed);
  els.technicalPanel.classList.toggle("is-collapsed", collapsed);
  els.expandTechnicalButton.classList.toggle("is-hidden", !collapsed);
  els.toggleTechnicalButton.setAttribute("aria-expanded", String(!collapsed));
  els.toggleTechnicalButton.textContent = collapsed ? "展开" : "收起";
  els.toggleTechnicalButton.setAttribute("aria-label", collapsed ? "展开技术索引" : "收起技术索引");
}

function setSessionInfoCollapsed(collapsed) {
  state.sessionInfoCollapsed = collapsed;
  els.sessionInfoContent.classList.toggle("is-hidden", collapsed);
  els.toggleSessionInfoButton.textContent = collapsed ? "展开" : "收起";
  els.toggleSessionInfoButton.setAttribute("aria-expanded", String(!collapsed));
}

async function selectSession(id) {
  state.selectedId = id;
  renderList();
  els.copyButton.disabled = false;
  els.emptyState.classList.add("is-hidden");
  els.detailBody.classList.remove("is-hidden");
  els.detailTitle.textContent = "正在载入会话...";

  const response = await fetch(`${apiBase()}/sessions/${id}`);
  const detail = await response.json();
  if (!response.ok) throw new Error(detail.error || "会话载入失败");

  const { session, rollout, rollout_error: rolloutError } = detail;
  els.detailTitle.textContent = session.title || session.id;
  const importance = session.importance || { label: "未判断", score: 0 };
  const sceneSummary = (session.scene_labels || []).filter((label) => label !== "普通会话").slice(0, 2).join("、");
  els.sessionInfoSummary.textContent = `${sourceDisplayLabel(session.source_key, session.source_label || session.source)}${sceneSummary ? ` · ${sceneSummary}` : ""} · ${session.model || "未知模型"} · ${importance.label} ${importance.score}/100`;
  renderResumeBox(session);

  renderMeta(session);
  renderTimeline(rollout?.messages || [], rollout?.process_events || [], rollout?.process_summary || {}, rollout?.turns || []);
  renderTechnical(session, rollout, rolloutError);
}

async function loadSessions() {
  els.refreshButton.disabled = true;
  els.refreshButton.textContent = "刷新中";
  try {
    const response = await fetch(`${apiBase()}/sessions`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "会话列表载入失败");
    state.sessions = data.sessions;
    state.stats = data.stats;
    setOptions(
      els.sourceFilter,
      optionCounts(state.sessions, "source_key", "source_label").sort(sourceSort),
      "全部入口"
    );
    setOptions(
      els.sceneFilter,
      sceneOptionCounts(state.sessions).sort(sceneSort),
      "全部场景"
    );
    setOptions(
      els.providerFilter,
      optionCounts(
        state.sessions.map((item) => ({ provider_key: item.model_provider || "unknown", provider_label: item.model_provider || "未知" })),
        "provider_key",
        "provider_label"
      ).sort((a, b) => a.label.localeCompare(b.label)),
      "全部服务商"
    );
    applyFilters();
    if (!state.selectedId && state.filtered[0]) {
      await selectSession(state.filtered[0].id);
    }
  } finally {
    els.refreshButton.disabled = false;
    els.refreshButton.textContent = "刷新";
  }
}

const modeConfig = {
  codex: {
    brandTitle: "Codex 会话管理器",
    brandSub: "本机会话索引",
    eyebrow: "本机 Codex 会话索引",
    emptyHtml: "这个管理器只读本机 <code>~/.codex</code>，不会修改或归档任何会话。",
    icon: "./assets/codex-icon.png"
  },
  claude: {
    brandTitle: "Claude Code 会话管理器",
    brandSub: "本机会话索引",
    eyebrow: "本机 Claude Code 会话索引",
    emptyHtml: "这个管理器只读本机 <code>~/.claude/projects</code>，不会修改或归档任何会话。",
    icon: "./assets/claude-icon.png"
  }
};

function applyModeChrome() {
  const config = modeConfig[state.mode];
  els.brandTitle.textContent = config.brandTitle;
  els.brandSub.textContent = config.brandSub;
  els.detailEyebrow.textContent = config.eyebrow;
  els.emptyStateSub.innerHTML = config.emptyHtml;
  els.brandIcon.src = config.icon;
  document.body.dataset.tool = state.mode;
}

async function switchMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  state.selectedId = null;
  state.sessions = [];
  state.filtered = [];
  state.stats = null;
  for (const btn of document.querySelectorAll(".tool-switch-btn")) {
    btn.classList.toggle("is-active", btn.dataset.tool === mode);
  }
  applyModeChrome();
  closeStatsModal();
  els.detailBody.classList.add("is-hidden");
  els.emptyState.classList.remove("is-hidden");
  els.detailTitle.textContent = "选择一个会话";
  els.copyButton.disabled = true;
  await loadSessions().catch((error) => {
    els.emptyState.innerHTML = `
      <div class="empty-mark">!</div>
      <h3>会话载入失败</h3>
      <p>${escapeHtml(error.message)}</p>
    `;
  });
}

for (const btn of document.querySelectorAll(".tool-switch-btn")) {
  btn.addEventListener("click", () => switchMode(btn.dataset.tool));
}

els.searchInput.addEventListener("input", applyFilters);
els.sourceFilter.addEventListener("change", applyFilters);
els.sceneFilter.addEventListener("change", applyFilters);
els.providerFilter.addEventListener("change", applyFilters);
els.timeFilter.addEventListener("change", () => {
  updateCustomDateVisibility();
  applyFilters();
});
els.dateStart.addEventListener("change", applyFilters);
els.dateEnd.addEventListener("change", applyFilters);
els.importanceFilter.addEventListener("change", applyFilters);
els.statsButton.addEventListener("click", openStatsModal);
els.closeStatsButton.addEventListener("click", closeStatsModal);
els.statsModal.addEventListener("click", (event) => {
  if (event.target === els.statsModal) closeStatsModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeStatsModal();
});
els.refreshButton.addEventListener("click", loadSessions);
els.toggleSessionInfoButton.addEventListener("click", () => setSessionInfoCollapsed(!state.sessionInfoCollapsed));
els.toggleTechnicalButton.addEventListener("click", () => setTechnicalCollapsed(true));
els.expandTechnicalButton.addEventListener("click", () => setTechnicalCollapsed(false));
els.copyButton.addEventListener("click", async () => {
  if (!state.selectedId) return;
  const session = state.sessions.find((item) => item.id === state.selectedId);
  const fallback = state.mode === "claude" ? `claude --resume ${state.selectedId}` : `codex resume ${state.selectedId} --all`;
  await navigator.clipboard.writeText(session?.resume_command || fallback);
  els.copyButton.textContent = "已复制";
  setTimeout(() => {
    els.copyButton.textContent = "复制恢复命令";
  }, 900);
});

els.metaGrid.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-resume]");
  if (!button) return;
  await navigator.clipboard.writeText(button.dataset.copyResume);
  button.textContent = "已复制";
  setTimeout(() => {
    button.textContent = "复制命令";
  }, 900);
});

for (const button of document.querySelectorAll(".segmented button")) {
  button.addEventListener("click", () => {
    document.querySelector(".segmented .is-active")?.classList.remove("is-active");
    button.classList.add("is-active");
    state.archive = button.dataset.archive;
    applyFilters();
  });
}

applyModeChrome();
loadSessions().catch((error) => {
  els.emptyState.innerHTML = `
    <div class="empty-mark">!</div>
    <h3>会话载入失败</h3>
    <p>${escapeHtml(error.message)}</p>
  `;
});
