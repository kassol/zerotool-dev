// ASCII Converter — code formats and strict reading of code tokens
//
// Read:  src/components/tools/AsciiConverterTool.astro (the engine block between the
//        `engine:start` / `engine:end` markers)
//        src/layouts/ToolLayout.astro (actual shared keyboard handler)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: formatCode for decimal / hex / octal / binary; parseCode reads 0x / 0o / 0b /
// decimal tokens only when the whole token is digits of that base (parseInt used to stop
// at the first bad digit, so 72abc read as 72 and 0b102 as 2), rejects surrogate code
// points (U+D800–U+DFFF) and values above U+10FFFF; the examples on the English page.
//
// Guide checks (src/content/blog/ascii-converter-guide/en.mdx and ja.mdx): the printable table
// must have one row for each code 32–126 and the control table one row for each code 0–31 and
// 127; hex, octal and 7-bit binary are recomputed; printable names must equal the Unicode 18.0
// names, control abbreviations must be a Unicode 18.0 abbreviation alias, control names must
// follow the abbreviation in the RFC 20 legend or be a Unicode control alias, and the caret form
// is the code XOR 64 (DEL is ^?). Source data is in scripts/test-ascii-converter.fixtures.json.
// Examples marked {/* ac-check: {"text": ..., "fmt": ..., "expect": ...} */} or
// {/* ac-check: {"codes": ..., "expect"|"error": ...} */} run the tool's engine. JavaScript lines
// with a result comment are evaluated and compared with util.inspect. Python samples, the C
// escape column and the code page facts quoted in the text run when python3 is available
// (SKIP otherwise).
//
// Run: node scripts/test-ascii-converter.mjs

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { inspect } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/AsciiConverterTool.astro'), 'utf8');
const startIndex = source.indexOf('/* ── engine:start ── */');
const endIndex = source.indexOf('/* ── engine:end ── */');
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in AsciiConverterTool.astro');
  process.exit(1);
}
const { formatCode, parseCode } = new Function(source.slice(startIndex, endIndex) + '\nreturn { formatCode, parseCode };')();

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  if (actual === expected) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + JSON.stringify(expected) + '\n  actual   ' + JSON.stringify(actual));
}
function throws(name, fn, message) {
  try { fn(); } catch (e) { eq(name, e.message, message); return; }
  failures++;
  console.log('FAIL: ' + name + ' did not throw');
}
const toCodes = (s, fmt) => [...s].map((c) => formatCode(c.codePointAt(0), fmt)).join(' ');
const toText = (s) => s.trim().split(/[\s,]+/).filter(Boolean).map((t) => String.fromCodePoint(parseCode(t))).join('');

// Each format label shows a sample for 'A'; it must be what the tool writes for 'A'
// (binary is not padded to 8 bits, so the label read 0b01000001 against an output of 0b1000001).
{
  const fmtOf = { fmtHex: 'hex', fmtOctal: 'oct', fmtBinary: 'bin' };
  const labels = [...source.matchAll(/(fmtHex|fmtOctal|fmtBinary)(?:": "|: '|">)[^'"<]*?\(([^)]+)\)/g)];
  eq('format labels found (markup + 4 languages × 3)', labels.length, 15);
  for (const m of labels) eq('label sample ' + m[0], m[2], formatCode(65, fmtOf[m[1]]));
}

eq('decimal', toCodes('Hi!', 'dec'), '72 105 33');
eq('hex', toCodes('Hi!', 'hex'), '0x48 0x69 0x21');
eq('octal', toCodes('Hi!', 'oct'), '0o110 0o151 0o41');
eq('binary', toCodes('Hi!', 'bin'), '0b1001000 0b1101001 0b100001');
eq('non-ASCII uses the code point', toCodes('é€😀', 'hex'), '0xE9 0x20AC 0x1F600');
eq('mixed formats and commas', toText('72, 0x69 0o41 0b100001'), 'Hi!!');
eq('upper-case prefix', toText('0X41 0B1000010'), 'AB');
eq('emoji code point', toText('128512'), '😀');
eq('zero', parseCode('0'), 0);
throws('trailing letters', () => parseCode('72abc'), 'Invalid code: 72abc');
throws('bad hex digit', () => parseCode('0x4G'), 'Invalid code: 0x4G');
throws('bad binary digit', () => parseCode('0b102'), 'Invalid code: 0b102');
throws('decimal point', () => parseCode('1.5'), 'Invalid code: 1.5');
throws('negative', () => parseCode('-1'), 'Invalid code: -1');
throws('empty prefix', () => parseCode('0x'), 'Invalid code: 0x');
throws('above U+10FFFF', () => parseCode('0x110000'), 'Code point out of range: 0x110000');
throws('surrogate', () => parseCode('55357'), 'Code point out of range: 55357');
eq('last code point', parseCode('0x10FFFF'), 0x10ffff);

// examples on the English page
eq('page: Hello decimal', toCodes('Hello', 'dec'), '72 101 108 108 111');
eq('page: café hex', toCodes('café ☕', 'hex'), '0x63 0x61 0x66 0xE9 0x20 0x2615');
eq('page: CRLF', toCodes('a\r\nb', 'dec'), '97 13 10 98');
eq('page: decode binary', toText('0b1001111 0b1001011'), 'OK');

// ---------- guide: tables, examples and samples ----------
const fx = JSON.parse(readFileSync(join(root, 'scripts/test-ascii-converter.fixtures.json'), 'utf8'));
const uname = new Map(fx.unicodeNames.map((l) => { const [cp, n] = l.split(';'); return [parseInt(cp, 16), n]; }));
const abbrAliases = new Map();
const ctrlAliases = new Map();
for (const l of fx.nameAliases) {
  const [cp, n, type] = l.split(';');
  const map = type === 'abbreviation' ? abbrAliases : ctrlAliases;
  const c = parseInt(cp, 16);
  if (!map.has(c)) map.set(c, []);
  map.get(c).push(n);
}
const legend = fx.rfc20Legend.join(' ').replace(/\s+/g, ' ');
const hex2 = (c) => c.toString(16).toUpperCase().padStart(2, '0');
const oct3 = (c) => c.toString(8).padStart(3, '0');
const bin7 = (c) => c.toString(2).padStart(7, '0');
let python = true;
try { execFileSync('python3', ['-c', 'pass'], { stdio: 'ignore' }); } catch { python = false; }
const py = (code, input) => execFileSync('python3', ['-c', code], { encoding: 'utf8', input });
if (!python) console.log('SKIP: python3 not found; Python samples, C escapes and code page facts not run');

const space = { en: '(space)', ja: '（空白）' };
for (const lang of ['en', 'ja']) {
  const page = readFileSync(join(root, 'src/content/blog/ascii-converter-guide/' + lang + '.mdx'), 'utf8');
  const printable = [...page.matchAll(/^\| (\d+) \| ([0-9A-F]{2}) \| ([0-7]{3}) \| ([01]{7}) \| (.+?) \| ([A-Z -]+) \|$/gm)];
  eq(lang + ' printable rows are 32–126', printable.map((m) => m[1]).join(' '), Array.from({ length: 95 }, (_, i) => i + 32).join(' '));
  for (const m of printable) {
    const c = Number(m[1]);
    eq(lang + ' row ' + c + ' hex/oct/bin', [m[2], m[3], m[4]].join(' '), [hex2(c), oct3(c), bin7(c)].join(' '));
    const cell = m[5] === '`` ` ``' ? '`' : m[5] === '`\\|`' ? '|' : m[5].replace(/^`(.)`$/, '$1');
    eq(lang + ' row ' + c + ' char', c === 32 ? m[5] === space[lang] : cell === String.fromCharCode(c), true);
    eq(lang + ' row ' + c + ' name', m[6], uname.get(c));
  }
  const controlRe = lang === 'en'
    ? /^\| (\d+) \| ([0-9A-F]{2}) \| ([0-7]{3}) \| ([01]{7}) \| ([A-Z0-9]+) \| ([A-Za-z0-9 ]+) \| `\^(.)` \| (.+?) \|$/gm
    : /^\| (\d+) \| ([0-9A-F]{2}) \| ([0-7]{3}) \| ([01]{7}) \| ([A-Z0-9]+) \| ([A-Za-z0-9 ]+) \| (?:.+?) \| `\^(.)` \|$/gm;
  const control = [...page.matchAll(controlRe)];
  eq(lang + ' control rows are 0–31 and 127', control.map((m) => m[1]).join(' '), [...Array(32).keys(), 127].join(' '));
  const escapes = [];
  for (const m of control) {
    const c = Number(m[1]);
    eq(lang + ' control ' + c + ' hex/oct/bin', [m[2], m[3], m[4]].join(' '), [hex2(c), oct3(c), bin7(c)].join(' '));
    eq(lang + ' control ' + c + ' abbreviation', (abbrAliases.get(c) || []).includes(m[5]), true);
    const inLegend = new RegExp('(^| )' + m[5] + ' ' + m[6] + '(?= |$)').test(legend);
    const nameOk = inLegend || (ctrlAliases.get(c) || []).includes(m[6].toUpperCase());
    eq(lang + ' control ' + c + ' name ' + m[6], nameOk, true);
    eq(lang + ' control ' + c + ' caret', m[7], c === 127 ? '?' : String.fromCharCode(c ^ 64));
    if (lang === 'en' && m[8] !== '—') escapes.push([c, m[8].replace(/^`|`$/g, '')]);
  }
  if (lang === 'en') {
    eq('en C escapes listed', escapes.map(([c]) => c).join(' '), '0 7 8 9 10 11 12 13 27');
    if (python) {
      const out = py('import json,sys\nprint(json.dumps([ord(eval(\'"\' + e + \'"\')) for c, e in json.load(sys.stdin)]))', JSON.stringify(escapes));
      eq('en C escapes decode in Python', JSON.stringify(JSON.parse(out)), JSON.stringify(escapes.map(([c]) => c)));
    }
    // JavaScript has every escape except \a.
    for (const [c, e] of escapes) if (e !== '\\a') eq('JS escape ' + e, new Function('return "' + e + '"')().charCodeAt(0), c);
  }
  let examples = 0;
  for (const m of page.matchAll(/\{\/\* ac-check: (\{.*?\}) \*\/\}/g)) {
    examples++;
    const ex = JSON.parse(m[1]);
    if (ex.text !== undefined) {
      const got = toCodes(ex.text, ex.fmt);
      eq(lang + ' example ' + ex.text + ' ' + ex.fmt, got, ex.expect);
      eq(lang + ' page shows ' + ex.expect, page.includes(ex.expect), true);
    } else if (ex.error) {
      throws(lang + ' example ' + ex.codes, () => toText(ex.codes), ex.error);
      eq(lang + ' page shows ' + ex.error, page.includes(ex.error), true);
    } else {
      eq(lang + ' example ' + ex.codes, toText(ex.codes), ex.expect);
    }
  }
  eq(lang + ' guide carries examples', examples >= 5, true);
  // JavaScript blocks: `expr; // result` or `expr;` followed by `// result`.
  for (const block of page.matchAll(/```javascript\n([\s\S]*?)```/g)) {
    const lines = block[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      let expr, want;
      const same = lines[i].match(/^(.*?;)\s+\/\/ (.+)$/);
      if (same) [expr, want] = [same[1], same[2]];
      else if (/;$/.test(lines[i]) && /^\/\/ /.test(lines[i + 1] || '')) [expr, want] = [lines[i], lines[i + 1].slice(3)];
      else continue;
      eq(lang + ' JS ' + expr, inspect(new Function('return ' + expr.replace(/;$/, ''))()), want);
    }
  }
  if (!python) continue;
  for (const block of page.matchAll(/```python\n([\s\S]*?)```/g)) {
    const out = py([
      'import json, re, sys, unicodedata',
      'env = {}',
      'res = []',
      'for line in json.load(sys.stdin):',
      '    m = re.match(r"^(.*?)\\s+# (.*)$", line)',
      '    if m: res.append([m.group(1), repr(eval(m.group(1), env)), m.group(2)])',
      '    elif line.strip(): exec(line, env)',
      'print(json.dumps(res))',
    ].join('\n'), JSON.stringify(block[1].split('\n')));
    for (const [expr, got, want] of JSON.parse(out)) eq(lang + ' Python ' + expr, got, want);
  }
}

// Facts quoted in the text.
eq('NFKC folds full-width letters', 'ＡＢＣ１'.normalize('NFKC'), 'ABC1');
eq('full-width offset', 'Ａ'.codePointAt(0) - 'A'.codePointAt(0), 0xfee0);
for (const label of ['iso-8859-1', 'latin1', 'us-ascii', 'ascii']) {
  eq('WHATWG label ' + label + ' is windows-1252', new TextDecoder(label).encoding, 'windows-1252');
}
eq('windows-1252 0x80 and 0x82', new TextDecoder('windows-1252').decode(new Uint8Array([0x80, 0x82])), '€‚');
eq('JS sort is code order', ['apple', 'Banana', '_id', '10', '9', 'Zebra'].sort().join(' '), '10 9 Banana Zebra _id apple');
if (python) {
  const out = py([
    'import json',
    'r = {}',
    'r["dame"] = {c: c.encode("cp932").hex(" ").upper() for c in "表ソ能予申"}',
    'r["hyouji"] = "表示".encode("cp932").hex(" ").upper()',
    'r["broken"] = bytes([0x95, 0x8E, 0xA6]).decode("cp932")',
    'r["jisx0201"] = bytes([0x5C, 0x7E]).decode("shift_jis_2004")',
    'r["a"] = bytes([0x82, 0xA0]).decode("cp932")',
    'r["x80"] = [bytes([0x80]).decode(e) for e in ("cp1252", "latin-1", "cp437")]',
    'r["x82"] = bytes([0x82]).decode("latin-1")',
    'print(json.dumps(r))',
  ].join('\n'));
  const r = JSON.parse(out);
  eq('cp932 bytes with 0x5C', JSON.stringify(r.dame), JSON.stringify({ '表': '95 5C', 'ソ': '83 5C', '能': '94 5C', '予': '97 5C', '申': '90 5C' }));
  eq('表示 in cp932', r.hyouji, '95 5C 8E A6');
  eq('表示 without 0x5C', r.broken, '侮ｦ');
  eq('JIS X 0201 0x5C 0x7E', r.jisx0201, '¥‾');
  eq('あ is 82 A0', r.a, 'あ');
  eq('byte 0x80 in three code pages', r.x80.join(' '), '€ \u0080 Ç');
  eq('byte 0x82 in ISO-8859-1 is C1', r.x82, '\u0082');
  const ja = readFileSync(join(root, 'src/content/blog/ascii-converter-guide/ja.mdx'), 'utf8');
  for (const [c, b] of Object.entries(r.dame)) eq('ja page quotes ' + c + ' ' + b, ja.includes('「' + c + '」は `' + b + '`'), true);
}

// ---------- actual page lifecycle and shared keyboard handler ----------
const pageScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes('window.ztPersist.clear(_slug)')) throw new Error('Shared shortcut extraction failed');
function pageVM(lang = 'en', shellFirst = false) {
  const ids = new Map(), timers = new Map(), copies = [], cleared = [], tracked = [];
  let now = 0, timerID = 0;
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const parts = part.trim().split(/\s+(?![^\[]*\])/), last = parts.pop();
      const attrs = [...last.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
      const plain = last.replace(/\[[^\]]*\]/g, ''), tag = /^[\w-]+/.exec(plain);
      if (tag && el.tagName !== tag[0].toUpperCase()) return false;
      if (![...plain.matchAll(/\.([\w-]+)/g)].every(m => el.className.split(' ').includes(m[1]))) return false;
      if (!attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2])) return false;
      if (!parts.length) return true;
      for (let p = el.parentElement; p; p = p.parentElement) if (matches(p, parts.join(' '))) return true;
      return false;
    });
  }
  class PageEvent {
    constructor(type, options = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false }, options); }
    preventDefault() { this.defaultPrevented = true; }
  }
  class Element {
    constructor(tag = 'div') { Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', attributes: {}, children: [], parentElement: null, listeners: {}, text: '', _value: undefined, disabled: false }); }
    get value() { return this._value ?? (this.tagName === 'SELECT' ? this.querySelector('option')?.value ?? '' : ''); }
    set value(value) { this._value = String(value); }
    setAttribute(key, value) { this.attributes[key] = String(value); if (['id', 'class', 'value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children = []; }
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
    contains(el) { return this === el || this.children.some(c => c.contains(el)); }
    querySelectorAll(selector) { return this.children.flatMap(c => [...(matches(c, selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatchEvent(event) {
      event.target = this;
      for (let el = this; el; el = el.parentElement) {
        for (const fn of el.listeners[event.type] || []) fn.call(el, event);
        if (!event.bubbles) break;
      }
      return !event.defaultPrevented;
    }
    dispatch(type, options = {}) { return this.dispatchEvent(new PageEvent(type, { bubbles: true, ...options })); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { document.activeElement = this; }
  }
  const document = new Element('document'); document.documentElement = { lang };
  document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element()); widget.className = 'tool-widget';
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
  const stack = [widget], voids = new Set(['input', 'br', 'hr', 'img']);
  for (const match of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (match[3] !== undefined) { stack.at(-1).text += match[3]; continue; }
    const tag = match[1];
    if (match[0].startsWith('</')) { if (stack.at(-1).tagName === tag.toUpperCase()) stack.pop(); continue; }
    const el = new Element(tag);
    for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(attr[1], attr[2]);
    stack.at(-1).appendChild(el); if (el.id) ids.set(el.id, el);
    if (!voids.has(tag) && !match[2].trimEnd().endsWith('/')) stack.push(el);
  }
  document.getElementById = id => ids.get(id) || null;
  document.createElement = tag => new Element(tag);
  const context = { document, console, Event: PageEvent, _slug: 'ascii-converter',
    ztPersist: { clear: slug => cleared.push(slug) }, trackTool: (...args) => tracked.push(args),
    setTimeout(fn, delay = 0) { const id = ++timerID; timers.set(id, { fn, due: now + delay, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); copies.push({ value, resolve, reject }); return promise; } } }
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context);
  if (!shellFirst) vm.runInContext(shortcut, context);
  const get = id => { if (!ids.has(id)) throw new Error('Missing actual ID ' + id); return ids.get(id); };
  return { context, document, get, copies, timers, cleared, tracked,
    input(id, value) { get(id).value = value; get(id).dispatch('input'); },
    key(key = 'l', modifiers = { ctrlKey: true }) { document.activeElement.dispatch('keydown', { key, ...modifiers }); },
    advance(ms) { const target = now + ms; for (;;) { const next = [...timers].filter(([,t]) => t.due <= target).sort((a,b) => a[1].due - b[1].due || a[0] - b[0])[0]; if (!next) break; now = next[1].due; timers.delete(next[0]); next[1].fn(); } now = target; },
    snapshot() { return ['ac-text', 'ac-codes'].map(id => get(id).value).concat(['ac-status', 'ac-copy-text', 'ac-copy-codes'].map(id => get(id).textContent), get('ac-status').className); }
  };
}
function samePage(name, actual, expected) { eq(name, JSON.stringify(actual), JSON.stringify(expected)); }
const localized = {
  en: { copy: 'Copy', copied: 'Copied!', chars: 'Converted 2 characters.', codes: 'Converted 2 codes.', copyFail: 'Could not copy. Please select the content and copy it manually.' },
  zh: { copy: '复制', copied: '已复制！', chars: '已转换 2 个字符。', codes: '已转换 2 个码值。', copyFail: '复制失败。请选中内容后手动复制。' },
  ja: { copy: 'コピー', copied: 'コピー済み！', chars: '2 文字を変換しました。', codes: '2 コードを変換しました。', copyFail: 'コピーできませんでした。内容を選択して手動でコピーしてください。' },
  ko: { copy: '복사', copied: '복사됨!', chars: '2개 문자를 변환했습니다.', codes: '2개 코드를 변환했습니다.', copyFail: '복사하지 못했습니다. 내용을 선택하여 직접 복사하세요.' }
};
for (const lang of Object.keys(localized)) {
  const p = pageVM(lang), t = localized[lang];
  p.input('ac-text', 'A😀'); eq(lang + ': typing does not convert', p.get('ac-codes').value, '');
  p.get('ac-to-ascii').click(); samePage(lang + ': real forward and count', [p.get('ac-codes').value, p.get('ac-status').textContent], ['65 128512', t.chars]);
  p.get('ac-format-select').value = 'hex'; p.get('ac-format-select').dispatch('change');
  eq(lang + ': format changes do not auto convert', p.get('ac-codes').value, '65 128512');
  p.get('ac-to-ascii').click(); eq(lang + ': manual format conversion', p.get('ac-codes').value, '0x41 0x1F600');
  p.input('ac-codes', '65 0x1F600'); p.get('ac-to-text').click();
  samePage(lang + ': real reverse and count', [p.get('ac-text').value, p.get('ac-status').textContent], ['A😀', t.codes]);
  const enter = pageVM(lang); enter.input('ac-text','A😀'); enter.get('ac-codes').focus(); enter.key('Enter');
  samePage(lang + ': shared CtrlEnter executes the first direction once', [enter.get('ac-codes').value,enter.tracked.length], ['65 128512',1]);
  p.input('ac-codes', '72abc'); p.get('ac-to-text').click(); samePage(lang + ': invalid code clears target', [p.get('ac-text').value, p.get('ac-status').textContent], ['', 'Error: Invalid code: 72abc']);
  p.get('ac-clear').click(); samePage(lang + ': explicit Clear', [p.get('ac-text').value, p.get('ac-codes').value, p.get('ac-status').textContent], ['', '', '']);
  for (const shellFirst of [false,true]) for (const modifiers of [{ctrlKey:true},{metaKey:true}]) {
    const q = pageVM(lang,shellFirst); q.input('ac-text','A😀'); q.get('ac-to-ascii').click();
    const before = q.snapshot(); q.key(); samePage(lang + ': outside CtrlL preserves page', q.snapshot(), before);
    q.get('ac-codes').focus(); q.key('L',modifiers);
    samePage(`${lang}: CtrlL clears fields and status, sharedFirst=${shellFirst}`, [q.get('ac-text').value,q.get('ac-codes').value,q.get('ac-status').textContent,q.cleared], ['','','',['ascii-converter']]);
  }
}

const flushCopies = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
function withResult(lang, shellFirst = false) {
  const p = pageVM(lang, shellFirst); p.input('ac-text', 'A😀'); p.get('ac-to-ascii').click(); return p;
}
for (const lang of Object.keys(localized)) for (const side of ['text','codes']) {
  const button = 'ac-copy-' + side, expectedValue = side === 'text' ? 'A😀' : '65 128512', t = localized[lang];
  {
    const p = withResult(lang); p.get(button).click(); const job = p.copies.at(-1);
    eq(lang + '/' + side + ': copies exact displayed content', job.value, expectedValue);
    job.resolve(); await flushCopies(); samePage(lang + '/' + side + ': success keeps conversion status', [p.get(button).textContent,p.get('ac-status').textContent], [t.copied,t.chars]);
    p.advance(1499); eq(lang + '/' + side + ': copy feedback lasts 1500ms', p.get(button).textContent,t.copied);
    p.advance(1); eq(lang + '/' + side + ': normal feedback expires', p.get(button).textContent,t.copy);
    p.get('ac-clear').click(); const count=p.copies.length; p.get(button).click(); eq(lang + '/' + side + ': empty pane never copies',p.copies.length,count);
  }
  for (const kind of ['reject','throw','missing']) {
    const p = withResult(lang), original = p.context.navigator.clipboard, start = unhandled.length; let thrown;
    if(kind==='missing') p.context.navigator.clipboard=undefined;
    if(kind==='throw') p.context.navigator.clipboard={writeText(){throw new Error('Clipboard blocked');}};
    try { p.get(button).click(); if(kind==='reject') p.copies.at(-1).reject(new Error('Clipboard denied')); } catch(error) { thrown=error.message; }
    await flushCopies(); eq(`${lang}/${side}/${kind}: failure stays inside handler`,thrown,undefined);
    samePage(`${lang}/${side}/${kind}: no unhandled rejection`,unhandled.slice(start),[]);
    samePage(`${lang}/${side}/${kind}: failure is localized and visible`,[p.get('ac-status').textContent,p.get('ac-status').className,p.get(button).textContent],[t.copyFail,'ac-status error',t.copy]);
    p.context.navigator.clipboard=original; p.get(button).click(); const retry=p.copies.at(-1); retry.resolve(); await flushCopies();
    samePage(`${lang}/${side}/${kind}: direct same-output retry recovers`,[retry.value,p.get('ac-text').value,p.get('ac-codes').value,p.get(button).textContent,p.get('ac-status').textContent],[expectedValue,'A😀','65 128512',t.copied,'']);
  }
}
const copyBoundaries = ['clear','ctrlL','input-text','input-codes','forward','reverse','invalid','empty-forward','empty-reverse'];
function changeCopyContext(p, action) {
  if(action==='clear') p.get('ac-clear').click();
  else if(action==='ctrlL') { p.get('ac-text').focus(); p.key(); }
  else if(action==='input-text') p.input('ac-text','new text');
  else if(action==='input-codes') p.input('ac-codes','78 69 87');
  else if(action==='forward') { p.get('ac-text').value='NEW'; p.get('ac-to-ascii').click(); }
  else if(action==='reverse') { p.get('ac-codes').value='78 69 87'; p.get('ac-to-text').click(); }
  else if(action==='invalid') { p.get('ac-codes').value='72abc'; p.get('ac-to-text').click(); }
  else if(action==='empty-forward') { p.get('ac-text').value=''; p.get('ac-to-ascii').click(); }
  else if(action==='empty-reverse') { p.get('ac-codes').value=''; p.get('ac-to-text').click(); }
}
for(const lang of Object.keys(localized)) for(const side of ['text','codes']) {
  const button='ac-copy-'+side, other='ac-copy-'+(side==='text'?'codes':'text'), t=localized[lang];
  for(const action of copyBoundaries) for(const shellFirst of action==='ctrlL'?[false,true]:[false]) for(const outcome of ['resolve','reject']) {
    const p=withResult(lang,shellFirst); p.get(button).click(); const job=p.copies.at(-1); changeCopyContext(p,action);
    const before=p.snapshot(), start=unhandled.length; job[outcome](outcome==='reject'?new Error('late copy failed'):undefined); await flushCopies();
    samePage(`${lang}/${side}: late ${outcome} after ${action}, sharedFirst=${shellFirst}`,p.snapshot(),before);
    samePage(`${lang}/${side}: late rejection is handled`,unhandled.slice(start),[]);
  }
  for(const action of copyBoundaries) for(const shellFirst of action==='ctrlL'?[false,true]:[false]) {
    const p=withResult(lang,shellFirst); p.get(button).click(); p.copies.at(-1).resolve(); await flushCopies();
    const oldTimer=[...p.timers.values()].find(t=>t.delay===1500); changeCopyContext(p,action);
    eq(`${lang}/${side}: ${action} removes old Copied feedback`,p.get(button).textContent,t.copy);
    const before=p.snapshot(); oldTimer.fn(); samePage(`${lang}/${side}: queued timer after ${action} cannot write`,p.snapshot(),before);
  }
  {
    const p=withResult(lang); p.get(button).click(); p.copies.at(-1).resolve(); await flushCopies();
    const firstTimer=[...p.timers.values()].find(t=>t.delay===1500); p.advance(500); p.get(button).click(); p.copies.at(-1).resolve(); await flushCopies();
    firstTimer.fn(); eq(`${lang}/${side}: queued old timer cannot reset second feedback`,p.get(button).textContent,t.copied);
    p.advance(1000); eq(`${lang}/${side}: first deadline preserves second feedback`,p.get(button).textContent,t.copied);
    p.advance(500); eq(`${lang}/${side}: latest timer restores idle label`,p.get(button).textContent,t.copy);
  }
  {
    const p=withResult(lang); p.get(button).click(); const old=p.copies.at(-1); p.get(button).click(); p.copies.at(-1).resolve(); await flushCopies();
    const before=p.snapshot(); old.reject(new Error('old request rejected')); await flushCopies(); samePage(`${lang}/${side}: old rejection cannot replace newer success`,p.snapshot(),before);
    p.get(button).click(); const older=p.copies.at(-1); p.get(button).click(); p.copies.at(-1).reject(new Error('latest request rejected')); await flushCopies();
    const failed=p.snapshot(); older.resolve(); await flushCopies(); samePage(`${lang}/${side}: old success cannot clear latest failure`,p.snapshot(),failed);
  }
  {
    const p=withResult(lang); p.get(button).click(); const pending=p.copies.at(-1); p.get(other).click(); p.copies.at(-1).reject(new Error('other pane failed')); await flushCopies();
    const error=[p.get('ac-status').textContent,p.get('ac-status').className]; pending.resolve(); await flushCopies();
    samePage(`${lang}/${side}: success cannot clear the other button failure`,[p.get('ac-status').textContent,p.get('ac-status').className],error);
    p.get(other).click(); p.copies.at(-1).resolve(); await flushCopies(); eq(`${lang}/${side}: owning button retry clears its error`,p.get('ac-status').textContent,'');
    p.get(button).click(); const current=p.copies.at(-1); p.get('ac-format-select').value='hex'; p.get('ac-format-select').dispatch('change'); current.resolve(); await flushCopies();
    samePage(`${lang}/${side}: changing format alone preserves current content and copy`,[p.get('ac-codes').value,p.get(button).textContent],['65 128512',t.copied]);
  }
}
samePage('all copy promises handled',unhandled,[]);
process.removeListener('unhandledRejection',onUnhandled);

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
