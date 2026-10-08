// Password Generator — character sets, uniform sampling, strength labels
//
// Read:  src/components/tools/PasswordGeneratorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, and the STRINGS table);
//        src/content/blog/password-generator-guide/{en,ja}.mdx (`pw-*` annotations, code blocks)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: charset sizes for each option combination (88 with all four sets, 83 with
// "Exclude ambiguous"); genPassword draws again when a 32-bit value is at or above the
// largest multiple of the charset size (before the fix it used value % size, which made
// the first 4294967296 % size characters slightly more likely); length and charset of
// the output; a chi-square check on 176,000 characters; strength thresholds and the bit
// counts quoted on the en tool page; STRINGS has the same keys in all four languages,
// including the five strength labels (before the fix they were English on every page); the four
// tool pages (src/content/tools/password-generator/{lang}.mdx): MDX contract plus `pwg-meter` /
// `pwg-miss` worked examples recomputed with the engine and the page-language meter text; Copy writes
// nothing while no password is shown, in every language (it used to compare with English text).
//
// Run: node scripts/test-password-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/PasswordGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in PasswordGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const load = (cryptoImpl) =>
  new Function('crypto', block + '\nreturn { charsetFor, genPassword, strengthInfo, SYMBOLS };')(cryptoImpl);
const E = load(globalThis.crypto);

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')); }
}

// Charset sizes
const all = { upper: true, lower: true, digits: true, symbols: true, ambiguous: false };
check('all four sets = 88 characters', E.charsetFor(all).length === 88, String(E.charsetFor(all).length));
check('symbol set is 26 characters', E.SYMBOLS.length === 26);
const noAmb = E.charsetFor({ ...all, ambiguous: true });
check('exclude ambiguous = 83 characters', noAmb.length === 83, String(noAmb.length));
check('exclude ambiguous removes 0 O l 1 I', !/[0Ol1I]/.test(noAmb));
check('lowercase + digits = 36', E.charsetFor({ lower: true, digits: true }).length === 36);
check('no set selected = empty', E.charsetFor({}) === '');
check('charset has no duplicates', new Set(E.charsetFor(all)).size === 88);

// Output length and alphabet
for (const len of [4, 20, 128]) {
  const pw = E.genPassword(len, E.charsetFor(all));
  check('length ' + len, pw.length === len, String(pw.length));
}
const digitsOnly = E.genPassword(200, '0123456789');
check('only charset characters', /^[0-9]{200}$/.test(digitsOnly));
check('empty charset returns empty string', E.genPassword(10, '') === '');

// Rejection sampling with a scripted random source
const n = 88;
const limit = 4294967296 - (4294967296 % n);
const scripted = [limit, 4294967295, 0, limit - 1, 5];
let pos = 0;
const fake = {
  getRandomValues(arr) {
    for (let i = 0; i < arr.length; i++) arr[i] = scripted[pos++ % scripted.length];
    return arr;
  },
};
const F = load(fake);
const cs = F.charsetFor(all);
const out = F.genPassword(3, cs);
check('values >= limit are rejected', out === cs[0] + cs[(limit - 1) % n] + cs[5], JSON.stringify(out));
check('limit is a multiple of 88', limit % n === 0);

// Uniformity: chi-square over 176,000 draws (88 bins, 2000 expected each)
const counts = new Map();
let big = '';
for (let i = 0; i < 1375; i++) big += E.genPassword(128, cs);
for (const ch of big) counts.set(ch, (counts.get(ch) || 0) + 1);
let chi = 0;
for (const ch of cs) { const c = counts.get(ch) || 0; chi += (c - 2000) ** 2 / 2000; }
// df = 87; p = 0.0001 critical value is about 144
check('chi-square over 88 characters < 144', chi < 144, chi.toFixed(1));

// Strength thresholds and the numbers on the en page
const bits = (len, size) => len * Math.log2(size);
const cases = [
  [20, 88, 129, 'veryStrong'],
  [16, 83, 102, 'veryStrong'],
  [12, 36, 62, 'fair'],
  [8, 88, 52, 'weak'],
  [14, 62, 83, 'strong'],
  [6, 26, 28, 'veryWeak'],
];
for (const [len, size, rounded, key] of cases) {
  const b = bits(len, size);
  check(`${len} chars from ${size} = ${rounded} bits`, Math.round(b) === rounded, b.toFixed(2));
  check(`${len} chars from ${size} is ${key}`, E.strengthInfo(b).key === key, E.strengthInfo(b).key);
}
check('80 bits is Strong', E.strengthInfo(80).key === 'strong');
check('79.9 bits is Fair', E.strengthInfo(79.9).key === 'fair');
check('100 bits is Very Strong', E.strengthInfo(100).key === 'veryStrong');

// STRINGS
const sm = source.match(/(?:var|const) STRINGS = (\{[\s\S]*?\n\s*\});/);
check('STRINGS table found', !!sm);
if (sm) {
  const S = new Function('return ' + sm[1])();
  const keys = Object.keys(S.en).sort().join(',');
  for (const lang of ['zh', 'ja', 'ko']) {
    check(lang + ' STRINGS keys match en', Object.keys(S[lang]).sort().join(',') === keys);
  }
  for (const key of ['veryWeak', 'weak', 'fair', 'strong', 'veryStrong']) {
    check('strength label ' + key + ' in all languages', ['en', 'zh', 'ja', 'ko'].every((l) => S[l][key]));
  }
}

// ── password-generator-guide (en, ja) ──────────────────────────────────────────────────
// Annotations in the guides are recomputed here: `pw-bits` (length × log2 size to 1 decimal,
// and the generator's strength label), `pw-set` (charset size for an option combination),
// `pw-time` (size^length / guesses per second, in the stated unit), `pw-dice` (words ×
// log2 7776), `pw-miss` (chance that a password from the four-set charset has no digit /
// lacks at least one of the four sets, inclusion–exclusion over the generator's set sizes),
// `pw-sha1` (SHA-1 shown for a breach lookup), `pw-bias` (256 % 88 and the 3:2 frequency
// ratio of byte % 88), `pw-nfc` (NFC / NFKC of a full-width string), `pw-utf8` (characters and
// UTF-8 bytes). The en JavaScript block marked `pw-run-js` is executed with Node's Web Crypto;
// the en Python block marked `pw-run-py` runs when python3 is installed.
{
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const stripComments = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const sizeOf = { upper: 26, lower: 26, digits: 10, symbols: E.SYMBOLS.length };
  const fmtCheck = (computed, value) => {
    const v = Number(value.replace(/,/g, ''));
    const dec = value.includes('.') ? value.split('.')[1].length : 0;
    if (dec > 0) return computed.toFixed(dec) === value.replace(/,/g, '');
    if (/00$/.test(value)) return Math.abs(computed - v) / v < 0.005;
    return Math.round(computed) === v;
  };
  const YEAR = 365.25 * 86400;
  const units = { seconds: 1, hours: 3600, years: YEAR, millionYears: YEAR * 1e6, billionYears: YEAR * 1e9 };
  for (const lang of ['en', 'ja']) {
    const guide = readFileSync(join(root, `src/content/blog/password-generator-guide/${lang}.mdx`), 'utf8');
    const body = stripComments(guide);
    const ann = (name) => [...guide.matchAll(new RegExp('\\{/\\* ' + name + ': (\\{.*?\\}) \\*/\\}', 'g'))].map((m) => JSON.parse(m[1]));
    const bitsList = ann('pw-bits');
    check(lang + ' guide has pw-bits annotations', bitsList.length >= 6, String(bitsList.length));
    for (const c of bitsList) {
      const b = bits(c.len, c.size);
      check(`${lang} ${c.len} chars from ${c.size} = ${c.bits} bits`, b.toFixed(1) === c.bits, b.toFixed(3));
      check(`${lang} guide shows ${c.bits}`, body.includes(c.bits));
      if (c.label) check(`${lang} ${c.len} chars from ${c.size} labelled ${c.label}`, E.strengthInfo(b).key === c.label, E.strengthInfo(b).key);
    }
    for (const c of ann('pw-set')) {
      const o = Object.fromEntries(c.opts.map((k) => [k, true]));
      check(`${lang} charset ${c.opts.join('+')} = ${c.size}`, E.charsetFor(o).length === c.size, String(E.charsetFor(o).length));
    }
    for (const c of ann('pw-time')) {
      const t = Math.pow(c.size, c.len) / c.rate / units[c.unit];
      check(`${lang} ${c.len} chars from ${c.size} at ${c.rate}/s = ${c.value} ${c.unit}`, fmtCheck(t, c.value), String(t));
    }
    for (const c of ann('pw-dice')) {
      const b = c.words * Math.log2(7776);
      check(`${lang} ${c.words} Diceware words = ${c.bits} bits`, b.toFixed(1) === c.bits, b.toFixed(3));
    }
    const missList = ann('pw-miss');
    check(lang + ' guide has pw-miss annotations', missList.length >= 1);
    for (const c of missList) {
      const keys = Object.keys(sizeOf);
      const N = keys.reduce((a, k) => a + sizeOf[k], 0);
      check(lang + ' four-set charset is 88', N === 88 && E.charsetFor(all).length === N);
      let any = 0;
      for (let m = 1; m < 16; m++) {
        const sub = keys.filter((_, i) => (m >> i) & 1);
        const sz = sub.reduce((a, k) => a + sizeOf[k], 0);
        any += (sub.length % 2 ? 1 : -1) * Math.pow((N - sz) / N, c.len);
      }
      check(`${lang} ${c.len} chars: some set missing ${c.anyMissing}%`, (any * 100).toFixed(1) === c.anyMissing, (any * 100).toFixed(3));
      if (c.noDigit) {
        const nd = Math.pow((N - sizeOf.digits) / N, c.len) * 100;
        check(`${lang} ${c.len} chars: no digit ${c.noDigit}%`, nd.toFixed(1) === c.noDigit, nd.toFixed(3));
      }
    }
    for (const c of ann('pw-sha1')) {
      check(`${lang} SHA-1 of ${c.pw}`, createHash('sha1').update(c.pw).digest('hex').toUpperCase() === c.sha1);
      check(`${lang} guide shows ${c.pw}`, body.includes('`' + c.pw + '`'));
    }
    for (const c of ann('pw-bias')) {
      check(`${lang} 256 % 88 = ${c.byteRemainder}`, 256 % 88 === c.byteRemainder);
      check(`${lang} byte % 88 frequency ratio ${c.ratio}`, Math.ceil(256 / 88) / Math.floor(256 / 88) === c.ratio);
    }
    for (const c of ann('pw-nfc')) {
      check(`${lang} NFC of ${c.in}`, c.in.normalize('NFC') === c.nfc);
      check(`${lang} NFKC of ${c.in}`, c.in.normalize('NFKC') === c.nfkc);
    }
    for (const c of ann('pw-utf8')) {
      check(`${lang} ${c.text} has ${c.chars} characters`, [...c.text].length === c.chars);
      check(`${lang} ${c.text} is ${c.bytes} UTF-8 bytes`, Buffer.byteLength(c.text, 'utf8') === c.bytes);
    }
    check(`${lang} guide lists the generator's symbols`, body.includes('`' + E.SYMBOLS + '`'));
    if (lang === 'en') {
      const js = guide.match(/\{\/\* pw-run-js \*\/\}\s*```js\n([\s\S]*?)```/);
      check('en JavaScript block found', !!js);
      if (js) {
        const logs = [];
        new Function('console', 'crypto', js[1])({ log: (...a) => logs.push(a.join(' ')) }, globalThis.crypto);
        check('en JavaScript block prints 20 letters/digits', /^[A-Za-z0-9]{20}$/.test(logs[0] || ''), logs[0]);
        check('en JavaScript block uses the generator limit', js[1].includes('2 ** 32 - (2 ** 32 % n)') && block.includes('4294967296 - (4294967296 % n)'));
      }
      const py = guide.match(/\{\/\* pw-run-py \*\/\}\s*```python\n([\s\S]*?)```/);
      check('en Python block found', !!py);
      let havePy = true;
      try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); } catch { havePy = false; }
      if (py && havePy) {
        const out = execFileSync('python3', ['-c', py[1]], { encoding: 'utf8' }).trim();
        check('en Python block prints "94 20"', out === '94 20', out);
      } else if (!havePy) console.log('SKIP en Python block (python3 not installed)');
    }
  }
}

// ── tool pages: worked examples (src/content/tools/password-generator/{lang}.mdx) ───────────
// Recomputed with the engine and the page's STRINGS. Each note takes one item or an array; sets
// are letters U (upper) L (lower) D (digits) S (symbols), "amb": true excludes 0 O l 1 I.
//   {/* pwg-meter: {"len":20,"sets":"ULDS"} */}  the strength meter text the page writes,
//      `${label} (${Math.round(bits)} bits)` in the page language; "size" (if given) must equal the
//      character-pool size; "pw" (if given) is a printed sample: it must have that length and use
//      only characters from that pool.
//   {/* pwg-miss: {"len":20,"sets":"ULDS","missing":"D","digits":0} */}  the chance that a password
//      has no character from set "missing" ("any": at least one selected set is absent), written as
//      a percentage with "digits" decimals.
// Every output must appear verbatim in inline code or in a code block after the note (up to the
// next note with the same tag or the next H2). Each language needs at least 2 pwg-meter notes.
{
  const { contractProblems } = await import('./lib/tool-mdx-contract.mjs');
  const { fencedBlocks } = await import('./lib/tool-mdx-contract.mjs');
  const S = new Function('return ' + source.match(/(?:var|const) STRINGS = (\{[\s\S]*?\n\s*\});/)[1])();
  const SET = { U: 'upper', L: 'lower', D: 'digits', S: 'symbols' };
  const optsOf = (item) => {
    if (typeof item.sets !== 'string' || !/^[ULDS]+$/.test(item.sets)) throw new Error('bad "sets" ' + JSON.stringify(item.sets));
    const o = Object.fromEntries([...item.sets].map((c) => [SET[c], true]));
    if (item.amb) o.ambiguous = true;
    return o;
  };
  const decodeHTML = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  function codeTexts(text) {
    const out = fencedBlocks(text).map((b) => b.text);
    const rest = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ' ');
    for (const m of rest.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)) {
      const inner = m[1].trim();
      const lit = /^\{([`'"])([\s\S]*)\1\}$/.exec(inner);
      out.push(lit ? new Function('return ' + lit[1] + lit[2] + lit[1])() : decodeHTML(inner));
    }
    for (const m of rest.replace(/<code\b[\s\S]*?<\/code>/g, ' ').matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
    return out;
  }
  const items = (spec) => (Array.isArray(spec) ? spec : [spec]);
  const inCode = (after, value) => codeTexts(after).some((t) => t.includes(value));
  const meter = ({ spec, after, lang }) => {
    const bad = [];
    for (const item of items(spec)) {
      const pool = E.charsetFor(optsOf(item));
      if (item.size !== undefined && item.size !== pool.length) bad.push(`pool ${item.sets} is ${pool.length}, not ${item.size}`);
      const bits = item.len * Math.log2(pool.length);
      const text = S[lang][E.strengthInfo(bits).key] + ' (' + Math.round(bits) + ' bits)';
      if (!inCode(after, text)) bad.push('meter ' + JSON.stringify(text) + ' not in code');
      if (item.pw !== undefined) {
        if ([...item.pw].length !== item.len || [...item.pw].some((c) => !pool.includes(c))) bad.push('sample ' + JSON.stringify(item.pw) + ' is not ' + item.len + ' characters from the pool');
        if (!inCode(after, item.pw)) bad.push('sample ' + JSON.stringify(item.pw) + ' not in code');
      }
    }
    return bad.join('; ') || null;
  };
  const SIZE = { U: 26, L: 26, D: 10, S: E.SYMBOLS.length };
  const miss = ({ spec, after }) => {
    const bad = [];
    for (const item of items(spec)) {
      const keys = [...item.sets];
      const N = E.charsetFor(optsOf(item)).length;
      if (item.amb || N !== keys.reduce((a, k) => a + SIZE[k], 0)) { bad.push('pwg-miss needs full sets without "amb"'); continue; }
      let p;
      if (item.missing === 'any') {
        p = 0;
        for (let m = 1; m < 1 << keys.length; m++) {
          const sub = keys.filter((_, i) => (m >> i) & 1);
          p += (sub.length % 2 ? 1 : -1) * Math.pow((N - sub.reduce((a, k) => a + SIZE[k], 0)) / N, item.len);
        }
      } else if (keys.includes(item.missing)) p = Math.pow((N - SIZE[item.missing]) / N, item.len);
      else { bad.push('bad "missing" ' + item.missing); continue; }
      const text = (p * 100).toFixed(item.digits ?? 0) + '%';
      if (!inCode(after, text)) bad.push(JSON.stringify(text) + ' not in code');
    }
    return bad.join('; ') || null;
  };
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const problems = contractProblems('password-generator', lang, { annotations: [{ tag: 'pwg-meter', min: 2, verify: meter }, { tag: 'pwg-miss', verify: miss }] });
    check(lang + ' tool page: MDX contract and pwg-* worked examples', problems === '', problems);
  }
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
const lifecycleSlug = "password-generator", lifecyclePath = "src/components/tools/PasswordGeneratorTool.astro", lifecyclePrefix = "pg";
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
function fullOutput(p) {  return p.get('pg-output').classList.contains('has-value') ? p.get('pg-output').textContent : ''; }
function targets(p) {  return [{ b: p.get('pg-copy'), text: () => fullOutput(p), success: '#057a55', restore: '', delay: 1500 }]; }
const expectedCopyFailure = { en: 'Copy failed. Try again.', zh: '复制失败，请重试。', ja: 'コピーに失敗しました。再試行してください。', ko: '복사하지 못했습니다. 다시 시도하세요.' };
const feedback = t => (t.b.style.color || '');
async function generateReady(p) { p.get(lifecyclePrefix + '-generate').click();   p.get('pg-batch-generate').click(); }
function emptyState(p) {  return !p.get('pg-output').textContent && !p.get('pg-output').classList.contains('has-value') && p.get('pg-strength-fill').style.width === '0%' && !p.get('pg-strength-label').textContent && !p.get('pg-batch-output').value; }
const controlIds = ['pg-length', 'pg-length-input', 'pg-upper', 'pg-lower', 'pg-digits', 'pg-symbols', 'pg-ambiguous'];
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
                const batch = p.get('pg-batch-output').value;
                lifeCheck('10 passwords', batch.split('\n').length === 10);
                p.input('pg-length-input', '24');
                lifeCheck('automatic synchronized length', fullOutput(p).length === 24 && p.get('pg-length').value === '24');
                lifeCheck('manual batch snapshot', p.get('pg-batch-output').value === batch);
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
                    lifeCheck('visible localized failure', b.textContent.includes(expectedCopyFailure[lang]));
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
            p.ctrlL('pg-batch-output', order === 'shared-before' ? 'L' : 'l', order === 'shared-before' ? 'metaKey' : 'ctrlKey');
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
            {
                ['pg-upper', 'pg-lower', 'pg-digits', 'pg-symbols'].forEach(id => { p.get(id).checked = false; p.get(id).dispatch('change'); });
                lifeCheck('empty charset removes stale strength and batch', !p.get('pg-output').classList.contains('has-value') && p.get('pg-strength-fill').style.width === '0%' && !p.get('pg-strength-label').textContent && !p.get('pg-batch-output').value && p.get('pg-copy').disabled);
                p.get('pg-batch-generate').click();
                lifeCheck('invalid batch remains empty', !p.get('pg-batch-output').value);
                p.get('pg-lower').checked = true;
                p.get('pg-lower').dispatch('change');
                lifeCheck('valid charset restores generation', !!fullOutput(p));
            }

            lifeCheck('no native clipboard ever', p.execCalls.length === 0);
        });

process.removeListener('unhandledRejection', onUnhandled);
console.log(`LIFECYCLE ${lifecyclePass} passed, ${lifecycleFail} failed`);
console.log(`FINAL ${passes + lifecyclePass} passed, ${failures + lifecycleFail} failed`);
process.exitCode = failures + lifecycleFail ? 1 : 0;

// Copy decides by state, not by text: when no password is shown (the localized "Click Generate"
// placeholder, or the localized "select a character set" message) the button writes nothing, in
// every language. Before the fix it compared the text with the English 'Click Generate', so the
// zh / ja / ko placeholder was copied as if it were a password.
for (const lang of ['en', 'zh', 'ja', 'ko']) await attempt(lang + '/copy state', async () => {
    const p = lifecyclePage(lang), L = lifecycleLabels(lang), out = p.get('pg-output'), btn = p.get('pg-copy');
    out.textContent = L.clickGenerate; out.classList.remove('has-value'); btn.disabled = false;
    let n = p.clipboard.length; btn.click(); await settle();
    lifeCheck(lang + '/placeholder text is never copied', p.clipboard.length === n);
    for (const id of ['pg-upper', 'pg-lower', 'pg-digits', 'pg-symbols']) { p.get(id).checked = false; p.get(id).dispatch('change'); }
    lifeCheck(lang + '/no-charset message shown', out.textContent === JSON.parse(p.doc.querySelector('.pg-wrap').dataset.strings).noCharset);
    btn.disabled = false; n = p.clipboard.length; btn.click(); await settle();
    lifeCheck(lang + '/no-charset message is never copied', p.clipboard.length === n);
    p.get('pg-upper').checked = true; p.get('pg-upper').dispatch('change');
    n = p.clipboard.length; btn.click();
    lifeCheck(lang + '/generated password is copied', p.clipboard.length === n + 1 && p.clipboard.at(-1).value === out.textContent && /^[A-Z]{20}$/.test(out.textContent));
    p.clipboard.at(-1).resolve(); await settle();
});

// v2 page layout: source bindings, real four-language controls and structured usage.
const featureTips = ['length', 'upper', 'lower', 'digits', 'symbols', 'ambiguous', 'generate', 'batch', 'copy', 'strength'];
const featureFM = /^---\n([\s\S]*?)\n---/.exec(source)?.[1] || '';
const featureStrings = frontmatterStrings(featureFM);
lifeCheck('v2 direct tool root', /^<div class="pg-wrap"/.test(source.replace(/^---[\s\S]*?---\s*/, '')));
lifeCheck('v2 shared generate rail', /<aside class="pg-rail zt-rail">/.test(source));
const featureStructure = lifecyclePage('en');
lifeCheck('v2 grid lives inside direct flex root', featureStructure.doc.querySelector('.pg-main')?.parentNode.classList.contains('pg-wrap') && featureStructure.doc.querySelector('.pg-rail')?.parentNode.classList.contains('pg-main') && featureStructure.doc.querySelector('.pg-results')?.parentNode.classList.contains('pg-main'));
lifeCheck('v2 result separated from controls', source.indexOf('<section class="pg-results"') > source.indexOf('</aside>'));
lifeCheck('v2 no runtime UI translation', !source.includes('data-i18n') && !source.match(/<script[\s\S]*var STRINGS/));
const { load: featureYAML } = lifecycleRequire('js-yaml');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const p = lifecyclePage(lang);
    const L = featureStrings?.[lang];
    lifeCheck(lang + '/SSR generate label', p.get('pg-generate').textContent === L?.generate);
    lifeCheck(lang + '/SSR batch label', p.get('pg-batch-generate').textContent === L?.generateBatch);
    lifeCheck(lang + '/SSR length label', p.get('pg-length-label').textContent === L?.length);
    lifeCheck(lang + '/SSR batch placeholder', p.get('pg-batch-output').getAttribute('placeholder') === L?.batchPlaceholder);
    lifeCheck(lang + '/SSR copy accessible name', p.get('pg-copy').getAttribute('aria-label') === L?.copy && p.get('pg-copy').getAttribute('title') === L?.copyTitle);
    for (const key of ['upper', 'lower', 'digits', 'symbols', 'ambiguous']) lifeCheck(lang + '/SSR option ' + key, p.get('pg-' + key).closest('label').querySelector('span').textContent === L?.[key]);
    lifeCheck(lang + '/four-language empty sentence', typeof L?.empty === 'string' && L.empty.length > 0 && source.includes('{L.empty}'));
    lifeCheck(lang + '/strength feedback precedes result', p.get('pg-strength-label').closest('.pg-strength-status')?.getAttribute('role') === 'status' && p.get('pg-strength-label').closest('.pg-rail') !== null);
    lifeCheck(lang + '/copy operation precedes result', p.get('pg-copy').closest('.pg-rail') !== null);
    const client = JSON.parse(p.doc.querySelector('.pg-wrap').dataset.strings);
    lifeCheck(lang + '/only required dynamic strings sent', Object.keys(client).sort().join(',') === 'copyFailed,fair,noCharset,strong,veryStrong,veryWeak,weak' && !Object.hasOwn(client, 'tips'));
    for (const key of featureTips) lifeCheck(lang + '/tip ' + key + ' is SSR-bound', typeof L?.tips?.[key] === 'string' && L.tips[key].length > 0 && source.includes('id="pg-tip-' + key + '"') && source.includes('{L.tips.' + key + '}</Toggletip>'));
    const mdx = readFileSync(join(root, 'src/content/tools/password-generator/' + lang + '.mdx'), 'utf8');
    const meta = featureYAML(/^---\n([\s\S]*?)\n---/.exec(mdx)[1]);
    lifeCheck(lang + '/steps bounded', Array.isArray(meta.steps) && meta.steps.length > 0 && meta.steps.length <= 8 && meta.steps.every(x => typeof x === 'string' && x.length <= 280) && meta.steps.join('').length <= 1200);
    lifeCheck(lang + '/Usage moved and FAQ retained', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx) && Array.isArray(meta.faqItems) && meta.faqItems.length > 0);
}
const featureLayouts = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
if (/'password-generator':\s*'generate'/.test(featureLayouts)) lifeCheck('v2 generate registration', true);
else console.log('PENDING_ROOT password-generator generate registration (not counted as PASS)');
console.log(`FEATURE FINAL ${passes + lifecyclePass} passed, ${failures + lifecycleFail} failed`);
process.exitCode = failures + lifecycleFail ? 1 : 0;
