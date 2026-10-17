#!/usr/bin/env node
// Renders the README screenshots from demo data only (never account data).
//
//   node Tools/render-screenshots.cjs [repo-root] [out-dir]
//
// For every language (en, ja, zh, ko) it writes <out-dir>/<lang>/{hero,light,dark,table,lock,anatomy}.png,
// plus <out-dir>/social-preview.png (the English hero at 1280×640, under GitHub's 1 MB limit).
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
const shots = { hero: [1280, 640], light: [1000, 455], dark: [1000, 455], table: [1000, 455], lock: [600, 320], anatomy: [1000, 520] };

const tpl = fs.readFileSync(path.join(root, 'Mac/WidgetPreview.html'), 'utf8');
const shim = tpl.slice(tpl.indexOf('class Stack'), tpl.indexOf('/*WIDGET_SCRIPT*/'));
const render = tpl.slice(tpl.indexOf('const escapePreviewText'), tpl.indexOf('window.renderUsagePreview'));
const widget = fs.readFileSync(path.join(root, 'Scriptable/AI Usage.js'), 'utf8').split('// Scriptable entry point')[0];

// Callout text for the anatomy picture, per language.
const CALLOUTS = {
  en: { service: 'Service', five: '5-hour left (outer ring)', resets: 'Time until each resets', week: 'Weekly left (inner ring)',
        colab: 'Colab compute units left', grant: 'Countdown to the next grant' },
  ja: { service: 'サービス', five: '5時間の残り（外側）', resets: 'それぞれの回復までの時間', week: '週の残り（内側）',
        colab: 'Colabの残り計算ユニット', grant: '次の付与までの日数' },
  zh: { service: '服务', five: '5小时剩余（外圈）', resets: '各自距离重置', week: '每周剩余（内圈）',
        colab: 'Colab 剩余计算单元', grant: '距下次发放' },
  ko: { service: '서비스', five: '5시간 남음(바깥)', resets: '각각 리셋까지 남은 시간', week: '주간 남음(안쪽)',
        colab: 'Colab 남은 컴퓨팅 단위', grant: '다음 지급까지' }
};

// Hero banner copy, per language.
const HERO = {
  en: { lead: 'Your rate limits reset whether you use them or not.', punch: 'Don’t let them sleep.',
        sub: 'Claude Code · Codex · Gemini · Colab — left & resetting, on your iPhone Lock Screen.' },
  ja: { lead: '5時間枠は、使わなくてもリセットされる。', punch: 'レートリミット、寝かせるな。',
        sub: 'Claude Code・Codex・Gemini・Colab の残りと回復時刻を、iPhone のロック画面に。' },
  zh: { lead: '额度不用，到点也会清零。', punch: '别让它睡着。',
        sub: 'Claude Code · Codex · Gemini · Colab 的剩余额度与重置时间，直接显示在 iPhone 锁屏上。' },
  ko: { lead: '한도는 쓰든 안 쓰든 리셋됩니다.', punch: '재우지 마세요.',
        sub: 'Claude Code · Codex · Gemini · Colab의 남은 한도와 리셋 시간을 iPhone 잠금 화면에.' }
};

const page = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
.scene{display:flex;gap:28px;align-items:flex-start;padding:36px;min-width:100vw;min-height:100vh;position:relative}
.light,.table{background:linear-gradient(140deg,#e9eef7,#f6e9ee)}.dark{background:linear-gradient(140deg,#0e1424,#2a1630)}
.lock{background:linear-gradient(140deg,#25356b,#7a4a8f);flex-direction:column;align-items:center;gap:18px;padding:40px 60px;color:#fff}
.hero{background:radial-gradient(1200px 700px at 85% 20%,#3b2a7a 0%,transparent 60%),linear-gradient(135deg,#0b1020,#1a1238 60%,#2b0f2e);color:#fff;display:grid;grid-template-columns:560px 1fr;gap:40px;align-items:center;padding:56px 64px}
.hero h1{font-size:64px;line-height:1.02;margin:0 0 22px;letter-spacing:-1.5px;font-weight:800}
.hero h1 span{background:linear-gradient(90deg,#7cf0c5,#7aa8ff 55%,#ff8ad8);-webkit-background-clip:text;color:transparent}
.hero .lead{font-size:24px;opacity:.82;margin:0 0 8px;line-height:1.3}.hero .punch{font-size:38px;font-weight:800;margin:0 0 26px;line-height:1.15}
.hero .sub{font-size:17px;opacity:.7;line-height:1.45;margin:0}.hero p{text-wrap:balance}.hero .herostack{display:flex;flex-direction:column;gap:18px;align-items:flex-start}
.hero .lockrow{display:flex;gap:14px;align-items:center;padding:14px 18px;border-radius:22px;background:rgba(255,255,255,.08);backdrop-filter:blur(6px)}
.anatomy{background:#f4f5f8;display:block}.anatomy>.w{position:absolute;left:254px;top:150px}.anatomy .widget{width:364px;height:170px}
.w{overflow:hidden;border-radius:22px;box-shadow:0 8px 28px rgba(0,0,0,.18)}.w>.widget{width:100%;height:100%}
.text{white-space:nowrap;line-height:1.18;flex-shrink:0;font-variant-numeric:tabular-nums}i{display:block}
.clock{font-size:84px;font-weight:600;letter-spacing:-2px;line-height:1}.row{display:flex;gap:18px;align-items:center}
.acc{display:flex;overflow:hidden}.acc>.widget{width:100%;height:100%}
.callout{position:absolute;font-size:15px;font-weight:600;color:#1f2a44;white-space:nowrap;background:#fff;border:1.5px solid #c9d1e3;border-radius:999px;padding:5px 12px}
svg.lines{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}
</style><body><script>${shim}${widget}\n${render}
const Q = new URLSearchParams(location.search), mode = Q.get('m') || 'light', lang = Q.get('lang') || 'en';
const CALLOUTS = ${JSON.stringify(CALLOUTS)}, HERO = ${JSON.stringify(HERO)};
setLanguage(lang);
const now = new Date(2026, 9, 17, 10, 30).getTime() / 1000;
const snap = normalizeSnapshot(demoSnapshot(now), now);
const scene = document.createElement('div'); scene.className = 'scene ' + mode; document.body.appendChild(scene);
const box = (w, h, inner) => '<div class=w style="width:' + w + 'px;height:' + h + 'px">' + inner + '</div>';
const style = Q.get('s') || (mode === 'table' ? 'table' : 'rings');
const home = (f, ap) => previewMarkup(buildWidget(snap, '', f, now, '', 4, style), ap);
const acc = (f, p, w, h, r) => { const wd = buildWidget(snap, '', f, now, p, 4);
  return '<div class=acc style="width:' + w + 'px;height:' + h + 'px;border-radius:' + r + ';' + (wd.addAccessoryWidgetBackground ? 'background:rgba(255,255,255,.18)' : '') + '">' + previewMarkup(wd, 'dark') + '</div>'; };
if (mode === 'hero') {
  const h = HERO[lang] || HERO.en;
  scene.innerHTML = '<div><h1><span>No Token<br>Left Behind</span></h1><p class=lead>' + h.lead + '</p><p class=punch>' + h.punch + '</p><p class=sub>' + h.sub + '</p></div>' +
    '<div class=herostack>' + box(364, 170, home('medium', 'dark')) + '<div class=lockrow>' + acc('accessoryCircular', '', 72, 72, '50%') +
    acc('accessoryCircular', 'claude', 72, 72, '50%') + acc('accessoryCircular', 'colab', 72, 72, '50%') + acc('accessoryRectangular', '', 157, 72, '10px') + '</div></div>';
} else if (mode === 'lock') {
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
  callout(find(t => t === 'Claude'), c.service, 'left', -100);
  callout(find(t => t === '72'), c.five, 'left', -30);
  callout(find(t => t === '38'), c.week, 'left', 95);
  callout(find(t => t === '143'), c.colab, 'right', -110);
  callout(find(t => /18/.test(t) && t.length > 2), c.grant, 'right', 40);
  callout(find(t => t === '4h'), c.resets, 'right', 120);
} else {
  const ap = mode === 'dark' ? 'dark' : 'light';
  scene.classList.toggle('light', mode === 'table');
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
// GitHub's social preview must stay under 1 MB, so it is rendered at 1x (1280×640).
execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  `--user-data-dir=${path.join(os.tmpdir(), 'ai-usage-chrome')}`, '--window-size=1280,640',
  `--screenshot=${path.join(outDir, 'social-preview.png')}`, `file://${html}?m=hero&lang=en`], { stdio: 'ignore' });
console.log(path.relative(root, path.join(outDir, 'social-preview.png')));
