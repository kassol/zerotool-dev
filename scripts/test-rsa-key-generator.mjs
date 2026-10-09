// Read: src/components/tools/RsaKeyGeneratorTool.astro, src/layouts/ToolLayout.astro,
//       scripts/astro-page-harness.mjs and installed parse5.
// Write: stdout/stderr; clipboard, downloads and timers stay in memory. The rkg-check examples
//        run ssh-keygen (when installed) on public keys written to os.tmpdir(), removed after use.
// Exit: 0 when all checks pass, 1 when any check fails.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/RsaKeyGeneratorTool.astro'), 'utf8');
let passes=0,failures=0;

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
const cryptoProof = (await import('node:crypto'));
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
function controlledCrypto(holdMethod) {
    const armed = Array.isArray(holdMethod) ? [...holdMethod] : [holdMethod];
    const jobs = [];
    let exportCount = 0;
    const subtle = {};
    for (const method of ['generateKey', 'exportKey'])
        subtle[method] = (...args) => {
            if (method === 'exportKey')
                exportCount++;
            const ready = deferred(), release = deferred(), held = armed[0] === method || (armed[0] === 'exportKey:2' && method === 'exportKey' && exportCount === 2);
            if (held)
                armed.shift();
            const job = { method, held, ready: ready.promise, release: () => release.resolve(), deny: false };
            jobs.push(job);
            return Promise.resolve().then(() => nativeWebCrypto.subtle[method](...args)).then(async (value) => { ready.resolve(); if (held)
                await release.promise; if (job.deny)
                throw Error('controlled delivery denial'); return value; }, async (error) => { ready.resolve(); if (held)
                await release.promise; throw error; });
        };
    return { crypto: { subtle, randomUUID: () => nativeWebCrypto.randomUUID(), getRandomValues: a => nativeWebCrypto.getRandomValues(a) }, jobs };
}
const lifecycleSlug = "rsa-key-generator", lifecyclePath = "src/components/tools/RsaKeyGeneratorTool.astro", lifecyclePrefix = "rkg";
function lifecyclePage(lang = 'en', order = 'shared-after', holdMethod = null) {
    const clipboard = [], timers = new Map(), persistCalls = [], execCalls = [], tracks = [], tasks = [], downloads = [], blobs = new Map();
    const native = controlledCrypto(holdMethod);
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
            return; if (this.tagName === 'A' && this.download) {
            downloads.push({ name: this.download, blob: blobs.get(this.href) });
            return;
        } this.focus(); this.dispatch('click'); }
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
    const objectURL = { createObjectURL(blob) { const url = 'blob:memory-' + blobs.size; blobs.set(url, blob); return url; }, revokeObjectURL(url) { blobs.delete(url); } };
    const globals = { document: doc, lang, L, Blob, URL: objectURL, Uint8Array, ArrayBuffer, btoa: s => Buffer.from(s, 'binary').toString('base64'), crypto: native.crypto,
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
    return { doc, get, widget, store, clipboard, timers, persistCalls, execCalls, tracks, downloads, jobs: native.jobs, tasks, ctx: actual.ctx, async done() { await Promise.all(tasks); await settle(); },
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
function fullOutput(p) {    return p.get('rkg-pub-out').value; }
function targets(p) {    return ['pub', 'priv'].map(k => ({ b: p.get('rkg-' + k + '-copy'), text: () => p.get('rkg-' + k + '-out').value, success: lifecycleLabels(p.doc.documentElement.lang).copied, restore: lifecycleLabels(p.doc.documentElement.lang).copy, delay: 1500 })); }
const expectedCopyFailure = { en: 'Copy failed. Try again.', zh: '复制失败，请重试。', ja: 'コピーに失敗しました。再試行してください。', ko: '복사하지 못했습니다. 다시 시도하세요.' };
const feedback = t => t.b.textContent;
async function generateReady(p) { p.get(lifecyclePrefix + '-generate').click(); await p.done(); }
function emptyState(p) {    return !p.get('rkg-pub-out').value && !p.get('rkg-priv-out').value && p.get('rkg-pub-block').style.display === 'none' && p.get('rkg-priv-block').style.display === 'none' && !p.get('rkg-status').textContent && !p.get('rkg-generate').disabled; }
const controlIds = ['rkg-keysize', 'rkg-algo', 'rkg-format'];
const settings = p => JSON.stringify(controlIds.map(id => [id, p.get(id).value, !!p.get(id).checked]));
for (const lang of ['en', 'zh', 'ja', 'ko'])
    for (const order of ['shared-before', 'shared-after'])
        await attempt(lang + '/' + order, async () => {
            const p = lifecyclePage(lang, order);

            const initial = fullOutput(p);
            lifeCheck(lang + '/initial', !initial);
            await generateReady(p);
            lifeCheck(lang + '/generated', !!fullOutput(p));

            {
                const pub = p.get('rkg-pub-out').value, priv = p.get('rkg-priv-out').value, pk = cryptoProof.createPublicKey(pub), sk = cryptoProof.createPrivateKey(priv);
                lifeCheck('real 2048 pair', sk.asymmetricKeyDetails.modulusLength === 2048 && pk.export({ type: 'spki', format: 'der' }).equals(cryptoProof.createPublicKey(sk).export({ type: 'spki', format: 'der' })));
                lifeCheck('PEM wrap 64', [pub, priv].every(x => x.split('\n').slice(1, -1).every(y => y.length <= 64)));
                p.change('rkg-format', 'jwk');
                p.get('rkg-pub-dl').click();
                p.get('rkg-priv-dl').click();
                lifeCheck('download format snapshot', p.downloads.map(d => d.name).join(',') === 'public-key.pem,private-key.pem');
                lifeCheck('actual Blob bytes', await p.downloads[0].blob.text() === pub && await p.downloads[1].blob.text() === priv);
            }

            {
                lifeCheck('sensitive policy unchanged', p.ctx.ztPersist.policy(lifecycleSlug) === 'disabled');
                p.ctx.ztPersist.save(lifecycleSlug, { synthetic: 'QA' });
                lifeCheck('disabled policy rejects storage', !p.store.has('zt-input-' + lifecycleSlug));
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
            p.ctrlL('rkg-priv-out', order === 'shared-before' ? 'L' : 'l', order === 'shared-before' ? 'metaKey' : 'ctrlKey');
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
for (const boundary of ['generateKey', 'exportKey', 'exportKey:2'])
        for (const deny of [false, true])
            await attempt('crypto race/' + boundary + '/' + deny, async () => {
                const p = lifecyclePage('en', 'shared-before', boundary);
                p.change('rkg-algo', 'RSASSA-PKCS1-v1_5');
                p.change('rkg-format', 'jwk');
                p.get('rkg-generate').click();
                const until = Date.now() + 10000;
                while (!p.jobs.some(j => j.held)) {
                    if (Date.now() > until)
                        throw Error('crypto boundary timeout');
                    await new Promise(r => setTimeout(r, 10));
                }
                const old = p.jobs.find(j => j.held);
                await old.ready;
                old.deny = deny;
                p.ctrlL('rkg-generate');
                lifeCheck('clear busy crypto', emptyState(p));
                if (p.get('rkg-generate').disabled) {
                    old.release();
                    await p.done();
                    lifeCheck('cleared crypto must remain empty', emptyState(p));
                    return;
                }
                p.get('rkg-generate').click();
                const current = p.tasks.at(-1);
                await current;
                const pub = p.get('rkg-pub-out').value, priv = p.get('rkg-priv-out').value, status = p.get('rkg-status').textContent;
                old.release();
                await p.done();
                lifeCheck('late crypto completion/error ignores latest', p.get('rkg-pub-out').value === pub && p.get('rkg-priv-out').value === priv && p.get('rkg-status').textContent === status && !p.get('rkg-generate').disabled);
                const a = JSON.parse(pub), b = JSON.parse(priv), alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
                const pk = await nativeWebCrypto.subtle.importKey('jwk', a, alg, false, ['verify']), sk = await nativeWebCrypto.subtle.importKey('jwk', b, alg, false, ['sign']), msg = new TextEncoder().encode('B14 regression');
                const sig = await nativeWebCrypto.subtle.sign(alg, sk, msg);
                lifeCheck('actual JWK sign verify', await nativeWebCrypto.subtle.verify(alg, pk, sig, msg));
                lifeCheck('JWK exponent/pair', a.e === 'AQAB' && a.n === b.n);
            });
for (const deny of [false, true])
        await attempt('old finally while latest busy/' + deny, async () => {
            const p = lifecyclePage('en', 'shared-after', ['generateKey', 'generateKey']);
            p.get('rkg-generate').click();
            const wait = async (n) => { const until = Date.now() + 10000; while (p.jobs.filter(j => j.held).length < n) {
                if (Date.now() > until)
                    throw Error('crypto busy boundary timeout');
                await new Promise(r => setTimeout(r, 10));
            } return p.jobs.filter(j => j.held)[n - 1]; };
            const old = await wait(1);
            await old.ready;
            p.ctrlL('rkg-generate');
            if (p.get('rkg-generate').disabled) {
                lifeCheck('old busy clear re-enables Generate', false);
                old.release();
                await p.done();
                return;
            }
            p.get('rkg-generate').click();
            const current = await wait(2);
            await current.ready;
            const status = p.get('rkg-status').textContent;
            old.deny = deny;
            old.release();
            await p.tasks[0];
            lifeCheck('old finally/catch preserves new busy UI', p.get('rkg-generate').disabled && p.get('rkg-status').textContent === status && !p.get('rkg-pub-out').value && !p.get('rkg-priv-out').value);
            current.release();
            await p.done();
            lifeCheck('latest task still publishes', !!fullOutput(p) && !p.get('rkg-generate').disabled);
            p.get('rkg-keysize').value = '';
            p.get('rkg-generate').click();
            await p.done();
            lifeCheck('current crypto failure restores Generate', p.get('rkg-status').classList.contains('error') && !p.get('rkg-generate').disabled && !p.get('rkg-pub-out').value && !p.get('rkg-priv-out').value);
        });

// v2: the server-rendered rail, both key panes and reference-content steps.
const v2Check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} v2 ${name}`); if (ok) passes++; else failures++; };
const v2Region = source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/);
const v2Strings = v2Region ? vm.runInNewContext(v2Region[1] + ';STRINGS') : {};
const v2TipKeys = ['generate', 'size', 'algorithm', 'format', 'public', 'private'];
const v2Scripts = [...source.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map(m => m[0]).join('\n');
v2Check('tool root stays a flex column with zero minimum height', /\.rkg-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0/.test(source));
v2Check('300px rail is in the inner grid with a zero flex basis', /\.rkg-main\s*\{[^}]*grid-template-columns:\s*300px minmax\(0,\s*1fr\);[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0/.test(source));
v2Check('control rail uses the shared class', /<aside class="rkg-rail zt-rail">/.test(source));
v2Check('public/private outputs stay inside the bounded result pane', /class="rkg-results"[\s\S]*id="rkg-pub-out"[\s\S]*id="rkg-priv-out"/.test(source) && /\.rkg-results\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/.test(source));
v2Check('key textareas scroll internally with zero flex basis', /\.rkg-output\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;[^}]*overflow:\s*auto/.test(source));
v2Check('status has a stable two-line reservation', /\.rkg-status\s*\{[^}]*min-height:\s*2\.8em;[^}]*line-height:\s*1\.4/.test(source));
v2Check('desktop empty sentence is driven by actual output visibility', /\.rkg-results:has\(#rkg-pub-block\[style\*="none"\]\) > \.rkg-empty/.test(source));
v2Check('stacked empty pane is hidden and the grid stacks at 860', /@media \(max-width: 860px\)[\s\S]*\.rkg-main\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(source) && /\.rkg-results:has\(#rkg-pub-block\[style\*="none"\]\)\s*\{\s*display:\s*none/.test(source));
v2Check('phone main controls have 44px targets and tips have 24px targets', /@media \(max-width: 640px\)[\s\S]*min-height:\s*44px[\s\S]*min-width:\s*24px;\s*min-height:\s*24px/.test(source));
v2Check('all five business buttons are retained', ['rkg-generate','rkg-pub-copy','rkg-pub-dl','rkg-priv-copy','rkg-priv-dl'].every(id => source.includes(`id="${id}"`)));
v2Check('tips are HTML slots with unique stable IDs', v2TipKeys.every(k => source.includes(`id="rkg-tip-${k}"`) && source.includes(`>{U.tips.${k}}</Toggletip>`)) && (source.match(/<Toggletip\b/g) || []).length === 6);
v2Check('new UI strings are absent from the complete client scripts', !/\b(?:U|STRINGS)\b|rkg-tip-/.test(v2Scripts) && !source.includes('data-strings='));
// The privacy badge says what the page does (same facts as the FAQ privacy answer), not an absolute
// claim: copy and download leave copies outside the page.
const badgeText = {
    en: 'Keys are generated in this browser and are not uploaded or stored',
    zh: '密钥在浏览器中生成，不上传、不保存',
    ja: '鍵はブラウザ内で生成し、アップロードも保存もしません',
    ko: '키는 브라우저에서 생성되며 업로드하거나 저장하지 않습니다',
};
for (const lang of ['en','zh','ja','ko']) {
    const badge = lifecycleLabels(lang).badge;
    v2Check(lang + ' privacy badge states the concrete behaviour', badge === badgeText[lang] && !/never|不会离开|出ません|벗어나지/.test(badge));
}
for (const lang of ['en','zh','ja','ko']) {
    const labels = lifecycleLabels(lang), strings = v2Strings[lang];
    v2Check(lang + ' has a nonempty server-rendered empty sentence and six tips', !!strings?.empty && v2TipKeys.every(k => typeof strings?.tips?.[k] === 'string' && strings.tips[k].length > 0) && Object.keys(strings?.tips || {}).length === 6);
    const p = lifecyclePage(lang);
    v2Check(lang + ' actual Generate label binds through the unchanged data interface', p.get('rkg-generate').textContent === labels.generate && p.doc.querySelector('.rkg-wrap').dataset.generate === labels.generate);
    const mdx = readFileSync(join(root, 'src/content/tools/rsa-key-generator', lang + '.mdx'), 'utf8');
    const region = mdx.match(/\nsteps:\n([\s\S]*?)\nfaqItems:/);
    const steps = region ? [...region[1].matchAll(/^  - (.+)$/gm)].map(m => JSON.parse(m[1])) : [];
    v2Check(lang + ' five steps precede the unchanged FAQ', steps.length === 5 && steps.every(s => s.trim().length > 0 && s.length <= 280) && steps.join('').length <= 1200);
    v2Check(lang + ' Usage moved out of the body', !/<h2>(?:How to Use|使用方法|使用说明|使い方|사용 방법)<\/h2>/.test(mdx));
    v2Check(lang + ' privacy, security notes and limits stay visible in content', mdx.includes('PRIVATE KEY') && mdx.includes('AQAB') && mdx.includes('4096'));
}
const v2Compiler = await import(createRequire(lifecycleRequire.resolve('astro/package.json')).resolve('@astrojs/compiler'));
const v2Parsed = await v2Compiler.parse(source);
v2Check('Astro parser reports no diagnostics', v2Parsed.diagnostics.length === 0);
console.log('ASTRO diagnostics ' + JSON.stringify(v2Parsed.diagnostics));
if (process.env.ZT_B14_REGISTRATION_PENDING === '1') console.log('PENDING_ROOT v2 generate registration');
else v2Check('generate kind is registered', /['"]rsa-key-generator['"]\s*:\s*['"]generate['"]/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
await attempt('v2 real 2048 export reference example', async () => {
    const p = lifecyclePage('en');
    p.change('rkg-algo', 'RSASSA-PKCS1-v1_5');
    await generateReady(p);
    const publicPem = p.get('rkg-pub-out').value, privatePem = p.get('rkg-priv-out').value;
    const der = text => Buffer.from(text.split('\n').slice(1, -1).join(''), 'base64');
    const algorithm = {name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256'};
    const publicKey = await nativeWebCrypto.subtle.importKey('spki', der(publicPem), algorithm, true, ['verify']);
    const privateKey = await nativeWebCrypto.subtle.importKey('pkcs8', der(privatePem), algorithm, true, ['sign']);
    const publicJwk = await nativeWebCrypto.subtle.exportKey('jwk', publicKey), privateJwk = await nativeWebCrypto.subtle.exportKey('jwk', privateKey);
    v2Check('reference PEM headers and real modulus', publicPem.startsWith('-----BEGIN PUBLIC KEY-----') && privatePem.startsWith('-----BEGIN PRIVATE KEY-----') && privateKey.algorithm.modulusLength === 2048);
    v2Check('reference JWK corresponding modulus, exponent and private field', publicJwk.n === privateJwk.n && publicJwk.e === 'AQAB' && privateJwk.e === 'AQAB' && !('d' in publicJwk) && typeof privateJwk.d === 'string');
    const message = new TextEncoder().encode('ZeroTool RSA export example');
    const signature = await nativeWebCrypto.subtle.sign(algorithm, privateKey, message);
    v2Check('reference signature verifies the original message', await nativeWebCrypto.subtle.verify(algorithm, publicKey, signature, message));
    v2Check('reference signature rejects the changed message', !(await nativeWebCrypto.subtle.verify(algorithm, publicKey, signature, new TextEncoder().encode('ZeroTool RSA export changed'))));
    const english = readFileSync(join(root, 'src/content/tools/rsa-key-generator/en.mdx'), 'utf8');
    v2Check('the verified example is documented', english.includes('## Check a Generated Export Pair') && english.includes('ZeroTool RSA export example') && english.includes('ZeroTool RSA export changed'));
});

// Worked examples: {/* rkg-check: {...} */} in the four tool pages (S2-8). Keys are random, so
// each example states only the parts that every key of that size has. The spec names the options
// (size, algo, format, part) and the claimed facts; the real component generates three keys with
// those options and every claimed fact must hold for all three. Every claimed value must also be
// shown on the page after the annotation: exactly as inline code, or inside a code block.
// - PEM: header, footer, oneLine (Base64 length without line breaks), lines (Base64 lines),
//   lastLine (length of the last Base64 line), start, end.
// - JWK: the next code block equals the output with sorted keys (Chrome's order; see the LINE
//   example in ja) and `n` replaced by mask with {n} = its length; nLength is that length.
// - OpenSSH: sshPrefix / sshLength of the authorized_keys line built from the public key,
//   fpLength of the SHA256 fingerprint. When ssh-keygen is installed, `ssh-keygen -i -m PKCS8`
//   must print the same line and `ssh-keygen -l` must print "<bits> SHA256:<fp> <keygenTail>"
//   (temporary files in os.tmpdir(), removed after use); otherwise those two checks are skipped.
{
    const { toolMdxContract, annotations, fencedBlocks } = await import('./lib/tool-mdx-contract.mjs');
    const { execFileSync } = await import('node:child_process');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    let sshKeygen = true;
    try { execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' }); } catch (e) { sshKeygen = e.code !== 'ENOENT'; }
    if (!sshKeygen) console.log('SKIP rkg-check ssh-keygen comparison (ssh-keygen not installed)');
    const exampleRuns = new Map();
    async function runsFor(spec) {
        const key = [spec.size, spec.algo, spec.format].join('/');
        if (!exampleRuns.has(key)) {
            const runs = [];
            for (let i = 0; i < 3; i++) {
                const p = lifecyclePage('en');
                p.change('rkg-keysize', String(spec.size));
                p.change('rkg-algo', spec.algo);
                p.change('rkg-format', spec.format);
                await generateReady(p);
                runs.push({ public: p.get('rkg-pub-out').value, private: p.get('rkg-priv-out').value });
            }
            exampleRuns.set(key, runs);
        }
        return exampleRuns.get(key);
    }
    const sshString = b => { const h = Buffer.alloc(4); h.writeUInt32BE(b.length); return Buffer.concat([h, b]); };
    const mpint = b => (b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
    function sshLine(pem) {
        const jwk = cryptoProof.createPublicKey(pem).export({ format: 'jwk' });
        const blob = Buffer.concat([sshString(Buffer.from('ssh-rsa')), sshString(mpint(Buffer.from(jwk.e, 'base64url'))), sshString(mpint(Buffer.from(jwk.n, 'base64url')))]);
        return { line: 'ssh-rsa ' + blob.toString('base64'), fp: 'SHA256:' + cryptoProof.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '') };
    }
    const OPTION_KEYS = ['size', 'algo', 'format', 'part', 'mask'];
    async function verify({ spec, after }) {
        if (!spec) return 'annotation needs a JSON spec';
        const runs = await runsFor(spec);
        const texts = runs.map(r => r[spec.part === 'private' ? 'private' : 'public']);
        const blocks = fencedBlocks(after).map(b => b.text);
        const inline = [...after.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').matchAll(/`([^`\n]+)`/g)].map(m => m[1]);
        const problems = [];
        const same = (name, f) => { const values = texts.map(f); if (!values.every(v => v === spec[name])) problems.push(`${name}: claimed ${JSON.stringify(spec[name])}, generated ${JSON.stringify(values)}`); };
        if (spec.format === 'pem') {
            const parts = texts.map(t => { const l = t.split('\n'); return { header: l[0], footer: l.at(-1), body: l.slice(1, -1) }; });
            if (!parts.every(x => x.body.every(line => line.length <= 64))) problems.push('a PEM line is longer than 64 characters');
            for (const [name, f] of Object.entries({
                header: (_, i) => parts[i].header, footer: (_, i) => parts[i].footer, oneLine: (_, i) => parts[i].body.join('').length,
                lines: (_, i) => parts[i].body.length, lastLine: (_, i) => parts[i].body.at(-1).length,
            })) if (name in spec) same(name, f);
            if ('start' in spec && !parts.every(x => x.body.join('').startsWith(spec.start))) problems.push('start is not shared by every key');
            if ('end' in spec && !parts.every(x => x.body.join('').endsWith(spec.end))) problems.push('end is not shared by every key');
            if ('sshPrefix' in spec || 'sshLength' in spec || 'fpLength' in spec) {
                for (const pem of texts) {
                    const { line, fp } = sshLine(pem);
                    if ('sshPrefix' in spec && !line.startsWith(spec.sshPrefix)) problems.push('sshPrefix differs: ' + line.slice(0, 40));
                    if ('sshLength' in spec && line.length !== spec.sshLength) problems.push('sshLength ' + line.length);
                    if ('fpLength' in spec && fp.length - 'SHA256:'.length !== spec.fpLength) problems.push('fpLength ' + (fp.length - 7));
                    if (sshKeygen && 'keygenTail' in spec) {
                        const dir = mkdtempSync(join(tmpdir(), 'rkg-check-'));
                        try {
                            writeFileSync(join(dir, 'public-key.pem'), pem + '\n');
                            const converted = execFileSync('ssh-keygen', ['-i', '-m', 'PKCS8', '-f', join(dir, 'public-key.pem')]).toString().trim();
                            if (converted !== line) problems.push('ssh-keygen -i prints a different line');
                            writeFileSync(join(dir, 'public-key.pub'), converted + '\n');
                            const listed = execFileSync('ssh-keygen', ['-l', '-f', join(dir, 'public-key.pub')]).toString().trim();
                            if (listed !== `${spec.size} ${fp} ${spec.keygenTail}`) problems.push('ssh-keygen -l prints ' + listed);
                        } finally { rmSync(dir, { recursive: true, force: true }); }
                    }
                }
            }
        } else {
            const masked = texts.map(t => {
                const jwk = JSON.parse(t);
                const sorted = Object.fromEntries(Object.keys(jwk).sort().map(k => [k, k === 'n' ? spec.mask.replace('{n}', String(jwk.n.length)) : jwk[k]]));
                return JSON.stringify(sorted, null, 2);
            });
            if ('nLength' in spec) same('nLength', t => JSON.parse(t).n.length);
            if (!masked.every(m => m === masked[0])) problems.push('masked JWK differs between keys');
            if (blocks[0] !== masked[0]) problems.push('JWK block differs from the output:\n' + masked[0]);
        }
        for (const [k, v] of Object.entries(spec)) {
            if (OPTION_KEYS.includes(k)) continue;
            const s = String(v);
            if (!inline.includes(s) && !blocks.some(b => b.includes(s))) problems.push(`${k} value ${s} is not shown as code after the annotation`);
        }
        return problems.length ? problems.join('; ') : null;
    }
    // The contract (with at least 2 rkg-check examples per language); the examples themselves are
    // checked below because generating keys is asynchronous.
    const contract = toolMdxContract('rsa-key-generator', { annotations: [{ tag: 'rkg-check', min: 2, verify: () => null }] });
    for (const lang of ['en', 'zh', 'ja', 'ko']) {
        const own = contract.results.filter(r => !r.ok && (r.rule.startsWith(lang + ' ') || !['en', 'zh', 'ja', 'ko'].some(l => r.rule.startsWith(l + ' '))));
        v2Check(lang + ' MDX content contract' + (own.length ? ': ' + own.map(r => r.message).join('; ') : ''), own.length === 0);
        const notes = annotations(contract.docs[lang].body, 'rkg-check');
        for (const [i, note] of notes.entries()) {
            const problem = note.spec === undefined ? 'annotation JSON does not parse' : await verify(note);
            v2Check(`${lang} rkg-check #${i + 1} matches generated keys${problem ? ': ' + problem : ''}`, !problem);
        }
    }
    // The en page says the algorithm setting does not change the fixed SPKI bytes.
    const [oaep, pkcs] = [await runsFor({ size: 2048, algo: 'RSA-OAEP', format: 'pem' }), await runsFor({ size: 2048, algo: 'RSASSA-PKCS1-v1_5', format: 'pem' })];
    const head = t => t.split('\n').slice(1, -1).join('').slice(0, 44);
    v2Check('SPKI prefix is the same for both algorithms', [...oaep, ...pkcs].every(r => head(r.public) === 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA'));
}

process.removeListener('unhandledRejection', onUnhandled);
console.log(`LIFECYCLE ${lifecyclePass} passed, ${lifecycleFail} failed`);
console.log(`FINAL ${passes + lifecyclePass} passed, ${failures + lifecycleFail} failed`);
process.exitCode = failures + lifecycleFail ? 1 : 0;
