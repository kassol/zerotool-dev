// Nano ID Generator — custom alphabets by code point
//
// Read:  src/components/tools/NanoIdGeneratorTool.astro (extracts the real engine block between the
//        `engine:start` / `engine:end` markers), src/content/tools/nano-id-generator/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: a custom alphabet is split into code points and deduplicated, so emoji and other
// characters above U+FFFF are whole symbols (nanoid's customAlphabet works per UTF-16 code unit
// and produced lone surrogates); IDs have `size` symbols, all from the alphabet, and are
// well-formed UTF-16; alphabets above 256 symbols use every symbol (nanoid uses one byte per
// symbol and never picks the 257th and later); random values at or above the largest multiple of
// the alphabet size are discarded (no modulo bias), checked with a stub random source; a
// chi-square test over 300 symbols × 300,000 draws; the English page no longer states the
// UTF-16 and 256-symbol limits.
//
// Run: node scripts/test-nano-id-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/NanoIdGeneratorTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/nano-id-generator/en.mdx'), 'utf8');
const START = '/* ── engine:start ── */';
const END = '/* ── engine:end ── */';
const s = source.indexOf(START);
const e = source.indexOf(END);
if (s < 0 || e <= s) {
  console.error('FAIL: could not locate the engine block in NanoIdGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(s, e) + '\nreturn { alphabetSymbols, randomId };')();
const rand = (n) => webcrypto.getRandomValues(new Uint32Array(n));

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const x = JSON.stringify(expected);
  if (a === x) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + x + '\n  actual   ' + a);
}

eq('emoji alphabet by code point', E.alphabetSymbols('😀😃😀ab'), ['😀', '😃', 'a', 'b']);
eq('CJK and ASCII', E.alphabetSymbols('猫犬猫01'), ['猫', '犬', '0', '1']);
const emoji = E.alphabetSymbols('😀😃😄😁🐱🐶');
let ok = true;
for (let i = 0; i < 2000 && ok; i++) {
  const id = E.randomId(emoji, 8, rand);
  const cps = Array.from(id);
  if (cps.length !== 8 || !cps.every((c) => emoji.includes(c)) || !id.isWellFormed()) { ok = false; eq('emoji id ' + JSON.stringify(id), 'well-formed, 8 symbols', id); }
}
if (ok) passes++;

// rejection sampling: with 3 symbols the largest multiple below 2^32 is 4294967295 - (2^32 % 3)
const three = ['a', 'b', 'c'];
const limit = Math.floor(4294967296 / 3) * 3;
const queue = [limit, limit + 0, 4294967295, 0, 1, 2];
const stub = (n) => { const out = new Uint32Array(n); for (let i = 0; i < n; i++) out[i] = queue.length ? queue.shift() : 0; return out; };
eq('values at or above the limit are discarded', E.randomId(three, 3, stub), 'abc');

// 300 distinct symbols: every one is used, roughly evenly
const big = Array.from({ length: 300 }, (_, i) => String.fromCodePoint(0x4E00 + i));
const counts = new Map();
const N = 300000;
const ids = E.randomId(big, N, rand);
for (const c of ids) counts.set(c, (counts.get(c) || 0) + 1);
eq('all 300 symbols used', counts.size, 300);
const exp = N / 300;
let chi = 0;
for (const c of big) chi += ((counts.get(c) || 0) - exp) ** 2 / exp;
// df = 299: mean 299, sd ≈ 24.5; 450 is beyond 6 sd
eq('chi-square below 450', chi < 450, true);

eq('page no longer says custom alphabets must stay below U+FFFF', page.includes('Use ASCII or other characters below U+FFFF'), false);

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
const lifecycleSlug = "nano-id-generator", lifecyclePath = "src/components/tools/NanoIdGeneratorTool.astro", lifecyclePrefix = "nanoid";
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
    {
        vm.runInNewContext(readFileSync(join(root, 'public/vendor/nanoid.min.js'), 'utf8'), context);
        globals.__nanoid = context.__nanoid;
    }
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
function emptyState(p) {     return !p.get(lifecyclePrefix + '-tbody').children.length && p.get(lifecyclePrefix + '-results').style.display === 'none' && (true); }
const controlIds = ['nanoid-count', 'nanoid-size', 'nanoid-alphabet'];
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
                p.change('nanoid-alphabet', 'custom');
                p.input('nanoid-custom-alphabet', 'ab🙂🙂');
                p.get('nanoid-size').value = '12';
                await generateReady(p);
                lifeCheck('real custom code point IDs', fullOutput(p).split('\n').every(x => [...x].length === 12 && [...x].every(c => 'ab🙂'.includes(c))));
                p.get('nanoid-clear').click();
                lifeCheck('local Clear keeps custom text', p.get('nanoid-custom-alphabet').value === 'ab🙂🙂');
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
            p.ctrlL('nanoid-custom-alphabet', order === 'shared-before' ? 'L' : 'l', order === 'shared-before' ? 'metaKey' : 'ctrlKey');
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
            if ((p.get('nanoid-alphabet').value === 'custom')) {
                lifeCheck('CtrlL clears custom text', !p.get('nanoid-custom-alphabet').value);
                p.input('nanoid-custom-alphabet', 'ab🙂🙂');
            }
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

            {
                p.change('nanoid-alphabet', 'custom');
                p.input('nanoid-custom-alphabet', 'x');
                p.get('nanoid-generate').click();
                lifeCheck('invalid alphabet clears stale results', !p.get('nanoid-tbody').children.length && p.get('nanoid-results').style.display === 'none' && p.get('nanoid-copy-all').disabled && !!p.get('nanoid-err').textContent);
            }
            lifeCheck('no native clipboard ever', p.execCalls.length === 0);
        });


// v2: bounded generated IDs, server-rendered explanations and actual Unicode controls.
const v2Check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} v2 ${name}`); if (ok) passes++; else failures++; };
const v2Region = source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/);
const v2Strings = v2Region ? vm.runInNewContext(v2Region[1] + ';STRINGS') : {};
const v2TipKeys = ['generate', 'count', 'size', 'alphabet', 'custom', 'copy', 'clear'];
const v2Scripts = [...source.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map(m => m[0]).join('\n');
v2Check('outer tool root stays a flex column with zero minimum height', /\.nanoid-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0/.test(source));
v2Check('300px rail belongs to the bounded inner grid', /\.nanoid-main\s*\{[^}]*grid-template-columns:\s*300px minmax\(0,\s*1fr\);[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0/.test(source));
v2Check('all option controls are in the shared rail', /<aside class="nanoid-rail zt-rail">[\s\S]*id="nanoid-count"[\s\S]*id="nanoid-size"[\s\S]*id="nanoid-alphabet"[\s\S]*id="nanoid-custom-alphabet"[\s\S]*<\/aside>/.test(source));
v2Check('result pane has a zero minimum and contains the existing table', /class="nanoid-result-pane"[\s\S]*id="nanoid-results"/.test(source) && /\.nanoid-result-pane\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/.test(source));
v2Check('long generated lists scroll with zero flex basis', /\.nanoid-results\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;[^}]*overflow:\s*auto/.test(source));
v2Check('dynamic ID cells have global long-value wrapping', /\.nanoid-wrap :global\(\.nanoid-td-id\)\s*\{[^}]*word-break:\s*break-all/.test(source));
v2Check('status reserves two lines while the actual error is hidden', /class="nanoid-status" aria-live="polite"><div class="nanoid-err" id="nanoid-err" style="display:none;"/.test(source) && /\.nanoid-status\s*\{[^}]*min-height:\s*2\.8em;[^}]*line-height:\s*1\.4/.test(source));
v2Check('desktop empty sentence follows actual result visibility', /\.nanoid-result-pane:has\(#nanoid-results\[style\*="none"\]\) > \.nanoid-empty/.test(source));
v2Check('860 stacked layout hides only the empty result pane', /@media \(max-width: 860px\)[\s\S]*\.nanoid-main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(source) && /\.nanoid-result-pane:has\(#nanoid-results\[style\*="none"\]\)\s*\{\s*display:\s*none/.test(source));
v2Check('stacked short and long lists keep the same result viewport height', /@media \(max-width: 860px\)[\s\S]*\.nanoid-results\s*\{[^}]*flex:\s*none;[^}]*height:\s*18rem;[^}]*max-height:\s*18rem/.test(source));
v2Check('phone main inputs and actions have 44px minimums', /@media \(max-width: 640px\)[\s\S]*\.nanoid-num-input, \.nanoid-select, \.nanoid-text-input, \.nanoid-btn-row button\s*\{\s*min-height:\s*44px/.test(source));
v2Check('dynamic Copy and tips have global 24px minimums', /:global\(\.nanoid-copy-btn\)\s*\{\s*min-width:\s*24px;\s*min-height:\s*24px/.test(source) && /:global\(\.zt-tip-btn\)\s*\{\s*min-width:\s*24px;\s*min-height:\s*24px/.test(source));
v2Check('all static business actions and dynamic row Copy remain', ['nanoid-generate','nanoid-copy-all','nanoid-clear'].every(id => source.includes(`id="${id}"`)) && v2Scripts.includes("copyBtn.addEventListener('click'"));
v2Check('seven unique tips pass their explanation through HTML slots', v2TipKeys.every(k => source.includes(`id="nanoid-tip-${k}"`) && source.includes(`>{U.tips.${k}}</Toggletip>`)) && (source.match(/<Toggletip\b/g) || []).length === 7);
v2Check('the local vendor script remains the actual generation dependency', source.includes('<script src="/vendor/nanoid.min.js" is:inline></script>') && v2Scripts.includes('window.__nanoid.customAlphabet(alpha, size)'));
v2Check('no new UI table or tips reach the complete client scripts', !/\b(?:U|STRINGS)\b|nanoid-tip-/.test(v2Scripts) && !source.includes('data-strings='));
for (const lang of ['en','zh','ja','ko']) {
    const strings = v2Strings[lang], labels = lifecycleLabels(lang), p = lifecyclePage(lang);
    v2Check(lang + ' has an empty sentence and seven nonempty tips', !!strings?.empty && v2TipKeys.every(k => typeof strings?.tips?.[k] === 'string' && !!strings.tips[k].trim()) && Object.keys(strings?.tips || {}).length === 7);
    v2Check(lang + ' actual controls keep their original SSR labels', p.get('nanoid-generate').textContent === labels.generate && p.get('nanoid-copy-all').textContent === labels.copyAll && p.get('nanoid-custom-alphabet').getAttribute('placeholder') === labels.customAlphabetPlaceholder);
    const n = p.tracks.length;
    p.change('nanoid-alphabet', 'custom'); p.input('nanoid-custom-alphabet', '😀😀😃'); p.input('nanoid-size', '3'); p.input('nanoid-count', '2');
    v2Check(lang + ' changing options does not generate results', p.tracks.length === n && !p.get('nanoid-tbody').children.length);
    p.get('nanoid-generate').click();
    const ids = fullOutput(p).split('\n');
    v2Check(lang + ' actual custom path returns whole Unicode symbols at the selected count and size', ids.length === 2 && ids.every(id => Array.from(id).length === 3 && Array.from(id).every(c => c === '😀' || c === '😃') && id.isWellFormed()));
    p.get('nanoid-clear').click();
    v2Check(lang + ' Clear removes the list and keeps custom text and settings', !p.get('nanoid-tbody').children.length && p.get('nanoid-results').style.display === 'none' && p.get('nanoid-custom-alphabet').value === '😀😀😃' && p.get('nanoid-count').value === '2' && p.get('nanoid-size').value === '3' && p.get('nanoid-alphabet').value === 'custom');
    p.ctrlL('nanoid-custom-alphabet');
    v2Check(lang + ' shortcut additionally clears custom text and retains numeric/preset choices', !p.get('nanoid-custom-alphabet').value && p.get('nanoid-count').value === '2' && p.get('nanoid-size').value === '3' && p.get('nanoid-alphabet').value === 'custom');
    const mdx = readFileSync(join(root, 'src/content/tools/nano-id-generator', lang + '.mdx'), 'utf8');
    const region = mdx.match(/\nsteps:\n([\s\S]*?)\nfaqItems:/);
    const steps = region ? [...region[1].matchAll(/^  - (.+)$/gm)].map(m => JSON.parse(m[1])) : [];
    v2Check(lang + ' six steps meet all limits and precede FAQ', steps.length === 6 && steps.every(s => s.trim().length > 0 && s.length <= 280) && steps.join('').length <= 1200);
    v2Check(lang + ' Usage moved out of body and existing alphabet reference remains', !/<h2>(?:How to Use|使用方法|使用说明|使い方|사용 방법)<\/h2>/.test(mdx) && mdx.includes('A-Za-z0-9_-') && mdx.includes('UUID'));
}
const v2Compiler = await import(createRequire(lifecycleRequire.resolve('astro/package.json')).resolve('@astrojs/compiler'));
const v2Parsed = await v2Compiler.parse(source);
v2Check('Astro parser reports no diagnostics', v2Parsed.diagnostics.length === 0);
console.log('ASTRO diagnostics ' + JSON.stringify(v2Parsed.diagnostics));
const v2Compiled = await v2Compiler.transform(source, {filename: 'NanoIdGeneratorTool.astro'});
v2Check('Astro compiles the markup and resolves global dynamic CSS selectors', v2Compiled.diagnostics.every(d => d.severity !== 1) && v2Compiled.css.length > 0 && v2Compiled.css.every(css => !css.includes(':global(')));
const {transform: v2ParseJs} = await import('esbuild');
await v2ParseJs(v2Compiled.code, {loader:'ts',format:'esm'});
v2Check('compiled module retains all HTML tip slots', v2TipKeys.every(k => v2Compiled.code.includes('U.tips.' + k)));
if (process.env.ZT_B14_REGISTRATION_PENDING === '1') console.log('PENDING_ROOT v2 generate registration');
else v2Check('generate kind is registered', /['"]nano-id-generator['"]\s*:\s*['"]generate['"]/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));

process.removeListener('unhandledRejection', onUnhandled);
console.log(`LIFECYCLE ${lifecyclePass} passed, ${lifecycleFail} failed`);
console.log(`FINAL ${passes + lifecyclePass} passed, ${failures + lifecycleFail} failed`);
process.exitCode = failures + lifecycleFail ? 1 : 0;
