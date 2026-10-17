// Usage — 自作Scriptableウィジェット。通信API・ログイン情報は使用しません。
// iCloud Drive > Scriptable > ai-usage-snapshot-v2.json をMacアプリから更新。
// 中/大サイズ。ウィジェットのParameterが「demo」のときだけ架空データ。

const SERVICE_IDS = ["claude", "codex", "antigravity", "colab", "googleCredits"];
const SOURCES = ["claudeStatusline", "claudeCli", "codexAppServer", "antigravityStatusline", "antigravityCli", "codexBar", "colabCli", "browserPage", "manual", "demo"];
const SNAPSHOT_FILE = "ai-usage-snapshot-v2.json";
const MAX_KB = 16;

function normalizeSnapshot(raw, now = Date.now() / 1000) {
  const invalid = () => { throw new Error("Invalid snapshot"); };
  const number = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const window = v => {
    if (v == null) return null;
    if (!number(v.usedPercent, 0, 100)) return invalid();
    if (v.resetsAt != null && !number(v.resetsAt, Number.MIN_VALUE, Number.MAX_VALUE)) return invalid();
    return { usedPercent: v.usedPercent, resetsAt: v.resetsAt == null ? null : v.resetsAt };
  };
  if (!raw || raw.version !== 1 || typeof raw.isDemo !== "boolean" ||
      !number(raw.generatedAt, -Number.MAX_VALUE, now + 60) ||
      !Array.isArray(raw.records) || raw.records.length > 5) return invalid();
  const seen = new Set();
  const records = raw.records.map(r => {
    if (!r || !SERVICE_IDS.includes(r.service) || seen.has(r.service) ||
        !SOURCES.includes(r.source) || (r.source === "demo") !== raw.isDemo) return invalid();
    seen.add(r.service);
    if (r.observedAt != null && !number(r.observedAt, -Number.MAX_VALUE, now + 60)) return invalid();
    const fiveHour = window(r.fiveHour), weekly = window(r.weekly);
    const balance = r.balance == null ? null : r.balance;
    const isBalance = r.service === "colab" || r.service === "googleCredits";
    if (balance != null && !number(balance, 0, 1e9)) return invalid();
    if ((isBalance && (fiveHour || weekly)) || (!isBalance && balance != null)) return invalid();
    if ((fiveHour || weekly || balance != null) && r.observedAt == null) return invalid();
    let balanceAllocation = null;
    if (r.balanceAllocation != null) {
      const a = r.balanceAllocation;
      if (r.service !== "colab" || balance == null || !number(a.total, Number.MIN_VALUE, 1e9) || balance > a.total ||
          a.basis !== (raw.isDemo ? "demo" : "confirmedInitialGrant") ||
          r.source !== (raw.isDemo ? "demo" : "colabCli")) return invalid();
      balanceAllocation = { total: a.total, basis: a.basis };
    }
    let lastGrantAt = null;
    if (r.lastGrantAt != null) {
      if (r.service !== "colab" || !number(r.lastGrantAt, Number.MIN_VALUE, now + 60) ||
          r.source !== (raw.isDemo ? "demo" : "colabCli")) return invalid();
      lastGrantAt = r.lastGrantAt;
    }
    return { service: r.service, source: r.source, observedAt: r.observedAt == null ? null : r.observedAt,
      fiveHour, weekly, balance, balanceAllocation, lastGrantAt };
  });
  // An allowlist strips any token, email or unexpected field before local caching.
  return { version: 1, generatedAt: raw.generatedAt, isDemo: raw.isDemo, records };
}

function emptySnapshot(now = Date.now() / 1000) {
  return { version: 1, generatedAt: now, isDemo: false, records: [] };
}
function demoSnapshot(now = Date.now() / 1000) {
  const q = (usedPercent, seconds) => ({ usedPercent, resetsAt: now + seconds });
  return { version: 1, generatedAt: now, isDemo: true, records: [
    { service: "claude", source: "demo", observedAt: now, fiveHour: q(28,7200), weekly: q(62,259200) },
    { service: "codex", source: "demo", observedAt: now, fiveHour: q(75,3600), weekly: q(19,432000) },
    { service: "antigravity", source: "demo", observedAt: now, fiveHour: q(10,14400), weekly: q(36,345600) },
    { service: "colab", source: "demo", observedAt: now, balance: 142.5, balanceAllocation: { total: 200, basis: "demo" } },
    { service: "googleCredits", source: "demo", observedAt: now, balance: 320 }
  ] };
}
function remaining(window, now) {
  if (!window || (window.resetsAt != null && window.resetsAt <= now)) return null;
  return 100 - window.usedPercent;
}
function age(record, now) {
  if (record.observedAt == null) return "未取得";
  const minutes = Math.max(0, Math.floor((now - record.observedAt) / 60));
  const time = minutes === 0 ? "今" : minutes < 60 ? `${minutes}分前` :
    minutes < 1440 ? `${Math.floor(minutes / 60)}時間前` : `${Math.floor(minutes / 1440)}日前`;
  return record.source === "manual" ? `手動 ${time}` : time;
}
function resetLabel(window, now) {
  if (!window) return "未取得";
  if (window.resetsAt == null) return "回復時刻不明";
  if (window.resetsAt <= now) return "再取得待ち";
  const m = Math.ceil((window.resetsAt - now) / 60);
  if (m < 60) return `あと${m}分`;
  if (m < 1440) return `あと${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ""}`;
  const h = Math.floor(m % 1440 / 60);
  return `あと${Math.floor(m / 1440)}日${h ? `${h}時間` : ""}`;
}

async function loadSnapshot(useDemo) {
  if (useDemo) return { snapshot: normalizeSnapshot(demoSnapshot()), status: "DEMO · 架空の値" };
  const local = FileManager.local();
  const cache = local.joinPath(local.libraryDirectory(), "ai-usage-cache-v1.json");
  let snapshot = emptySnapshot();
  try {
    if (local.fileExists(cache) && local.fileSize(cache) <= MAX_KB) {
      const previous = normalizeSnapshot(JSON.parse(local.readString(cache)));
      if (!previous.isDemo) snapshot = previous;
    }
  } catch (_) { /* An invalid cache never becomes a displayed value. */ }
  try {
    const cloud = FileManager.iCloud();
    let path = cloud.joinPath(cloud.documentsDirectory(), SNAPSHOT_FILE);
    if (!cloud.fileExists(path)) path = cloud.joinPath(cloud.documentsDirectory(), "ai-usage-snapshot.json");
    if (!cloud.fileExists(path)) return { snapshot, status: "Macの出力待ち" };
    await cloud.downloadFileFromiCloud(path);
    const kb = cloud.fileSize(path);
    if (typeof kb !== "number" || kb > MAX_KB) throw new Error("Size");
    const next = normalizeSnapshot(JSON.parse(cloud.readString(path)));
    if (next.isDemo) return { snapshot: next, status: "DEMO · 架空の値" };
    // Do not replace a newer offline cache with an older iCloud version.
    if (next.generatedAt < snapshot.generatedAt && snapshot.records.length > 0)
      return { snapshot, status: "iCloud更新待ち · 前回の値" };
    snapshot = next;
    local.writeString(cache, JSON.stringify(next));
    return { snapshot, status: "iCloud · 取得時刻は各行" };
  } catch (_) {
    return { snapshot, status: "同期待ち · 前回の値" };
  }
}

function loadSettings() {
  try {
    const cloud = FileManager.iCloud();
    const path = cloud.joinPath(cloud.documentsDirectory(), "ai-usage-settings.json");
    if (!cloud.fileExists(path) || cloud.fileSize(path) > 4) return {};
    const raw = JSON.parse(cloud.readString(path));
    return Number.isInteger(raw.colabGrantDay) ? { colabGrantDay: raw.colabGrantDay } : {};
  } catch (_) { return {}; }
}

function widgetTheme() {
  const pair = (light, dark) => Color.dynamic(new Color(light), new Color(dark));
  return {
    background: pair("ffffff", "1c1c1e"), text: pair("202124", "f5f5f7"),
    secondary: pair("74747c", "a1a1aa"), divider: pair("e9e9ed", "35353a"),
    surface: pair("f4f4f7", "29292e"), warning: pair("a65b00", "ffbe70"),
    accents: { claude: pair("b76042", "dfa184"), codex: pair("188661", "70c7a3"),
      antigravity: pair("537ac3", "91ace0"), colab: pair("b78017", "d9b766") }
  };
}

function compactBalance(value) {
  if (value == null) return "—";
  const trim = v => v.replace(/\.0$/, "");
  if (value >= 1e6) return trim((value / 1e6).toFixed(1)) + "M";
  if (value >= 1e4) return trim((value / 1e3).toFixed(1)) + "k";
  return trim(value.toFixed(1));
}

function allocationStats(record) {
  const total = record.balanceAllocation?.total;
  if (record.balance == null || !Number.isFinite(total) || total <= 0 || record.balance > total) return null;
  return { total, consumed: Math.round((total - record.balance) * 100) / 100,
    remainingPercent: record.balance / total * 100 };
}

function compactAge(record, now) {
  if (record.observedAt == null) return "";
  const minutes = Math.max(0, Math.floor((now - record.observedAt) / 60));
  const isStale = now - record.observedAt > 900;
  const elapsed = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
  return record.source === "manual" ? isStale ? `手動 ${elapsed}` : "手動" : isStale ? elapsed : "";
}

// Short "あと" for the one-line medium cell: あと10分 / あと4h59m / あと4日3h.
function shortResetLabel(window, now) {
  if (!window || window.resetsAt == null) return "";
  if (window.resetsAt <= now) return "再取得待ち";
  const m = Math.ceil((window.resetsAt - now) / 60);
  if (m < 60) return `あと${m}分`;
  if (m < 1440) return `あと${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ""}`;
  const h = Math.floor(m % 1440 / 60);
  return `あと${Math.floor(m / 1440)}日${h ? `${h}h` : ""}`;
}

// Colab grants arrive monthly on the Google AI plan's renewal day, which no official API returns.
// The day comes from ai-usage-settings.json next to the snapshot ({"colabGrantDay": 15}) or the
// widget parameter "grant=15". Returns the next grant as epoch seconds (local midnight), or null.
function nextGrantAt(day, now) {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  const at = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate())).getTime() / 1000;
  const d = new Date(now * 1000);
  const thisMonth = at(d.getFullYear(), d.getMonth());
  return thisMonth > now ? thisMonth : at(d.getFullYear(), d.getMonth() + 1);
}
// The grant day: learned from the last observed grant (a balance rise the Mac recorded) when there
// is one, otherwise the configured renewal day. If the expected day has passed without a grant
// being seen, the state is "waiting" — Google AI plan grants are known to arrive late.
function grantStatus(record, configuredDay, now) {
  const learned = record && record.lastGrantAt != null ? new Date(record.lastGrantAt * 1000).getDate() : null;
  const day = learned || configuredDay || null;
  const nextAt = nextGrantAt(day, now);
  if (nextAt == null) return null;
  const d = new Date(nextAt * 1000);
  const expectedAt = new Date(d.getFullYear(), d.getMonth() - 1, Math.min(day, new Date(d.getFullYear(), d.getMonth(), 0).getDate())).getTime() / 1000;
  const waiting = record && record.lastGrantAt != null && record.lastGrantAt < expectedAt - 43200 && now - expectedAt < 20 * 86400;
  return { day, nextAt, waiting, learned: learned != null };
}
function grantLabel(status, now) {
  if (!status) return "";
  if (status.waiting) return `付与待ち（予定${status.day}日）`;
  const days = Math.ceil((status.nextAt - now) / 86400);
  return days <= 1 ? "次の付与 明日" : `次の付与まで あと${days}日`;
}
function grantShort(status, now) {
  if (!status) return "";
  return status.waiting ? "付与待ち" : `あと${Math.max(1, Math.ceil((status.nextAt - now) / 86400))}日`;
}

function cuText(value, digits) {
  if (value == null) return "—";
  return value >= 1e4 ? compactBalance(value) : value.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

// Lock Screen widgets (iOS 16+). iOS tints them to the wallpaper, so only white and its
// opacity carry meaning; accent colors would be discarded.
const SERVICE_NAMES = { claude: "Claude", codex: "Codex", antigravity: "Antigravity", colab: "Colab" };
const SHORT_NAMES = { claude: "Claude", codex: "Codex", antigravity: "AG", colab: "Colab" };

function widgetOptions(parameter) {
  const tokens = String(parameter || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  const grant = tokens.map(t => /^grant=(\d{1,2})$/.exec(t)).find(Boolean);
  return { demo: tokens.includes("demo"), service: tokens.find(t => SERVICE_NAMES[t]) || null,
    grantDay: grant ? Number(grant[1]) : null };
}

// The window that runs out first for a service: the lowest remaining percentage it has.
function tightest(record, now) {
  const options = [["5h", record.fiveHour], ["週", record.weekly]]
    .map(([label, win]) => ({ label, win, value: remaining(win, now) }))
    .filter(o => o.value != null);
  return options.sort((a, b) => a.value - b.value)[0] || null;
}

function buildAccessory(snapshot, family, parameter, now = Date.now() / 1000, grantDay = null) {
  const w = new ListWidget();
  const white = new Color("ffffff"), dim = new Color("ffffff", 0.6), faint = new Color("ffffff", 0.3);
  const record = id => snapshot.records.find(r => r.service === id) || { observedAt: null };
  const text = (parent, value, size, color = white, weight = "regular") => {
    const t = parent.addText(value);
    t.font = weight === "number" ? Font.semiboldRoundedSystemFont(size) :
      weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
    t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.7; return t;
  };
  const row = parent => { const s = parent.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; };
  const colab = record("colab"), allocation = allocationStats(colab);
  const colabPercent = allocation ? allocation.remainingPercent : null;
  const quotaIDs = ["claude", "codex", "antigravity"];
  const option = widgetOptions(parameter);

  if (family === "accessoryInline") {
    // One line above the clock: the service whose window runs out first.
    const pick = (option.service ? [option.service] : quotaIDs)
      .filter(id => id !== "colab")
      .map(id => ({ id, t: tightest(record(id), now) })).filter(x => x.t)
      .sort((a, b) => a.t.value - b.t.value)[0];
    if (option.service === "colab") {
      const g = grantStatus(colab, grantDay, now);
      const tail = g ? ` · ${g.waiting ? "付与待ち" : `付与まで${Math.ceil((g.nextAt - now) / 86400)}日`}` : colabPercent != null ? ` · ${Math.round(colabPercent)}%` : "";
      text(w, colab.balance != null ? `Colab ${cuText(colab.balance, 0)} CU${tail}` : "Colab —");
    } else if (pick) {
      const after = shortResetLabel(pick.t.win, now);
      text(w, `${SERVICE_NAMES[pick.id]} ${pick.t.label} ${Math.round(pick.t.value)}%${after ? ` · ${after}` : ""}`);
    } else text(w, "Usage —");
    return w;
  }

  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const id = option.service || "claude";
    const t = id === "colab" ? null : tightest(record(id), now);
    // Colab leads with the CU amount, as on the Home Screen; quota services with remaining %.
    const value = id === "colab" ? colab.balance : t && t.value;
    w.addSpacer();
    const top = row(w); top.addSpacer(); text(top, SHORT_NAMES[id], 9, dim, "semibold"); top.addSpacer();
    const mid = row(w); mid.addSpacer();
    text(mid, value == null ? "—" : id === "colab" ? cuText(value, 0) : String(Math.round(value)), 20, white, "number");
    if (value != null && id !== "colab") text(mid, "%", 11, white, "number");
    mid.addSpacer();
    const bottom = row(w); bottom.addSpacer();
    const g = id === "colab" ? grantStatus(colab, grantDay, now) : null;
    text(bottom, id === "colab" ? (g ? grantShort(g, now) : "CU") : t ? t.label : "", 8, dim); bottom.addSpacer();
    w.addSpacer();
    return w;
  }

  // accessoryRectangular: the Home Screen table, shrunk. Missing windows stay blank.
  w.setPadding(0, 0, 0, 0);
  const cols = { name: 54, cell: 40, gap: 6 };
  const hasFiveHour = quotaIDs.some(id => record(id).fiveHour != null);
  const head = row(w); const hn = row(head); hn.size = new Size(cols.name, 0);
  text(hn, "残り", 9, dim); head.addSpacer();
  for (const [i, label] of [hasFiveHour ? "5h" : "", "週"].entries()) {
    if (i) head.addSpacer(cols.gap);
    const c = row(head); c.size = new Size(cols.cell, 0); c.addSpacer(); if (label) text(c, label, 9, dim);
  }
  const cell = (parent, value) => {
    const c = row(parent); c.size = new Size(cols.cell, 0); c.addSpacer();
    if (value !== undefined) text(c, value == null ? "—" : `${Math.round(value)}%`, 12, white, "number");
  };
  for (const id of [...quotaIDs, "colab"]) {
    const r = record(id), line = row(w);
    const n = row(line); n.size = new Size(cols.name, 0); text(n, SHORT_NAMES[id], 12, white, "semibold");
    line.addSpacer();
    if (id === "colab") {
      const c = row(line); c.size = new Size(cols.cell * 2 + cols.gap, 0); c.addSpacer();
      if (colabPercent != null) { text(c, `${cuText(colab.balance, 0)} CU`, 9, dim); c.addSpacer(4); }
      text(c, colabPercent != null ? `${Math.round(colabPercent)}%` : `${colab.balance == null ? "—" : cuText(colab.balance, 0)} CU`, 12, white, "number");
    } else {
      cell(line, r.fiveHour == null ? undefined : remaining(r.fiveHour, now));
      line.addSpacer(cols.gap);
      cell(line, r.weekly == null ? undefined : remaining(r.weekly, now));
    }
  }
  return w;
}

// Home Screen. Quota services (time windows that refill) are rows; Colab is a balance that only
// goes down, so it sits under a divider and leads with the CU amount instead of a percentage.
// Widths fit the smallest iPhone widgets (155 / 329×155 / 329×345); bigger devices widen the gaps.
function buildWidget(snapshot, status, family, now = Date.now() / 1000, parameter = "", grantDay = null) {
  if (String(family).startsWith("accessory")) return finish(buildAccessory(snapshot, family, parameter, now, grantDay), now);
  const large = family === "large" || family === "extraLarge";
  const small = family === "small";
  const theme = widgetTheme();
  const w = new ListWidget();
  w.backgroundColor = theme.background;
  const pad = small ? { v: 11, h: 12 } : large ? { v: 18, h: 16 } : { v: 12, h: 14 };
  w.setPadding(pad.v, pad.h, pad.v, pad.h);
  const m = small
    ? { width: 127, gap: 9, name: 9, num: 15, cap: 8, head: 8, bar: 2 }
    : large
      ? { label: 100, cell: 92, gap: 12, name: 14, num: 24, cap: 10, head: 10, bar: 4 }
      : { label: 90, cell: 98, gap: 12, name: 12, num: 17, cap: 9, head: 9, bar: 3 };
  const span = small ? m.width : m.cell * 2 + m.gap;

  const text = (parent, value, size, color = theme.text, weight = "regular", scale = 0.85) => {
    const t = parent.addText(value);
    t.font = weight === "number" ? Font.semiboldRoundedSystemFont(size) :
      weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
    t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = scale; return t;
  };
  const row = parent => { const s = parent.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; };
  const column = (parent, width) => {
    const c = parent.addStack(); c.layoutVertically(); if (width) c.size = new Size(width, 0); return c;
  };
  const bar = (parent, width, percent, color) => {
    const track = parent.addStack(); track.layoutHorizontally(); track.size = new Size(width, m.bar);
    track.cornerRadius = m.bar / 2; track.backgroundColor = theme.divider;
    if (percent != null && percent > 0) {
      const fill = track.addStack(); fill.size = new Size(width * Math.min(percent, 100) / 100, m.bar);
      fill.cornerRadius = m.bar / 2; fill.backgroundColor = color;
    }
    track.addSpacer();
  };
  // "89%" with a smaller percent sign, aligned on the number's baseline.
  const percent = (parent, value, color, size = m.num) => {
    const s = parent.addStack(); s.layoutHorizontally(); s.bottomAlignContent();
    text(s, value == null ? "—" : String(Math.round(value)), size, color, "number");
    if (value != null) { s.addSpacer(1); text(s, "%", Math.round(size * 0.62), color, "number"); }
  };
  const record = id => snapshot.records.find(r => r.service === id) || { observedAt: null };
  const stale = r => r.observedAt != null && now - r.observedAt > 900;
  const tone = (value, isStale) => value == null ? theme.secondary : isStale || value <= 20 ? theme.warning : theme.text;
  const barTone = (id, value, isStale) => isStale || value <= 20 ? theme.warning : theme.accents[id];
  const dot = (parent, id) => {
    const d = parent.addStack(); d.size = new Size(6, 6); d.cornerRadius = 3;
    d.backgroundColor = theme.accents[id]; parent.addSpacer(6);
  };
  const services = [["claude", "Claude"], ["codex", "Codex"], ["antigravity", "Antigravity"]];
  const hint = snapshot.isDemo ? "DEMO" : status.includes("前回の値") ? "同期保留" : "";

  // A quota cell: big remaining % with "あと" beside it (medium) or below the bar (large).
  // A missing window paints nothing at all — no dash, no empty bar.
  const quotaCell = (parent, id, win, isStale) => {
    const c = column(parent, m.cell);
    if (win == null) return;
    const value = remaining(win, now);
    const top = row(c);
    percent(top, value, tone(value, isStale));
    top.addSpacer();
    if (!large) text(top, shortResetLabel(win, now), m.cap, theme.secondary, "regular", 0.7);
    c.addSpacer(3);
    bar(c, m.cell, value, barTone(id, value, isStale));
    if (large && win.resetsAt != null) { c.addSpacer(4); text(c, resetLabel(win, now), m.cap, theme.secondary, "regular", 0.7); }
  };

  if (small) {
    // Two-tier rows so both windows fit at a readable size: the name, then 5時間 | 週間 cells.
    const cellW = (m.width - m.gap) / 2;
    const hasFiveHour = services.some(([id]) => record(id).fiveHour != null);
    const head = row(w); head.size = new Size(m.width, 0);
    for (const [i, label] of [hasFiveHour ? "5時間" : "", "週間"].entries()) {
      if (i) head.addSpacer(m.gap);
      const c = row(head); c.size = new Size(cellW, 0);
      if (label) text(c, label, m.head, theme.secondary);
      c.addSpacer();
      if (i === 1 && hint) text(c, hint, m.head, theme.warning, "semibold");
    }
    for (const [id, name] of services) {
      w.addSpacer();
      const r = record(id), isStale = stale(r);
      const title = row(w); title.size = new Size(m.width, 0); dot(title, id);
      text(title, name, m.name, isStale ? theme.warning : theme.secondary, "semibold", 0.7);
      title.addSpacer();
      w.addSpacer(1);
      const line = row(w); line.size = new Size(m.width, 0);
      for (const [i, win] of [r.fiveHour, r.weekly].entries()) {
        if (i) line.addSpacer(m.gap);
        const c = column(line, cellW);
        if (win == null) continue;
        const value = remaining(win, now);
        const top = row(c); percent(top, value, tone(value, isStale)); top.addSpacer();
        c.addSpacer(2);
        bar(c, cellW, value, barTone(id, value, isStale));
      }
    }
  } else {
    const hasFiveHour = services.some(([id]) => record(id).fiveHour != null);
    // Header: "残り" over the names, column titles over the numbers.
    const head = row(w);
    const left = row(head); left.size = new Size(m.label, 0);
    text(left, "残り", m.head, theme.secondary);
    if (hint) { left.addSpacer(4); text(left, hint, m.head, theme.warning, "semibold"); }
    head.addSpacer();
    for (const [i, label] of [hasFiveHour ? "5時間" : "", "週間"].entries()) {
      if (i) head.addSpacer(m.gap);
      const c = row(head); c.size = new Size(m.cell, 0);
      if (label) text(c, label, m.head, theme.secondary);
      c.addSpacer();
    }
    w.addSpacer(large ? 14 : 6);
    for (const [index, [id, name]] of services.entries()) {
      if (index) w.addSpacer();
      const r = record(id), isStale = stale(r);
      const line = row(w);
      const label = column(line, m.label);
      const title = row(label); dot(title, id);
      text(title, name, m.name, theme.text, "semibold", 0.7);
      // Only exceptional states get a caption under the name: a stale or manual observation.
      if (r.observedAt != null && (isStale || r.source === "manual")) {
        label.addSpacer(1);
        text(label, large ? age(r, now) : compactAge(r, now), m.cap - 1, isStale ? theme.warning : theme.secondary);
      }
      line.addSpacer();
      quotaCell(line, id, r.fiveHour, isStale); line.addSpacer(m.gap); quotaCell(line, id, r.weekly, isStale);
    }
  }

  // Colab balance, set apart by a divider.
  w.addSpacer();
  const divider = row(w); divider.size = new Size(0, 1); divider.backgroundColor = theme.divider; divider.addSpacer();
  w.addSpacer(small ? 4 : large ? 12 : 6);
  const colab = record("colab"), colabStale = stale(colab), allocation = allocationStats(colab);
  const value = allocation && allocation.remainingPercent;
  const amountColor = colab.balance == null ? theme.secondary : colabStale || (value != null && value <= 20) ? theme.warning : theme.text;
  const grantInfo = grantStatus(record("colab"), grantDay, now), grant = grantLabel(grantInfo, now);
  const foot = row(w); if (small) foot.size = new Size(m.width, 0);
  const fl = small ? foot : column(foot, m.label);
  const ft = row(fl);
  if (!small) dot(ft, "colab");
  text(ft, "Colab", small ? m.head + 1 : m.name, small ? theme.secondary : theme.text, "semibold", 0.7);
  if (small && grant) { ft.addSpacer(4); text(ft, grantShort(grantInfo, now), m.head, grantInfo.waiting ? theme.warning : theme.secondary, "regular", 0.7); }
  if (!small) { fl.addSpacer(1); text(fl, colabStale ? compactAge(colab, now) || age(colab, now) : "計算ユニット", m.cap - 1, colabStale ? theme.warning : theme.secondary); }
  foot.addSpacer();
  const fr = small ? foot : column(foot, span);
  const amount = row(fr);
  const digits = small ? 0 : large ? 2 : 1;
  text(amount, colab.balance == null ? "—" : cuText(colab.balance, digits), small ? 13 : large ? 22 : 15, amountColor, "number");
  amount.addSpacer(2);
  text(amount, allocation && !small ? `/ ${cuText(allocation.total, 0)} CU` : "CU", m.cap, theme.secondary, "regular", 0.7);
  if (!small) amount.addSpacer(); else amount.addSpacer(6);
  if (grant && !large && !small) text(amount, grant, m.cap, grantInfo.waiting ? theme.warning : theme.secondary, "regular", 0.7);
  else if (value != null && !small) text(amount, `${Math.round(value)}%`, m.cap + 1, amountColor, "number");
  if (value != null) { fr.addSpacer(3); bar(small ? w : fr, span, value, barTone("colab", value, colabStale)); }
  if (large && (allocation || grant)) {
    fr.addSpacer(4);
    text(fr, [allocation && `消費 ${cuText(allocation.consumed, 2)} CU`, grant].filter(Boolean).join(" · "), m.cap, theme.secondary, "regular", 0.7);
  }
  return finish(w, now);
}

function finish(w, now) {
  w.refreshAfterDate = new Date((now + 600) * 1000);
  w.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}`;
  return w;
}

// Scriptable entry point — functions above can be tested without account data.
// Parameter: "demo" for sample values; a service name (claude/codex/antigravity/colab)
// picks what the circular and inline Lock Screen widgets show.
const options = widgetOptions(args.widgetParameter);
const result = await loadSnapshot(options.demo);
const family = config.widgetFamily || "medium";
const grantDay = options.grantDay || (options.demo ? null : loadSettings().colabGrantDay) || null;
const widget = buildWidget(result.snapshot, result.status, family, Date.now() / 1000, args.widgetParameter, grantDay);
Script.setWidget(widget);
if (!config.runsInWidget) await widget.presentMedium();
Script.complete();
