// NATO Phonetic Alphabet — code word table and text conversion regression test
//
// Read:  src/components/tools/NatoPhoneticAlphabetTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source); src/layouts/ToolLayout.astro shared keyboard handler
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: the 26 letter code words equal the ICAO Annex 10 list (Alfa and Juliett, as on
// icao.int "Alphabet – Radiotelephony" and in 無線局運用規則 別表第五号); digits 0–9; case-insensitive
// lookup; spaces become "/", do not count as characters and use the localized space label in table rows; full-width letters, digits and the
// ideographic space (U+3000) match after NFKC; symbols and kana give the unknown marker; an
// emoji outside the BMP is one row; the ja page examples; 4-language STRINGS have the same keys.
// S2-9 (2026-10-09): analytics once per textarea change and distinct nonblank text; the
// execCommand('copy') fallback; the status counts [?] characters apart from converted ones; the
// nato-check / nato-rows worked examples on the four tool pages (see that section).
//
// Run: node scripts/test-nato-phonetic-alphabet.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { annotations, contractProblems, fencedBlocks, readToolMdx, withoutCode } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/NatoPhoneticAlphabetTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in NatoPhoneticAlphabetTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { NATO, convert };')();

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
const conv = (text) => E.convert(text, '[?]', '(space)');
const words = (text) => conv(text).codes.join(' ');

// ---------- code word table ----------
const ICAO = ['Alfa', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India',
  'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra',
  'Tango', 'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu'];
ICAO.forEach((word, i) => eq('letter ' + String.fromCharCode(65 + i), E.NATO[String.fromCharCode(65 + i)], word));
eq('digits 0–9', '0123456789'.split('').map((d) => E.NATO[d]),
  ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Niner']);
eq('table has 36 entries', Object.keys(E.NATO).length, 36);

// ---------- conversion ----------
eq('lower case', words('hello'), 'Hotel Echo Lima Lima Oscar');
eq('mixed case', words('HeLLo'), 'Hotel Echo Lima Lima Oscar');
eq('space → /', words('a b'), 'Alfa / Bravo');
eq('space not counted', conv('a b').chars, 2);
eq('space row uses the caller\'s label', E.convert(' ', '[?]', '（スペース）').rows, [{ ch: '（スペース）', code: '—' }]);
eq('unknown marker is the caller\'s', words('@'), '[?]');
eq('symbols', words('a.b@c'), 'Alfa [?] Bravo [?] Charlie');
eq('kana is unknown', words('あ'), '[?]');
eq('empty text', conv(''), { rows: [], codes: [], chars: 0 });
eq('prototype keys are unknown', words('_'), '[?]');

// ---------- full-width input (Japanese IME) ----------
eq('full-width letters', words('ＪＡ'), 'Juliett Alfa');
eq('full-width lower case', words('ｊａ'), 'Juliett Alfa');
eq('full-width digits', words('１２３'), 'One Two Three');
eq('ideographic space', words('Ａ　Ｂ'), 'Alfa / Bravo');
eq('full-width row keeps the typed character', conv('Ａ').rows, [{ ch: 'Ａ', code: 'Alfa' }]);

// ---------- code points ----------
eq('emoji outside the BMP is one row', conv('a😀').rows.length, 2);
eq('emoji counted once', conv('😀').chars, 1);

// ---------- ja page examples ----------
eq('ja example: JA73AB', words('JA73AB'), 'Juliett Alfa Seven Three Alfa Bravo');
eq('ja example: 予約番号 K7Q9 X2', words('K7Q9 X2'), 'Kilo Seven Quebec Niner / X-ray Two');
eq('ja example: e-mail', words('sato.k@example.jp'),
  'Sierra Alfa Tango Oscar [?] Kilo [?] Echo X-ray Alfa Mike Papa Lima Echo [?] Juliett Papa');

// ---------- en page examples ----------
{
  const enPage = readFileSync(join(root, 'src/content/tools/nato-phonetic-alphabet/en.mdx'), 'utf8');
  for (const [input, out] of [
    ['LH 400', 'Lima Hotel / Four Zero Zero'],
    ['G-ABCD', 'Golf [?] Alfa Bravo Charlie Delta'],
    ['ＡＢ１２', 'Alfa Bravo One Two'],
    ['Zoë 9', 'Zulu Oscar [?] / Niner'],
    ['F9C2', 'Foxtrot Niner Charlie Two'],
    ['e3b0c44', 'Echo Three Bravo Zero Charlie Four Four'],
    ['db-07', 'Delta Bravo [?] Zero Seven'],
  ]) {
    eq('en example: ' + input, words(input), out);
    check('en page shows ' + out, enPage.includes(out));
  }
  eq('en example: LH 400 table rows', conv('LH 400').rows.map((r) => r.ch + ' = ' + r.code),
    ['L = Lima', 'H = Hotel', '(space) = —', '4 = Four', '0 = Zero', '0 = Zero']);
  eq('en example: LH 400 counts 5', conv('LH 400').chars, 5);
  eq('en: line break is [?]', words('a\nb'), 'Alfa [?] Bravo');
  check('en page: [?] code not split', !enPage.includes('{"[?"}</code>]'));
}

// ---------- 4-language STRINGS ----------
const stringsMatch = source.match(/const STRINGS = \{([\s\S]*?)\n\} as const;/);
const STRINGS = stringsMatch ? new Function('return {' + stringsMatch[1] + '};')() : null;
check('STRINGS block found', !!stringsMatch);
if (stringsMatch) {
  const keys = Object.keys(STRINGS.en).sort().join(',');
  ['zh', 'ja', 'ko'].forEach((lang) => eq('STRINGS ' + lang + ' keys', Object.keys(STRINGS[lang]).sort().join(','), keys));
  const i18nKeys = ['labelInput', 'clear', 'placeholder', 'labelOutput', 'copy', 'outputPlaceholder', 'modeLabel', 'modeWord', 'modeTable', 'thChar', 'thCode'];
  i18nKeys.forEach((k) => check('STRINGS.en has ' + k, k in STRINGS.en));
  eq('space label per language', ['en', 'zh', 'ja', 'ko'].map((l) => STRINGS[l].space), ['(space)', '（空格）', '（スペース）', '(공백)']);
  check('render passes the localized space label', source.includes('convert(text, t.unknown, t.space)'));
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
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', text: '', _value: '', hidden: false, disabled: false, style: {}, selected: false }); }
    select() { this.selected = true; }
    removeChild(e) { this.children = this.children.filter(c => c !== e); e.parentNode = null; return e; }
    get cells() { return this.children.filter(c => c.tagName === 'TD' || c.tagName === 'TH'); }
    get classList() { const e = this; return { add(c) { if (!e.className.split(/\s+/).includes(c)) e.className = (e.className + ' ' + c).trim(); }, remove(c) { e.className = e.className.split(/\s+/).filter(x => x !== c).join(' '); } }; }
    closest(selector) { for (let e = this; e; e = e.parentNode) if (matches(e, selector)) return e; return null; }
    set innerHTML(value) { if (value !== '') throw Error('Unexpected HTML insertion'); this.textContent = ''; }
    get value() { return this._value; }
    set value(v) { this._value = String(v); }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (['id', 'class', 'type', 'value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value);
      if (key === 'hidden') this.hidden = true;
    }
    getAttribute(key) { return key === 'hidden' ? (this.hidden ? '' : null) : this.attributes[key] ?? null; }
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
  const escapeHTML = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0]
    .replace(/<Toggletip\b[^>]*>[\s\S]*?<\/Toggletip>/g, '')
    .replace(/=\{T\.(\w+)\}/g, (_, key) => '="' + escapeHTML(STRINGS[lang][key]) + '"')
    .replace(/\{T\.(\w+)\}/g, (_, key) => escapeHTML(STRINGS[lang][key]));
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
  document.createElement = tag => new Element(tag);
  document.getElementById = id => descendants(document).find(e => e.id === id) ?? null;
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing actual source ID ' + id); return e; };
  const clipboard = { writeText(value) {
    if (copyThrows) throw Error('Controlled synchronous clipboard failure');
    let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    copies.push({ value: String(value), resolve, reject }); return promise;
  } };
  const context = {
    document, console, _slug: 'nato-phonetic-alphabet',
    t: Object.fromEntries(Object.entries(STRINGS[lang]).filter(([key]) => key !== 'tips')),
    navigator: { clipboard },
    setTimeout(fn, ms = 0) { const id = ++timerID; timers.set(id, { fn, due: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ztPersist: { clear(slug) { clears.push(slug); } }, trackTool(...args) { tracks.push(args); },
  };
  context.window = context; vm.createContext(context);
  const shared = () => vm.runInContext(shortcut, context, { filename: 'ToolLayout.astro:keyboard' });
  if (shellFirst) shared();
  vm.runInContext(clientScript, context, { filename: 'NatoPhoneticAlphabetTool.astro:script' });
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
    key(key = 'l', modifier = 'ctrlKey', target = 'nato-input') { (target ? get(target) : document.body).focus(); return document.activeElement.dispatch('keydown', { key, [modifier]: true }); },
    copy() { get('nato-copy').click(); return copies.at(-1); },
    setCopyThrows(value) { copyThrows = value; },
    // execCommand('copy') fallback: absent by default (calling it throws, as in the old harness).
    setExec(fn) { document.execCommand = fn; },
    setClipboard(present) { context.navigator.clipboard = present ? clipboard : undefined; },
    bodyTextareas() { return document.body.children.filter(c => c.tagName === 'TEXTAREA'); },
    mode(mode) { document.querySelector('[data-mode="' + mode + '"]').click(); },
    rows() { return get('nato-table-body').querySelectorAll('tr').map(tr => tr.cells.map(td => td.textContent)); },
    snapshot() { return { input: get('nato-input').value, output: get('nato-output').value, rows: this.rows(), status: get('nato-status').textContent, copy: get('nato-copy').textContent }; },
  };
}

// DOM visibility flags and the authored hidden selector are checked here. Actual
// computed style and pointer hit testing are verified separately in the browser.
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const shellFirst of [false, true]) {
  const tag = `${lang}/${shellFirst ? 'shell-first' : 'tool-first'}`;
  const p = pageVM(lang, shellFirst);
  eq(tag + ' initial empty result', [p.get('nato-output').value, p.rows(), p.get('nato-status').textContent], ['', [], '']);
  p.input('nato-input', 'AB'); p.advance(199);
  eq(tag + ' preserves 200ms debounce', p.get('nato-output').value, ''); p.advance(1);
  eq(tag + ' actual input produces words', p.get('nato-output').value, 'Alfa Bravo');
  eq(tag + ' actual input produces table', p.rows(), [['A', 'Alfa'], ['B', 'Bravo']]);
  p.mode('table');
  eq(tag + ' Table hides only Word body', [p.get('nato-output').hidden, p.get('nato-output').closest('.nato-panel').hidden, p.get('nato-table-wrap').hidden], [true, false, false]);
  check(tag + ' Table Copy has no hidden ancestor', !p.get('nato-copy').closest('[hidden]'));
  eq(tag + ' Table serializes complete result', p.copy().value, 'A = Alfa\nB = Bravo'); p.copies.at(-1).resolve(); await settle();
  p.mode('word');
  eq(tag + ' Word hides Table and restores Word body', [p.get('nato-output').hidden, p.get('nato-table-wrap').hidden], [false, true]);
  eq(tag + ' Word serializes complete result', p.copy().value, 'Alfa Bravo'); p.copies.at(-1).resolve(); await settle();
  p.mode('table'); p.mode('word');
  eq(tag + ' mode round trip preserves result data', [p.get('nato-output').value, p.rows()], ['Alfa Bravo', [['A', 'Alfa'], ['B', 'Bravo']]]);
}
check('authored hidden selector defeats textarea display rules', /\.nato-panel textarea\[hidden\]\s*\{\s*display:\s*none;\s*\}/.test(source));
const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro/package.json'));
const { transform } = await import(astroRequire.resolve('@astrojs/compiler'));
const compiled = await transform(source, { filename: 'NatoPhoneticAlphabetTool.astro' });
check('Astro reports no component compile errors', !compiled.diagnostics.some(d => d.severity === 1));
check('compiled scoped CSS preserves the textarea hidden rule', compiled.css.some(css => /\.nato-panel[^{}]*textarea[^{}]*\[hidden\][^{}]*\{\s*display:\s*none/.test(css)));

const STATUS = { en: 'Converted 2 characters.', zh: '已转换 2 个字符。', ja: '2 文字を変換しました。', ko: '2자를 변환했습니다.' };
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const shellFirst of [false, true]) {
  const tag = `${lang}/${shellFirst ? 'shell-first' : 'tool-first'}`;
  for (const mode of ['word', 'table']) for (const pending of [false, true]) {
    const p = pageVM(lang, shellFirst); p.input('nato-input', 'AB'); p.advance(200); p.mode(mode);
    eq(tag + ' ' + mode + ' localized conversion summary', p.get('nato-status').textContent, STATUS[lang]);
    if (pending) p.input('nato-input', 'CD');
    const event = p.key(pending ? 'L' : 'l', pending ? 'metaKey' : 'ctrlKey', mode === 'word' ? 'nato-input' : 'nato-copy');
    eq(tag + ' ' + mode + ' shortcut clears all current result data', [p.get('nato-input').value, p.get('nato-output').value, p.rows(), p.get('nato-status').textContent], ['', '', [], '']);
    check(tag + ' shortcut prevents native navigation', event.defaultPrevented);
    eq(tag + ' shortcut calls shared persistence clear once', p.clears, ['nato-phonetic-alphabet']);
    p.advance(500); p.mode(mode === 'word' ? 'table' : 'word');
    eq(tag + ' late render and mode switch cannot restore cleared result', [p.get('nato-output').value, p.rows(), p.get('nato-status').textContent], ['', [], '']);
    p.input('nato-input', 'Ａ9😀'); p.advance(200);
    eq(tag + ' valid and unknown inputs recover after shortcut', [p.get('nato-output').value, p.rows()], ['Alfa Niner [?]', [['Ａ','Alfa'],['9','Niner'],['😀','[?]']]]);
  }
  const p = pageVM(lang, shellFirst); p.input('nato-input', 'AB'); p.advance(200); p.mode('table');
  const before = p.snapshot(); const outside = p.key('l', 'ctrlKey', null);
  eq(tag + ' outside CtrlL keeps current data', p.snapshot(), before); check(tag + ' outside CtrlL not prevented', !outside.defaultPrevented);
  p.get('nato-input').focus(); p.get('nato-input').dispatch('keydown', { key: 'l' });
  eq(tag + ' plain L keeps current data', p.snapshot(), before);
  p.get('nato-clear').click();
  eq(tag + ' Clear empties both result representations and summary', [p.get('nato-input').value, p.get('nato-output').value, p.rows(), p.get('nato-status').textContent], ['', '', [], '']);
}


const COPY_TEXT = {
  en: ['Copy', 'Copied!', 'Could not copy. Try again or copy the output manually.'],
  zh: ['复制', '已复制！', '复制失败。请重试，或选中输出后手动复制。'],
  ja: ['コピー', 'コピー済み！', 'コピーできませんでした。再試行するか、出力を選択して手動でコピーしてください。'],
  ko: ['복사', '복사됨!', '복사하지 못했습니다. 다시 시도하거나 출력을 선택하여 직접 복사하세요.'],
};
const actions = {
  clear: p => p.get('nato-clear').click(),
  shortcut: p => p.key(),
  pendingInput: p => p.input('nato-input', 'CD'),
  newResult: p => { p.input('nato-input', 'CD'); p.advance(200); },
  mode: p => p.mode('table'),
  emptyInput: p => p.input('nato-input', ''),
};
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const shellFirst of [false, true]) {
  const tag = `${lang}/${shellFirst ? 'shell-first' : 'tool-first'}`;
  const [copyLabel, copiedLabel, copyFailure] = COPY_TEXT[lang];
  const populated = () => { const p = pageVM(lang, shellFirst); p.input('nato-input', 'AB'); p.advance(200); return p; };
  for (const mode of ['word', 'table']) {
    const p = populated(); p.mode(mode); const output = mode === 'word' ? 'Alfa Bravo' : 'A = Alfa\nB = Bravo';
    const job = p.copy(); eq(tag + ' ' + mode + ' clipboard gets exact result', job.value, output);
    unhandled.length = 0; job.reject(Error('controlled rejection')); await settle();
    eq(tag + ' ' + mode + ' current rejection visible and localized', p.get('nato-status').textContent, copyFailure);
    eq(tag + ' current rejection has no unhandled Promise', unhandled, []);
    eq(tag + ' failure preserves result', [p.get('nato-output').value, p.rows()], ['Alfa Bravo', [['A','Alfa'],['B','Bravo']]]);
    const retry = p.copy(); eq(tag + ' direct retry preserves exact copied text', retry.value, output);
    retry.resolve(); await settle();
    eq(tag + ' direct retry restores summary and succeeds', [p.get('nato-status').textContent, p.get('nato-copy').textContent], [STATUS[lang], copiedLabel]);
    p.advance(1499); eq(tag + ' feedback lasts until own deadline', p.get('nato-copy').textContent, copiedLabel);
    p.advance(1); eq(tag + ' feedback resets at own deadline', p.get('nato-copy').textContent, copyLabel);
  }
  {
    const p = populated(); p.setCopyThrows(true); let thrown = '';
    try { p.copy(); } catch (e) { thrown = String(e); }
    eq(tag + ' synchronous writeText failure handled', thrown, '');
    eq(tag + ' synchronous failure visible', p.get('nato-status').textContent, copyFailure);
    p.setCopyThrows(false); p.copy().resolve(); await settle();
    eq(tag + ' synchronous failure direct retry succeeds', [p.get('nato-status').textContent, p.get('nato-copy').textContent], [STATUS[lang], copiedLabel]);
  }
  for (const [name, action] of Object.entries(actions)) for (const completion of ['resolve', 'reject']) {
    const p = populated(), job = p.copy(); action(p); const before = p.snapshot();
    unhandled.length = 0; job[completion](Error('controlled old result')); await settle();
    eq(tag + ' ' + name + ' late ' + completion + ' preserves current UI', p.snapshot(), before);
    eq(tag + ' ' + name + ' late rejection handled', unhandled, []);
  }
  for (const oldFirst of [true, false]) for (const completion of ['resolve', 'reject']) {
    const p = populated(), old = p.copy(), latest = p.copy(); unhandled.length = 0;
    if (oldFirst) {
      old[completion](Error('old')); await settle();
      eq(tag + ' old ' + completion + ' cannot label pending newer copy', p.get('nato-copy').textContent, copyLabel);
    }
    latest.resolve(); await settle(); const current = p.snapshot();
    if (!oldFirst) { old[completion](Error('old')); await settle(); }
    eq(tag + ' ' + completion + ' completion order preserves newer copy', p.snapshot(), current);
    eq(tag + ' latest copy succeeds in either completion order', p.get('nato-copy').textContent, copiedLabel);
    eq(tag + ' reordered rejection handled', unhandled, []);
  }
  {
    const p = populated(); p.copy().resolve(); await settle(); p.advance(1000); p.copy().resolve(); await settle();
    p.advance(500); eq(tag + ' first timer cannot clear newer feedback', p.get('nato-copy').textContent, copiedLabel);
    p.advance(999); eq(tag + ' newer feedback remains before deadline', p.get('nato-copy').textContent, copiedLabel);
    p.advance(1); eq(tag + ' newer timer still settles', p.get('nato-copy').textContent, copyLabel);
  }
  for (const [name, action] of Object.entries(actions)) {
    const p = populated(); p.copy().resolve(); await settle(); action(p);
    eq(tag + ' ' + name + ' resets old Copied feedback immediately', p.get('nato-copy').textContent, copyLabel);
    if (name === 'pendingInput' || name === 'emptyInput') p.advance(200);
    const before = p.snapshot(); p.advance(2000);
    eq(tag + ' ' + name + ' old timer preserves current UI', p.snapshot(), before);
  }
  {
    const p = populated(); p.copy().resolve(); await settle();
    const queued = [...p.timers.values()].filter(t => t.due === 1700); p.timers.clear(); p.advance(1500);
    p.input('nato-input', 'CD'); p.advance(200); p.copy().resolve(); await settle(); const before = p.snapshot();
    check(tag + ' captures actual completed-copy timer', queued.length > 0);
    for (const timer of queued) timer.fn();
    eq(tag + ' overdue callback cannot erase newer feedback', p.snapshot(), before);
    p.advance(1500); eq(tag + ' new timer settles after held old timer', p.get('nato-copy').textContent, copyLabel);
  }
  const p = populated(); p.get('nato-clear').click(); p.copy(); p.mode('table'); p.copy();
  eq(tag + ' empty Word and Table never call clipboard', p.copies.length, 0);
}

// ---------- analytics: one event per committed change (S2-9, 2026-10-09) ----------
// render() used to call trackTool after every 200 ms pause in typing. Now only the textarea
// change event sends it, once per distinct nonblank text; Clear and Ctrl/⌘+L reset that.
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = pageVM(lang, false), input = p.get('nato-input'), commit = () => input.dispatch('change');
  p.input('nato-input', 'A'); p.advance(200); p.input('nato-input', 'AB'); p.advance(200);
  eq(lang + ' GA: typing and rendering send nothing', p.tracks, []);
  commit();
  eq(lang + ' GA: change sends one convert event', p.tracks, [['nato_phonetic_alphabet', 'convert']]);
  commit(); p.mode('table'); p.mode('word');
  eq(lang + ' GA: same text and mode switches send nothing more', p.tracks.length, 1);
  p.input('nato-input', 'ABC'); commit();
  eq(lang + ' GA: an edited text is sent again, even before the debounce', p.tracks.length, 2);
  p.get('nato-clear').click(); p.input('nato-input', 'ABC'); commit();
  eq(lang + ' GA: Clear lets the same text count again', p.tracks.length, 3);
  p.key('l', 'ctrlKey'); p.input('nato-input', 'ABC'); commit();
  eq(lang + ' GA: Ctrl+L lets the same text count again', p.tracks.length, 4);
  for (const blank of ['   ', '\u3000', '']) { p.input('nato-input', blank); commit(); }
  eq(lang + ' GA: blank text sends nothing', p.tracks.length, 4);
}

// ---------- copy fallback: hidden textarea + execCommand('copy') (S2-9) ----------
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const [, copiedLabel, copyFailure] = COPY_TEXT[lang];
  const populated = (mode = 'word') => { const p = pageVM(lang, false); p.input('nato-input', 'AB'); p.advance(200); p.mode(mode); return p; };
  for (const [mode, text] of [['word', 'Alfa Bravo'], ['table', 'A = Alfa\nB = Bravo']]) {
    const p = populated(mode), seen = [];
    p.setExec(cmd => { const ta = p.bodyTextareas()[0]; seen.push([cmd, ta?.value, ta?.selected, ta?.getAttribute('readonly'), ta?.style.position]); return true; });
    const job = p.copy(); unhandled.length = 0; job.reject(Error('controlled denial')); await settle();
    eq(lang + ' ' + mode + ' rejected Clipboard API falls back to execCommand with the exact text', seen, [['copy', text, true, '', 'fixed']]);
    eq(lang + ' ' + mode + ' fallback success shows Copied and keeps the summary', [p.get('nato-copy').textContent, p.get('nato-status').textContent], [copiedLabel, STATUS[lang]]);
    eq(lang + ' ' + mode + ' fallback removes its textarea and returns focus to Copy', [p.bodyTextareas().length, p.document.activeElement === p.get('nato-copy')], [0, true]);
    eq(lang + ' ' + mode + ' fallback rejection is handled', unhandled, []);
  }
  {
    const p = populated(), seen = []; p.setClipboard(false); p.setExec(cmd => { seen.push(cmd); return true; });
    p.get('nato-copy').click();
    eq(lang + ' missing Clipboard API copies through execCommand at once', [p.copies.length, seen, p.get('nato-copy').textContent], [0, ['copy'], copiedLabel]);
  }
  {
    const p = populated(); p.setCopyThrows(true); p.setExec(() => true); p.get('nato-copy').click();
    eq(lang + ' throwing Clipboard API copies through execCommand', p.get('nato-copy').textContent, copiedLabel);
  }
  for (const [name, exec] of [['returns false', () => false], ['throws', () => { throw Error('blocked'); }]]) {
    const p = populated(); p.setExec(exec); const job = p.copy(); job.reject(Error('denied')); await settle();
    eq(lang + ' execCommand ' + name + ': failure stays visible', [p.get('nato-status').textContent, p.bodyTextareas().length], [copyFailure, 0]);
  }
  for (const [name, action] of Object.entries(actions)) {
    const p = populated(); let calls = 0; p.setExec(() => { calls++; return true; });
    const job = p.copy(); action(p); const before = p.snapshot();
    job.reject(Error('old')); await settle();
    eq(lang + ' ' + name + ': a stale rejection does not fall back', [calls, p.snapshot()], [0, before]);
  }
}

// ---------- status separates characters without a code word (S2-9) ----------
// The summary used to count every nonspace character as converted ("Converted 6 characters."
// for G-ABCD, whose "-" is shown as [?]); now [?] characters are counted separately.
const UNKNOWN_STATUS = {
  en: ['Converted 5 characters. No code word for 1 character, shown as [?].', 'Converted 0 characters. No code word for 2 characters, shown as [?].'],
  zh: ['已转换 5 个字符。1 个字符没有代号，显示为 [?]。', '已转换 0 个字符。2 个字符没有代号，显示为 [?]。'],
  ja: ['5 文字を変換しました。コードのない 1 文字は [?] と表示しました。', '0 文字を変換しました。コードのない 2 文字は [?] と表示しました。'],
  ko: ['5자를 변환했습니다. 코드가 없는 1자는 [?]로 표시했습니다.', '0자를 변환했습니다. 코드가 없는 2자는 [?]로 표시했습니다.'],
};
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = pageVM(lang, false), status = () => p.get('nato-status').textContent;
  p.input('nato-input', 'G-ABCD'); p.advance(200);
  eq(lang + ' status counts [?] characters separately', status(), UNKNOWN_STATUS[lang][0]);
  p.input('nato-input', 'あ\n'); p.advance(200);
  eq(lang + ' status when no character has a code word', status(), UNKNOWN_STATUS[lang][1]);
  p.input('nato-input', 'LH 400'); p.advance(200);
  eq(lang + ' status without [?] keeps the short form', status(), { en: 'Converted 5 characters.', zh: '已转换 5 个字符。', ja: '5 文字を変換しました。', ko: '5자를 변환했습니다.' }[lang]);
  p.input('nato-input', 'a b'); p.advance(200);
  eq(lang + ' spaces are neither converted nor [?]', status(), { en: 'Converted 2 characters.', zh: '已转换 2 个字符。', ja: '2 文字を変換しました。', ko: '2자를 변환했습니다.' }[lang]);
}

// ---------- worked examples on the tool pages (S2-9, 2026-10-09) ----------
// {/* nato-check: {"in": "x" | ["x", …], "rows"?: true | [i, …], "status"?: true} */} or
// {/* nato-check: {"cases": [{"in": "x", "rows"?: …, "status"?: true, "word"?: false}, …]} */} on
// src/content/tools/nato-phonetic-alphabet/{lang}.mdx: the real page script in the page language
// converts each input. Its Word-mode output must appear as inline code, a <code> element or a
// code-block line after the annotation (up to the next nato-check or H2). With "rows", the
// listed Table-mode rows ("character = code" as Copy writes them, with the localized space label;
// true = all rows) must appear the same way; with "status", the status line text must appear
// verbatim in that text ("word": false skips the Word-output check for a status-only example).
// {/* nato-rows: {"in": i, "out": j} */}: in the first Markdown table after it, column j of every
// body row equals the Word-mode output for column i (the ja page's 変換例 table).
{
  const before = passes, beforeFailures = failures;
  const pageRun = (lang, input) => {
    const p = pageVM(lang, false); p.input('nato-input', input); p.advance(200);
    return { word: p.get('nato-output').value, rows: p.rows().map(([ch, code]) => ch + ' = ' + code), status: p.get('nato-status').textContent };
  };
  const codeTexts = (after) => {
    const out = new Set();
    for (const b of fencedBlocks(after)) { out.add(b.text); for (const line of b.text.split('\n')) out.add(line.trim()); }
    const prose = withoutCode(after);
    for (const m of prose.matchAll(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g)) out.add(m[2].replace(/^ ([\s\S]*) $/, '$1'));
    for (const m of prose.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)) {
      const js = /^\{"((?:[^"\\]|\\[\s\S])*)"\}$/.exec(m[1]);
      out.add(js ? JSON.parse('"' + js[1] + '"') : m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
    }
    return out;
  };
  const verifyCheck = ({ spec, after, lang }) => {
    const cases = Array.isArray(spec?.cases) ? spec.cases
      : spec && spec.in !== undefined ? [].concat(spec.in).map((input) => ({ in: input, rows: spec.rows, status: spec.status })) : null;
    if (!cases || !cases.length || cases.some((c) => typeof c?.in !== 'string' || !c.in)) return 'annotation needs "in" or "cases"';
    const codes = codeTexts(after);
    for (const c of cases) {
      const r = pageRun(lang, c.in);
      if (c.word !== false && !codes.has(r.word)) return JSON.stringify(c.in) + ': Word output ' + JSON.stringify(r.word) + ' is not shown as code';
      const want = c.rows === true ? r.rows : Array.isArray(c.rows) ? c.rows.map((i) => r.rows[i]) : [];
      for (const row of want) if (row === undefined || !codes.has(row)) return JSON.stringify(c.in) + ': Table row ' + JSON.stringify(row) + ' is not shown as code';
      if (c.status && !after.includes(r.status)) return JSON.stringify(c.in) + ': status ' + JSON.stringify(r.status) + ' is not quoted';
    }
    return null;
  };
  const verifyRows = ({ spec, after, lang }) => {
    if (!Number.isInteger(spec?.in) || !Number.isInteger(spec?.out)) return 'annotation needs integer "in" and "out" columns';
    const lines = after.split('\n'), start = lines.findIndex((l) => /^\s*\|/.test(l));
    if (start < 0) return 'no table after the annotation';
    const table = [];
    for (let i = start; i < lines.length && /^\s*\|/.test(lines[i]); i++) table.push(lines[i]);
    const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((s) => s.trim().replace(/\\\|/g, '|'));
    const body = table.slice(2).map(cells);
    if (!body.length) return 'table has no body rows';
    for (const row of body) {
      if (!row[spec.in]) return 'empty input cell in ' + JSON.stringify(row);
      const r = pageRun(lang, row[spec.in]);
      if (r.word !== row[spec.out]) return JSON.stringify(row[spec.in]) + ': page gives ' + JSON.stringify(r.word) + ', table shows ' + JSON.stringify(row[spec.out]);
    }
    return null;
  };
  const docs = readToolMdx('nato-phonetic-alphabet');
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    eq(lang + ' worked examples, Limits and FAQ ids pass the S2 contract', contractProblems('nato-phonetic-alphabet', lang, {
      limits: true, requireFaqIds: true,
      annotations: [{ tag: 'nato-check', min: 1, verify: verifyCheck }, { tag: 'nato-rows', verify: verifyRows }],
    }), '');
    const count = annotations(docs[lang].body, 'nato-check').length + annotations(docs[lang].body, 'nato-rows').length;
    check(lang + ' has at least 2 recomputed examples', count >= 2, String(count));
  }
  check('nato-check catches a wrong Word output', verifyCheck({ spec: { in: 'AB' }, after: '\n`Alfa Charlie`\n', lang: 'en' }) !== null);
  check('nato-check accepts a JSX string <code> element', verifyCheck({ spec: { in: 'AB' }, after: '\n<code>{"Alfa Bravo"}</code>\n', lang: 'en' }) === null);
  check('nato-check catches a missing Table row', verifyCheck({ spec: { cases: [{ in: 'A B', rows: true }] }, after: '\n`Alfa / Bravo` `A = Alfa` `B = Bravo`\n', lang: 'en' }) !== null);
  check('nato-check uses the localized space row', verifyCheck({ spec: { cases: [{ in: 'A B', rows: [1] }] }, after: '\n`Alfa / Bravo`、`（空格） = —`\n', lang: 'zh' }) === null);
  check('nato-check catches a wrong status', verifyCheck({ spec: { cases: [{ in: 'A-B', status: true }] }, after: '\n`Alfa [?] Bravo` gives “Converted 3 characters.”\n', lang: 'en' }) !== null);
  check('nato-rows catches a wrong table cell', verifyRows({ spec: { in: 0, out: 1 }, after: '\n| In | Out |\n|---|---|\n| AB | Alfa Charlie |\n', lang: 'en' }) !== null);
  check('nato-rows accepts the page output', verifyRows({ spec: { in: 0, out: 1 }, after: '\n| In | Out |\n|---|---|\n| K7Q9 X2 | Kilo Seven Quebec Niner / X-ray Two |\n', lang: 'ja' }) === null);
  console.log('tool page examples: ' + (passes - before) + ' passed, ' + (failures - beforeFailures) + ' failed');
}

process.removeListener('unhandledRejection', onUnhandled);

// ---------- v2 page layout ----------
const v2Start = passes;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const PROTECTED = {
  "png": "b944281f5bb9dcfcb363c49b3e73b06ba69bbf7d5a24a9df231e8b3186c4df31"
};
const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
const css = source.split('<style>')[1].split('</style>')[0];
check('v2 root is a direct flex column', /^<div class="nato-wrap">/.test(markup) && /\.nato-wrap\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*min-height:\s*0/.test(css));
check('v2 registry uses convert', /'nato-phonetic-alphabet':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
check('v2 options then reserved status then panels', markup.indexOf('nato-options') < markup.indexOf('id="nato-status"') && markup.indexOf('id="nato-status"') < markup.indexOf('nato-panels'));
check('v2 status has stable height and internal scroll', /\.nato-status\s*\{[^}]*flex:\s*none;[^}]*height:\s*3rem;[^}]*overflow:\s*auto/.test(css));
check('v2 shared bounded pane grid', markup.includes('class="nato-panels zt-io"') && [...markup.matchAll(/zt-io-pane/g)].length === 2);
for (const id of ['nato-input', 'nato-output', 'nato-table-wrap']) check('v2 shared fill for ' + id, new RegExp('id="' + id + '"[^>]*zt-io-fill').test(markup));
check('v2 input remains editable and output readonly', !/<textarea id="nato-input"[^>]*readonly/.test(markup) && /<textarea id="nato-output"[^>]*readonly/.test(markup));
check('v2 table is a keyboard-focusable scroll region', /id="nato-table-wrap"[^>]*tabindex="0"[^>]*role="region"[^>]*aria-labelledby="nato-result-label"/.test(markup));
check('v2 both result formats scroll internally', /\.nato-box\s*\{[^}]*overflow:\s*auto/.test(css) && /\.nato-table-wrap\s*\{[^}]*overflow:\s*auto/.test(css));
check('v2 mobile stacked results have fixed dimensions', /@media\s*\(max-width:\s*860px\)[\s\S]*\.nato-box, \.nato-table-wrap\s*\{\s*height:\s*180px/.test(css) && /@media\s*\(max-width:\s*640px\)[\s\S]*\.nato-box\s*\{\s*height:\s*140px/.test(css));
check('v2 empty result hides only at stacked width', /@media\s*\(max-width:\s*860px\)[\s\S]*\.nato-result-pane\[data-empty="true"\]\s*\{\s*display:\s*none/.test(css));
check('v2 mobile controls are 44px targets', /\.nato-mode-btn, \.nato-clear \.btn-ghost, \.nato-copy \.btn-copy\s*\{\s*min-height:\s*44px/.test(css));
check('v2 runtime-created cells have reachable CSS', /\.nato-table :global\(td\)/.test(css) && /\.nato-table :global\(\.nato-char\)/.test(css));
check('v2 compiled cells do not require a scoped attribute', compiled.css.some(text => /\.nato-table[^{}]*\s+td\s*\{[^}]*padding:/.test(text)));
check('v2 client receives only selected strings without tips', source.includes('const { tips: TIPS, ...CLIENT_T } = T;') && source.includes('define:vars={{ t: CLIENT_T }}') && !/STRINGS|TIPS|data-i18n|pageLang/.test(clientScript));
check('v2 rendered markup has no runtime localization attributes', !/data-i18n/.test(markup));
eq('v2 retains all four existing buttons', [...markup.matchAll(/<button\b/g)].length, 4);
check('v2 automatic conversion adds no primary Run button', !/btn-primary/.test(markup));
eq('v2 source-backed tip mappings', [...markup.matchAll(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{T\.(\w+)\}(?: wide)?>\{TIPS\.(\w+)\}<\/Toggletip>/g)].map(m => m.slice(1)).sort(), [
  ['nato-tip-mode', 'modeLabel', 'mode'], ['nato-tip-clear', 'clear', 'clear'], ['nato-tip-input', 'labelInput', 'input'], ['nato-tip-copy', 'copy', 'copy'],
].sort());
function leaves(value, path = '') { return Object.entries(value).flatMap(([key, item]) => typeof item === 'object' ? leaves(item, path + key + '.') : [[path + key, item]]); }
const enLeaves = Object.fromEntries(leaves(STRINGS.en));
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const local = Object.fromEntries(leaves(STRINGS[lang]));
  eq(lang + ' v2 recursive keys match', Object.keys(local).sort(), Object.keys(enLeaves).sort());
  for (const [key, value] of Object.entries(local)) {
    check(lang + ' v2 nonempty ' + key, typeof value === 'string' && value.trim().length > 0);
    // {s} is the English-only plural suffix in the converted summary and the [?] note.
    const placeholders = text => [...text.matchAll(/\{[^}]+\}/g)].map(m => m[0]).filter(p => !['converted', 'unknownNote'].includes(key) || p !== '{s}').sort();
    eq(lang + ' v2 placeholders ' + key, placeholders(value), placeholders(enLeaves[key]));
  }
  const mdx = readFileSync(join(root, 'src/content/tools/nato-phonetic-alphabet', lang + '.mdx'), 'utf8');
  const steps = (mdx.match(/^steps:\n([\s\S]*?)(?=^faqItems:)/m)?.[1] || '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line.trim().slice(2)));
  check(lang + ' v2 has four bounded steps', steps.length === 4 && steps.every(step => [...step].length <= 280) && steps.reduce((n, step) => n + [...step].length, 0) <= 1200);
  check(lang + ' v2 steps are plain text', steps.every(step => !/[<>]|\]\(|\*\*|`/.test(step)));
  check(lang + ' v2 steps name current controls', ['labelInput', 'labelOutput', 'modeWord', 'modeTable', 'clear', 'copy'].every(key => steps.join(' ').includes(STRINGS[lang][key])));
  check(lang + ' v2 removes only Usage section', !/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx));
  eq(lang + ' MDX content contract', contractProblems('nato-phonetic-alphabet', lang), '');
  const p = pageVM(lang, false), result = p.get('nato-result-pane');
  eq(lang + ' v2 initial result has empty state', result.getAttribute('data-empty'), 'true');
  check(lang + ' v2 both bodies and Copy share one result pane', ['nato-output', 'nato-table-wrap', 'nato-copy'].every(id => result.contains(p.get(id))));
  p.input('nato-input', 'AB'); p.advance(200);
  eq(lang + ' v2 converted result exits empty state', result.getAttribute('data-empty'), 'false');
  p.mode('table'); p.input('nato-input', 'A9'.repeat(300)); p.advance(200);
  eq(lang + ' v2 full long table remains available', p.rows().length, 600);
  eq(lang + ' v2 full long table copy is untruncated', p.copy().value, Array(300).fill('A = Alfa\n9 = Niner').join('\n'));
  p.get('nato-clear').click();
  eq(lang + ' v2 clear restores empty state in Table mode', result.getAttribute('data-empty'), 'true');
  p.input('nato-input', 'C'); p.advance(200);
  eq(lang + ' v2 clear preserves selected mode on recovery', [p.get('nato-output').hidden, p.get('nato-table-wrap').hidden, p.rows()], [true, false, [['C', 'Charlie']]]);
}
eq('v2 preserves static Japanese chart PNG', sha256(readFileSync(join(root, 'public/images/nato-phonetic-alphabet-ja.png'))), PROTECTED.png);
eq('v2 preserves engine marker bytes', sha256(source.slice(startIndex, endIndex + END_MARK.length)), 'e3abbb1afe24cc37d3c9721184761f8fdb75e6267495ef5402ff4c53a6625bc6');
console.log('v2 page layout: ' + (passes - v2Start) + ' passed');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
