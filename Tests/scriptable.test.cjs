const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../Scriptable/AI Usage.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.split('// Scriptable entry point')[0] + '\nthis.api = { normalizeSnapshot, emptySnapshot, demoSnapshot, remaining, age, resetLabel, loadSnapshot, buildWidget, allocationStats, widgetOptions, nextGrantAt, grantLabel, grantStatus };', context);
const api = context.api;
const now = 1900000000;
const clean = () => JSON.parse(JSON.stringify(api.demoSnapshot(now)));

test('official CLI credits are accepted without breaking the quota rows, zero is a real balance', () => {
  const input = clean(); input.isDemo = false;
  for (const r of input.records) { r.source = 'manual'; delete r.balanceAllocation; }
  input.records[4].source = 'antigravityCli'; input.records[4].balance = 0;
  const result = api.normalizeSnapshot(input, now);
  assert.equal(result.records[4].balance, 0);
  assert.equal(result.records[4].source, 'antigravityCli');
  assert.equal(api.remaining(result.records[0].fiveHour, now), 72);
});

test('normalization strips unexpected credentials and private fields', () => {
  const input = clean(); input.token = 'fixture-secret'; input.records[0].email = 'fixture@example.invalid';
  const normalized = JSON.stringify(api.normalizeSnapshot(input, now));
  assert.ok(!normalized.includes('fixture'));
  assert.equal(JSON.parse(normalized).records.length, 5);
});
test('malformed, future, mixed, duplicate and incompatible data is rejected', () => {
  const edits = [s => s.version = 2, s => s.generatedAt = now + 61,
    s => s.records[0].observedAt = now + 61, s => s.records[0].fiveHour.usedPercent = 101,
    s => s.records[0].fiveHour.usedPercent = NaN, s => s.records[0].source = 'manual',
    s => s.records[1].service = 'claude', s => s.records[3].fiveHour = { usedPercent: 10 },
    s => s.records[0].balance = 1, s => s.records[0].observedAt = null,
    s => s.records[3].balance = -1, s => s.records[3].balance = '10'];
  for (const edit of edits) { const s = clean(); edit(s); assert.throws(() => api.normalizeSnapshot(s, now)); }
});
test('confirmed Colab allocation gives consumption and percentage while legacy balance stays unknown', () => {
  const input = clean(); const r = input.records[3];
  r.balance = 160.5;
  const stats = api.allocationStats(api.normalizeSnapshot(input, now).records[3]);
  assert.equal(stats.total, 200); assert.equal(stats.consumed, 39.5);
  assert.equal(Math.round(stats.remainingPercent), 80);
  input.isDemo = false; input.records = [r]; r.source = 'colabCli'; r.balanceAllocation.basis = 'confirmedInitialGrant';
  assert.equal(api.allocationStats(api.normalizeSnapshot(input, now).records[0]).consumed, 39.5);
  delete r.balanceAllocation;
  assert.equal(api.allocationStats(api.normalizeSnapshot(input, now).records[0]), null);
});
test('allocation must be confirmed for this service and source; untrusted fields are stripped', () => {
  for (const edit of [r => r.balanceAllocation.total = 0, r => r.balanceAllocation.total = 100,
    r => r.balanceAllocation.basis = 'planGuess', r => r.balance = null, r => r.service = 'googleCredits']) {
    const input = clean(); input.records.pop(); edit(input.records[3]);
    assert.throws(() => api.normalizeSnapshot(input, now));
  }
  const input = clean(); input.records[3].balanceAllocation.token = 'fixture-secret';
  assert.ok(!JSON.stringify(api.normalizeSnapshot(input, now)).includes('fixture'));
});
test('expired reset never becomes 100 percent and missing window is unknown', () => {
  assert.equal(api.remaining({ usedPercent: 70, resetsAt: now }, now), null);
  assert.equal(api.remaining(undefined, now), null);
  assert.equal(api.remaining({ usedPercent: 70, resetsAt: now + 1 }, now), 30);
  assert.equal(api.resetLabel({ usedPercent: 70, resetsAt: now }, now), '再取得待ち');
});
test('age uses observation timestamp rather than snapshot sync timestamp', () => {
  assert.equal(api.age({ observedAt: now - 3600, source: 'manual' }, now), '手動 1時間前');
  assert.equal(api.age({ observedAt: null }, now), '未取得');
});

function fileManager(files) {
  return { fileExists: p => files.has(p), fileSize: p => Buffer.byteLength(files.get(p)) / 1024,
    readString: p => files.get(p), writeString: (p,s) => files.set(p,s),
    joinPath: (a,b) => `${a}/${b}`, libraryDirectory: () => '/local', documentsDirectory: () => '/cloud',
    downloadFileFromiCloud: async () => {} };
}
test('iCloud failure retains old observation and cloud demo cannot replace live cache', async () => {
  const current = Math.floor(Date.now()/1000);
  const live = clean(); live.isDemo = false; live.generatedAt = current - 5;
  for (const r of live.records) { r.source = 'manual'; delete r.balanceAllocation; r.observedAt = current - 7200; }
  const local = new Map([['/local/ai-usage-cache-v1.json', JSON.stringify(live)]]);
  const cloud = new Map();
  context.FileManager = { local: () => fileManager(local), iCloud: () => fileManager(cloud) };
  let result = await api.loadSnapshot(false);
  assert.equal(result.snapshot.records[0].observedAt, current - 7200);
  cloud.set('/cloud/ai-usage-snapshot.json', JSON.stringify(api.demoSnapshot(current)));
  result = await api.loadSnapshot(false);
  assert.equal(result.snapshot.isDemo, true);
  assert.equal(JSON.parse(local.get('/local/ai-usage-cache-v1.json')).isDemo, false);
  cloud.set('/cloud/ai-usage-snapshot.json', '{invalid');
  result = await api.loadSnapshot(false);
  assert.equal(result.snapshot.isDemo, false);
  assert.equal(result.status, '同期待ち · 前回の値');
});
function fakeScriptable() {
  const labels = [], elements = [];
  class Stack {
    constructor() { elements.push(this); }
    addText(t) { labels.push(t); const result = {}; elements.push(result); return result; }
    addStack() { return new Stack(); }
    addImage(img) { const result = { image: img }; elements.push(result); return result; }
    addSpacer() {} layoutHorizontally() {} layoutVertically() {} centerAlignContent() {} bottomAlignContent() {} setPadding() {}
  }
  context.ListWidget = Stack;
  context.Point = class { constructor(x, y) { this.x = x; this.y = y; } };
  context.Rect = class { constructor(x, y, w, h) { Object.assign(this, { x, y, w, h }); } };
  context.Path = class { constructor() { this.points = []; } addLines(p) { this.points.push(...p); } };
  context.DrawContext = class {
    constructor() { this.ops = []; }
    setLineWidth() {} setStrokeColor(c) { this.stroke = c; } addPath(p) { this.path = p; }
    strokePath() { this.ops.push({ kind: 'arc', points: this.path.points.length, alpha: this.stroke.alpha }); }
    setTextAlignedCenter() {} setFont() {} setTextColor(c) { this.fill = c; }
    drawTextInRect(text) { this.ops.push({ kind: 'text', text, hex: this.fill.hex }); }
    getImage() { return { ops: this.ops }; }
  };
  context.Color = class {
    constructor(hex, alpha) { this.hex = hex; this.alpha = alpha; }
    static dynamic(light, dark) { return { light, dark, dynamic: true }; }
  };
  context.Size = class { constructor(width, height) { this.width = width; this.height = height; } };
  context.Font = { semiboldSystemFont: () => ({}), semiboldRoundedSystemFont: () => ({}), systemFont: () => ({}) };
  context.Script = { name: () => 'AI Usage' };
  return { labels, elements };
}
test('home: quota rows, Colab as a balance under a divider, absent windows paint nothing', () => {
  const { labels, elements } = fakeScriptable();
  const geometry = { small: { cell: 59, bar: 2 }, medium: { cell: 98, gap: 12, bar: 3 }, large: { cell: 92, gap: 12, bar: 4 } };
  const render = (snapshot, size, status = '') => {
    const start = elements.length; labels.length = 0;
    const w = api.buildWidget(api.normalizeSnapshot(snapshot, now), status, size, now);
    const bars = elements.slice(start).filter(e => e.size?.height === geometry[size].bar && e.backgroundColor);
    return { w, labels: [...labels], elements: elements.slice(start),
      tracks: bars.filter(e => e.backgroundColor.light.hex === 'e9e9ed'),
      fills: bars.filter(e => e.backgroundColor.light.hex !== 'e9e9ed') };
  };
  for (const size of ['small','medium','large']) {
    const r = render(clean(), size, 'iCloud · 取得時刻は各行');
    assert.equal(r.w.refreshAfterDate.getTime(), (now + 600) * 1000);
    assert.equal(r.w.backgroundColor.light.hex, 'ffffff');
    assert.equal(r.w.backgroundColor.dark.hex, '1c1c1e');
    // Every size: 3 services × (5時間, 週間) + Colab.
    assert.equal(r.tracks.length, 7);
    assert.equal(r.fills.length, 7);
    assert.ok(r.elements.some(e => e.size?.height === 1 && e.backgroundColor?.light.hex === 'e9e9ed'), 'divider');
    for (const name of ['Claude','Codex','Antigravity','Colab','%']) assert.ok(r.labels.includes(name), size + ' ' + name);
    assert.ok(r.labels.includes('DEMO'));
    assert.ok(!r.labels.some(t => /iCloud|取得時刻は各行|AI credits|未取得|Usage/.test(t)));
    const live = clean(); live.records[3].balance = 160.5;
    const l = render(live, size);
    assert.ok(l.labels.includes({ small: '161', medium: '160.5', large: '160.5' }[size]));
    assert.ok(l.labels.includes(size === 'small' ? 'CU' : '/ 200 CU'));
    if (size !== 'small') assert.ok(l.labels.includes('80%'));
    if (size === 'large') assert.ok(l.labels.includes('消費 39.5 CU'));
  }
  // small keeps both windows under shared column titles.
  const s = render(clean(), 'small');
  assert.ok(s.labels.includes('5時間') && s.labels.includes('週間'));
  for (const v of ['72','38','25','81','90','64']) assert.ok(s.labels.includes(v), v);
  assert.ok(!s.labels.some(t => t.startsWith('あと')));
  assert.ok(render(clean(), 'medium').labels.includes('あと2h'));
  assert.ok(render(clean(), 'medium').labels.includes('あと1h'));
  assert.ok(render(clean(), 'large').labels.includes('あと2時間'));
  for (const kind of ['expired','zero','missing']) {
    const input = clean();
    if (kind === 'expired') input.records[0].fiveHour.resetsAt = now;
    if (kind === 'zero') input.records[0].fiveHour.usedPercent = 100;
    if (kind === 'missing') input.records[0].fiveHour = null;
    const r = render(input, 'medium');
    assert.equal(r.fills.length, 6);
    if (kind === 'missing') { assert.equal(r.tracks.length, 6); assert.ok(!r.labels.includes('—')); assert.ok(r.labels.includes('5時間')); }
    if (kind === 'expired') { assert.ok(r.labels.includes('—')); assert.ok(r.labels.includes('再取得待ち')); }
  }
  for (const size of ['small','medium','large']) {
    const snapshot = clean();
    for (const r of snapshot.records.slice(0,3)) r.fiveHour = null;
    const r = render(snapshot, size);
    assert.ok(!r.labels.includes('—'));
    assert.ok(!r.labels.includes('5時間'));
    assert.equal(r.tracks.length, 4);
    if (size !== 'small') assert.ok(r.labels.includes('あと3日'));
  }
  // Without a confirmed grant Colab shows only the balance: no percentage, no bar.
  const legacy = clean(); delete legacy.records[3].balanceAllocation;
  const g = render(legacy, 'medium');
  assert.ok(g.labels.includes('142.5') && g.labels.includes('CU'));
  assert.ok(!g.labels.includes('71%'));
  assert.equal(g.tracks.length, 6);
  for (const element of elements)
    for (const key of ['textColor','backgroundColor'])
      if (element[key]) assert.equal(element[key].dynamic, true);
});
test('lock screen: monochrome inline, rectangular and circular widgets', () => {
  const { labels, elements } = fakeScriptable();
  const render = (snapshot, family, parameter = '') => {
    const start = elements.length; labels.length = 0;
    const w = api.buildWidget(api.normalizeSnapshot(snapshot, now), '', family, now, parameter);
    return { w, labels: [...labels], elements: elements.slice(start) };
  };
  // Inline: the window that runs out first across services (demo Codex 5h has 25%).
  const inline = render(clean(), 'accessoryInline');
  assert.deepEqual(inline.labels, ['Codex 5h 25% · あと1h']);
  assert.deepEqual(render(clean(), 'accessoryInline', 'claude').labels, ['Claude 週 38% · あと3日']);
  assert.deepEqual(render(clean(), 'accessoryInline', 'colab').labels, ['Colab 143 CU · 71%']);
  const rect = render(clean(), 'accessoryRectangular');
  for (const t of ['Claude','Codex','AG','Colab','5h','週','残り%','72','38','25','81','143 CU']) assert.ok(rect.labels.includes(t), t);
  const noFive = clean(); noFive.records[1].fiveHour = null;
  assert.ok(!render(noFive, 'accessoryRectangular').labels.includes('—'));
  // Circular: rings drawn as one image. Without a parameter it follows the most constrained service.
  const dial = (snapshot, parameter = '') => {
    const r = render(snapshot, 'accessoryCircular', parameter);
    const ops = r.elements.find(e => e.image).image.ops;
    return { w: r.w, texts: ops.filter(o => o.kind === 'text').map(o => o.text),
      tracks: ops.filter(o => o.kind === 'arc' && o.alpha < 1).length, fills: ops.filter(o => o.kind === 'arc' && o.alpha === 1).length, ops };
  };
  const auto = dial(clean());
  assert.equal(auto.w.addAccessoryWidgetBackground, true);
  assert.deepEqual(auto.texts, ['Codex', '25', '5h']);       // demo Codex 5h (25%) is lowest
  assert.equal(auto.tracks, 2); assert.equal(auto.fills, 2);  // outer 5時間, inner 週間
  assert.deepEqual(dial(clean(), 'claude').texts, ['Claude', '38', '週']);
  const weeklyOnly = clean(); weeklyOnly.records[1].fiveHour = null;
  const single = dial(weeklyOnly, 'codex');
  assert.equal(single.tracks, 1);
  assert.deepEqual(single.texts, ['Codex', '81', '週']);
  assert.deepEqual(dial(clean(), 'colab').texts, ['Colab', '143', 'CU']);
  for (const o of auto.ops) if (o.kind === 'text') assert.equal(o.hex, 'ffffff');
  // Lock Screen colors are plain white with opacity, so iOS can tint them to the wallpaper.
  for (const e of elements) if (e.textColor) assert.equal(e.textColor.hex, 'ffffff');
  assert.equal(api.widgetOptions('demo colab').demo, true);
  assert.equal(api.widgetOptions('demo colab').service, 'colab');
  assert.equal(api.widgetOptions('').service, null);
});

test('next Colab grant counts down to the configured renewal day, clamped to short months', () => {
  const t = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime() / 1000;
  assert.equal(api.nextGrantAt(15, t(2026, 10, 17)), t(2026, 11, 15, 0));
  assert.equal(api.nextGrantAt(20, t(2026, 10, 17)), t(2026, 10, 20, 0));
  assert.equal(api.nextGrantAt(31, t(2027, 2, 3)), t(2027, 2, 28, 0));
  assert.equal(api.nextGrantAt(17, t(2026, 10, 17)), t(2026, 11, 17, 0));
  assert.equal(api.nextGrantAt(0, t(2026, 10, 17)), null);
  assert.equal(api.nextGrantAt(null, t(2026, 10, 17)), null);
  assert.equal(api.grantLabel(api.grantStatus(null, 20, t(2026, 10, 17)), t(2026, 10, 17)), '次の付与まで あと3日');
  assert.equal(api.grantLabel(null, 0), '');
  // A grant observed on the 6th overrides the configured 4th.
  const seen = { lastGrantAt: t(2026, 10, 6, 9) };
  assert.equal(api.grantStatus(seen, 4, t(2026, 10, 17)).day, 6);
  assert.equal(api.grantLabel(api.grantStatus(seen, 4, t(2026, 10, 17)), t(2026, 10, 17)), '次の付与まで あと20日');
  // Expected day passed with no newer grant observed: waiting, not a fresh countdown.
  assert.equal(api.grantLabel(api.grantStatus(seen, 4, t(2026, 11, 8)), t(2026, 11, 8)), '付与待ち（予定6日）');
  assert.equal(api.grantStatus({ lastGrantAt: t(2026, 11, 6, 9) }, 4, t(2026, 11, 8)).waiting, false);
  // No grant observed yet: the configured day counts down and never claims "waiting".
  assert.equal(api.grantStatus({}, 4, t(2026, 11, 8)).waiting, false);
  assert.equal(api.widgetOptions('colab grant=15').grantDay, 15);
});

test('lastGrantAt is accepted only on an official Colab record', () => {
  const live = clean(); live.isDemo = false;
  for (const r of live.records) { r.source = 'manual'; delete r.balanceAllocation; }
  live.records[3].source = 'colabCli'; live.records[3].lastGrantAt = now - 86400;
  assert.equal(api.normalizeSnapshot(live, now).records[3].lastGrantAt, now - 86400);
  for (const edit of [s => s.records[3].lastGrantAt = now + 3600, s => s.records[3].lastGrantAt = 'x',
    s => { s.records[0].lastGrantAt = now - 10; }]) {
    const c = JSON.parse(JSON.stringify(live)); edit(c); assert.throws(() => api.normalizeSnapshot(c, now));
  }
});

test('new sync file takes priority and a damaged update retains the verified cache', async () => {
  const current = Math.floor(Date.now()/1000);
  const old = clean(); old.isDemo = false; old.generatedAt = current - 120;
  for (const r of old.records) { r.source = 'manual'; delete r.balanceAllocation; r.observedAt = current - 120; }
  const next = JSON.parse(JSON.stringify(old)); next.generatedAt = current - 10;
  next.records[0].fiveHour.usedPercent = 43; next.records[0].observedAt = current - 10;
  const local = new Map();
  const cloud = new Map([['/cloud/ai-usage-snapshot.json',JSON.stringify(old)],
    ['/cloud/ai-usage-snapshot-v2.json',JSON.stringify(next)]]);
  context.FileManager = { local: () => fileManager(local), iCloud: () => fileManager(cloud) };
  const loaded = await api.loadSnapshot(false);
  assert.equal(loaded.snapshot.records[0].fiveHour.usedPercent, 43);
  cloud.set('/cloud/ai-usage-snapshot-v2.json', '{broken');
  const retained = await api.loadSnapshot(false);
  assert.equal(retained.snapshot.records[0].fiveHour.usedPercent, 43);
  assert.equal(retained.snapshot.records[0].observedAt, current - 10);
});
