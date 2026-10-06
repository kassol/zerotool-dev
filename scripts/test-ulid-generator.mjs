// ULID Generator — monotonic within a millisecond; decoder rejects values above 128 bits
//
// Read:  src/components/tools/UlidGeneratorTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers and the frontmatter labels)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Spec: github.com/ulid/spec. "Monotonicity": within the same millisecond the random component
// is incremented by 1 in the least significant bit position (with carrying); generation fails
// when it overflows. The reference implementation (ulid/javascript monotonicFactory) also keeps
// the last timestamp when the clock goes backwards. "Overflow Errors when Parsing Base32
// Strings": the largest valid ULID is 7ZZZZZZZZZZZZZZZZZZZZZZZZZ; larger values are rejected.
// Covers: time encoding vectors (ulid/javascript README: 1469918176385 → 01ARYZ6S41), the
// README monotonic pair ...EMMVRZ → ...EMMVS0, a 100-item batch in one millisecond is strictly
// increasing and differs by 1 each step (before the fix every item had fresh random bits and
// the batch was not sorted), carry across several Z digits, a new millisecond draws fresh
// random bits, a clock that goes back keeps the previous timestamp, overflow at ZZZZ...
// throws and does not change state, decoder: first character 0–7 accepted and 8–Z rejected as
// out of range (before the fix 8ZZZZZZZZZZZZZZZZZZZZZZZZZ decoded to a date in the year 12004),
// length / alphabet errors, lower case, timestamps after year 9999 keep their milliseconds
// (before, formatMs cut the ISO string at a fixed length), the 4-language labels.
//
// Run: node scripts/test-ulid-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/UlidGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in UlidGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { encodeTime, encodeRandom, createUlidFactory, decodeUlid, formatMs: typeof formatMs === "function" ? formatMs : null };')();

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
function throws(name, fn, match) {
  try { fn(); } catch (e) { check(name, match.test(e.message), 'message ' + JSON.stringify(e.message)); return; }
  check(name, false, 'did not throw');
}

// Independent reference: Crockford Base32 of a BigInt.
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const toB32 = (n, len) => { let s = ''; for (let i = 0; i < len; i++) { s = ALPHA[Number(n & 31n)] + s; n >>= 5n; } return s; };
const fromB32 = (s) => [...s].reduce((a, c) => a * 32n + BigInt(ALPHA.indexOf(c)), 0n);

// Random source that returns the given byte arrays in turn.
function bytesFrom(list) {
  let i = 0;
  return (arr) => { const src = list[Math.min(i++, list.length - 1)]; for (let k = 0; k < arr.length; k++) arr[k] = src[k]; };
}
const clock = (list) => { let i = 0; return () => list[Math.min(i++, list.length - 1)]; };

// ---------- encoding ----------
eq('encodeTime README vector', E.encodeTime(1469918176385), '01ARYZ6S41');
eq('encodeTime 0', E.encodeTime(0), '0000000000');
eq('encodeTime max 48-bit', E.encodeTime(2 ** 48 - 1), '7ZZZZZZZZZ');
const rb = [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x0f, 0xed];
eq('encodeRandom matches BigInt reference', E.encodeRandom(rb),
  toB32(rb.reduce((a, b) => a * 256n + BigInt(b), 0n), 16));

// ---------- monotonicity (the reported defect) ----------
function randomToBytes(str) {
  let n = fromB32(str);
  const out = new Array(10);
  for (let i = 9; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
  return out;
}
{
  const next = E.createUlidFactory(clock([1469918176385]), bytesFrom([randomToBytes('ACTAV9WEVGEMMVRZ'), [9, 9, 9, 9, 9, 9, 9, 9, 9, 9]]));
  const a = next();
  const b = next();
  eq('first ULID uses the random bytes', a.ulid, '01ARYZ6S41ACTAV9WEVGEMMVRZ');
  eq('README pair: same millisecond increments (RZ → S0)', b.ulid, '01ARYZ6S41ACTAV9WEVGEMMVS0');
  eq('random part reported', b.randStr, 'ACTAV9WEVGEMMVS0');
  eq('timestamp reported', b.ms, 1469918176385);
}
{
  // Real crypto, frozen clock: 100 in one millisecond, like a batch on a fast machine.
  const next = E.createUlidFactory(() => 1700000000000, (a) => crypto.getRandomValues(a));
  const list = Array.from({ length: 100 }, () => next().ulid);
  const sorted = [...list].sort();
  check('100 in one millisecond are strictly increasing', list.every((u, i) => i === 0 || u > list[i - 1]));
  eq('batch already in sorted order', list.join(), sorted.join());
  check('each step adds exactly 1 to the random part',
    list.every((u, i) => i === 0 || fromB32(u.slice(10)) === fromB32(list[i - 1].slice(10)) + 1n));
  check('all share the timestamp', list.every((u) => u.slice(0, 10) === list[0].slice(0, 10)));
}
{
  const next = E.createUlidFactory(clock([5, 5]), bytesFrom([randomToBytes('0000000000000ZZZ')]));
  next();
  eq('carry across several Z digits', next().randStr, '0000000000001000');
}
{
  const zeros = new Array(10).fill(0);
  const next = E.createUlidFactory(clock([1000, 1001]), bytesFrom([randomToBytes('ZZZZZZZZZZZZZZZZ'), zeros]));
  eq('max random allowed as a first value', next().randStr, 'ZZZZZZZZZZZZZZZZ');
  eq('new millisecond draws fresh random bits', next().ulid, E.encodeTime(1001) + '0000000000000000');
}
{
  const next = E.createUlidFactory(clock([2000, 1500, 2000]), bytesFrom([randomToBytes('0000000000000001')]));
  const a = next();
  const b = next();
  const c = next();
  eq('clock goes back: previous timestamp kept', b.ms, 2000);
  check('clock goes back: still increasing', b.ulid > a.ulid && c.ulid > b.ulid, [a.ulid, b.ulid, c.ulid].join(' '));
}
{
  const next = E.createUlidFactory(clock([3000]), bytesFrom([randomToBytes('ZZZZZZZZZZZZZZZZ')]));
  const first = next();
  throws('overflow in the same millisecond throws', () => next(), /overflow/i);
  throws('overflow keeps failing in that millisecond', () => next(), /overflow/i);
  eq('first ULID unchanged', first.randStr, 'ZZZZZZZZZZZZZZZZ');
}

// ---------- decoder ----------
eq('decode README ULID', E.decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FAV'), { ms: 1469918176385 });
eq('decode lower case', E.decodeUlid('01aryz6s41tsv4rrffq69g5fav'), { ms: 1469918176385 });
eq('largest valid ULID', E.decodeUlid('7ZZZZZZZZZZZZZZZZZZZZZZZZZ'), { ms: 2 ** 48 - 1 });
for (const first of '89ABCDEFGHJKMNPQRSTVWXYZ') {
  eq('first char ' + first + ' out of range', E.decodeUlid(first + 'ZZZZZZZZZZZZZZZZZZZZZZZZZ').error, 'range');
}
eq('too short', E.decodeUlid('01ARYZ6S41').error, 'invalid');
eq('too long', E.decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FAVX').error, 'invalid');
eq('I / L / O / U rejected', ['I', 'L', 'O', 'U'].map((c) => E.decodeUlid('01ARYZ6S41TSV4RRFFQ69G5FA' + c).error),
  ['invalid', 'invalid', 'invalid', 'invalid']);
eq('generated ULID decodes to its timestamp', E.decodeUlid(E.createUlidFactory(() => 1759212345678, (a) => a.fill(7))().ulid),
  { ms: 1759212345678 });

// ---------- timestamp display ----------
check('formatMs is in the engine block', typeof E.formatMs === 'function');
if (E.formatMs) {
  eq('formatMs README time', E.formatMs(1469918176385), '2016-07-30 22:36:16.385 UTC');
  eq('formatMs largest ULID keeps the milliseconds', E.formatMs(2 ** 48 - 1), '+010889-08-02 05:31:50.655 UTC');
  eq('formatMs 0', E.formatMs(0), '1970-01-01 00:00:00.000 UTC');
}

// ---------- labels ----------
for (const key of ['outOfRange', 'overflow']) {
  const n = (source.match(new RegExp('^\\s+' + key + ": '[^']+',$", 'gm')) || []).length;
  eq('label ' + key + ' in 4 languages', n, 4);
}
check('labels passed to the script', /data-out-of-range=\{L\.outOfRange\}/.test(source) && /data-overflow=\{L\.overflow\}/.test(source));

// Examples on the English tool page are engine output
{
  const page = readFileSync(join(root, 'src/content/tools/ulid-generator/en.mdx'), 'utf8');
  for (const [ulid, ts, ms] of [
    ['01ARZ3NDEKTSV4RRFFQ69G5FAV', '2016-07-30 23:54:10.259 UTC', 1469922850259],
    ['7ZZZZZZZZZZZZZZZZZZZZZZZZZ', '+010889-08-02 05:31:50.655 UTC', 281474976710655],
  ]) {
    eq('page decode ' + ulid + ' ms', E.decodeUlid(ulid).ms, ms);
    eq('page decode ' + ulid + ' time', E.formatMs(ms), ts);
    check('page shows ' + ulid, page.includes(ulid) && page.includes(ts) && page.includes(String(ms)));
  }
  eq('page: 8ZZZ… out of range', E.decodeUlid('8ZZZZZZZZZZZZZZZZZZZZZZZZZ').error, 'range');
  eq('page: L is invalid', E.decodeUlid('01ARZ3NDEKTSV4RRFFQ69G5FAL').error, 'invalid');
  const at = Date.UTC(2026, 9, 1, 9, 30, 0, 123);
  const next = E.createUlidFactory(() => at, (a) => a.set([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22]));
  for (const want of ['01M3VCS7HV28T5CY4TQKFF0492', '01M3VCS7HV28T5CY4TQKFF0493', '01M3VCS7HV28T5CY4TQKFF0494']) {
    const got = next().ulid;
    eq('page batch example', got, want);
    check('page shows ' + want, page.includes('<code>' + want + '</code>'));
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
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
const lifecycleSlug = "ulid-generator", lifecyclePath = "src/components/tools/UlidGeneratorTool.astro", lifecyclePrefix = "ulid";
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
function fullOutput(p) {     return p.get(lifecyclePrefix + '-tbody').children.map(row => row.children[0].textContent).join('\n'); }
function targets(p) {     const L = labelsFor(p); return [{ b: p.doc.querySelector('.' + lifecyclePrefix + '-copy-btn'), text: () => fullOutput(p).split('\n')[0], success: L.copied, restore: L.copy, delay: 1200 }, { b: p.get(lifecyclePrefix + '-copy-all'), text: () => fullOutput(p), success: L.copyAllDone, restore: L.copyAll, delay: 1500 }]; }
const expectedCopyFailure = { en: 'Copy failed. Try again.', zh: '复制失败，请重试。', ja: 'コピーに失敗しました。再試行してください。', ko: '복사하지 못했습니다. 다시 시도하세요.' };
const feedback = t => t.b.textContent;
async function generateReady(p) { p.get(lifecyclePrefix + '-generate').click(); }
function emptyState(p) {     return !p.get(lifecyclePrefix + '-tbody').children.length && p.get(lifecyclePrefix + '-results').style.display === 'none' && (((!p.get('ulid-decode-input').value && !p.get('ulid-decode-result').textContent && p.get('ulid-decode-result').style.display === 'none'))); }
const controlIds = ['ulid-count'];
const settings = p => JSON.stringify(controlIds.map(id => [id, p.get(id).value, !!p.get(id).checked]));
for (const lang of ['en', 'zh', 'ja', 'ko'])
    for (const order of ['shared-before', 'shared-after'])
        await attempt(lang + '/' + order, async () => {
            const p = lifecyclePage(lang, order);
            p.get(lifecyclePrefix + '-count').value = '3';
            const initial = fullOutput(p);
            lifeCheck(lang + '/initial', !initial);
            await generateReady(p);
            lifeCheck(lang + '/generated', !!fullOutput(p));

            {
                p.input('ulid-decode-input', '01ARYZ6S41TSV4RRFFQ69G5FAV');
                lifeCheck('decoder actual epoch', p.get('ulid-decode-result').textContent.includes('1469918176385'));
                const decode = p.get('ulid-decode-result').textContent;
                p.get('ulid-clear').click();
                lifeCheck('local Clear keeps decoder', p.get('ulid-decode-result').textContent === decode);
                await generateReady(p);
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
            p.ctrlL('ulid-decode-input', order === 'shared-before' ? 'L' : 'l', order === 'shared-before' ? 'metaKey' : 'ctrlKey');
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
