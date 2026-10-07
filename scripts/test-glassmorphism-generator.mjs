// Read the real component and tool pages; write stdout only.
// Public boundaries: color input, CSS/Tailwind output, preview pixels → contrast.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compile } from 'tailwindcss';
import { transform } from 'esbuild';
const source = readFileSync(new URL('../src/components/tools/GlassmorphismGeneratorTool.astro', import.meta.url), 'utf8');
const engine = source.split('// engine:start')[1].split('// engine:end')[0];
const ctx = vm.createContext({});
vm.runInContext(engine, ctx);
let count = 0;
function test(name, fn) { fn(); count++; console.log('PASS', name); }
test('3-digit HEX expands without a hash', () => {
  const color = ctx.parseColor('abc');
  assert.equal(color.hex, '#aabbcc');
});
test('invalid input reports character position and prevents stale output', () => {
  assert.equal(ctx.parseColor('#abz123').error, 'character');
  assert.equal(ctx.parseColor('#abz123').position, 3);
  assert.equal(ctx.parseColor('#1234').error, 'length');
  assert.doesNotMatch(source, /maxlength="7"/);
  assert.match(source, /copyBtn.disabled = true/);
});
const defaults = { bg: '#ffffff', alpha: 15, blur: 12, saturation: 180, border: '#ffffff', borderAlpha: 30, borderWidth: 1, radius: 16, shadow: '#000000', shadowAlpha: 20, text: '#111111', fallback: '#ffffff', opaque: false };
test('CSS starts opaque, enhances in @supports, and restores opaque accessibility states', () => {
  const css = ctx.exportCode(defaults, 'css');
  assert.ok(css.indexOf('background: #ffffff') < css.indexOf('@supports'));
  assert.match(css, /blur\(12px\) saturate\(180%\)/);
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /forced-colors: active/);
  assert.match(css, /background: Canvas/);
  assert.match(css, /color: CanvasText/);
  assert.match(css, /\.glass\.glass-opaque/);
  assert.doesNotMatch(ctx.exportCode({ ...defaults, opaque: true }, 'css'), /blur\(12px\)/);
});
test('actual preview pixels include worst point and alpha compositing in all three states', () => {
  const pixels = [0,0,0,255, 255,255,255,255];
  const result = ctx.worstContrast(pixels, '#ffffff', 50, '#000000');
  // WCAG relative luminance of encoded sRGB 0.5 = 0.2140411405.
  assert.ok(Math.abs(result.ratio - 5.2808228) < 0.001);
  assert.equal(result.pixel, 0);
  assert.equal(result.aa, true);
  assert.equal(ctx.worstContrast(pixels, '#ffffff', 100, '#000000').ratio, 21);
  assert.equal(ctx.worstContrast(pixels, '#ffffff', 0, '#ffffff').ratio, 1);
});
test('forced colors also overrides the explicit opaque class', () => {
  assert.match(ctx.exportCode(defaults, 'css'), /@media \(forced-colors: active\) \{\n  \.glass, \.glass\.glass-opaque/);
  assert.match(ctx.exportCode(defaults, 'tailwind'), /@media \(forced-colors: active\) \{\n    &, &\.glass-opaque/);
});
const tw = await compile('@tailwind utilities;\n' + ctx.exportCode(defaults, 'tailwind'));
const compiled = tw.build(['glass']);
test('Tailwind v4 actually emits the utility and its state rules', () => {
  assert.match(compiled, /\.glass/);
  assert.match(compiled, /blur\(12px\) saturate\(180%\)/);
  assert.match(compiled, /forced-colors: active/);
  assert.doesNotMatch(compiled, /@utility/);
});
for (const format of ['css', 'tailwind']) {
  const css = format === 'css' ? ctx.exportCode(defaults, format) : compiled;
  const result = await transform(css, { loader: 'css', target: 'chrome100' });
  test(`${format} compiles without CSS warnings`, () => {
    assert.equal(result.warnings.length, 0);
    assert.match(result.code, /\.glass\.glass-opaque/);
  });
}
for (const [input, expected] of [['#FFF', '#ffffff'], ['000', '#000000'], ['＃ＡＢＣ', '#aabbcc'], ['  abcDEF  ', '#abcdef'], ['#123', '#112233']]) {
  test(`HEX normalization ${input}`, () => assert.equal(ctx.parseColor(input).hex, expected));
}
for (const input of ['', '#', '12', '1234', '12345', '1234567', '#12345678']) {
  test(`invalid HEX length ${input}`, () => assert.equal(ctx.parseColor(input).error, 'length'));
}
for (const [input, position] of [['12x', 3], ['a🙂c', 2], ['##abc', 1], ['abc def', 4], ['rgb(1,2,3)', 1]]) {
  test(`invalid HEX character ${input}`, () => assert.equal(ctx.parseColor(input).position, position));
}
test('black, white, #777 and red match WCAG published calculations', () => {
  assert.equal(ctx.luminance([0, 0, 0]), 0);
  assert.equal(ctx.luminance([255, 255, 255]), 1);
  assert.equal(ctx.luminance([255, 0, 0]), 0.2126);
  assert.ok(Math.abs(ctx.worstContrast([119,119,119,255], '#fff', 0, '#fff').ratio - 4.47808945) < 1e-7);
});
test('4.499 cannot pass by rounding, and large text uses 3:1', () => {
  const channel = (1.055 * ((1.05 / 4.499 - 0.05) ** (1 / 2.4)) - 0.055) * 255;
  const result = ctx.worstContrast([channel,channel,channel,255], '#000', 0, '#fff');
  assert.equal(result.aa, false);
  assert.equal(result.large, true);
});
test('worst point can be in the middle, not an endpoint or average', () => {
  const result = ctx.worstContrast([0,0,0,255, 120,120,120,255, 255,255,255,255], '#fff', 0, '#777');
  assert.equal(result.pixel, 1);
  assert.ok(result.ratio < 1.02);
});
for (const format of ['css', 'tailwind']) {
  for (const opaque of [false, true]) {
    test(`${format} preserves explicit settings, opaque=${opaque}`, () => {
      const code = ctx.exportCode({ ...defaults, opaque, bg: '#abc', text: '#123', fallback: '#fed', radius: 0, blur: 0, saturation: 0, borderWidth: 0.5, borderAlpha: 0, shadowAlpha: 0 }, format);
      assert.match(code, /border: 0.5px solid rgba\(255, 255, 255, 0.00\)/);
      assert.match(code, /border-radius: 0px/);
      assert.match(code, /color: #123/);
      assert.match(code, /background: #fed/);
      assert.match(code, /0 4px 24px rgba\(0, 0, 0, 0.00\)/);
      if (opaque) assert.doesNotMatch(code, /@supports/); else assert.match(code, /blur\(0px\) saturate\(0%\)/);
    });
  }
}
const strings = vm.runInNewContext('(' + source.split('const STRINGS = ')[1].split('\nconst L =')[0].replace(/;\s*$/, '') + ')');
for (const lang of ['zh','ja','ko']) {
  test(`${lang} UI keys and message placeholders are complete`, () => {
    assert.deepEqual(Object.keys(strings[lang]).sort(), Object.keys(strings.en).sort());
    for (const key of Object.keys(strings.en).filter(key => typeof strings.en[key] === 'string')) assert.deepEqual(strings[lang][key].match(/\{\w+\}/g), strings.en[key].match(/\{\w+\}/g));
  });
}
test('generated code highlights keep unscoped styles; local images and settings are not stored or uploaded', () => {
  assert.match(source, /<style is:global>/);
  assert.match(source, /\.gsg-hl-prop/);
  const script = source.split('<script is:inline')[1].split('</script>')[0];
  assert.doesNotMatch(script, /innerHTML|fetch\(|XMLHttpRequest|localStorage|sessionStorage|ztPersist|sendBeacon/);
});
for (const [lang, fill, expected] of [['en', '#112233', '16.14'], ['zh', '#003366', '12.60'], ['ja', '#0017c1', '11.09'], ['ko', '#002244', '16.00']]) {
  const text = readFileSync(new URL(`../src/content/tools/glassmorphism-generator/${lang}.mdx`, import.meta.url), 'utf8');
  for (const match of text.matchAll(/\{\/\* gsg-check: (.*?) \*\/\}/g)) {
    const example = JSON.parse(match[1]);
    test(`${lang} documented CSS matches the real output`, () => {
      const css = ctx.exportCode({ ...defaults, ...example.settings }, 'css');
      assert.ok(css.includes(example.contains));
      assert.ok(text.includes(example.contains));
      const block = text.slice(match.index + match[0].length).match(/```css\n([\s\S]*?)```/)[1];
      for (const line of block.trim().split('\n')) assert.ok(css.includes(line.trim()), line);
    });
  }
  test(`${lang} fallback contrasts and SEO fit the page contract`, () => {
    const ratio = (Math.floor(ctx.worstContrast([0, 0, 0, 255], fill, 100, '#fff').ratio * 100) / 100).toFixed(2);
    assert.equal(ratio, expected);
    assert.ok(text.includes(`${ratio}:1`));
    assert.ok(text.includes('18.88:1'));
    assert.ok(text.match(/seoTitle: "(.*?)"/)[1].length <= (lang === 'en' ? 60 : 30));
    if (lang === 'en') assert.ok(text.match(/seoDescription: "(.*?)"/)[1].length >= 150 && text.match(/seoDescription: "(.*?)"/)[1].length <= 160);
    const body = text.split('---')[2].replace(/```[\s\S]*?```/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '');
    const words = lang === 'en' ? body.trim().split(/\s+/).length : (body.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []).length + (body.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
    const bounds = { en: [600, 1000], zh: [900, 1500], ja: [1300, 2200], ko: [1100, 1900] }[lang];
    assert.ok(words >= bounds[0] && words <= bounds[1], `${words} outside ${bounds}`);
  });
}
// Drive the actual inline script through inputs and observable outputs.
// Canvas is a fixed opaque black background here; real filtering is checked in Ego.
function mount({ filterSupport = true, canvasFilter = true, reduced = false, forced = false } = {}) {
  class Node {
    constructor(value = '') { this.value = this.defaultValue = String(value); this.dataset = {}; this.style = {}; this.children = []; this.handlers = {}; this.attributes = {}; this._text = ''; }
    addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
    async fire(name) { for (const fn of this.handlers[name] || []) await fn({ target: this }); }
    setAttribute(name, value) { this.attributes[name] = value; }
    get textContent() { return this._text + this.children.map(n => n.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    append(node) { this.children.push(node); }
    replaceChildren() { this.children = []; this._text = ''; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    select() {} focus() {} remove() {} click() {}
    getContext() { return this.context ||= { ...(canvasFilter ? { filter: '' } : {}), fillRect() {}, drawImage() {}, beginPath() {}, arc() {}, fill() {}, save() {}, translate() {}, scale() {}, restore() {}, createLinearGradient() { return { addColorStop() {} }; }, getImageData() { return { data: [0, 0, 0, 255] }; } }; }
  }
  const nodes = {};
  const colors = ['bg', 'border', 'shadow', 'text', 'fallback'].map(key => {
    const node = nodes[key] = new Node(defaults[key]); node.dataset.hex = key;
    const swatch = nodes[`swatch-${key}`] = new Node(defaults[key]); swatch.dataset.color = key;
    return node;
  });
  const ranges = ['alpha', 'blur', 'saturation', 'borderAlpha', 'borderWidth', 'radius', 'shadowAlpha'].map(key => {
    const node = nodes[key] = new Node(defaults[key]); node.dataset.range = key; node.dataset.unit = '';
    nodes[`${key}-val`] = new Node(); return node;
  });
  for (const key of ['copy', 'code', 'status', 'card', 'scene', 'contrast-values', 'image', 'reset', 'opaque']) nodes[key] = new Node();
  nodes['preview-canvas'] = new Node(); nodes['preview-canvas'].clientWidth = nodes['preview-canvas'].clientHeight = 100;
  nodes.state = new Node('normal'); nodes.format = new Node('css'); nodes.preset = new Node('sunset'); nodes.file = new Node(); nodes.file.files = [];
  const wrap = new Node();
  wrap.querySelector = selector => selector.startsWith('#gsg-') ? nodes[selector.slice(5)] : nodes[`swatch-${selector.match(/"(.*?)"/)[1]}`];
  wrap.querySelectorAll = selector => selector === '[data-color]' ? colors.map(n => nodes[`swatch-${n.dataset.hex}`]) : selector === '[data-hex]' ? colors : selector === '[data-range]' ? ranges : selector.startsWith('input[') ? [...colors, ...ranges, ...colors.map(n => nodes[`swatch-${n.dataset.hex}`])] : [...colors, ...ranges, nodes.opaque, nodes.state, nodes.format];
  const media = {};
  const requests = [], images = [], clipboard = [];
  let pendingFrame;
  const context = vm.createContext({ L: strings.en, document: { currentScript: { closest() { return wrap; } }, createElement() { return new Node(); }, addEventListener() {}, execCommand() { return false; } },
    window: {}, navigator: { clipboard: { async writeText(text) { clipboard.push(text); } } },
    matchMedia(query) { return media[query] = { matches: query.includes('forced') ? forced : reduced, addEventListener(name, fn) { this.change = fn; } }; },
    CSS: { supports() { return filterSupport; } }, getComputedStyle() { return { paddingLeft: '16' }; },
    requestAnimationFrame(fn) { pendingFrame = fn; return 1; }, cancelAnimationFrame() {}, ResizeObserver: class { observe() {} },
    URL: { createObjectURL() { return 'blob:local'; }, revokeObjectURL(url) { requests.push(url); } },
    Image: class { constructor() { this.naturalWidth = this.naturalHeight = 10; images.push(this); } decode() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); } }, setTimeout(fn) { fn(); }
  });
  vm.runInContext('(function () {' + source.split('    (function () {')[1].split('</script>')[0], context);
  return { nodes, media, images, requests, clipboard, context, async input(key, value) { nodes[key].value = String(value); await nodes[key].fire('input'); if (pendingFrame) { const fn = pendingFrame; pendingFrame = null; fn(); } } };
}
const ui = mount();
await ui.input('bg', '#badcolor');
test('invalid color clears code, hides stale preview and disables copy', () => {
  assert.equal(ui.nodes.copy.disabled, true);
  assert.equal(ui.nodes.card.hidden, true);
  assert.equal(ui.nodes.code.textContent, '');
  assert.equal(ui.nodes.bg.attributes['aria-invalid'], 'true');
  assert.match(ui.nodes.status.textContent, /position 5/);
});
await ui.input('bg', '#fff');
test('valid color recovers the preview and copy', () => {
  assert.equal(ui.nodes.copy.disabled, false);
  assert.equal(ui.nodes.card.hidden, false);
  assert.match(ui.nodes.code.textContent, /rgba\(255, 255, 255, 0.15\)/);
});
for (const state of ['unsupported', 'reduced']) {
  await ui.input('state', state);
  test(`preview ${state} uses the opaque fallback`, () => {
    assert.equal(ui.nodes.card.style.background, '#ffffff');
    assert.equal(ui.nodes.card.style.backdropFilter, 'none');
  });
}
await ui.input('state', 'normal'); ui.nodes.opaque.checked = true; await ui.input('opaque', '');
test('manual opaque override changes exported code and displayed contrast together', () => {
  assert.doesNotMatch(ui.nodes.code.textContent, /@supports/);
  assert.equal(ui.nodes.card.style.backdropFilter, 'none');
  assert.match(ui.nodes['contrast-values'].textContent, /Glass: 18.88:1/);
});
for (const options of [{ reduced: true }, { filterSupport: false }, { forced: true }, { canvasFilter: false }]) {
  const page = mount(options);
  test(`system or browser fallback ${JSON.stringify(options)} is visible`, () => {
    if (options.canvasFilter === false) assert.match(page.nodes['contrast-values'].textContent, /cannot be estimated/);
    else if (options.forced) assert.match(page.nodes['contrast-values'].textContent, /System|system/);
    else {
      assert.equal(page.nodes.card.style.backdropFilter, 'none');
      assert.match(page.nodes['contrast-values'].textContent, /Glass: 18.88:1/);
    }
  });
}
await ui.nodes.reset.fire('click'); await ui.nodes.copy.fire('click');
test('reset restores defaults and clipboard receives complete CSS', () => {
  assert.equal(ui.nodes.opaque.checked, false);
  assert.equal(ui.nodes.bg.value, '#ffffff');
  assert.equal(ui.clipboard[0], ui.nodes.code.textContent);
});
await ui.input('format', 'tailwind'); await ui.nodes.copy.fire('click');
test('format switch copies Tailwind rather than previous CSS', () => assert.match(ui.clipboard[1], /^@utility glass/));
ui.context.navigator.clipboard.writeText = async () => { throw new Error('denied'); };
await ui.nodes.copy.fire('click');
test('clipboard denial and failed fallback are reported', () => assert.match(ui.nodes.status.textContent, /Copy failed/));
ui.nodes.file.files = [{ size: 1 }]; const loading = ui.nodes.file.fire('change');
await ui.nodes.reset.fire('click'); ui.images[0].resolve(); await loading;
test('late image load cannot undo reset and its blob URL is released', () => {
  assert.equal(ui.nodes.preset.value, 'sunset');
  assert.equal(ui.nodes.status.textContent, '');
  assert.deepEqual(ui.requests, ['blob:local']);
});
ui.nodes.file.files = [{ size: 21 * 1024 * 1024 }]; await ui.nodes.file.fire('change');
test('image file limit is enforced before decoding', () => assert.match(ui.nodes.status.textContent, /20 MB/));
ui.nodes.file.files = [{ size: 1 }]; const badImage = ui.nodes.file.fire('change'); ui.images[1].reject(new Error('decode')); await badImage;
test('image decode failure has a recoverable message and releases the URL', () => {
  assert.match(ui.nodes.status.textContent, /Cannot display/);
  assert.equal(ui.requests.length, 2);
});

// ---------- v2 page layout ----------
{
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script'));
  test('v2 root receives its height directly', () => assert.match(markup, /^<div class="gsg-wrap">/));
  test('controls and preview use a bounded generate grid', () => {
    assert.match(markup, /class="gsg-rail zt-rail"/);
    assert.match(source, /grid-template-columns: clamp\(270px, 24vw, 320px\) minmax\(0, 1fr\)/);
    assert.match(source, /\.gsg-preview-canvas \{[^}]*flex: 1 1 0; min-height: 180px/);
    assert.match(source, /#gsg-scene \{[^}]*height: 100%/);
  });
  test('copy controls precede secondary controls', () => assert.ok(markup.indexOf('id="gsg-copy"') < markup.indexOf('class="gsg-secondary"')));
  test('CSS expansion remains bounded inside the rail', () => assert.match(source, /\.gsg-pre \{ max-height: 20rem; overflow: auto/));
  test('empty status reserves height above preview', () => {
    assert.match(source, /#gsg-status \{ height: 3rem; flex: none/);
    assert.ok(markup.indexOf('id="gsg-status"') < markup.indexOf('id="gsg-preview-canvas"'));
  });
  test('output and image consequences stay visible', () => {
    assert.match(markup, /<p class="gsg-note">\{L.imageLocal\}<\/p>/);
    assert.match(markup, /<p class="gsg-note">\{L.scope\}<\/p>/);
  });
  test('mobile shows main controls then preview then secondary settings', () => {
    assert.match(source, /@media \(max-width: 860px\)/);
    for (const [cls, order] of [['primary',1],['preview-section',2],['secondary',3]]) assert.ok(source.includes('.gsg-'+cls+' { order: '+order+'; }'));
    assert.match(source, /\.gsg-output-header \.btn-copy, \.gsg-output-header select \{ min-height: 44px/);
  });
  test('empty preview has text and disappears on mobile', () => {
    assert.match(markup, /<p class="gsg-empty">\{L.empty\}<\/p>/);
    assert.match(source, /\.gsg-preview-canvas:has\(\.gsg-card\[hidden\]\) \{ display: none/);
  });
  test('tips are excluded from client strings', () => {
    assert.match(source, /const \{ tips: TIPS, \.\.\.CLIENT_L \} = L/);
    assert.match(source, /define:vars=\{\{ L: CLIENT_L \}\}/);
  });
  test('listed as generate', () => assert.match(readFileSync(new URL('../src/data/tool-layouts.ts', import.meta.url), 'utf8'), /'glassmorphism-generator': 'generate'/));
  const keys = ['bg','alpha','blur','saturation','advanced','background','state','output','contrast'];
  for (const lang of ['en','zh','ja','ko']) {
    test(lang + ': nine localized tips and empty state', () => {
      assert.deepEqual(Object.keys(strings[lang].tips).sort(), [...keys].sort());
      assert.ok(keys.every(k => strings[lang].tips[k].length > 20));
      assert.ok(strings[lang].empty.length > 10);
    });
    const mdx = readFileSync(new URL(`../src/content/tools/glassmorphism-generator/${lang}.mdx`, import.meta.url), 'utf8');
    const front = mdx.slice(0, mdx.indexOf('\n---\n', 4));
    const steps = [...front.slice(front.indexOf('\nsteps:\n'), front.indexOf('\nfaqItems:')).matchAll(/^  - (".*")$/gm)].map(m => JSON.parse(m[1]));
    test(lang + ': five bounded steps before FAQ', () => {
      assert.equal(steps.length, 5); assert.ok(steps.every(v => v.length <= 280) && steps.join('').length <= 1200);
    });
    test(lang + ': usage heading removed and limits retained', () => {
      assert.doesNotMatch(mdx, /^## (?:How to generate|使用方法|用法|使い方|사용법|사용 방법)/m);
      assert.ok(mdx.includes({ en: '## Differences and limits', zh: '## 估计值、兼容性与上限', ja: '## 推定値の読み方と制限', ko: '## 처리 한계' }[lang]));
    });
  }
}

// "Border, shadow & readability" used `display: flex` on its <summary>, which drops the
// disclosure marker (the other summary on the page and the rest of the site keep it).
test('both folded sections keep the native disclosure marker', () => {
  const style = source.slice(source.lastIndexOf('<style'));
  const rules = [...style.matchAll(/([^{}]*\bsummary\b[^{}]*)\{([^{}]*)\}/g)];
  assert.ok(rules.some(([, sel]) => sel.includes('.gsg-options summary')) && rules.some(([, sel]) => sel.includes('.gsg-code-details summary')));
  for (const [, sel, body] of rules) {
    const display = /(?:^|;)\s*display\s*:\s*([^;]+)/.exec(body);
    assert.ok(!display || display[1].trim() === 'list-item', sel.trim() + ' sets display: ' + (display && display[1]));
    assert.doesNotMatch(body, /list-style\s*:\s*none/, sel.trim());
  }
  assert.doesNotMatch(style, /summary::-webkit-details-marker\s*\{[^}]*display\s*:\s*none/);
  assert.match(source, /<details class="gsg-options"><summary>/);
});

console.log(`${count} passed`);
