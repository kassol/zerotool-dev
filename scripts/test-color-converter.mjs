// Color Converter — HEX / RGB / HSL engine
//
// Read:  src/components/tools/ColorConverterTool.astro (runs the real conversion functions between
//        the `engine:start` / `engine:end` markers, so this test cannot drift from the shipped source)
//        src/layouts/ToolLayout.astro (the exact shared shortcut handler)
//        src/data/tool-layouts.ts and the four tool MDX pages (v2 content protection)
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
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { load as loadYaml } from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contractProblems, toolMdxContract } from './lib/tool-mdx-contract.mjs';

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

// The initial preview must identify the same color as the picker and CSS swatch.
const initialPicker = /<input\b[^>]*id="cc-picker"[^>]*value="([^"]+)"/.exec(source)?.[1];
const initialLabel = /id="cc-swatch-label"[^>]*>([^<]+)<\/span>/.exec(source)?.[1];
const swatchRule = /\.cc-swatch\s*\{([^}]+)\}/.exec(source)?.[1] || '';
check('initial preview label matches picker and swatch', initialPicker === '#1a73e8' && initialLabel === initialPicker && /background:\s*#1a73e8\s*;/.test(swatchRule));

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
const lifecycleScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const lifecycleStrings = new Function('return ' + source.match(/const STRINGS = (\{[\s\S]*?\n\});/)[1])();
const clientFor = lang => vm.runInNewContext(source.slice(source.indexOf('const T = STRINGS[lang];'), source.indexOf('\n---', 4)) + '\nCLIENT_T;', { STRINGS: lifecycleStrings, lang });
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
  const widget = new Element('section'); widget.className = 'tool-widget'; doc.body.appendChild(widget); const text = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const markup = lifecycleMarkup.replace(/<Toggletip\b[^>]*>[\s\S]*?<\/Toggletip>/g, '').replace(/=\{T\.(\w+)\}/g, (_, key) => '="' + text(lifecycleStrings[lang][key]) + '"').replace(/\{T\.(\w+)\}/g, (_, key) => text(lifecycleStrings[lang][key]));
  parse(markup, widget);
  // Deliberately no ID map: duplicate IDs resolve to the first connected element in DOM order.
  doc.getElementById = id => descendants(doc).find(el => el.id === id) ?? null;
  doc.createElement = tag => new Element(tag);
  for (const select of doc.querySelectorAll('select')) select.value = select.querySelector('option').value;
  doc.activeElement = doc.body;
  const sandbox = {
    document: doc, console, t: clientFor(lang), _slug: 'color-converter', ztPersist: { clear() {} },
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
  // Invalid input: the status uses the page language and the other two fields are emptied, so Copy
  // cannot copy an error text as a color value (before the fix every page showed the English
  // "Invalid color format" and wrote it into both other fields).
  const invalidText = { en: 'Invalid color format', zh: '颜色格式无效', ja: '色の形式が正しくありません', ko: '색상 형식이 올바르지 않습니다' };
  for (const lang of Object.keys(invalidText)) {
    for (const [id, bad] of [['cc-hex', '#ggg'], ['cc-hex', '#1a73e880'], ['cc-rgb', 'rgb(300, 0, 0)'], ['cc-rgb', 'rgb(26、115、232)'], ['cc-hsl', 'hsl(-30, 50%, 50%)']]) {
      const p = lifecyclePage(lang); p.input(id, bad); const s = colorSnapshot(p);
      const others = ['cc-hex', 'cc-rgb', 'cc-hsl'].filter(x => x !== id);
      check(lang + ' invalid ' + id + ' ' + bad + ': localized status', s.status === invalidText[lang] && s.statusClass === 'cc-status error', s.status);
      check(lang + ' invalid ' + id + ' ' + bad + ': input kept, other fields empty', p.get(id).value === bad && others.every(x => p.get(x).value === ''), s.fields.join('|'));
      check(lang + ' invalid ' + id + ' ' + bad + ': swatch and label cleared', !s.swatch && !s.label);
      for (const x of others) colorCopy(p, x);
      check(lang + ' invalid ' + id + ' ' + bad + ': emptied fields copy nothing', p.clipboard.length === 0, p.clipboard.map(c => c.value).join('|'));
      p.input('cc-hex', '#1677ff');
      check(lang + ' valid input after ' + bad + ' recovers', colorSnapshot(p).fields.join('|') === '#1677ff|rgb(22, 119, 255)|hsl(215, 100%, 54%)' && !p.get('cc-status').textContent);
    }
  }
  // Full-width input is read through NFKC (as color-palette-generator and css-gradient-generator
  // do), so ＃１Ａ７３Ｅ８ and ｒｇｂ（２６，１１５，２３２） convert. On change (leaving the field) the field's
  // own text is replaced by its NFKC form when that form is ASCII, so Copy gives a usable value.
  // Before the fix all of these were rejected as an invalid format.
  for (const lang of Object.keys(invalidText)) {
    for (const [id, wide, fields, ascii] of [
      ['cc-hex', '＃１Ａ７３Ｅ８', '|rgb(26, 115, 232)|hsl(214, 82%, 51%)', '#1A73E8'],
      ['cc-hex', '１ａ７３ｅ８', '|rgb(26, 115, 232)|hsl(214, 82%, 51%)', '1a73e8'],
      ['cc-rgb', 'ｒｇｂ（２６，１１５，２３２）', '#1a73e8||hsl(214, 82%, 51%)', 'rgb(26,115,232)'],
      ['cc-rgb', 'rgb(26，115，232)', '#1a73e8||hsl(214, 82%, 51%)', 'rgb(26,115,232)'],
      ['cc-hsl', 'ｈｓｌ（２１４，８２％，５１％）', '#1c74e9|rgb(28, 116, 233)|', 'hsl(214,82%,51%)'],
    ]) {
      const p = lifecyclePage(lang); p.input(id, wide); const s = colorSnapshot(p);
      const shown = s.fields.map((v, i) => ['cc-hex', 'cc-rgb', 'cc-hsl'][i] === id ? '' : v).join('|');
      check(lang + ' full-width ' + wide + ' converts', shown === fields && !s.status, shown + ' ' + s.status);
      p.get(id).dispatch('change');
      check(lang + ' full-width ' + wide + ' is rewritten as ASCII on change', p.get(id).value === ascii, p.get(id).value);
    }
    const q = lifecyclePage(lang); q.input('cc-hex', '#1ㅁ73ㄷ8'); q.get('cc-hex').dispatch('change');
    check(lang + ' a value whose NFKC form is not ASCII is left as typed', q.get('cc-hex').value === '#1ㅁ73ㄷ8' && q.get('cc-status').textContent === invalidText[lang]);
  }

  // The local FAQ and examples describe the input text and the tool's result only; there is no
  // official source for how an input method types commas or letters, so no page asserts it.
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const page = readFileSync(join(root, 'src/content/tools/color-converter', lang + '.mdx'), 'utf8');
    const claim = page.match(/输入法|IME|두벌식|한\/영|자판|input method/);
    check(lang + ' page makes no input-method behavior claim', !claim, claim?.[0]);
  }

  // Text after a complete rgb() / hsl() value is rejected with a localized reason. The engine's
  // parseRgb / parseHsl match only the start of the text, so before the fix rgb(26, 115, 232)abc
  // converted as if the extra text were not there. Values still being typed are not rejected.
  const extraText = { en: 'Invalid color format: remove the extra text after the color values.', zh: '颜色格式无效：请删去颜色值后面多余的文字。', ja: '色の形式が正しくありません。色の値の後ろにある余分な文字を消してください。', ko: '색상 형식이 올바르지 않습니다. 색상 값 뒤의 불필요한 문자를 지우세요.' };
  for (const lang of Object.keys(extraText)) {
    for (const [id, bad] of [['cc-rgb', 'rgb(26, 115, 232)abc'], ['cc-rgb', 'rgba(26, 115, 232, 0.5) x'], ['cc-rgb', 'rgb(26, 115, 232))'], ['cc-hsl', 'hsl(214, 82%, 51%)xyz'], ['cc-hsl', 'hsl(214, 82%, 51%); color: red']]) {
      const p = lifecyclePage(lang); p.input(id, bad); const s = colorSnapshot(p);
      check(lang + ' trailing text rejected ' + bad, s.status === extraText[lang] && s.statusClass === 'cc-status error' && ['cc-hex', 'cc-rgb', 'cc-hsl'].filter(x => x !== id).every(x => p.get(x).value === '') && !s.label, s.status + ' | ' + s.fields.join('|'));
    }
    for (const [id, ok, hex] of [['cc-rgb', 'rgb(26, 115, 232)', '#1a73e8'], ['cc-rgb', 'rgba(26,115,232,.5)', '#1a73e8'], ['cc-rgb', 'rgba(26, 115, 232, 50%)', '#1a73e8'], ['cc-rgb', 'rgb(26, 115, 232', '#1a73e8'], ['cc-rgb', 'rgba(26, 115, 232, ', '#1a73e8'], ['cc-hsl', 'hsl(214, 82%, 51%)', '#1c74e9'], ['cc-hsl', 'hsla(214, 82%, 51%, 0.5)', '#1c74e9'], ['cc-hsl', 'hsl(214, 82, 51', '#1c74e9']]) {
      const p = lifecyclePage(lang); p.input(id, ok);
      check(lang + ' complete or partial value still converts ' + ok, p.get('cc-hex').value === hex && !p.get('cc-status').textContent, p.get('cc-hex').value + ' ' + p.get('cc-status').textContent);
    }
  }
  {
    const engine = source.slice(start, end), script = lifecycleScript.slice(lifecycleScript.indexOf('/* ── engine:end ── */'));
    for (const head of ['/^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/', '/^hsla?\\(\\s*(\\d+(?:\\.\\d+)?)\\s*,\\s*(\\d+(?:\\.\\d+)?)%?\\s*,\\s*(\\d+(?:\\.\\d+)?)%?/']) {
      check('trailing-text check uses the engine pattern ' + head, engine.includes(head) && script.includes(head));
    }
  }

  // Worked examples on the four tool pages: {/* cc-check: {"field":"hex|rgb|hsl","in":"…","show"?:[…],"error"?:true,"reason"?:"extra"} */}
  // types "in" into the field on the complete page script (page language of the MDX file). Each
  // field in "show" (default: the two other fields) must appear as inline code after the annotation
  // (up to the next annotation or H2). With "error": true the field must be rejected and the page's
  // localized status text must appear after the annotation. At least 2 examples per language.
  const ccCodes = text => [...text.matchAll(/`([^`\n]+)`/g)].map(m => m[1]).concat([...text.matchAll(/<code>([^<]*)<\/code>/g)].map(m => m[1]));
  const ccContract = toolMdxContract('color-converter', { annotations: [{ tag: 'cc-check', min: 2, verify: ({ spec, after, lang }) => {
    if (!spec || !['hex', 'rgb', 'hsl'].includes(spec.field) || typeof spec.in !== 'string') return 'spec needs field and in';
    const p = lifecyclePage(lang); p.input('cc-' + spec.field, spec.in);
    const status = p.get('cc-status').textContent;
    if (spec.error) {
      const want = spec.reason === 'extra' ? extraText[lang] : invalidText[lang];
      if (status !== want) return 'expected ' + JSON.stringify(want) + ', got ' + JSON.stringify(status);
      return after.includes(status) ? null : 'status text ' + JSON.stringify(status) + ' is not quoted after the annotation';
    }
    if (status) return 'page reports ' + JSON.stringify(status);
    const codes = ccCodes(after);
    if (!codes.includes(spec.in)) return 'input ' + JSON.stringify(spec.in) + ' is not shown as code after the annotation';
    for (const f of spec.show ?? ['hex', 'rgb', 'hsl'].filter(x => x !== spec.field)) {
      const v = p.get('cc-' + f).value;
      if (!codes.includes(v)) return f + ' value ' + JSON.stringify(v) + ' is not shown as code after the annotation';
    }
    return null;
  } }] });
  for (const r of ccContract.results.filter(r => /cc-check/.test(r.rule))) check('tool page: ' + r.message, r.ok);
  await settle(); check('all page copy rejections are handled', unhandled.length === 0, unhandled.join('; '));
} finally { process.off('unhandledRejection', captureUnhandled); }


// ---------- v2 page layout ----------
{
  const beforePasses = passes, beforeFailures = failures;
  const template = source.slice(source.indexOf('\n---\n') + 5, source.indexOf('<script')).trim();
  const css = source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>'));
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  const sha = value => createHash('sha256').update(value).digest('hex');
  const keys = ['clear', 'hex', 'hsl', 'picker', 'rgb'];
  check('color-converter is registered as compact', /'color-converter':\s*'compact'/.test(layouts));
  check('tool root is a natural-height shrinkable column', template.startsWith('<div class="cc-wrap">') && /\.cc-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0/.test(css) && !/\b(?:height|min-height):[^;]*(?:vh|svh)/.test(css));
  check('Picker/Clear precede status, fields and color preview', template.indexOf('id="cc-clear"') < template.indexOf('id="cc-status"') && template.indexOf('id="cc-status"') < template.indexOf('id="cc-hex"') && template.indexOf('id="cc-hsl"') < template.indexOf('id="cc-swatch"'));
  check('status reserves a fixed scrolling area at both sizes', /\.cc-wrap \.cc-status\s*\{[^}]*height: 3em;[^}]*overflow: auto/.test(css) && /\.cc-wrap \.cc-status\s*\{ height: 4.5em/.test(css));
  check('field widths cannot grow from long original values', /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/.test(css) && /\.cc-input-row input\s*\{[^}]*width: 0; min-width: 0/.test(css));
  check('preview label has fixed-height horizontal scrolling', /\.cc-swatch-label\s*\{[^}]*height: 2.5rem;[^}]*overflow-x: auto;[^}]*overflow-y: hidden;[^}]*white-space: nowrap/.test(css));
  check('phone stacks fields with usable controls', /@media \(max-width: 860px\)/.test(css) && /@media \(max-width: 640px\)/.test(css) && /\.cc-picker-label\s*\{ min-height: 44px/.test(css));
  check('original Clear, Picker and three Copy controls remain', ['cc-clear', 'cc-picker'].every(id => template.includes('id="' + id + '"')) && (template.match(/data-copy="cc-/g) || []).length === 3 && !template.includes('btn-primary'));
  check('native picker keyboard focus is visible on its label', /#cc-picker:focus-visible \+ \.cc-picker-label/.test(css));
  check('hidden states retain display precedence', /\.cc-wrap \[hidden\]\s*\{ display: none !important/.test(css));
  const tips = [...template.matchAll(/<Toggletip\b([^>]*)>([\s\S]*?)<\/Toggletip>/g)];
  check('five tips have stable unique IDs', JSON.stringify(tips.map(m => /id="cc-tip-([^"]+)"/.exec(m[1])?.[1]).sort()) === JSON.stringify(keys));
  check('tips are outside labels and summaries', !/<(?:label|summary)\b[^>]*>(?:(?!<\/(?:label|summary)>)[\s\S])*?<Toggletip/.test(template));
  for (const tip of tips) check('tip uses build-time language and matching content', /lang=\{lang\}/.test(tip[1]) && /about=\{T\.\w+\}/.test(tip[1]) && tip[2] === '{TIPS.' + /id="cc-tip-([^"]+)"/.exec(tip[1])[1] + '}');
  check('runtime i18n removed and only client strings serialized', /define:vars=\{\{ t: CLIENT_T \}\}/.test(source) && !/data-i18n|STRINGS|TIPS/.test(lifecycleScript));
  const engine = source.match(/^      \/\* ── engine:start ── \*\/[\s\S]*?^      \/\* ── engine:end ── \*\//m)[0];
  check('exact engine bytes protected', sha(engine) === 'f4515734c3724feb0413859e2e3c7cebc5af08ed0c896e176da458743146ebcd');
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const entry = lifecycleStrings[lang], client = clientFor(lang);
    check(lang + ' all four languages share string keys', JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(Object.keys(lifecycleStrings.en).sort()));
    check(lang + ' tip keys match all actual controls', JSON.stringify(Object.keys(entry.tips).sort()) === JSON.stringify(keys));
    for (const key of keys) check(lang + '/' + key + ' tip is plain nonempty text', typeof entry.tips[key] === 'string' && !!entry.tips[key].trim() && !/<[^>]*>|\n/.test(entry.tips[key]));
    check(lang + ' client excludes tips and their text', !('tips' in client) && Object.values(entry.tips).every(tip => !JSON.stringify(client).includes(JSON.stringify(tip))));
    const mdx = readFileSync(join(root, 'src/content/tools/color-converter', lang + '.mdx'), 'utf8');
    const [, meta, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(mdx), { steps } = loadYaml(meta);
    check(lang + ' four plain steps remain within llms limits', steps.length === 4 && steps.every(step => typeof step === 'string' && step.length <= 280 && !/<[^>]*>/.test(step)) && steps.join('').length <= 1200);
    for (const key of ['copy', 'clear', 'pickColor']) check(lang + ' steps use the actual ' + key + ' label', steps.some(step => step.includes(entry[key])));
    check(lang + ' Usage removed, Limits retained', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body) && /^## (?:Limits|限制|制限事項|제한 사항)/m.test(body));
    check(lang + ' MDX content contract', !contractProblems('color-converter', lang), contractProblems('color-converter', lang));
  }
  const require = createRequire(import.meta.url);
  const { transform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const { transform: parseJs } = await import('esbuild');
  const compiled = await transform(source, { filename: 'ColorConverterTool.astro' });
  check('Astro reports no compilation error', compiled.diagnostics.filter(d => d.severity === 1).length === 0);
  await parseJs(compiled.code, { loader: 'ts', format: 'esm' });
  check('generated JavaScript parses and serializes CLIENT_T', compiled.code.includes('$$defineScriptVars({ t: CLIENT_T })'));
  console.log('v2 page layout: ' + (passes - beforePasses) + ' passed, ' + (failures - beforeFailures) + ' failed');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
