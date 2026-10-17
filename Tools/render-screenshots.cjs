#!/usr/bin/env node
// Renders the README screenshots from demo data only (never account data).
//
//   node Tools/render-screenshots.cjs [repo-root] [out-dir]
//
// For every language (en, ja, zh, ko) it writes <out-dir>/<lang>/{light,dark,lock,anatomy}.png.
// It uses the shipped widget code with the same Scriptable shim as the Mac preview, and
// headless Google Chrome for the pixels (set CHROME=/path/to/chrome to override).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(process.argv[2] || '.');
const outDir = path.resolve(process.argv[3] || path.join(root, 'docs/images'));
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const languages = ['en', 'ja', 'zh', 'ko'];
const shots = { light: [1000, 455], dark: [1000, 455], lock: [600, 320], anatomy: [1000, 520] };

const tpl = fs.readFileSync(path.join(root, 'Mac/WidgetPreview.html'), 'utf8');
const shim = tpl.slice(tpl.indexOf('class Stack'), tpl.indexOf('/*WIDGET_SCRIPT*/'));
const render = tpl.slice(tpl.indexOf('const escapePreviewText'), tpl.indexOf('window.renderUsagePreview'));
const widget = fs.readFileSync(path.join(root, 'Scriptable/AI Usage.js'), 'utf8').split('// Scriptable entry point')[0];

// Callout text for the anatomy picture, per language.
const CALLOUTS = {
  en: { service: 'Service', five: 'Left in the 5-hour window', resets: 'Time until it resets', week: 'Left this week',
        colab: 'Colab compute units left', grant: 'Countdown to the next grant' },
  ja: { service: 'サービス', five: '5時間枠の残り', resets: '回復までの時間', week: '今週の残り',
        colab: 'Colabの残り計算ユニット', grant: '次の付与までの日数' },
  zh: { service: '服务', five: '5小时额度剩余', resets: '距离重置', week: '本周剩余',
        colab: 'Colab 剩余计算单元', grant: '距下次发放' },
  ko: { service: '서비스', five: '5시간 한도 남음', resets: '재설정까지 남은 시간', week: '이번 주 남음',
        colab: 'Colab 남은 컴퓨팅 단위', grant: '다음 지급까지' }
};

const page = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
.scene{display:flex;gap:28px;align-items:flex-start;padding:36px;min-width:100vw;min-height:100vh;position:relative}
.light{background:linear-gradient(140deg,#e9eef7,#f6e9ee)}.dark{background:linear-gradient(140deg,#0e1424,#2a1630)}
.lock{background:linear-gradient(140deg,#25356b,#7a4a8f);flex-direction:column;align-items:center;gap:18px;padding:40px 60px;color:#fff}
.anatomy{background:#f4f5f8;display:block}.anatomy>.w{position:absolute;left:254px;top:150px}.anatomy .widget{width:364px;height:170px}
.w{overflow:hidden;border-radius:22px;box-shadow:0 8px 28px rgba(0,0,0,.18)}.w>.widget{width:100%;height:100%}
.text{white-space:nowrap;line-height:1.18;flex-shrink:0;font-variant-numeric:tabular-nums}i{display:block}
.clock{font-size:84px;font-weight:600;letter-spacing:-2px;line-height:1}.row{display:flex;gap:18px;align-items:center}
.acc{display:flex;overflow:hidden}.acc>.widget{width:100%;height:100%}
.callout{position:absolute;font-size:15px;font-weight:600;color:#1f2a44;white-space:nowrap;background:#fff;border:1.5px solid #c9d1e3;border-radius:999px;padding:5px 12px}
svg.lines{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
</style><body><script>${shim}${widget}\n${render}
const Q = new URLSearchParams(location.search), mode = Q.get('m') || 'light', lang = Q.get('lang') || 'en';
const CALLOUTS = ${JSON.stringify(CALLOUTS)};
setLanguage(lang);
const now = new Date(2026, 9, 17, 10, 30).getTime() / 1000;
const snap = normalizeSnapshot(demoSnapshot(now), now);
const scene = document.createElement('div'); scene.className = 'scene ' + mode; document.body.appendChild(scene);
const box = (w, h, inner) => '<div class=w style="width:' + w + 'px;height:' + h + 'px">' + inner + '</div>';
const home = (f, ap) => previewMarkup(buildWidget(snap, '', f, now, '', 4), ap);
if (mode === 'lock') {
  const acc = (f, p, w, h, r) => { const wd = buildWidget(snap, '', f, now, p, 4);
    return '<div class=acc style="width:' + w + 'px;height:' + h + 'px;border-radius:' + r + ';' + (wd.addAccessoryWidgetBackground ? 'background:rgba(255,255,255,.18)' : '') + '">' + previewMarkup(wd, 'dark') + '</div>'; };
  scene.innerHTML = '<div>' + acc('accessoryInline', '', 260, 22, '0') + '</div><div class=clock>10:30</div><div class=row>' +
    acc('accessoryRectangular', '', 157, 72, '10px') + acc('accessoryCircular', '', 72, 72, '50%') +
    acc('accessoryCircular', 'claude', 72, 72, '50%') + acc('accessoryCircular', 'colab', 72, 72, '50%') + '</div>';
} else if (mode === 'anatomy') {
  const k = 1.35;
  scene.innerHTML = box(364 * k, 170 * k, '<div style="transform:scale(' + k + ');transform-origin:0 0;width:364px;height:170px">' + home('medium', 'light') + '</div>');
  const c = CALLOUTS[lang] || CALLOUTS.en, base = { left: 0, top: 0, width: 1000 };
  const spans = [...scene.querySelectorAll('.text')];
  const find = (test, nth = 0) => spans.filter(s => test(s.textContent))[nth];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'lines'); scene.appendChild(svg);
  const callout = (el, label, side, dy) => {
    if (!el) return;
    const r = el.getBoundingClientRect(), x = (side === 'left' ? r.left - 7 : r.right + 7) - base.left, y = r.top - base.top + r.height / 2;
    const tag = document.createElement('div'); tag.className = 'callout'; tag.textContent = label; scene.appendChild(tag);
    const tx = side === 'left' ? 30 : base.width - tag.offsetWidth - 30, ty = Math.max(12, y + dy - tag.offsetHeight / 2);
    tag.style.left = tx + 'px'; tag.style.top = ty + 'px';
    const ex = side === 'left' ? tx + tag.offsetWidth : tx, ey = ty + tag.offsetHeight / 2;
    svg.insertAdjacentHTML('beforeend', '<path d="M' + ex + ' ' + ey + ' L' + x + ' ' + y + '" stroke="#8a96b3" stroke-width="1.5" fill="none"/><circle cx="' + x + '" cy="' + y + '" r="3.5" fill="#1f2a44"/>');
  };
  const resetText = shortResetLabel(snap.records.find(r => r.service === 'claude').fiveHour, now);
  const resets = spans.filter(s => s.textContent === resetText);
  callout(find(t => t === 'Claude'), c.service, 'left', -70);
  callout(find(t => t === '72'), c.five, 'left', -120);
  callout(resets[0], c.resets, 'right', -110);
  callout(find(t => t === '38'), c.week, 'right', -60);
  callout(find(t => t === '142.5'), c.colab, 'left', 90);
  callout(find(t => /18/.test(t) && t.length > 2), c.grant, 'right', 90);
} else {
  const ap = mode === 'dark' ? 'dark' : 'light';
  scene.innerHTML = [['small', 170, 170], ['medium', 364, 170], ['large', 364, 382]].map(([f, w, h]) => box(w, h, home(f, ap))).join('');
}
<\/script>`;

if (!fs.existsSync(chrome)) { console.error('Google Chrome not found. Set CHROME=/path/to/chrome.'); process.exit(1); }
const html = path.join(os.tmpdir(), 'ai-usage-screenshots.html');
fs.writeFileSync(html, page);
for (const lang of languages) {
  fs.mkdirSync(path.join(outDir, lang), { recursive: true });
  for (const [mode, [w, h]] of Object.entries(shots)) {
    const out = path.join(outDir, lang, mode + '.png');
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
      `--user-data-dir=${path.join(os.tmpdir(), 'ai-usage-chrome')}`, `--window-size=${w},${h}`, `--screenshot=${out}`,
      `file://${html}?m=${mode}&lang=${lang}`], { stdio: 'ignore' });
    console.log(path.relative(root, out));
  }
}
