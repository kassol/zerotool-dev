// UUID Generator — page script against a stand-in DOM
//
// Read:  src/components/tools/UuidGeneratorTool.astro (runs the inline page script against a small
//        stand-in for the elements it reads), src/content/tools/uuid-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: one UUID on load; every generated value is a lowercase RFC 9562 version 4 UUID; the
// batch count is clamped to 1–100, decimals are cut off, an empty or non-numeric count gives 5 and
// 0 gives 1 (0 used to give 5 because `parseInt(...) || 5` treated 0 as missing); the UUIDs and the
// version / variant digits quoted on the English page; the English guide
// (src/content/blog/uuid-generator-guide/en.mdx): the generator value it dissects, the RFC 9562
// test vectors in the versions table (v3, v5 and the SHA-256 v8 example are recomputed from the
// DNS namespace), the collision table and figures, and code blocks marked
// {/* uuid-run: {"lang":"node|python","expect":"…"} */} are run (python3 missing: SKIP).
//
// Run: node scripts/test-uuid-generator.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/UuidGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/uuid-generator/en.mdx'), 'utf8');
const scriptMatch = /<script is:inline>([\s\S]*?)<\/script>/.exec(source);
if (!scriptMatch) {
  console.error('FAIL: could not locate the page script in UuidGeneratorTool.astro');
  process.exit(1);
}

function makePage() {
  const els = {};
  function el(id) {
    if (!els[id]) {
      const handlers = {};
      els[id] = {
        id, value: '', textContent: '', placeholder: '',
        classList: { add() {}, remove() {} },
        addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
        fire(type) { (handlers[type] || []).forEach((fn) => fn.call(els[id], { target: els[id] })); },
      };
    }
    return els[id];
  }
  const document = { documentElement: { lang: 'en' }, getElementById: el, querySelectorAll() { return []; }, querySelector() { return { contains() { return true; } }; }, addEventListener() {} };
  new Function('document', 'window', 'crypto', 'navigator', scriptMatch[1])(document, {}, webcrypto, {});
  return el;
}

let failures = 0;
let passes = 0;
let skips = 0;
function skip(name, why) { skips++; console.log('SKIP: ' + name + ' (' + why + ')'); }
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let el = makePage();
eq('UUID on load', V4.test(el('uuid-output').textContent), true);
const first = el('uuid-output').textContent;
el('uuid-generate').fire('click');
eq('Generate gives a new v4 UUID', V4.test(el('uuid-output').textContent) && el('uuid-output').textContent !== first, true);

for (const [count, expected] of [['5', 5], ['1', 1], ['100', 100], ['250', 100], ['0', 1], ['-3', 1], ['2.9', 2], ['', 5], ['abc', 5]]) {
  el = makePage();
  el('uuid-count').value = count;
  el('uuid-batch-gen').fire('click');
  const lines = el('uuid-batch-output').value.split('\n');
  eq('batch count ' + JSON.stringify(count), lines.length, expected);
  eq('batch ' + JSON.stringify(count) + ' all v4', lines.every((l) => V4.test(l)), true);
  eq('batch ' + JSON.stringify(count) + ' no duplicates', new Set(lines).size, lines.length);
}

// UUIDs quoted on the English page are well-formed v4 values
const quoted = page.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [];
eq('page quotes 4 UUIDs', quoted.length, 4);
for (const u of quoted) eq('page UUID ' + u + ' is v4', V4.test(u), true);
const dissected = 'd4b151b4-c1d3-41ac-9d4c-d413b112aaa1';
eq('13th digit', dissected.replace(/-/g, '')[12], '4');
eq('17th digit', dissected.replace(/-/g, '')[16], '9');
eq('17th digit bits', parseInt('9', 16).toString(2), '1001');
eq('remaining digits', dissected.replace(/-/g, '').split('').filter((_, i) => i !== 12 && i !== 16).join(''), 'd4b151b4c1d31acd4cd413b112aaa1');
eq('page remaining digits', page.includes('<code>d4b151b4 c1d3 1ac d4c d413b112aaa1</code>'), true);

// birthday-bound numbers on the page
const n50 = Math.sqrt(2 * Math.LN2 * 2 ** 122);
eq('50% at about 2.7e18', n50.toExponential(1), '2.7e+18');
eq('86 years at 1e9/s', Math.round(n50 / 1e9 / (365.25 * 86400)), 86);
eq('103 trillion: about 1e-9', (1 - Math.exp(-(103e12 ** 2) / 2 / 2 ** 122)).toExponential(0), '1e-9');

// guide
{
  const guide = readFileSync(join(root, 'src/content/blog/uuid-generator-guide/en.mdx'), 'utf8');
  const has = (name, text) => eq('guide: ' + name, guide.includes(text), true);
  const tv = /uuid-check: tool-value \*\/\}\n```text\n([^\n]+)\n/.exec(guide)[1];
  eq('guide tool value is v4', V4.test(tv), true);
  const hex = tv.replace(/-/g, '');
  has('13th digit row', '| 13th digit | `' + hex[12] + '` | `' + parseInt(hex[12], 16).toString(2).padStart(4, '0') + '` |');
  has('17th digit row', '| 17th digit | `' + hex[16] + '` | `' + parseInt(hex[16], 16).toString(2).padStart(4, '0') + '` |');

  // name-based vectors
  const ns = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
  const named = (algo, version) => {
    const b = createHash(algo).update(Buffer.concat([ns, Buffer.from('www.example.com')])).digest().subarray(0, 16);
    b[6] = (b[6] & 0x0f) | (version << 4);
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.toString('hex');
    return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
  };
  has('v3 vector', '| 3 | MD5 of namespace UUID + name | `' + named('md5', 3) + '` |');
  has('v5 vector', '`' + named('sha1', 5) + '`');
  has('v8 SHA-256 vector', '`' + named('sha256', 8) + '` (SHA-256 name-based example)');
  for (const v of ['c232ab00-9414-11ec-b3c8-9f6bdeced846', '919108f7-52d1-4320-9bac-f847db4148a8', '1ec9414c-232a-6b00-b3c8-9f6bdeced846', '017f22e2-79b0-7cc3-98c4-dc0c0c07398f']) has('RFC vector ' + v, '`' + v + '`');
  eq('v7 vector timestamp', new Date(0x017f22e279b0).toISOString(), '2022-02-22T19:22:22.000Z');

  // collision figures
  const N = 2 ** 122;
  const p = (n, M = N) => -Math.expm1(-n * n / 2 / M);
  const sci = (x, d) => {
    const [m, e] = x.toExponential(d).split('e');
    const n = Number(e);
    return m + ' × 10<sup>' + (n < 0 ? '−' + -n : n) + '</sup>';
  };
  const n50 = Math.sqrt(2 * N * Math.LN2);
  has('N', 'N = 2<sup>122</sup> ≈ ' + sci(N, 2));
  has('n50', 'n = √(2N ln 2) ≈ ' + sci(n50, 2) + ' UUIDs');
  eq('86 years', Math.round(n50 / 1e9 / (365.25 * 86400)), 86);
  has('86 years text', 'takes about 86 years');
  const year = 1e6 * 365.25 * 86400;
  has('row: a year at 1M/s', '| One million per second for a year | ' + sci(year, 2) + ' | ' + sci(p(year), 1) + ' |');
  has('row: 103 trillion', '| 103 trillion | ' + sci(1.03e14, 2) + ' | ' + sci(p(1.03e14), 0) + ' |');
  has('row: 8e15', '| ' + sci(8e15, 0) + ' | ' + sci(p(8e15), 1) + ' |');
  has('row: 50%', '| ' + sci(n50, 2) + ' | 0.5 |');
  has('v7 same millisecond', 'about ' + sci(p(1000, 2 ** 74), 1));

  // code blocks
  let py = false;
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); py = true; } catch {}
  const re = /\{\/\* uuid-run: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g;
  let m; let runs = 0;
  while ((m = re.exec(guide))) {
    runs++;
    const spec = JSON.parse(m[1]);
    const name = 'guide ' + spec.lang + ' block ' + runs;
    if (spec.lang === 'python' && !py) { skip(name, 'python3 not installed'); continue; }
    const dir = mkdtempSync(join(tmpdir(), 'uuid-run-'));
    try {
      const file = join(dir, spec.lang === 'node' ? 'main.mjs' : 'main.py');
      writeFileSync(file, m[2]);
      eq(name, execFileSync(spec.lang === 'node' ? process.execPath : 'python3', [file]).toString().trim(), spec.expect);
    } catch (e) {
      eq(name, String(e.stderr || e.message).slice(0, 300), spec.expect);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  eq('guide has 3 runnable blocks', runs, 3);
}

console.log(passes + ' passed, ' + failures + ' failed' + (skips ? ', ' + skips + ' skipped' : ''));
process.exitCode=failures ? 1 : 0;

// Correctness regression: complete actual component scripts and ToolLayout shortcut in both orders.
// DOM parsing uses parse5. WebCrypto and the local Nano ID vendor remain real. Only delivery,
// clipboard, timers and anchor download destinations are controlled in memory. No system clipboard.
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { loadPage } from './astro-page-harness.mjs';
const lifecycleRequire = createRequire(join(root, 'package.json'));
const { parseFragment, defaultTreeAdapter } = lifecycleRequire('parse5');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
const nativeWebCrypto = (await import('node:crypto')).webcrypto;
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = e => unhandled.push(e?.message || String(e));
process.on('unhandledRejection', onUnhandled);
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const must = (ok, msg) => { if (!ok)
    throw Error(msg); };
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function lifecycleLabels(lang) {
    if (!source.includes('const labels ='))
        return null;
    const a = source.indexOf('const labels ='), z = source.indexOf('\n---', a);
    return vm.runInNewContext(source.slice(a, z) + ';L', { lang }, { timeout: 1000 });
}
const lifecycleSlug = "uuid-generator", lifecyclePath = "src/components/tools/UuidGeneratorTool.astro", lifecyclePrefix = "uuid";
function lifecyclePage(lang = 'en', order = 'shared-after') {
    const clipboard = [], timers = new Map(), persistCalls = [], execCalls = [], tracks = [], tasks = [];
    let timerId = 0, clock = 0, doc;
    const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
    const matchOne = (el, selector) => {
        if (el.tagName.startsWith('#'))
            return false;
        const parts = selector.trim().split(/\s+(?![^\[]*\])/);
        if (parts.length > 1) {
            if (!matchOne(el, parts.pop()))
                return false;
            for (let parent = el.parentNode; parent; parent = parent.parentNode)
                if (matchOne(parent, parts.join(' ')))
                    return true;
            return false;
        }
        const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
        const plain = selector.replace(/\[[^\]]+\]/g, '');
        const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
        return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
            && [...plain.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
            && attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
    };
    const matches = (el, selector) => selector.split(',').some(part => matchOne(el, part.trim()));
    class EventStub {
        constructor(type, extra = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false, isTrusted: false }, extra); }
        preventDefault() { this.defaultPrevented = true; }
        stopPropagation() { this.stopped = true; }
    }
    class Element {
        constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', type: tag === 'input' ? 'text' : '', style: {}, text: '', _value: '', dirtyValue: false, disabled: false, hidden: false }); }
        get value() {
            if (!this.dirtyValue && this.tagName === 'TEXTAREA')
                return this.textContent;
            if (!this.dirtyValue && this.tagName === 'SELECT')
                return (this.querySelectorAll('option').find(o => o.selected) || this.querySelector('option'))?.value ?? '';
            return this._value;
        }
        set value(v) { let x = String(v); if (this.tagName === 'SELECT' && !this.querySelectorAll('option').some(o => o.value === x))
            x = ''; if (this.tagName === 'INPUT' && this.type === 'number' && x !== '' && !Number.isFinite(Number(x)))
            x = ''; this._value = x; this.dirtyValue = true; }
        get firstChild() { return this.children[0] ?? null; }
        get dataset() { const el = this; return new Proxy({}, { get(_, key) { return el.getAttribute('data-' + String(key).replace(/[A-Z]/g, x => '-' + x.toLowerCase())); }, set(_, key, value) { el.setAttribute('data-' + String(key).replace(/[A-Z]/g, x => '-' + x.toLowerCase()), value); return true; } }); }
        get parentElement() { return this.parentNode; }
        get isConnected() { return doc.contains(this); }
        get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c))
                el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c, force) { const yes = force ?? !this.contains(c); yes ? this.add(c) : this.remove(c); return yes; } }; }
        setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'type', 'value'].includes(k))
            this[k === 'class' ? 'className' : k] = String(v); if (['hidden', 'disabled', 'checked', 'selected'].includes(k))
            this[k] = true; if (k === 'style')
            Object.assign(this.style, Object.fromEntries(String(v).split(';').filter(Boolean).map(x => x.split(':').map(y => y.trim())))); }
        getAttribute(k) { if (['id', 'class', 'type'].includes(k))
            return this[k === 'class' ? 'className' : k] || null; return this.attributes[k] ?? null; }
        removeAttribute(k) { delete this.attributes[k]; if (['hidden', 'disabled', 'checked'].includes(k))
            this[k] = false; }
        get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
        set textContent(v) { for (const child of this.children)
            child.parentNode = null; this.children = []; this.text = String(v); }
        get innerHTML() { return this._html ?? this.textContent; }
        set innerHTML(v) {
            this._html = String(v);
            this.textContent = '';
            // parse5 supplies the real HTML tokenizer/entity table in the actual element context.
            // In particular, textarea uses RCDATA. No homemade entity decoder is used.
            const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
            for (const node of parseFragment(context, String(v)).childNodes)
                this.appendChild(fromParse5(node));
        }
        appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
        removeChild(child) { const i = this.children.indexOf(child); if (i >= 0)
            this.children.splice(i, 1); child.parentNode = null; return child; }
        querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
        querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
        contains(el) { return el === this || descendants(this).includes(el); }
        closest(selector) { for (let el = this; el; el = el.parentNode)
            if (matches(el, selector))
                return el; return null; }
        addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
        dispatchEvent(event) {
            event.target = this;
            for (let el = this; el; el = el.parentNode) {
                event.currentTarget = el;
                for (const fn of el.listeners[event.type] || []) {
                    const result = fn.call(el, event);
                    if (result && typeof result.then === 'function')
                        tasks.push(result);
                }
                if (!event.bubbles || event.stopped)
                    break;
            }
            return !event.defaultPrevented;
        }
        dispatch(type, extra = {}) { return this.dispatchEvent(new EventStub(type, { bubbles: true, ...extra })); }
        click() { if (this.disabled)
            return; this.focus(); this.dispatch('click'); }
        select() { doc.selectedElement = this; }
        focus() { if (doc.activeElement === this)
            return; const old = doc.activeElement; doc.activeElement = this; if (old)
            old.dispatchEvent(new EventStub('blur')); this.dispatchEvent(new EventStub('focus')); }
        setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    }
    function fromParse5(node) {
        const el = new Element(node.tagName || node.nodeName);
        if (node.nodeName === '#text')
            el.text = node.value;
        for (const attr of node.attrs || [])
            el.setAttribute(attr.name, attr.value);
        for (const child of node.childNodes || [])
            if (child.nodeName !== '#comment')
                el.appendChild(fromParse5(child));
        return el;
    }
    doc = new Element('#document');
    doc.documentElement = new Element('html');
    doc.documentElement.lang = lang;
    doc.appendChild(doc.documentElement);
    doc.body = new Element('body');
    doc.documentElement.appendChild(doc.body);
    const widget = new Element('section');
    widget.className = 'tool-widget';
    doc.body.appendChild(widget);
    let markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0].replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    const L = lifecycleLabels(lang);
    if (L)
        markup = markup.replace(/=\{L\.(\w+)\}/g, (_, k) => '="' + escape(L[k]) + '"').replace(/\{L\.(\w+)\}/g, (_, k) => escape(L[k]));
    widget.innerHTML = markup;
    doc.getElementById = id => descendants(doc).find(el => el.id === id) ?? null;
    doc.createElement = tag => new Element(tag);
    doc.activeElement = doc.body;
    doc.execCommand = command => { execCalls.push({ command, text: doc.selectedElement?.value ?? null }); return false; }; // Pure memory boundary, no native clipboard.
    const persist = { clear(slug) { persistCalls.push(['clear', slug]); }, save(...args) { persistCalls.push(['save', ...args]); }, load() { return {}; } };
    const globals = { document: doc, lang, L, Uint8Array, ArrayBuffer, crypto: nativeWebCrypto,
        _slug: lifecycleSlug, ztPersist: persist, fetch() { throw Error('network forbidden'); }, trackTool(...args) { tracks.push(args); },
        navigator: { clipboard: { writeText(value) { const d = deferred(); clipboard.push({ ...d, value: String(value) }); return d.promise; }, write() { throw Error('Unexpected clipboard.write'); } } },
        setTimeout(fn, ms) { timers.set(++timerId, { fn, ms, due: clock + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    };
    const policy = vm.runInNewContext('(' + readFileSync(join(root, 'src/data/persistence.ts'), 'utf8').match(/export const toolPersistencePolicy = (\{[\s\S]*?\}) as const/)[1] + ')');
    const store = new Map([['zt-input-password-generator', '{\"oldPassword\":\"SYNTHETIC\"}'], ['zt-input-rsa-key-generator', '{\"oldKey\":\"SYNTHETIC\"}']]);
    const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
    const context = { ...globals, localStorage: storage, toolPersistencePolicy: policy };
    context.window = context;
    vm.runInNewContext(layout.match(/<script is:inline define:vars=\{\{ toolPersistencePolicy \}\}>([\s\S]*?)<\/script>/)[1], context);
    const actualPersist = context.ztPersist;
    globals.localStorage = storage;
    globals.ztPersist = { ...actualPersist, clear(slug) { persistCalls.push(['clear', slug]); return actualPersist.clear(slug); }, save(...args) { persistCalls.push(['save', ...args]); return actualPersist.save(...args); } };
    context.ztPersist = globals.ztPersist;

    if (order === 'shared-before')
        vm.runInNewContext(shortcut, context, { filename: 'ToolLayout.astro:actual-shortcut' });
    const actual = loadPage(lifecyclePath, { lang, globals });
    if (order === 'shared-after')
        actual.run(shortcut);
    const get = id => { const el = doc.getElementById(id); must(el, lifecycleSlug + ' ID ' + id); return el; };
    return { doc, get, widget, store, clipboard, timers, persistCalls, execCalls, tracks, tasks, ctx: actual.ctx, async done() { await Promise.all(tasks); await settle(); },
        input(id, value) { get(id).value = value; get(id).dispatch('input'); },
        ctrlL(id, key = 'l', mod = 'ctrlKey') { const el = get(id); el.focus(); el.dispatch('keydown', { key, [mod]: true }); },
        change(id, value) { get(id).value = value; get(id).dispatch('change'); },
        key(id, extra) { const el = get(id); el.focus(); el.dispatch('keydown', { key: 'a', code: 'KeyA', keyCode: 65, which: 65, charCode: 0, location: 0, repeat: false, isComposing: false, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...extra }); },
        tick(ms) { clock += ms; for (;;) {
            const ready = [...timers].filter(([, t]) => t.due <= clock).sort((a, b) => a[1].due - b[1].due)[0];
            if (!ready)
                break;
            timers.delete(ready[0]);
            ready[1].fn();
        } },
    };
}
let lifecyclePass = 0, lifecycleFail = 0;
function lifeCheck(name, ok) { if (ok)
    lifecyclePass++;
else {
    lifecycleFail++;
    console.log('FAIL lifecycle ' + lifecycleSlug + ' ' + name);
} }
async function attempt(name, fn) { try {
    return await fn();
}
catch (e) {
    lifeCheck(name + ' (unexpected ' + e.message + ')', false);
    return null;
} }
function labelsFor(p) { if (p.ctx.document.querySelector('.' + lifecyclePrefix + '-wrap').dataset.copy)
    return lifecycleLabels(p.doc.documentElement.lang); return vm.runInNewContext('(' + source.match(/var STRINGS = (\{[\s\S]*?\n\s*\});/)[1] + ')')[p.doc.documentElement.lang]; }
function fullOutput(p) {   return p.get('uuid-output').textContent; }
function targets(p) {   return [{ b: p.get('uuid-copy-single'), text: () => fullOutput(p), success: labelsFor(p).copied, restore: labelsFor(p).copy, delay: 1500 }, { b: p.get('uuid-batch-copy'), text: () => p.get('uuid-batch-output').value, success: labelsFor(p).copied, restore: labelsFor(p).copyAll, delay: 1500 }]; }
const expectedCopyFailure = { en: 'Copy failed. Try again.', zh: '复制失败，请重试。', ja: 'コピーに失敗しました。再試行してください。', ko: '복사하지 못했습니다. 다시 시도하세요.' };
const feedback = t => t.b.textContent;
async function generateReady(p) { p.get(lifecyclePrefix + '-generate').click();  p.get('uuid-batch-gen').click();  }
function emptyState(p) {   return !p.get('uuid-output').textContent && !p.get('uuid-output').classList.contains('has-value') && !p.get('uuid-batch-output').value; }
const controlIds = ['uuid-count'];
const settings = p => JSON.stringify(controlIds.map(id => [id, p.get(id).value, !!p.get(id).checked]));
for (const lang of ['en', 'zh', 'ja', 'ko'])
    for (const order of ['shared-before', 'shared-after'])
        await attempt(lang + '/' + order, async () => {
            const p = lifecyclePage(lang, order);

            const initial = fullOutput(p);
            lifeCheck(lang + '/initial', !!initial);
            await generateReady(p);
            lifeCheck(lang + '/generated', !!fullOutput(p));

            {
                const single = fullOutput(p);
                p.get('uuid-batch-clear').click();
                lifeCheck('batch clear retains single', fullOutput(p) === single && !p.get('uuid-batch-output').value);
                p.get('uuid-batch-gen').click();
                p.change('uuid-count', '7');
                lifeCheck('preference saves only count', JSON.stringify(p.persistCalls.at(-1)) === JSON.stringify(['save', lifecycleSlug, { count: '7' }]));
            }

            const list = targets(p);
            for (let i = 0; i < list.length; i++)
                await attempt(lang + '/' + order + '/copy' + i, async () => {
                    const t = list[i], b = t.b, nav = p.ctx.navigator, api = nav.clipboard, n = p.clipboard.length, u = unhandled.length, base = feedback(t);
                    b.click();
                    lifeCheck('copy exact full bytes', p.clipboard[n]?.value === t.text());
                    p.clipboard[n]?.reject(Error('controlled current denial'));
                    await settle();
                    lifeCheck('current rejection handled', unhandled.length === u);
                    lifeCheck('visible localized failure', b.textContent === expectedCopyFailure[lang]);
                    b.click();
                    p.clipboard.at(-1)?.resolve();
                    await settle();
                    lifeCheck('same result retry', feedback(t) === t.success);
                    const oldTimer = [...p.timers.values()].find(x => x.ms === t.delay)?.fn;
                    p.tick(100);
                    b.click();
                    p.clipboard.at(-1)?.resolve();
                    await settle();
                    lifeCheck('repeat same value success', feedback(t) === t.success);
                    if (oldTimer)
                        oldTimer();
                    lifeCheck('canceled old timer inert', feedback(t) === t.success);
                    p.tick(t.delay - 100);
                    lifeCheck('new timer not due', feedback(t) === t.success);
                    p.tick(100);
                    lifeCheck('latest timer restores original', feedback(t) === t.restore);
                    const oldResolve = p.clipboard.length;
                    b.click();
                    b.click();
                    p.clipboard[oldResolve + 1]?.reject(Error('new request denied'));
                    await settle();
                    const failed = feedback(t);
                    p.clipboard[oldResolve]?.resolve();
                    await settle();
                    lifeCheck('old resolve preserves new error', feedback(t) === failed);
                    const oldReject = p.clipboard.length;
                    b.click();
                    b.click();
                    p.clipboard[oldReject + 1]?.resolve();
                    await settle();
                    p.clipboard[oldReject]?.reject(Error('old request denied'));
                    await settle();
                    lifeCheck('old reject preserves new success', feedback(t) === t.success);
                    lifeCheck('old rejection handled', unhandled.length === u);
                    nav.clipboard = undefined;
                    const calls = p.clipboard.length;
                    let threw = false;
                    try {
                        b.click();
                    }
                    catch {
                        threw = true;
                    }
                    lifeCheck('own undefined clipboard no throw', !threw && Object.hasOwn(nav, 'clipboard'));
                    lifeCheck('own undefined never native', p.execCalls.length === 0 && p.clipboard.length === calls);
                    lifeCheck('own undefined failure visible', b.textContent === expectedCopyFailure[lang]);
                    nav.clipboard = { writeText() { throw Error('controlled sync denial'); } };
                    threw = false;
                    try {
                        b.click();
                    }
                    catch {
                        threw = true;
                    }
                    lifeCheck('synchronous clipboard throw handled', !threw);
                    lifeCheck('sync denial visible', b.textContent === expectedCopyFailure[lang]);
                    nav.clipboard = api;
                    b.click();
                    p.clipboard.at(-1)?.resolve();
                    await settle();
                    lifeCheck('API restoration same result retry', feedback(t) === t.success);
                });
            const outside = p.doc.createElement('input');
            outside.type = 'text';
            outside.value = 'OUTSIDE';
            p.doc.body.appendChild(outside);
            outside.focus();
            const out = fullOutput(p);
            outside.dispatch('keydown', { key: 'l', ctrlKey: true });
            lifeCheck('outside focus untouched', outside.value === 'OUTSIDE' && fullOutput(p) === out);
            const oldTargets = targets(p), start = p.clipboard.length;
            oldTargets.forEach(t => t.b.click());
            const keep = settings(p), clearCalls = p.persistCalls.filter(x => x[0] === 'clear').length;
            p.ctrlL('uuid-batch-output', order === 'shared-before' ? 'L' : 'l', order === 'shared-before' ? 'metaKey' : 'ctrlKey');
            lifeCheck('Ctrl/MetaL clears all derived state', emptyState(p));
            lifeCheck('CtrlL keeps settings', settings(p) === keep);
            lifeCheck('shared persistence clear exactly once', p.persistCalls.filter(x => x[0] === 'clear').length === clearCalls + 1);
            const clearedFeedback = oldTargets.map(feedback);
            lifeCheck('clear resets feedback', clearedFeedback.every((x, i) => x === oldTargets[i].restore));
            lifeCheck('clear disables copy', oldTargets.filter(t => t.b.isConnected).every(t => t.b.disabled));
            const u = unhandled.length;
            for (let i = start; i < p.clipboard.length; i++)
                i % 2 ? p.clipboard[i].reject(Error('late denial')) : p.clipboard[i].resolve();
            await settle();
            lifeCheck('late clear promises leave empty', emptyState(p) && oldTargets.every((t, i) => feedback(t) === clearedFeedback[i]));
            lifeCheck('late clear reject handled', unhandled.length === u);
            p.tick(2000);
            lifeCheck('postclear timer leaves empty', emptyState(p));
            const n = p.clipboard.length;
            oldTargets.filter(t => t.b.isConnected).forEach(t => t.b.click());
            lifeCheck('empty copy no write', p.clipboard.length === n);

            await generateReady(p);
            lifeCheck('generation after clear works', !!fullOutput(p));
            const oldGenerationTargets = targets(p), oldGenerationTimers = [], oldGenerationRequests = [];
            for (const t of oldGenerationTargets) {
                t.b.click();
                p.clipboard.at(-1)?.resolve();
                await settle();
                const timer = [...p.timers.values()].filter(x => x.ms === t.delay).at(-1);
                if (timer)
                    oldGenerationTimers.push(timer.fn);
                const index = p.clipboard.length;
                t.b.click();
                t.b.click();
                oldGenerationRequests.push(index, index + 1);
            }
            await generateReady(p);
            const freshOutput = fullOutput(p), freshTargets = targets(p);
            for (const t of freshTargets) {
                t.b.click();
                p.clipboard.at(-1)?.resolve();
                await settle();
            }
            const beforeTracks = p.tracks.length, uNew = unhandled.length;
            for (let i = 0; i < oldGenerationRequests.length; i++) {
                const request = p.clipboard[oldGenerationRequests[i]];
                if (request)
                    i % 2 ? request.reject(Error('old generation denial')) : request.resolve();
            }
            await settle();
            oldGenerationTimers.forEach(fn => fn());
            lifeCheck('new generation ignores old resolve reject timers', fullOutput(p) === freshOutput && freshTargets.every(t => feedback(t) === t.success));
            lifeCheck('old generation callbacks do not track', p.tracks.length === beforeTracks);
            lifeCheck('old generation reject handled', unhandled.length === uNew);

            lifeCheck('no native clipboard ever', p.execCalls.length === 0);
        });

process.removeListener('unhandledRejection', onUnhandled);
console.log(`LIFECYCLE ${lifecyclePass} passed, ${lifecycleFail} failed`);
console.log(`FINAL ${passes + lifecyclePass} passed, ${failures + lifecycleFail} failed`);
process.exitCode = failures + lifecycleFail ? 1 : 0;
