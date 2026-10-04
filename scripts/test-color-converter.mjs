// Color Converter — HEX / RGB / HSL engine
//
// Read:  src/components/tools/ColorConverterTool.astro (runs the real conversion functions between
//        the `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source)
//        src/layouts/ToolLayout.astro (the exact shared shortcut handler)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// CSS Color 4 §7 (HSL): the hue is an angle and wraps around the circle; saturation and lightness
// clamp to 0–100%. Before the fix hsl(720, 100%, 50%) came out black and saturation above 100%
// produced RGB channels above 255 (an invalid hex string). Values in this file are the CSS named
// colors from CSS Color 4 §6.1 and the examples quoted on the English tool page.
//
// Run: node scripts/test-color-converter.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/ColorConverterTool.astro'), 'utf8');
const start = source.indexOf('/* ── engine:start ── */');
const end = source.indexOf('/* ── engine:end ── */');
if (start < 0 || end <= start) {
  console.error('FAIL: could not locate the engine block in ColorConverterTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(start, end) + '\nreturn { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, parseRgb, parseHsl };')();

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function hslToHex(str) {
  const h = E.parseHsl(str);
  if (!h) return null;
  const c = E.hslToRgb(h.h, h.s, h.l);
  return E.rgbToHex(c.r, c.g, c.b);
}
function hexToHsl(hex) {
  const c = E.hexToRgb(hex);
  const h = E.rgbToHsl(c.r, c.g, c.b);
  return `hsl(${h.h}, ${h.s}%, ${h.l}%)`;
}

// Named colors (CSS Color 4 §6.1) and their HSL forms.
const named = [
  ['#008000', 'hsl(120, 100%, 25%)'], ['#ff0000', 'hsl(0, 100%, 50%)'], ['#ffffff', 'hsl(0, 0%, 100%)'],
  ['#000000', 'hsl(0, 0%, 0%)'], ['#808080', 'hsl(0, 0%, 50%)'], ['#0000ff', 'hsl(240, 100%, 50%)'],
];
for (const [hex, hsl] of named) {
  check(`${hex} → ${hsl}`, hexToHsl(hex) === hsl, hexToHsl(hex));
  check(`${hsl} → ${hex}`, hslToHex(hsl) === hex, hslToHex(hsl));
}

// Page examples.
const c = E.hexToRgb('#1a73e8');
check('#1a73e8 → rgb(26, 115, 232)', c.r === 26 && c.g === 115 && c.b === 232, JSON.stringify(c));
check('#1a73e8 → hsl(214, 82%, 51%)', hexToHsl('#1a73e8') === 'hsl(214, 82%, 51%)', hexToHsl('#1a73e8'));
check('hsl(214, 82%, 51%) → #1c74e9 (rounding)', hslToHex('hsl(214, 82%, 51%)') === '#1c74e9', hslToHex('hsl(214, 82%, 51%)'));
check('#f53 expands to #ff5533', JSON.stringify(E.hexToRgb('#f53')) === '{"r":255,"g":85,"b":51}');
check('8-digit hex is rejected', E.hexToRgb('#1a73e880') === null);
check('rgba alpha is ignored', JSON.stringify(E.parseRgb('rgba(26, 115, 232, 0.5)')) === '{"r":26,"g":115,"b":232}');
check('space-separated rgb() is rejected', E.parseRgb('rgb(26 115 232)') === null);
check('channel above 255 is rejected', E.parseRgb('rgb(300, 0, 0)') === null);

// Hue wraps, saturation and lightness clamp (CSS Color 4 §7).
check('hsl(720, 100%, 50%) is red', hslToHex('hsl(720, 100%, 50%)') === '#ff0000', hslToHex('hsl(720, 100%, 50%)'));
check('hsl(360, 100%, 50%) is red', hslToHex('hsl(360, 100%, 50%)') === '#ff0000', hslToHex('hsl(360, 100%, 50%)'));
check('hsl(480, 100%, 25%) equals hsl(120, 100%, 25%)', hslToHex('hsl(480, 100%, 25%)') === '#008000', hslToHex('hsl(480, 100%, 25%)'));
check('saturation above 100% clamps', hslToHex('hsl(0, 150%, 50%)') === '#ff0000', hslToHex('hsl(0, 150%, 50%)'));
check('lightness above 100% clamps to white', hslToHex('hsl(0, 100%, 130%)') === '#ffffff', hslToHex('hsl(0, 100%, 130%)'));

// Every hex value round-trips through RGB, and every HSL output is a valid 6-digit hex.
let rt = 0, bad = 0;
for (let i = 0; i < 20000; i++) {
  const n = Math.floor(Math.random() * 0x1000000);
  const hex = '#' + n.toString(16).padStart(6, '0');
  const rgb = E.hexToRgb(hex);
  if (E.rgbToHex(rgb.r, rgb.g, rgb.b) !== hex) rt++;
  const h = E.rgbToHsl(rgb.r, rgb.g, rgb.b);
  const back = E.hslToRgb(h.h, h.s, h.l);
  if (!/^#[0-9a-f]{6}$/.test(E.rgbToHex(back.r, back.g, back.b))) bad++;
}
check('20,000 random hex values round-trip through RGB', rt === 0, rt);
check('HSL output always converts back to a valid hex', bad === 0, bad);
for (let h = -720; h <= 720; h += 37) for (const s of [-20, 0, 55, 100, 180]) for (const l of [-5, 0, 40, 100, 140]) {
  const x = E.hslToRgb(h, s, l);
  check(`hsl(${h}, ${s}%, ${l}%) channels in range`, [x.r, x.g, x.b].every((v) => v >= 0 && v <= 255), JSON.stringify(x));
}


// Complete page lifecycle. Only DOM/clipboard/timers are boundary doubles.
const lifecycleScript = source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1];
const lifecycleMarkup = source.replace(/^---[\s\S]*?---\s*/, '').split('<style>')[0].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const lifecycleLayout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const lifecycleShortcut = lifecycleLayout.slice(lifecycleLayout.indexOf('// ── Keyboard shortcuts:'), lifecycleLayout.indexOf('// ── Copy button visual feedback'));
if (!lifecycleShortcut.includes("document.addEventListener('keydown'")) throw Error('Actual shared shortcut missing');
const must = (ok, name) => { if (!ok) throw Error('Harness prerequisite: ' + name); };
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const captureUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', captureUnhandled);
function lifecyclePage(lang = 'en', shellFirst = false) {
  let doc;
  const clipboard = [], tracks = [], timers = new Map();
  let timerId = 0;
  const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  function descendants(el) { return el.children.flatMap(c => [c, ...descendants(c)]); }
  function oneMatches(el, selector) {
    if (el.tagName === '#TEXT') return false;
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!oneMatches(el, parts.pop())) return false;
      let parent = el.parentNode;
      while (parent) { if (oneMatches(parent, parts.join(' '))) return true; parent = parent.parentNode; }
      return false;
    }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0];
    const id = /#([\w-]+)/.exec(plain)?.[1];
    const classes = [...plain.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id) && classes.every(c => el.classList.contains(c)) && attrs.every(a => a[2] === undefined ? el.getAttribute(a[1]) !== null : el.getAttribute(a[1]) === a[2]);
  }
  const matches = (el, selector) => selector.split(',').some(s => oneMatches(el, s.trim()));
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, value: '', id: '', className: '', style: {}, text: '', htmlWrites: 0, appendWrites: 0 }); }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'value', 'type'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); }
    getAttribute(k) { return k === 'id' ? this.id || null : k === 'class' ? this.className || null : this.attributes[k] ?? null; }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); } }; }
    get parentElement() { return this.parentNode; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this.detachChildren(); this.text = String(v); }
    detachChildren() { for (const c of this.children) c.parentNode = null; this.children = []; this.text = ''; }
    set innerHTML(v) { this.htmlWrites++; this.detachChildren(); parse(String(v), this); }
    appendChild(child) { this.appendWrites++; this.children.push(child); child.parentNode = this; return child; }
    querySelectorAll(s) { return descendants(this).filter(el => matches(el, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] ?? null; }
    contains(el) { return el === this || descendants(this).includes(el); }
    closest(s) { let el = this; while (el) { if (matches(el, s)) return el; el = el.parentNode; } return null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatch(type, extra = {}) {
      const e = { type, target: this, defaultPrevented: false, bubbles: true, ...extra, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
      let target = this;
      while (target) { e.currentTarget = target; for (const listener of target.listeners[type] || []) listener.call(target, e); if (e.stopped || !e.bubbles) break; target = target.parentNode; }
      return e;
    }
    click() { if (!this.disabled) return this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  function parse(html, parent) {
    const stack = [parent];
    for (const token of html.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
      const s = token[0];
      if (s.startsWith('</')) { must(stack.length > 1, 'balanced markup'); stack.pop(); continue; }
      if (s.startsWith('<')) {
        const tag = /^<([\w-]+)/.exec(s)[1];
        const el = new Element(tag);
        for (const a of s.matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(a[1], decode(a[2]));
        stack.at(-1).appendChild(el);
        if (!/\/>$/.test(s) && !['input', 'hr', 'br', 'meta', 'link'].includes(tag)) stack.push(el);
      } else { const el = new Element('#text'); el.text = decode(s); stack.at(-1).appendChild(el); }
    }
    must(stack.length === 1, 'complete parsed markup');
  }
  doc = new Element('#document');
  doc.documentElement = new Element('html'); doc.documentElement.lang = lang; doc.appendChild(doc.documentElement);
  doc.body = new Element('body'); doc.documentElement.appendChild(doc.body);
  const widget = new Element('section'); widget.className = 'tool-widget'; doc.body.appendChild(widget); parse(lifecycleMarkup, widget);
  // Deliberately no ID map: duplicate IDs resolve to the first connected element in DOM order.
  doc.getElementById = id => descendants(doc).find(el => el.id === id) ?? null;
  doc.createElement = tag => new Element(tag);
  for (const select of doc.querySelectorAll('select')) select.value = select.querySelector('option').value;
  doc.activeElement = doc.body;
  const sandbox = {
    document: doc, console, _slug: 'color-converter', ztPersist: { clear() {} },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); clipboard.push({ value, resolve, reject }); return promise; } } },
    trackTool: (...args) => tracks.push(args),
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  if (shellFirst) vm.runInContext(lifecycleShortcut, context);
  vm.runInContext(lifecycleScript, context, { filename: 'ColorConverterTool.astro' });
  if (!shellFirst) vm.runInContext(lifecycleShortcut, context);
  const get = id => { const el = doc.getElementById(id); must(el, 'real DOM ID ' + id); return el; };
  return {
    get, doc, widget, clipboard, tracks, timers,
    input(id, value, event = 'input') { get(id).value = value; get(id).dispatch(event); },
    key(id, key = 'l', modifier = 'ctrlKey') { const el = id ? get(id) : doc.body; el.focus(); return el.dispatch('keydown', { key, ...(modifier ? { [modifier]: true } : {}) }); },
    flushTimers() { for (let i = 0; i < 5 && timers.size; i++) { const jobs = [...timers.values()]; timers.clear(); jobs.forEach(j => j.fn()); } },
  };
}

function colorSnapshot(p) {
  const value = id => p.get(id).value;
  return { fields: ['cc-hex', 'cc-rgb', 'cc-hsl'].map(value), swatch: p.get('cc-swatch').style.background || '', label: p.get('cc-swatch-label').textContent, picker: value('cc-picker'), status: p.get('cc-status').textContent, statusClass: p.get('cc-status').className, buttons: p.widget.querySelectorAll('.btn-copy').map(b => b.textContent) };
}
const colorEmpty = p => { const s = colorSnapshot(p); return s.fields.every(v => v === '') && !s.swatch && !s.label && s.picker === '#000000' && !s.status && s.statusClass === 'cc-status'; };
const colorCopy = (p, id = 'cc-hex') => { const b = p.widget.querySelector('[data-copy="' + id + '"]'); b.click(); return { button: b, job: p.clipboard.at(-1) }; };
const languageText = { en: ['Copy', 'Copied!', 'Copy failed. Please copy the value manually.'], zh: ['复制', '已复制！', '复制失败，请手动复制数值。'], ja: ['コピー', 'コピー済み！', 'コピーに失敗しました。値を手動でコピーしてください。'], ko: ['복사', '복사됨!', '복사하지 못했습니다. 값을 직접 복사하세요.'] };
try {
  for (const lang of Object.keys(languageText)) {
    const [copyLabel, copiedLabel, copyError] = languageText[lang];
    const p = lifecyclePage(lang);
    check(lang + ' page initializes the existing sample', colorSnapshot(p).fields.join('|') === '#1a73e8|rgb(26, 115, 232)|hsl(214, 82%, 51%)');
    p.input('cc-hex', '#ff0000'); const red = colorSnapshot(p);
    for (const [id, text] of [['cc-hex', '#12'], ['cc-rgb', 'rgb('], ['cc-hsl', 'hsl('], ['cc-hex', '']]) {
      p.input(id, text); const state = colorSnapshot(p);
      check(lang + ' partial/empty editing retains valid preview ' + id + '/' + text, state.swatch === red.swatch && state.label === red.label && !state.status);
    }
    p.input('cc-hex', '#ff0000');
    for (const [id, expected] of [['cc-hex', '#ff0000'], ['cc-rgb', 'rgb(255, 0, 0)'], ['cc-hsl', 'hsl(0, 100%, 50%)']]) {
      const { button, job } = colorCopy(p, id); job.resolve(); await settle();
      check(lang + ' actual copy and feedback ' + id, job.value === expected && button.textContent === copiedLabel);
      p.flushTimers(); check(lang + ' copy feedback resets ' + id, button.textContent === copyLabel);
    }
    const failed = colorCopy(p); failed.job.reject(Error('current copy')); await settle();
    check(lang + ' current copy rejection is visible and localized', p.get('cc-status').textContent === copyError && p.get('cc-status').className === 'cc-status error');
    check(lang + ' current copy failure preserves valid color', p.get('cc-hex').value === '#ff0000' && p.get('cc-swatch-label').textContent === '#ff0000');
    const retry = colorCopy(p); retry.job.resolve(); await settle();
    check(lang + ' successful retry clears its previous copy error', p.get('cc-status').textContent === '' && p.get('cc-status').className === 'cc-status');
    const validation = colorCopy(p); p.input('cc-hex', '#ggg'); const validationState = colorSnapshot(p); validation.job.resolve(); await settle();
    check(lang + ' late success preserves the newer validation error', JSON.stringify(colorSnapshot(p)) === JSON.stringify(validationState));
    p.input('cc-hex', '#ff0000'); const failedAgain = colorCopy(p); failedAgain.job.reject(Error('first failure')); await settle();
    const olderRetry = colorCopy(p), newerFailure = colorCopy(p, 'cc-rgb'); newerFailure.job.reject(Error('newer failure')); await settle(); olderRetry.job.resolve(); await settle();
    check(lang + ' successful older retry preserves a newer copy failure', p.get('cc-status').textContent === copyError && p.get('cc-status').className === 'cc-status error');
    const finalRetry = colorCopy(p, 'cc-rgb'); finalRetry.job.resolve(); await settle();
    check(lang + ' next successful retry clears the current copy failure', p.get('cc-status').textContent === '' && p.get('cc-status').className === 'cc-status');
    p.get('cc-clear').click(); check(lang + ' Clear fully resets color state', colorEmpty(p));
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = lifecyclePage(lang, shellFirst); q.input('cc-hex', '#ggg');
      const event = q.key('cc-rgb', 'L', modifier); q.flushTimers();
      check(lang + ' shortcut clears error with either listener order ' + shellFirst + '/' + modifier, event.defaultPrevented && colorEmpty(q));
      q.input('cc-hex', '#ff0000'); q.key('cc-hsl', 'l', modifier); q.flushTimers();
      check(lang + ' shortcut clears valid preview ' + shellFirst + '/' + modifier, colorEmpty(q));
      colorCopy(q); check(lang + ' cleared values cannot copy ' + shellFirst + '/' + modifier, q.clipboard.length === 0);
      q.input('cc-hex', '#0000ff'); check(lang + ' valid input recovers after shortcut ' + shellFirst + '/' + modifier, q.get('cc-rgb').value === 'rgb(0, 0, 255)');
    }
    const outside = lifecyclePage(lang), before = JSON.stringify(colorSnapshot(outside)); outside.key(null); outside.flushTimers();
    check(lang + ' shortcut outside tool leaves state intact', JSON.stringify(colorSnapshot(outside)) === before);
    for (const action of ['Clear', 'CtrlL', 'MetaL', 'valid', 'invalid', 'partial', 'empty', 'picker']) for (const outcome of ['resolve', 'reject', 'timer']) {
      const q = lifecyclePage(lang), { button, job } = colorCopy(q);
      if (outcome === 'timer') { job.resolve(); await settle(); }
      if (action === 'Clear') q.get('cc-clear').click();
      else if (action === 'CtrlL' || action === 'MetaL') q.key('cc-hex', 'l', action === 'MetaL' ? 'metaKey' : 'ctrlKey');
      else q.input(action === 'picker' ? 'cc-picker' : 'cc-hex', { valid: '#0000ff', invalid: '#ggg', partial: '#12', empty: '', picker: '#00ff00' }[action]);
      const state = JSON.stringify(colorSnapshot(q)), errors = unhandled.length;
      if (outcome === 'resolve') job.resolve(); if (outcome === 'reject') job.reject(Error('stale copy'));
      await settle(); q.flushTimers(); await settle();
      check(lang + ' late copy ' + outcome + ' leaves state untouched after ' + action, JSON.stringify(colorSnapshot(q)) === state && unhandled.length === errors);
      check(lang + ' old copy label reset after ' + action + '/' + outcome, button.textContent === copyLabel);
    }
    const q = lifecyclePage(lang), first = colorCopy(q), second = colorCopy(q); second.job.resolve(); await settle(); first.job.reject(Error('older request')); await settle();
    check(lang + ' superseded request cannot report failure', !q.get('cc-status').textContent && second.button.textContent === copiedLabel);
    q.flushTimers(); check(lang + ' latest copy feedback returns to base label', second.button.textContent === copyLabel);
  }
  await settle(); check('all page copy rejections are handled', unhandled.length === 0, unhandled.join('; '));
} finally { process.off('unhandledRejection', captureUnhandled); }

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
