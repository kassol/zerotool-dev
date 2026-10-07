// JSON to Zod — generated schemas must keep every element of a root-level array
//
// Read:  src/components/tools/JsonToZodTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
//        node_modules/zod (evaluates the generated schema and parses the sample with it)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: a root array that mixes objects with strings / numbers / null / arrays gives a
// z.union of all element types (non-object elements were dropped before, so the schema rejected
// its own sample), root arrays of objects only keep their earlier output, nested mixed arrays,
// objects with different keys (.optional()), strict mode, root scalars, empty arrays; every
// generated schema is evaluated with zod and must parse the sample it came from.
//
// Run: node scripts/test-json-to-zod.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import vm from 'node:vm';
import { createHash } from 'node:crypto';

import { createRequire } from 'node:module';
import { transform as esbuildTransform } from 'esbuild';
import { compile as compileMdx } from '@mdx-js/mdx';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToZodTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToZodTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { buildRootZod };')();

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
function toSchema(expr) {
  return new Function('z', 'return ' + expr + ';')(z);
}
function parsesOwnSample(name, sample, strict) {
  const expr = E.buildRootZod(sample, 'Root', !!strict);
  let schema;
  try { schema = toSchema(expr); }
  catch (e) { check(name + ' (schema evaluates)', false, e.message + '\n' + expr); return expr; }
  const result = schema.safeParse(sample);
  check(name + ' (sample parses)', result.success,
    (result.error ? JSON.stringify(result.error.issues) : '') + '\n' + expr);
  return expr;
}

// ---------- the reported defect: non-object elements of a root array dropped ----------
eq('mixed root array → union of all element types',
  parsesOwnSample('root array of objects and strings', [{ id: 1 }, 'two', 3]),
  'z.array(z.union([z.string(), z.number().int(), z.object({\n    id: z.number().int(),\n  })]))');
{
  const expr = parsesOwnSample('root array with null', [{ id: 1 }, null]);
  eq('null joins the union', expr, 'z.array(z.union([z.null(), z.object({\n    id: z.number().int(),\n  })]))');
  check('union rejects a boolean', !toSchema(expr).safeParse([true]).success);
}
parsesOwnSample('root array with nested arrays', [{ a: 1 }, [1, 2], ['x']]);
parsesOwnSample('root array with integers and decimals', [{ a: 1 }, 1, 1.5]);
parsesOwnSample('root array, strict mode', [{ a: 1 }, 'x', { a: 2, b: 3 }], true);

// ---------- earlier output kept ----------
eq('root array of objects only (unchanged)',
  parsesOwnSample('objects with different keys', [{ id: 1, name: 'a' }, { id: 2 }]),
  'z.array(z.object({\n    id: z.number().int(),\n    name: z.string().optional(),\n  }))');
eq('root array of objects, strict (unchanged)',
  E.buildRootZod([{ id: 1 }], 'Root', true),
  'z.array(z.object({\n    id: z.number().int(),\n  }).strict())');
eq('root array of scalars', parsesOwnSample('scalars', [1, 'a', 1]), 'z.array(z.union([z.number().int(), z.string()]))');
eq('empty root array', E.buildRootZod([], 'Root', false), 'z.array(z.unknown())');
eq('root string', E.buildRootZod('x', 'Root', false), 'z.string()');
eq('root null', E.buildRootZod(null, 'Root', false), 'z.null()');
eq('root object', parsesOwnSample('object', { a: 1, b: [{ c: 'x' }, 2] }),
  'z.object({\n  a: z.number().int(),\n  b: z.array(z.union([z.number().int(), z.object({\n    c: z.string(),\n  })])),\n})');
parsesOwnSample('page example', {
  id: 1, name: 'Alice', isActive: true, score: 9.5, tags: ['typescript', 'json'],
  address: { city: 'London', zip: 'EC1A 1BB' },
  friends: [{ id: 2, name: 'Bob' }, { id: 3, name: 'Carol' }], metadata: null,
});
parsesOwnSample('nested mixed array in merged objects', [{ v: [{ a: 1 }, 'x'] }, { v: [null] }]);


// ---------- real complete page lifecycle; controlled DOM, clipboard and clock boundaries ----------
const pageScript = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const pageLabels = vm.runInNewContext('(' + source.match(/const STRINGS = (\{[\s\S]*?\n\});/)[1] + ')');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
const engineLines = source.slice(source.lastIndexOf('\n', startIndex) + 1, endIndex + END_MARK.length);
eq('protected engine byte count', Buffer.byteLength(engineLines), 4497);
eq('protected engine SHA256', createHash('sha256').update(engineLines).digest('hex'), "450e4c5c4d815e1ed28c7028ed8a9982809b86fe3d17fe2b96fe09f3e1aa9de5");
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
function page(lang, shellFirst = false) {
  const copies = [], tracks = [], clears = [], timers = new Map(), docEvents = {};
  let now = 0, timerId = 0, doc;
  const decode = s => s.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const descendants = el => el.children.flatMap(c => [c, ...descendants(c)]);
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const words = part.trim().split(/\s+/);
      if (words.length > 1) {
        if (!matches(el, words.pop())) return false;
        for (let p = el.parentElement; p; p = p.parentElement) if (matches(p, words.join(' '))) return true;
        return false;
      }
      const tag = /^[a-z][\w-]*/i.exec(part)?.[0], id = /#([\w-]+)/.exec(part)?.[1];
      return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
        && [...part.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
        && [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(m => m[2] === undefined ? m[1] in el.attributes : el.attributes[m[1]] === m[2]);
    });
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), attributes: {}, dataset: {}, listeners: {}, children: [], parentElement: null, className: '', value: '', textContent: '', checked: false, hidden: false }); }
    setAttribute(key, value) {
      this.attributes[key] = value;
      if (['id', 'type', 'value'].includes(key)) this[key] = value;
      if (key === 'class') this.className = value;
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    getAttribute(key) { return this.attributes[key] ?? null; }
    removeAttribute(key) { delete this.attributes[key]; if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; }
    get parentNode() { return this.parentElement; }
    set innerHTML(value) { this.renderedHTML = value; }
    get innerHTML() { return this.renderedHTML ?? ''; }
    get classList() { const e = this; return { contains(c) { return e.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) e.className += ' ' + c; }, remove(c) { e.className = e.className.split(/\s+/).filter(v => v !== c).join(' '); } }; }
    appendChild(e) { this.children.push(e); e.parentElement = this; }
    querySelectorAll(s) { return descendants(this).filter(e => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    contains(e) { return this === e || descendants(this).includes(e); }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type) { for (const fn of this.listeners[type] || []) fn.call(this, { target: this, type, preventDefault() {} }); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { doc.activeElement = this; }
  }
  const body = new Element('body'), widget = new Element('section'); widget.className = 'tool-widget'; body.appendChild(widget);
  const tipAbout = JSON.parse(readFileSync(join(root, 'src/i18n/' + lang + '.json'), 'utf8'))['tool.tipAbout'];
  // Render the shared component's actual button/panel boundary; browser QA checks popover geometry.
  const markup = source.split('\n---')[1].split('<script')[0]
    .replace(/<Toggletip id="([^"]+)" lang=\{lang\} about=\{L\.(\w+)\}>\{L\.tips\.(\w+)\}<\/Toggletip>/g, (_, id, about, tip) =>
      '<span class="zt-tip"><button type="button" data-zt-tip="' + id + '" aria-label="' + escape(tipAbout.replace('{name}', pageLabels[lang][about])) + '"></button><span id="' + id + '" role="note">' + escape(pageLabels[lang].tips[tip]) + '</span></span>')
    .replace(/=\{L\.(\w+)\}/g, (_, key) => '="' + escape(pageLabels[lang][key]) + '"')
    .replace(/\{L\.(\w+)\}/g, (_, key) => escape(pageLabels[lang][key]));
  const stack = [widget];
  for (const token of markup.matchAll(/<\/?([a-z][\w-]*)\b([^>]*?)>|([^<]+)/g)) {
    if (token[3] !== undefined) { stack.at(-1).textContent += decode(token[3]).trim(); continue; }
    if (token[0].startsWith('</')) { if (stack.at(-1).tagName !== token[1].toUpperCase()) throw Error('Unbalanced real markup'); stack.pop(); continue; }
    const el = new Element(token[1]);
    for (const a of token[2].matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)) el.setAttribute(a[1], decode(a[2] ?? a[3]));
    el.hidden = /(?:^|\s)hidden(?:\s|$)/.test(token[2]);
    stack.at(-1).appendChild(el);
    if (!['input', 'br', 'hr'].includes(token[1]) && !token[2].endsWith('/')) stack.push(el);
  }
  const get = id => { const el = descendants(body).find(e => e.id === id); if (!el) throw Error('Missing real ID ' + id); return el; };
  doc = { body, documentElement: { lang }, activeElement: body, getElementById: get, querySelector: s => body.querySelector(s), querySelectorAll: s => body.querySelectorAll(s), addEventListener(type, fn) { (docEvents[type] ||= []).push(fn); } };
  const context = { document: doc, _slug: 'json-to-zod', console,
    trackTool: (...args) => tracks.push(args), ztPersist: { clear: slug => clears.push(slug) },
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, due: now + ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
  };
  context.window = context; vm.createContext(context);
  if (shellFirst) vm.runInContext(shortcut, context);
  vm.runInContext(pageScript, context, { filename: 'JsonToZodTool.astro' });
  if (!shellFirst) vm.runInContext(shortcut, context);
  return { get, context, copies, tracks, clears, timers, doc,
    input(value) { get('jtz-input').value = value; get('jtz-input').dispatch('input'); },
    key(id = 'jtz-input', key = 'l', modifier = 'ctrlKey') { (typeof id === 'string' ? get(id) : id || body).focus(); const e = { key, [modifier]: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const fn of docEvents.keydown || []) fn(e); return e; },
    advance(ms) { const end = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]; if (!next) break; timers.delete(next[0]); now = next[1].due; next[1].fn(); } now = end; },
  };
}
const output = p => p.get('jtz-output-code').textContent;
const status = p => p.get('jtz-status');
const snapshot = p => JSON.stringify(["jtz-input", "jtz-output-code", "jtz-status", "jtz-copy", "jtz-root-name", "jtz-strict"].map(id => { const e = p.get(id); return [e.value, e.checked, e.textContent, e.className, e.hidden]; }));
const goldenInput = "{\"name\":\"Ada\",\"count\":2}", nextInput = "{\"next\":true}", invalidInput = "{";
const run = (p, value = goldenInput) => { p.input(value); p.get('jtz-convert').click(); };
const goldenCode = "import { z } from \"zod\";\n\nconst UserSchema = z.object({\n  name: z.string(),\n  count: z.number().int(),\n});\n\nexport type User = z.infer<typeof UserSchema>;";
const copy = p => { p.get('jtz-copy').click(); return p.copies.at(-1); };
const copyFailure = {
  en: 'Copy failed. Please copy the output manually.', zh: '复制失败，请手动复制输出。',
  ja: 'コピーに失敗しました。出力を手動でコピーしてください。', ko: '복사하지 못했습니다. 출력을 직접 복사하세요.',
};
try {
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const L = pageLabels[lang], p = page(lang);
    run(p); eq(lang + ': real page golden bytes', output(p), goldenCode);
    p.get('jtz-root-name').value = 'Api'; p.get('jtz-root-name').dispatch('input'); p.get('jtz-strict').checked = true; p.get('jtz-strict').dispatch('change'); p.advance(300);
    eq(lang + ': configuration waits for Generate', output(p), goldenCode);
    p.key('jtz-input', 'Enter'); check(lang + ': shared Enter applies root and strict', output(p).includes('const ApiSchema') && output(p).includes('}).strict();'));
    const converted = p.tracks.length; p.advance(300); eq(lang + ': no delayed second generation', p.tracks.length, converted);
    p.get('jtz-clear').click(); check(lang + ': Clear retains root and strict', p.get('jtz-root-name').value === 'Api' && p.get('jtz-strict').checked);
    for (const shellFirst of [false, true]) for (const modifier of ['ctrlKey', 'metaKey']) {
      const q = page(lang, shellFirst); run(q); q.get('jtz-root-name').value = 'Api'; q.get('jtz-strict').checked = true;
      const prefix = lang + ': shared clear ' + shellFirst + '/' + modifier;
      const outside = snapshot(q); q.key(null, 'l', modifier); eq(prefix + ' outside unchanged', snapshot(q), outside);
      q.input(invalidInput); q.key('jtz-copy', 'L', modifier);
      check(prefix + ' clears input/output/status/error', !q.get('jtz-input').value && !output(q) && !status(q).textContent && !q.get('jtz-input').classList.contains('error'));
      check(prefix + ' restores input focus', q.doc.activeElement === q.get('jtz-input'));
      eq(prefix + ' cancels timers', q.timers.size, 0);
      eq(prefix + ' shared storage clear once', q.clears.join(','), 'json-to-zod');
      check(prefix + ' shared clears root but keeps checkbox', !q.get('jtz-root-name').value && q.get('jtz-strict').checked);
      const cleared = snapshot(q); q.advance(1600); eq(prefix + ' remains clear', snapshot(q), cleared);
    }
    const invalid = page(lang); run(invalid); run(invalid, invalidInput);
    check(lang + ': invalid input positive control', !!status(invalid).textContent && !status(invalid).hidden);
    eq(lang + ': invalid input clears previous output', output(invalid), '');
    run(invalid, '');
    check(lang + ': empty removes error/output/status', !invalid.get('jtz-input').classList.contains('error') && !output(invalid) && !status(invalid).textContent);
    run(invalid, invalidInput); invalid.get('jtz-clear').click();
    check(lang + ': Clear removes invalid state', !status(invalid).textContent && !output(invalid) && !invalid.get('jtz-input').classList.contains('error'));
    check(lang + ': Clear focuses input', invalid.doc.activeElement === invalid.get('jtz-input'));
    const q = page(lang); run(q);
    const good = copy(q); eq(lang + ': Copy exact output bytes', good.value, goldenCode); good.resolve(); await settle();
    eq(lang + ': current copy succeeds', q.get('jtz-copy').textContent, L.copied); q.advance(1500); eq(lang + ': current timer restores Copy', q.get('jtz-copy').textContent, L.copy);
    const failuresBefore = unhandled.length; copy(q).reject(Error('denied')); await settle();
    eq(lang + ': localized current rejection', status(q).textContent, copyFailure[lang]);
    check(lang + ': copy failure visible', !status(q).hidden);
    eq(lang + ': rejection handled', unhandled.length, failuresBefore);
    const retry = copy(q); eq(lang + ': retry identical output', retry.value, goldenCode); retry.resolve(); await settle();
    eq(lang + ': direct retry succeeds', q.get('jtz-copy').textContent, L.copied);
    check(lang + ': direct retry clears copy failure', status(q).textContent !== copyFailure[lang]);
    for (const missing of ['clipboard', 'writeText', 'throw']) {
      const r = page(lang); run(r);
      r.context.navigator.clipboard = missing === 'clipboard' ? undefined : missing === 'writeText' ? {} : { writeText() { throw Error('unavailable'); } };
      let thrown; try { r.get('jtz-copy').click(); } catch (e) { thrown = e; }
      check(lang + ': unavailable API handled ' + missing, !thrown);
      eq(lang + ': unavailable API visible ' + missing, status(r).textContent, copyFailure[lang]);
      eq(lang + ': unavailable API never claims copied ' + missing, r.get('jtz-copy').textContent, L.copy);
    }
    for (const action of ["input", "clear", "shortcut", "result", "error", "example"]) for (const outcome of ['resolve', 'reject', 'timer']) {
      const r = page(lang); run(r); const old = copy(r); let oldTimer;
      if (outcome === 'timer') { old.resolve(); await settle(); oldTimer = [...r.timers.values()].find(t => t.due === 1500)?.fn; }
      if (action === 'input') r.input(nextInput);
      if (action === 'clear') r.get('jtz-clear').click();
      if (action === 'shortcut') r.key();
      if (action === 'result') run(r, nextInput);
      if (action === 'error') run(r, invalidInput);
      if (action === 'example') r.get('jtz-example').click();
      const before = snapshot(r), rejectedBefore = unhandled.length;
      // Replay a captured callback even after cancellation to verify obsolete work cannot write.
      if (outcome === 'timer') { check(lang + ': real feedback timer captured ' + action, !!oldTimer); oldTimer?.(); }
      else { old[outcome](Error('late')); await settle(); }
      eq(lang + ': stale ' + action + '/' + outcome, snapshot(r), before);
      eq(lang + ': stale rejection handled ' + action + '/' + outcome, unhandled.length, rejectedBefore);
    }
    const t = page(lang); run(t); copy(t).resolve(); await settle(); t.advance(1000); copy(t).resolve(); await settle(); t.advance(500);
    eq(lang + ': old timer cannot overwrite newer Copied', t.get('jtz-copy').textContent, L.copied);
    t.advance(1000); eq(lang + ': latest timer expires normally', t.get('jtz-copy').textContent, L.copy);
    const order = page(lang); run(order); const first = copy(order), second = copy(order); second.reject(Error('current')); await settle(); first.resolve(); await settle();
    eq(lang + ': older success preserves newer error', status(order).textContent, copyFailure[lang]);
    eq(lang + ': older success cannot claim copied', order.get('jtz-copy').textContent, L.copy);
    const reverse = page(lang); run(reverse); const older = copy(reverse), newer = copy(reverse); newer.resolve(); await settle(); const fresh = snapshot(reverse); older.reject(Error('late')); await settle();
    eq(lang + ': older rejection preserves newer success', snapshot(reverse), fresh);
  }
} finally { await settle(); process.removeListener('unhandledRejection', onUnhandled); }
eq('no unhandled clipboard rejections', unhandled.length, 0);


// ---------- v2 page layout ----------
const layoutMarkup = source.split('\n---')[1].split('<script')[0];
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const hash = value => createHash('sha256').update(value).digest('hex');
check('v2 registered as convert', /'json-to-zod':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
check('v2 direct flex root with zero minimum size', /^\s*<div\s+class="jtz-wrap"/.test(layoutMarkup) && /\.jtz-wrap\s*\{[^}]*display:\s*flex;[^}]*min-width:\s*0;[^}]*min-height:\s*0;/.test(css));
check('v2 controls/status precede panels', layoutMarkup.indexOf('class="jtz-actions"') < layoutMarkup.indexOf('id="jtz-status"') && layoutMarkup.indexOf('id="jtz-status"') < layoutMarkup.indexOf('zt-io"'));
eq('v2 two shared panels', (layoutMarkup.match(/\bzt-io-pane\b/g) || []).length, 2);
check('v2 input uses shared fill', /id="jtz-input"\s+class="zt-io-fill"/.test(layoutMarkup));
check('v2 output is a labelled keyboard scroller', /id="jtz-output"[^>]*tabindex="0"[^>]*aria-labelledby="jtz-output-label"/.test(layoutMarkup) && /\.jtz-output\s*\{[^}]*overflow:\s*auto;/.test(css) && /\.jtz-output:focus-visible\s*\{[^}]*outline:/.test(css));
check('v2 status space is reserved', /\.jtz-status\s*\{[^}]*min-height:\s*2\.4rem;/.test(css));
check('v2 long status cannot grow the panels', /\.jtz-status\s*\{[^}]*height:\s*2\.4rem;[^}]*overflow:\s*auto;/.test(css));
check('v2 mobile input is bounded', /@media \(max-width: 860px\)/.test(css) && /height:\s*144px;\s*min-height:\s*144px;/.test(css));
check('v2 mobile output has fixed height', /\.jtz-output\s*\{[^}]*height:\s*22rem;/.test(css));
check('v2 phone controls remain reachable', /@media \(max-width: 640px\)/.test(css) && /min-height:\s*44px/.test(css));
check('v2 empty state tracks actual code', css.includes('.jtz-output-pane:has(#jtz-output-code:empty) .jtz-output { display: none; }') && css.includes('.jtz-output-pane:has(#jtz-output-code:empty) .jtz-empty { display: flex; }') && css.includes('.jtz-output-pane:has(#jtz-output-code:empty) { display: none; }'));
check('v2 four-language build-time text, tips excluded from script', !/data-i18n/.test(source) && !/STRINGS|L\.tips|\.tips\b/.test(pageScript));
eq('v2 original action buttons retained', [...layoutMarkup.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(m => m[1]).sort().join(','), "jtz-clear,jtz-convert,jtz-copy,jtz-example");
const tipMap = [["root-name", "rootName", "rootName"], ["strict", "strictMode", "strict"], ["generate", "generate", "generate"], ["example", "example", "example"], ["clear", "clear", "clear"], ["input", "jsonInput", "input"], ["copy", "copy", "copy"]];
eq('v2 actual Toggletip count', (layoutMarkup.match(/<Toggletip\b/g) || []).length, tipMap.length);
for (const [id, about, key] of tipMap) check('v2 tip binding ' + id, layoutMarkup.includes('<Toggletip id="jtz-tip-' + id + '" lang={lang} about={L.' + about + '}>{L.tips.' + key + '}</Toggletip>'));
// Hashes captured before migrating Usage; all other frontmatter and body are protected.
const protectedContent = {
  "en": [
    "8647329816a8cba59efb0b3e2958b76f71afb08ab5eed4d6116045688a34b2e9",
    "61cac543b12318a2600b98ce027af6c3f6209740a39418cf91a6d344eac5ee15"
  ],
  "zh": [
    "52e6e97153ea23419249a79e2af7bcdb03f9986a41d814c0237a7e8526a9b08c",
    "2aaac0bea6fbf114796f25862489bc367cc75717e096dcb0343182e6df4a401a"
  ],
  "ja": [
    "166836303b0e046df3ce062af6d34157ac25ed4107fac3cb4d187ddda33f6efd",
    "ca2c52ac5ae0ff2afa68ec29fcfebeb6dca459382f47c5e9527298eb4843fd04"
  ],
  "ko": [
    "c88c68ec8ea91e8f3eb4679e68847d6887c8b025603eb032e8fe4fe5901df935",
    "e274bc43e7ad950f5c1637844175434310996235e886c345f0a7bdfc07ce588e"
  ]
};
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const L = pageLabels[lang], p = page(lang);
  eq(lang + ': v2 same tip keys', Object.keys(L.tips).sort().join(','), tipMap.map(x => x[2]).sort().join(','));
  for (const [id, about, key] of tipMap) {
    check(lang + ': v2 plain localized tip ' + id, typeof L[about] === 'string' && !!L[about].trim() && !/[<>]/.test(L[about]) && typeof L.tips[key] === 'string' && !!L.tips[key].trim() && !/[<>]/.test(L.tips[key]));
    eq(lang + ': v2 rendered tip ' + id, p.get('jtz-tip-' + id).textContent, L.tips[key]);
  }
  check(lang + ': v2 localized empty state', !!L.empty && layoutMarkup.includes('{L.empty}'));
  eq(lang + ': v2 runtime dataset excludes tips', Object.keys(p.doc.querySelector('.jtz-wrap').dataset).sort().join(','), 'copied,copy,copyFailed,msgGenerated,msgInvalidJson');
  const mdx = readFileSync(join(root, 'src/content/tools/json-to-zod/' + lang + '.mdx'), 'utf8');
  const [, fm, body] = mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
  const stepsText = fm.match(/^steps:\n((?:  - .*\n)+)/m)[1];
  const steps = stepsText.trimEnd().split('\n').map(line => JSON.parse(line.slice(4)));
  check(lang + ': v2 steps bounds/order', steps.length > 0 && steps.length <= 8 && steps.every(x => [...x].length <= 280 && !/[<>]/.test(x)) && steps.reduce((n, x) => n + [...x].length, 0) <= 1200 && fm.indexOf('steps:') < fm.indexOf('faqItems:'));
  for (const key of ["jsonInput", "rootName", "strictMode", "generate", "example", "clear", "copy"]) check(lang + ': v2 steps use actual ' + key, steps.join('\n').includes(L[key]));
  eq(lang + ': v2 original SEO/FAQ exact', hash(fm.replace(/^steps:\n(?:  - .*\n)+/m, '')), protectedContent[lang][0]);
  eq(lang + ': v2 non-Usage body/limits/examples exact', hash(body), protectedContent[lang][1]);
  check(lang + ': v2 no duplicate Usage', !/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>|^## How to/m.test(body));
  try { await compileMdx(body); check(lang + ': v2 MDX compiles', true); } catch (e) { check(lang + ': v2 MDX compiles', false, e.message); }
  for (const shellFirst of [false, true]) for (const focus of ['output', 'copy-tip']) {
    const q = page(lang, shellFirst); run(q);
    q.key(focus === 'output' ? q.get('jtz-output') : q.doc.querySelector('[data-zt-tip="jtz-tip-copy"]'));
    check(lang + ': v2 result CtrlL focus ' + shellFirst + '/' + focus, q.doc.activeElement === q.get('jtz-input') && !q.get('jtz-input').value && !output(q) && !status(q).textContent && q.clears.length === 1);
  }
}
try {
  const require = createRequire(import.meta.url);
  const { transform: astroTransform } = await import(require.resolve('@astrojs/compiler', { paths: [dirname(require.resolve('astro'))] }));
  const compiled = await astroTransform(source, { filename: 'JsonToZodTool.astro' });
  check('v2 Astro compiler has no error diagnostics', !compiled.diagnostics.some(d => d.severity === 1), JSON.stringify(compiled.diagnostics));
  await esbuildTransform(compiled.code, { loader: 'ts' }); check('v2 generated Astro module parses', true);
} catch (e) { check('v2 Astro compilation', false, e.message); }
check('v2 dark status ancestors are global', css.includes(':global(:root:not([data-theme="light"]))') && css.includes(':global([data-theme="dark"])'));

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
