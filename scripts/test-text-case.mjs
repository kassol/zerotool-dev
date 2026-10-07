// Text Case Converter — word splitting for camelCase / PascalCase / kebab / snake / CONSTANT
//
// Read:  src/components/tools/TextCaseTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: words split at lower→upper and ACRONYM→Word case boundaries, at letter↔digit
// boundaries and at separators (change-case v5 `split` + `separateNumbers`; lodash `words`
// also puts digits in their own word). Before the fix, camelCase input was lowercased as one
// word (userLoginCount → userlogincount) and letters outside a–z were dropped (café → caf).
// Unicode letters, combining marks and digits are kept; apostrophes are removed inside words
// (lodash `reApos`); accents are kept in every format (the tool page does not promise ASCII
// output; the Slugify tool does). Title Case / Sentence case keep the text's own spacing and
// punctuation.
//
// Run: node scripts/test-text-case.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { load as loadYaml } from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/TextCaseTool.astro'), 'utf8');
const { STRINGS: strings, FORMATS: formats } = vm.runInNewContext(source.slice(source.indexOf('const STRINGS ='), source.indexOf('const T = STRINGS[lang')).replace(/\bas const\b/g, '') + '\n({STRINGS, FORMATS});');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in TextCaseTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { converters };')();
const conv = {};
E.converters.forEach((c) => { conv[c.id] = c.fn; });

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
function all(input, expected) {
  Object.keys(expected).forEach((id) => eq(id + '(' + JSON.stringify(input) + ')', conv[id](input), expected[id]));
}

// ---------- the reported defect: camelCase input is one word ----------
all('userLoginCount', {
  camel: 'userLoginCount', pascal: 'UserLoginCount', kebab: 'user-login-count',
  snake: 'user_login_count', constant: 'USER_LOGIN_COUNT',
});
all('UserLoginCount', { camel: 'userLoginCount', snake: 'user_login_count' });
// acronym followed by a word (change-case SPLIT_UPPER_UPPER_RE)
all('XMLHttpRequest', { camel: 'xmlHttpRequest', pascal: 'XmlHttpRequest', kebab: 'xml-http-request', constant: 'XML_HTTP_REQUEST' });
all('parseHTML', { kebab: 'parse-html', camel: 'parseHtml' });
all('USER_LOGIN_COUNT', { camel: 'userLoginCount', kebab: 'user-login-count' });
all('user-login-count', { camel: 'userLoginCount', pascal: 'UserLoginCount', snake: 'user_login_count' });

// ---------- digit boundaries ----------
all('base64Encode', { kebab: 'base-64-encode', camel: 'base64Encode', snake: 'base_64_encode' });
all('version 2 update', { camel: 'version2Update', kebab: 'version-2-update' });
all('2FA code', { kebab: '2-fa-code', constant: '2_FA_CODE' });

// ---------- the reported defect: letters outside a–z dropped ----------
all('café au lait', { camel: 'caféAuLait', pascal: 'CaféAuLait', kebab: 'café-au-lait', snake: 'café_au_lait', constant: 'CAFÉ_AU_LAIT' });
all('Straße Übung', { kebab: 'straße-übung', camel: 'straßeÜbung' });
all('ÉlanVital', { kebab: 'élan-vital', camel: 'élanVital' });
all('Привет мир', { camel: 'приветМир', kebab: 'привет-мир' });
all('用户 登录', { kebab: '用户-登录', snake: '用户_登录' });
// NFD input: the combining acute accent stays with its letter
eq('combining mark kept', conv.kebab('cafe\u0301 noir'), 'cafe\u0301-noir');

// ---------- separators and punctuation ----------
all('  hello,   world!  ', { camel: 'helloWorld', kebab: 'hello-world', snake: 'hello_world' });
all("don't stop", { kebab: 'dont-stop', camel: 'dontStop' });
all('it’s fine', { kebab: 'its-fine' });
all('__init__', { camel: 'init', constant: 'INIT' });
all('!!!', { camel: '', kebab: '', constant: '' });

// ---------- prose formats keep spacing and punctuation ----------
eq('title', conv.title('hello world, élan vital'), 'Hello World, Élan Vital');
eq('title keeps punctuation', conv.title('(hello) world'), '(Hello) World');
eq('sentence', conv.sentence('hello WORLD'), 'Hello world');
eq('upper', conv.upper('café'), 'CAFÉ');
eq('lower', conv.lower('CAFÉ'), 'café');

// ---------- tool page examples ----------
eq('page: title does not split identifiers', conv.title('userLoginCount'), 'Userlogincount');
eq('page: ß in CONSTANT_CASE', conv.constant('Straße'), 'STRASSE');
eq('page: mixed separators', conv.camel('user-login_count'), 'userLoginCount');
eq('page ja: katakana with prolonged sound mark', conv.snake('ユーザー 名'), 'ユーザー_名');
eq('page ko: Hangul', conv.snake('사용자 이름'), '사용자_이름');

// ---------- placeholder sample ----------
all('hello world', {
  upper: 'HELLO WORLD', lower: 'hello world', title: 'Hello World', sentence: 'Hello world',
  camel: 'helloWorld', pascal: 'HelloWorld', kebab: 'hello-world', snake: 'hello_world', constant: 'HELLO_WORLD',
});

// ---------- guide examples (src/content/blog/text-case-guide/{en,ja}.mdx) ----------
// Annotation {/* tc-check: {"input":"…","camel":"…",…} */}: each listed format must equal the
// engine's output, and the value must appear in the page text after the annotation (within
// 4000 characters). Code blocks preceded by {/* tc-run: {"lang":"node|python","expect":"…"} */}
// are run and their stdout must equal "expect"; a missing python3 is a SKIP.
let skips = 0;
{
  const { existsSync, writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  const hasPython = (() => { try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
  for (const lang of ['en', 'ja']) {
    const rel = 'src/content/blog/text-case-guide/' + lang + '.mdx';
    const path = join(root, rel);
    if (!existsSync(path)) { check(rel + ' exists', false); continue; }
    const text = readFileSync(path, 'utf8');
    let count = 0;
    for (const m of text.matchAll(/\{\/\* tc-check: (\{.*?\}) \*\/\}/g)) {
      count++;
      let spec;
      try { spec = JSON.parse(m[1]); } catch (e) { check(rel + ' annotation is JSON', false, m[1]); continue; }
      const after = text.slice(m.index, m.index + 4000);
      for (const id of Object.keys(spec)) {
        if (id === 'input') continue;
        if (!conv[id]) { check(rel + ' unknown format ' + id, false); continue; }
        eq(rel + ' ' + id + '(' + JSON.stringify(spec.input) + ')', conv[id](spec.input), spec[id]);
        check(rel + ' quotes ' + spec[id] + ' after the annotation', after.includes(spec[id]), spec[id]);
      }
    }
    check(rel + ' has tc-check annotations', count >= 10, count);
    let runs = 0;
    for (const m of text.matchAll(/\{\/\* tc-run: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g)) {
      runs++;
      const spec = JSON.parse(m[1]);
      const name = rel + ' ' + spec.lang + ' block ' + runs;
      if (spec.lang === 'python' && !hasPython) { skips++; console.log('SKIP: ' + name + ' — python3 not installed'); continue; }
      const dir = mkdtempSync(join(tmpdir(), 'text-case-run-'));
      try {
        const file = join(dir, spec.lang === 'python' ? 'main.py' : 'main.mjs');
        writeFileSync(file, m[2]);
        const out = execFileSync(spec.lang === 'python' ? 'python3' : process.execPath, [file]).toString();
        eq(name, out.trim(), spec.expect);
        // Comments in the block that show output must match what it printed.
        const shown = [...m[2].matchAll(/^# (.+)$/gm)].map((x) => x[1]).filter((l) => !/[=(]/.test(l));
        if (spec.lang === 'python' && shown.length) eq(name + ' output comments', shown.join('\n'), out.trim());
        const jsShown = [...m[2].matchAll(/console\.log\(.*\); *\/\/ (.+)$/gm)].map((x) => x[1]);
        if (spec.lang === 'node' && jsShown.length) eq(name + ' output comments', jsShown.join('\n'), out.trim());
      } catch (e) {
        check(name, false, String(e.stderr || e.message).slice(0, 300));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    check(rel + ' has runnable code blocks', runs >= 2, runs);
    const tpl = [/^## What (is|are) /mi, /^## .*Online/mi, /^## .* in Code$/mi, /^## (Summary|Conclusion|まとめ)/mi].filter((re) => re.test(text));
    check(rel + ' has no template headings', tpl.length === 0, tpl.map(String));
  }
  const ja = join(root, 'src/content/blog/text-case-guide/ja.mdx');
  if (existsSync(ja)) {
    const text = readFileSync(ja, 'utf8');
    check('ja guide uses the local term キャメルケース', /キャメルケース/.test(text));
    check('ja guide is indexable (noindex removed after the local rewrite)', !/^noindex:\s*true/m.test(text));
  }
}

// ---------- complete page copy lifecycle and the actual shared shortcuts ----------
// Only DOM, clipboard promises and time are controlled. The complete production IIFE
// builds the nine rows and handles every input/click; no converter is replaced.
console.log('existing engine and guide checks: ' + passes + ' passed, ' + failures + ' failed');
const lifecycleStart = { passes, failures };
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("widget.querySelectorAll('textarea")) throw Error('Missing real shared keyboard handler');
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };

function page(lang = 'en', shellFirst = false) {
  const copies = [], clears = [], timers = new Map(), events = {}, tracks = [];
  let now = 0, timerId = 0;
  const doc = { documentElement: { lang }, activeElement: null };
  function matches(el, selector) {
    return selector.split(',').some(s => {
      const parts = s.trim().split(/\s+(?![^\[]*\])/);
      const simple = (e, part) => {
        const attrs = [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
        const bare = part.replace(/\[[^\]]+\]/g, '');
        const tag = /^[\w-]+/.exec(bare), id = /#([\w-]+)/.exec(bare);
        return (!tag || e.tagName === tag[0].toUpperCase()) && (!id || e.id === id[1])
          && [...bare.matchAll(/\.([\w-]+)/g)].every(m => e.className.split(/\s+/).includes(m[1]))
          && attrs.every(m => m[2] === undefined ? e.getAttribute(m[1]) !== null : e.getAttribute(m[1]) === m[2]);
      };
      if (!simple(el, parts.pop())) return false;
      for (let parent = el.parentElement; parts.length;) {
        while (parent && !simple(parent, parts.at(-1))) parent = parent.parentElement;
        if (!parent) return false;
        parts.pop(); parent = parent.parentElement;
      }
      return true;
    });
  }
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, { tagName: tag.toUpperCase(), id: '', type: tag === 'input' ? 'text' : '', className: '', value: '', textContent: '', placeholder: '', readOnly: false, disabled: false, children: [], parentElement: null, attributes: {}, listeners: {} });
    }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'type', 'class', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); }
    getAttribute(k) { return ['id', 'type', 'class'].includes(k) ? this[k === 'class' ? 'className' : k] || null : this.attributes[k] ?? null; }
    appendChild(el) { el.parentElement = this; this.children.push(el); return el; }
    contains(el) { return el === this || this.children.some(child => child.contains(el)); }
    querySelectorAll(s) { return this.children.flatMap(child => [...(matches(child, s) ? [child] : []), ...child.querySelectorAll(s)]); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    dispatch(t) { const e = { type: t, target: this }; for (const fn of this.listeners[t] || []) fn.call(this, e); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element();
  widget.className = 'tool-widget'; body.appendChild(widget);
  const escapeHTML = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0]
    .replace(/\{FORMATS.map\(\(\{ id, label \}\) => \(\n([\s\S]*?)\n        \)\)\}/, (_, template) => formats.map(({ id, label }) => template.replace(/\{`tcase-(row|out)-\$\{id\}`\}/g, (_, part) => '"tcase-' + part + '-' + id + '"').replace(/\{label\}/g, escapeHTML(label))).join('\n'))
    .replace(/<Toggletip\b[\s\S]*?<\/Toggletip>/g, '')
    .replace(/=\{T\.(\w+)\}/g, (_, key) => '="' + escapeHTML(strings[lang][key]) + '"')
    .replace(/\{T\.(\w+)\}/g, (_, key) => escapeHTML(strings[lang][key]));
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[3] !== undefined) { stack.at(-1).textContent += token[3].trim(); continue; }
    if (token[0].startsWith('</')) {
      if (stack.at(-1).tagName !== token[1].toUpperCase()) throw Error('Unexpected markup nesting');
      stack.pop(); continue;
    }
    const el = new Element(token[1]);
    for (const attr of token[2].matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) el.setAttribute(attr[1], attr[2] ?? '');
    stack.at(-1).appendChild(el);
    if (!['input', 'br', 'hr'].includes(token[1])) stack.push(el);
  }
  const get = id => { const el = body.querySelector('#' + id); if (!el) throw Error('Missing actual ID ' + id); return el; };
  Object.assign(doc, {
    body, activeElement: body, getElementById: get, createElement: tag => new Element(tag),
    querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s),
    addEventListener(t, fn) { (events[t] ??= []).push(fn); },
    execCommand() { throw Error('Unexpected native clipboard fallback'); },
  });
  const context = {
    document: doc, console, _slug: 'text-case', ztPersist: { clear: slug => clears.push(slug) },
    t: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(strings[lang]).filter(([key]) => key !== 'tips')))),
    trackTool: (...args) => tracks.push(args),
    navigator: { clipboard: { writeText(value) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      copies.push({ value, resolve, reject }); return promise;
    } } },
    setTimeout(fn, ms = 0) { const id = ++timerId; timers.set(id, { fn, due: now + ms, delay: ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1], context, { filename: 'TextCaseTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return {
    get, doc, body, copies, clears, timers, context, tracks,
    button: id => get('tcase-out-' + id).parentElement.querySelector('button'),
    input(value) { get('tcase-input').value = value; get('tcase-input').dispatch('input'); },
    key(focus, extra = {}) {
      (typeof focus === 'string' ? get(focus) : focus || body).focus();
      const e = { key: 'l', ctrlKey: true, metaKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of events.keydown || []) fn.call(doc, e);
      return e;
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].filter(([, job]) => job.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].due; next[1].fn();
      }
      now = until;
    },
  };
}

const labels = {
  en: ['Copy', 'Copied!', 'Copy failed'], zh: ['复制', '已复制！', '复制失败'],
  ja: ['コピー', 'コピー済み！', 'コピーに失敗'], ko: ['복사', '복사됨!', '복사 실패'],
};
const expected = { upper: 'HELLO WORLD', lower: 'hello world', title: 'Hello World', sentence: 'Hello world', camel: 'helloWorld', pascal: 'HelloWorld', kebab: 'hello-world', snake: 'hello_world', constant: 'HELLO_WORLD' };
const blank = Object.fromEntries(Object.keys(expected).map(id => [id, '']));
const values = p => Object.fromEntries(Object.keys(expected).map(id => [id, p.get('tcase-out-' + id).value]));
const finish = async (copy, outcome) => { if (outcome === 'resolve') copy.resolve(); else copy.reject(Error('controlled copy refusal')); await settle(); };

for (const [lang, [idle, copied, failed]] of Object.entries(labels)) {
  const p = page(lang);
  eq(lang + ' initial outputs empty', values(p), blank);
  p.input('hello world');
  eq(lang + ' real input generates all nine known values', values(p), expected);
  for (const id of Object.keys(expected)) {
    const btn = p.button(id), name = lang + '/' + id;
    eq(name + ' readonly output', p.get('tcase-out-' + id).readOnly, true);
    eq(name + ' localized idle button', btn.textContent, idle);
    btn.click(); eq(name + ' exact clipboard bytes', p.copies.at(-1).value, expected[id]);
    await finish(p.copies.at(-1), 'resolve'); eq(name + ' current copy success', btn.textContent, copied);
    p.advance(1499); eq(name + ' success lasts 1500ms', btn.textContent, copied);
    p.advance(1); eq(name + ' success returns to idle', btn.textContent, idle);
    const rejectionCount = unhandled.length;
    btn.click(); await finish(p.copies.at(-1), 'reject');
    eq(name + ' current rejection handled', unhandled.length, rejectionCount);
    eq(name + ' current rejection visible', btn.textContent, failed);
    btn.click(); await finish(p.copies.at(-1), 'resolve');
    eq(name + ' direct same-result retry recovers', btn.textContent, copied);
    p.advance(1500); eq(name + ' retry finishes idle', btn.textContent, idle);
  }
  p.input(''); eq(lang + ' empty input clears all real conversions', values(p), blank);
  const before = p.copies.length;
  for (const id of Object.keys(expected)) p.button(id).click();
  eq(lang + ' all empty copy buttons do nothing', p.copies.length, before);

  for (const shellFirst of [false, true]) for (const id of Object.keys(expected)) {
    for (const action of ['input', 'empty', 'ctrl-l', 'meta-L']) for (const outcome of ['resolve', 'reject']) {
      const q = page(lang, shellFirst), btn = q.button(id), name = lang + '/' + id + '/' + shellFirst + '/' + action + '/' + outcome;
      q.input('hello world'); btn.click(); const pending = q.copies.at(-1), rejected = unhandled.length;
      if (action === 'input') q.input('new text');
      else if (action === 'empty') q.input('');
      else q.key(action === 'ctrl-l' ? 'tcase-input' : 'tcase-out-' + id, action === 'meta-L' ? { ctrlKey: false, metaKey: true, key: 'L' } : {});
      const after = values(q);
      if (action !== 'input') eq(name + ' cleared outputs remain normal', after, blank);
      await finish(pending, outcome);
      eq(name + ' stale completion leaves copy idle', btn.textContent, idle);
      eq(name + ' stale completion preserves current output', values(q), after);
      eq(name + ' stale rejection handled', unhandled.length, rejected);
      q.advance(5000); eq(name + ' no stale timer feedback', btn.textContent, idle);
    }
    for (const order of [[0, 1], [1, 0]]) for (const oldOutcome of ['resolve', 'reject']) for (const newOutcome of ['resolve', 'reject']) {
      const q = page(lang, shellFirst), btn = q.button(id), name = lang + '/' + id + '/overlap/' + shellFirst + '/' + order + '/' + oldOutcome + '/' + newOutcome;
      q.input('hello world'); btn.click(); btn.click(); const rejected = unhandled.length;
      for (const i of order) await finish(q.copies[i], i === 0 ? oldOutcome : newOutcome);
      eq(name + ' only newest request owns feedback', btn.textContent, newOutcome === 'resolve' ? copied : failed);
      eq(name + ' all copy rejections handled', unhandled.length, rejected);
      eq(name + ' copies keep source bytes', q.copies.map(job => job.value), [expected[id], expected[id]]);
    }
    {
      const q = page(lang, shellFirst), btn = q.button(id), name = lang + '/' + id + '/timer/' + shellFirst;
      q.input('hello world'); btn.click(); await finish(q.copies[0], 'resolve');
      const firstTimer = [...q.timers.values()].find(job => job.delay === 1500);
      check(name + ' success schedules feedback expiry', !!firstTimer);
      q.advance(500); btn.click(); await finish(q.copies[1], 'resolve');
      q.advance(1000); eq(name + ' first deadline cannot clear newer success', btn.textContent, copied);
      firstTimer?.fn(); eq(name + ' already queued old callback cannot clear newer success', btn.textContent, copied);
      q.advance(500); eq(name + ' newest timer restores localized idle', btn.textContent, idle);
      btn.click(); await finish(q.copies[2], 'resolve');
      const staleTimer = [...q.timers.values()].find(job => job.delay === 1500);
      q.input('new text'); btn.click(); await finish(q.copies[3], 'reject');
      staleTimer?.fn(); eq(name + ' timer from prior input cannot erase new failure', btn.textContent, failed);
    }
  }
  for (const shellFirst of [false, true]) {
    const q = page(lang, shellFirst);
    q.input('hello world'); q.button('upper').click(); q.button('lower').click();
    await finish(q.copies[1], 'resolve'); await finish(q.copies[0], 'reject');
    eq(lang + '/rows independent/' + shellFirst, [q.button('upper').textContent, q.button('lower').textContent], [failed, copied]);
    const beforeValues = values(q);
    q.key(q.body); eq(lang + ' shortcut outside tool preserves results/' + shellFirst, values(q), beforeValues);
    q.key('tcase-input', { ctrlKey: false }); eq(lang + ' plain l preserves results/' + shellFirst, values(q), beforeValues);
    q.key('tcase-input', { key: 'Enter' }); eq(lang + ' no primary CtrlEnter action/' + shellFirst, values(q), beforeValues);
    q.key(q.button('lower'));
    eq(lang + ' shortcut from copy clears fields/' + shellFirst, values(q), blank);
    eq(lang + ' shortcut resets all copy feedback/' + shellFirst, Object.keys(expected).map(id => q.button(id).textContent), Object.keys(expected).map(() => idle));
    eq(lang + ' shortcut preserves persistence clear/' + shellFirst, q.clears, ['text-case']);
  }
  for (const mode of ['throw', 'missing']) {
    const q = page(lang); q.input('hello world');
    if (mode === 'missing') q.context.navigator.clipboard = undefined;
    else q.context.navigator.clipboard.writeText = () => { throw Error('controlled synchronous denial'); };
    let thrown = false; try { q.button('upper').click(); } catch { thrown = true; }
    eq(lang + '/' + mode + ' denial handled', thrown, false);
    eq(lang + '/' + mode + ' denial visible', q.button('upper').textContent, failed);
  }
}
await settle();
process.off('unhandledRejection', onUnhandled);
console.log('page lifecycle: ' + (passes - lifecycleStart.passes) + ' passed, ' + (failures - lifecycleStart.failures) + ' failed');

// ---------- v2 page layout ----------
{
  const before = { passes, failures };
  const markup = source.split('\n---\n')[1].split('<script')[0];
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const css = source.split('<style is:global>')[1];
  const sha = value => createHash('sha256').update(value).digest('hex');
  const retained = {
    en: { frontmatter: '5599a09054fc0549bf7c93a84ce4615cc4f27e9e0b318546fc7c87d7e4cbd791', bodyWithoutUsage: '0496eb63d3207212cd03443c218856230f4d463841bc70cffe6fd1e7e65da4d9' },
    zh: { frontmatter: '3594faa8c1b7d3a60faebe8e9dfb5fa88728c9d42e3f211cc6248a50ee082af8', bodyWithoutUsage: 'c1139df342fd88a57bc11f632d08b278ebabd4b9ebd6d1f6b02e01cceb7d846a' },
    ja: { frontmatter: '8cfd3e14f11f6e42914e5249f49d7e847e07f9de10625b24dca4679ab316cdfb', bodyWithoutUsage: '90c91aaef436500e0f6ceb2496e2acb4a1f48761d2ddf36f8ec8c740353968f6' },
    ko: { frontmatter: '46fa839fecc65e360010f36fd8b3fb5c42140fbc433bec6bead77f1273927786', bodyWithoutUsage: '2aff1500ed2eeb7caa0aa26edf4d25ee132a1765442a9cc873ccc948a7e96f9b' },
  };
  check('v2 outermost element is tool root', /^\s*<div class="tcase-wrap">/.test(markup));
  check('v2 root flex column can shrink', /\.tcase-wrap \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0;/.test(css));
  for (const cls of ['zt-io', 'zt-io-pane', 'zt-io-fill']) check('v2 shared ' + cls, markup.includes(cls));
  check('v2 input precedes output', markup.indexOf('id="tcase-input"') < markup.indexOf('id="tcase-results"'));
  check('v2 1:2 desktop columns', css.includes('grid-template-columns: minmax(0, 1fr) minmax(0, 2fr)'));
  check('v2 output list scrolls within a bounded flex fill', markup.includes('class="tcase-cases zt-io-fill"') && /\.tcase-cases \{ overflow: auto;/.test(css));
  check('v2 result inputs retain horizontal scrolling', script.includes("out.type = 'text'") && script.includes('out.readOnly = true') && /\.tcase-case-output \{[^}]*min-width: 0;/.test(css));
  check('v2 no new Generate, Clear or status operation', !/btn-primary|tcase-clear|tcase-generate|tcase-status/.test(source));
  check('v2 hidden contract', /\.tcase-wrap \[hidden\] \{ display: none !important;/.test(css));
  check('v2 stack and phone breakpoints', css.includes('(max-width: 860px)') && css.includes('(max-width: 640px)'));
  check('v2 empty output hidden when stacked', /@media \(max-width: 860px\)[\s\S]*?\.tcase-results\[data-empty="true"\] \{ display: none;/.test(css));
  check('v2 mobile input and list have explicit bounded heights', /\.tcase-input \{ height: 120px;/.test(css) && /\.tcase-cases \{ height: 360px;/.test(css));
  check('v2 copy width reserved for all feedback states', /grid-template-columns: minmax\(0, 1fr\) 7\.5rem/.test(css) && /\.tcase-output-row \.btn-copy \{[^}]*width: 7\.5rem;/.test(css));
  check('v2 mobile copy touch target at least 44px', /@media \(max-width: 640px\)[\s\S]*?\.tcase-output-row \.btn-copy \{ min-height: 44px;/.test(css));
  check('v2 format labels can wrap without shrinking tips', /\.tcase-case-label \{[^}]*overflow-wrap: anywhere;/.test(css) && /\.tcase-case-heading \{[^}]*min-width: 0;/.test(css));
  const guideCss = readFileSync(new URL('../src/layouts/ToolLayout.astro', import.meta.url), 'utf8').match(/\.tool-guide-link--inline\s*\{([^}]+)\}/)[1];
  check('v2 guide label and title wrap onto separate lines', /flex-wrap:\s*wrap/.test(guideCss));
  check('v2 Korean guide title can break its long case-name sequence', /overflow-wrap:\s*anywhere/.test(guideCss));
  check('v2 dynamic output and Copy styles remain global', source.includes('<style is:global>'));
  check('v2 converted build-time i18n', !source.includes('data-i18n') && !script.includes('STRINGS') && !script.includes('document.documentElement.lang'));
  check('v2 only CLIENT_T reaches script', source.includes('const { tips: TIPS, ...CLIENT_T } = T;') && source.includes('define:vars={{ t: CLIENT_T }}'));
  eq('v2 static row order/IDs/labels match actual engine converters', formats.map(({ id, label }) => ({ id, label })), E.converters.map(({ id, label }) => ({ id, label })));
  check('v2 per-format labels bind actual output IDs', markup.includes('for={`tcase-out-${id}`}'));
  check('v2 exactly ten tip instances', markup.includes('id="tcase-tip-input"') && markup.includes('id={`tcase-tip-${id}`}') && formats.length === 9 && (markup.match(/<Toggletip\b/g) || []).length === 2);
  check('v2 format tips include their own rules and row copy fact', markup.includes('<p>{TIPS[id]}</p><p>{TIPS.copy}</p>'));
  check('v2 registered convert kind', /'text-case':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  for (const lang of Object.keys(labels)) {
    const T = strings[lang], { tips, ...client } = T;
    eq(lang + ' complete localized keys', Object.keys(T).sort(), Object.keys(strings.en).sort());
    eq(lang + ' complete localized tip keys', Object.keys(tips).sort(), ['input', 'copy', ...Object.keys(expected)].sort());
    for (const [key, text] of Object.entries(tips)) {
      check(lang + ' nonempty plain-text tip ' + key, typeof text === 'string' && text.trim().length > 0 && !/<[^>]*>/.test(text));
      check(lang + ' tip excluded from client ' + key, !JSON.stringify(client).includes(text));
    }
    const mdx = readFileSync(join(root, 'src/content/tools/text-case/' + lang + '.mdx'), 'utf8');
    const at = mdx.indexOf('\n---\n'), meta = mdx.slice(0, at), body = mdx.slice(at + 5), { steps } = loadYaml(meta.slice(4));
    eq(lang + ' four steps', steps.length, 4);
    check(lang + ' step size and plain text', steps.every(step => typeof step === 'string' && step.length <= 280 && !/<[^>]*>/.test(step)) && steps.join('').length <= 1200);
    for (const key of ['inputText', 'output', 'copy', 'copyFailed']) check(lang + ' steps use actual ' + key, steps.some(step => step.includes(T[key])));
    eq(lang + ' original SEO/FAQ unchanged', sha(meta.replace(/^steps:\n(?:  .*\n)*/m, '')), retained[lang].frontmatter);
    eq(lang + ' non-Usage body unchanged', sha(body), retained[lang].bodyWithoutUsage);
    check(lang + ' Usage removed', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
    check(lang + ' Limits retained', /<h2>(?:Limitations|限制|制限事項|제한 사항)<\/h2>/.test(body));
    for (const shellFirst of [false, true]) {
      const p = page(lang, shellFirst), pane = p.get('tcase-results');
      eq(lang + '/' + shellFirst + ' initial result empty flag', pane.getAttribute('data-empty'), 'true');
      p.input('hello world'); eq(lang + '/' + shellFirst + ' input shows results immediately', pane.getAttribute('data-empty'), 'false');
      for (const { id, label } of formats) {
        eq(lang + '/' + shellFirst + ' row label ' + id, p.doc.querySelector('[for="tcase-out-' + id + '"]').textContent, label);
        eq(lang + '/' + shellFirst + ' static row owns its dynamic output ' + id, p.get('tcase-out-' + id).parentElement.id, 'tcase-row-' + id);
      }
      p.input(''); eq(lang + '/' + shellFirst + ' empty input restores empty flag', pane.getAttribute('data-empty'), 'true');
      p.input('hello world'); p.key('tcase-out-upper'); eq(lang + '/' + shellFirst + ' real CtrlL restores empty flag', pane.getAttribute('data-empty'), 'true');
    }
  }
  const require = createRequire(import.meta.url);
  const { transform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const { transform: parseJs } = await import('esbuild');
  const compiled = await transform(source, { filename: 'TextCaseTool.astro' });
  eq('v2 Astro compiler reports no errors', compiled.diagnostics.filter(d => d.severity === 1).length, 0);
  await parseJs(compiled.code, { loader: 'ts', format: 'esm' });
  check('v2 generated JS parses and serializes CLIENT_T', compiled.code.includes('$$defineScriptVars({ t: CLIENT_T })'));
  console.log('v2 page layout: ' + (passes - before.passes) + ' passed, ' + (failures - before.failures) + ' failed');
}
console.log(passes + ' passed, ' + failures + ' failed' + (skips ? ', ' + skips + ' skipped' : ''));
process.exit(failures ? 1 : 0);
