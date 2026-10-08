// Lorem Ipsum Generator — sentence pool, classic paragraph and the numbers quoted in the guide
//
// Read:  src/components/tools/LoremIpsumTool.astro (SENTENCES, CLASSIC_START, the paragraph and
//        count rules); scripts/test-lorem-ipsum.fixtures.json (Latin of De finibus 1.32–33 from the
//        1914 Loeb edition and from The Latin Library, English letter frequencies from Norvig);
//        src/content/blog/lorem-ipsum-generator-guide/en.mdx (`lorem-*` annotations and tables)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the classic paragraph is the first five pool sentences joined (69 words, 445
// characters); paragraph size 3–6 sentences and the 1–20 count clamp with default 5 as written
// in the component; the guide's word mapping (each lorem word is in the classic paragraph, each
// Cicero word in the Loeb text), the 41 of 69 words found unchanged in sections 32–33, the
// edition spellings (eiusmodi / occaecati in Loeb, obcaecati in The Latin Library), the letter
// statistics table against the classic paragraph and Norvig's English counts, the pool figures
// (8–17 words per sentence, 26–89 words per paragraph, 104 distinct words in the 15 extra
// sentences, 20 of them in Cicero). The guide's Python block (`lorem-run-py`) runs when python3
// is installed and must print 69 and the 12-word sentence quoted below it.
//
// Run: node scripts/test-lorem-ipsum.mjs

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/LoremIpsumTool.astro'), 'utf8');
const fx = JSON.parse(readFileSync(join(root, 'scripts/test-lorem-ipsum.fixtures.json'), 'utf8'));
const guide = readFileSync(join(root, 'src/content/blog/lorem-ipsum-generator-guide/en.mdx'), 'utf8');
const body = guide.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail !== undefined ? ' — ' + detail : '')); }
}
const ann = (name) => [...guide.matchAll(new RegExp('\\{/\\* ' + name + ': (\\{.*?\\}) \\*/\\}', 'g'))].map((m) => JSON.parse(m[1]));
const tokens = (s) => s.toLowerCase().match(/[a-z]+/g) || [];

const poolBlock = source.match(/var SENTENCES = \[([\s\S]*?)\];/);
const SENTENCES = poolBlock ? [...poolBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
const CLASSIC = (source.match(/var CLASSIC_START = '([^']+)';/) || [])[1] || '';
check('sentence pool found', SENTENCES.length > 0, String(SENTENCES.length));
check('classic paragraph found', CLASSIC.length > 0);
check('classic paragraph = first five pool sentences', SENTENCES.slice(0, 5).join(' ') === CLASSIC);
check('paragraph uses 3–6 sentences', source.includes('var count = 3 + Math.floor(Math.random() * 4);'));
check('count clamped to 1–20, default 5', source.includes("var count = Math.min(20, Math.max(1, Math.trunc(Number(typed)) || 5));") && source.includes("var typed = countEl.value;"));
check('Copy All joins paragraphs with a blank line', source.includes("output.dataset.text = paragraphs.join('\\n\\n');"));

const loebSet = new Set(tokens(fx.loeb1914.text));
const llSet = new Set(tokens(fx.latinLibrary.text));
const classicWords = tokens(CLASSIC);

for (const c of ann('lorem-classic')) {
  check(`classic paragraph has ${c.words} words`, classicWords.length === c.words, String(classicWords.length));
  check(`classic paragraph has ${c.chars} characters`, CLASSIC.length === c.chars, String(CLASSIC.length));
  check(`classic paragraph has ${c.sentences} sentences`, CLASSIC.split(/(?<=\.)\s+/).length === c.sentences);
  check('tool writes "elit. Sed" where the canonical text has "elit, sed"', CLASSIC.includes('elit. Sed do eiusmod') && body.includes('"elit, sed"'));
}
for (const c of ann('lorem-stat')) {
  const verbatim = classicWords.filter((w) => loebSet.has(w)).length;
  check(`${c.verbatim} of ${c.words} classic words occur in sections 32–33`, verbatim === c.verbatim && classicWords.length === c.words, String(verbatim));
  check('guide states the counts', body.includes(`Of its ${c.words} words, ${c.verbatim} appear unchanged`));
}
const maps = ann('lorem-map');
check('guide has the word mapping', maps.length >= 15, String(maps.length));
for (const m of maps) {
  check(`lorem "${m.lorem}" is in the classic paragraph`, classicWords.includes(m.lorem));
  check(`Cicero "${m.cicero}" is in the Loeb text`, loebSet.has(m.cicero));
  check(`"${m.lorem}" is not itself in the Loeb text`, !loebSet.has(m.lorem));
  check(`mapping table row for ${m.lorem}`, new RegExp('\\|[^|\\n]*\\b' + m.lorem + '\\b[^|\\n]*\\|[^|\\n]*' + m.cicero.replace(/^do/, '(?:\\(do\\))?') + '\\b', 'i').test(body));
}
const pb = fx.loeb1914.pageBreak;
check('page break text matches the Loeb Latin', fx.loeb1914.text.includes(pb.endsWith.replace(/-$/, '') + 'lorem ipsum quia dolor sit amet, consectetur, adipisci'));
check('guide quotes the page break', body.includes(pb.endsWith) && body.includes(pb.nextStartsWith.replace(' adipisci', ' adipisci velit')));
for (const e of ann('lorem-ed')) {
  check(`${e.word} in Loeb = ${e.loeb}`, loebSet.has(e.word) === e.loeb);
  check(`${e.word} in The Latin Library = ${e.latinLibrary}`, llSet.has(e.word) === e.latinLibrary);
}
check('The Latin Library splits "eius modi"', fx.latinLibrary.text.includes('non numquam eius modi') && fx.loeb1914.text.includes('nonnumquam eiusmodi'));

for (const c of ann('lorem-letters')) {
  const letters = CLASSIC.toLowerCase().replace(/[^a-z]/g, '');
  const pct = (ch) => ((letters.split(ch).length - 1) / letters.length * 100).toFixed(1);
  const missing = 'abcdefghijklmnopqrstuvwxyz'.split('').filter((ch) => !letters.includes(ch)).join('');
  check(`letters missing from the classic paragraph: ${c.missing}`, missing === c.missing, missing);
  for (const ch of ['h', 'u', 'q', 'i']) {
    check(`classic ${ch} = ${c[ch]}%`, pct(ch) === c[ch], pct(ch));
    check(`guide row ${ch}: ${c[ch]}% vs English ${fx.english.percent[ch]}%`, new RegExp('\\| ' + ch + ' \\| ' + c[ch].replace('.', '\\.') + '% \\| ' + String(fx.english.percent[ch]).replace('.', '\\.') + '% \\|').test(body));
  }
  const avg = (classicWords.join('').length / classicWords.length).toFixed(2);
  check(`classic average word length ${c.avg}`, avg === c.avg, avg);
  check('guide shows English average 4.79', body.includes(`${c.avg} letters | ${fx.english.avgWordLength} letters`));
  const longest = classicWords.reduce((a, w) => (w.length > a.length ? w : a), '');
  check(`longest classic word ${c.longest}`, longest === c.longest && body.includes(`${longest.length} letters (*${longest}*)`), longest);
}
for (const c of ann('lorem-pool')) {
  const lens = SENTENCES.map((s) => tokens(s).length).sort((a, b) => a - b);
  check(`pool has ${c.sentences} sentences`, SENTENCES.length === c.sentences);
  check(`pool starts with the ${c.classic} classic sentences`, SENTENCES.slice(0, c.classic).join(' ') === CLASSIC);
  check(`sentences are ${c.minWords}–${c.maxWords} words`, lens[0] === c.minWords && lens[lens.length - 1] === c.maxWords, lens.join(','));
  const min = lens.slice(0, c.perParagraph[0]).reduce((a, b) => a + b, 0);
  const max = lens.slice(-c.perParagraph[1]).reduce((a, b) => a + b, 0);
  check(`paragraph is ${c.paraMin}–${c.paraMax} words`, min === c.paraMin && max === c.paraMax, `${min}–${max}`);
  const extra = new Set(SENTENCES.slice(c.classic).flatMap(tokens));
  const inCicero = [...extra].filter((w) => loebSet.has(w)).length;
  check(`extra sentences use ${c.extraDistinct} distinct words`, extra.size === c.extraDistinct, String(extra.size));
  check(`${c.extraInCicero} of them occur in sections 32–33`, inCicero === c.extraInCicero, String(inCicero));
  check('Pellentesque sentence quoted from the pool', SENTENCES.includes('Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.') && body.includes('"Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas."'));
}

const py = guide.match(/\{\/\* lorem-run-py \*\/\}\s*```python\n([\s\S]*?)```/);
check('Python block found', !!py);
let havePy = true;
try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); } catch { havePy = false; }
if (py && havePy) {
  const out = execFileSync('python3', ['-c', py[1]], { encoding: 'utf8' }).trim().split('\n');
  check('Python block prints 69', out[0] === '69', out[0]);
  check('Python block prints the 12-word sentence', out[1] === 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.', out[1]);
  check('guide quotes the Python output', body.includes('`' + out[1] + '`'));
} else if (!havePy) {
  console.log('SKIP Python block (python3 not installed)');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode=failures ? 1 : 0;

// Correctness regression: complete actual component scripts and ToolLayout shortcut in both orders.
// DOM parsing uses parse5. WebCrypto and the local Nano ID vendor remain real. Only delivery,
// clipboard, timers and anchor download destinations are controlled in memory. No system clipboard.
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { loadPage, frontmatterStrings } from './astro-page-harness.mjs';
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
    const fm = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] || '';
    const all = frontmatterStrings(fm) || vm.runInNewContext('(' + source.match(/var STRINGS = (\{[\s\S]*?\n\s*\});/)[1] + ')');
    return all[lang] || all.en;
}
const lifecycleSlug = "lorem-ipsum", lifecyclePath = "src/components/tools/LoremIpsumTool.astro", lifecyclePrefix = "li";
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
    if (source.includes('const clientStrings =')) {
        const clientStrings = vm.runInNewContext('(' + source.match(/const clientStrings = (\{[^\n]*\});/)[1] + ')', { L });
        markup = markup.replace(/=\{JSON.stringify\(clientStrings\)\}/g, '="' + escape(JSON.stringify(clientStrings)) + '"')
            .replace(/<Toggletip\b[^>]*>[\s\S]*?<\/Toggletip>/g, '');
    }
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
function labelsFor(p) { return lifecycleLabels(p.doc.documentElement.lang); }
function fullOutput(p) { return p.get('li-output').dataset.text || ''; }
function targets(p) { return [{ b: p.get('li-copy'), text: () => fullOutput(p), success: labelsFor(p).copied, restore: labelsFor(p).copyAll, delay: 1500 }]; }
const expectedCopyFailure = { en: 'Copy failed. Try again.', zh: '复制失败，请重试。', ja: 'コピーに失敗しました。再試行してください。', ko: '복사하지 못했습니다. 다시 시도하세요.' };
const feedback = t => t.b.textContent;
async function generateReady(p) { p.get(lifecyclePrefix + '-generate').click(); }
function emptyState(p) { return !p.get('li-output').children.length && !p.get('li-output').dataset.text; }
const controlIds = ['li-count', 'li-start-classic'];
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
                lifeCheck('full paragraph cache', fullOutput(p) === p.get('li-output').children.map(x => x.textContent).join('\n\n'));
                const old = fullOutput(p);
                p.input('li-count', '2');
                lifeCheck('count is manual', fullOutput(p) === old);
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
            p.ctrlL('li-generate', order === 'shared-before' ? 'L' : 'l', order === 'shared-before' ? 'metaKey' : 'ctrlKey');
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

// Analytics and the paragraph count (2026-10-08): loading the page generates once without an
// event; each click on Generate records one `generate`. A count outside 1–20 or not a whole
// number is still moved into the range (empty or 0 gives 5, as before), but the field then shows
// the number used and a note says so, in the page language.
for (const lang of ['en', 'zh', 'ja', 'ko'])
    await attempt(lang + '/count-and-analytics', async () => {
        const p = lifecyclePage(lang);
        const L = lifecycleLabels(lang);
        lifeCheck(lang + '/load generates without an event', !!fullOutput(p) && p.tracks.length === 0);
        p.get('li-generate').click();
        lifeCheck(lang + '/Generate records one event', JSON.stringify(p.tracks) === '[["lorem_ipsum","generate"]]');
        const note = () => p.get('li-count-note').textContent;
        lifeCheck(lang + '/note text exists', typeof L.countNote === 'string' && L.countNote.includes('{n}'));
        for (const [typed, used] of [['0', 5], ['', 5], ['50', 20], ['-3', 1], ['2.5', 2], ['3', 3], ['20', 20], ['1', 1], ['03', 3], ['1e1', 10], ['0.5', 5], ['-2.7', 1], ['19.9', 19]]) {
            p.get('li-count').value = typed;
            p.get('li-generate').click();
            const paras = p.get('li-output').children.length;
            lifeCheck(`${lang}/count "${typed}" gives ${used} paragraphs`, paras === used && fullOutput(p).split('\n\n').length === used);
            const valid = typed !== '' && Number(typed) === used;
            lifeCheck(`${lang}/count "${typed}" field shows ${used}`, p.get('li-count').value === (valid ? typed : String(used)));
            lifeCheck(`${lang}/count "${typed}" note`, note() === (valid ? '' : L.countNote.replace('{n}', String(used))));
        }
        p.get('li-count').value = '0';
        p.get('li-generate').click();
        lifeCheck(lang + '/note before clear', note() !== '');
        p.ctrlL('li-generate');
        lifeCheck(lang + '/Ctrl+L clears the note', note() === '');
    });

process.removeListener('unhandledRejection', onUnhandled);
console.log(`LIFECYCLE ${lifecyclePass} passed, ${lifecycleFail} failed`);
console.log(`FINAL ${passes + lifecyclePass} passed, ${failures + lifecycleFail} failed`);
process.exitCode = failures + lifecycleFail ? 1 : 0;

// v2 page layout: source bindings, real four-language controls and structured usage.
const featureTips = ['count', 'classic', 'generate', 'copy'];
const featureFM = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] || '';
const featureStrings = frontmatterStrings(featureFM);
lifeCheck('v2 direct tool root', /^<div class="li-wrap"/.test(source.replace(/^---[\s\S]*?---\s*/, '')));
lifeCheck('v2 shared generate rail', /<aside class="li-rail zt-rail">/.test(source));
const featureStructure = lifecyclePage('en');
lifeCheck('v2 grid lives inside direct flex root', featureStructure.doc.querySelector('.li-main')?.parentNode.classList.contains('li-wrap') && featureStructure.doc.querySelector('.li-rail')?.parentNode.classList.contains('li-main') && featureStructure.doc.querySelector('.li-results')?.parentNode.classList.contains('li-main'));
lifeCheck('v2 result separated from controls', source.indexOf('<section class="li-results"') > source.indexOf('</aside>'));
lifeCheck('v2 no runtime UI translation', !source.includes('data-i18n') && !source.match(/<script[\s\S]*var STRINGS/));
const { load: featureYAML } = lifecycleRequire('js-yaml');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const p = lifecyclePage(lang);
    const L = featureStrings?.[lang];
    lifeCheck(lang + '/SSR generate label', p.get('li-generate').textContent === L?.generate);
    lifeCheck(lang + '/SSR copy label', p.get('li-copy').textContent === L?.copyAll);
    lifeCheck(lang + '/SSR number label', p.doc.querySelector('label[for="li-count"]').textContent === L?.paragraphs);
    lifeCheck(lang + '/SSR classic label', p.doc.querySelector('.li-checkbox-label span').textContent === L?.startClassic);
    lifeCheck(lang + '/four-language empty sentence', typeof L?.empty === 'string' && L.empty.length > 0 && source.includes('{L.empty}'));
    lifeCheck(lang + '/copy feedback precedes result', p.get('li-copy').closest('.li-status')?.getAttribute('role') === 'status' && p.get('li-copy').closest('.li-rail') !== null);
    const client = JSON.parse(p.doc.querySelector('.li-wrap').dataset.strings);
    lifeCheck(lang + '/only required dynamic strings sent', Object.keys(client).sort().join(',') === 'copied,copyAll,copyFailed,countNote' && !Object.hasOwn(client, 'tips'));
    for (const key of featureTips) {
        lifeCheck(lang + '/tip ' + key + ' is SSR-bound', typeof L?.tips?.[key] === 'string' && L.tips[key].length > 0 && source.includes('id="li-tip-' + key + '"') && source.includes('{L.tips.' + key + '}</Toggletip>'));
    }
    const mdx = readFileSync(join(root, 'src/content/tools/lorem-ipsum/' + lang + '.mdx'), 'utf8');
    const meta = featureYAML(/^---\n([\s\S]*?)\n---/.exec(mdx)[1]);
    lifeCheck(lang + '/steps bounded', Array.isArray(meta.steps) && meta.steps.length > 0 && meta.steps.length <= 8 && meta.steps.every(x => typeof x === 'string' && x.length <= 280) && meta.steps.join('').length <= 1200);
    lifeCheck(lang + '/Usage moved and FAQ retained', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx) && Array.isArray(meta.faqItems) && meta.faqItems.length > 0);
}
const featureLayouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
if (/'lorem-ipsum':\s*'generate'/.test(featureLayouts)) lifeCheck('v2 generate registration', true);
else console.log('PENDING_ROOT lorem-ipsum generate registration (not counted as PASS)');
console.log(`FEATURE FINAL ${passes + lifecyclePass} passed, ${failures + lifecycleFail} failed`);
process.exitCode = failures + lifecycleFail ? 1 : 0;

// ── Tool pages: `li-check` worked examples and the MDX contract ─────────────────────
// Annotation {/* li-check: {"case": …, "show": [keys]} */}: the listed values are recomputed from
// the component (sentence pool, classic paragraph, count rule and the four-language note) and each
// must be the whole text of an inline code span (`…` or <code>…</code>) or code block after the annotation (before the
// next li-check annotation or H2). Random paragraphs are not recomputed; their bounds are.
//   classic                      text, words (69), chars (445), sentences (5)
//   prefix {k}                   text and chars of the first k classic sentences
//   fit {limit}                  k = most classic sentences within limit characters, chars, next
//   output {paragraphs, classic} wordsMin/wordsMax and charsMin/charsMax of the Copy All text
//                                (paragraphs joined with a blank line; ASCII, so bytes = chars)
//   average {paragraphs, classic} expected words (4.5 sentences × mean sentence length), rounded
//   count {typed}                used and note: run the page, type the value, click Generate
//   cjkBytes {bytes}             chars = how many 3-byte UTF-8 characters fit in bytes
//   xWeight {text}               weighted length under twitter-text config v3 (weight 1 for
//                                U+0000–10FF, U+2000–200D, U+2010–201F, U+2032–2037, else 2)
import { contractProblems, fencedBlocks } from './lib/tool-mdx-contract.mjs';
const SENT = SENTENCES.slice(0, 5).join(' ') === CLASSIC ? CLASSIC.split(/(?<=\.)\s+/) : [];
const wordLens = SENTENCES.map((x) => tokens(x).length).sort((a, b) => a - b);
const charLens = SENTENCES.map((x) => x.length).sort((a, b) => a - b);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const para = { wMin: sum(wordLens.slice(0, 3)), wMax: sum(wordLens.slice(-6)), cMin: sum(charLens.slice(0, 3)) + 2, cMax: sum(charLens.slice(-6)) + 5 };
const meanWords = sum(wordLens) / wordLens.length;
const X_RANGES = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const xWeight = (text) => [...text].reduce((n, ch) => n + (X_RANGES.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b) ? 1 : 2), 0);
const prefixOf = (k) => SENT.slice(0, k).join(' ');
function liValues(spec, lang) {
  switch (spec.case) {
    case 'classic': return { text: CLASSIC, words: tokens(CLASSIC).length, chars: CLASSIC.length, sentences: SENT.length };
    case 'prefix': return { text: prefixOf(spec.k), chars: prefixOf(spec.k).length };
    case 'fit': { let k = 0; while (k < SENT.length && prefixOf(k + 1).length <= spec.limit) k++; return { k, chars: prefixOf(k).length, next: prefixOf(k + 1).length }; }
    case 'output': {
      const n = spec.paragraphs, first = spec.classic ? 1 : 0, rest = n - first, sep = 2 * (n - 1);
      return { wordsMin: first * tokens(CLASSIC).length + rest * para.wMin, wordsMax: first * tokens(CLASSIC).length + rest * para.wMax,
        charsMin: first * CLASSIC.length + rest * para.cMin + sep, charsMax: first * CLASSIC.length + rest * para.cMax + sep };
    }
    case 'average': { const n = spec.paragraphs, first = spec.classic ? 1 : 0; return { words: Math.round(first * tokens(CLASSIC).length + (n - first) * 4.5 * meanWords) }; }
    case 'count': {
      const p = lifecyclePage(lang);
      p.get('li-count').value = spec.typed;
      p.get('li-generate').click();
      return { used: Number(p.get('li-count').value), paragraphs: p.get('li-output').children.length, note: p.get('li-count-note').textContent };
    }
    case 'cjkBytes': return { chars: Math.floor(spec.bytes / Buffer.byteLength('汉', 'utf8')) };
    case 'xWeight': return { weight: xWeight(spec.text) };
    default: throw Error('unknown case ' + spec.case);
  }
}
function liRegion(body, index) {
  let rest = body.slice(body.indexOf('*/}', index) + 3);
  const next = rest.indexOf('{/* li-check');
  if (next >= 0) rest = rest.slice(0, next);
  const masked = rest.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, (m) => m.replace(/[^\n]/g, ' '));
  const h2 = masked.search(/^(?:##[ \t]|<h2\b)/m);
  return h2 < 0 ? rest : rest.slice(0, h2);
}
function liVerify({ spec, body, index, lang }) {
  if (!spec || !Array.isArray(spec.show) || !spec.show.length) return 'annotation needs "case" and "show"';
  const values = liValues(spec, lang), region = liRegion(body, index);
  const shown = new Set([...region.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).concat(fencedBlocks(region).map((b) => b.text))
    .concat([...region.matchAll(/<code>([^<]*)<\/code>/g)].map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))));
  for (const key of spec.show) {
    if (!(key in values)) return 'no value ' + key;
    if (!shown.has(String(values[key]))) return `${key} = ${JSON.stringify(values[key])} is not shown as code`;
  }
  return null;
}
let pagePass = 0, pageFail = 0;
function pageCheck(name, ok, detail) { if (ok) pagePass++; else { pageFail++; console.log('FAIL page ' + name + (detail ? ' — ' + detail : '')); } }
pageCheck('pool bounds match the guide figures', para.wMin === 26 && para.wMax === 89, JSON.stringify(para));
pageCheck('verifier rejects a wrong value', liVerify({ spec: { case: 'classic', show: ['chars'] }, body: '{/* li-check */}\n`444`\n', index: 0, lang: 'en' }) !== null);
pageCheck('verifier accepts the right value', liVerify({ spec: { case: 'classic', show: ['chars'] }, body: '{/* li-check */}\n`445`\n', index: 0, lang: 'en' }) === null);
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const problems = contractProblems('lorem-ipsum', lang, { annotations: [{ tag: 'li-check', min: 2, verify: liVerify }] });
  pageCheck(lang + ' MDX content contract and li-check examples', problems === '', problems);
}
console.log(`PAGES ${pagePass} passed, ${pageFail} failed`);
console.log(`ALL ${passes + lifecyclePass + pagePass} passed, ${failures + lifecycleFail + pageFail} failed`);
process.exitCode = failures + lifecycleFail + pageFail ? 1 : 0;
