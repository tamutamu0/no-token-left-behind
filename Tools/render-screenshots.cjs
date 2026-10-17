// Renders README screenshots from demo data only (no account data).
// Usage: node Tools/render-screenshots.cjs <repo-root> <out.html>, then open out.html?m=light|dark|lock
const fs=require('fs');
const [,,root,out]=process.argv;
const tpl=fs.readFileSync(root+'/Mac/WidgetPreview.html','utf8');
const shim=tpl.slice(tpl.indexOf('class Stack'),tpl.indexOf('/*WIDGET_SCRIPT*/'));
const render=tpl.slice(tpl.indexOf('const escapePreviewText'),tpl.indexOf('window.renderUsagePreview'));
const fns=fs.readFileSync(root+'/Scriptable/AI Usage.js','utf8').split('// Scriptable entry point')[0];
fs.writeFileSync(out,`<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,sans-serif}
.scene{display:flex;gap:28px;align-items:flex-start;padding:36px;width:max-content}
.light{background:linear-gradient(140deg,#e9eef7,#f6e9ee)}.dark{background:linear-gradient(140deg,#0e1424,#2a1630)}
.lock{background:linear-gradient(140deg,#25356b,#7a4a8f);flex-direction:column;align-items:center;gap:18px;padding:40px 60px;color:#fff}
.w{overflow:hidden;border-radius:22px;box-shadow:0 8px 28px rgba(0,0,0,.18)}.w>.widget{width:100%;height:100%}
.text{white-space:nowrap;line-height:1.18;flex-shrink:0;font-variant-numeric:tabular-nums}i{display:block}
.clock{font-size:84px;font-weight:600;letter-spacing:-2px;line-height:1}.row{display:flex;gap:18px;align-items:center}
.acc{display:flex;overflow:hidden}.acc>.widget{width:100%;height:100%}.scene{min-width:100vw;min-height:100vh}
</style><body><script>${shim}${fns}\n${render}
const Q=new URLSearchParams(location.search), mode=Q.get('m')||'light';
const now=new Date(2026,9,17,10,30).getTime()/1000;
const snap=normalizeSnapshot(demoSnapshot(now),now);
const scene=document.createElement('div');scene.className='scene '+mode;document.body.appendChild(scene);
const box=(w,h,inner,extra='')=>'<div class=w style="width:'+w+'px;height:'+h+'px;'+extra+'">'+inner+'</div>';
if(mode==='lock'){

  const acc=(f,p,w,h,r)=>{const wd=buildWidget(snap,'',f,now,p,4);return '<div class=acc style="width:'+w+'px;height:'+h+'px;border-radius:'+r+';'+(wd.addAccessoryWidgetBackground?'background:rgba(255,255,255,.18)':'')+'">'+previewMarkup(wd,'dark')+'</div>'};
  scene.innerHTML='<div>'+acc('accessoryInline','',260,22,'0')+'</div><div class=clock>10:30</div><div class=row>'+acc('accessoryRectangular','',157,72,'10px')+acc('accessoryCircular','',72,72,'50%')+acc('accessoryCircular','claude',72,72,'50%')+acc('accessoryCircular','colab',72,72,'50%')+'</div>';
}else{
  const ap=mode==='dark'?'dark':'light';
  scene.innerHTML=[['small',170,170],['medium',364,170],['large',364,382]].map(([f,w,h])=>box(w,h,previewMarkup(buildWidget(snap,'',f,now,'',4),ap))).join('');
}
<\/script>`);
