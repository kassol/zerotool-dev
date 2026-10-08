// TOML ↔ JSON — behavior quoted on the toml-json tool pages
//
// Read:  src/components/tools/TomlJsonTool.astro, run through scripts/astro-page-harness.mjs with
//        the npm smol-toml it imports; src/content/tools/toml-json/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Each conversion types into the page's own textarea, so the result is what the page shows
// (smol-toml parse, precision marks and fidelity check → stringifyJson(found.value, 2);
// JSON.parse with source text → fidelity check → smol-toml stringify). The inputs are the
// examples and limits on the en page; the two stop messages are checked to appear verbatim on
// all four language pages.
//
// Run: node scripts/test-toml-json.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './astro-page-harness.mjs';
import { contractProblems, examplePairs } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const comp = readFileSync(join(root, 'src/components/tools/TomlJsonTool.astro'), 'utf8');
let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
eq('component uses stringifyJson(found.value, 2) and stringify(found.value)', /stringifyJson\(found\.value, 2\)/.test(comp) && /[^.J]stringify\(found\.value\)/.test(comp), true);
function convert(input, output, text, lang = 'en') {
  const page = loadPage('src/components/tools/TomlJsonTool.astro', { lang, stringsSelector: '.tj-wrap' });
  page.type(input, text);
  const out = page.el(output).value;
  return out || 'ERR ' + page.el('tj-status').textContent;
}
// JSON output is compared in its compact form, as on the page
const t2j = (t, lang) => { const r = convert('tj-toml', 'tj-json', t, lang); return r.startsWith('ERR') ? r : JSON.stringify(JSON.parse(r)); };
const j2t = (j, lang) => convert('tj-json', 'tj-toml', j, lang);
const pages = Object.fromEntries(['en', 'zh', 'ja', 'ko'].map((l) => [l, readFileSync(join(root, 'src/content/tools/toml-json/' + l + '.mdx'), 'utf8')]));

eq('simple table', t2j('[database]\nhost = "localhost"\nport = 5432\nenabled = true'), '{"database":{"host":"localhost","port":5432,"enabled":true}}');
eq('array of tables', t2j('[[fruits]]\nname = "apple"\n\n[[fruits]]\nname = "banana"\ncolor = "yellow"'), '{"fruits":[{"name":"apple"},{"name":"banana","color":"yellow"}]}');
eq('dotted table keeps dashes', t2j('[project]\nrequires-python = ">=3.10"\n[tool.ruff.lint]\nselect = ["E"]'), '{"project":{"requires-python":">=3.10"},"tool":{"ruff":{"lint":{"select":["E"]}}}}');
eq('package.json to TOML', j2t('{"name":"demo","version":"1.0.0","private":true,"scripts":{"build":"astro build","test":"node --test"},"workspaces":["packages/*"],"engines":{"node":">=22"}}'),
  'name = "demo"\nversion = "1.0.0"\nprivate = true\nworkspaces = [ "packages/*" ]\n\n[scripts]\nbuild = "astro build"\ntest = "node --test"\n\n[engines]\nnode = ">=22"\n');
eq('quoted keys', j2t('{"my key":1,"a.b":2}'), '"my key" = 1\n"a.b" = 2\n');
eq('1.0 becomes integer', j2t('{"x":1.0}'), 'x = 1\n');
eq('root array rejected', j2t('[1,2]'), 'ERR Error: stringify can only be called with an object');
eq('null stops the conversion with its path', j2t('{"a":null}'), 'ERR Not converted: TOML cannot hold these values without changing them: /a: null — TOML has no null');
eq('redefinition error', /trying to redefine an already defined table or value/.test(t2j('a = 1\n[a]\nb = 2')), true);
eq('dates become strings', t2j('created = 2026-09-29T10:00:00Z\nday = 2026-09-29'), '{"created":"2026-09-29T10:00:00.000Z","day":"2026-09-29"}');
eq('inf stops the conversion with its path', t2j('ratio = inf'), 'ERR Not converted: JSON cannot hold these values without changing them: /ratio: inf has no JSON form (JSON.stringify would write null)');
eq('large TOML integer rejected', /cannot be represented losslessly/.test(t2j('big = 9007199254740993')), true);
eq('large JSON integer stops the conversion with its path', j2t('{"big":9007199254740993}'), 'ERR Not converted: TOML cannot hold these values without changing them: /big: integer 9007199254740993 is outside ±(2^53 − 1), so JavaScript would round it');
eq('JSON number too large for a double stops the conversion', j2t('{"x":1e400}'), 'ERR Not converted: TOML cannot hold these values without changing them: /x: 1e400 is outside the range of a double-precision number');
eq('What Changes example', t2j('# build settings\ntitle = "x"\ncreated = 2026-09-29T10:00:00Z\nday = 2026-09-29\n\n[server]\nport = 8080'), '{"title":"x","created":"2026-09-29T10:00:00.000Z","day":"2026-09-29","server":{"port":8080}}');
for (const [lang, text] of Object.entries(pages)) {
  const inf = t2j('ratio = inf\n\n[limits]\nmax = nan', lang).replace(/^ERR /, '');
  const nul = j2t('{"user":{"id":9007199254740993,"nickname":null}}', lang).replace(/^ERR /, '');
  eq(lang + ' page quotes the inf / nan stop message', text.includes('`' + inf + '`'), true);
  eq(lang + ' page quotes the null / integer stop message', text.includes('`' + nul + '`'), true);
  eq(lang + ' page example has no inf → null', /"ratio": null/.test(text), false);
}


/* ── real page lifecycle and shared shortcuts ── */
{
  const { createRequire } = await import('node:module');
  const { createHash } = await import('node:crypto');
  const { default: vm } = await import('node:vm');
  const ROOT = root, FILE = 'src/components/tools/TomlJsonTool.astro', SOURCE_FILE = join(ROOT, FILE);
const requireRoot = createRequire(join(ROOT, 'package.json'));
const requirePage = createRequire(join(ROOT, FILE));
const ts = requireRoot('typescript');
const { parseFragment } = requireRoot('parse5');
const source = comp;
const layout = readFileSync(join(ROOT, 'src/layouts/ToolLayout.astro'), 'utf8');
const labelsBlock = source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/);
if (!labelsBlock) throw Error('Production STRINGS block missing');
const STRINGS = vm.runInNewContext(labelsBlock[1] + '\n;STRINGS');
const clientStrings = lang => vm.runInNewContext(source.slice(source.indexOf('// strings:end') + '// strings:end'.length, source.indexOf('\n---', source.indexOf('// strings:end'))) + '\n;CLIENT_T', { STRINGS, lang });
const modules = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
if (modules.length !== 1) throw Error('Expected exactly one complete production module');
const script = modules[0][1];
const js = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Real shared keyboard listener missing');
const hash = value => createHash('sha256').update(value).digest('hex');
const checks = [];
function check(name, actual, expected, regression = false) {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ name, passed, regression, actual, expected });
  console.log((passed ? 'PASS ' : 'FAIL ') + name + (passed ? '' : '\n actual: ' + JSON.stringify(actual) + '\n expected: ' + JSON.stringify(expected)));
}
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
function page(lang = 'en', shellFirst = false, preset = {}, active = null) {
  let document, now = 0, nextTimer = 0;
  const timers = new Map(), copies = [], clears = [], tracks = [];
  function simple(e, selector) {
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const rest = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[\w-]+/.exec(rest)?.[0], id = /#([\w-]+)/.exec(rest)?.[1];
    return (!tag || e.tagName === tag.toUpperCase()) && (!id || e.id === id)
      && [...rest.matchAll(/\.([\w-]+)/g)].every(m => e.classList.contains(m[1]))
      && attrs.every(a => a[2] === undefined ? e.getAttribute(a[1]) !== null : e.getAttribute(a[1]) === a[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(part => {
      const pieces = part.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, pieces.pop())) return false;
      let parent = e.parentNode;
      while (pieces.length) { while (parent && !simple(parent, pieces.at(-1))) parent = parent.parentNode; if (!parent) return false; pieces.pop(); parent = parent.parentNode; }
      return true;
    });
  }
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.value = ''; this.textContent = ''; this.className = ''; this.id = ''; this.disabled = false; this.hidden = false; }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(...cs) { el.className = [...new Set([...el.className.split(/\s+/).filter(Boolean), ...cs])].join(' '); }, remove(...cs) { el.className = el.className.split(/\s+/).filter(c => !cs.includes(c)).join(' '); } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); if (k === 'id') this.id = String(v); if (k === 'disabled') this.disabled = true; if (k === 'hidden') this.hidden = true; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
    getAttribute(k) { return Object.hasOwn(this.attributes, k) ? this.attributes[k] : null; }
    removeAttribute(k) { delete this.attributes[k]; if (k === 'disabled') this.disabled = false; if (k === 'hidden') this.hidden = false; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    contains(c) { return c === this || descendants(this).includes(c); }
    querySelectorAll(s) { return descendants(this).filter(e => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { for (let e = this; e; e = e.parentNode) if (matches(e, s)) return e; return null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    focus() { document.activeElement = this; }
    dispatch(type, init = {}) {
      const e = { type, target: this, currentTarget: this, key: '', ctrlKey: false, metaKey: false, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...init };
      for (let node = this; node; node = node.parentNode) { e.currentTarget = node; for (const fn of node.listeners[type] || []) fn.call(node, e); if (e.stopped) break; }
      return e;
    }
    click() { if (!this.disabled) { this.focus(); return this.dispatch('click'); } }
  }
  document = new Element('#document'); document.documentElement = { lang };
  document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element('section')); widget.className = 'tool-widget';
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0]
    .replace(/data-strings=\{JSON\.stringify\(CLIENT_T\)\}/g, 'data-strings="' + esc(JSON.stringify(clientStrings(lang))) + '"')
    .replace(/data-lang=\{lang\}/g, 'data-lang="' + lang + '"').replace(/\{T\.(\w+)\}/g, (_, k) => esc(STRINGS[lang][k]));
  function append(ast, parent) { for (const node of ast.childNodes || []) { if (!node.tagName) { if (node.nodeName === '#text') parent.textContent += node.value; continue; } const e = parent.appendChild(new Element(node.tagName)); for (const a of node.attrs) e.setAttribute(a.name, a.value); append(node, e); if (e.tagName === 'TEXTAREA') e.value = e.textContent; } }
  append(parseFragment(markup), widget);
  document.getElementById = id => descendants(document).find(e => e.id === id) || null;
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing production ID ' + id); return e; };
  for (const [id, value] of Object.entries(preset)) get(id).value = value;
  if (active) get(active).focus();
  const context = { document, console, exports: {}, module: { exports: {} },
    require: name => requirePage(name), _slug: 'toml-json',
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms = 0) { const id = ++nextTimer; timers.set(id, { fn, ms, due: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    ztPersist: { clear(slug) { clears.push(slug); } }, trackTool(...args) { tracks.push(args); } };
  context.window = context; vm.createContext(context);
  const installShared = () => vm.runInContext(shortcut, context, { filename: 'ToolLayout.shortcuts.js' });
  if (shellFirst) installShared(); vm.runInContext(js, context, { filename: FILE }); if (!shellFirst) installShared();
  function advance(ms) { const end = now + ms; let executions = 0; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]; if (!next) break; if (++executions > 1000) throw Error('Timer runaway'); now = next[1].due; timers.delete(next[0]); next[1].fn(); } now = end; }
  return { get, document, context, copies, clears, tracks, timers, advance,
    input(id, value) { get(id).focus(); get(id).value = value; get(id).dispatch('input'); },
    key(id, key = 'l', modifier = 'ctrlKey') { (id ? get(id) : document.body).focus(); return document.activeElement.dispatch('keydown', { key, [modifier]: true }); },
    copy(id) { get(id).click(); return copies.at(-1); },
    snapshot() { return { toml: get('tj-toml').value, json: get('tj-json').value, status: get('tj-status').textContent, statusClass: get('tj-status').className, copyToml: get('tj-copy-toml').textContent, copyJson: get('tj-copy-json').textContent, disabledToml: get('tj-copy-toml').disabled, disabledJson: get('tj-copy-json').disabled }; } };
}
const TOML = 'name = "demo"\nport = 8080';
const JSON_TEXT = '{"name":"demo","port":8080}';
const JSON_PRETTY = '{\n  "name": "demo",\n  "port": 8080\n}';
const TOML_OUT = TOML + '\n';
const golden = p => { p.input('tj-toml', TOML); p.advance(300); };
const algorithm = script.slice(script.indexOf('    type Result'), script.indexOf('    function syncCopy'));
check('real smol-toml dependency version', JSON.parse(readFileSync(join(ROOT, 'node_modules/smol-toml/package.json'), 'utf8')).version, '1.7.1');
check('protected conversion functions SHA256', hash(algorithm), '806960badfe15aae41c2fc3b11c2e4d062e575a4273700c51b001880b0d0a98f');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const S = STRINGS[lang];
  const p = page(lang); check(lang + ' empty mount has both Copy disabled', [p.get('tj-copy-toml').disabled, p.get('tj-copy-json').disabled], [true, true]);
  golden(p); check(lang + ' actual input TOML→JSON literal', p.get('tj-json').value, JSON_PRETTY);
  p.input('tj-json', JSON_TEXT); p.advance(300); check(lang + ' actual input JSON→TOML literal', p.get('tj-toml').value, TOML_OUT);
  p.input('tj-toml', 'a = 1'); p.advance(300); check(lang + ' automatic TOML input', p.get('tj-json').value, '{\n  "a": 1\n}');
  p.input('tj-json', '{"b":2}'); p.advance(300); check(lang + ' automatic JSON input', p.get('tj-toml').value, 'b = 2\n');
  for (const shellFirst of [false, true]) for (const side of ['toml', 'json']) {
    const k = page(lang, shellFirst), tag = lang + '/' + shellFirst + '/' + side;
    golden(k); k.tracks.length = 0;
    k.input('tj-' + side, side === 'toml' ? 'c = 3' : '{"d":4}'); k.advance(300);
    k.key('tj-' + side, 'Enter', side === 'toml' ? 'ctrlKey' : 'metaKey');
    check(tag + ' shared Enter has no primary action', k.tracks, [], true);
    check(tag + ' Enter preserves automatic output/status', [k.get('tj-toml').value, k.get('tj-json').value, k.get('tj-status').textContent], side === 'toml' ? ['c = 3', '{\n  "c": 3\n}', S.msgTomlToJson] : ['d = 4\n', '{"d":4}', S.msgJsonToToml], side === 'json');
  }
  const restored = page(lang, false, { 'tj-toml': 'a = 1', 'tj-json': '{"b":2}' }, 'tj-json');
  check(lang + ' early input uses focused JSON and leaves no timer', [restored.get('tj-toml').value, restored.get('tj-json').value, restored.timers.size], ['b = 2\n', '{"b":2}', 0]);
  p.input('tj-toml', 'x = inf'); p.advance(300); check(lang + ' real fidelity rejects infinity and drops result', [p.get('tj-json').value, p.get('tj-copy-json').disabled, p.get('tj-status').textContent.includes('/x'), p.get('tj-status').classList.contains('error')], ['', true, true, true]);
  p.input('tj-toml', 'big = 9223372036854775807'); p.advance(300); check(lang + ' real TOML integer precision rejection remains', [p.get('tj-json').value, p.get('tj-copy-json').disabled, p.get('tj-status').textContent.includes('losslessly')], ['', true, true]);
  golden(p); check(lang + ' valid recovery after limits', p.get('tj-json').value, JSON_PRETTY);
  for (const side of ['toml', 'json']) {
    const empty = page(lang); golden(empty);
    check(lang + '/' + side + ' empty-input case starts with valid result', empty.get('tj-json').value, JSON_PRETTY);
    empty.input('tj-' + side, ''); empty.advance(300);
    check(lang + '/' + side + ' empty input drops peer result and Copy state', [empty.get('tj-toml').value, empty.get('tj-json').value, empty.get('tj-status').textContent, empty.get('tj-copy-toml').disabled, empty.get('tj-copy-json').disabled], ['', '', '', true, true], true);
    empty.input('tj-' + side, side === 'toml' ? TOML : JSON_TEXT); empty.advance(300);
    check(lang + '/' + side + ' valid input recovers after empty', empty.get(side === 'toml' ? 'tj-json' : 'tj-toml').value, side === 'toml' ? JSON_PRETTY : TOML_OUT);
  }
  for (const last of ['json', 'toml']) {
    const q = page(lang), firstID = last === 'json' ? 'tj-toml' : 'tj-json', lastID = 'tj-' + last;
    q.input(firstID, last === 'json' ? 'first = 1' : '{"first":1}'); q.advance(50); q.input(lastID, last === 'json' ? '{"last":2}' : 'last = 2'); q.advance(300);
    check(lang + ' last edit wins ' + last, [q.get('tj-toml').value, q.get('tj-json').value], last === 'json' ? ['last = 2\n', '{"last":2}'] : ['last = 2', '{\n  "last": 2\n}'], true);
  }
  const clear = page(lang); golden(clear); clear.input('tj-json', '{"queued":1}'); clear.get('tj-clear').click();
  check(lang + ' Clear immediately clears fields/status/buttons', [clear.get('tj-toml').value, clear.get('tj-json').value, clear.get('tj-status').textContent, clear.get('tj-copy-toml').disabled, clear.get('tj-copy-json').disabled], ['', '', '', true, true]);
  check(lang + ' Clear cancels queued conversion', [...clear.timers.values()].filter(t => t.ms === 300).length, 0, true);
  const cleared = clear.snapshot(); clear.advance(2000); check(lang + ' Clear remains clear after clock', clear.snapshot(), cleared);
  for (const shellFirst of [false, true]) for (const [focus, modifier] of [['tj-toml', 'ctrlKey'], ['tj-copy-json', 'metaKey']]) {
    const q = page(lang, shellFirst); golden(q); q.input('tj-json', '{"queued":1}'); q.key(focus, modifier === 'metaKey' ? 'L' : 'l', modifier);
    const tag = lang + '/' + shellFirst + '/' + focus;
    check(tag + ' real shared key clears both textareas once', [q.get('tj-toml').value, q.get('tj-json').value, q.clears], ['', '', ['toml-json']]);
    check(tag + ' CtrlL clears current status and Copy state immediately', [q.get('tj-status').textContent, q.get('tj-status').className, q.get('tj-copy-toml').disabled, q.get('tj-copy-json').disabled], ['', 'tj-status', true, true], true);
    check(tag + ' CtrlL cancels queued conversion', [...q.timers.values()].filter(t => t.ms === 300).length, 0, true);
    q.advance(2000); check(tag + ' no delayed conversion restores content', [q.get('tj-toml').value, q.get('tj-json').value], ['', '']);
    golden(q); const beforeOutside = q.snapshot(); q.key(null); check(tag + ' outside shortcut unchanged', q.snapshot(), beforeOutside);
  }
  for (const side of ['toml', 'json']) {
    const id = 'tj-copy-' + side, field = 'tj-' + side, q = page(lang); golden(q);
    const missing = page(lang); golden(missing); const savedClipboard = missing.context.navigator.clipboard;
    delete missing.context.navigator.clipboard; let thrown = '';
    try { missing.copy(id); } catch (e) { thrown = String(e.message || e); }
    check(lang + '/' + side + ' unavailable Clipboard API is handled with localized failure', { thrown, localizedError: missing.get('tj-status').classList.contains('error') && typeof S.copyFailed === 'string' && missing.get('tj-status').textContent === S.copyFailed }, { thrown: '', localizedError: true }, true);
    check(lang + '/' + side + ' unavailable Clipboard API preserves result bytes', [missing.get('tj-toml').value, missing.get('tj-json').value], [TOML, JSON_PRETTY]);
    missing.context.navigator.clipboard = savedClipboard; const apiRetry = missing.copy(id);
    check(lang + '/' + side + ' retry after API restoration copies same bytes', apiRetry.value, missing.get(field).value);
    apiRetry.resolve(); await settle(); check(lang + '/' + side + ' retry after API restoration succeeds', missing.get(id).textContent, S.copied);
    const good = q.copy(id); check(lang + '/' + side + ' copy preserves complete bytes', good.value, q.get(field).value); good.resolve(); await settle(); check(lang + '/' + side + ' current copy success', q.get(id).textContent, S.copied); q.advance(1500); check(lang + '/' + side + ' success timer expires normally', q.get(id).textContent, S.copy);
    const beforeStatus = q.get('tj-status').textContent, rejectedBefore = unhandled.length, bad = q.copy(id); bad.reject(Error('controlled current clipboard rejection')); await settle();
    check(lang + '/' + side + ' current rejection handled', unhandled.length - rejectedBefore, 0, true);
    check(lang + '/' + side + ' current rejection visible in page language', q.get('tj-status').classList.contains('error') && q.get('tj-status').textContent !== beforeStatus && typeof S.copyFailed === 'string' && q.get('tj-status').textContent === S.copyFailed, true, true);
    const retry = q.copy(id); check(lang + '/' + side + ' same-result retry retains bytes', retry.value, good.value); retry.resolve(); await settle(); check(lang + '/' + side + ' same-result retry succeeds', q.get(id).textContent, S.copied); check(lang + '/' + side + ' retry clears owned copy error', q.get('tj-status').classList.contains('error'), false, true);
    for (const action of ['input', 'result', 'clear', 'shortcut']) for (const outcome of ['resolve', 'reject']) {
      const r = page(lang); golden(r); const job = r.copy(id), beforeUnhandled = unhandled.length;
      if (action === 'clear') r.get('tj-clear').click(); else if (action === 'shortcut') r.key(id); else { r.input(field, side === 'toml' ? 'new = 3' : '{"new":3}'); if (action === 'result') r.advance(300); }
      const current = r.snapshot(); job[outcome](outcome === 'reject' ? Error('controlled stale clipboard rejection') : undefined); await settle();
      check(lang + '/' + side + ' stale feedback after ' + action + '/' + outcome, r.snapshot(), current, true);
      check(lang + '/' + side + ' stale rejection handled after ' + action + '/' + outcome, unhandled.length - beforeUnhandled, 0, true);
    }
    const t = page(lang); golden(t); t.copy(id).resolve(); await settle(); t.advance(1000); t.copy(id).resolve(); await settle(); t.advance(500);
    check(lang + '/' + side + ' old timer cannot reset newer success', t.get(id).textContent, S.copied, true); t.advance(1000); check(lang + '/' + side + ' latest timer still expires', t.get(id).textContent, S.copy);
    for (const shellFirst of [false, true]) for (const outcome of ['reject', 'resolve']) {
      const overlap = page(lang, shellFirst), tag = lang + '/' + side + '/' + shellFirst + '/same-value/' + outcome;
      golden(overlap);
      const before = overlap.snapshot(), copied = { ...before, [side === 'toml' ? 'copyToml' : 'copyJson']: S.copied };
      const first = overlap.copy(id), latest = overlap.copy(id), rejectedBefore = unhandled.length;
      check(tag + ' two pending requests capture the complete same value', { count: overlap.copies.length, independent: first !== latest, bytes: [first.value, latest.value] }, { count: 2, independent: true, bytes: [overlap.get(field).value, overlap.get(field).value] });
      latest.resolve(); await settle();
      check(tag + ' latest completion preserves content and status', overlap.snapshot(), copied);
      overlap.advance(500); first[outcome](outcome === 'reject' ? Error('controlled older same-value clipboard rejection') : undefined); await settle();
      check(tag + ' older completion cannot overwrite latest feedback or content', overlap.snapshot(), copied, true);
      check(tag + ' older completion leaves no unhandled rejection', unhandled.length - rejectedBefore, 0, true);
      overlap.advance(500); overlap.copy(id).resolve(); await settle();
      check(tag + ' next same-value copy succeeds', overlap.snapshot(), copied, true);
      overlap.advance(500);
      check(tag + ' superseded completion timer cannot reset next success', overlap.snapshot(), copied, true);
      overlap.advance(1000);
      check(tag + ' next success expires on its own deadline', overlap.snapshot(), before, true);
    }
  }
}
/* ── v2 page layout ── */
check('all FIX behavior checks retained before source guard', checks.length, 658);
check('script changes only remove automatic direction buttons and local Enter', hash(script), 'd34debf090093b6f24274ae9c0fd9d991742b1b74379483df8e6faa6f5f220c1');
const PROTECTED_CONTENT = {
  "en": {
    "client": "0147e7fae3155f923662d9b19fab221412ee45c377ea4b1a333cf74cb6761dd6"
  },
  "zh": {
    "client": "ce84157589a4cecc855e453a6ef11286ea0e9ac16655a79b6e73c12b3809977c"
  },
  "ja": {
    "client": "b598c715df15b556f5c5f9e654c502440b2e841ec2806085b3bc2d32e76f1c97"
  },
  "ko": {
    "client": "9b11e6abc94f5f81ba963d54d6d79d1cdb186b282d3240a2473ab99fae667b39"
  }
};
const markup = source.slice(source.indexOf('\n---', source.indexOf('// strings:end')) + 4, source.indexOf('  <script>'));
check('direct flex tool root', /^\s*<div class="tj-wrap"/.test(markup), true);
check('Clear then reserved status then two panes', /class="tj-toolbar"[\s\S]*id="tj-clear"[\s\S]*id="tj-status"[\s\S]*class="tj-panels zt-io"/.test(markup), true);
check('two shared panes and editor fills', [(markup.match(/class="tj-panel zt-io-pane"/g) || []).length, (markup.match(/class="tool-textarea tj-box zt-io-fill"/g) || []).length], [2, 2]);
check('two editable panes always visible', /readonly|hidden|data-empty/.test(markup), false);
check('only Clear and the two Copy buttons remain', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]), ['tj-clear', 'tj-copy-toml', 'tj-copy-json']);
check('five unique actual tips', [...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m => m[1]), ['tj-tip-clear', 'tj-tip-toml', 'tj-tip-copy-toml', 'tj-tip-json', 'tj-tip-copy-json']);
check('tips stay outside interactive labels/buttons', /<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markup), false);
check('obsolete direction buttons and localized labels removed', /tj-to-json|tj-to-toml|tomlToJson:\s*'|jsonToToml:\s*'|btn-primary/.test(markup + labelsBlock[1]), false);
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
check('root has zero minimum width and height', /\.tj-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0;/.test(css), true);
check('status fixed and scrollable', /\.tj-status\s*\{[^}]*height: 2\.6rem;[^}]*flex: none;[^}]*overflow: auto;/.test(css), true);
check('editor content scrolls internally', /\.tj-box\s*\{[^}]*overflow: auto;/.test(css), true);
check('860/640 and phone120px editor/44px controls', /@media \(max-width: 860px\)[\s\S]*height: 180px;[\s\S]*@media \(max-width: 640px\)[\s\S]*min-height: 44px;[\s\S]*height: 120px;/.test(css), true);
check('semantic status theme tokens', /var\(--color-success\)/.test(css) && /var\(--color-danger\)/.test(css), true);
check('no hidden mobile editor', /display:\s*none|visibility:\s*hidden/.test(css), false);
check('convert registry', readFileSync(join(ROOT, 'src/data/tool-layouts.ts'), 'utf8').match(/['"]toml-json['"]\s*:\s*['"]([^'"]+)['"]/)?.[1], 'convert');
const mdxCompiler = await import(requireRoot.resolve('@mdx-js/mdx'));
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const S = STRINGS[lang], payload = clientStrings(lang), expected = PROTECTED_CONTENT[lang];
  check(lang + ' five same tip keys', Object.keys(S.tips), ['toml', 'json', 'copyToml', 'copyJson', 'clear']);
  check(lang + ' tips nonempty plain text within 280 chars', Object.values(S.tips).every(v => typeof v === 'string' && v.length && [...v].length <= 280 && !/[<>]/.test(v)), true);
  check(lang + ' tip placeholders match EN', Object.values(S.tips).map(v => (v.match(/\{\w+\}/g) || []).sort()), Object.values(STRINGS.en.tips).map(v => (v.match(/\{\w+\}/g) || []).sort()));
  check(lang + ' tips excluded from actual client payload', Object.hasOwn(payload, 'tips') || Object.values(S.tips).some(v => JSON.stringify(payload).includes(v)), false);
  check(lang + ' previous client strings retained except direction labels', hash(JSON.stringify(payload)), expected.client);
  for (const shellFirst of [false, true]) for (const side of ['toml', 'json']) {
    const p = page(lang, shellFirst), field = 'tj-' + side, peer = side === 'toml' ? 'tj-json' : 'tj-toml';
    p.input(field, side === 'toml' ? TOML : JSON_TEXT); p.advance(100); p.key(field, 'Enter');
    check(lang + '/' + shellFirst + '/' + side + ' Enter does not rush debounce', p.get(peer).value, '');
    p.advance(200); check(lang + '/' + shellFirst + '/' + side + ' automatic conversion after Enter', p.get(peer).value, side === 'toml' ? JSON_PRETTY : TOML_OUT);
  }
  const content = readFileSync(join(ROOT, 'src/content/tools/toml-json', lang + '.mdx'), 'utf8');
  const [, front, body] = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const fm = requireRoot('js-yaml').load(front);
  check(lang + ' five steps before FAQ', fm.steps.length === 5 && front.indexOf('steps:') < front.indexOf('faqItems:'), true);
  check(lang + ' steps8/280/1200 limits', fm.steps.length <= 8 && fm.steps.every(v => typeof v === 'string' && [...v].length <= 280) && fm.steps.reduce((n, v) => n + [...v].length, 0) <= 1200, true);
  check(lang + ' MDX content contract', contractProblems('toml-json', lang), '');
  // Worked examples, recomputed through the page: TOML → JSON compared as values (the page text
  // may wrap JSON differently), JSON → TOML exactly.
  const tjPairs = examplePairs(body, b => b.lang === 'toml' || b.lang === 'json', b => b.lang === 'toml' || b.lang === 'json').filter(([a, b]) => a.lang !== b.lang);
  check(lang + ' has converted examples', tjPairs.length > 0, true);
  check(lang + ' each converted example equals the page output', tjPairs.filter(([a, b]) => a.lang === 'toml' ? t2j(a.text, lang) !== JSON.stringify(JSON.parse(b.text)) : j2t(a.text, lang) !== b.text + '\n').map(([, b]) => b.text), []);
  let error = ''; try { await mdxCompiler.compile(body); } catch (e) { error = String(e); }
  check(lang + ' actual MDX compiles', error, '');
}
const { transform } = await import(requireRoot.resolve('@astrojs/compiler', { paths: [requireRoot.resolve('astro')] }));
const compiled = await transform(source, { filename: SOURCE_FILE });
check('Astro has no error diagnostics', compiled.diagnostics.filter(d => d.severity === 1), []);
check('one client module retained', compiled.scripts.length, 1);
check('client module has no tips', Object.values(STRINGS).some(S => Object.values(S.tips).some(v => compiled.scripts.some(s => s.code.includes(v)))), false);
let compileError = ''; try { await requireRoot('esbuild').transform(compiled.code, { loader: 'ts', format: 'esm' }); } catch (e) { compileError = String(e); }
check('Astro generated module parses', compileError, '');

await settle(); process.removeListener('unhandledRejection', onUnhandled);
check('component source unchanged during test', hash(readFileSync(SOURCE_FILE, 'utf8')), hash(source));
  passes += checks.filter(c => c.passed).length; failures += checks.filter(c => !c.passed).length;
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
