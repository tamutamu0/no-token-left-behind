const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('offline preview runs the shipped widget for every size and appearance without file or network access', () => {
  const root = path.join(__dirname, '..');
  const template = fs.readFileSync(path.join(root, 'Mac/WidgetPreview.html'), 'utf8');
  const widget = fs.readFileSync(path.join(root, 'Scriptable/AI Usage.js'), 'utf8').split('// Scriptable entry point')[0];
  const script = template.match(/<script>([\s\S]*)<\/script>/)[1].replace('/*WIDGET_SCRIPT*/', widget);
  const element = { innerHTML: '', textContent: '' };
  const context = vm.createContext({ window: {}, document: { getElementById: () => element } });
  vm.runInContext(script + '\nthis.demo = demoSnapshot; this.empty = emptySnapshot;', context);
  const now = 1900000000;
  for (const family of ['small', 'medium', 'large']) {
    for (const appearance of ['light', 'dark']) {
      for (const [snapshot, language] of [[context.demo(now), 'en'], [context.empty(now), 'en'], [context.demo(now), 'ja']]) {
        const result = context.window.renderUsagePreview(snapshot, family, appearance, now, language);
        assert.equal(result.ok, true);
        assert.match(element.innerHTML, /Antigravity/);
        assert.match(element.innerHTML, /Colab/);
        assert.match(element.innerHTML, /CU/);
        const words = language === 'ja' ? { small: /週間/, other: /残り/ } : { small: /Weekly/, other: /Left/ };
        assert.match(element.innerHTML, family === 'small' ? words.small : words.other);
        assert.doesNotMatch(element.innerHTML, /AI credits|scriptable:\/\/|fixture-secret/);
        assert.match(element.innerHTML, appearance === 'dark' ? /background:#1c1c1e/ : /background:#ffffff/);
      }
    }
  }
  assert.equal(context.FileManager, undefined);
  assert.equal(context.fetch, undefined);
  assert.equal(context.window.renderUsagePreview({}, 'medium', 'light', now).ok, false);
  assert.equal(element.textContent, 'Couldn’t load the preview.');
});
