// JSON to TypeScript — every object keeps its own fields; the output compiles and accepts the sample
//
// Read:  src/components/tools/JsonToTypescriptTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); node_modules/typescript (the compiler);
//        src/content/tools/json-to-typescript/{en,zh,ja,ko}.mdx (the examples)
//        src/layouts/ToolLayout.astro (the real shared keyboard listener)
//        src/data/tool-layouts.ts (v2 registration); src/i18n/*.json (tip names)
// Write: stdout only (the compiler runs on in-memory files)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Each generated declaration set is compiled with the TypeScript compiler API (strict) together
// with `const sample: Root = <the JSON>;`. An object literal with a property that its type does
// not declare is an error (excess property check), so a field that was lost from a type fails
// the compile. Cases: two nested objects with the same key name and different fields (before
// the fix the second one reused the first type and lost its fields), the same shape twice (one
// shared type), keys that are not identifiers or that produce invalid type names (2fa, "",
// non-ASCII), keys named constructor / toString / hasOwnProperty, arrays of objects, the root
// name kept even when a nested key has the same name, and the examples on the tool pages.
//
// Run: node scripts/test-json-to-typescript.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToTypescriptTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToTypescriptTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { generateTypeScript };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

function compile(code) {
  const fileName = 'gen.ts';
  const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, lib: ['lib.es2022.d.ts'], types: [] };
  const host = ts.createCompilerHost(options);
  const orig = host.getSourceFile;
  host.getSourceFile = (name, lang) => name === fileName ? ts.createSourceFile(name, code, lang) : orig.call(host, name, lang);
  const program = ts.createProgram([fileName], options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}
function accepts(name, json, opts = {}) {
  const rootName = opts.root || 'RootObject';
  const r = E.generateTypeScript(JSON.parse(json), rootName, !!opts.optional, !!opts.useType);
  const isArray = Array.isArray(JSON.parse(json));
  const errors = compile(r.code + '\n\nexport const sample: ' + rootName + (isArray ? '[]' : '') + ' = ' + json + ';\n');
  check(name + ': compiles and accepts the sample', errors.length === 0, errors.join('; ') + '\n' + r.code);
  return r.code;
}

// ---------- the reported defect: two nested objects with the same key ----------
{
  const code = accepts('a.meta and b.meta differ', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":"s"}}}');
  check('a.meta keeps x', /interface Meta \{\n  x: number;\n\}/.test(code), code);
  check('b.meta gets its own type with y', /interface BMeta \{\n  y: string;\n\}/.test(code), code);
  check('B refers to BMeta', /interface B \{\n  meta: BMeta;\n\}/.test(code), code);
}
{
  const code = accepts('same shape twice', '{"a":{"meta":{"x":1}},"b":{"meta":{"x":2}}}');
  eq('identical shapes share one type', (code.match(/interface \w*Meta /g) || []).length, 1);
}
accepts('three different meta objects', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":1}},"c":{"meta":{"z":1}},"d":{"meta":{"y":2}}}');
accepts('same key at different depths', '{"node":{"id":1,"node":{"name":"n","node":{"leaf":true}}}}');
accepts('array items with the same name', '{"a":{"items":[{"p":1}]},"b":{"items":[{"q":"x"}]}}');
{
  const code = accepts('nested key equal to the root name', '{"rootObject":{"z":1},"k":2}');
  check('the root keeps its name', /^interface RootObject \{/.test(code), code);
}

// ---------- names and keys ----------
accepts('keys that are not identifiers', '{"user-name":"a","2fa":{"on":true},"":{"e":1},"名前":{"姓":"山田"},"a b":{"c":1}}');
{
  const r = E.generateTypeScript(JSON.parse('{"2fa":{"on":true},"":{"e":1}}'), 'RootObject', false, false);
  check('type names are identifiers', !/interface (\d|\s)/.test(r.code), r.code);
}
accepts('prototype key names', '{"constructor":{"a":1},"toString":"x","hasOwnProperty":1,"items":[{"constructor":1,"valueOf":2},{"constructor":3,"valueOf":4}]}');
accepts('array of objects merged', '{"items":[{"id":1,"name":"a","tags":[]},{"id":2,"price":9.5,"tags":["x",1]}]}');
accepts('root array of objects', '[{"id":1},{"id":2,"extra":{"deep":[1,2]}}]');
accepts('optional and type alias', '{"a":{"meta":{"x":1}},"b":{"meta":{"y":"s"}}}', { optional: true, useType: true });
accepts('null values', '{"a":null,"b":{"c":null}}');
eq('primitive root', E.generateTypeScript(5, 'Root', false, false).code, 'type Root = number;');
eq('array of primitives root', E.generateTypeScript([1, 'a'], 'Root', false, false).code, 'type Root = (number | string)[];');
eq('count of declarations', E.generateTypeScript(JSON.parse('{"a":{"meta":{"x":1}},"b":{"meta":{"y":"s"}}}'), 'R', false, false).count, 5);

// ---------- tool page examples ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/json-to-typescript/' + lang + '.mdx'), 'utf8');
  const re = /```json\n([\s\S]*?)\n```\s*\n[^`]*```typescript\n([\s\S]*?)\n```/g;
  let m;
  let count = 0;
  while ((m = re.exec(mdx))) {
    count++;
    let parsed;
    try { parsed = JSON.parse(m[1]); } catch { continue; }
    eq(lang + ': example ' + count + ' output', E.generateTypeScript(parsed, 'RootObject', false, false).code, m[2]);
  }
  check(lang + ': page has at least three examples', count >= 3, String(count));
}

// ---------- complete page lifecycle: real script/shortcuts, controlled DOM/clipboard/time ----------
const pageScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const pageLabels = vm.runInNewContext('(' + source.match(/const STRINGS = (\{[\s\S]*?\n\});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', startIndex) + 1, endIndex + END_MARK.length);
eq('engine bytes including marker indentation', Buffer.byteLength(engineLines), 8381);
eq('immutable engine SHA256', createHash('sha256').update(engineLines).digest('hex'), '0ee4e584eb3ee903925cbc5fb4213a8e9b5e62910556691a4effe72bc2930caf');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
function page(lang, shellFirst = false) {
  const copies = [], tracks = [], clears = [], timers = new Map(), docEvents = {};
  let now = 0, timerId = 0, doc;
  const decode = s => s.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const descendants = el => el.children.flatMap(c => [c, ...descendants(c)]);
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const words = part.trim().split(/\s+/);
      if (words.length > 1) {
        if (!matches(el, words.pop())) return false;
        for (let p = el.parentElement; p; p = p.parentElement) if (matches(p, words.join(' '))) return true;
        return false;
      }
      const tag = /^[a-z][\w-]*/i.exec(part)?.[0], id = /#([\w-]+)/.exec(part)?.[1];
      return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
        && [...part.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
        && [...part.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].every(m => el.attributes[m[1]] === m[2]);
    });
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), attributes: {}, dataset: {}, listeners: {}, children: [], parentElement: null, className: '', value: '', textContent: '', checked: false }); }
    setAttribute(key, value) {
      this.attributes[key] = value;
      if (['id', 'type', 'value'].includes(key)) this[key] = value;
      if (key === 'class') this.className = value;
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    get classList() { const e = this; return { contains(c) { return e.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) e.className += ' ' + c; }, remove(c) { e.className = e.className.split(/\s+/).filter(v => v !== c).join(' '); } }; }
    appendChild(e) { this.children.push(e); e.parentElement = this; }
    querySelectorAll(s) { return descendants(this).filter(e => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    contains(e) { return this === e || descendants(this).includes(e); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this, type }); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element('section'); widget.className = 'tool-widget'; body.appendChild(widget);
  const tipAbout = JSON.parse(readFileSync(join(root, 'src/i18n/' + lang + '.json'), 'utf8'))['tool.tipAbout'];
  // Render the shared component's button/panel boundary for focus tests. Popover geometry belongs to browser QA.
  const markup = source.split('\n---')[1].split('<script')[0]
    .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{L\.tips\.(\w+)\}<\/Toggletip>/g, (_, id, about, tip) =>
      '<span class="zt-tip"><button type="button" data-zt-tip="' + id + '" aria-label="' + escape(tipAbout.replace('{name}', pageLabels[lang][about])) + '"></button><span id="' + id + '" role="note">' + escape(pageLabels[lang].tips[tip]) + '</span></span>')
    .replace(/=\{L\.(\w+)\}/g, (_, key) => '="' + escape(pageLabels[lang][key]) + '"')
    .replace(/\{L\.(\w+)\}/g, (_, key) => escape(pageLabels[lang][key]));
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[3] !== undefined) { stack.at(-1).textContent += decode(token[3]).trim(); continue; }
    if (token[0].startsWith('</')) { if (stack.at(-1).tagName !== token[1].toUpperCase()) throw Error('Unbalanced real markup'); stack.pop(); continue; }
    const el = new Element(token[1]);
    for (const a of token[2].matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) el.setAttribute(a[1], decode(a[2] ?? a[3]));
    stack.at(-1).appendChild(el);
    if (!['input', 'br', 'hr'].includes(token[1]) && !token[2].endsWith('/')) stack.push(el);
  }
  const get = id => { const el = descendants(body).find(e => e.id === id); if (!el) throw Error('Missing real ID ' + id); return el; };
  doc = { body, activeElement: body, getElementById: get, querySelector: s => body.querySelector(s), addEventListener(type, fn) { (docEvents[type] ||= []).push(fn); } };
  const context = { document: doc, _slug: 'json-to-typescript', console,
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context, { filename: 'JsonToTypescriptTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return { get, context, copies, tracks, clears, timers, doc,
    input(value) { get('jtt-input').value = value; get('jtt-input').dispatch('input'); },
    key(id = 'jtt-input', key = 'l', modifier = 'ctrlKey') { (typeof id === 'string' ? get(id) : id || body).focus(); const e = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of docEvents.keydown || []) fn(e); return e; },
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); now = next[1].due; next[1].fn(); } now = end; },
  };
}
const snapshot = p => JSON.stringify(['jtt-input', 'jtt-root-name', 'jtt-optional', 'jtt-use-type', 'jtt-output-code', 'jtt-status', 'jtt-copy'].map(id => { const e = p.get(id); return [e.value, e.checked, e.textContent, e.className]; }));
const golden = p => { p.input('{"name":"Ada","count":2}'); p.advance(300); };
const goldenCode = 'interface RootObject {\n  name: string;\n  count: number;\n}';
const copy = p => { p.get('jtt-copy').click(); return p.copies.at(-1); };
const copyFailure = {
  en: 'Copy failed. Please copy the output manually.', zh: '复制失败，请手动复制输出。',
  ja: 'コピーに失敗しました。出力を手動でコピーしてください。', ko: '복사하지 못했습니다. 출력을 직접 복사하세요.',
};
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang], p = page(lang); golden(p);
    eq(lang + ': complete page golden output', p.get('jtt-output-code').textContent, goldenCode);
    eq(lang + ': localized success', p.get('jtt-status').textContent, L.msgGenOne);
    p.get('jtt-root-name').value = 'Api'; p.get('jtt-root-name').dispatch('input');
    p.get('jtt-optional').checked = true; p.get('jtt-optional').dispatch('change');
    p.get('jtt-use-type').checked = true; p.get('jtt-use-type').dispatch('change'); p.advance(300);
    eq(lang + ': options still await Generate', p.get('jtt-output-code').textContent, goldenCode);
    p.key('jtt-input', 'Enter');
    eq(lang + ': shared Enter uses current options', p.get('jtt-output-code').textContent, 'type Api = {\n  name?: string;\n  count?: number;\n}');
    p.get('jtt-clear').click();
    check(lang + ': Clear keeps configuration', p.get('jtt-root-name').value === 'Api' && p.get('jtt-optional').checked && p.get('jtt-use-type').checked);
    check(lang + ': Clear empties derived state', !p.get('jtt-input').value && !p.get('jtt-output-code').textContent && !p.get('jtt-status').textContent);
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = page(lang, shellFirst); golden(q); q.get('jtt-root-name').value = 'Api'; q.get('jtt-optional').checked = true; q.get('jtt-use-type').checked = true;
      const prefix = lang + ': shared clear ' + shellFirst + '/' + modifier;
      const beforeOutside = snapshot(q); q.key(null, 'l', modifier); eq(prefix + ' outside unchanged', snapshot(q), beforeOutside);
      q.input('{'); q.key('jtt-copy', 'L', modifier);
      check(prefix + ' clears JSON/root/output/status/error', !q.get('jtt-input').value && !q.get('jtt-root-name').value && !q.get('jtt-output-code').textContent && !q.get('jtt-status').textContent && !q.get('jtt-input').classList.contains('error'));
      check(prefix + ' retains flags', q.get('jtt-optional').checked && q.get('jtt-use-type').checked);
      eq(prefix + ' cancels queued debounce', q.timers.size, 0);
      eq(prefix + ' shared storage clear once', q.clears.join(','), 'json-to-typescript');
      const cleared = snapshot(q); q.advance(1600); eq(prefix + ' remains clear', snapshot(q), cleared);
    }
    const invalid = page(lang); invalid.input('{'); invalid.advance(300);
    check(lang + ': invalid JSON positive error control', invalid.get('jtt-input').classList.contains('error') && invalid.get('jtt-status').className.includes('error'));
    invalid.input(''); invalid.advance(300);
    check(lang + ': empty removes error/output/status', !invalid.get('jtt-input').classList.contains('error') && !invalid.get('jtt-output-code').textContent && !invalid.get('jtt-status').textContent);
    const q = page(lang); golden(q);
    const good = copy(q); eq(lang + ': Copy complete output bytes', good.value, goldenCode); good.resolve(); await settle();
    eq(lang + ': current copy succeeds', q.get('jtt-copy').textContent, L.copied); q.advance(1500); eq(lang + ': current timer restores Copy', q.get('jtt-copy').textContent, L.copy);
    const failuresBefore = unhandled.length; copy(q).reject(Error('denied')); await settle();
    eq(lang + ': localized copy rejection', q.get('jtt-status').textContent, copyFailure[lang]);
    eq(lang + ': rejection handled', unhandled.length, failuresBefore);
    const retry = copy(q); eq(lang + ': direct retry same bytes', retry.value, goldenCode); retry.resolve(); await settle();
    eq(lang + ': direct retry succeeds', q.get('jtt-copy').textContent, L.copied);
    check(lang + ': direct retry removes only copy failure', !q.get('jtt-status').className.includes('error') && q.get('jtt-status').textContent !== copyFailure[lang]);
    for (const action of ['input', 'clear', 'shortcut', 'result', 'error', 'example']) for (const outcome of ['resolve', 'reject', 'timer']) {
      const r = page(lang); golden(r); const old = copy(r);
      if (outcome === 'timer') { old.resolve(); await settle(); }
      if (action === 'input') r.input('{"next":true}');
      if (action === 'clear') r.get('jtt-clear').click();
      if (action === 'shortcut') r.key();
      if (action === 'result') { r.input('{"next":true}'); r.get('jtt-convert').click(); }
      if (action === 'error') { r.input('{'); r.get('jtt-convert').click(); }
      if (action === 'example') r.get('jtt-example').click();
      const before = snapshot(r), rejectedBefore = unhandled.length;
      if (outcome === 'timer') r.advance(1500); else { old[outcome](Error('late')); await settle(); }
      // Pending live input may convert at 300ms; settle that separately from the old copy timer.
      if (outcome !== 'timer' || action !== 'input') eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      else eq(lang + ': stale input timer cannot restore feedback', r.get('jtt-copy').textContent, L.copy);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = page(lang); golden(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500);
    eq(lang + ': older 1500ms timer cannot replace newer success', t.get('jtt-copy').textContent, L.copied);
    t.advance(1000); eq(lang + ': latest feedback expires normally', t.get('jtt-copy').textContent, L.copy);
    const order = page(lang); golden(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle();
    eq(lang + ': older success preserves newer copy error', order.get('jtt-status').textContent, copyFailure[lang]);
    eq(lang + ': older success cannot claim copied', order.get('jtt-copy').textContent, L.copy);
  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);

// ---------- v2 page layout ----------
const layoutMarkup = source.split('\n---')[1].split('<script')[0];
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const hash = value => createHash('sha256').update(value).digest('hex');
const registration = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
check('v2 registered as convert', /'json-to-typescript':\s*'convert'/.test(registration));
check('v2 direct flex root has zero minimum height', /^\s*<div\s+class="jtt-wrap"/.test(layoutMarkup) && /\.jtt-wrap\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;/.test(css));
check('v2 controls/status precede shared panels', layoutMarkup.indexOf('class="jtt-config"') < layoutMarkup.indexOf('class="jtt-actions"') && layoutMarkup.indexOf('class="jtt-actions"') < layoutMarkup.indexOf('id="jtt-status"') && layoutMarkup.indexOf('id="jtt-status"') < layoutMarkup.indexOf('class="jtt-panels zt-io"'));
eq('v2 two shared IO panes', (layoutMarkup.match(/\bzt-io-pane\b/g) || []).length, 2);
check('v2 primary input and result use shared fill', /id="jtt-input"\s+class="zt-io-fill"/.test(layoutMarkup) && /id="jtt-output" class="jtt-output zt-io-fill"/.test(layoutMarkup));
check('v2 status reserves empty space', /\.jtt-status\s*\{[^}]*min-height:\s*2\.4rem;/.test(css));
check('v2 output remains a keyboard-accessible scroller', /id="jtt-output"[^>]*tabindex="0"[^>]*aria-labelledby="jtt-output-label"/.test(layoutMarkup) && /\.jtt-output\s*\{[^}]*overflow:\s*auto;/.test(css) && /\.jtt-output:focus-visible\s*\{[^}]*outline:/.test(css));
check('v2 desktop empty state depends on actual output', /\.jtt-output-pane:has\(#jtt-output-code:empty\) \.jtt-output\s*\{\s*display:\s*none;/.test(css) && /\.jtt-output-pane:has\(#jtt-output-code:empty\) \.jtt-empty\s*\{\s*display:\s*flex;/.test(css));
const stacked = css.slice(css.indexOf('@media (max-width: 860px)'), css.indexOf('@media (prefers-color-scheme: dark)'));
check('v2 stacked empty pane is hidden and output height bounded', /\.jtt-output-pane:has\(#jtt-output-code:empty\)\s*\{\s*display:\s*none;/.test(stacked) && /\.jtt-output\s*\{[^}]*height:\s*22rem;/.test(stacked));
check('v2 phone controls keep touch height', /\.jtt-actions button, \.jtt-panel-header button\s*\{\s*min-height:\s*44px;/.test(stacked) && /\.jtt-options label\s*\{\s*min-height:\s*44px;/.test(css));
check('v2 dark ancestors use global selectors', css.includes(':global(:root:not([data-theme="light"]))') && css.includes(':global([data-theme="dark"])'));
check('v2 labels stay build-time and tips never enter page script', !/data-i18n|define:vars/.test(source) && !/STRINGS|L\.tips|\.tips\b/.test(pageScript));
eq('v2 original manual buttons retained', [...layoutMarkup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]).sort().join(','), 'jtt-clear,jtt-convert,jtt-copy,jtt-example');
const tipMap = [
  ['root-name', 'rootName', 'rootName'], ['optional', 'makeOptional', 'optional'], ['use-type', 'useTypeAbout', 'useType'],
  ['generate', 'generate', 'generate'], ['example', 'example', 'example'], ['clear', 'clear', 'clear'], ['input', 'jsonInput', 'input'], ['copy', 'copy', 'copy'],
];
eq('v2 eight actual Toggletip bindings', (layoutMarkup.match(/<Toggletip\b/g) || []).length, tipMap.length);
for (const [id, about, key] of tipMap) check('v2 control-bound tip ' + id, layoutMarkup.includes('<Toggletip id="jtt-tip-' + id + '" lang={lang} about={L.' + about + '}>{L.tips.' + key + '}</Toggletip>'));
// Pre-migration hashes from b6-json-to-typescript-copy.md; only Usage became steps.
// frontmatter excludes delimiter lines and includes its final LF; body starts just after the closing delimiter LF.
const protectedContent = {
  en: ['33f065bb48a85210c08068f16b5f67d3731f2adcf8e11bf8102240b1e12f760e', '355632c69f03febe913c35eb53def30ef7f7ffe1749f1d972293703e14d3666f'],
  zh: ['7780dbf80da4c955fd59cb0d4023dfee471b9ff987391d5e3cdd32d78ee40220', 'd2be61f91451c0f7c591dfa9ee383580556ad4de4b43b17ff862c14e8a95608f'],
  ja: ['4cbafb9c681c5bd680f6f8fb7e20d16e522a9f698092b87830a2603d7a4fa16c', '6e1f57024bba9b14603dd369125e79784b8d5cf83a0e72d4d65f454d3d509870'],
  ko: ['d4f80ef461dc0bbab31937b5a0dc6d06be224a6cd4111954d932a3de59cf6dda', '92fcb11d13155416ad1bd12b0372c35e955a24b360ef51f0608d36711a0696c5'],
};
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const L = pageLabels[lang], p = page(lang), rootEl = p.doc.querySelector('.jtt-wrap');
  eq(lang + ': v2 same eight tip keys', Object.keys(L.tips).sort().join(','), tipMap.map(x => x[2]).sort().join(','));
  for (const [id, about, key] of tipMap) check(lang + ': v2 plain localized tip ' + id, typeof L[about] === 'string' && !!L[about].trim() && !/[<>]/.test(L[about]) && typeof L.tips[key] === 'string' && !!L.tips[key].trim() && !/[<>]/.test(L.tips[key]));
  check(lang + ': v2 localized empty hint', typeof L.empty === 'string' && !!L.empty.trim() && layoutMarkup.includes('{L.empty}'));
  eq(lang + ': v2 only runtime feedback data is forwarded', Object.keys(rootEl.dataset).sort().join(','), 'copied,copy,copyFailed,msgGenMany,msgGenOne,msgGenerated,msgInvalidJson');
  const mdx = readFileSync(join(root, 'src/content/tools/json-to-typescript/' + lang + '.mdx'), 'utf8');
  const [, fm, body] = mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
  const stepsText = fm.match(/^steps:\n((?:  - .*\n)+)/m)[1];
  const steps = stepsText.trimEnd().split('\n').map(line => JSON.parse(line.slice(4)));
  eq(lang + ': v2 eight steps before FAQ', steps.length, 8);
  check(lang + ': v2 step limits and order', fm.indexOf('steps:') < fm.indexOf('faqItems:') && steps.every(s => [...s].length <= 280 && !/[<>]/.test(s)) && steps.reduce((n, s) => n + [...s].length, 0) <= 1200);
  for (const key of ['jsonInput', 'example', 'rootName', 'makeOptional', 'useTypeAbout', 'generate', 'copy', 'clear']) check(lang + ': v2 steps name actual ' + key, steps.join('\n').includes(L[key]));
  eq(lang + ': v2 unchanged SEO/FAQ frontmatter', hash(fm.replace(/^steps:\n(?:  - .*\n)+/m, '')), protectedContent[lang][0]);
  eq(lang + ': v2 all non-Usage body and examples unchanged', hash(body), protectedContent[lang][1]);
  check(lang + ': v2 no duplicate Usage heading', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  for (const shellFirst of [false, true]) for (const focus of ['output', 'copy-tip']) {
    const q = page(lang, shellFirst); golden(q);
    const el = focus === 'output' ? q.get('jtt-output') : q.doc.querySelector('[data-zt-tip="jtt-tip-copy"]');
    q.key(el);
    check(lang + ': v2 output-area CtrlL remains focused ' + shellFirst + '/' + focus, q.doc.activeElement === q.get('jtt-input') && !q.get('jtt-input').value && !q.get('jtt-root-name').value && !q.get('jtt-output-code').textContent && !q.get('jtt-status').textContent && q.clears.length === 1);
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
