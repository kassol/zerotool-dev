// YAML ↔ JSON — real page lifecycle and conversion regressions
//
// Read:  src/components/tools/YamlJsonTool.astro; its real js-yaml, conversion-fidelity.js
//        and yaml-limits.js dependencies; src/layouts/ToolLayout.astro keyboard listener.
// Write: stdout only. DOM, clock and clipboard boundaries run in memory.
// Exit:  0 if all PASS, 1 if any FAIL. No browser, network or system clipboard.
// Run:   node scripts/test-yaml-json.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FILE = 'src/components/tools/YamlJsonTool.astro';
const SOURCE_FILE = join(ROOT, FILE);
const requireRoot = createRequire(join(ROOT, 'package.json'));
const requirePage = createRequire(join(ROOT, FILE));
const ts = requireRoot('typescript');
const { parseFragment } = requireRoot('parse5');
const source = readFileSync(SOURCE_FILE, 'utf8');
const layout = readFileSync(join(ROOT, 'src/layouts/ToolLayout.astro'), 'utf8');
const labelsBlock = source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/);
if (!labelsBlock) throw Error('Production STRINGS block missing');
const STRINGS = vm.runInNewContext(labelsBlock[1] + '\n;STRINGS');
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
    .replace(/data-strings=\{JSON\.stringify\(T\)\}/g, 'data-strings="' + esc(JSON.stringify(STRINGS[lang])) + '"')
    .replace(/data-lang=\{lang\}/g, 'data-lang="' + lang + '"').replace(/\{T\.(\w+)\}/g, (_, k) => esc(STRINGS[lang][k]));
  function append(ast, parent) { for (const node of ast.childNodes || []) { if (!node.tagName) { if (node.nodeName === '#text') parent.textContent += node.value; continue; } const e = parent.appendChild(new Element(node.tagName)); for (const a of node.attrs) e.setAttribute(a.name, a.value); append(node, e); if (e.tagName === 'TEXTAREA') e.value = e.textContent; } }
  append(parseFragment(markup), widget);
  document.getElementById = id => descendants(document).find(e => e.id === id) || null;
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing production ID ' + id); return e; };
  for (const [id, value] of Object.entries(preset)) get(id).value = value;
  if (active) get(active).focus();
  const context = { document, console, exports: {}, module: { exports: {} },
    require: name => requirePage(name), _slug: 'yaml-json',
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
    snapshot() { return { yaml: get('yj-yaml').value, json: get('yj-json').value, status: get('yj-status').textContent, statusClass: get('yj-status').className, copyYaml: get('yj-copy-yaml').textContent, copyJson: get('yj-copy-json').textContent, disabledYaml: get('yj-copy-yaml').disabled, disabledJson: get('yj-copy-json').disabled }; } };
}
const YAML = 'name: demo\nport: 8080';
const JSON_TEXT = '{"name":"demo","port":8080}';
const JSON_PRETTY = '{\n  "name": "demo",\n  "port": 8080\n}';
const YAML_OUT = YAML + '\n';
const golden = p => { p.input('yj-yaml', YAML); p.advance(300); };
const algorithm = script.slice(script.indexOf('    const YAML_SCHEMA'), script.indexOf('    function syncCopy'));
check('real js-yaml dependency version', requireRoot('js-yaml/package.json').version, '4.3.2');
check('protected conversion functions SHA256', hash(algorithm), '2d6d910b78a6579d4f1e6b75f88cbf6090f173177926f3fa021ff27c3b61b5ca');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const S = STRINGS[lang];
  const p = page(lang); check(lang + ' empty mount has both Copy disabled', [p.get('yj-copy-yaml').disabled, p.get('yj-copy-json').disabled], [true, true]);
  golden(p); check(lang + ' actual input YAML→JSON literal', p.get('yj-json').value, JSON_PRETTY);
  p.input('yj-json', JSON_TEXT); p.advance(300); check(lang + ' actual input JSON→YAML literal', p.get('yj-yaml').value, YAML_OUT);
  p.get('yj-yaml').value = 'a: 1'; p.get('yj-to-json').click(); check(lang + ' retained YAML button', p.get('yj-json').value, '{\n  "a": 1\n}');
  p.get('yj-json').value = '{"b":2}'; p.get('yj-to-yaml').click(); check(lang + ' retained JSON button', p.get('yj-yaml').value, 'b: 2\n');
  for (const shellFirst of [false, true]) for (const side of ['yaml', 'json']) {
    const k = page(lang, shellFirst), tag = lang + '/' + shellFirst + '/' + side;
    golden(k); k.tracks.length = 0;
    k.get('yj-' + side).value = side === 'yaml' ? 'c: 3' : '{"d":4}';
    k.key('yj-' + side, 'Enter', side === 'yaml' ? 'ctrlKey' : 'metaKey');
    check(tag + ' bubbling Enter runs only requested direction', k.tracks, [['yaml_json', side === 'yaml' ? 'yaml_to_json' : 'json_to_yaml']], true);
    check(tag + ' bubbling Enter preserves source and requested output/status', [k.get('yj-yaml').value, k.get('yj-json').value, k.get('yj-status').textContent], side === 'yaml' ? ['c: 3', '{\n  "c": 3\n}', S.convertedYamlToJson] : ['d: 4\n', '{"d":4}', S.convertedJsonToYaml], side === 'json');
  }
  const restored = page(lang, false, { 'yj-yaml': 'a: 1', 'yj-json': '{"b":2}' }, 'yj-json');
  check(lang + ' early input uses focused JSON and leaves no timer', [restored.get('yj-yaml').value, restored.get('yj-json').value, restored.timers.size], ['b: 2\n', '{"b":2}', 0]);
  p.input('yj-yaml', 'x: .inf'); p.advance(300); check(lang + ' real fidelity rejects infinity and drops result', [p.get('yj-json').value, p.get('yj-copy-json').disabled, p.get('yj-status').textContent.includes('/x'), p.get('yj-status').classList.contains('error')], ['', true, true, true]);
  p.input('yj-yaml', 'a: ' + '['.repeat(101) + ']'.repeat(101)); p.advance(300); check(lang + ' real YAML limit remains localized', [p.get('yj-json').value, p.get('yj-copy-json').disabled, p.get('yj-status').textContent.includes('100'), /maxDepth/.test(p.get('yj-status').textContent)], ['', true, true, false]);
  golden(p); check(lang + ' valid recovery after limits', p.get('yj-json').value, JSON_PRETTY);
  for (const side of ['yaml', 'json']) {
    const empty = page(lang); golden(empty);
    check(lang + '/' + side + ' empty-input case starts with valid result', empty.get('yj-json').value, JSON_PRETTY);
    empty.input('yj-' + side, ''); empty.advance(300);
    check(lang + '/' + side + ' empty input drops peer result and Copy state', [empty.get('yj-yaml').value, empty.get('yj-json').value, empty.get('yj-status').textContent, empty.get('yj-copy-yaml').disabled, empty.get('yj-copy-json').disabled], ['', '', '', true, true], true);
    empty.input('yj-' + side, side === 'yaml' ? YAML : JSON_TEXT); empty.advance(300);
    check(lang + '/' + side + ' valid input recovers after empty', empty.get(side === 'yaml' ? 'yj-json' : 'yj-yaml').value, side === 'yaml' ? JSON_PRETTY : YAML_OUT);
  }
  for (const last of ['json', 'yaml']) {
    const q = page(lang), firstID = last === 'json' ? 'yj-yaml' : 'yj-json', lastID = 'yj-' + last;
    q.input(firstID, last === 'json' ? 'first: 1' : '{"first":1}'); q.advance(50); q.input(lastID, last === 'json' ? '{"last":2}' : 'last: 2'); q.advance(300);
    check(lang + ' last edit wins ' + last, [q.get('yj-yaml').value, q.get('yj-json').value], last === 'json' ? ['last: 2\n', '{"last":2}'] : ['last: 2', '{\n  "last": 2\n}'], true);
  }
  const clear = page(lang); golden(clear); clear.input('yj-json', '{"queued":1}'); clear.get('yj-clear').click();
  check(lang + ' Clear immediately clears fields/status/buttons', [clear.get('yj-yaml').value, clear.get('yj-json').value, clear.get('yj-status').textContent, clear.get('yj-copy-yaml').disabled, clear.get('yj-copy-json').disabled], ['', '', '', true, true]);
  check(lang + ' Clear cancels queued conversion', [...clear.timers.values()].filter(t => t.ms === 300).length, 0, true);
  const cleared = clear.snapshot(); clear.advance(2000); check(lang + ' Clear remains clear after clock', clear.snapshot(), cleared);
  for (const shellFirst of [false, true]) for (const [focus, modifier] of [['yj-yaml', 'ctrlKey'], ['yj-copy-json', 'metaKey']]) {
    const q = page(lang, shellFirst); golden(q); q.input('yj-json', '{"queued":1}'); q.key(focus, modifier === 'metaKey' ? 'L' : 'l', modifier);
    const tag = lang + '/' + shellFirst + '/' + focus;
    check(tag + ' real shared key clears both textareas once', [q.get('yj-yaml').value, q.get('yj-json').value, q.clears], ['', '', ['yaml-json']]);
    check(tag + ' CtrlL clears current status and Copy state immediately', [q.get('yj-status').textContent, q.get('yj-status').className, q.get('yj-copy-yaml').disabled, q.get('yj-copy-json').disabled], ['', 'yj-status', true, true], true);
    check(tag + ' CtrlL cancels queued conversion', [...q.timers.values()].filter(t => t.ms === 300).length, 0, true);
    q.advance(2000); check(tag + ' no delayed conversion restores content', [q.get('yj-yaml').value, q.get('yj-json').value], ['', '']);
    golden(q); const beforeOutside = q.snapshot(); q.key(null); check(tag + ' outside shortcut unchanged', q.snapshot(), beforeOutside);
  }
  for (const side of ['yaml', 'json']) {
    const id = 'yj-copy-' + side, field = 'yj-' + side, q = page(lang); golden(q);
    const missing = page(lang); golden(missing); const savedClipboard = missing.context.navigator.clipboard;
    delete missing.context.navigator.clipboard; let thrown = '';
    try { missing.copy(id); } catch (e) { thrown = String(e.message || e); }
    check(lang + '/' + side + ' unavailable Clipboard API is handled with localized failure', { thrown, localizedError: missing.get('yj-status').classList.contains('error') && typeof S.copyFailed === 'string' && missing.get('yj-status').textContent === S.copyFailed }, { thrown: '', localizedError: true }, true);
    check(lang + '/' + side + ' unavailable Clipboard API preserves result bytes', [missing.get('yj-yaml').value, missing.get('yj-json').value], [YAML, JSON_PRETTY]);
    missing.context.navigator.clipboard = savedClipboard; const apiRetry = missing.copy(id);
    check(lang + '/' + side + ' retry after API restoration copies same bytes', apiRetry.value, missing.get(field).value);
    apiRetry.resolve(); await settle(); check(lang + '/' + side + ' retry after API restoration succeeds', missing.get(id).textContent, S.copied);
    const good = q.copy(id); check(lang + '/' + side + ' copy preserves complete bytes', good.value, q.get(field).value); good.resolve(); await settle(); check(lang + '/' + side + ' current copy success', q.get(id).textContent, S.copied); q.advance(1500); check(lang + '/' + side + ' success timer expires normally', q.get(id).textContent, S.copy);
    const beforeStatus = q.get('yj-status').textContent, rejectedBefore = unhandled.length, bad = q.copy(id); bad.reject(Error('controlled current clipboard rejection')); await settle();
    check(lang + '/' + side + ' current rejection handled', unhandled.length - rejectedBefore, 0, true);
    check(lang + '/' + side + ' current rejection visible in page language', q.get('yj-status').classList.contains('error') && q.get('yj-status').textContent !== beforeStatus && typeof S.copyFailed === 'string' && q.get('yj-status').textContent === S.copyFailed, true, true);
    const retry = q.copy(id); check(lang + '/' + side + ' same-result retry retains bytes', retry.value, good.value); retry.resolve(); await settle(); check(lang + '/' + side + ' same-result retry succeeds', q.get(id).textContent, S.copied); check(lang + '/' + side + ' retry clears owned copy error', q.get('yj-status').classList.contains('error'), false, true);
    for (const action of ['input', 'result', 'clear', 'shortcut']) for (const outcome of ['resolve', 'reject']) {
      const r = page(lang); golden(r); const job = r.copy(id), beforeUnhandled = unhandled.length;
      if (action === 'clear') r.get('yj-clear').click(); else if (action === 'shortcut') r.key(id); else { r.input(field, side === 'yaml' ? 'new: 3' : '{"new":3}'); if (action === 'result') r.advance(300); }
      const current = r.snapshot(); job[outcome](outcome === 'reject' ? Error('controlled stale clipboard rejection') : undefined); await settle();
      check(lang + '/' + side + ' stale feedback after ' + action + '/' + outcome, r.snapshot(), current, true);
      check(lang + '/' + side + ' stale rejection handled after ' + action + '/' + outcome, unhandled.length - beforeUnhandled, 0, true);
    }
    const t = page(lang); golden(t); t.copy(id).resolve(); await settle(); t.advance(1000); t.copy(id).resolve(); await settle(); t.advance(500);
    check(lang + '/' + side + ' old timer cannot reset newer success', t.get(id).textContent, S.copied, true); t.advance(1000); check(lang + '/' + side + ' latest timer still expires', t.get(id).textContent, S.copy);
    for (const shellFirst of [false, true]) for (const outcome of ['reject', 'resolve']) {
      const overlap = page(lang, shellFirst), tag = lang + '/' + side + '/' + shellFirst + '/same-value/' + outcome;
      golden(overlap);
      const before = overlap.snapshot(), copied = { ...before, [side === 'yaml' ? 'copyYaml' : 'copyJson']: S.copied };
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
await settle(); process.removeListener('unhandledRejection', onUnhandled);
check('component source unchanged during test', hash(readFileSync(SOURCE_FILE, 'utf8')), hash(source));
const counts = { passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length, total: checks.length };
const report = { node: process.version, component: FILE, sourceSHA256: hash(source), protectedAlgorithmSHA256: hash(algorithm), actualSharedKeyboard: true, browserVerified: false, counts };
console.log('\n' + JSON.stringify(report));
process.exitCode = counts.failed ? 1 : 0;
