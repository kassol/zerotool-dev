// YAML Validator — multi-document YAML (--- separated) is valid, with a result per document
//
// Read:  src/components/tools/YamlValidatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
//        node_modules/js-yaml (the library the tool bundles)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: several documents separated by `---` are valid (js-yaml load() threw "expected a
// single document" before; the tool now uses loadAll()), one result per document with its line
// range, an error in one document reported with its document number and absolute line while the
// other documents still get a result, `...` end markers, directives, leading comments, empty
// documents, `---` inside a quoted or block scalar, single documents unchanged.
//
// Run: node scripts/test-yaml-validator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
// Timing limits catch order-of-magnitude regressions; CI runners are several times slower than a dev machine.
const PERF_SLACK = process.env.CI ? 4 : 1;

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/YamlValidatorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in YamlValidatorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { validateYaml };')();

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
const v = (text) => E.validateYaml(text, yaml);
const values = (r) => r.documents.map((d) => d.value);

// ---------- the reported defect: multi-document YAML rejected ----------
{
  const r = v('name: a\n---\nname: b\n');
  check('two documents are valid', r.ok, r.documents[0].error && r.documents[0].error.message);
  eq('one value per document', values(r), [{ name: 'a' }, { name: 'b' }]);
  eq('line ranges', r.documents.map((d) => [d.index, d.startLine, d.endLine]), [[1, 1, 1], [2, 2, 4]]);
}
{
  const text = 'apiVersion: v1\nkind: Service\n---\napiVersion: apps/v1\nkind: Deployment\n---\nkind: ConfigMap\n';
  const r = v(text);
  check('Kubernetes-style three documents', r.ok);
  eq('three kinds', values(r).map((d) => d.kind), ['Service', 'Deployment', 'ConfigMap']);
  eq('values equal loadAll', values(r), yaml.loadAll(text));
}
{
  const r = v('---\na: 1\n---\nb: 2\n');
  eq('leading --- does not add an empty document', values(r), [{ a: 1 }, { b: 2 }]);
}
{
  const r = v('# header comment\n---\na: 1\n---\nb: 2');
  eq('comments before the first --- are not a document', values(r), [{ a: 1 }, { b: 2 }]);
  eq('ranges skip the comment', r.documents.map((d) => d.startLine), [2, 4]);
}
eq('empty document between markers', values(v('a: 1\n---\n---\nb: 2')), [{ a: 1 }, null, { b: 2 }]);
eq('... end marker', values(v('a: 1\n...\n---\nb: 2')), [{ a: 1 }, { b: 2 }]);
eq('... then a bare document', values(v('a: 1\n...\nb: 2')), [{ a: 1 }, { b: 2 }]);
eq('directive before ---', values(v('a: 1\n...\n%YAML 1.2\n---\nb: 2')), [{ a: 1 }, { b: 2 }]);
eq('--- with content on the same line', values(v('--- a\n--- b')), ['a', 'b']);
eq('--- inside a quoted value is not a marker', values(v('a: "x --- y"\n---\nb: 1')), [{ a: 'x --- y' }, { b: 1 }]);
eq('indented --- in a block scalar is not a marker', values(v('a: |\n  line\n  ---\n  end\n')), [{ a: 'line\n---\nend\n' }]);
eq('---x is not a marker', values(v('a: 1\n---x: 2')), [{ a: 1, '---x': 2 }]);
eq('CRLF', values(v('a: 1\r\n---\r\nb: 2\r\n')), [{ a: 1 }, { b: 2 }]);

// ---------- errors: per document, absolute lines ----------
{
  const r = v('a: 1\n---\nb: [1, 2\n---\nc: 3\n');
  check('error makes the stream invalid', !r.ok);
  eq('every document has a result', r.documents.map((d) => d.ok), [true, false, true]);
  eq('valid documents keep their values', [r.documents[0].value, r.documents[2].value], [{ a: 1 }, { c: 3 }]);
  const bad = r.documents[1];
  eq('failing document number and range', [bad.index, bad.startLine, bad.endLine], [2, 2, 3]);
  check('error line is in the full text', bad.error.mark.line + 1 >= 3, 'line ' + (bad.error.mark.line + 1));
  check('snippet uses full-text line numbers', /\b3 \|/.test(bad.error.message), bad.error.message);
}
{
  const r = v('a: 1\n---\nb:\n  - x\n - y\n');
  eq('bad indentation in document 2', r.documents.map((d) => d.ok), [true, false]);
  eq('mark line 5', r.documents[1].error.mark.line + 1, 5);
}
{
  const r = v('a: 1\na: 2\n');
  check('duplicate key still an error (single document)', !r.ok && r.documents.length === 1);
  eq('single document error line', r.documents[0].error.mark.line + 1, 2);
}
{
  const r = v('a: 1\n%YAML 1.2\n---\nb: 2');
  check('directive without ... before it is an error (whole stream is the reference)', !r.ok,
    JSON.stringify(r.documents.map((d) => d.ok)));
}

// ---------- single documents unchanged ----------
eq('single document', values(v('name: Alice\nage: 30')), [{ name: 'Alice', age: 30 }]);
eq('comment only', values(v('# nothing')), [null]);
check('single document ok', v('a: [1, 2]').ok);
{
  const big = 'x: 1\n' + '\n'.repeat(20000) + 'y';
  const t0 = Date.now();
  v(big);
  check('long blank runs stay fast', Date.now() - t0 < 1000 * PERF_SLACK, (Date.now() - t0) + ' ms');
}

// ---------- complete page + real shared keyboard handler ----------
console.log('Existing checks: ' + passes + ' passed, ' + failures + ' failed');
const pageStart = passes;
const labels = vm.runInNewContext(source.slice(source.indexOf('const labels ='), source.indexOf('const L =')) + ';labels;');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes('window.ztPersist.clear(_slug)')) throw Error('Missing actual shared shortcut');
const compiled = ts.transpileModule(source.match(/<script>([\s\S]*?)<\/script>/)[1], {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
}).outputText;
const requireFromRoot = createRequire(join(root, 'package.json'));
const settle = () => new Promise(setImmediate);
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
function page(lang = 'en', sharedFirst = false, preset = '') {
  const markup = source.slice(source.indexOf('\n---', 3) + 4, source.indexOf('<script>'));
  const nodes = new Map(), events = {}, timers = [], copies = [], tracks = [], clears = [];
  let copyMode = 'pending';
  function make(id, tag, attrs = '') {
    const listeners = {}, style = {};
    const el = { id, tagName: tag.toUpperCase(), value: '', textContent: '', innerHTML: '', className: attrs.match(/class="([^"]*)"/)?.[1] || '', dataset: {}, hidden: /\shidden(?:\s|$)/.test(attrs), disabled: false,
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      dispatch(type, event) { for (const fn of listeners[type] || []) fn.call(el, event || { target: el }); },
      click() { if (!el.disabled) el.dispatch('click'); }, focus() { document.activeElement = el; },
      contains(node) { return id === 'wrap' ? [...nodes.values()].includes(node) : id === 'yv-preview' && ['yv-preview', 'yv-copy-preview', 'yv-preview-note', 'yv-preview-content'].some(key => nodes.get(key) === node); }
    };
    el.style = new Proxy(style, { set(target, key, value) { target[key] = value; if (id === 'yv-preview' && key === 'display' && value === 'none' && nodes.get('yv-copy-preview') === document.activeElement) document.activeElement = document.body; return true; } });
    for (const declaration of (attrs.match(/style="([^"]*)"/)?.[1] || '').split(';')) { const [key, value] = declaration.split(':'); if (key && value) style[key.trim()] = value.trim(); }
    el.classList = { add() {}, remove() {} }; nodes.set(id, el); return el;
  }
  for (const match of markup.matchAll(/<(div|span|button|textarea|pre|p)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) make(match[3], match[1], match[2]);
  const get = id => { if (!nodes.has(id)) throw Error('Unknown actual ID ' + id); return nodes.get(id); };
  for (const match of markup.matchAll(/<button[^>]*id="([^"]+)"[^>]*>\{L\.(\w+)\}<\/button>/g)) get(match[1]).textContent = labels[lang][match[2]];
  const wrap = make('wrap', 'div'); wrap.dataset.lang = lang;
  for (const match of markup.matchAll(/data-([\w-]+)=\{L\.(\w+)\}/g)) wrap.dataset[match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = labels[lang][match[2]];
  get('yv-input').value = preset;
  const widget = { contains: el => [...nodes.values()].includes(el), querySelectorAll(selector) {
    if (selector !== 'textarea, input[type="text"]') throw Error('Unexpected shared selector ' + selector);
    return [...nodes.values()].filter(el => el.tagName === 'TEXTAREA');
  } };
  const document = { documentElement: { lang }, activeElement: null, body: {}, getElementById: get,
    querySelector(selector) { if (selector === '.yv-wrap') return wrap; if (selector === '.tool-widget') return widget; if (selector === '.tool-widget .btn-primary') return get('yv-validate'); throw Error('Unknown selector ' + selector); },
    addEventListener(type, fn) { (events[type] ??= []).push(fn); }
  };
  const clipboard = { writeText(text) { if (copyMode === 'throw') throw Error('Copy denied synchronously'); return new Promise((resolve, reject) => copies.push({ text, resolve, reject })); } };
  const context = vm.createContext({ document, console, _slug: 'yaml-validator', exports: {},
    require: name => requireFromRoot(name.startsWith('.') ? join(root, 'src/components/tools', name) : name),
    navigator: { clipboard }, setTimeout(fn, ms) { timers.push({ fn, ms, cancelled: false }); return timers.length; }, clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) }
  });
  context.window = context;
  if (sharedFirst) vm.runInContext(shortcut, context);
  vm.runInContext(compiled, context, { filename: 'YamlValidatorTool.astro:full-script' });
  if (!sharedFirst) vm.runInContext(shortcut, context);
  return { get, copies, timers, tracks, clears, document,
    copyMode(mode) { copyMode = mode; context.navigator.clipboard = mode === 'missing' ? undefined : clipboard; },
    key(key, modifier = 'ctrlKey', focus = 'yv-input') {
      const target = focus ? get(focus) : document.body;
      const event = { target, key, ctrlKey: false, metaKey: false, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
      if (modifier) event[modifier] = true; document.activeElement = target;
      target.dispatch?.('keydown', event); if (!event.stopped) for (const fn of events.keydown || []) fn(event);
      return event.defaultPrevented;
    }, type(value) { get('yv-input').value = value; get('yv-input').dispatch('input'); },
    validate(value = 'answer: 42\n') { get('yv-input').value = value; get('yv-validate').click(); },
    snapshot() { return { input: get('yv-input').value, status: get('yv-status').textContent, statusClass: get('yv-status').className, error: get('yv-error-box').innerHTML, errorDisplay: get('yv-error-box').style.display, preview: get('yv-preview-content').textContent, previewDisplay: get('yv-preview').style.display, note: get('yv-preview-note').textContent, noteHidden: get('yv-preview-note').hidden, copy: get('yv-copy-preview').textContent }; }
  };
}
for (const lang of Object.keys(labels)) for (const sharedFirst of [false, true]) {
  const h = page(lang, sharedFirst, 'answer: 42\n'), prefix = lang + ' sharedFirst=' + sharedFirst;
  eq(prefix + ' initial restored input still auto-validates exactly once', [h.tracks.length, h.get('yv-preview-content').textContent, h.get('yv-status').textContent], [1, JSON.stringify({ answer: 42 }, null, 2), labels[lang].msgValid]);
  for (const modifier of ['ctrlKey', 'metaKey']) {
    h.validate();
    const count = h.tracks.length;
    eq(prefix + ' ' + modifier + 'Enter prevents browser default', h.key('Enter', modifier), true);
    eq(prefix + ' ' + modifier + 'Enter validates once through real bubbling', h.tracks.length - count, 1);
    for (const key of ['l', 'L']) {
      h.validate('number: .inf'); check(prefix + ' loss note positive control', !h.get('yv-preview-note').hidden && h.get('yv-preview-note').textContent.includes('/number'));
      const before = h.snapshot(), clears = h.clears.length;
      eq(prefix + ' outside ' + modifier + key + ' unchanged', [h.key(key, modifier, null), h.snapshot(), h.clears.length], [false, before, clears]);
      eq(prefix + ' plain ' + key + ' unchanged', [h.key(key, null), h.snapshot()], [false, before]);
      eq(prefix + ' ' + modifier + key + ' clears input/results/status/note synchronously', [h.key(key, modifier, key === 'L' ? 'yv-copy-preview' : 'yv-input'), h.snapshot()], [true, { input: '', status: '', statusClass: 'yv-status ', error: '', errorDisplay: 'none', preview: '', previewDisplay: 'none', note: '', noteHidden: true, copy: labels[lang].copyJson }]);
      eq(prefix + ' shared clear called exactly once', h.clears.length - clears, 1);
      check(prefix + ' clear focus stays in visible input', h.document.activeElement === h.get('yv-input'));
      const count = h.copies.length; h.get('yv-copy-preview').click(); eq(prefix + ' cleared result cannot copy old JSON', h.copies.length, count);
    }
  }
  h.validate('a: ['); check(prefix + ' actual parse error shown', h.get('yv-error-box').innerHTML.includes(labels[lang].errTitle));
  h.key('l'); eq(prefix + ' shortcut clears actual error', [h.get('yv-error-box').innerHTML, h.get('yv-status').textContent], ['', '']);
  h.validate('name: one\n---\nname: two'); eq(prefix + ' fresh multi-document output recovers unchanged', h.get('yv-preview-content').textContent, JSON.stringify([{ name: 'one' }, { name: 'two' }], null, 2));
}
for (const lang of Object.keys(labels)) {
  const h = page(lang); h.validate(); const baseline = h.snapshot();
  h.get('yv-copy-preview').click(); eq(lang + ' copy uses complete exact JSON bytes', h.copies[0].text, baseline.preview);
  h.copies[0].resolve(); await settle(); eq(lang + ' current copy succeeds', h.get('yv-copy-preview').textContent, labels[lang].copied);
  const oldTimer = h.timers.find(t => t.ms === 1500); check(lang + ' feedback timer exists', !!oldTimer);
  h.get('yv-copy-preview').click(); h.copies[1].resolve(); await settle();
  oldTimer?.fn(); eq(lang + ' obsolete 1500ms timer cannot erase newer success', h.get('yv-copy-preview').textContent, labels[lang].copied);
  h.timers.at(-1)?.fn(); eq(lang + ' current feedback timer restores copy label', h.get('yv-copy-preview').textContent, labels[lang].copyJson);
  h.get('yv-copy-preview').click(); h.copies[2].reject(Error('Controlled denial')); await settle(); await settle();
  check(lang + ' current failure is localized and visible', typeof labels[lang].copyFailed === 'string' && h.get('yv-copy-preview').textContent === labels[lang].copyFailed);
  eq(lang + ' copy failure preserves validation/output bytes', [h.get('yv-status').textContent, h.get('yv-preview-content').textContent], [baseline.status, baseline.preview]);
  h.get('yv-copy-preview').click(); h.copies[3].resolve(); await settle();
  eq(lang + ' failure retry succeeds without regenerating output', [h.get('yv-copy-preview').textContent, h.tracks.length, h.copies[3].text], [labels[lang].copied, 1, baseline.preview]);
  for (const mode of ['throw', 'missing']) {
    h.copyMode(mode); let thrown = false; try { h.get('yv-copy-preview').click(); } catch { thrown = true; } await settle();
    eq(lang + ' ' + mode + ' clipboard failure is handled', [thrown, h.get('yv-copy-preview').textContent], [false, labels[lang].copyFailed]);
  }
  h.copyMode('pending');
  for (const change of ['clear', 'shortcut', 'input', 'valid', 'invalid']) for (const outcome of ['resolve', 'reject']) {
    const q = page(lang); q.validate(); q.get('yv-copy-preview').click();
    if (change === 'clear') q.get('yv-clear').click();
    if (change === 'shortcut') q.key('L', 'metaKey', 'yv-copy-preview');
    if (change === 'input') q.type('answer: 43');
    if (change === 'valid') q.validate('answer: 43');
    if (change === 'invalid') q.validate('a: [');
    const current = q.snapshot(); q.copies[0][outcome](outcome === 'reject' ? Error('Late denial') : undefined); await settle(); await settle();
    eq(lang + ' late copy ' + outcome + ' after ' + change + ' preserves current state', q.snapshot(), current);
    eq(lang + ' late copy ' + outcome + ' after ' + change + ' cannot schedule feedback', q.timers.length, 0);
  }
  const q = page(lang); q.validate(); q.get('yv-copy-preview').click(); q.get('yv-copy-preview').click();
  q.copies[1].resolve(); await settle(); q.copies[0].reject(Error('Older request denial')); await settle(); await settle();
  eq(lang + ' older request rejection leaves newest success', q.get('yv-copy-preview').textContent, labels[lang].copied);
  q.type('answer: 99'); eq(lang + ' manual input only resets copy feedback and does not validate', [q.tracks.length, q.get('yv-copy-preview').textContent, q.get('yv-preview-content').textContent], [1, labels[lang].copyJson, baseline.preview]);
  for (const timer of q.timers) timer.fn(); eq(lang + ' stale feedback timer after input cannot alter current label', q.get('yv-copy-preview').textContent, labels[lang].copyJson);
}
await settle(); eq('all copy rejections handled without unhandled promises', unhandled, []);
process.removeListener('unhandledRejection', onUnhandled);
eq('protected YAML engine bytes unchanged', [Buffer.byteLength(source.slice(startIndex, endIndex + END_MARK.length)), createHash('sha256').update(source.slice(startIndex, endIndex + END_MARK.length)).digest('hex')], [3000, 'bd985c6c5584fcb337eef79182a2b25a079136fdf649451580a77801b6e4c76b']);
console.log('Page lifecycle: ' + (passes - pageStart) + ' passed, ' + failures + ' total failures');

// ---------- v2 page layout ----------
const v2Start = passes;
const markup = source.replace(/^---\n[\s\S]*?\n---\s*/, '').split('<script>')[0];
const css = source.split('<style>')[1].split('</style>')[0];
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
check('v2 direct flex root', /^<div class="yv-wrap"/.test(markup) && /\.yv-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0/.test(css));
check('v2 registered analyze', /'yaml-validator':\s*'analyze'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
check('v2 controls precede reserved status, short input and full-width result', ['class="yv-actions"','id="yv-status"','class="yv-input-section"','id="yv-results"'].map(x=>markup.indexOf(x)).every((n,i,a)=>n>=0&&(!i||n>a[i-1])));
eq('v2 all three existing actions retained', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]).sort(), ['yv-validate','yv-clear','yv-copy-preview'].sort());
check('v2 status reserves bounded height', /\.yv-status\s*\{[^}]*flex: none;[^}]*height: 3rem;[^}]*overflow: auto/.test(css));
check('v2 result-state input scrolls at 180px', /#yv-input\s*\{[^}]*height: 180px;[^}]*min-height: 0;[^}]*resize: none;[^}]*overflow: auto/.test(css));
check('v2 desktop empty state gives available height to the input', /@media \(min-width: 861px\)[\s\S]*\.yv-wrap:has\(\.yv-results\[data-empty="true"\]\) \.yv-input-section\s*\{ flex: 1 1 0; min-height: 0; \}/.test(css) && /\.yv-wrap:has\(\.yv-results\[data-empty="true"\]\) #yv-input\s*\{ flex: 1 1 0; height: 0; \}/.test(css));
check('v2 empty hint takes only its content height', /@media \(min-width: 861px\)[\s\S]*\.yv-results\[data-empty="true"\]\s*\{ flex: none; \}/.test(css));
check('v2 input still editable and labeled', /<label for="yv-input">\{L.inputLabel\}<\/label>/.test(markup) && !/<textarea[^>]*(?:readonly|disabled)/.test(markup));
for (const selector of ['.yv-results', '.yv-preview', '.yv-error-box', '.yv-preview-content']) {
  const rule = css.match(new RegExp(selector.replaceAll('.', '\\.') + '\\s*\\{([^}]+)\\}'))?.[1] || '';
  check('v2 bounded flex region ' + selector, /flex: 1 1 0/.test(rule) && /min-width: 0/.test(rule) && /min-height: 0/.test(rule));
}
check('v2 error and JSON content scroll internally', /\.yv-error-box\s*\{[^}]*overflow: auto/.test(css) && /\.yv-preview-content\s*\{[^}]*overflow: auto/.test(css));
for (const id of ['yv-error-box', 'yv-preview-content']) check('v2 keyboard scrollable ' + id, new RegExp('id="'+id+'"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-label=').test(markup));
check('v2 precision note remains directly above JSON content', /id="yv-preview-note"[^>]*role="note"[^>]*hidden><\/p>\s*<pre id="yv-preview-content"/.test(markup) && !markup.includes('<details'));
check('v2 long precision notes remain bounded and scrollable', /\.yv-preview-note\s*\{[^}]*flex: none;[^}]*max-height: 6rem;[^}]*overflow: auto/.test(css));
check('v2 empty result is localized and hidden at <=860', markup.includes('{L.emptyResult}') && /@media \(max-width: 860px\)[\s\S]*\.yv-results\[data-empty="true"\]\s*\{ display: none; \}/.test(css));
check('v2 <=860 short input and result sizes', /#yv-input\s*\{ height: 140px; \}/.test(css) && /\.yv-results\s*\{ flex: none; height: 24rem; \}/.test(css));
check('v2 <=640 actionable controls and bounded output', /@media \(max-width: 640px\)[\s\S]*min-height: 44px/.test(css) && /\.yv-results\s*\{ height: 22rem; \}/.test(css));
for (const name of ['yv-err-title','yv-err-reason','yv-err-location','yv-err-snippet','yv-doc','yv-doc-title','yv-doc-ok']) check('v2 injected error class receives global CSS ' + name, css.includes(':global(.' + name + ')'));
const tips = [...markup.matchAll(/<Toggletip id="(yv-tip-[^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
eq('v2 five tips map to visible controls', tips.map(m=>[m[1],m[2],m[3]]).sort(), [['yv-tip-input','inputLabel','input'],['yv-tip-validate','validate','validate'],['yv-tip-clear','clear','clear'],['yv-tip-preview','parsedStructure','preview'],['yv-tip-copy','copyJson','copy']].sort());
check('v2 existing build-time labels/data interface excludes tips from client payload', source.includes('const { tips: TIPS } = L;') && !/TIPS|labels|\.tips/.test(script) && !/data-[\w-]+=\{[^}]*tips/i.test(markup));
const MDX_HASHES={en:'631de9ba531aeae2131c00b9564980e70f644ff0ef212d90ab2e4b1be22fea47',zh:'2383aea49676ae9c86843fd72dd6507dc1d76968dbe54ee8801ddc58c650bb77',ja:'90edeceda73422e2965f2d2651849866c309dddf2a74b3df28a7040086660191',ko:'70426f62b6bcc525c81faa4188feeefa66c03fc9fa60552fa48211e752f9a72e'};
function leaves(value,path=''){return Object.entries(value).flatMap(([key,item])=>typeof item==='object'?leaves(item,path+key+'.'):[[path+key,item]]);}
const enLeaves=Object.fromEntries(leaves(labels.en));
for(const lang of Object.keys(labels)) {
  const local=Object.fromEntries(leaves(labels[lang]));
  eq(lang+' v2 recursive locale keys',Object.keys(local).sort(),Object.keys(enLeaves).sort());
  for(const [key,value] of Object.entries(local)) {
    check(lang+' v2 nonempty '+key,typeof value==='string'&&value.trim().length>0);
    eq(lang+' v2 placeholders '+key,[...value.matchAll(/\{[^}]+\}/g)].map(m=>m[0]).sort(),[...enLeaves[key].matchAll(/\{[^}]+\}/g)].map(m=>m[0]).sort());
  }
  const mdx=readFileSync(join(root,'src/content/tools/yaml-validator',lang+'.mdx'),'utf8');
  const steps=(mdx.match(/^steps:\n([\s\S]*?)(?=^faqItems:)/m)?.[1]||'').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line.trim().slice(2)));
  eq(lang+' v2 steps count',steps.length,5);
  check(lang+' v2 steps limits/plain text',steps.every(x=>[...x].length<=280&&!/[<>]|\]\(|\*\*|`/.test(x))&&steps.reduce((n,x)=>n+[...x].length,0)<=1200);
  check(lang+' v2 steps use current buttons', ['validate','clear','copyJson'].every(key=>steps.join(' ').includes(labels[lang][key])));
  check(lang+' v2 removes only Usage',!/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx));
  eq(lang+' v2 keeps SEO/FAQ/examples/Limits byte-exact',createHash('sha256').update(mdx.replace(/^steps:\n[\s\S]*?(?=^faqItems:)/m,'')).digest('hex'),MDX_HASHES[lang]);
  const h=page(lang); h.validate('number: .inf');
  eq(lang+' v2 valid result expands region',h.get('yv-results').dataset.empty,'false');
  check(lang+' v2 precision note stays exposed before JSON',!h.get('yv-preview-note').hidden&&h.get('yv-preview-note').textContent.includes('/number'));
  h.validate('a: 1\n---\na: [');
  eq(lang+' v2 error result replaces preview', [h.get('yv-results').dataset.empty,h.get('yv-preview').style.display,h.get('yv-error-box').style.display],['false','none','']);
  check(lang+' v2 valid and invalid documents shown together',h.get('yv-error-box').innerHTML.includes(labels[lang].docTitle.replace('{k}','1'))&&h.get('yv-error-box').innerHTML.includes(labels[lang].docTitle.replace('{k}','2')));
  h.key('L','metaKey','yv-error-box');
  eq(lang+' v2 clearing focusable errors restores input and empty result',[h.get('yv-results').dataset.empty,h.document.activeElement===h.get('yv-input')],['true',true]);
  const long='rows:\n'+Array.from({length:600},(_,i)=>'  - '+i).join('\n');h.validate(long);
  eq(lang+' v2 long JSON retains all output bytes',h.get('yv-preview-content').textContent,JSON.stringify({rows:Array.from({length:600},(_,i)=>i)},null,2));
  h.get('yv-clear').click();eq(lang+' v2 clear restores empty result',h.get('yv-results').dataset.empty,'true');
}
console.log('v2 page layout: '+(passes-v2Start)+' passed, '+failures+' total failures');

// Verify emitted selectors, where a scoped theme ancestor cannot match the document root.
const astroRequire = createRequire(createRequire(import.meta.url).resolve('astro/package.json'));
const { transform: compileAstro } = astroRequire('@astrojs/compiler');
const emitted = (await compileAstro(source, { filename: 'YamlValidatorTool.astro' })).css.join('\n');
const manualDark = [...emitted.matchAll(/([^{}]+)\{/g)].map(m => m[1].trim()).filter(s => /\[data-theme=(?:"dark"|dark)\]/.test(s));
check('compiled manual dark theme covers status and error surface', manualDark.length >= 3);
for (const selector of manualDark) check('manual dark ancestor matches unscoped html: ' + selector, !/(?:data-astro-cid|\.astro-)/.test(selector.slice(0, selector.indexOf(' .yv-'))));

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
