// HTML Minifier — minify keeps visible spaces, non-breaking spaces and leading fragment content
//
// Read:  src/components/tools/HtmlMinifierTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), node_modules/parse5 (spec-compliant HTML
//        parser, used here in place of the browser's DOMParser through a small DOM adapter),
//        src/content/tools/html-minifier/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Defects covered (before the fix):
//   - an element with a single text child was trimmed, so <strong>Note: </strong>text
//     rendered as "Note:text"; inline (phrasing) elements now keep a collapsed edge space,
//     block elements are still trimmed (CSS drops that space anyway);
//   - whitespace was matched with \s, which includes U+00A0, so &nbsp; became a normal
//     space; only HTML ASCII whitespace (tab, LF, FF, CR, space) is collapsed now;
//   - in fragment mode only <body> children were written, so a comment before the first
//     element (the parser puts it on the Document) and <title> / <link> / <meta> / <style>
//     before body content (the parser puts them in <head>) were dropped.
// Also: the page's "before / after minify" example is the engine output.
// Full page + shared keyboard events cover modes, clear, and controlled clipboard/timer lifetimes.
//
// Run: node scripts/test-html-minifier.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { loadPage, frontmatterStrings } from './astro-page-harness.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));
const parse5 = require('parse5');
const source = readFileSync(join(root, 'src/components/tools/HtmlMinifierTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtmlMinifierTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { processDoc };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'got ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected));
}

// parse5 tree -> the DOM subset the engine reads
function toDom(node) {
  switch (node.nodeName) {
    case '#document': {
      const kids = node.childNodes.map(toDom);
      return { nodeType: 9, childNodes: kids, doctype: kids.find((k) => k.nodeType === 10) || null, documentElement: kids.find((k) => k.nodeType === 1) || null };
    }
    case '#documentType': return { nodeType: 10, name: node.name };
    case '#text': return { nodeType: 3, data: node.value };
    case '#comment': return { nodeType: 8, data: node.data };
    default: {
      const content = node.content || node;
      return {
        nodeType: 1,
        tagName: node.tagName.toUpperCase(),
        attributes: node.attrs.map((a) => ({ name: (a.prefix ? a.prefix + ':' : '') + a.name, value: a.value })),
        childNodes: content.childNodes.map(toDom),
        get innerHTML() { return parse5.serialize(content); },
      };
    }
  }
}
const run = (html, mode = 'minify', indent = '  ') => E.processDoc(toDom(parse5.parse(html)), html, mode, indent);

// ── inline vs block edge spaces ──
eq('inline element keeps its trailing space', run('<p><strong>Note: </strong>read this.</p>'), '<p><strong>Note: </strong>read this.</p>');
eq('inline element: runs collapse to one space', run('<p><em>  a  </em>b</p>'), '<p><em> a </em>b</p>');
eq('link keeps edge space', run('<p>See<a href="/x"> docs</a>.</p>'), '<p>See<a href="/x"> docs</a>.</p>');
eq('block element is still trimmed', run('<p>  hello   world  </p>'), '<p>hello world</p>');
eq('heading trimmed', run('<h1>\n  Title\n</h1>'), '<h1>Title</h1>');

// ── non-breaking spaces ──
{
  const out = run('<p>Price:&nbsp;&nbsp;10&nbsp;EUR</p>');
  eq('&nbsp; is not collapsed', out, '<p>Price:\u00a0\u00a010\u00a0EUR</p>');
  eq('&nbsp; at the edge of a block is kept', run('<p>&nbsp;indent</p>'), '<p>\u00a0indent</p>');
  eq('&nbsp; kept in beautify', run('<p>&nbsp;x</p>', 'beautify'), '<p>\u00a0x</p>\n');
  eq('ideographic space U+3000 is not HTML whitespace', run('<p>\u3000全角</p>'), '<p>\u3000全角</p>');
}

// ── fragment content the parser moves out of <body> ──
eq('conditional comment before the first element is kept', run('<!--[if mso]><table><tr><td><![endif]--><p>x</p>'), '<!--[if mso]><table><tr><td><![endif]--><p>x</p>');
eq('ordinary comment before the first element is removed in minify', run('<!-- note --><p>x</p>'), '<p>x</p>');
eq('comment before the first element kept in beautify', run('<!-- note --><p>x</p>', 'beautify'), '<!-- note -->\n<p>x</p>\n');
eq('<link> and <style> in a fragment are kept', run('<link rel="stylesheet" href="a.css"><style>p{color:red}</style><p>x</p>'), '<link rel="stylesheet" href="a.css"><style>p{color:red}</style><p>x</p>');
eq('<title> and <meta> in a fragment are kept', run('<title>T</title>\n<meta charset="utf-8">\n<p>x</p>'), '<title>T</title> <meta charset="utf-8"> <p>x</p>');

// ── unchanged behaviour ──
eq('pre is verbatim', run('<pre>  a\n   b </pre>'), '<pre>  a\n   b </pre>');
eq('whitespace-only text between inline elements stays a space', run('<p><span>A</span> <span>B</span></p>'), '<p><span>A</span> <span>B</span></p>');
eq('boolean attribute', run('<input disabled="">'), '<input disabled>');
eq('full document', run('<!DOCTYPE html><html><head><title>t</title></head><body><p> a </p></body></html>'), '<!doctype html><html><head><title>t</title></head><body><p>a</p></body></html>');

// ── tool pages: before / after example ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/html-minifier', lang + '.mdx'), 'utf8');
  const blocks = [...mdx.matchAll(/```html\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  check(lang + ': page has the before / after blocks', blocks.length >= 2, String(blocks.length));
  if (blocks.length >= 2) eq(lang + ': after-minify block is the engine output', blocks[1], run(blocks[0]));
  check(lang + ': page no longer says inline spaces / nbsp / leading comments are lost', !/Note:read this|Price: 10 EUR|Note:</.test(mdx), lang);
}

eq('engine bytes unchanged', createHash('sha256').update(source.slice(startIndex, endIndex + END_MARK.length)).digest('hex'), 'd448bd9c8374c23bf22e92a9e5b2340f99124cb96d651a7b2d8e95d09fe47c09');

// Complete page events + actual shared shortcut. Parsing uses the same parse5 boundary above.
const layoutSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const sharedShortcut = layoutSource.slice(layoutSource.indexOf('// ── Keyboard shortcuts:'), layoutSource.indexOf('// ── Copy button visual feedback'));
const frontmatter = /^---\n([\s\S]*?)\n---/.exec(source)[1];
const STRINGS = frontmatterStrings(frontmatter);
const copyFailure = { en: 'Copy failed. Try again.', zh: '复制失败，请重试。', ja: 'コピーに失敗しました。再試行してください。', ko: '복사하지 못했습니다. 다시 시도하세요.' };
const settle = async () => { await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(String(error)));
function page(lang, sharedFirst = false) {
  const elements = new Map(), keys = [], timers = [], copies = [], saved = [], tracked = [];
  let seq = 0;
  const t = STRINGS[lang];
  const markup = source.slice(source.indexOf('\n---') + 4, source.indexOf('<script')).replace(/=\{T\.(\w+)\}/g, (_, key) => '="' + t[key] + '"').replace(/\{T\.(\w+)\}/g, (_, key) => t[key]);
  for (const m of markup.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const listeners = {};
    const el = { id: m[3], value: '', textContent: (markup.slice(m.index + m[0].length).match(/^([^<]*)</)?.[1] || '').trim(), className: '', disabled: false, hidden: false, dataset: { empty: /data-empty="([^"]+)"/.exec(m[2])?.[1] },
      getAttribute(name) { return new RegExp('\\b' + name + '="([^"]+)"').exec(m[2])?.[1] ?? null; },
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      dispatch(type, init = {}) { const event = { type, target: el, defaultPrevented: false, cancelBubble: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.cancelBubble = true; }, ...init }; for (const fn of listeners[type] || []) fn.call(el, event); if (type === 'keydown' && !event.cancelBubble) for (const fn of keys) fn(event); return event; },
      click() { if (!el.disabled) { el.focus(); el.dispatch('click'); } }, focus() { doc.activeElement = el; },
    };
    el.classList = { add(c) { if (!this.contains(c)) el.className += ' ' + c; }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, contains(c) { return el.className.split(/\s+/).includes(c); } };
    elements.set(el.id, el);
  }
  const get = id => { const el = elements.get(id); if (!el) throw new Error('Actual markup lacks ' + id); return el; };
  const widget = { contains: el => [...elements.values()].includes(el), querySelectorAll: () => [get('hm-input'), get('hm-output')] };
  const doc = { documentElement: { lang }, activeElement: {}, getElementById: get,
    querySelector: selector => selector === '.tool-widget .btn-primary' ? get('hm-minify') : selector === '.tool-widget' || selector === '.hm-wrap' ? widget : null,
    querySelectorAll: selector => [...elements.values()].filter(el => el.getAttribute(selector.slice(1, -1)) !== null),
    addEventListener: (type, fn) => { if (type === 'keydown') keys.push(fn); },
  };
  get('hm-indent').value = '2';
  const { tips, ...clientT } = t;
  const globals = { document: doc, t: clientT, Blob, DOMParser: class { parseFromString(raw) { return toDom(parse5.parse(raw)); } },
    _slug: 'html-minifier', ztPersist: { clear(slug) { saved.push(slug); } }, trackTool(...args) { tracked.push(args); },
    navigator: { clipboard: { writeText(text) { return new Promise((resolve, reject) => copies.push({ text, resolve, reject })); } } },
    setTimeout(fn, ms) { timers.push({ id: ++seq, fn, ms, cancelled: false }); return seq; }, clearTimeout(id) { const timer = timers.find(t => t.id === id); if (timer) timer.cancelled = true; },
  };
  if (sharedFirst) vm.runInNewContext(sharedShortcut, { ...globals, window: globals });
  const p = loadPage('src/components/tools/HtmlMinifierTool.astro', { lang, globals });
  if (!sharedFirst) p.run(sharedShortcut);
  return { get, doc, copies, timers, saved, tracked, ctx: p.ctx,
    flush(ms) { for (const t of timers.filter(t => t.ms === ms && !t.cancelled && !t.ran)) { t.ran = true; t.fn(); } },
    type(text, flush = true) { get('hm-input').value = text; get('hm-input').dispatch('input'); if (flush) this.flush(300); },
    key(id, key = 'l', mod = 'ctrlKey') { get(id).focus(); return get(id).dispatch('keydown', { key, [mod]: true }); },
  };
}
const bodySnapshot = h => [h.get('hm-input').value, h.get('hm-output').value, h.get('hm-status').textContent, h.get('hm-status').className];
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const t = STRINGS[lang], prefix = lang + ': page ';
  const h = page(lang); h.type('<div><p>Alpha</p></div>');
  eq(prefix + 'automatic minify', h.get('hm-output').value, '<div><p>Alpha</p></div>');
  h.get('hm-beautify').click(); eq(prefix + 'manual beautify', h.get('hm-output').value, '<div>\n  <p>Alpha</p>\n</div>\n');
  h.get('hm-indent').value = '4'; h.get('hm-indent').dispatch('change'); eq(prefix + 'indent immediately reruns last mode', h.get('hm-output').value, '<div>\n    <p>Alpha</p>\n</div>\n');
  h.type('<div><p>Beta</p></div>'); eq(prefix + 'typing retains beautify mode', h.get('hm-output').value, '<div>\n    <p>Beta</p>\n</div>\n');
  h.type(''); eq(prefix + 'empty removes output and status', JSON.stringify(bodySnapshot(h).slice(0, 3)), '["","",""]');
  for (const first of [false, true]) for (const [key, mod] of [['l', 'ctrlKey'], ['L', 'metaKey']]) {
    const p = page(lang, first); p.type('<p>Alpha</p>');
    const label = prefix + (first ? 'shared-first ' : 'shared-last ') + mod;
    const event = p.key('hm-copy-output', key, mod);
    eq(label + ' CtrlL clears current state', JSON.stringify(bodySnapshot(p).slice(0, 3)), '["","",""]');
    check(label + ' prevented + shared persistence', event.defaultPrevented && p.saved.length === 1);
    p.type('<p>Queued</p>', false); p.key('hm-input', key, mod); p.flush(300);
    eq(label + ' queued empty stays empty', JSON.stringify(bodySnapshot(p).slice(0, 3)), '["","",""]');
    p.type('<p>Outside</p>'); const before = bodySnapshot(p); p.doc.activeElement = {}; // outside-tool focus
    // Dispatch on document listeners without a field focus change.
    p.get('hm-input').dispatch('keydown', { key, [mod]: true });
    eq(label + ' outside focus untouched', JSON.stringify(bodySnapshot(p)), JSON.stringify(before));
  }
  for (const copyId of ['hm-copy-input', 'hm-copy-output']) {
    const p = page(lang); p.type('<p>  Alpha  </p>'); const btn = p.get(copyId), prior = bodySnapshot(p);
    btn.click(); eq(prefix + copyId + ' copies complete value', p.copies[0].text, p.get(copyId === 'hm-copy-input' ? 'hm-input' : 'hm-output').value);
    p.copies[0].reject(new Error('controlled denial')); await settle();
    eq(prefix + copyId + ' current failure localized', btn.textContent, copyFailure[lang]);
    eq(prefix + copyId + ' failure preserves conversion', JSON.stringify(bodySnapshot(p)), JSON.stringify(prior));
    btn.click(); p.copies[1].resolve(); await settle(); eq(prefix + copyId + ' same-value retry', btn.textContent, t.copied);
    p.flush(1500); eq(prefix + copyId + ' retry restores Copy', btn.textContent, t.copy);
    for (const api of [undefined, { writeText() { throw new Error('sync denied'); } }]) {
      p.ctx.navigator.clipboard = api; let thrown = false; try { btn.click(); } catch { thrown = true; }
      check(prefix + copyId + ' unavailable/throw handled', !thrown); eq(prefix + copyId + ' unavailable/throw visible', btn.textContent, copyFailure[lang]);
    }
    for (const trigger of ['clear', 'shortcut', 'input', 'new-result']) for (const outcome of ['resolve', 'reject']) {
      const q = page(lang); q.type('<p>Alpha</p>'); const b = q.get(copyId); b.click();
      if (trigger === 'clear') q.get('hm-clear').click(); else if (trigger === 'shortcut') q.key(copyId); else q.type('<p>Beta</p>', trigger === 'new-result');
      const state = bodySnapshot(q); q.copies[0][outcome](new Error('old')); await settle();
      eq(prefix + copyId + ' ' + trigger + '/' + outcome + ' label unchanged', b.textContent, t.copy);
      eq(prefix + copyId + ' ' + trigger + '/' + outcome + ' content/status unchanged', JSON.stringify(bodySnapshot(q)), JSON.stringify(state));
    }
    for (const outcome of ['resolve', 'reject']) {
      const q = page(lang); q.type('<p>Alpha</p>'); const b = q.get(copyId); b.click(); b.click(); q.copies[1].resolve(); await settle(); q.copies[0][outcome](new Error('old same-value request')); await settle();
      eq(prefix + copyId + ' same-value newer success wins ' + outcome, b.textContent, t.copied);
      q.flush(1500); eq(prefix + copyId + ' final label after overlapping requests ' + outcome, b.textContent, t.copy);
    }
    const q = page(lang); q.type('<p>Alpha</p>'); const b = q.get(copyId); b.click(); q.copies[0].resolve(); await settle(); const oldTimers = q.timers.filter(t => t.ms === 1500);
    b.click(); q.copies[1].resolve(); await settle(); for (const timer of oldTimers) timer.fn();
    eq(prefix + copyId + ' old timer cannot clear newer success', b.textContent, t.copied); q.flush(1500); eq(prefix + copyId + ' latest timer restores Copy', b.textContent, t.copy);
    // A pending debounce must not rerun after a manual action and erase fresh copy feedback.
    const r = page(lang); r.type('<p>Alpha</p>', false); r.get('hm-minify').click(); r.get(copyId).click(); r.copies[0].resolve(); await settle(); r.flush(300);
    eq(prefix + copyId + ' manual action cancels old debounce feedback write', r.get(copyId).textContent, t.copied);
  }
}
eq('no unhandled clipboard rejection', unhandled.length, 0);

// ── v2 page layout ──
const MDX_PROTECTED = {
  "en": "db3a260bfb05ac7b502ab8c369ecbba7f3e46ca5f5ab228c204426a42e17f13e",
  "zh": "ada0add21e20cd8580bc2d35af3ba3c8b26fcf6fe26506b642c7b31d3637a7ce",
  "ja": "c7984aea3cbab9f49b215a982a588052101d950979871b9f54c5d0f9001e2527",
  "ko": "1591d15c1c8f6ac422fc30576b117d23231f79f79fb5d018cfc15af82e3d168e"
};
const registry = readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8');
check('v2 page layout: convert registry', /['"]html-minifier['"]\s*:\s*['"]convert['"]/.test(registry));
const markup = source.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
check('v2 page layout: direct tool root', markup.trimStart().startsWith('<div class="hm-wrap">'));
check('v2 page layout: shared input-output grid', markup.includes('hm-panels zt-io') && (markup.match(/zt-io-pane/g) || []).length === 2 && (markup.match(/zt-io-fill/g) || []).length === 2);
check('v2 page layout: controls then reserved status then panes', markup.indexOf('hm-actions') < markup.indexOf('id="hm-status"') && markup.indexOf('id="hm-status"') < markup.indexOf('hm-panels'));
for (const id of ['hm-minify', 'hm-beautify', 'hm-clear', 'hm-copy-input', 'hm-copy-output']) check('v2 page layout: retained actual operation ' + id, markup.includes('id="' + id + '"'));
check('v2 page layout: output stays readonly', /<textarea\b[^>]*id="hm-output"[^>]*\breadonly/.test(markup));
check('v2 page layout: only input editable', /<textarea\b[^>]*id="hm-input"[^>]*>/.test(markup) && !/<textarea\b[^>]*id="hm-input"[^>]*\breadonly/.test(markup));
check('v2 page layout: runtime i18n removed', !source.includes('data-i18n') && !source.includes('var STRINGS'));
check('v2 page layout: client payload excludes tips', /const \{ tips: TIPS, \.\.\.CLIENT_T \} = T/.test(frontmatter) && source.includes('define:vars={{ t: CLIENT_T }}'));
const tips = [...markup.matchAll(/<Toggletip id="(hm-tip-[^"]+)" lang=\{lang\} about=\{([^}]+)\}>\{TIPS\.(\w+)\}<\/Toggletip>/g)];
eq('v2 page layout: six bound tips', tips.length, 6);
eq('v2 page layout: tip IDs', tips.map(m => m[1]).sort().join(','), ['hm-tip-mode','hm-tip-clear','hm-tip-indent','hm-tip-input','hm-tip-output','hm-tip-copy'].sort().join(','));
const keys = object => Object.keys(object).sort().map(key => typeof object[key] === 'object' ? key + '(' + keys(object[key]).join(',') + ')' : key);
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  eq('v2 page layout: ' + lang + ' recursive keys', JSON.stringify(keys(STRINGS[lang])), JSON.stringify(keys(STRINGS.en)));
  for (const [key, value] of Object.entries(STRINGS[lang])) if (typeof value === 'string') {
    check('v2 page layout: ' + lang + '/' + key + ' nonempty', value.trim().length > 0);
    eq('v2 page layout: ' + lang + '/' + key + ' placeholders', JSON.stringify((value.match(/\{\w+\}/g) || []).sort()), JSON.stringify((STRINGS.en[key].match(/\{\w+\}/g) || []).sort()));
  }
  for (const tip of tips) {
    const value = STRINGS[lang].tips[tip[3]];
    check('v2 page layout: ' + lang + '/' + tip[3] + ' plain tip', typeof value === 'string' && value.length > 0 && !/[<>\n]/.test(value));
  }
  const text = readFileSync(join(root, 'src/content/tools/html-minifier', lang + '.mdx'), 'utf8');
  const data = require('js-yaml').load(/^---\n([\s\S]*?)\n---/.exec(text)[1]);
  check('v2 page layout: ' + lang + ' bounded steps', Array.isArray(data.steps) && data.steps.length > 0 && data.steps.length <= 8 && data.steps.every(s => typeof s === 'string' && s.length <= 280) && data.steps.join('').length <= 1200);
  check('v2 page layout: ' + lang + ' steps before FAQ', text.indexOf('steps:') < text.indexOf('faqItems:'));
  check('v2 page layout: ' + lang + ' usage removed', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(text));
  eq('v2 page layout: ' + lang + ' all other MDX bytes protected', createHash('sha256').update(text.replace(/^steps:\n(?:  - .*\n)+/m, '')).digest('hex'), MDX_PROTECTED[lang]);
}
const css = source.slice(source.indexOf('<style>'));
check('v2 page layout: root flex and zero minimum', /\.hm-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-height: 0/.test(css));
check('v2 page layout: fixed scrollable status', /#hm-status\s*\{[^}]*height: 2.5rem;[^}]*flex: none;[^}]*overflow: auto/.test(css));
check('v2 page layout: stable copy header height', /\.hm-panel-head\s*\{[^}]*height: 44px;[^}]*min-height: 44px/.test(css) && /\.hm-panel-head \.btn-copy\s*\{[^}]*height: 44px;[^}]*white-space: normal/.test(css));
check('v2 page layout: text scrolls internally', /\.hm-textarea\s*\{[^}]*overflow: auto/.test(css));
check('v2 page layout: 860 stack and fixed 144px editors', css.includes('@media (max-width: 860px)') && /height: 144px; min-height: 144px; max-height: 144px; resize: none/.test(css));
check('v2 page layout: mobile empty result hidden', css.includes('.hm-output-pane:has(#hm-output:placeholder-shown) { display: none; }'));
check('v2 page layout: 640 action touch size', /@media \(max-width: 640px\)[\s\S]*min-height: 44px/.test(css));

const astroRequire = createRequire(require.resolve('astro/package.json'));
const compiled = await astroRequire('@astrojs/compiler').transform(source, { filename: join(root, 'src/components/tools/HtmlMinifierTool.astro') });
check('v2 page layout: compiled mobile placeholder selector', compiled.css.some(s => /@media\s*\(max-width:\s*860px\)/.test(s) && /\.hm-output-pane[^{}]*:has\(#hm-output[^{}]*:placeholder-shown\)[^{]*\{[^}]*display:\s*none/.test(s)));

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
