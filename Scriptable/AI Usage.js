// AI Usage — Scriptable widget for Claude / Codex / Antigravity limits and Google Colab compute units.
// Reads iCloud Drive › Scriptable › ai-usage-snapshot-v2.json written by the Mac app.
// No network APIs and no credentials: the script only reads that file.
// Widget parameter (space separated): demo · rings|table · claude|codex|antigravity|colab · grant=<day> · lang=en|ja|zh|ko

const SERVICE_IDS = ["claude", "codex", "antigravity", "colab"];
const SOURCES = ["claudeStatusline", "claudeCli", "codexAppServer", "antigravityStatusline", "antigravityCli", "codexBar", "colabCli", "manual", "demo"];
const SNAPSHOT_FILE = "ai-usage-snapshot-v2.json";
const STYLES = ["rings", "table"];          // Home Screen layouts; rings is the default
const MAX_KB = 16;

// ---------------------------------------------------------------------------
// Languages. The device language picks one of these; anything else falls back to English.
const I18N = {
  en: {
    left: "Left", leftPct: "Left %", fiveHour: "5-hour", weekly: "Weekly", fiveShort: "5h", weekShort: "wk",
    in: "in {d}", ago: "{d} ago", now: "now", manual: "Manual", noData: "No data",
    awaitingRefresh: "Awaiting refresh", resetUnknown: "Reset time unknown", syncPending: "Sync pending",
    computeUnits: "Compute units", used: "Used {v} CU", grantIn: "Next grant in {n} days",
    grantTomorrow: "Next grant tomorrow", grantWaiting: "Grant pending (due {d})", grantShort: "{n}d",
    grantShortWaiting: "Pending", inlineGrant: "grant in {n}d", inlineWaiting: "grant pending",
    ringLegend: "Outer 5h · inner weekly", grantUntil: "Next grant",
    units: { d: "d", h: "h", m: "m", sep: " " }, unitsShort: { d: "d", h: "h", m: "m", sep: "" }
  },
  ja: {
    left: "残り", leftPct: "残り%", fiveHour: "5時間", weekly: "週間", fiveShort: "5h", weekShort: "週",
    in: "あと{d}", ago: "{d}前", now: "今", manual: "手動", noData: "未取得",
    awaitingRefresh: "再取得待ち", resetUnknown: "回復時刻不明", syncPending: "同期保留",
    computeUnits: "計算ユニット", used: "消費 {v} CU", grantIn: "次の付与まで あと{n}日",
    grantTomorrow: "次の付与 明日", grantWaiting: "付与待ち（予定{d}日）", grantShort: "あと{n}日",
    grantShortWaiting: "付与待ち", inlineGrant: "付与まで{n}日", inlineWaiting: "付与待ち",
    ringLegend: "外 5時間 ・ 内 週", grantUntil: "付与まで",
    units: { d: "日", h: "時間", m: "分", sep: "" }, unitsShort: { d: "日", h: "h", m: "m", sep: "", only: "分" }
  },
  zh: {
    left: "剩余", leftPct: "剩余%", fiveHour: "5小时", weekly: "每周", fiveShort: "5h", weekShort: "周",
    in: "还剩{d}", ago: "{d}前", now: "刚刚", manual: "手动", noData: "无数据",
    awaitingRefresh: "等待刷新", resetUnknown: "重置时间未知", syncPending: "同步待定",
    computeUnits: "计算单元", used: "已用 {v} CU", grantIn: "距下次发放 {n} 天",
    grantTomorrow: "明天发放", grantWaiting: "等待发放（预计{d}日）", grantShort: "{n}天",
    grantShortWaiting: "待发放", inlineGrant: "{n}天后发放", inlineWaiting: "待发放",
    ringLegend: "外圈 5小时 · 内圈 每周", grantUntil: "距发放",
    units: { d: "天", h: "小时", m: "分钟", sep: "" }, unitsShort: { d: "天", h: "h", m: "m", sep: "", only: "分钟" }
  },
  ko: {
    left: "남음", leftPct: "남음%", fiveHour: "5시간", weekly: "주간", fiveShort: "5h", weekShort: "주",
    in: "{d} 후", ago: "{d} 전", now: "방금", manual: "수동", noData: "데이터 없음",
    awaitingRefresh: "새로고침 대기", resetUnknown: "재설정 시간 알 수 없음", syncPending: "동기화 대기",
    computeUnits: "컴퓨팅 단위", used: "{v} CU 사용", grantIn: "다음 지급까지 {n}일",
    grantTomorrow: "내일 지급", grantWaiting: "지급 대기 ({d}일 예정)", grantShort: "{n}일",
    grantShortWaiting: "지급 대기", inlineGrant: "{n}일 후 지급", inlineWaiting: "지급 대기",
    ringLegend: "바깥 5시간 · 안쪽 주간", grantUntil: "다음 지급",
    units: { d: "일", h: "시간", m: "분", sep: " " }, unitsShort: { d: "일", h: "h", m: "m", sep: "", only: "분" }
  }
};
let LANG = "en";
function resolveLanguage(preferred) {
  const code = String(preferred || "en").toLowerCase();
  return code.startsWith("ja") ? "ja" : code.startsWith("zh") ? "zh" : code.startsWith("ko") ? "ko" : "en";
}
function setLanguage(preferred) { LANG = resolveLanguage(preferred); return LANG; }
function t(key, vars = {}) {
  const value = I18N[LANG][key] != null ? I18N[LANG][key] : I18N.en[key];
  return typeof value === "string" ? value.replace(/\{(\w+)\}/g, (_, k) => vars[k]) : value;
}
// 125 minutes → "2h 5m" (en) / "2時間5分" (ja); short form for tight cells → "2h5m".
function duration(minutes, short) {
  const u = t(short ? "unitsShort" : "units");
  const d = Math.floor(minutes / 1440), h = Math.floor(minutes % 1440 / 60), m = minutes % 60;
  if (d) return `${d}${u.d}${h ? `${u.sep}${h}${u.h}` : ""}`;
  if (h) return `${h}${u.h}${m ? `${u.sep}${m}${u.m}` : ""}`;
  return `${m}${u.only || u.m}`;
}

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
      !Array.isArray(raw.records) || raw.records.length > 8) return invalid();
  const seen = new Set();
  // Records for services this script does not know (older or newer Mac apps) are skipped, not fatal.
  const records = raw.records.filter(r => r && SERVICE_IDS.includes(r.service)).map(r => {
    if (seen.has(r.service) ||
        !SOURCES.includes(r.source) || (r.source === "demo") !== raw.isDemo) return invalid();
    seen.add(r.service);
    if (r.observedAt != null && !number(r.observedAt, -Number.MAX_VALUE, now + 60)) return invalid();
    const fiveHour = window(r.fiveHour), weekly = window(r.weekly);
    const balance = r.balance == null ? null : r.balance;
    const isBalance = r.service === "colab";
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
    { service: "colab", source: "demo", observedAt: now, balance: 142.5, balanceAllocation: { total: 200, basis: "demo" } }
  ] };
}
function remaining(window, now) {
  if (!window || (window.resetsAt != null && window.resetsAt <= now)) return null;
  return 100 - window.usedPercent;
}
function age(record, now) {
  if (record.observedAt == null) return t("noData");
  const minutes = Math.max(0, Math.floor((now - record.observedAt) / 60));
  const coarse = minutes < 60 ? minutes : minutes < 1440 ? Math.floor(minutes / 60) * 60 : Math.floor(minutes / 1440) * 1440;
  const time = minutes === 0 ? t("now") : t("ago", { d: duration(coarse, false) });
  return record.source === "manual" ? `${t("manual")} ${time}` : time;
}
function resetLabel(window, now) {
  if (!window) return t("noData");
  if (window.resetsAt == null) return t("resetUnknown");
  if (window.resetsAt <= now) return t("awaitingRefresh");
  return t("in", { d: duration(Math.ceil((window.resetsAt - now) / 60), false) });
}

async function loadSnapshot(useDemo) {
  if (useDemo) return { snapshot: normalizeSnapshot(demoSnapshot()), status: "demo" };
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
    if (!cloud.fileExists(path)) return { snapshot, status: "waitingForMac" };
    // A failed download is not fatal: an already-downloaded copy can still be read and validated.
    try { await cloud.downloadFileFromiCloud(path); } catch (_) { /* fall through to the local copy */ }
    const kb = cloud.fileSize(path);
    if (typeof kb !== "number" || kb > MAX_KB) throw new Error("Size");
    const next = normalizeSnapshot(JSON.parse(cloud.readString(path)));
    if (next.isDemo) return { snapshot: next, status: "demo" };
    // Do not replace a newer offline cache with an older iCloud version.
    if (next.generatedAt < snapshot.generatedAt && snapshot.records.length > 0)
      return { snapshot, status: "cachedNewer" };
    snapshot = next;
    local.writeString(cache, JSON.stringify(next));
    return { snapshot, status: "live" };
  } catch (error) {
    // The reason is shown only when the script is run inside Scriptable (never in the widget).
    return { snapshot, status: "syncFailed", reason: String(error && error.message || error).slice(0, 200) };
  }
}

// iCloud may keep the file as a placeholder on the iPhone, so it is downloaded before reading.
async function loadSettings() {
  try {
    const cloud = FileManager.iCloud();
    const path = cloud.joinPath(cloud.documentsDirectory(), "ai-usage-settings.json");
    if (!cloud.fileExists(path)) return {};
    await cloud.downloadFileFromiCloud(path);
    if (cloud.fileSize(path) > 4) return {};
    const raw = JSON.parse(cloud.readString(path));
    const settings = {};
    if (Number.isInteger(raw.colabGrantDay)) settings.colabGrantDay = raw.colabGrantDay;
    if (STYLES.includes(raw.style)) settings.style = raw.style;
    return settings;
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
  return record.source === "manual" ? isStale ? `${t("manual")} ${elapsed}` : t("manual") : isStale ? elapsed : "";
}

// Short reset label for the one-line medium cell: "in 4h59m" / "あと4h59m".
function shortResetLabel(window, now) {
  if (!window || window.resetsAt == null) return "";
  if (window.resetsAt <= now) return t("awaitingRefresh");
  return t("in", { d: duration(Math.ceil((window.resetsAt - now) / 60), true) });
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
  if (status.waiting) return t("grantWaiting", { d: status.day });
  const days = Math.ceil((status.nextAt - now) / 86400);
  return days <= 1 ? t("grantTomorrow") : t("grantIn", { n: days });
}
function grantShort(status, now) {
  if (!status) return "";
  return status.waiting ? t("grantShortWaiting") : t("grantShort", { n: Math.max(1, Math.ceil((status.nextAt - now) / 86400)) });
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
  const grant = tokens.map(x => /^grant=(\d{1,2})$/.exec(x)).find(Boolean);
  const lang = tokens.map(x => /^lang=([a-z-]+)$/.exec(x)).find(Boolean);
  return { demo: tokens.includes("demo"), service: tokens.find(x => SERVICE_NAMES[x]) || null,
    grantDay: grant ? Number(grant[1]) : null, lang: lang ? lang[1] : null,
    style: tokens.find(x => STYLES.includes(x)) || null };
}

// The window that runs out first for a service: the lowest remaining percentage it has.
function tightest(record, now) {
  const options = [[t("fiveShort"), record.fiveHour], [t("weekShort"), record.weekly]]
    .map(([label, win]) => ({ label, win, value: remaining(win, now) }))
    .filter(o => o.value != null);
  return options.sort((a, b) => a.value - b.value)[0] || null;
}

const DIAL = 72;

// The quota service whose tightest window has the least left (what the lock screen should warn about).
function mostConstrained(snapshot, now) {
  return ["claude", "codex", "antigravity"]
    .map(id => ({ id, t: tightest(snapshot.records.find(r => r.service === id) || {}, now) }))
    .filter(x => x.t).sort((a, b) => a.t.value - b.t.value).map(x => x.id)[0] || null;
}

// Draws a dial: up to two rings (each {value 0-100}) plus centred text lines. White only;
// iOS tints Lock Screen widgets to the wallpaper.
function drawDial(rings, lines) {
  const ctx = new DrawContext();
  ctx.size = new Size(DIAL, DIAL); ctx.opaque = false; ctx.respectScreenScale = true;
  const c = DIAL / 2;
  const arc = (radius, from, to) => {
    const path = new Path(), steps = Math.max(2, Math.ceil((to - from) / 4));
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const a = (from + (to - from) * i / steps - 90) * Math.PI / 180;
      points.push(new Point(c + radius * Math.cos(a), c + radius * Math.sin(a)));
    }
    path.addLines(points); return path;
  };
  rings.forEach((ring, i) => {
    const width = i === 0 ? 5 : 4, radius = c - 3 - i * 7.5;
    ctx.setLineWidth(width);
    ctx.setStrokeColor(new Color("ffffff", 0.25)); ctx.addPath(arc(radius, 0, 360)); ctx.strokePath();
    if (ring.value != null && ring.value > 0) {
      ctx.setStrokeColor(new Color("ffffff", 1)); ctx.addPath(arc(radius, 0, 3.6 * Math.min(ring.value, 100))); ctx.strokePath();
    }
  });
  ctx.setTextAlignedCenter();
  for (const line of lines) {
    ctx.setFont(line.font); ctx.setTextColor(new Color("ffffff", line.alpha == null ? 1 : line.alpha));
    ctx.drawTextInRect(line.text, new Rect(0, line.y, DIAL, line.h));
  }
  return ctx.getImage();
}

function quotaDial(id, record, now) {
  const five = record.fiveHour ? remaining(record.fiveHour, now) : null;
  const week = record.weekly ? remaining(record.weekly, now) : null;
  const t = tightest(record, now);
  const rings = [five, week].filter((v, i) => (i === 0 ? record.fiveHour : record.weekly) != null).map(value => ({ value }));
  return drawDial(rings.length ? rings : [{ value: null }], [
    { text: SHORT_NAMES[id], font: Font.semiboldSystemFont(8), y: 20, h: 10, alpha: 0.7 },
    { text: t ? String(Math.round(t.value)) : "—", font: Font.semiboldRoundedSystemFont(18), y: 28, h: 22 },
    { text: t ? t.label : "", font: Font.systemFont(7), y: 48, h: 9, alpha: 0.7 }
  ]);
}

function colabDial(record, percent, grantDay, now) {
  const g = grantStatus(record, grantDay, now);
  return drawDial([{ value: percent }], [
    { text: "Colab", font: Font.semiboldSystemFont(8), y: 18, h: 10, alpha: 0.7 },
    { text: record.balance == null ? "—" : cuText(record.balance, 0), font: Font.semiboldRoundedSystemFont(17), y: 27, h: 21 },
    { text: g ? grantShort(g, now) : "CU", font: Font.systemFont(7), y: 47, h: 9, alpha: 0.7 }
  ]);
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
      const tail = g ? ` · ${g.waiting ? t("inlineWaiting") : t("inlineGrant", { n: Math.ceil((g.nextAt - now) / 86400) })}` : colabPercent != null ? ` · ${Math.round(colabPercent)}%` : "";
      text(w, colab.balance != null ? `Colab ${cuText(colab.balance, 0)} CU${tail}` : "Colab —");
    } else if (pick) {
      const after = shortResetLabel(pick.t.win, now);
      text(w, `${SERVICE_NAMES[pick.id]} ${pick.t.label} ${Math.round(pick.t.value)}%${after ? ` · ${after}` : ""}`);
    } else text(w, "Usage —");
    return w;
  }

  if (family === "accessoryCircular") {
    // Activity-style rings drawn as one image: outer = 5-hour, inner = weekly, centre = the lower %.
    // Without a parameter it follows whichever service is closest to running out.
    w.addAccessoryWidgetBackground = true;
    w.setPadding(0, 0, 0, 0);
    const id = option.service || mostConstrained(snapshot, now) || "claude";
    const image = id === "colab" ? colabDial(colab, colabPercent, grantDay, now) : quotaDial(id, record(id), now);
    const img = w.addImage(image);
    img.imageSize = new Size(DIAL, DIAL);
    return w;
  }

  // accessoryRectangular: one line per service with a thin bar for each window, Colab last.
  w.setPadding(0, 0, 0, 0);
  const cols = { name: 38, num: 24, bar: 24, gap: 7 };
  const miniBar = (parent, value) => {
    const track = parent.addStack(); track.size = new Size(cols.bar, 3); track.cornerRadius = 1.5;
    track.backgroundColor = faint; track.layoutHorizontally();
    if (value != null && value > 0) {
      const fill = track.addStack(); fill.size = new Size(cols.bar * Math.min(value, 100) / 100, 3);
      fill.cornerRadius = 1.5; fill.backgroundColor = white;
    }
    track.addSpacer();
  };
  const windowCell = (parent, win) => {
    const c = row(parent); c.size = new Size(cols.num + 3 + cols.bar, 0);
    if (win == null) return;                       // no such window: leave it blank
    const value = remaining(win, now);
    const n = row(c); n.size = new Size(cols.num, 0); n.addSpacer();
    text(n, value == null ? "—" : String(Math.round(value)), 11, white, "number");
    c.addSpacer(3); miniBar(c, value);
  };
  const hasFiveHour = quotaIDs.some(id => record(id).fiveHour != null);
  const head = row(w); const hn = row(head); hn.size = new Size(cols.name, 0); text(hn, t("leftPct"), 8, dim);
  head.addSpacer();
  for (const [i, label] of [hasFiveHour ? t("fiveShort") : "", t("weekShort")].entries()) {
    if (i) head.addSpacer(cols.gap);
    const c = row(head); c.size = new Size(cols.num + 3 + cols.bar, 0); if (label) text(c, label, 8, dim); c.addSpacer();
  }
  for (const id of quotaIDs) {
    const r = record(id), line = row(w);
    const n = row(line); n.size = new Size(cols.name, 0); text(n, SHORT_NAMES[id], 11, white, "semibold");
    line.addSpacer();
    windowCell(line, r.fiveHour); line.addSpacer(cols.gap); windowCell(line, r.weekly);
  }
  const foot = row(w);
  const fn = row(foot); fn.size = new Size(cols.name, 0); text(fn, "Colab", 11, white, "semibold");
  foot.addSpacer();
  const g = grantStatus(colab, grantDay, now);
  text(foot, colab.balance == null ? "— CU" : `${cuText(colab.balance, 0)} CU`, 11, white, "number");
  if (g) { foot.addSpacer(4); text(foot, grantShort(g, now), 9, dim); }
  return w;
}

// Home Screen. Quota services (time windows that refill) are rows; Colab is a balance that only
// goes down, so it sits under a divider and leads with the CU amount instead of a percentage.
// Widths fit the smallest iPhone widgets (155 / 329×155 / 329×345); bigger devices widen the gaps.
function buildWidget(snapshot, status, family, now = Date.now() / 1000, parameter = "", grantDay = null, style = null) {
  if (String(family).startsWith("accessory")) return finish(buildAccessory(snapshot, family, parameter, now, grantDay), now);
  if ((style || widgetOptions(parameter).style || "rings") === "rings") return finish(buildRingWidget(snapshot, status, family, now, grantDay), now);
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
  const hint = snapshot.isDemo ? "DEMO" : status === "syncFailed" || status === "cachedNewer" ? t("syncPending") : "";

  // A quota cell: big remaining % with the reset time beside it (medium) or below the bar (large).
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
    // Two-tier rows so both windows fit at a readable size: the name, then 5-hour | weekly cells.
    const cellW = (m.width - m.gap) / 2;
    const hasFiveHour = services.some(([id]) => record(id).fiveHour != null);
    const head = row(w); head.size = new Size(m.width, 0);
    for (const [i, label] of [hasFiveHour ? t("fiveHour") : "", t("weekly")].entries()) {
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
    // Header: "Left" over the names, column titles over the numbers.
    const head = row(w);
    const left = row(head); left.size = new Size(m.label, 0);
    text(left, t("left"), m.head, theme.secondary);
    if (hint) { left.addSpacer(4); text(left, hint, m.head, theme.warning, "semibold"); }
    head.addSpacer();
    for (const [i, label] of [hasFiveHour ? t("fiveHour") : "", t("weekly")].entries()) {
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
  if (!small) { fl.addSpacer(1); text(fl, colabStale ? compactAge(colab, now) || age(colab, now) : t("computeUnits"), m.cap - 1, colabStale ? theme.warning : theme.secondary); }
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
    text(fr, [allocation && t("used", { v: cuText(allocation.consumed, 2) }), grant].filter(Boolean).join(" · "), m.cap, theme.secondary, "regular", 0.7);
  }
  return finish(w, now);
}

// ---------------------------------------------------------------------------
// Home Screen, ring style (the default). One column per service: outer ring = 5-hour window,
// inner ring = weekly, both remaining percentages inside, and only the reset times below.
// Colors evoke each tool's own brand; the inner ring is a lighter tone of the same hue.
const RING_COLORS = { claude: ["D97757", "EDB49C"], codex: ["10A37F", "7DD3BB"],
  antigravity: ["5B7CFA", "A9B9FF"], colab: ["F9AB00"] };

// Rings only (no text, so the numbers on top can follow light and dark mode). The neutral gray
// track reads on both backgrounds.
function drawRings(size, rings) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size); ctx.opaque = false; ctx.respectScreenScale = true;
  const c = size / 2, width = Math.max(3, size * 0.058), gap = size * 0.03;
  const arc = (radius, to) => {
    const path = new Path(), steps = Math.max(2, Math.ceil(to / 4)), points = [];
    for (let i = 0; i <= steps; i++) {
      const a = (to * i / steps - 90) * Math.PI / 180;
      points.push(new Point(c + radius * Math.cos(a), c + radius * Math.sin(a)));
    }
    path.addLines(points); return path;
  };
  ctx.setLineWidth(width);
  rings.forEach((ring, i) => {
    const radius = c - width / 2 - 0.5 - i * (width + gap);
    ctx.setStrokeColor(new Color("8e8e93", 0.22)); ctx.addPath(arc(radius, 360)); ctx.strokePath();
    if (ring.value != null && ring.value > 0) {
      ctx.setStrokeColor(new Color(ring.color)); ctx.addPath(arc(radius, 3.6 * Math.min(ring.value, 100))); ctx.strokePath();
    }
  });
  return ctx.getImage();
}

function buildRingWidget(snapshot, status, family, now, grantDay) {
  const large = family === "large" || family === "extraLarge", small = family === "small";
  const theme = widgetTheme();
  const w = new ListWidget();
  w.backgroundColor = theme.background;
  const text = (parent, value, size, color = theme.text, weight = "regular", scale = 0.7) => {
    const t = parent.addText(value);
    t.font = weight === "number" ? Font.semiboldRoundedSystemFont(size) :
      weight === "semibold" ? Font.semiboldSystemFont(size) : Font.systemFont(size);
    t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = scale; return t;
  };
  const row = parent => { const s = parent.addStack(); s.layoutHorizontally(); s.centerAlignContent(); return s; };
  const box = (parent, width, height) => {
    const s = parent.addStack(); s.layoutVertically(); s.centerAlignContent(); s.size = new Size(width, height); return s;
  };
  const record = id => snapshot.records.find(r => r.service === id) || { observedAt: null };
  const stale = r => r.observedAt != null && now - r.observedAt > 900;
  const ids = ["claude", "codex", "antigravity", "colab"];
  // Names always stay; a stale service turns its name orange, and the age of the oldest value
  // appears once in the corner (when the Mac sleeps, every service goes stale together).
  const oldest = ids.map(record).filter(stale).map(r => r.observedAt).sort((a, b) => a - b)[0];
  const ageText = oldest == null ? "" : (() => {
    const minutes = Math.floor((now - oldest) / 60);
    const coarse = minutes < 60 ? minutes : minutes < 1440 ? Math.floor(minutes / 60) * 60 : Math.floor(minutes / 1440) * 1440;
    return t("ago", { d: duration(coarse, true) });
  })();
  const hint = [snapshot.isDemo ? "DEMO" : status === "syncFailed" || status === "cachedNewer" ? t("syncPending") : "", ageText]
    .filter(Boolean).join(" · ");
  // Medium keeps a wider leading inset: on devices the 5h/week labels sat right on the edge.
  const pad = small ? [10, 10, 10, 10] : large ? [14, 14, 14, 14] : [11, 14, 11, 10];
  w.setPadding(pad[0], pad[1], pad[2], pad[3]);
  const size = small ? (hint ? 46 : 50) : large ? 82 : (hint ? 58 : 64);
  const lineH = 15, font = 11;

  const name = (parent, id, r, fontSize) => {
    const line = row(parent); line.addSpacer();
    text(line, small ? SHORT_NAMES[id] : SERVICE_NAMES[id], fontSize, stale(r) ? theme.warning : theme.secondary,
      stale(r) ? "semibold" : "regular", 0.6);
    line.addSpacer();
  };
  // "in 2h" with the time in bold: the localized pattern's text around {d} stays secondary.
  const inline = (line, d) => {
    const [before, after] = I18N[LANG].in.split("{d}");
    if (before.trim()) { text(line, before.trim(), font, theme.secondary); line.addSpacer(3); }
    text(line, d, font, theme.text, "semibold");
    if (after.trim()) { line.addSpacer(3); text(line, after.trim(), font, theme.secondary); }
  };
  const resetLine = (parent, width, win, label) => {
    const line = row(parent); line.size = new Size(width, lineH); line.addSpacer();
    if (win && win.resetsAt != null) {
      if (label) { text(line, label, font, theme.secondary); line.addSpacer(4); }
      if (win.resetsAt <= now) text(line, t("awaitingRefresh"), font, theme.secondary);
      else inline(line, duration(Math.ceil((win.resetsAt - now) / 60), !large));
    }
    line.addSpacer();
  };
  const ring = (parent, id, r) => {
    const colors = RING_COLORS[id], s = box(parent, size, size);
    const main = Math.round(size * 0.24), sub = Math.max(9, Math.round(size * 0.16));
    let rings, top = null, bottom = null, unit = "%";
    if (id === "colab") {
      const a = allocationStats(r), g = grantStatus(r, grantDay, now);
      rings = [{ value: a ? a.remainingPercent : null, color: colors[0] }];
      top = r.balance == null ? null : cuText(r.balance, 0); unit = "";
      bottom = small && g ? (g.waiting ? t("grantShortWaiting") : duration(Math.max(1, Math.ceil((g.nextAt - now) / 86400)) * 1440, true)) : "CU";
    } else {
      const five = r.fiveHour ? remaining(r.fiveHour, now) : undefined;
      const week = r.weekly ? remaining(r.weekly, now) : undefined;
      const shown = [five, week].filter(v => v !== undefined);
      rings = shown.length ? shown.map((value, i) => ({ value, color: colors[i] })) : [{ value: null, color: colors[0] }];
      top = shown.length ? shown[0] : null;
      if (shown.length === 2) bottom = week == null ? "—" : week;
    }
    s.backgroundImage = drawRings(size, rings);
    s.addSpacer();
    // On a device a row stretches across the ring and starts at its leading edge, so the
    // numbers are centred with a flexible spacer on each side.
    const t1 = row(s); t1.bottomAlignContent(); t1.addSpacer();
    text(t1, top == null ? "—" : String(typeof top === "number" ? Math.round(top) : top), main, theme.text, "number", 0.6);
    if (top != null && unit) { t1.addSpacer(1); text(t1, unit, Math.round(main * 0.55), theme.secondary, "number"); }
    t1.addSpacer();
    if (bottom != null) {
      const t2 = row(s); t2.bottomAlignContent(); t2.addSpacer();
      if (typeof bottom === "number") {
        text(t2, String(Math.round(bottom)), sub, theme.secondary, "number");
        t2.addSpacer(1); text(t2, "%", Math.round(sub * 0.75), theme.secondary, "number");
      } else text(t2, bottom, sub - 1, theme.secondary, "regular", 0.6);
      t2.addSpacer();
    }
    s.addSpacer();
  };
  const colabLines = (parent, width, r) => {
    const g = grantStatus(r, grantDay, now), a = allocationStats(r);
    const one = row(parent); one.size = new Size(width, lineH); one.addSpacer();
    const two = row(parent); two.size = new Size(width, lineH); two.addSpacer();
    if (large) {
      if (g) text(one, grantLabel(g, now), font, g.waiting ? theme.warning : theme.text, "semibold");
      text(two, a ? `${cuText(a.total, 0)} CU · ${t("used", { v: cuText(a.consumed, 1) })}` : t("computeUnits"), font, theme.secondary);
    } else if (g) {
      text(one, t("grantUntil"), font, theme.secondary);
      if (g.waiting) text(two, t("grantShortWaiting"), font, theme.warning, "semibold");
      else inline(two, duration(Math.max(1, Math.ceil((g.nextAt - now) / 86400)) * 1440, true));
    } else {
      // No grant day known yet: say what the number is rather than leaving the space blank.
      text(one, t("computeUnits"), font, theme.secondary);
      if (a) text(two, `/ ${cuText(a.total, 0)} CU`, font, theme.secondary);
    }
    one.addSpacer(); two.addSpacer();
  };

  if (small) {
    if (hint) { const h = row(w); h.addSpacer(); text(h, hint, 8, theme.warning, "semibold"); w.addSpacer(2); }
    for (const pair of [ids.slice(0, 2), ids.slice(2)]) {
      w.addSpacer();
      const line = row(w);
      pair.forEach((id, i) => {
        if (i) line.addSpacer();
        const r = record(id), cell = box(line, 64, size + 15);
        name(cell, id, r, 10); cell.addSpacer(2); ring(cell, id, r);
      });
    }
    w.addSpacer();
    return w;
  }

  if (large) {
    const head = row(w);
    text(head, t("ringLegend"), 10, theme.secondary); head.addSpacer();
    if (hint) text(head, hint, 10, theme.warning, "semibold");
    w.addSpacer(6);
    for (const pair of [ids.slice(0, 2), ids.slice(2)]) {
      w.addSpacer();
      const line = row(w);
      pair.forEach((id, i) => {
        if (i) line.addSpacer();
        const r = record(id), cell = box(line, 146, 15 + 4 + size + 6 + lineH * 2);
        name(cell, id, r, 12); cell.addSpacer(4); ring(cell, id, r); cell.addSpacer(6);
        if (id === "colab") colabLines(cell, 146, r);
        else { resetLine(cell, 146, r.fiveHour, t("fiveShort")); resetLine(cell, 146, r.weekly, t("weekShort")); }
      });
    }
    w.addSpacer();
    return w;
  }

  // Medium: the window labels appear once, at the left edge of the two reset lines.
  if (hint) { const h = row(w); h.addSpacer(); text(h, hint, 8, theme.warning, "semibold"); w.addSpacer(2); }
  const colW = 70, colH = 14 + 5 + size + 7 + lineH * 2;
  w.addSpacer();
  const main = row(w);
  const side = box(main, 20, colH); side.addSpacer();
  const hasFiveHour = ["claude", "codex", "antigravity"].some(id => record(id).fiveHour != null);
  for (const label of [hasFiveHour ? t("fiveShort") : "", t("weekShort")]) {
    const l = row(side); l.size = new Size(20, lineH); text(l, label, font, theme.secondary, "semibold", 0.5); l.addSpacer();
  }
  ids.forEach(id => {
    main.addSpacer();
    const r = record(id), col = box(main, colW, colH);
    name(col, id, r, 11); col.addSpacer(5); ring(col, id, r); col.addSpacer(7);
    if (id === "colab") colabLines(col, colW, r);
    else { resetLine(col, colW, r.fiveHour); resetLine(col, colW, r.weekly); }
  });
  w.addSpacer();
  return w;
}

function finish(w, now) {
  w.refreshAfterDate = new Date((now + 600) * 1000);
  w.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}`;
  return w;
}

// Scriptable entry point — functions above can be tested without account data.
const options = widgetOptions(args.widgetParameter);
setLanguage(options.lang || Device.language());
const result = await loadSnapshot(options.demo);
const family = config.widgetFamily || "medium";
const settings = options.demo ? {} : await loadSettings();
const grantDay = options.grantDay || settings.colabGrantDay || null;
const style = options.style || settings.style || "rings";
const widget = buildWidget(result.snapshot, result.status, family, Date.now() / 1000, args.widgetParameter, grantDay, style);
if (!config.runsInWidget && result.reason) console.log(`Couldn’t read ${SNAPSHOT_FILE}: ${result.reason}`);
Script.setWidget(widget);
if (!config.runsInWidget) await widget.presentMedium();
Script.complete();
