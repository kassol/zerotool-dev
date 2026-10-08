// Cubic Bezier Generator — preset values and labels name the system and version they come from
//
// Read:  src/components/tools/CubicBezierGeneratorTool.astro (preset buttons and the 4-language
//        label table in the frontmatter); src/content/tools/cubic-bezier-generator/*.mdx;
//        ToolLayout.astro and persistence.ts for actual shortcut and storage behavior
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defect: the "Material" presets are the Material Design 2 curves but were not
// labelled with a version (Material 3's standard curve is (0.2, 0, 0, 1)), and "iOS Default"
// (0.25, 0.1, 0.25, 1) is Core Animation's `.default` timing function, not the UIView animation
// default. Expected values are typed from the sources: CSS Easing Functions Level 1 §2.2 (keywords),
// Material Design 2 "Speed" (standard / decelerate / accelerate), Material 3 easing tokens
// (md.sys.motion.easing.standard), Apple CAMediaTimingFunctionName.default, Tailwind CSS
// `--ease-in-out`. Also: every preset button has a label in all 4 languages, and every
// cubic-bezier(...) on the tool pages that is called "Material standard" uses the M2 value
// or says M3. Complete page regressions also cover in-tool Ctrl/Cmd+L reset,
// animation cancellation, and truthful localized clipboard success/failure.
//
// Run: node scripts/test-cubic-bezier-generator.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import { createRequire } from 'node:module';
import { contractProblems } from './lib/tool-mdx-contract.mjs';
const { transform } = createRequire(import.meta.resolve('astro/package.json'))('@astrojs/compiler');

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/CubicBezierGeneratorTool.astro'), 'utf8');

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}

const buttons = [...source.matchAll(/<button class="cbg-preset" data-p="([^"]+)" type="button">\{L\.(\w+)\}<\/button>/g)]
  .map((m) => ({ p: m[1], key: m[2] }));
const byKey = Object.fromEntries(buttons.map((b) => [b.key, b.p]));
const labels = {};
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const m = source.match(new RegExp('\\n  ' + lang + ': \\{([\\s\\S]*?)\\n  \\}'));
  labels[lang] = m ? Object.fromEntries([...m[1].matchAll(/\n\s+(\w+): '((?:[^'\\]|\\.)*)'/g)].map((x) => [x[1], x[2]])) : {};
}

const EXPECTED = {
  presetLinear: '0,0,1,1',
  presetEase: '0.25,0.1,0.25,1',
  presetEaseIn: '0.42,0,1,1',
  presetEaseOut: '0,0,0.58,1',
  presetEaseInOut: '0.42,0,0.58,1',
  presetM2Std: '0.4,0,0.2,1',
  presetM2Decel: '0,0,0.2,1',
  presetM2Accel: '0.4,0,1,1',
  presetM3Std: '0.2,0,0,1',
  presetCaDefault: '0.25,0.1,0.25,1',
  presetTwInOut: '0.4,0,0.2,1',
  presetBack: '0.68,-0.55,0.265,1.55',
};
for (const [k, v] of Object.entries(EXPECTED)) eq('preset ' + k, byKey[k], v);
check('no unversioned Material preset keys', !buttons.some((b) => /^presetMat/.test(b.key)), buttons.map((b) => b.key).join(','));
check('no "iOS" preset', !buttons.some((b) => /Ios/.test(b.key)));

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  for (const b of buttons) check(lang + ' label for ' + b.key, typeof labels[lang][b.key] === 'string' && labels[lang][b.key].length > 0);
  check(lang + ' M2 labels say Material 2', ['presetM2Std', 'presetM2Decel', 'presetM2Accel'].every((k) => /Material 2|M2/.test(labels[lang][k] || '')));
  check(lang + ' M3 label says Material 3', /Material 3|M3/.test(labels[lang].presetM3Std || ''));
  check(lang + ' no label says iOS', !Object.values(labels[lang]).some((v) => /iOS/.test(v)));
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/cubic-bezier-generator', lang + '.mdx'), 'utf8');
  check(lang + ' page: (0.4, 0, 0.2, 1) is labelled Material 2 where Material is named',
    !/0\.4, 0, 0\.2, 1\)<\/code>\s*[（(]Material (standard|標準|标准|표준)/.test(mdx));
  check(lang + ' page: no "iOS natural ease" claim', !/iOS's natural ease|iOS のナチュラル|iOS 自然|iOS 자연/.test(mdx));
}

// Drive the complete page script and actual ToolLayout handlers; only browser boundaries are doubled.
function loadCubicPage({ lang = 'en', clipboardMode = 'success', execResult = false } = {}) {
  const elements = [], ids = new Map(), timers = new Map(), clipboard = [], rafs = new Map(), tracks = [], windowListeners = {};
  const document = { activeElement: null, listeners: {} };
  let sequence = 0;
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const attrs = [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
      const plain = part.trim().replace(/\[[^\]]+\]/g, ''), id = /#([\w-]+)/.exec(plain), tag = /^[\w-]+/.exec(plain);
      return (!id || el.id === id[1]) && (!tag || el.tagName === tag[0].toUpperCase()) &&
        [...plain.matchAll(/\.([\w-]+)/g)].every(c => el.classList.contains(c[1])) &&
        attrs.every(a => a[2] === undefined ? el.getAttribute(a[1]) !== null : el.getAttribute(a[1]) === a[2]);
    });
  }
  class Element {
    constructor(tag = 'div') { Object.assign(this, { tagName: tag.toUpperCase(), id: '', type: tag === 'input' ? 'text' : '', value: '', defaultValue: '', checked: false, disabled: false, scrollTop: 0, style: {}, dataset: {}, attrs: {}, children: [], listeners: {}, className: '', clientWidth: 300, clientHeight: 300, offsetWidth: 300, offsetHeight: 300, parentElement: { clientWidth: 600 } }); }
    set textContent(v) { this.text = String(v); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(c => c.textContent).join(''); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className += ' ' + c; }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c, value) { const on = value ?? !this.contains(c); on ? this.add(c) : this.remove(c); return on; } }; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (['id', 'type', 'min', 'max', 'step'].includes(k)) this[k] = String(v); if (k === 'class') this.className = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
    getAttribute(k) { return k === 'type' ? this.type : this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, init = {}) { for (const fn of this.listeners[type] || []) fn({ type, target: this, preventDefault() {}, ...init }); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { document.activeElement = this; }
    contains(el) { return elements.includes(el); }
    querySelectorAll(selector) { return elements.filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    appendChild(el) { this.children.push(el); return el; }
    append(...children) { this.children.push(...children); }
    removeChild(el) { this.children = this.children.filter(child => child !== el); }
    getBoundingClientRect() { return { top: this.id === 'cbg-canvas' ? 416 : 100, left: 24, width: 300, height: 300 }; }
    setPointerCapture(id) { this.pointerId = id; }
    hasPointerCapture(id) { return this.pointerId === id; }
    releasePointerCapture() { this.pointerId = null; }
    remove() {} select() {}
  }
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
  for (const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/g)) {
    const el = new Element(match[1]);
    for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) { el.setAttribute(attr[1], attr[2]); if (attr[1] === 'value') el.value = el.defaultValue = attr[2]; }
    el.checked = /\bchecked(?=\s|\/|$)/.test(match[2]); elements.push(el); if (el.id) ids.set(el.id, el);
  }
  const wrap = elements.find(el => matches(el, '.cbg-wrap'));
  const get = id => { if (!ids.has(id)) throw new Error('Missing actual markup id ' + id); return ids.get(id); };
  const startLabels = source.indexOf('const labels = '), endLabels = source.indexOf('const L = ', startLabels);
  const L = vm.runInNewContext(source.slice(startLabels, endLabels) + '\nlabels[' + JSON.stringify(lang) + ']');
  const rootTag = markup.match(/<div\s+class="cbg-wrap"[\s\S]*?>/)[0];
  for (const attr of rootTag.matchAll(/data-([\w-]+)=\{L\.(\w+)\}/g)) wrap.dataset[attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = L[attr[2]];
  const store = new Map(), localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
  Object.assign(document, { body: new Element('body'), getElementById: get, querySelector: selector => selector === '.tool-widget' ? wrap : wrap.querySelector(selector), createElement: tag => new Element(tag), addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, execCommand: () => execResult });
  const policy = readFileSync(new URL('../src/data/persistence.ts', import.meta.url), 'utf8').match(/export const toolPersistencePolicy = ([\s\S]*?) as const/)[1];
  const sandbox = { document, L, localStorage, toolPersistencePolicy: vm.runInNewContext('(' + policy + ')'), _slug: 'cubic-bezier-generator', console,
    navigator: { clipboard: clipboardMode === 'missing' ? undefined : { writeText: value => { clipboard.push(value); return clipboardMode === 'reject' ? Promise.reject(new Error('NotAllowedError fixture')) : Promise.resolve(); } } },
    setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame(fn) { const id = ++sequence; rafs.set(id, fn); return id; }, cancelAnimationFrame: id => rafs.delete(id),
    addEventListener(type, fn) { (windowListeners[type] ||= []).push(fn); }, trackTool: (...args) => tracks.push(args) };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox), layout = readFileSync(new URL('../src/layouts/ToolLayout.astro', import.meta.url), 'utf8');
  vm.runInContext(layout.match(/<script is:inline define:vars=\{\{ toolPersistencePolicy \}\}>([\s\S]*?)<\/script>/)[1], ctx);
  vm.runInContext(source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1], ctx);
  const start = layout.indexOf("document.addEventListener('keydown'", layout.indexOf('// ── Keyboard shortcuts:'));
  vm.runInContext(layout.slice(start, layout.indexOf('// ── Copy button visual feedback', start)), ctx);
  return { get, wrap, document, clipboard, rafs, store, tracks, L, ctx,
    frame(now) { const callbacks = [...rafs.values()]; rafs.clear(); callbacks.forEach(fn => fn(now)); },
    type(id, value) { const el = get(id); el.value = value; el.dispatch('input'); },
    key(init) { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init }; for (const fn of document.listeners.keydown) fn(event); for (const [id, timer] of [...timers]) if (timer.ms === 0) { timers.delete(id); timer.fn(); } return event; }
  };
}

for (const modifier of ['ctrlKey', 'metaKey']) {
  const page = loadCubicPage();
  page.type('cbg-p1x', '0.2'); page.get('cbg-play').click(); page.frame(100); page.frame(250);
  const old = page.get('cbg-output-text').textContent;
  check(modifier + ' custom curve starts animation', old.includes('cubic-bezier(0.2, 0, 0.58, 1)') && page.get('cbg-play').textContent === 'Pause' && page.rafs.size === 1 && page.get('cbg-ball').style.transform !== 'translateX(0px)');
  check(modifier + ' real persistence saves edited input', page.store.has('zt-input-cubic-bezier-generator'));
  page.document.activeElement = page.document.body;
  const outside = page.key({ [modifier]: true, key: 'l' });
  check(modifier + ' outside focus keeps curve and animation', !outside.defaultPrevented && page.get('cbg-output-text').textContent === old && page.rafs.size === 1 && page.store.has('zt-input-cubic-bezier-generator'));
  page.get('cbg-p1x').focus(); page.key({ key: 'l' });
  check(modifier + ' plain L keeps curve and animation', page.get('cbg-output-text').textContent === old && page.rafs.size === 1);
  const event = page.key({ [modifier]: true, key: modifier === 'ctrlKey' ? 'l' : 'L' });
  check(modifier + ' real global shortcut clears stored input', event.defaultPrevented && !page.store.has('zt-input-cubic-bezier-generator'));
  eq(modifier + ' clear restores default coordinates', ['p1x', 'p1y', 'p2x', 'p2y'].map(id => page.get('cbg-' + id).value), ['0.42', '0', '0.58', '1']);
  eq(modifier + ' clear restores default CSS', page.get('cbg-output-text').textContent, 'transition-timing-function: cubic-bezier(0.42, 0, 0.58, 1);');
  check(modifier + ' clear stops animation', page.get('cbg-play').textContent === 'Play' && page.rafs.size === 0);
  page.frame(500);
  eq(modifier + ' stopped ball stays at start', page.get('cbg-ball').style.transform, 'translateX(0px)');
  page.type('cbg-p2y', '0.5'); page.get('cbg-play').click(); page.frame(600); page.frame(750); page.get('cbg-reset').click();
  check(modifier + ' explicit Reset still restores and stops', page.get('cbg-p2y').value === '1' && page.get('cbg-play').textContent === 'Play' && page.rafs.size === 0 && page.get('cbg-ball').style.transform === 'translateX(0px)' && !page.store.has('zt-input-cubic-bezier-generator'));
}

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  check(lang + ' includes a copy failure message', typeof labels[lang].copyFailed === 'string' && labels[lang].copyFailed.length > 0);
  eq(lang + ' label keys match English', Object.keys(labels[lang]).sort(), Object.keys(labels.en).sort());
  for (const mode of ['success', 'reject', 'fallback-success', 'fallback-failure']) {
    const page = loadCubicPage({ lang, clipboardMode: mode.startsWith('fallback') ? 'missing' : mode, execResult: mode === 'fallback-success' });
    page.type('cbg-p1x', '0.2'); page.get('cbg-copy').click();
    await Promise.resolve(); await Promise.resolve();
    const succeeded = mode === 'success' || mode === 'fallback-success', copied = page.get('cbg-copy');
    check(lang + ' ' + mode + ' reports the actual copy outcome', copied.classList.contains('copied') === succeeded && copied.textContent === (succeeded ? page.L.copied : page.L.copy));
    check(lang + ' ' + mode + ' tracks only successful copies', page.tracks.some(args => args[1] === 'copy_css') === succeeded);
    if (!succeeded) check(lang + ' ' + mode + ' shows localized failure', page.get('cbg-status').className.includes('error') && typeof page.L.copyFailed === 'string' && page.get('cbg-status').textContent === page.L.copyFailed);
    if (mode === 'success' || mode === 'reject') eq(lang + ' ' + mode + ' copies the actual output text', page.clipboard, ['transition-timing-function: cubic-bezier(0.2, 0, 0.58, 1);']);
  }
}
const retry = loadCubicPage();
retry.get('cbg-copy').click(); await Promise.resolve();
retry.ctx.navigator.clipboard.writeText = () => Promise.reject(new Error('NotAllowedError fixture'));
retry.get('cbg-copy').click(); await Promise.resolve(); await Promise.resolve();
check('failed repeat copy removes previous success feedback', !retry.get('cbg-copy').classList.contains('copied') && retry.get('cbg-copy').textContent === retry.L.copy && retry.get('cbg-status').className.includes('error'));
retry.ctx.navigator.clipboard.writeText = () => Promise.resolve();
retry.get('cbg-copy').click(); await Promise.resolve();
check('successful retry clears stale failure feedback', retry.get('cbg-copy').classList.contains('copied') && !retry.get('cbg-status').className.includes('error'));

// ---------- v2 page layout ----------
const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
const styles = source.match(/<style is:global>([\s\S]*?)<\/style>/)[1];
const tipStrings = JSON.parse(source.match(/const STRINGS = ([\s\S]*?);\nconst L =/)[1]);
const tipIds = [...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m => m[1]);
check('v2 generate registry', /'cubic-bezier-generator':\s*'generate'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
check('v2 direct root with shared control rail', /^\s*<div\s+class="cbg-wrap"/.test(markup) && /class="cbg-rail zt-rail"/.test(markup));
check('v2 primary input and operations before preview', ['cbg-p1x', 'cbg-p2y', 'cbg-play', 'cbg-reset', 'cbg-copy'].every(id => markup.indexOf('id="' + id + '"') < markup.indexOf('id="cbg-canvas"')));
check('v2 retains all 12 presets and three output formats', buttons.length === 12 && [...markup.matchAll(/data-fmt="(css|scss|tailwind)"/g)].length === 3);
check('v2 tips outside runtime serialization', !/TIPS|STRINGS/.test(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1]) && !/data-[\w-]+=\{TIPS/.test(markup));
check('v2 unique tip anchors', tipIds.length === 7 && new Set(tipIds).size === tipIds.length);
check('v2 flexible 270–320 rail and zero root minimum', /grid-template-columns:\s*clamp\(270px, 26vw, 320px\) minmax\(0, 1fr\)/.test(styles) && /\.cbg-wrap\s*\{[^}]*min-height:\s*0/.test(styles));
check('v2 status reserves space even with none class', /#cbg-status\s*\{[^}]*display:\s*block;[^}]*height:\s*3.8em/.test(styles));
check('v2 keyboard-reachable fixed-height output scrolls', /<pre class="cbg-output-pre" tabindex="0" role="region"/.test(markup) && /\.cbg-output-pre\s*\{[^}]*height:\s*11rem;[^}]*overflow:\s*auto/s.test(styles));
check('v2 square SVG keeps original viewBox and has a keyboard-scrollable viewport', /viewBox="0 0 320 320"/.test(markup) && /class="cbg-canvas-wrap" tabindex="0" role="region"/.test(markup) && /\.cbg-canvas-wrap\s*\{[^}]*overflow:\s*auto/.test(styles));
check('v2 canvas leaves scrollable room for Y=2 and Y=-2', /padding-top:\s*calc\(var\(--cbg-canvas-size\) \+ 1rem\)/.test(styles) && /padding-bottom:\s*calc\(var\(--cbg-canvas-size\) \* 2 \+ 1rem\)/.test(styles));
check('v2 860 stacking and 640 touch targets', /max-width:\s*860px/.test(styles) && /max-width:\s*640px/.test(styles) && /\.cbg-num, \.cbg-duration, \.cbg-format, \.cbg-preset\s*\{\s*min-height:\s*44px/.test(styles));
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const tips = tipStrings[lang].tips;
  check(lang + ' v2 same six nonempty fact keys', Object.keys(tips).join('|') === 'presets|points|curve|playback|format|reset' && Object.values(tips).every(t => typeof t === 'string' && t.trim()));
  const mdx = readFileSync(join(root, 'src/content/tools/cubic-bezier-generator', lang + '.mdx'), 'utf8');
  const meta = yaml.load(mdx.match(/^---\n([\s\S]*?)\n---/)[1]);
  check(lang + ' v2 five bounded steps', meta.steps.length === 5 && meta.steps.every(s => typeof s === 'string' && s.length <= 280) && meta.steps.join('').length <= 1200);
  check(lang + ' MDX content contract', !contractProblems('cubic-bezier-generator', lang), contractProblems('cubic-bezier-generator', lang));
  check(lang + ' v2 preset references remain', /m2.material.io/.test(mdx) && /m3.material.io/.test(mdx) && /developer.apple.com/.test(mdx) && /tailwindcss.com/.test(mdx));
}
const positioned = loadCubicPage();
eq('v2 initial SVG centered by scrolling only its viewport', positioned.wrap.querySelector('.cbg-canvas-wrap').scrollTop, 316);
eq('v2 initial positioning does not scroll the page', positioned.document.body.scrollTop, 0);
for (const y of [-2, 2]) {
  const handle = positioned.get('cbg-h1');
  handle.dispatch('pointerdown', { pointerId: 1 });
  handle.dispatch('pointermove', { pointerId: 1, clientX: 24 + 300 * 0.25, clientY: 416 + 300 * (1 - y) });
  handle.dispatch('pointerup', { pointerId: 1 });
  eq('v2 original drag mapping keeps extreme ' + y, positioned.get('cbg-output-text').textContent, 'transition-timing-function: cubic-bezier(0.25, ' + y + ', 0.58, 1);');
  eq('v2 original SVG control point agrees at ' + y, positioned.get('cbg-h1').getAttribute('cy'), String(320 - 320 * y));
}
const compiled = await transform(source, { filename: 'CubicBezierGeneratorTool.astro' });
check('v2 Astro compiles and CSS global syntax resolves', !compiled.diagnostics.some(d => d.severity === 1) && compiled.css.length > 0 && compiled.css.every(css => !css.includes(':global(')));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
