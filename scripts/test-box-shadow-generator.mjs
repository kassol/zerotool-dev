// Box Shadow Generator — output format and the examples in the box-shadow guide
//
// Read:  src/components/tools/BoxShadowGeneratorTool.astro (runs the page script against a
//        stand-in DOM); src/content/tools/box-shadow-generator/{en,zh,ja,ko}.mdx;
//        src/content/blog/box-shadow-generator-guide/{en,ja}.mdx;
//        node_modules/tailwindcss/theme.css (the Tailwind tokens quoted in the en guide)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the tool page worked examples (`bsg-check` notes, at least 2 per language, recomputed
// by the page script and shown verbatim as code after the note; every declaration in the tool's
// output format on the four pages has a note) and the MDX contract with FAQ ids;
// the output on load; guide `bsg-check` annotations (slider values → the generated
// declaration, which must also appear in the guide text); an invalid hex code leaves the
// color unchanged; `bsg-radius` annotations against the spread-radius rule in CSS Backgrounds
// and Borders Level 3 §6.1.1 (radius + spread × (1 + (r − 1)^3) when r = radius / spread < 1);
// the Gaussian values quoted in the en guide (σ = blur / 2); the Tailwind tokens quoted in the
// en guide match tailwindcss's theme.css; both guides are indexable with no template headings.
//
// Run: node scripts/test-box-shadow-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { annotations, contractProblems, fencedBlocks, readToolMdx } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/BoxShadowGeneratorTool.astro'), 'utf8');

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

// ---------- page script with a stand-in DOM ----------
const scriptMatch = /<script is:inline>([\s\S]*?)<\/script>/.exec(source);
const els = {};
function el(id) {
  if (!els[id]) {
    const handlers = {};
    let html = '';
    els[id] = {
      id, value: '', textContent: '', checked: false, disabled: false, style: {}, dataset: {},
      get innerHTML() { return html; },
      set innerHTML(v) { html = v; this.textContent = v.replace(/<[^>]+>/g, ''); },
      classList: { remove() {} },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      fire(type) { (handlers[type] || []).forEach((fn) => fn.call(els[id], {})); },
    };
  }
  return els[id];
}
const defaults = { 'bsg-h': '5', 'bsg-v': '5', 'bsg-blur': '10', 'bsg-spread': '0', 'bsg-opacity': '30', 'bsg-color': '#000000', 'bsg-color-hex': '#000000' };
for (const [id, v] of Object.entries(defaults)) el(id).value = v;
const wrap = { dataset: { copy: 'Copy', copied: 'Copied!' } };
const document = { currentScript: null, querySelector: () => wrap, getElementById: el, addEventListener() {} };
new Function('document', 'window', 'navigator', 'setTimeout', 'clearTimeout', scriptMatch[1])(document, {}, {}, () => {}, () => {});

eq('output on load', el('bsg-code').textContent, 'box-shadow: 5px 5px 10px 0px rgba(0, 0, 0, 0.30);');
eq('preview uses the same shadow', el('bsg-preview-box').style.boxShadow, '5px 5px 10px 0px rgba(0, 0, 0, 0.30)');

function generate(c) {
  el('bsg-h').value = String(c.h);
  el('bsg-v').value = String(c.v);
  el('bsg-blur').value = String(c.blur);
  el('bsg-spread').value = String(c.spread);
  el('bsg-opacity').value = String(c.opacity);
  el('bsg-color').value = c.color;
  el('bsg-color-hex').value = c.color;
  el('bsg-inset').checked = c.inset;
  el('bsg-h').fire('input');
  return el('bsg-code').textContent;
}

// Invalid hex: the swatch keeps its color.
el('bsg-color').value = '#1a73e8';
el('bsg-color-hex').value = '#abc';
el('bsg-color-hex').fire('input');
check('3-digit hex is ignored', el('bsg-code').textContent.includes('rgba(26, 115, 232,'), el('bsg-code').textContent);

// ---------- tool page: worked examples ----------
// {/* bsg-check: {"h":…, "v":…, "blur":…, "spread":…, "opacity":…, "color":"#rrggbb", "inset":…,
// "hex"?: "text typed into the hex field", "out"?: "…"} */} sets the sliders, the color picker and
// the inset switch, then (with "hex") types into the hex field, as on the page. {"layers": [ … ]}
// holds several such settings, one per shadow layer. Every output must appear verbatim as a line of
// a code block, or as inline code, after the note and before the next bsg-check note or H2. Every
// declaration in the tool's output format on the page must be covered by such a note.
function toolOutput(c) {
  generate(c);
  if (c.hex !== undefined) {
    el('bsg-color-hex').value = c.hex;
    el('bsg-color-hex').fire('input');
  }
  return el('bsg-code').textContent;
}
function shownCode(text) {
  const out = [];
  for (const b of fencedBlocks(text)) out.push(...b.text.split('\n'));
  let rest = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, ' ');
  for (const m of rest.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)) out.push(m[1].trim());
  rest = rest.replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, ' ');
  for (const m of rest.matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  return out;
}
function exampleOutputs(spec) {
  const layers = spec.layers ?? [spec];
  return layers.map((c) => {
    for (const key of ['h', 'v', 'blur', 'spread', 'opacity']) if (!Number.isInteger(c[key])) throw new Error('missing ' + key);
    if (!/^#[0-9a-f]{6}$/.test(c.color) || typeof c.inset !== 'boolean') throw new Error('color must be lowercase #rrggbb and inset a boolean');
    const out = toolOutput(c);
    if (c.out !== undefined && c.out !== out) throw new Error('note says ' + JSON.stringify(c.out) + ', engine gives ' + JSON.stringify(out));
    return out;
  });
}
function verifyToolExample({ spec, after }) {
  if (!spec) return 'empty note';
  const shown = shownCode(after);
  for (const out of exampleOutputs(spec)) if (!shown.includes(out)) return 'engine result is not shown as code: ' + JSON.stringify(out);
  return null;
}
const toolAnnotations = [{ tag: 'bsg-check', min: 2, verify: verifyToolExample }];
const OUTPUT_FORMAT = /box-shadow: (?:inset )?-?\d+px -?\d+px \d+px -?\d+px rgba\(\d+, \d+, \d+, [01]\.\d\d\);/g;
{
  const docs = readToolMdx('box-shadow-generator', { root });
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const body = docs[lang].body;
    const notes = annotations(body, 'bsg-check');
    const covered = notes.map((n) => {
      const start = n.index + body.slice(n.index).indexOf('*/}') + 3;
      let outs = [];
      try { outs = exampleOutputs(n.spec); } catch { /* reported by the contract */ }
      return { start, end: start + n.after.length, outs };
    });
    const visible = body.replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => ' '.repeat(m.length));
    for (const m of visible.matchAll(OUTPUT_FORMAT)) {
      const ok = covered.some((c) => m.index >= c.start && m.index < c.end && c.outs.includes(m[0]));
      check(`${lang} tool page: generator output ${m[0]} has a bsg-check note`, ok);
    }
  }
}
// Restore the defaults for the guide checks below.
toolOutput({ h: 5, v: 5, blur: 10, spread: 0, opacity: 30, color: '#000000', inset: false });

// ---------- guides ----------
function erfc(x) {
  // Abramowitz and Stegun 7.1.26, |error| < 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x);
  return x >= 0 ? y : 2 - y;
}
const tail = (d, sigma) => 0.5 * erfc(d / (sigma * Math.SQRT2));
const spreadRadius = (r, s) => (r >= s ? r + s : r + s * (1 + (r / s - 1) ** 3));

for (const lang of ['en', 'ja']) {
  const guide = readFileSync(join(root, `src/content/blog/box-shadow-generator-guide/${lang}.mdx`), 'utf8');
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check(lang + ' guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
  check(lang + ' guide has no template headings', tpl.length === 0, tpl.map(String));
  const body = guide.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  const checks = [...guide.matchAll(/\{\/\* bsg-check: (\{.*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  check(lang + ' guide has bsg-check annotations', checks.length >= 3, checks.length);
  for (const c of checks) {
    eq(`${lang} generator ${JSON.stringify(c)}`, generate(c), c.out);
    check(`${lang} guide shows ${c.out}`, body.includes(c.out));
  }

  const radii = [...guide.matchAll(/\{\/\* bsg-radius: (\{.*?\}) \*\/\}/g)].map((m) => JSON.parse(m[1]));
  check(lang + ' guide has bsg-radius annotations', radii.length >= 2, radii.length);
  for (const c of radii) {
    eq(`${lang} spread radius r=${c.r} s=${c.s}`, spreadRadius(c.r, c.s), c.out);
    if (c.out) check(`${lang} guide shows ${c.out}px`, body.includes(c.out + 'px'));
  }
  // The diagonal reach measured in the guides follows from those radii on a 100px box
  // (corner at 0, shadow corner centre at −s + R, reach = s − R + R/√2 … floor of the distance).
  const reach = (s, R) => Math.floor(-(-s + R - R / Math.SQRT2));
  eq(lang + ' diagonal reach, radius 0', reach(40, 0), 40);
  eq(lang + ' diagonal reach, radius 10 (adjusted)', reach(40, spreadRadius(10, 40)), 30);
  eq(lang + ' diagonal reach, radius 10 without the adjustment', reach(40, 50), 25);
  // radius 60 clamps to 50 on a 100px box; the shadow is a circle of radius 90 around the centre
  eq(lang + ' diagonal reach, circle', Math.floor(-(50 - 90 / Math.SQRT2)), 13);

  // Gaussian with σ = 5px (blur 10px), the values quoted next to the measurements
  const predicted = [0, 2, 5, 8, 10].map((d) => tail(d, 5).toFixed(2).replace(/^0\.(\d)0$/, '0.$1'));
  const quoted = lang === 'en' ? 'predicts 0.5, 0.34, 0.16, 0.05, 0.02 and 0.001' : '0.5、0.34、0.16、0.05、0.02、0.001';
  check(lang + ' Gaussian prediction quoted', body.includes(quoted));
  eq(lang + ' Gaussian prediction values', predicted, ['0.5', '0.34', '0.16', '0.05', '0.02']);
  eq(lang + ' Gaussian at 15px', tail(15, 5).toFixed(3), '0.001');
}

// Tailwind tokens quoted in the en guide
{
  const guide = readFileSync(join(root, 'src/content/blog/box-shadow-generator-guide/en.mdx'), 'utf8');
  const theme = readFileSync(join(root, 'node_modules/tailwindcss/theme.css'), 'utf8');
  const version = JSON.parse(readFileSync(join(root, 'node_modules/tailwindcss/package.json'), 'utf8')).version;
  check('en guide names the installed Tailwind version', guide.includes('Tailwind CSS ' + version), version);
  const block = guide.match(/\{\/\* bsg-tailwind \*\/\}\s*```css\n([\s\S]*?)```/)[1];
  for (const line of block.trim().split('\n')) check('Tailwind token ' + line.split(':')[0], theme.includes(line.trim()), line);
}

// ---------- copy lifecycle and shared shortcuts ----------
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
check('actual shared shortcut found', shortcut.includes("document.addEventListener('keydown'"));
const allLabels = vm.runInNewContext(source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1] + '\n;STRINGS');
const algorithm = ['hexToRgb\\(hex\\)', 'generate\\(\\)'].map(name => source.match(new RegExp('      function ' + name + ' \\{[\\s\\S]*?\\n      \\}'))[0]).join('\n\n');
// 2026-10-08: re-hashed after the per-input trackTool call moved out of generate() (the only change).
eq('generation algorithm bytes unchanged', createHash('sha256').update(algorithm).digest('hex'), 'dbd6dcb50fb595bfe02e83eef66035797b75eebe710becb7c8fc806c8d6c8052');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
let currentPage;
const unhandled = error => { if (currentPage) currentPage.unhandled.push(String(error)); };
process.on('unhandledRejection', unhandled);
function page(lang = 'en', shellFirst = false) {
  const ids = {}, events = {}, requests = [], timers = [], tracks = [], clears = [];
  const labels = allLabels[lang];
  let clock = 0, timerId = 0;
  const doc = { currentScript: null, activeElement: null };
  function element(id, type = '') {
    const handlers = {}; let html = '', classes = new Set();
    const e = {
      id, type, value: '', checked: false, disabled: false, hidden: false, textContent: '', className: '', style: {}, dataset: {},
      get innerHTML() { return html; },
      set innerHTML(v) { html = v; this.textContent = v.replace(/<[^>]+>/g, ''); },
      classList: { add(c) { classes.add(c); }, remove(c) { classes.delete(c); }, contains(c) { return classes.has(c); } },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      fire(type) { for (const fn of handlers[type] || []) fn.call(e, {}); },
      focus() { doc.activeElement = e; },
    };
    return e;
  }
  // Preserve the actual INPUT type/value/checked defaults and require all used IDs to exist.
  const markup = source.replace(/^---\n[\s\S]*?\n---/, '').replace(/<script\b[\s\S]*?<\/script>/g, '').replace(/<style\b[\s\S]*?<\/style>/g, '');
  for (const m of markup.matchAll(/<(?:input|span|code|button|div|p)\b([^>]*)>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
    if (!attrs.id) continue;
    const e = ids[attrs.id] = element(attrs.id, attrs.type || '');
    e.value = attrs.value || ''; e.checked = /\bchecked\b/.test(m[1]); e.hidden = /\bhidden\b/.test(m[1]);
  }
  ids['bsg-copy'].textContent = labels.copy;
  const get = id => { if (!ids[id]) throw new Error('Missing actual markup ID ' + id); return ids[id]; };
  const wrap = { dataset: { copy: labels.copy, copied: labels.copied, copyFailed: labels.copyFailed, badColor: labels.badColor }, contains: e => Object.values(ids).includes(e), querySelectorAll: () => Object.values(ids).filter(e => e.type === 'text') };
  Object.assign(doc, {
    getElementById: get,
    querySelector: sel => sel === '.bsg-wrap' || sel === '.tool-widget' ? wrap : null,
    addEventListener(type, fn) { (events[type] ||= []).push(fn); },
  });
  const h = {
    labels, doc, get, requests, timers, tracks, clears, unhandled: [], syncErrors: [],
    input(id, value, type = 'input') { get(id).value = String(value); get(id).fire(type); },
    click() { try { get('bsg-copy').fire('click'); } catch (error) { this.syncErrors.push(String(error)); } },
    key({ key = 'l', ctrlKey = true, metaKey = false, focus = 'bsg-color-hex' } = {}) {
      doc.activeElement = typeof focus === 'string' ? get(focus) : focus;
      const e = { key, ctrlKey, metaKey, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      for (const fn of events.keydown || []) fn.call(doc, e);
      return e;
    },
    advance(ms) {
      const until = clock + ms;
      for (;;) {
        const next = timers.filter(t => !t.cancelled && !t.ran && t.due <= until).sort((a, b) => a.due - b.due || a.id - b.id)[0];
        if (!next) break;
        clock = next.due; next.ran = true; next.fn();
      }
      clock = until;
    },
    state() { return { hex: get('bsg-color-hex').value, swatch: get('bsg-color').value, code: get('bsg-code').textContent, preview: get('bsg-preview-box').style.boxShadow, label: get('bsg-copy').textContent, status: get('bsg-status').textContent, statusClass: get('bsg-status').className, previewHidden: get('bsg-preview-box').hidden, emptyHidden: get('bsg-empty').hidden, empty: get('bsg-preview-section').dataset.empty }; },
  };
  const context = {
    document: doc, _slug: 'box-shadow-generator',
    navigator: { clipboard: { writeText(text) { return new Promise((resolve, reject) => requests.push({ text, resolve, reject })); } } },
    setTimeout(fn, ms = 0) { const id = ++timerId; timers.push({ id, fn, ms, due: clock + ms }); return id; },
    clearTimeout(id) { const timer = timers.find(t => t.id === id); if (timer) timer.cancelled = true; },
    trackTool(slug, action) { tracks.push({ slug, action }); },
    ztPersist: { clear(slug) { clears.push(slug); } },
  };
  context.window = context; vm.createContext(context); h.context = context; currentPage = h;
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(scriptMatch[1], context);
  if (!shellFirst) vm.runInContext(shortcut, context);
  return h;
}
function configure(h) {
  for (const [id, value] of Object.entries({ 'bsg-h': 12, 'bsg-v': -9, 'bsg-blur': 42, 'bsg-spread': -6, 'bsg-opacity': 73, 'bsg-color-hex': '#123456' })) h.input(id, value);
  h.get('bsg-inset').checked = true; h.get('bsg-inset').fire('change');
}
const configuredCode = 'box-shadow: inset 12px -9px 42px -6px rgba(18, 52, 86, 0.73);';
// Hex field: maxlength 9 so an 8-digit code is not cut to 6 digits (Chrome cut `#00000080` to
// `#000000` and dropped the alpha without a message). `#rrggbbaa` sets the color and the opacity
// slider (alpha / 255, rounded to a whole percent). Text that cannot become a valid code shows a
// hint in the page language and keeps the previous color; an incomplete code shows the hint only
// on change (when the field is left).
// maxlength 16: room for an 8-digit code with surrounding spaces from a paste (trimmed before
// it is read); maxlength 9 cut ` #00000080` to ` #0000008`.
check('hex field allows 16 characters', /id="bsg-color-hex"[^>]*maxlength="16"/.test(source));
{
  const h = page('en');
  h.input('bsg-color-hex', ' #00000080 ');
  eq('8-digit code with spaces is read', [h.get('bsg-opacity').value, h.get('bsg-status').textContent], ['50', '']);
  h.input('bsg-opacity', 70);
  eq('moving opacity after an 8-digit code trims the field to 6 digits', [h.get('bsg-color-hex').value, h.get('bsg-code').textContent], ['#000000', 'box-shadow: 5px 5px 10px 0px rgba(0, 0, 0, 0.70);']);
  h.input('bsg-color-hex', '#1a73e8'); h.input('bsg-opacity', 40);
  eq('a 6-digit code is left as typed', h.get('bsg-color-hex').value, '#1a73e8');
}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const hint = allLabels[lang].badColor;
  check(lang + ' badColor hint exists', typeof hint === 'string' && /6/.test(hint) && /8/.test(hint), hint);
  let h = page(lang);
  h.input('bsg-color-hex', '#00000080');
  eq(lang + ' 8-digit hex sets color and opacity', [h.get('bsg-code').textContent, h.get('bsg-opacity').value, h.get('bsg-opacity-val').textContent, h.get('bsg-color').value, h.get('bsg-status').textContent], ['box-shadow: 5px 5px 10px 0px rgba(0, 0, 0, 0.50);', '50', '50%', '#000000', '']);
  h.input('bsg-color-hex', '#1A73E81F');
  eq(lang + ' 8-digit hex, uppercase, 0x1f → 12%', h.get('bsg-code').textContent, 'box-shadow: 5px 5px 10px 0px rgba(26, 115, 232, 0.12);');
  for (const bad of ['rgba(0,0,0,.5)', '＃１６７７ｆｆ', 'red', '#1a73e8x']) {
    h = page(lang); h.input('bsg-color-hex', '#1a73e8'); h.input('bsg-color-hex', bad);
    eq(lang + ' ' + bad + ' shows the hint and keeps the color', [h.get('bsg-status').textContent, h.get('bsg-status').className, h.get('bsg-code').textContent], [hint, 'tool-status error', 'box-shadow: 5px 5px 10px 0px rgba(26, 115, 232, 0.30);']);
    h.input('bsg-color-hex', '#000000');
    eq(lang + ' ' + bad + ' then a valid code clears the hint', [h.get('bsg-status').textContent, h.get('bsg-status').className], ['', 'tool-status']);
  }
  h = page(lang); h.input('bsg-color-hex', '#12');
  eq(lang + ' incomplete code while typing: no hint', h.get('bsg-status').textContent, '');
  h.input('bsg-color-hex', '#12', 'change');
  eq(lang + ' incomplete code on change: hint', h.get('bsg-status').textContent, hint);
  h = page(lang); h.input('bsg-color-hex', '', 'change');
  eq(lang + ' empty field: no hint', h.get('bsg-status').textContent, '');
}

// Analytics: one `generate` event per committed change (change event), as in
// color-palette-generator; none on load and none for each `input` event while dragging or typing.
{
  const h = page('en');
  const g = () => h.tracks.filter(t => t.action === 'generate').length;
  eq('GA: no generate event on load', g(), 0);
  for (const v of [1, 2, 3, 4, 5]) h.input('bsg-h', v);
  h.input('bsg-opacity', 55); h.input('bsg-color', '#ff0000'); h.input('bsg-color-hex', '#00ff00');
  eq('GA: no generate event per input event', g(), 0);
  h.input('bsg-h', 6, 'change');
  eq('GA: one generate event when a slider is released', g(), 1);
  for (const id of ['bsg-v', 'bsg-blur', 'bsg-spread', 'bsg-opacity']) h.input(id, 7, 'change');
  h.input('bsg-color', '#123456', 'change'); h.input('bsg-color-hex', '#654321', 'change');
  h.get('bsg-inset').checked = true; h.get('bsg-inset').fire('change');
  eq('GA: one generate event per committed slider / picker / hex / inset change', g(), 8);
  h.input('bsg-color-hex', '#12', 'change');
  eq('GA: no generate event for an incomplete hex code', g(), 8);
  h.input('bsg-color-hex', '#00000080', 'change');
  eq('GA: one generate event when an 8-digit hex code is committed', g(), 9);
}
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  check(lang + ' copy failure label exists', typeof allLabels[lang].copyFailed === 'string' && !!allLabels[lang].copyFailed);
  for (const shellFirst of [false, true]) {
    const prefix = lang + ' shared first=' + shellFirst;
    let h = page(lang, shellFirst); configure(h);
    eq(prefix + ' configured output', h.get('bsg-code').textContent, configuredCode);
    eq(prefix + ' populated preview state', [h.get('bsg-preview-box').hidden, h.get('bsg-empty').hidden, h.get('bsg-preview-section').dataset.empty], [false, true, 'false']);
    const generated = () => h.tracks.filter(t => t.action === 'generate').length;
    const count = generated();
    h.click(); eq(prefix + ' complete copy bytes', h.requests[0].text, configuredCode);
    h.requests[0].resolve(); await settle();
    eq(prefix + ' copied feedback', h.get('bsg-copy').textContent, h.labels.copied);
    eq(prefix + ' single successful tracking', h.tracks.filter(t => t.action === 'copy').length, 1);
    h.advance(1500); eq(prefix + ' original label restored', h.get('bsg-copy').textContent, h.labels.copy);
    eq(prefix + ' copy does not generate', generated(), count);
    for (const key of [{ key: 'l' }, { key: 'L', ctrlKey: false, metaKey: true }]) {
      for (const focus of ['bsg-color-hex', 'bsg-h', 'bsg-color', 'bsg-inset', 'bsg-copy']) {
        h = page(lang, shellFirst); configure(h); const prefs = ['bsg-h', 'bsg-v', 'bsg-blur', 'bsg-spread', 'bsg-opacity', 'bsg-color'].map(id => h.get(id).value);
        h.click(); const n = generated(); const e = h.key({ ...key, focus });
        eq(prefix + ' shortcut consumed from ' + focus, e.defaultPrevented, true);
        eq(prefix + ' feedback cleared synchronously', h.get('bsg-copy').textContent, h.labels.copy);
        h.requests[0].resolve(); await settle();
        eq(prefix + ' old copy after shortcut ignored before timer', h.get('bsg-copy').textContent, h.labels.copy);
        h.advance(0);
        eq(prefix + ' HEX remains cleared after shared handler', h.get('bsg-color-hex').value, '');
        eq(prefix + ' parameters preserved', ['bsg-h', 'bsg-v', 'bsg-blur', 'bsg-spread', 'bsg-opacity', 'bsg-color'].map(id => h.get(id).value), prefs);
        eq(prefix + ' inset preserved', h.get('bsg-inset').checked, true);
        eq(prefix + ' old output cleared', h.get('bsg-code').textContent, '');
        eq(prefix + ' old preview cleared', h.get('bsg-preview-box').style.boxShadow, '');
        eq(prefix + ' empty copy disabled', h.get('bsg-copy').disabled, true);
        eq(prefix + ' empty preview state', [h.get('bsg-preview-box').hidden, h.get('bsg-empty').hidden, h.get('bsg-preview-section').dataset.empty], [true, false, 'true']);
        eq(prefix + ' clear removes status', [h.get('bsg-status').textContent, h.get('bsg-status').className], ['', 'tool-status']);
        eq(prefix + ' shared persistence clear retained', h.clears, ['box-shadow-generator']);
        eq(prefix + ' shortcut does not generate', generated(), n);
        eq(prefix + ' invalidated copy is not tracked', h.tracks.filter(t => t.action === 'copy').length, 0);
        h.input('bsg-h', 19);
        eq(prefix + ' next actual input regenerates same saved parameters', h.get('bsg-code').textContent, configuredCode.replace('12px', '19px'));
        eq(prefix + ' next actual input restores preview', h.get('bsg-preview-box').style.boxShadow, configuredCode.replace('12px', '19px').slice(12, -1));
        eq(prefix + ' next actual input enables copy', h.get('bsg-copy').disabled, false);
        eq(prefix + ' new input restores populated preview state', [h.get('bsg-preview-box').hidden, h.get('bsg-empty').hidden, h.get('bsg-preview-section').dataset.empty], [false, true, 'false']);
      }
    }
    h = page(lang, shellFirst); configure(h);
    const before = h.state(); const n = generated();
    for (const input of [{ focus: {} }, { key: 'l', ctrlKey: false }, { key: 'Enter' }]) {
      h.key(input); h.advance(0); eq(prefix + ' out of scope shortcut preserves state', h.state(), before);
    }
    eq(prefix + ' out of scope generates nothing', generated(), n);
  }
  let h = page(lang); configure(h); const before = h.state();
  h.click(); h.requests[0].reject(new Error('controlled denial')); await settle();
  eq(lang + ' current failure visible', h.get('bsg-copy').textContent, h.labels.copyFailed);
  eq(lang + ' failure shown in status', [h.get('bsg-status').textContent, h.get('bsg-status').className], [h.labels.copyFailed, 'tool-status error']);
  eq(lang + ' rejected copy handled', [h.syncErrors.length, h.unhandled.length], [0, 0]);
  eq(lang + ' rejected copy not tracked', h.tracks.filter(t => t.action === 'copy').length, 0);
  h.click(); h.requests[1].resolve(); await settle();
  eq(lang + ' direct retry succeeds', h.get('bsg-copy').textContent, h.labels.copied);
  eq(lang + ' retry clears only current error status', [h.get('bsg-status').textContent, h.get('bsg-status').className], ['', 'tool-status']);
  eq(lang + ' retry preserves exact output', h.get('bsg-code').textContent, before.code);
  for (const missing of [true, false]) {
    h = page(lang); configure(h);
    h.context.navigator.clipboard = missing ? undefined : { writeText() { throw new Error('synchronous boundary failure'); } };
    h.click(); await settle();
    eq(lang + ' unavailable/throwing API handled', [h.syncErrors.length, h.unhandled.length, h.get('bsg-copy').textContent], [0, 0, h.labels.copyFailed]);
  }
  const updates = [h => h.input('bsg-h', 19), h => h.input('bsg-v', 13), h => h.input('bsg-blur', 17), h => h.input('bsg-spread', 7), h => h.input('bsg-opacity', 50), h => h.input('bsg-color-hex', '#abcdef'), h => h.input('bsg-color-hex', '#abc'), h => h.input('bsg-color', '#ff0000'), h => { h.get('bsg-inset').checked = false; h.get('bsg-inset').fire('change'); }, h => h.key()];
  for (const [index, update] of updates.entries()) for (const outcome of ['resolve', 'reject']) {
    h = page(lang); configure(h); h.click(); update(h); h.advance(0); const current = h.state();
    h.requests[0][outcome](outcome === 'reject' ? new Error('late denial') : undefined); await settle();
    eq(lang + ' late ' + outcome + ' after update ' + index, h.state(), current);
    eq(lang + ' late rejection handled ' + index, h.unhandled.length, 0);
    eq(lang + ' stale success not tracked ' + index, h.tracks.filter(t => t.action === 'copy').length, 0);
  }
  for (const outcome of ['resolve', 'reject']) {
    h = page(lang); configure(h); h.click(); h.click(); h.requests[1].resolve(); await settle(); const current = h.state();
    h.requests[0][outcome](outcome === 'reject' ? new Error('older copy denied') : undefined); await settle();
    eq(lang + ' older request cannot overwrite newer ' + outcome, h.state(), current);
    eq(lang + ' older request handled ' + outcome, h.unhandled.length, 0);
    eq(lang + ' only latest copy tracked ' + outcome, h.tracks.filter(t => t.action === 'copy').length, 1);
  }
  h = page(lang); configure(h); h.click(); h.requests[0].resolve(); await settle();
  const oldTimer = h.timers.find(t => t.ms === 1500);
  h.advance(1499); h.click(); h.requests[1].resolve(); await settle(); h.advance(1);
  eq(lang + ' old deadline does not clear new copied', h.get('bsg-copy').textContent, h.labels.copied);
  oldTimer.fn(); eq(lang + ' cancelled timer forced delivery harmless', h.get('bsg-copy').textContent, h.labels.copied);
  h.advance(1500); eq(lang + ' latest timer restores base label', h.get('bsg-copy').textContent, h.labels.copy);
  h = page(lang); configure(h); h.click(); h.requests[0].resolve(); await settle();
  const timer = h.timers.find(t => t.ms === 1500); h.get('bsg-copy').classList.add('copied'); h.input('bsg-h', 19);
  eq(lang + ' new result clears feedback class', h.get('bsg-copy').classList.contains('copied'), false);
  const fresh = h.state(); timer.fn(); eq(lang + ' old timer cannot alter new result feedback', h.state(), fresh);
  h.click(); h.requests[1].reject(new Error('current copy failure')); await settle(); timer.fn();
  eq(lang + ' old timer cannot clear current failure', h.get('bsg-copy').textContent, h.labels.copyFailed);
  h = page(lang); h.get('bsg-code').textContent = ''; h.click(); eq(lang + ' empty output is not copied', h.requests.length, 0);
}
currentPage = null;
process.removeListener('unhandledRejection', unhandled);

// ---------- v2 page layout (DESIGN.md "Tool Pages v2", kind: generate) ----------
{
  const layouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
  check('generate layout registration', layouts.includes("'box-shadow-generator': 'generate'"));
  const markup = source.slice(source.indexOf('\n---\n', 4) + 5, source.indexOf('<script'));
  const css = source.slice(source.indexOf('<style>'));
  check('the outermost component is the height-bearing tool root', /^\s*<div\s+class="bsg-wrap"/.test(markup));
  check('shared control rail and full-width preview share one body', markup.includes('class="bsg-body"') && markup.includes('class="bsg-rail zt-rail"') && markup.indexOf('class="bsg-rail zt-rail"') < markup.indexOf('id="bsg-preview-section"'));
  check('the control rail contains code export before the preview', markup.indexOf('id="bsg-code"') < markup.indexOf('id="bsg-preview-section"'));
  check('270–320px rail and remaining preview width', css.includes('grid-template-columns: clamp(270px, 24vw, 320px) minmax(0, 1fr)'));
  check('the desktop body fills available height', css.includes('flex: 1 1 0; min-height: 0;'));
  check('the component owns 860px and 640px breakpoints', css.includes('@media (max-width: 860px)') && css.includes('@media (max-width: 640px)'));
  check('stacked screens use a two-column control grid', /@media \(max-width: 860px\)[\s\S]*?\.bsg-controls \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(css));
  check('long code stays in a bounded internal scroller', /\.bsg-pre \{[^}]*max-height: 8rem;[^}]*overflow: auto;/.test(css));
  check('the code region accepts keyboard focus', /<pre class="bsg-pre" tabindex="0" role="region" aria-label=\{L.outputLabel\}/.test(markup));
  check('the reserved status row precedes code', markup.indexOf('id="bsg-status"') < markup.indexOf('id="bsg-code"') && css.includes('#bsg-status { height: 2.8em; flex: none; margin: 0; overflow: auto; }'));
  check('Copy has a stable 44px height', css.includes('#bsg-copy { min-width: 0; height: 44px;'));
  check('phone HEX and swatch keep 44px touch targets', css.includes('.bsg-hex-input { min-height: 44px; }') && css.includes('.bsg-swatch { width: 44px; height: 44px; }'));
  check('range controls keep 24px targets', /\.bsg-slider \{[^}]*height: 24px;/.test(css));
  check('the inset label is a 44px phone target', css.includes('.bsg-toggle { min-height: 44px; }'));
  check('empty preview hides on stacked screens', /@media \(max-width: 860px\)[\s\S]*?\.bsg-preview-section\[data-empty="true"\] \{ display: none; \}/.test(css));
  check('hidden preview elements cannot be shown by grid layout', css.includes('.bsg-preview-box[hidden], .bsg-empty[hidden] { display: none; }'));
  check('dark syntax colors use the actual global theme ancestor', css.includes(':global([data-theme="dark"]) .bsg-wrap') && css.includes(':global(:root:not([data-theme="light"])) .bsg-wrap'));
  check('dynamic syntax spans use global selectors', ['prop','colon','semi','kw','num','color'].every(key => css.includes(':global(.bsg-hl-' + key + ')')));
  const tipKeys = ['h', 'v', 'blur', 'spread', 'opacity', 'inset', 'color', 'copy'];
  eq('exactly eight actual control tips', [...markup.matchAll(/<Toggletip id="bsg-tip-(\w+)"/g)].map(m => m[1]), tipKeys);
  check('every tip has localized about and native language metadata', [...markup.matchAll(/<Toggletip[^>]+>/g)].every(m => /lang=\{lang\} about=\{L\.\w+\}/.test(m[0])));
  check('tooltip prose stays in HTML and out of the page script', !scriptMatch[1].includes('.tips') && !source.includes('define:vars') && !source.includes('data-strings') && ['copy', 'copied', 'copy-failed'].every(key => markup.includes('data-' + key + '={L.')));
  check('automatic generator has no redundant Generate button', !markup.includes('btn-primary') && (markup.match(/<button /g) || []).length === 1 && markup.includes('id="bsg-copy"'));
  const oldLabels = {
  "en": "608e579b7b2af5a021c33ffc3f56680abf60049660f8e8a24e99f1aa6a67a69a",
  "zh": "af75a67c12759fce886816742f84ab20a2c4b8b1d99e0c0ef6adc2373514e006",
  "ja": "cb29d9c1c2ee421fe3c114bdc32b60cdef9584cf3d9d4cb892c57958b43bb694",
  "ko": "cb012701042537a7c3d8e7d8bba9cfb7ce9199b2b6dbf875dd2911f6b4c9926c"
};
  const digest = text => createHash('sha256').update(text).digest('hex');
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const strings = allLabels[lang];
    eq(lang + ' STRINGS keys match English', Object.keys(strings).sort(), Object.keys(allLabels.en).sort());
    eq(lang + ' tip keys match English', Object.keys(strings.tips).sort(), Object.keys(allLabels.en.tips).sort());
    check(lang + ' empty preview copy exists', typeof strings.empty === 'string' && strings.empty.length > 0);
    check(lang + ' every tip is factual plain prose', Object.values(strings.tips).every(text => typeof text === 'string' && text.length > 0 && !/[<>]\s*|https?:|\n[-*]/.test(text)));
    const old = Object.fromEntries(Object.entries(strings).filter(([key]) => !['empty','tips','badColor'].includes(key)).sort(([a],[b]) => a.localeCompare(b)));
    eq(lang + ' old fourteen localized values stay exact', digest(JSON.stringify(old)), oldLabels[lang]);
    const mdx = readFileSync(join(root, 'src/content/tools/box-shadow-generator/' + lang + '.mdx'), 'utf8');
    const fm = mdx.match(/^---\n([\s\S]*?)\n---/);
    const front = fm[1]; const body = mdx.slice(fm[0].length);
    const stepSection = front.slice(front.indexOf('\nsteps:\n'), front.indexOf('\nfaqItems:'));
    const steps = [...stepSection.matchAll(/^  - (".*")$/gm)].map(m => JSON.parse(m[1]));
    eq(lang + ' eight usage steps', steps.length, 8);
    check(lang + ' step character limits', steps.every(step => [...step].length <= 280) && steps.reduce((n, step) => n + [...step].length, 0) <= 1200);
    check(lang + ' steps contain the actual Copy label', steps[7].includes(strings.copy));
    check(lang + ' steps name the clear shortcut', steps[7].includes('Ctrl/⌘+L'));
    check(lang + ' Usage section removed', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
    eq(lang + ' MDX content contract', contractProblems('box-shadow-generator', lang, { annotations: toolAnnotations }), '');
  }
}


// ---------- phone first-screen repair: scoped spacing only ----------
{
  const phone = source.slice(source.indexOf('  @media (max-width: 640px) {'));
  check('phone inset header and 44px toggle share one row', /\.bsg-field-inset \{[^}]*flex-direction: row;[^}]*align-items: center;/.test(phone) && /\.bsg-field-inset \.bsg-field-header \{[^}]*flex: 1;/.test(phone));
  check('phone color label and 44px inputs share one row', /\.bsg-field-color \{[^}]*flex-direction: row;[^}]*align-items: center;/.test(phone) && /\.bsg-field-color \.bsg-field-header \{[^}]*flex: none;/.test(phone) && /\.bsg-color-input-wrap \{[^}]*flex: 1;[^}]*min-width: 0;/.test(phone));
  check('phone range rows remove default input margins', phone.includes('.bsg-slider { margin: 0; }') && phone.includes('.bsg-field { gap: 0; }'));
  check('phone preview gaps use compact spacing', /\.bsg-body \{ gap: 0\.[0-4]rem; \}/.test(phone) && /\.bsg-preview-section \{ gap: 0\.[0-4]rem; \}/.test(phone));
  const canvasHeight = Number(/\.bsg-preview-canvas \{ height: (\d+)px; \}/.exec(phone)?.[1]);
  check('phone preview retains the full 80px box and padding in a compact canvas', canvasHeight >= 130 && canvasHeight <= 140, canvasHeight);
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
