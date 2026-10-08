// Slugify — symbol and letter mappings are applied
//
// Read:  src/components/tools/SlugifyTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: letters outside the table fall back to their base letter (NFD, then combining marks
// removed; Łódź → lodz) and letters without a decomposition map by the sindresorhus/transliterate
// table (ł → l, đ → d, œ → oe, ı → i). Also every entry of the mapping table on the tool page. Before the fix the lookup ran only
// on non-ASCII characters (/[^\u0000-\u007E]/), so the ASCII symbols & @ # % + were never
// mapped and became separators (Rock & Roll → rock-roll). Symbols map to a separate word,
// as sindresorhus/slugify does for & → " and " (Tom&Jerry → tom-and-jerry); letters map in
// place (Crème → creme). Expected values are literals written from the page's table.
// Also: lowercase / trim options, the three separators, removed CJK input.
//
// Run: node scripts/test-slugify.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SlugifyTool.astro'), 'utf8');
const STR = new Function('return ' + source.match(/const STRINGS = (\{[\s\S]*?\n\}) as const;/)[1])();

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in SlugifyTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { slugify };')();

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
const DEF = { separator: '-', lowercase: true, trim: true };
const s = (text, opts) => E.slugify(text, Object.assign({}, DEF, opts || {}));
const t = (input, expected, opts) => eq(JSON.stringify(input) + (opts ? ' ' + JSON.stringify(opts) : ''), s(input, opts), expected);

// ---------- the reported defect: ASCII symbol mappings ----------
t('Rock & Roll', 'rock-and-roll');
t('Tom&Jerry', 'tom-and-jerry');
t('me@example', 'me-at-example');
t('C# Guide', 'c-hash-guide');
t('100% Pure', '100-percent-pure');
t('C++', 'c-plus-plus');

// ---------- non-ASCII symbol mappings ----------
t('© 2024 Acme', 'c-2024-acme');
t('Brand®', 'brand-r');
t('Name™', 'name-tm');
t('5€', '5-euro');
t('£10', 'pound-10');
t('¥500', 'yen-500');
t('30°C', '30-deg-c');
t('3×4', '3-x-4');
t('8÷2', '8-div-2');

// ---------- letter mappings (lowercase) ----------
t('àáâãäå', 'aaaaaa');
t('æ', 'ae');
t('ç', 'c');
t('èéêë', 'eeee');
t('ìíîï', 'iiii');
t('ð', 'd');
t('ñ', 'n');
t('òóôõöø', 'oooooo');
t('ùúûü', 'uuuu');
t('ý', 'y');
t('þ', 'th');
t('ß', 'ss');
// uppercase letters, with Lowercase off
const keep = { lowercase: false };
t('ÀÁÂÃÄÅ', 'AAAAAA', keep);
t('Æ', 'AE', keep);
t('Ç', 'C', keep);
t('ÈÉÊË', 'EEEE', keep);
t('ÌÍÎÏ', 'IIII', keep);
t('Ð', 'D', keep);
t('Ñ', 'N', keep);
t('ÒÓÔÕÖØ', 'OOOOOO', keep);
t('ÙÚÛÜ', 'UUUU', keep);
t('Ý', 'Y', keep);
t('Þ', 'TH', keep);
t('Crème Brûlée', 'creme-brulee');
t('Straße', 'strasse');

// ---------- options ----------
t('Rock & Roll', 'Rock-and-Roll', keep);
t('Rock & Roll', 'rock_and_roll', { separator: '_' });
t('Rock & Roll', 'rock.and.roll', { separator: '.' });
t('Hello World!', 'hello-world-', { trim: false });
t('  Hello   World  ', 'hello-world');
t('snake_case and-kebab.dot', 'snake-case-and-kebab-dot');
t('Hello World!', 'hello-world');

// ---------- removed characters ----------
// letters outside the table: NFD + remove Mn falls back to the base letter (was removed: Łódź → od)
t('Łódź', 'lodz');
t('ŁÓDŹ', 'LODZ', { lowercase: false });
t('Škoda', 'skoda');
t('Tiếng Việt', 'tieng-viet');
t('İstanbul', 'istanbul');
t('Ångström', 'angstrom');
t('cafe\u0301 noir', 'cafe-noir');
// letters without a decomposition, from sindresorhus/transliterate
t('Đặng', 'dang');
// page limitation: no language-specific rules
t('ä ö ü', 'a-o-u');
t('İ', 'I', keep);
t('œuvre', 'oeuvre');
t('Œ', 'OE', keep);
t('ẞ', 'Ss', keep);
t('ı', 'i');
t('Ħal', 'hal');
t('ĳssel', 'ijssel');
t('Ĳ', 'IJ', keep);
t('ə', 'a');
t('Ł', 'L', keep);
t('ł', 'l');
t('đ', 'd');
t('Đ', 'D', keep);
t("John's Guide", 'johns-guide');
t('你好', '');
t('日本語 Guide', 'guide');

// ---------- format characters (General_Category=Cf) are deleted ----------
// Soft hyphen, zero-width space / non-joiner / joiner, word joiner, LRM and BOM are invisible and
// are deleted without a separator, as on master and in WordPress sanitize_title_with_dashes().
t('hyphen\u00ADation', 'hyphenation');
t('Java\u200BScript', 'javascript');
t('co\u200Coperate', 'cooperate');
t('Ice\u2060cream', 'icecream');
t('Hello\u200EWorld', 'helloworld');
t('\uFEFFTitle', 'title');
t('a\u200Db', 'ab');
t('Don\u00AD\u2019t stop', 'dont-stop');

// ---------- removed characters split words; full-width forms; won sign ----------
// A deleted character (CJK, full-width space, other non-ASCII) acts as a separator, so the
// Latin words around it stay apart; runs merge and Trim removes them at the ends. Before the
// fix the character was deleted with no separator (Vue3入门Vite教程 → vue3vite).
t('Vue3入门Vite教程', 'vue3-vite');
t('Vue3入门Vite教程', 'vue3_vite', { separator: '_' });
t('Vue3入门Vite教程', 'vue3.vite', { separator: '.' });
t('Hello\u3000World', 'hello-world');
t('【2026年版】Next.js 15 入門', '2026-next-js-15');
t('Next.js로 블로그 만들기', 'next-js');
t('Vue3와Vite로 시작하기', 'vue3-vite');
t('東京Tokyo', 'Tokyo', { lowercase: false });
t('東京 Tokyo', '-tokyo', { trim: false });
t('I ♥ Dogs', 'i-dogs');
// Full-width forms (U+3000, U+FF01–FF5E, U+FFE0–FFE6) are NFKC-normalized first, then mapped.
t('ＷｏｒｄＰｒｅｓｓ入門', 'wordpress');
t('Ｎｏｄｅ．ｊｓ ２０', 'node-js-20');
t('100％ 純正', '100-percent');
t('価格 ￥1,980（税込）', 'yen-1-980');
t('价格 ￥99 起', 'yen-99');
t('￦10,000 할인', 'won-10-000');
// ₩ maps like the other currency signs: the Unicode name without SIGN (WON SIGN → won).
t('₩10,000 할인 쿠폰', 'won-10-000');
t('₩', 'won');
// NFKC is applied only to the full-width forms, so ™ still maps to its own word (NFKC would give TM).
t('Name™', 'name-tm');

// en tool page: Examples and comparison tables
t('10 Tips & Tricks for Node.js (2026 Edition)!', '10-tips-and-tricks-for-node-js-2026-edition');
t('Crème Brûlée: A 30-Minute Recipe', 'creme-brulee-a-30-minute-recipe');
t('Straße in Łódź', 'strasse-in-lodz');
t('C++ vs C# — Which One?', 'c-plus-plus-vs-c-hash-which-one');
t('東京 Travel Guide 2026', 'travel-guide-2026');
t('user_profile.v2', 'user-profile-v2');
t('fooBar 123 $#%', 'foobar-123-hash-percent');
t('я люблю единорогов', '');
t('I ♥ Dogs', 'i-dogs');
t('Fußgängerübergänge', 'fussgangerubergange');
t('Conway\u2019s Law', 'conways-law');
t("Conway's Law", 'conways-law');
// An apostrophe (U+0027, U+2019, U+02BC) between two letters is deleted with no separator, as
// WordPress sanitize_title(), lodash kebabCase and @sindresorhus/slugify do. Before the fix it was a
// separator (Conway's Law → conway-s-law). An apostrophe next to a space, digit or the text edge
// stays a separator.
t("don't stop", 'dont-stop');
t('Hawai\u02BBi', 'hawaii');
t('Hawaiʼi', 'hawaii');
t("Café's Menu", 'cafes-menu');
t("rock 'n' roll", 'rock-n-roll');
t("90's music", '90s-music');
// Apostrophe look-alikes (U+2018, U+02BB okina, U+00B4, U+2032) follow the same rule (master and
// WordPress delete them), and a digit before the apostrophe counts like a letter (1990's → 1990s,
// as WordPress and @sindresorhus/slugify do). After the apostrophe a letter is still required.
t('Ma\u2018ui', 'maui');
t('rock\u2018n\u2019roll', 'rocknroll');
t('Don\u00B4t', 'dont');
t('Don\u2032t', 'dont');
t("1990's", '1990s');
t("5'11", '5-11');
t("the '90s", 'the-90s');
t("'quoted' word", 'quoted-word');
t("O’Brien’s Pub", 'obriens-pub');
t("Conway's Law", 'conways_law', { separator: '_' });
t('Ｊｏｈｎ＇ｓ', 'johns');
{
  const got = E.slugify('10 Tips & Tricks for Node.js (2026 Edition)!', { separator: '_', lowercase: false, trim: true });
  check('page example, underscore + case kept', got === '10_Tips_and_Tricks_for_Node_js_2026_Edition', got);
  const dot = E.slugify('..', { separator: '.', lowercase: true, trim: false });
  check('page FAQ: punctuation-only input with Trim off and dot separator gives "."', dot === '.', dot);
  const cjkDot = E.slugify('世界', { separator: '.', lowercase: true, trim: false });
  check('page FAQ: CJK-only input with Trim off and dot separator gives "."', cjkDot === '.', cjkDot);
}

// ---------- guide examples (src/content/blog/slugify-guide/{en,ja}.mdx) ----------
// Annotation {/* sl-check: {"input":"…","slug":"…"} */}: the tool's output with default options
// must equal "slug"; a non-empty slug must appear in the page text after the annotation (within
// 4000 characters). Code blocks preceded by {/* sl-run: {"lang":"node","expect":"…"} */} are run;
// stdout must equal "expect" and the "// …" output comments in the block.
{
  const { existsSync, writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { execFileSync } = await import('node:child_process');
  for (const lang of ['en', 'ja']) {
    const rel = 'src/content/blog/slugify-guide/' + lang + '.mdx';
    const path = join(root, rel);
    if (!existsSync(path)) { check(rel + ' exists', false); continue; }
    const text = readFileSync(path, 'utf8');
    let count = 0;
    for (const m of text.matchAll(/\{\/\* sl-check: (\{.*?\}) \*\/\}/g)) {
      count++;
      let spec;
      try { spec = JSON.parse(m[1]); } catch (e) { check(rel + ' annotation is JSON', false, m[1]); continue; }
      eq(rel + ' ' + JSON.stringify(spec.input), s(spec.input), spec.slug);
      if (spec.slug) check(rel + ' quotes ' + spec.slug + ' after the annotation', text.slice(m.index, m.index + 4000).includes('`' + spec.slug + '`'), spec.slug);
    }
    check(rel + ' has sl-check annotations', count >= (lang === 'en' ? 7 : 9), count);
    let runs = 0;
    for (const m of text.matchAll(/\{\/\* sl-run: (\{.*?\}) \*\/\}\s*```[a-z]*\n([\s\S]*?)```/g)) {
      runs++;
      const spec = JSON.parse(m[1]);
      const dir = mkdtempSync(join(tmpdir(), 'slugify-run-'));
      try {
        writeFileSync(join(dir, 'main.mjs'), m[2]);
        const out = execFileSync(process.execPath, [join(dir, 'main.mjs')]).toString().trim();
        eq(rel + ' code block ' + runs, out, spec.expect);
        const shown = [...m[2].matchAll(/^\/\/ (.+)$/gm)].map((x) => x[1]).join('\n');
        eq(rel + ' code block ' + runs + ' output comments', shown, out);
      } catch (e) {
        check(rel + ' code block ' + runs, false, String(e.stderr || e.message).slice(0, 300));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    check(rel + ' has a runnable code block', runs >= 1, runs);
    const tpl = [/^## What (is|are) /mi, /^## .*Online/mi, /^## .* in Code$/mi, /^## (Summary|Conclusion|まとめ)/mi].filter((re) => re.test(text));
    check(rel + ' has no template headings', tpl.length === 0, tpl.map(String));
  }
}

// zh / ko guides: the paragraph that describes this tool's output carries sl-check annotations too
// (same format as above; no runnable code block or heading rules for these two languages).
for (const lang of ['zh', 'ko']) {
  const rel = 'src/content/blog/slugify-guide/' + lang + '.mdx';
  const text = readFileSync(join(root, rel), 'utf8');
  let count = 0;
  for (const m of text.matchAll(/\{\/\* sl-check: (\{.*?\}) \*\/\}/g)) {
    count++;
    const spec = JSON.parse(m[1]);
    eq(rel + ' ' + JSON.stringify(spec.input), s(spec.input), spec.slug);
    if (spec.slug) check(rel + ' quotes ' + spec.slug + ' after the annotation', text.slice(m.index, m.index + 4000).includes('`' + spec.slug + '`'), spec.slug);
  }
  check(rel + ' has sl-check annotations', count >= 4, count);
}

// ---------- actual page lifecycle and shared keyboard handler ----------
const shell = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = shell.slice(shell.indexOf('// ── Keyboard shortcuts:'), shell.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes('window.ztPersist.clear(_slug)')) throw Error('Missing actual shared shortcut');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function pageVM(lang = 'en', shellFirst = false) {
  const SLUG = 'slugify';
  const tracks = [];
  const ids = new Map(), copies = [], clears = [], saves = [], docEvents = {}, timers = new Map();
  let now = 0, timerId = 0;
  const doc = { documentElement: { lang }, activeElement: null };
  function simple(e, sel) {
    if (sel.includes(':checked') && !e.checked) return false;
    sel = sel.replace(':checked', '');
    const attrs = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    sel = sel.replace(/\[[^\]]+\]/g, '');
    const tag = /^[\w-]+/.exec(sel), id = /#([\w-]+)/.exec(sel), classes = [...sel.matchAll(/\.([\w-]+)/g)];
    return (!tag || e.tagName === tag[0].toUpperCase()) && (!id || e.id === id[1]) && classes.every(m => e.classList.contains(m[1])) && attrs.every(m => m[2] === undefined ? e.getAttribute(m[1]) !== null : e.getAttribute(m[1]) === m[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(sel => {
      const parts = sel.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, parts.pop())) return false;
      for (let n = e.parentElement; parts.length;) {
        while (n && !simple(n, parts.at(-1))) n = n.parentElement;
        if (!n) return false;
        parts.pop(); n = n.parentElement;
      }
      return true;
    });
  }
  class Element {
    constructor(tag = 'div') {
      Object.assign(this, { tagName: tag.toUpperCase(), id: '', className: '', type: tag === 'input' ? 'text' : '', value: '', textContent: '', checked: false, readOnly: false, disabled: false, attributes: {}, children: [], parentElement: null, listeners: {} });
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
      if (['id', 'type', 'value', 'class'].includes(k)) this[k === 'class' ? 'className' : k] = String(v);
      if (k === 'readonly') this.readOnly = true;
      if (k === 'disabled') this.disabled = true;
      if (k === 'checked') this.checked = true;
    }
    getAttribute(k) { return this.attributes[k] ?? null; }
    get classList() {
      const e = this;
      return {
        contains: k => e.className.split(/\s+/).includes(k),
        add(...keys) { e.className = [...new Set([...e.className.split(/\s+/).filter(Boolean), ...keys])].join(' '); },
        remove(...keys) { e.className = e.className.split(/\s+/).filter(k => k && !keys.includes(k)).join(' '); },
        toggle(k, on) { const want = on ?? !this.contains(k); if (want) this.add(k); else this.remove(k); return want; },
      };
    }
    appendChild(e) { e.parentElement = this; this.children.push(e); return e; }
    contains(e) { return e === this || this.children.some(n => n.contains(e)); }
    querySelectorAll(s) { return this.children.flatMap(n => [...(matches(n, s) ? [n] : []), ...n.querySelectorAll(s)]); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    dispatch(t, extra = {}) {
      const event = { type: t, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of this.listeners[t] || []) fn.call(this, event);
      return event;
    }
    click() {
      if (this.disabled) return;
      if (this.type === 'checkbox') this.checked = !this.checked;
      if (this.type === 'radio') { for (const radio of body.querySelectorAll('input[type="radio"]')) if (radio.getAttribute('name') === this.getAttribute('name')) radio.checked = radio === this; }
      this.dispatch('click');
      if (this.type === 'checkbox' || this.type === 'radio') this.dispatch('change');
    }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element();
  widget.className = 'tool-widget'; body.appendChild(widget);
  const escapeHTML=text=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0]
    .replace(/<Toggletip\b[^>]*>[\s\S]*?<\/Toggletip>/g,'')
    .replace(/=\{T\.(\w+)\}/g,(_,key)=>'="'+escapeHTML(STR[lang][key])+'"')
    .replace(/\{T\.(\w+)\}/g,(_,key)=>escapeHTML(STR[lang][key]));
  const stack = [widget], voids = new Set(['input', 'br', 'hr', 'img']);
  for (const token of markup.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[0].startsWith('<!--')) continue;
    if (token[3] !== undefined) { stack.at(-1).textContent += token[3].trim(); continue; }
    const tag = token[1];
    if (token[0].startsWith('</')) {
      if (stack.at(-1)?.tagName !== tag.toUpperCase()) throw new Error('Markup nesting mismatch ' + tag);
      stack.pop(); continue;
    }
    const e = new Element(tag);
    for (const attr of token[2].matchAll(/([\w-]+)(?:\s*=\s*"([^"]*)")?/g)) e.setAttribute(attr[1], attr[2] ?? '');
    stack.at(-1).appendChild(e);
    if (e.id) ids.set(e.id, e);
    if (!voids.has(tag) && !token[2].endsWith('/')) stack.push(e);
  }
  for (const select of body.querySelectorAll('select')) {
    const options = select.querySelectorAll('option');
    select.value = (options.find(o => o.getAttribute('selected') !== null) || options[0])?.value || '';
  }
  const get = id => { if (!ids.has(id)) throw new Error('Missing actual ID ' + id); return ids.get(id); };
  Object.assign(doc, {
    body, activeElement: body, getElementById: get,
    querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s),
    addEventListener(t, fn) { (docEvents[t] ??= []).push(fn); },
    dispatch(t, extra) {
      const e = { type: t, target: this.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
      for (const fn of docEvents[t] || []) fn.call(this, e);
      return e;
    },
  });
  const context = {
    document: doc, console, TextDecoder, TextEncoder, URLSearchParams, _slug: SLUG,
    t: Object.fromEntries(Object.entries(STR[lang]).filter(([key])=>key!=='tips')),
    trackTool: (...args) => tracks.push(args),
    ztPersist: { load: () => ({}), save: (slug, value) => saves.push({slug, value: JSON.parse(JSON.stringify(value))}), clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) {
      let resolve, reject;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      copies.push({ value, resolve, reject }); return promise;
    } } },
    setTimeout(fn, ms = 0) { const id = ++timerId; timers.set(id, { fn, due: now + ms, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1], context, { filename: SLUG + '.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return {
    doc, body, get, copies, clears, saves, context, timers, tracks,
    input(id, value, type = 'input') { get(id).value = value; get(id).dispatch(type); },
    key(focus, { key = 'l', ctrlKey = true, metaKey = false } = {}) {
      (typeof focus === 'string' ? get(focus) : focus || body).focus();
      return doc.dispatch('keydown', { key, ctrlKey, metaKey });
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].filter(([, t]) => t.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].due; next[1].fn();
      }
      now = until;
    },
  };
}

const copyLabels = {
  en: ['Copy','Copied!','Could not copy. Please select and copy the slug manually.'],
  zh: ['复制','已复制！','复制失败。请选中 Slug 后手动复制。'],
  ja: ['コピー','コピー済み！','コピーできませんでした。スラッグを選択して手動でコピーしてください。'],
  ko: ['복사','복사됨!','복사하지 못했습니다. 슬러그를 선택하여 직접 복사하세요.'],
};
const snapshot=p=>[p.get('sl-input').value,p.get('sl-result').textContent,p.get('sl-copy').disabled,p.get('sl-copy').textContent,p.get('sl-status').textContent,p.get('sl-status').className];
function resultPage(lang,order=false){const p=pageVM(lang,order);p.input('sl-input','Crème & Go');return p;}
const unhandled=[];const onUnhandled=e=>unhandled.push(String(e));process.on('unhandledRejection',onUnhandled);
for(const [lang,labels] of Object.entries(copyLabels)) {
  const p=resultPage(lang);eq(lang+': real immediate slug',p.get('sl-result').textContent,'creme-and-go');eq(lang+': result can copy',p.get('sl-copy').disabled,false);
  p.get('sl-lowercase').click();eq(lang+': lowercase change recomputes',p.get('sl-result').textContent,'Creme-and-Go');
  p.input('sl-separator','_','change');eq(lang+': separator change recomputes',p.get('sl-result').textContent,'Creme_and_Go');
  p.get('sl-trim').click();p.input('sl-input',' Hello ');eq(lang+': trim change recomputes',p.get('sl-result').textContent,'_Hello_');
  p.get('sl-trim').click();p.input('sl-input','世界');eq(lang+': unsupported letters disable copy',p.get('sl-copy').disabled,true);check(lang+': unsupported letters warn',p.get('sl-status').textContent.length>0);
  p.input('sl-input','');eq(lang+': empty input resets warning class',[p.get('sl-status').textContent,p.get('sl-status').className],['','sl-status']);
  for(const order of [false,true])for(const mod of [{ctrlKey:true},{ctrlKey:false,metaKey:true}]) {
    const q=resultPage(lang,order);q.input('sl-separator','_','change');q.get('sl-lowercase').click();const tracked=q.tracks.length;const before=snapshot(q);q.key(q.body);eq(lang+': external CtrlL preserves page',snapshot(q),before);
    q.key('sl-copy',{key:'L',...mod});eq(lang+': CtrlL clears code/status/buttons '+order,snapshot(q),['','',true,labels[0],'','sl-status']);
    eq(lang+': CtrlL keeps options',[q.get('sl-separator').value,q.get('sl-lowercase').checked,q.get('sl-trim').checked],['_',false,true]);
    q.get('sl-copy').click();eq(lang+': cleared result cannot copy old text',q.copies.length,0);q.advance(1000);eq(lang+': clear sends no analytics event',q.tracks.length,tracked);eq(lang+': shared clear storage called once',q.clears,['slugify']);
    q.input('sl-input','New Text');eq(lang+': input recovers after shortcut',q.get('sl-result').textContent,'New_Text');
  }
  for(const kind of ['reject','throw','missing']) {
    const q=resultPage(lang),original=q.context.navigator.clipboard;let thrown=null;
    if(kind==='throw')q.context.navigator.clipboard={writeText(){throw Error('denied');}};if(kind==='missing')q.context.navigator.clipboard=undefined;
    try{q.get('sl-copy').click();if(kind==='reject')q.copies.at(-1).reject(Error('denied'));}catch(e){thrown=String(e);}await settle();
    eq(lang+': '+kind+' caught',thrown,null);eq(lang+': localized failure '+kind,[q.get('sl-status').textContent,q.get('sl-status').className],[labels[2],'sl-status error']);
    q.context.navigator.clipboard=original;q.get('sl-copy').click();eq(lang+': full actual slug copied',q.copies.at(-1).value,'creme-and-go');q.copies.at(-1).resolve();await settle();eq(lang+': direct retry recovers',[q.get('sl-copy').textContent,q.get('sl-status').textContent],[labels[1],'']);
  }
  function boundary(q,kind) {
    if(kind==='ctrlL')q.key('sl-input');
    else if(kind==='empty')q.input('sl-input','');
    else if(kind==='unsupported')q.input('sl-input','世界');
    else if(kind==='separator')q.input('sl-separator','_','change');
    else if(kind==='lowercase')q.get('sl-lowercase').click();
    else if(kind==='trim')q.get('sl-trim').click();
    else q.input('sl-input','next value');
  }
  for(const kind of ['ctrlL','input','empty','unsupported','separator','lowercase','trim']){
    for(const outcome of ['resolve','reject']){
      const q=resultPage(lang);q.get('sl-copy').click();const job=q.copies.at(-1);boundary(q,kind);const before=snapshot(q);job[outcome](outcome==='reject'?Error('late'):undefined);await settle();eq(lang+': late '+outcome+' after '+kind,snapshot(q),before);
    }
    const q=resultPage(lang);q.get('sl-copy').click();q.copies.at(-1).resolve();await settle();const timer=[...q.timers.values()].find(t=>t.ms===1500);boundary(q,kind);const before=snapshot(q);eq(lang+': '+kind+' removes copied feedback',q.get('sl-copy').textContent,labels[0]);timer.fn();eq(lang+': queued old timer after '+kind,snapshot(q),before);
  }
  {
    const q=resultPage(lang);q.get('sl-copy').click();q.copies.at(-1).resolve();await settle();const old=[...q.timers.values()].find(t=>t.ms===1500);q.advance(500);q.get('sl-copy').click();q.copies.at(-1).resolve();await settle();old.fn();eq(lang+': queued old timer keeps newest copy',q.get('sl-copy').textContent,labels[1]);q.advance(1000);eq(lang+': first deadline keeps newest copy',q.get('sl-copy').textContent,labels[1]);q.advance(499);eq(lang+': full feedback duration',q.get('sl-copy').textContent,labels[1]);q.advance(1);eq(lang+': current timer expires',q.get('sl-copy').textContent,labels[0]);
    q.get('sl-copy').click();const older=q.copies.at(-1);q.get('sl-copy').click();q.copies.at(-1).reject(Error('latest'));await settle();const failed=snapshot(q);older.resolve();await settle();eq(lang+': old success cannot erase latest error',snapshot(q),failed);
    q.get('sl-copy').click();const oldError=q.copies.at(-1);q.get('sl-copy').click();q.copies.at(-1).resolve();await settle();const success=snapshot(q);oldError.reject(Error('older'));await settle();eq(lang+': old error cannot erase latest success',snapshot(q),success);
  }
}
// ---------- tool page worked examples (src/content/tools/slugify/{lang}.mdx) ----------
// Annotation {/* slug-check: {"in":"…","sep"?:"_","lower"?:false,"trim"?:false,"empty"?:true} */}
// runs the engine on "in" with the page's defaults (hyphen, Lowercase on, Trim on) changed by the
// optional keys. The input must appear in the text after the annotation (up to the next annotation
// or H2); a non-empty slug must appear there as inline code or in a code block; an empty slug must
// be declared with "empty": true. Each language needs at least 2 examples.
function codeSpans(text) {
  const out = [];
  for (const m of text.matchAll(/<code>\{"((?:[^"\\]|\\.)*)"\}<\/code>/g)) out.push(JSON.parse('"' + m[1] + '"'));
  for (const m of text.matchAll(/<code>([^<{]*)<\/code>/g)) out.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  for (const m of text.replace(/^```[\s\S]*?^```/gm, '').matchAll(/`([^`\n]+)`/g)) out.push(m[1]);
  for (const m of text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)) out.push(...m[1].split('\n'));
  return out;
}
{
  const { toolMdxContract } = await import('./lib/tool-mdx-contract.mjs');
  const contract = toolMdxContract('slugify', { annotations: [{ tag: 'slug-check', min: 2, verify: ({ spec, after }) => {
    if (!spec || typeof spec.in !== 'string') return 'spec needs "in"';
    const opts = { separator: spec.sep ?? '-', lowercase: spec.lower ?? true, trim: spec.trim ?? true };
    const got = E.slugify(spec.in, opts);
    const codes = codeSpans(after);
    const plain = after.replace(/&amp;/g, '&');
    if (!codes.includes(spec.in) && !plain.includes(spec.in)) return 'input ' + JSON.stringify(spec.in) + ' is not on the page after the annotation';
    if (got === '') return spec.empty === true ? null : 'engine gives an empty slug; declare "empty": true';
    if (spec.empty) return 'declared empty but the engine gives ' + JSON.stringify(got);
    return codes.includes(got) ? null : 'engine output ' + JSON.stringify(got) + ' is not shown as code after the annotation';
  } }] });
  for (const r of contract.results.filter((r) => /slug-check/.test(r.rule))) check('tool page: ' + r.message, r.ok);
}

// Analytics: one event per committed change (as in css-triangle-generator), not per pause in typing.
// Before the fix every input event queued a 500 ms timer, so typing a title with pauses sent
// several 'convert' events.
for (const lang of Object.keys(copyLabels)) {
  const q = pageVM(lang);
  for (const v of ['R', 'Ro', 'Rock', 'Rock &', 'Rock & Roll']) { q.input('sl-input', v); q.advance(800); }
  eq(lang + ': typing sends no analytics event', q.tracks.length, 0);
  q.get('sl-input').dispatch('change');
  eq(lang + ': committed input sends one event', q.tracks, [['slugify', 'convert']]);
  q.input('sl-separator', '_', 'change'); q.get('sl-lowercase').click();
  eq(lang + ': each option change sends one event', q.tracks.length, 3);
  q.input('sl-input', '世界'); q.get('sl-input').dispatch('change'); q.get('sl-lowercase').click();
  eq(lang + ': empty result sends no event', q.tracks.length, 3);
  q.input('sl-input', ''); q.get('sl-input').dispatch('change');
  eq(lang + ': empty input sends no event', q.tracks.length, 3);
}
eq('engine bytes preserved',createHash('sha256').update(source.slice(startIndex,endIndex+END_MARK.length)).digest('hex'),'510fe1861fc09afeede07903a039319d17027867ff53c07de2d70a3f3251ab16');
eq('no unhandled copy rejections',unhandled,[]);process.off('unhandledRejection',onUnhandled);
// ---------- v2 page layout ----------
const v2Start=passes;
const require=createRequire(import.meta.url),astroRequire=createRequire(require.resolve('astro'));
const {transform}=astroRequire('@astrojs/compiler');const compiled=await transform(source,{filename:'SlugifyTool.astro'});
await require('esbuild').transform(compiled.code,{loader:'ts'});check('v2 Astro output parses',true);
const markup=source.replace(/^---[\s\S]*?---\s*/,'').split('<script')[0],css=source.match(/<style>([\s\S]*?)<\/style>/)[1];
check('v2 direct flex root',/^<div class="sl-wrap">/.test(markup)&&/\.sl-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0/.test(css));
eq('v2 two shared panes',(markup.match(/zt-io-pane/g)||[]).length,2);eq('v2 two shared fills',(markup.match(/zt-io-fill/g)||[]).length,2);
check('v2 options then fixed status then panes',markup.indexOf('sl-options')<markup.indexOf('id="sl-status"')&&markup.indexOf('id="sl-status"')<markup.indexOf('sl-panels'));
check('v2 fixed status internal overflow',/\.sl-status\s*\{[^}]*height: 2\.8em;[^}]*overflow: auto/.test(css));
check('v2 keyboard accessible bounded output',/class="sl-output zt-io-fill" role="region" aria-labelledby="sl-result-label" tabindex="0"/.test(markup)&&/\.sl-output \{ overflow: auto/.test(css));
check('v2 empty state hidden after real code',css.includes('.sl-result-wrap:has(.sl-result:not(:empty)) .sl-empty { display: none; }'));
check('v2 mobile hides empty pane and bounds input',/@media \(max-width: 860px\)[\s\S]*?\.sl-result-wrap:has\(\.sl-result:empty\) \{ display: none; \}/.test(css)&&css.includes('.sl-input { height: 120px; }'));
check('v2 no primary duplicate Run',!source.includes('btn-primary'));eq('v2 only original copy button remains',(markup.match(/<button\b/g)||[]).length,1);
check('v2 source-localized markup',!/data-i18n|var STRINGS|pageLang/.test(source));
check('v2 tips not serialized',source.includes('const { tips: TIPS, ...CLIENT_T } = T;')&&source.includes('define:vars={{ t: CLIENT_T }}'));
check('v2 registered convert',/'slugify':\s*'convert'/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')));
const tips=['input','lowercase','trim','separator','copy'];eq('v2 five real-control tips',[...markup.matchAll(/<Toggletip id="sl-tip-([^"]+)"/g)].map(m=>m[1]).sort(),tips.toSorted());
for(const lang of Object.keys(copyLabels)){
 eq(lang+': v2 strings same keys',Object.keys(STR[lang]).sort(),Object.keys(STR.en).sort());eq(lang+': v2 tips same keys',Object.keys(STR[lang].tips).sort(),tips.toSorted());
 for(const tip of tips)check(lang+': v2 plain nonempty '+tip,typeof STR[lang].tips[tip]==='string'&&STR[lang].tips[tip].length>20&&!/[<>]|https?:/.test(STR[lang].tips[tip]));
 const doc=readFileSync(join(root,'src/content/tools/slugify/'+lang+'.mdx'),'utf8'),fm=doc.match(/^---\n([\s\S]*?)\n---/)[1],steps=require('js-yaml').load(fm).steps;
 check(lang+': v2 five bounded plain steps',steps.length===5&&steps.every(s=>s.length<=280&&!/[<>]/.test(s))&&steps.join('').length<=1200);eq(lang+': MDX content contract', contractProblems('slugify', lang), '');
 await (await import('@mdx-js/mdx')).compile(doc.replace(/^---[\s\S]*?---\s*/,''));check(lang+': v2 MDX compiles',true);
 const q=pageVM(lang);eq(lang+': v2 label localized',q.get('sl-input').parentElement.querySelector('label').textContent,STR[lang].inputText);eq(lang+': v2 initial empty message localized',q.body.querySelector('.sl-empty').textContent,STR[lang].emptyOutput);
 q.input('sl-input','Hello World '.repeat(5000));eq(lang+': v2 output not truncated',q.get('sl-result').textContent,'hello-world-'.repeat(5000).slice(0,-1));q.get('sl-copy').click();eq(lang+': v2 full long output copied',q.copies.at(-1).value,q.get('sl-result').textContent);q.copies.at(-1).resolve();await settle();
 const before=snapshot(q);q.key('sl-input',{key:'Enter'});eq(lang+': v2 CtrlEnter no duplicate action',snapshot(q),before);
}
console.log('v2 page layout: '+(passes-v2Start)+' passed');

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
