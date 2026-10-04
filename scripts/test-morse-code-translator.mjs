// Morse Code Translator — decoding accepts ASCII dots and hyphens; skipped and unknown input is reported
//
// Read:  src/components/tools/MorseCodeTranslatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/content/tools/morse-code-translator/*.mdx (chart rows);
//        src/layouts/ToolLayout.astro (shared keyboard handler)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: Morse typed with ASCII `.` and `-` decodes (before the fix it gave `?????`), as do
// other common dot / dash characters (• ∙ ・ ． _ – — ー －) and mixes of them; letters split by
// whitespace, words by `/` or `|`, lines by line breaks; codes not in the table decode to `[?]`
// and are reported (before: a bare `?`, the same as the code for the question mark);
// encoding reports characters without a code (before: dropped silently); É / é is the ITU-R
// M.1677-1 accented e `··−··`; full-width letters go through NFKC; the ITU-R M.1677-1 letter,
// figure and punctuation codes (expected values typed from the recommendation, part I §1.1);
// every chart row on the 4 tool pages matches the engine; round trip of the whole table;
// 4-language STRINGS keys; the full page IIFE and actual ToolLayout keyboard handler.
// Page tests replace only DOM, clipboard Promise delivery and the timer clock.
//
// Run: node scripts/test-morse-code-translator.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/MorseCodeTranslatorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in MorseCodeTranslatorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { CHAR_TO_MORSE, textToMorse, morseToText };')();

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
const enc = (s) => E.textToMorse(s);
const dec = (s) => E.morseToText(s);

// ---------- ITU-R M.1677-1 part I §1.1 (written here with ASCII . and -) ----------
const ITU = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', 'É': '..-..', F: '..-.', G: '--.', H: '....', I: '..',
  J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', 0: '-----',
  '.': '.-.-.-', ',': '--..--', ':': '---...', '?': '..--..', "'": '.----.', '-': '-....-', '/': '-..-.',
  '(': '-.--.', ')': '-.--.-', '"': '.-..-.', '=': '-...-', '+': '.-.-.', '@': '.--.-.',
};
const toUni = (s) => s.replace(/\./g, '·').replace(/-/g, '−');
for (const [ch, code] of Object.entries(ITU)) {
  eq('ITU code for ' + ch, E.CHAR_TO_MORSE[ch], toUni(code));
}

// ---------- the reported defect: ASCII dots and hyphens ----------
eq('ASCII HELLO WORLD', dec('.... . .-.. .-.. --- / .-- --- .-. .-.. -..').text, 'HELLO WORLD');
eq('ASCII decode reports nothing unknown', dec('.... . .-.. .-.. ---').unknown, []);
eq('Unicode HELLO WORLD still works', dec('···· · ·−·· ·−·· −−− / ·−− −−− ·−· ·−·· −··').text, 'HELLO WORLD');
eq('mixed · and - in one input', dec('··· --- ...').text, 'SOS');
eq('bullet dots and en dashes', dec('•–•–•– / ∙∙∙').text, '. S');
eq('underscore as dash', dec('.__. _').text, 'PT');
eq('em dash and minus sign', dec('—— −').text, 'MT');
eq('full-width dot and dash', dec('．－ －．．．').text, 'AB');
eq('katakana middle dot and long vowel mark', dec('・ー ー・・・').text, 'AB');
eq('| as word separator', dec('... | ---').text, 'S O');
eq('line breaks keep lines', dec('...\n---').text, 'S\nO');
eq('extra spaces and slashes', dec('  ...   ---  /  / ...  ').text, 'SO S');

// ---------- unknown codes and stray characters ----------
{
  const r = dec('... ........ ---');
  eq('8 dots (ITU "error" signal) is not in the table', r.text, 'S[?]O');
  eq('unknown code reported', r.unknown, ['········']);
}
{
  const r = dec('... abc ---');
  eq('group with letters decodes to [?]', r.text, 'S[?]O');
  eq('group with letters reported as typed', r.unknown, ['abc']);
}
eq('question mark code decodes to ?', dec('..--..').text, '?');
eq('repeated unknown reported once', dec('........ ........').unknown, ['········']);

// ---------- encoding ----------
eq('SOS', enc('SOS').morse, '··· −−− ···');
eq('words separated by " / "', enc('hi you').morse, '···· ·· / −·−− −−− ··−');
eq('lower case', enc('sos').morse, '··· −−− ···');
eq('é is the ITU accented e', enc('Café').morse, '−·−· ·− ··−· ··−··');
eq('É decodes', dec('..-..').text, 'É');
{
  const r = enc('Grüße 中文 😀 ok');
  eq('skipped characters reported once each, in order', r.skipped, ['Ü', 'ß', '中', '文', '😀']);
  eq('known characters still encoded (ß is not expanded to SS)', r.morse, '−−· ·−· · / −−− −·−');
}
eq('nothing skipped for plain text', enc('CQ DE N0CALL K').skipped, []);
eq('CQ call', enc('CQ DE N0CALL K').morse, '−·−· −−·− / −·· · / −· −−−−− −·−· ·− ·−·· ·−·· / −·−');
eq('full-width letters via NFKC', enc('ＳＯＳ').morse, '··· −−− ···');
eq('multiple spaces and newlines are one word gap', enc('a  b\nc').morse, '·− / −··· / −·−·');

// ---------- round trip ----------
{
  const chars = Object.keys(E.CHAR_TO_MORSE).join('');
  eq('round trip of every character', dec(enc(chars).morse).text, chars);
  const codes = Object.values(E.CHAR_TO_MORSE);
  check('codes are unique', new Set(codes).size === codes.length);
}

// ---------- chart rows on the tool pages ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/morse-code-translator', lang + '.mdx'), 'utf8');
  const re = /<td><code>\{"((?:[^"\\]|\\.)+)"\}<\/code><\/td><td><code>\{"([·−]+)"\}<\/code><\/td>/g;
  let m, n = 0, bad = [];
  while ((m = re.exec(mdx))) {
    n++;
    const ch = JSON.parse('"' + m[1] + '"');
    if (E.CHAR_TO_MORSE[ch] !== m[2]) bad.push(ch + '=' + m[2]);
  }
  check(lang + ' chart rows match the engine (' + n + ')', bad.length === 0 && n >= 55, bad.join(', ') + ' n=' + n);
  // worked examples quoted in the Timing and Format section
  for (const [input, fn, key] of [['Café 9:30, ok?', enc, 'morse'], ['Grüße ok', enc, 'morse'],
    ['.... . .-.. .-.. --- / .-- --- .-. .-.. -..', dec, 'text']]) {
    check(lang + ' page quotes ' + JSON.stringify(input), mdx.includes('{' + JSON.stringify(input) + '}'));
    check(lang + ' page shows the output of ' + JSON.stringify(input), mdx.includes('{' + JSON.stringify(fn(input)[key]) + '}'), fn(input)[key]);
  }
}

// ---------- 4-language STRINGS ----------
{
  const m = source.match(/var STRINGS = (\{[\s\S]*?\n\s{6}\});/);
  check('STRINGS block found', !!m);
  if (m) {
    const S = new Function('return ' + m[1])();
    const keys = Object.keys(S.en).sort();
    for (const l of ['zh', 'ja', 'ko']) eq('STRINGS keys ' + l, Object.keys(S[l]).sort(), keys);
    for (const k of ['skipped', 'unknown']) check('STRINGS has ' + k, k in S.en && S.en[k].includes('{list}'));
  }
}


// ---------- real page controls ----------
// This DOM supplies source-created elements and native value coercion. The complete
// production IIFE and shared key handler run without replacing any application code.
const clientScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1];
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!clientScript || !shortcut.includes("document.addEventListener('keydown'")) throw Error('Actual page/shortcut missing');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
function pageVM(lang, shellFirst) {
  const copies = [], timers = new Map(), clears = [], tracks = [];
  let now = 0, timerID = 0, document, copyThrows = false;
  const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
  function simple(e, selector) {
    if (e.tagName === '#TEXT') return false;
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const plain = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
    const classes = [...plain.matchAll(/\.([\w-]+)/g)].map(m => m[1]);
    return (!tag || e.tagName === tag.toUpperCase()) && (!id || e.id === id)
      && classes.every(c => e.className.split(/\s+/).includes(c))
      && attrs.every(a => a[2] === undefined ? e.getAttribute(a[1]) !== null : e.getAttribute(a[1]) === a[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(part => {
      const parts = part.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, parts.pop())) return false;
      let parent = e.parentNode;
      while (parts.length) {
        while (parent && !simple(parent, parts.at(-1))) parent = parent.parentNode;
        if (!parent) return false;
        parts.pop(); parent = parent.parentNode;
      }
      return true;
    });
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', text: '', _value: '', hidden: false, disabled: false }); }
    get value() { return this._value; }
    set value(v) { this._value = String(v); }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (['id', 'class', 'type', 'value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value);
      if (key === 'hidden') this.hidden = true;
    }
    getAttribute(key) { return this.attributes[key] ?? null; }
    get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children = []; }
    appendChild(e) { this.children.push(e); e.parentNode = this; return e; }
    contains(e) { return this === e || descendants(this).includes(e); }
    querySelectorAll(selector) { return descendants(this).filter(e => matches(e, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatch(type, extra = {}) {
      const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
      for (let e = this; e; e = e.parentNode) { event.currentTarget = e; for (const fn of e.listeners[type] || []) fn.call(e, event); if (event.stopped) break; }
      return event;
    }
    click() { if (!this.disabled) return this.dispatch('click'); }
    focus() { document.activeElement = this; }
  }
  document = new Element('#document'); document.documentElement = { lang };
  document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element('section')); widget.className = 'tool-widget';
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0];
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) {
    const text = token[0];
    if (text.startsWith('</')) { if (stack.length < 2) throw Error('Unbalanced source markup'); stack.pop(); }
    else if (text.startsWith('<')) {
      const tag = /^<([\w-]+)/.exec(text)[1], e = new Element(tag);
      for (const attr of text.matchAll(/([\w-]+)="([^"]*)"/g)) e.setAttribute(attr[1], attr[2]);
      for (const attr of ['hidden', 'disabled', 'readonly']) if (new RegExp('\\s' + attr + '(?=\\s|/?>)').test(text)) e.setAttribute(attr, '');
      stack.at(-1).appendChild(e);
      if (!/\/>$/.test(text) && !['input', 'br', 'hr', 'img'].includes(tag)) stack.push(e);
    } else { const e = new Element('#text'); e.text = text; stack.at(-1).appendChild(e); }
  }
  if (stack.length !== 1) throw Error('Incomplete source markup');
  document.getElementById = id => descendants(document).find(e => e.id === id) ?? null;
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing actual source ID ' + id); return e; };
  const context = {
    document, console, _slug: 'morse-code-translator',
    navigator: { clipboard: { writeText(value) {
      if (copyThrows) throw Error('Controlled synchronous clipboard failure');
      let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      copies.push({ value: String(value), resolve, reject }); return promise;
    } } },
    setTimeout(fn, ms = 0) { const id = ++timerID; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ztPersist: { clear(slug) { clears.push(slug); } }, trackTool(...args) { tracks.push(args); },
  };
  context.window = context; vm.createContext(context);
  const shared = () => vm.runInContext(shortcut, context, { filename: 'ToolLayout.astro:keyboard' });
  if (shellFirst) shared();
  vm.runInContext(clientScript, context, { filename: 'MorseCodeTranslatorTool.astro:script' });
  if (!shellFirst) shared();
  function advance(ms) {
    const target = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!next) break;
      now = next[1].due; timers.delete(next[0]); next[1].fn();
    }
    now = target;
  }
  return {
    get, document, copies, clears, tracks, timers, advance,
    input(id, value) { get(id).value = value; get(id).dispatch('input'); },
    key(key = 'l', modifier = 'ctrlKey', target = 'mct-text') { (target ? get(target) : document.body).focus(); return document.activeElement.dispatch('keydown', { key, [modifier]: true }); },
    copy() { get('mct-copy-morse').click(); return copies.at(-1); },
    setCopyThrows(value) { copyThrows = value; },
    snapshot() { return { text: get('mct-text').value, morse: get('mct-morse').value, notice: get('mct-error').textContent, hidden: get('mct-error').hidden, copy: get('mct-copy-morse').textContent }; },
  };
}
const HELLO_MORSE = '···· · ·−·· ·−·· −−− / ·−− −−− ·−· ·−·· −··';
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const shellFirst of [false, true]) {
  const p = pageVM(lang, shellFirst), tag = `${lang}/${shellFirst ? 'shell-first' : 'tool-first'}`;
  eq(tag + ' initial text example', p.get('mct-text').value, 'Hello World');
  eq(tag + ' initial example is Morse text', p.get('mct-morse').value, HELLO_MORSE);
  p.input('mct-text', 'SOS');
  eq(tag + ' editing text does not auto-convert', p.get('mct-morse').value, HELLO_MORSE);
  p.get('mct-text-to-morse').click();
  eq(tag + ' manual forward conversion', p.get('mct-morse').value, '··· −−− ···');
  p.input('mct-morse', '.- -...');
  eq(tag + ' editing Morse does not auto-convert', p.get('mct-text').value, 'SOS');
  p.get('mct-morse-to-text').click();
  eq(tag + ' manual reverse conversion', p.get('mct-text').value, 'AB');
  p.input('mct-text', 'E'); p.key('Enter');
  eq(tag + ' shared CtrlEnter chooses first manual direction once', [p.get('mct-morse').value, p.tracks.length], ['·', 3]);
}

for (const lang of ['en', 'zh', 'ja', 'ko']) for (const shellFirst of [false, true]) {
  const p = pageVM(lang, shellFirst), tag = `${lang}/${shellFirst ? 'shell-first' : 'tool-first'}`;
  const warning = () => { p.input('mct-text', 'E 中'); p.get('mct-text-to-morse').click(); };
  warning();
  check(tag + ' unsupported character has visible notice', !p.get('mct-error').hidden && p.get('mct-error').textContent.includes('中'));
  p.get('mct-clear-text').click();
  eq(tag + ' Clear removes both values and notice text', [p.get('mct-text').value, p.get('mct-morse').value, p.get('mct-error').textContent, p.get('mct-error').hidden], ['', '', '', true]);
  eq(tag + ' Clear focuses editable text', p.document.activeElement.id, 'mct-text');
  for (const [key, modifier, target] of [['l', 'ctrlKey', 'mct-text'], ['L', 'metaKey', 'mct-morse']]) {
    warning(); const e = p.key(key, modifier, target);
    eq(tag + ' shortcut clears fields and notice ' + key, [p.get('mct-text').value, p.get('mct-morse').value, p.get('mct-error').textContent, p.get('mct-error').hidden, e.defaultPrevented], ['', '', '', true, true]);
  }
  eq(tag + ' shared shortcut preserves its persistence clear calls', p.clears, ['morse-code-translator', 'morse-code-translator']);
  warning(); const outside = p.snapshot(); p.key('l', 'ctrlKey', null);
  eq(tag + ' outside CtrlL keeps tool unchanged', p.snapshot(), outside);
  p.get('mct-text').focus(); p.get('mct-text').dispatch('keydown', { key: 'l' });
  eq(tag + ' unmodified L keeps tool unchanged', p.snapshot(), outside);
  p.input('mct-text', ' \n\t'); p.get('mct-text-to-morse').click();
  eq(tag + ' empty forward clears previous Morse and notice', [p.get('mct-text').value, p.get('mct-morse').value, p.get('mct-error').textContent, p.get('mct-error').hidden], [' \n\t', '', '', true]);
  p.input('mct-morse', '... invalid'); p.get('mct-morse-to-text').click();
  eq(tag + ' unknown group remains visible in reverse result', p.get('mct-text').value, 'S[?]');
  check(tag + ' unknown group has visible notice', !p.get('mct-error').hidden && p.get('mct-error').textContent.includes('invalid'));
  p.input('mct-morse', ' \n\t'); p.get('mct-morse-to-text').click();
  eq(tag + ' empty reverse clears previous text and notice', [p.get('mct-morse').value, p.get('mct-text').value, p.get('mct-error').textContent, p.get('mct-error').hidden], [' \n\t', '', '', true]);
}

const COPY_TEXT = {
  en: ['Copy', 'Copied!', 'Could not copy. Please select and copy the Morse code manually.'],
  zh: ['复制', '已复制！', '复制失败。请选中摩斯码后手动复制。'],
  ja: ['コピー', 'コピー済み！', 'コピーできませんでした。モールス符号を選択して手動でコピーしてください。'],
  ko: ['복사', '복사됨!', '복사하지 못했습니다. 모스 부호를 선택하여 직접 복사하세요.'],
};
const copyChanges = {
  Clear(p) { p.get('mct-clear-text').click(); },
  CtrlL(p) { p.key('l', 'ctrlKey', 'mct-morse'); },
  'forward result'(p) { p.input('mct-text', 'E 中'); p.get('mct-text-to-morse').click(); },
  'reverse result'(p) { p.input('mct-morse', '... invalid'); p.get('mct-morse-to-text').click(); },
  'text edit'(p) { p.input('mct-text', 'Changed text'); },
  'Morse edit'(p) { p.input('mct-morse', '---'); },
};
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const shellFirst of [false, true]) {
  const tag = `${lang}/${shellFirst ? 'shell-first' : 'tool-first'}`, [copyLabel, copiedLabel, copyFailure] = COPY_TEXT[lang];
  {
    const p = pageVM(lang, shellFirst), before = p.snapshot(), startUnhandled = unhandled.length;
    const job = p.copy(); eq(tag + ' clipboard receives exact visible Morse', job.value, HELLO_MORSE);
    job.reject(Error('Controlled clipboard rejection')); await settle();
    eq(tag + ' current copy failure is localized and visible', [p.get('mct-error').hidden, p.get('mct-error').textContent, p.get('mct-copy-morse').textContent], [false, copyFailure, copyLabel]);
    eq(tag + ' current copy rejection is handled', unhandled.slice(startUnhandled), []);
    eq(tag + ' failed copy preserves both editable fields', [p.get('mct-text').value, p.get('mct-morse').value], [before.text, before.morse]);
    // Retry immediately with the same button/output; no edit, conversion or Clear.
    const retry = p.copy(); eq(tag + ' direct retry copies the same complete value', retry.value, job.value);
    retry.resolve(); await settle();
    eq(tag + ' direct retry clears copy error and reports success', [p.get('mct-error').textContent, p.get('mct-error').hidden, p.get('mct-copy-morse').textContent], ['', true, copiedLabel]);
    eq(tag + ' retry preserves both fields', [p.get('mct-text').value, p.get('mct-morse').value], [before.text, before.morse]);
    p.advance(1500); eq(tag + ' successful feedback expires', p.get('mct-copy-morse').textContent, copyLabel);
  }
  {
    const p = pageVM(lang, shellFirst); p.setCopyThrows(true); let thrown;
    try { p.copy(); } catch (error) { thrown = String(error); }
    eq(tag + ' synchronous clipboard failure is handled', thrown, undefined);
    eq(tag + ' synchronous clipboard failure is visible', [p.get('mct-error').hidden, p.get('mct-error').textContent], [false, copyFailure]);
    p.setCopyThrows(false); p.copy().resolve(); await settle();
    eq(tag + ' synchronous failure can retry directly', [p.get('mct-error').hidden, p.get('mct-error').textContent, p.get('mct-copy-morse').textContent], [true, '', copiedLabel]);
  }
  {
    const p = pageVM(lang, shellFirst); p.input('mct-text', 'E 中'); p.get('mct-text-to-morse').click();
    const notice = p.get('mct-error').textContent, job = p.copy();
    eq(tag + ' partial conversion copies only actual Morse', job.value, '·'); job.resolve(); await settle();
    eq(tag + ' successful copy preserves conversion notice', [p.get('mct-error').textContent, p.get('mct-error').hidden], [notice, false]);
  }
  for (const [action, change] of Object.entries(copyChanges)) for (const outcome of ['resolve', 'reject']) {
    const p = pageVM(lang, shellFirst), old = p.copy(), startUnhandled = unhandled.length;
    eq(tag + '/' + action + '/' + outcome + ' copies original result', old.value, HELLO_MORSE);
    change(p); const before = p.snapshot();
    old[outcome](outcome === 'reject' ? Error('Controlled obsolete copy rejection') : undefined); await settle();
    eq(tag + '/' + action + '/' + outcome + ' obsolete completion leaves current UI unchanged', p.snapshot(), before);
    eq(tag + '/' + action + '/' + outcome + ' obsolete completion is handled', unhandled.slice(startUnhandled), []);
  }
  {
    const p = pageVM(lang, shellFirst), old = p.copy(), current = p.copy(), startUnhandled = unhandled.length;
    current.resolve(); await settle(); const before = p.snapshot(); old.reject(Error('Old request rejected')); await settle();
    eq(tag + ' older copy failure cannot replace newer success', p.snapshot(), before);
    eq(tag + ' older request rejection is handled', unhandled.slice(startUnhandled), []);
  }
  {
    const p = pageVM(lang, shellFirst); p.copy().resolve(); await settle(); p.advance(1000);
    p.copy().resolve(); await settle(); p.advance(500);
    eq(tag + ' old deadline cannot end newer feedback', p.get('mct-copy-morse').textContent, copiedLabel);
    p.advance(1000); eq(tag + ' newer feedback expires on own deadline', p.get('mct-copy-morse').textContent, copyLabel);
  }
  for (const [action, change] of Object.entries(copyChanges)) {
    const p = pageVM(lang, shellFirst); p.copy().resolve(); await settle(); p.advance(1000);
    change(p); const before = p.snapshot();
    eq(tag + '/' + action + ' invalidates copied feedback immediately', before.copy, copyLabel);
    p.advance(500); eq(tag + '/' + action + ' old feedback deadline preserves current UI', p.snapshot(), before);
  }
  {
    const p = pageVM(lang, shellFirst); p.copy().resolve(); await settle();
    const queued = [...p.timers.values()]; check(tag + ' completed copy schedules real feedback timer', queued.length > 0);
    // Hold delivery of actual timer callbacks until their deadline, retaining their
    // closures. No timer count or callback source text is part of the contract.
    p.timers.clear(); p.advance(1500);
    p.input('mct-text', 'E'); p.get('mct-text-to-morse').click(); p.copy().resolve(); await settle();
    const before = p.snapshot(); for (const timer of queued) timer.fn();
    eq(tag + ' queued old timer cannot rewrite newer copy feedback', p.snapshot(), before);
    p.advance(1500); eq(tag + ' latest real timer still settles', p.get('mct-copy-morse').textContent, copyLabel);
  }
  {
    const p = pageVM(lang, shellFirst); p.get('mct-clear-text').click(); p.copy();
    eq(tag + ' empty output starts no clipboard operation', p.copies.length, 0);
  }
}
process.removeListener('unhandledRejection', onUnhandled);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
