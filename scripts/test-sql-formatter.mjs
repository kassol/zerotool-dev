// SQL Formatter — parenthesis nesting (CTEs, subqueries, function calls) regression test
//
// Read:  src/components/tools/SqlFormatterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: formatSQL — a function call inside a CTE or subquery keeps its ")" on the same line
// and does not end the subquery indentation early; commas inside function arguments do not
// split SELECT fields; a subquery in the SELECT list is indented under its field and the
// fields after it are still split; nested subqueries; parenthesized expressions right after
// SELECT; the documented examples (JOIN query, WHERE IN subquery) are unchanged; an unmatched
// ")" does not throw; tab indent; lowercase keywords; minifySQL output is unchanged.
//
// Run: node scripts/test-sql-formatter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SqlFormatterTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in SqlFormatterTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { formatSQL, minifySQL, tokenize };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, '\n--- got ---\n' + actual + '\n--- expected ---\n' + expected);
}
const fmt = (sql, indent = '  ', upper = true) => E.formatSQL(sql, indent, upper);
const lines = (...l) => l.join('\n');

// ---------- the reported defect: function call inside a CTE ----------
eq('CTE with SUM()',
  fmt('with recent as (select user_id, sum(total) as spent from orders where created_at > 100 group by user_id) select u.name, r.spent from users u join recent r on r.user_id = u.id order by r.spent desc;'),
  lines(
    'WITH recent AS (',
    '  SELECT',
    '    user_id,',
    '    SUM(total) AS spent',
    '  FROM orders',
    '  WHERE created_at > 100',
    '  GROUP BY user_id',
    ')',
    'SELECT',
    '  u.name,',
    '  r.spent',
    'FROM users u',
    'JOIN recent r ON r.user_id = u.id',
    'ORDER BY r.spent DESC;',
  ));

eq('function call with several arguments inside a subquery',
  fmt('select * from t where id in (select coalesce(a, b, 0) from v where x > 1)'),
  lines(
    'SELECT',
    '  *',
    'FROM t',
    'WHERE id IN (',
    '  SELECT',
    '    coalesce(a, b, 0)',
    '  FROM v',
    '  WHERE x > 1',
    ')',
  ));

eq('nested function calls in a CTE',
  fmt('with s as (select round(avg(price), 2) as p from items) select p from s'),
  lines(
    'WITH s AS (',
    '  SELECT',
    '    ROUND(AVG(price), 2) AS p',
    '  FROM items',
    ')',
    'SELECT',
    '  p',
    'FROM s',
  ).replace('ROUND', 'round'));

eq('window function with ORDER BY inside a CTE',
  fmt('with r as (select id, row_number() over (partition by g order by t desc) as rn from events) select * from r where rn = 1'),
  lines(
    'WITH r AS (',
    '  SELECT',
    '    id,',
    '    row_number() over(partition BY g ORDER BY t DESC) AS rn',
    '  FROM events',
    ')',
    'SELECT',
    '  *',
    'FROM r',
    'WHERE rn = 1',
  ));

// ---------- subquery in the SELECT list ----------
eq('scalar subquery as a field',
  fmt('select a, (select max(x) from t) as m, b from u'),
  lines(
    'SELECT',
    '  a,',
    '  (',
    '    SELECT',
    '      MAX(x)',
    '    FROM t',
    '  ) AS m,',
    '  b',
    'FROM u',
  ));

// ---------- nested subqueries ----------
eq('subquery inside subquery',
  fmt('select * from a where id in (select a_id from b where c_id in (select id from c where n = count(1)))'),
  lines(
    'SELECT',
    '  *',
    'FROM a',
    'WHERE id IN (',
    '  SELECT',
    '    a_id',
    '  FROM b',
    '  WHERE c_id IN (',
    '    SELECT',
    '      id',
    '    FROM c',
    '    WHERE n = COUNT(1)',
    '  )',
    ')',
  ));

eq('parenthesized expression as the first field',
  fmt('select (a + b) as s, c from t'),
  lines('SELECT', '  (a + b) AS s,', '  c', 'FROM t'));

// ---------- documented examples stay the same ----------
eq('JOIN example from the tool page',
  fmt('select u.id, u.name, o.total from users u join orders o on u.id = o.user_id where o.total > 100 and u.active = 1 order by o.total desc limit 10;'),
  lines('SELECT', '  u.id,', '  u.name,', '  o.total', 'FROM users u', 'JOIN orders o ON u.id = o.user_id', 'WHERE o.total > 100', '  AND u.active = 1', 'ORDER BY o.total DESC', 'LIMIT 10;'));
eq('subquery example from the tool page',
  fmt('select * from users where id in (select user_id from orders where total > 100);'),
  lines('SELECT', '  *', 'FROM users', 'WHERE id IN (', '  SELECT', '    user_id', '  FROM orders', '  WHERE total > 100', ');'));

// ---------- options and robustness ----------
eq('tab indent', fmt('with r as (select sum(x) from t) select 1', '\t'),
  lines('WITH r AS (', '\tSELECT', '\t\tSUM(x)', '\tFROM t', ')', 'SELECT', '\t1'));
eq('lowercase keywords', fmt('WITH r AS (SELECT SUM(x) FROM t) SELECT 1', '  ', false),
  lines('with r as (', '  select', '    sum(x)', '  from t', ')', 'select', '  1'));
let threw = false;
try { fmt('select a) from t'); } catch { threw = true; }
check('unmatched ) does not throw', !threw);
eq('empty input', fmt('   '), '');

// ---------- examples on the English tool page ----------
eq('page: aggregates and comments',
  fmt("select status, count(*) as n -- per status\nfrom orders /* this year */ where created_at >= '2026-01-01' group by status having count(*) > 5 order by n desc;"),
  lines('SELECT', '  status,', '  COUNT(*) AS n -- per status', 'FROM orders /* this year */',
    "WHERE created_at >= '2026-01-01'", 'GROUP BY status', 'HAVING COUNT(*) > 5', 'ORDER BY n DESC;'));
eq('page: update', fmt("update orders set status = 'shipped', shipped_at = now() where id = 42;"),
  lines('UPDATE orders', "SET status = 'shipped', shipped_at = now()", 'WHERE id = 42;'));
eq('page: insert', fmt("insert into users (name, email) values ('Ann', 'ann@example.com'), ('Bo', 'bo@example.com');"),
  lines('INSERT INTO users(name, email)', "VALUES('Ann', 'ann@example.com'),('Bo', 'bo@example.com');"));
eq('page: lowercase keywords', fmt("Select Id From Users Where Name Like 'A%'", '  ', false),
  lines('select', '  Id', 'from Users', "where Name like 'A%'"));
eq('page: quoted names and doubled quotes', fmt("SELECT \"Order Id\", `name` FROM t WHERE note = 'it''s here'"),
  lines('SELECT', '  "Order Id",', '  `name`', 'FROM t', "WHERE note = 'it''s here'"));

eq('page: minify formatted aggregate',
  E.minifySQL(fmt("select status, count(*) as n -- per status\nfrom orders /* this year */ where created_at >= '2026-01-01' group by status having count(*) > 5 order by n desc;")),
  "SELECT status, COUNT(*)AS n FROM orders WHERE created_at >= '2026-01-01' GROUP BY status HAVING COUNT(*)> 5 ORDER BY n DESC;");

// ---------- minify unchanged ----------
eq('minify', E.minifySQL('WITH r AS (\n  SELECT SUM(total) -- c\n  FROM t\n) SELECT 1;'), 'WITH r AS(SELECT SUM(total)FROM t)SELECT 1;');


// ---------- complete production page + real shared shortcuts; controlled DOM/clock/clipboard ----------
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { annotations, contractProblems, toolMdxContract } from './lib/tool-mdx-contract.mjs';
const requireRoot = createRequire(join(root, 'package.json'));
const { parseFragment } = requireRoot('parse5');
const ts = requireRoot('typescript');
const pageFile = 'src/components/tools/SqlFormatterTool.astro';
const requirePage = createRequire(join(root, pageFile));
const pageSource = readFileSync(join(root, pageFile), 'utf8');
const pageScript = pageSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const labels = pageSource.match(/(?:const|var) STRINGS = (\{[\s\S]*?\n\s*\});/);
const pageStrings = vm.runInNewContext('(' + labels[1] + ')');
const clientStrings = lang => vm.runInNewContext('(' + pageSource.match(/const CLIENT_T = ([\s\S]*?);\n/)[1] + ')', { T: pageStrings[lang] });
const pageJS = ts.transpileModule(pageScript, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const layoutSource = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layoutSource.slice(layoutSource.indexOf('// ── Keyboard shortcuts:'), layoutSource.indexOf('// ── Copy button visual feedback'));
if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Missing actual shared shortcut');
const hash = value => createHash('sha256').update(value).digest('hex');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = reason => unhandled.push(String(reason));
process.on('unhandledRejection', onUnhandled);
function same(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) passes++;
  else { failures++; console.log('FAIL: lifecycle ' + name + '\n actual=' + a + '\n expected=' + e); }
}

const cfg = {"input": "sf-input", "output": "sf-output", "primary": "sf-format", "clear": "sf-clear", "status": "sf-status", "copies": ["sf-copy"], "copyFields": {"sf-copy": "sf-output"}, "raw": "select a, b from t", "golden": "SELECT\n  a,\n  b\nFROM t", "next": "select c from z", "minified": "SELECT a, b FROM t", "extraActions": ["minify"], "slug": "sql-formatter", "prefix": "sf"};
const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
function lifecyclePage(lang = 'en', shellFirst = false, preset = {}, active = null) {
  let document, now = 0, nextTimer = 0;
  const timers = new Map(), copies = [], clears = [], tracks = [];
  function simple(e, selector) {
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    const rest = selector.replace(/\[[^\]]+\]/g, '');
    const tag = /^[\w-]+/.exec(rest)?.[0], id = /#([\w-]+)/.exec(rest)?.[1];
    return (!tag || e.tagName === tag.toUpperCase()) && (!id || e.id === id)
      && [...rest.matchAll(/\.([\w-]+)/g)].every(m => e.classList.contains(m[1]))
      && attrs.every(a => a[2] === undefined ? e.getAttribute(a[1]) !== null : e.getAttribute(a[1]) === a[2]);
  }
  function matches(e, selector) {
    return selector.split(',').some(part => {
      const pieces = part.trim().split(/\s+(?![^\[]*\])/);
      if (!simple(e, pieces.pop())) return false;
      let parent = e.parentNode;
      while (pieces.length) { while (parent && !simple(parent, pieces.at(-1))) parent = parent.parentNode; if (!parent) return false; pieces.pop(); parent = parent.parentNode; }
      return true;
    });
  }
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.value = ''; this.textContent = ''; this.className = ''; this.id = ''; this.disabled = false; this.hidden = false; }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(...cs) { el.className = [...new Set([...el.className.split(/\s+/).filter(Boolean), ...cs])].join(' '); }, remove(...cs) { el.className = el.className.split(/\s+/).filter(c => !cs.includes(c)).join(' '); } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); if (k === 'id') this.id = String(v); if (k === 'disabled') this.disabled = true; if (k === 'checked') this.checked = true; if (k === 'value') this.value = String(v); if (k === 'hidden') this.hidden = true; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
    getAttribute(k) { return Object.hasOwn(this.attributes, k) ? this.attributes[k] : null; }
    removeAttribute(k) { delete this.attributes[k]; if (k === 'disabled') this.disabled = false; if (k === 'hidden') this.hidden = false; }
    appendChild(c) { if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1); c.parentNode = this; this.children.push(c); return c; }
    get firstElementChild() { return this.children[0] || null; }
    contains(c) { return c === this || descendants(this).includes(c); }
    querySelectorAll(s) { return descendants(this).filter(e => matches(e, s)); }
    querySelector(s) { return this.querySelectorAll(s)[0] || null; }
    closest(s) { for (let e = this; e; e = e.parentNode) if (matches(e, s)) return e; return null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    focus() { document.activeElement = this; }
    dispatch(type, init = {}) {
      const e = { type, target: this, currentTarget: this, key: '', ctrlKey: false, metaKey: false, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...init };
      for (let node = this; node; node = node.parentNode) { e.currentTarget = node; for (const fn of node.listeners[type] || []) fn.call(node, e); if (e.stopped) break; }
      return e;
    }
    click() { if (!this.disabled) { this.focus(); return this.dispatch('click'); } }
  }
  document = new Element('#document'); document.documentElement = { lang };
  document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element('section')); widget.className = 'tool-widget';
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const markup = pageSource.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0]
    .replace(/data-strings=\{JSON\.stringify\(CLIENT_T\)\}/g, 'data-strings="' + esc(JSON.stringify(clientStrings(lang))) + '"')
    .replace(/data-lang=\{lang\}/g, 'data-lang="' + lang + '"').replace(/\{T\.(\w+)\}/g, (_, k) => esc(pageStrings[lang][k]));
  function append(ast, parent) { for (const node of ast.childNodes || []) { if (!node.tagName) { if (node.nodeName === '#text') parent.textContent += node.value; continue; } const e = parent.appendChild(new Element(node.tagName)); for (const a of node.attrs) e.setAttribute(a.name, a.value); append(node, e); if (e.tagName === 'TEXTAREA') e.value = e.textContent; if (e.tagName === 'SELECT') e.value = (e.children.find(c => c.getAttribute('selected') !== null) || e.children[0]).value; } }
  append(parseFragment(markup), widget);
  document.getElementById = id => descendants(document).find(e => e.id === id) || null;
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing production ID ' + id); return e; };
  for (const [id, value] of Object.entries(preset)) get(id).value = value;
  if (active) get(active).focus();
  const context = { document, console, exports: {}, module: { exports: {} },
    require: name => requirePage(name), _slug: cfg.slug,
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms = 0) { const id = ++nextTimer; timers.set(id, { fn, ms, due: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    ztPersist: { clear(slug) { clears.push(slug); } }, trackTool(...args) { tracks.push(args); } };
  context.window = context; vm.createContext(context);
  const installShared = () => vm.runInContext(shortcut, context, { filename: 'ToolLayout.shortcuts.js' });
  if (shellFirst) installShared(); vm.runInContext(pageJS, context, { filename: pageFile }); if (!shellFirst) installShared();
  function advance(ms) { const end = now + ms; let executions = 0; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]; if (!next) break; if (++executions > 1000) throw Error('Timer runaway'); now = next[1].due; timers.delete(next[0]); next[1].fn(); } now = end; }
  return { get, document, context, copies, clears, tracks, timers, advance,
    input(id, value) { get(id).focus(); get(id).value = value; get(id).dispatch('input'); },
    key(id, key = 'l', modifier = 'ctrlKey') { (id ? get(id) : document.body).focus(); return document.activeElement.dispatch('keydown', { key, [modifier]: true }); },
    copy(id) { get(id).click(); return copies.at(-1); },
    snapshot() { return { values: [get(cfg.input).value, get(cfg.output).value], status: get(cfg.status).textContent, statusClass: get(cfg.status).className, copies: cfg.copies.map(id => [get(id).textContent, get(id).disabled]) }; } };
}

const protectedCore = pageSource.match(/^[ \t]*\/\* ── engine:start ── \*\/[\s\S]*?\/\* ── engine:end ── \*\//m)[0];
// Engine block changed with approval on 2026-10-08 (S2-4 engine fixes a–d); see git log.
same('protected conversion bytes',Buffer.byteLength(protectedCore),17077);
same('protected conversion SHA256',hash(protectedCore),'c3242498e2a5fe655e2e94aa6ab5f160f0192ca9951b5d6efd14abb210c75324');

const golden = p => { p.input(cfg.input, cfg.raw); p.advance(300); };
const failureText = { en: 'Copy failed. Please try again.', zh: '复制失败，请重试。', ja: 'コピーに失敗しました。もう一度お試しください。', ko: '복사하지 못했습니다. 다시 시도하세요.' };
for (const lang of ['en', 'zh', 'ja', 'ko']) for (const shellFirst of [false, true]) {
  const S = pageStrings[lang], tag = lang + '/' + shellFirst;
  let p = lifecyclePage(lang, shellFirst); golden(p);
  same(tag + ' genuine golden output', p.get(cfg.output).value, cfg.golden);
  p.input(cfg.input, ''); p.advance(300);
  same(tag + ' blank input clears previous output and status', [p.get(cfg.output).value,p.get(cfg.status).textContent],['','']);
  for (const action of ['clear','shortcut']) for (const focus of [cfg.input, cfg.copies.at(-1)]) {
    p = lifecyclePage(lang, shellFirst); golden(p); p.input(cfg.input,cfg.next); p.advance(100);
    if (action === 'clear') p.get(cfg.clear).click(); else p.key(focus);
    same(tag + '/' + action + '/' + focus + ' clears synchronously', [p.get(cfg.input).value,p.get(cfg.output).value,p.get(cfg.status).textContent],['','','']);
    same(tag + '/' + action + '/' + focus + ' cancels queued work',p.timers.size,0);
    same(tag + '/' + action + '/' + focus + ' focuses source input',p.document.activeElement.id,cfg.input);
    if (action === 'shortcut') same(tag + '/' + focus + ' shared persistence still clears exactly once',p.clears,[cfg.slug]);
    p.advance(2000);same(tag + '/' + action + '/' + focus + ' no late content', [p.get(cfg.input).value,p.get(cfg.output).value,p.get(cfg.status).textContent],['','','']);
    golden(p);const before=p.snapshot();p.key(null);same(tag+' outside CtrlL preserves widget',p.snapshot(),before);
  }

  p=lifecyclePage(lang,shellFirst);golden(p);const before=p.get(cfg.output).value;p.get(cfg.prefix+'-indent').value='4';p.get(cfg.prefix+'-indent').dispatch('change');same(tag+' indent waits for Format',p.get(cfg.output).value,before);p.get(cfg.primary).click();same(tag+' Format applies indent',p.get(cfg.output).value,cfg.golden.replace(/^  /gm,'    '));
  p=lifecyclePage(lang,shellFirst);p.input(cfg.input,cfg.raw);p.advance(100);p.get(cfg.prefix+'-minify').click();same(tag+' Minify uses actual algorithm',p.get(cfg.output).value,cfg.minified);same(tag+' Minify cancels queued Format',p.timers.size,0);p.advance(200);same(tag+' Minify survives previous deadline',p.get(cfg.output).value,cfg.minified);
  p=lifecyclePage(lang,shellFirst);p.input(cfg.input,cfg.raw);p.tracks.length=0;p.key(cfg.input,'Enter');same(tag+' CtrlEnter formats exactly once',p.tracks.filter(t=>t[1]==='format').length,1);same(tag+' Enter cancels queued Format',p.timers.size,0);

  p=lifecyclePage(lang,shellFirst);golden(p);p.get('sf-uppercase').checked=false;p.get('sf-uppercase').dispatch('change');same(tag+' keyword option alone retains output',p.get(cfg.output).value,cfg.golden);p.get('sf-format').click();same(tag+' Format applies keyword option',p.get(cfg.output).value,'select\n  a,\n  b\nfrom t');

  for (const id of cfg.copies) {
    const field = cfg.copyFields[id], label = tag+'/'+id;
    p=lifecyclePage(lang,shellFirst);golden(p);const initial=p.snapshot(), job=p.copy(id);
    same(label+' exact copied bytes',job.value,p.get(field).value);job.resolve();await settle();
    same(label+' current copy success',p.get(id).textContent,S.copied);p.advance(1500);same(label+' normal timer restores label',p.get(id).textContent,S.copy);
    const rejected=p.copy(id), n=unhandled.length;rejected.reject(Error('controlled current rejection'));await settle();
    same(label+' rejection handled',unhandled.length-n,0);same(label+' localized visible current failure',[p.get(cfg.status).textContent,p.get(cfg.status).className],[failureText[lang],cfg.prefix+'-status error']);
    const retry=p.copy(id);same(label+' direct retry retains bytes',retry.value,job.value);retry.resolve();await settle();
    same(label+' direct retry succeeds and clears its error',[p.get(id).textContent,p.get(cfg.status).textContent,p.snapshot().values],[S.copied,'',initial.values]);
    p=lifecyclePage(lang,shellFirst);golden(p);const clipboard=p.context.navigator.clipboard;delete p.context.navigator.clipboard;let threw='';try{p.copy(id);}catch(e){threw=String(e);}
    same(label+' unavailable API handled',[threw,p.get(cfg.status).textContent],['',failureText[lang]]);p.context.navigator.clipboard=clipboard;p.copy(id).resolve();await settle();same(label+' API recovery same result',[p.get(id).textContent,p.get(cfg.status).textContent],[S.copied,'']);
    for(const action of ['input','result','clear','shortcut',...cfg.extraActions]) for(const outcome of ['resolve','reject']) {
      p=lifecyclePage(lang,shellFirst);golden(p);const pending=p.copy(id), count=unhandled.length;
      if(action==='clear')p.get(cfg.clear).click();else if(action==='shortcut')p.key(id);else if(action==='minify')p.get(cfg.prefix+'-minify').click();else{p.input(cfg.input,cfg.next);if(action==='result')p.advance(300);}
      const current=p.snapshot();pending[outcome](outcome==='reject'?Error('controlled stale rejection'):undefined);await settle();
      same(label+' stale '+action+'/'+outcome,p.snapshot(),current);same(label+' no stale unhandled '+action+'/'+outcome,unhandled.length-count,0);
    }
    for(const outcome of ['resolve','reject']) {
      p=lifecyclePage(lang,shellFirst);golden(p);const first=p.copy(id),last=p.copy(id);same(label+' same text separate requests', [first!==last,first.value,last.value],[true,p.get(field).value,p.get(field).value]);
      last.resolve();await settle();const current=p.snapshot();const n=unhandled.length;first[outcome](outcome==='reject'?Error('older same text'):undefined);await settle();
      same(label+' same text older '+outcome+' ignored',p.snapshot(),current);same(label+' same text handled '+outcome,unhandled.length-n,0);
    }
    p=lifecyclePage(lang,shellFirst);golden(p);p.copy(id).resolve();await settle();const oldTimer=[...p.timers.values()].find(t=>t.ms===1500);p.advance(1000);p.copy(id).resolve();await settle();p.advance(500);
    same(label+' old timer does not reset new success',p.get(id).textContent,S.copied);oldTimer.fn();same(label+' already queued old callback cannot reset new success',p.get(id).textContent,S.copied);p.advance(1000);same(label+' new timer resets normally',p.get(id).textContent,S.copy);
    p=lifecyclePage(lang,shellFirst);golden(p);p.copy(id).resolve();await settle();const timer=[...p.timers.values()].find(t=>t.ms===1500);p.get(cfg.clear).click();const cleared=p.snapshot();timer.fn();same(label+' already queued feedback after Clear is ignored',p.snapshot(),cleared);
  }

}

// ---------- v2 page layout ----------
same('all FIX checks retained', [passes, failures], [598, 0]);
same('client handlers and algorithms retain FIX bytes after bindings', hash(pageScript.slice(pageScript.indexOf("      var input = document.getElementById('sf-input');"))), '348059113776f9b51dde1813eb3c5eb6e1cd6339727e2f92872e4a3c3aa86668');
const markup = pageSource.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
const css = pageSource.match(/<style>([\s\S]*?)<\/style>/)[1];
same('direct tool root carries client-only strings', /^<div class="sf-wrap" data-strings=\{JSON\.stringify\(CLIENT_T\)\}>/.test(markup), true);
same('options and actions precede stable status then shared panes', /sf-options[\s\S]*sf-toolbar[\s\S]*id="sf-status"[\s\S]*sf-panels zt-io/.test(markup), true);
same('shared pane and fill count', [(markup.match(/zt-io-pane/g)||[]).length,(markup.match(/zt-io-fill/g)||[]).length], [2,2]);
same('all original functional buttons remain', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]), ['sf-format','sf-minify','sf-clear','sf-copy']);
same('format remains the only primary action', (markup.match(/class="btn-primary"/g)||[]).length, 1);
same('seven adjacent tip IDs', [...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m=>m[1]), ['sf-tip-indent','sf-tip-uppercase','sf-tip-format','sf-tip-minify','sf-tip-clear','sf-tip-input','sf-tip-copy']);
same('no tips are inside labels or buttons', /<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markup), false);
same('input editable and output remains readonly', [/<textarea id="sf-input"[^>]*\breadonly/.test(markup),/<textarea id="sf-output"[^>]*\breadonly/.test(markup)], [false,true]);
same('default uppercase checked', /id="sf-uppercase" checked/.test(markup), true);
same('root zero minima and flex column', /\.sf-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0;/.test(css), true);
same('status fixed and internally scrollable', /\.sf-status\s*\{[^}]*height: 2\.6rem;[^}]*flex: none;[^}]*overflow: auto;/.test(css), true);
same('long textarea content scrolls inside pane', /\.sf-box\s*\{[^}]*overflow: auto;/.test(css), true);
same('empty desktop output has a localized sentence', /<p class="sf-empty">\{T.outputPlaceholder\}<\/p>/.test(markup), true);
same('empty state follows actual textarea value via placeholder state', /\.sf-result:has\(#sf-output:placeholder-shown\) \.sf-empty \{ display: flex; \}/.test(css), true);
same('860 stacked empty result hidden and bounded editors', /@media \(max-width: 860px\)[\s\S]*\.sf-box \{ height: 180px; \}[\s\S]*\.sf-result:has\(#sf-output:placeholder-shown\) \{ display: none; \}/.test(css), true);
same('640 bounded editors and 44px heads', /@media \(max-width: 640px\)[\s\S]*min-height: 44px;[\s\S]*height: 120px;/.test(css), true);
same('select remains at least 44px high', /\.sf-options select \{ min-height: 44px;/.test(css), true);
same('theme feedback uses semantic tokens', /var\(--color-success\)/.test(css)&&/var\(--color-danger\)/.test(css), true);
same('runtime i18n mutation removed', /data-i18n|var STRINGS/.test(pageSource), false);
same('script stays inline inside root without relocation or reindent', /  <script is:inline>[\s\S]*  <\/script>\s*<\/div>\s*<style>/.test(pageSource), true);
const registry = readFileSync(join(root, 'src/data/tool-layouts.ts'),'utf8');
same('sql-formatter registered convert', /['"]sql-formatter['"]\s*:\s*['"]convert['"]/.test(registry), true);
const sharedCss = readFileSync(join(root,'src/styles/tool-common.css'),'utf8');
same('shared long content filling keeps zero flex basis', /\.zt-io-fill\s*\{[^}]*flex:\s*1 1 0;/.test(sharedCss), true);

// ---------- worked examples with annotations (S2-4, 2026-10-08) ----------
// {/* sqlf-check: {"op":"format"|"minify","indent":"2"|"4"|"tab","upper":true|false,"in"?:"…"} */}:
// the input is "in" or the first ```sql block after the annotation; the engine output must equal a
// later ```sql block or inline code (up to the next sqlf-check or H2). Blocks inside an annotated
// region are checked here and skipped by the default-option block checks in the loop below.
// {/* sqlf-sqlite: {"sql":"…","error"?:"…"} */}: the statement runs in SQLite (sql.js, the
// version recorded below) against SQLITE_SCHEMA; with "error" it must fail with that message, which
// must appear as inline code after the annotation, and without "error" it must run.
const SQLITE_SCHEMA = `
create table orders (id int, name text, total int, status text, created_at text);
insert into orders values (1, 'a', 10, 'paid', '2026-10-01'), (2, 'a', 20, 'paid', '2026-10-02'), (3, 'b', 5, 'new', '2026-10-03');
create table 社員 (社員番号 int, 氏名 text, 部署 text);
insert into 社員 values (1, '山田', '営業　第一部'), (2, '佐藤', '営業部');
create table 회원 (이름 text, 가입일 text, 등급 text);
insert into 회원 values ('홍길동', '2026-01-02', 'VIP');`;
const initSqlJs = requireRoot('sql.js');
const SQL = await initSqlJs();
const sqliteVersion = (() => { const db = new SQL.Database(); const v = db.exec('select sqlite_version()')[0].values[0][0]; db.close(); return v; })();
same('sql.js SQLite version named on the pages', sqliteVersion, '3.49.1');
function sqliteRun(sql) {
  const db = new SQL.Database();
  try { db.run(SQLITE_SCHEMA); db.exec(sql); return null; } catch (e) { return e.message; } finally { db.close(); }
}
const INDENTS = { '2': '  ', '4': '    ', tab: '\t' };
const sqlCodeTexts = after => [
  ...[...after.matchAll(/```sql\n([\s\S]*?)\n```/g)].map(m => m[1]),
  ...[...after.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map(m => m[1]),
];
const sqlfCheck = {
  tag: 'sqlf-check', min: 2,
  verify({ spec, after }) {
    if (!spec || !['format', 'minify'].includes(spec.op)) return 'spec needs op format or minify';
    const blocks = [...after.matchAll(/```sql\n([\s\S]*?)\n```/g)].map(m => m[1]);
    const input = spec.in ?? blocks[0];
    if (input === undefined) return 'no input block after the annotation';
    const raw = input.trim();
    const got = spec.op === 'minify' ? E.minifySQL(raw) : E.formatSQL(raw, INDENTS[spec.indent ?? '2'], spec.upper ?? true);
    const rest = spec.in === undefined ? after.slice(after.indexOf('```sql\n' + input + '\n```') + input.length + 11) : after;
    return sqlCodeTexts(rest).includes(got) ? null : 'engine output is not shown after the annotation: ' + JSON.stringify(got.slice(0, 80));
  },
};
const sqlfSqlite = {
  tag: 'sqlf-sqlite',
  verify({ spec, after }) {
    if (!spec || typeof spec.sql !== 'string') return 'spec needs sql';
    const error = sqliteRun(spec.sql);
    if (spec.error === undefined) return error === null ? null : 'SQLite error: ' + error;
    if (error !== spec.error) return 'SQLite returned ' + JSON.stringify(error);
    return sqlCodeTexts(after).includes(spec.error) ? null : 'SQLite message not shown verbatim';
  },
};
const sqlContract = toolMdxContract('sql-formatter', { annotations: [sqlfCheck, sqlfSqlite] });
for (const r of sqlContract.results.filter(r => /sqlf-(check|sqlite)/.test(r.rule))) check('MDX annotations: ' + r.message, r.ok);
const annotatedRegions = {};
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  annotatedRegions[lang] = annotations(sqlContract.docs[lang].body, 'sqlf-check').map(a => [a.index, a.index + a.raw.length + a.after.length + 20]);
}
// ko says the AND of BETWEEN ... AND starts a new line like a condition AND.
same('BETWEEN ... AND puts AND on a new line', fmt('select * from t where rn between 11 and 20').endsWith('WHERE rn BETWEEN 11\n  AND 20'), true);
// ---------- engine fixes (approved 2026-10-08): output must keep the meaning of the input ----------
// Execution check: SQLite runs the input, the formatted output (2 / 4 / tab, upper / lower) and the
// minified output (upper / lower); the result rows must be the same. Column names are not compared,
// because SQLite names an unaliased column by its expression text.
const EXEC_SCHEMA = SQLITE_SCHEMA + `
create table 订单 (订单编号 int, 收货人 text, 实付金额 int, 状态 text);
insert into 订单 values (1001, '张三', 50, '已支付'), (1002, '李四', 30, '待发货');
create table café (naïve int, straße text); insert into café values (1, 'x');
create table "order items" ("order id" int, "a""b" text); insert into "order items" values (7, 'q');
create table paths (p text); insert into paths values ('C:\\temp\\new'), ('a\\\\b');`;
function sqliteRows(sql, params) {
  const db = new SQL.Database();
  try { db.run(EXEC_SCHEMA); return { rows: JSON.stringify(db.exec(sql, params).map(r => r.values)) }; }
  catch (e) { return { error: e.message }; } finally { db.close(); }
}
function sameExecution(name, sql, params) {
  const want = sqliteRows(sql, params);
  same('exec: input runs: ' + name, want.error ?? null, null);
  const variants = [];
  for (const indent of ['  ', '    ', '\t']) for (const upper of [true, false]) variants.push(['format ' + JSON.stringify(indent) + ' ' + upper, E.formatSQL(sql, indent, upper)]);
  for (const upper of [true, false]) variants.push(['minify ' + upper, E.minifySQL(sql, upper)]);
  for (const [label, out] of variants) same('exec: ' + label + ' gives the same rows: ' + name, sqliteRows(out, params), want);
}
// Token check for syntax that SQLite does not run: the token sequence (keyword case ignored) of the
// formatted and minified output equals that of the input.
const tokenSeq = sql => E.tokenize(sql).map(t => t.type + ':' + (t.type === 'keyword' ? t.value.toUpperCase() : t.value));
function sameTokens(name, sql) {
  const want = tokenSeq(sql).filter(t => !t.startsWith('comment:'));
  for (const indent of ['  ', '\t']) for (const upper of [true, false]) same('tokens: format ' + upper + ': ' + name, tokenSeq(E.formatSQL(sql, indent, upper)).filter(t => !t.startsWith('comment:')), want);
  for (const upper of [true, false]) same('tokens: minify ' + upper + ': ' + name, tokenSeq(E.minifySQL(sql, upper)).filter(t => !t.startsWith('comment:')), want);
}

// a) Unquoted identifiers with non-ASCII letters stay one token.
eq('a: Chinese alias stays whole', fmt('select name as 用户名, count(*) as 订单数 from orders group by name;'),
  lines('SELECT', '  name AS 用户名,', '  COUNT(*) AS 订单数', 'FROM orders', 'GROUP BY name;'));
eq('a: accented names stay whole', E.minifySQL('select café, naïve from t'), 'SELECT café, naïve FROM t');
eq('a: Japanese names stay whole', fmt("select 社員番号, 氏名 from 社員 where 部署 = '営業部';"),
  lines('SELECT', '  社員番号,', '  氏名', 'FROM 社員', "WHERE 部署 = '営業部';"));
eq('a: two-syllable Korean name is not split into column and alias', E.minifySQL("select 이름, 가입일 from 회원 where 등급 = 'VIP';"), "SELECT 이름, 가입일 FROM 회원 WHERE 등급 = 'VIP';");
eq('a: characters outside the BMP and combining marks', E.minifySQL('select 𠮷野家, e\u0301tat from t'), 'SELECT 𠮷野家, e\u0301tat FROM t');
eq('a: a non-ASCII word whose upper case is a keyword stays an identifier', E.minifySQL('select ın, ſelect from t'), 'SELECT ın, ſelect FROM t');
for (const [name, sql] of [
  ['Chinese alias', 'select name as 用户名, count(*) as 订单数 from orders group by name;'],
  ['Chinese table and columns', "select 收货人, sum(实付金额) as 合计 from 订单 where 状态 = '已支付' group by 收货人 order by 合计 desc;"],
  ['Japanese columns', "select 社員番号, 氏名 from 社員 where 部署 = '営業部';"],
  ['Korean two-syllable names', "select 이름, 가입일 from 회원 where 등급 = 'VIP';"],
  ['accented names', 'select naïve, straße from café;'],
]) sameExecution(name, sql);

// b) Strings: MySQL backslash escapes, doubled quotes in quoted names.
eq('b: MySQL \\\' stays inside the string', E.minifySQL("select * from users where note = 'It\\'s'"), "SELECT * FROM users WHERE note = 'It\\'s'");
eq('b: two MySQL strings with \\\'', fmt("select * from t where a = 'It\\'s' and b = 'don\\'t'"),
  lines('SELECT', '  *', 'FROM t', "WHERE a = 'It\\'s'", "  AND b = 'don\\'t'"));
eq('b: MySQL \\\\ before the closing quote', E.minifySQL("select 'a\\\\', 'b' from t"), "SELECT 'a\\\\', 'b' FROM t");
eq('b: MySQL double-quoted string with \\"', E.minifySQL('select * from t where s = "say \\"hi\\" now"'), 'SELECT * FROM t WHERE s = "say \\"hi\\" now"');
eq('b: a standard string that ends with a backslash stays standard', fmt("select 'C:\\' as p, 'x' as q from t"),
  lines('SELECT', "  'C:\\' AS p,", "  'x' AS q", 'FROM t'));
eq('b: doubled double quote in a quoted name', E.minifySQL('select "a""b" from "order items"'), 'SELECT "a""b" FROM "order items"');
eq('b: doubled backtick in a quoted name', E.minifySQL('select `a``b` from t'), 'SELECT `a``b` FROM t');
for (const [name, sql] of [
  ['backslashes that SQLite reads literally', "select p from paths where p = 'C:\\temp\\new' or p = 'a\\\\b';"],
  ['doubled single quote', "select 'It''s' as s, p from paths;"],
  ['doubled double quote in a name', 'select "a""b", "order id" from "order items";'],
  ['string that ends with a backslash', "select 'C:\\' as p, count(*) from paths;"],
]) sameExecution(name, sql);
for (const [name, sql] of [
  ['MySQL \\\' strings', "select * from users where note = 'It\\'s' and nick = 'don\\'t' -- check\norder by id;"],
  ['MySQL double-quoted string', 'select * from t where s = "say \\"hi\\" now" and id in (1, 2);'],
]) sameTokens(name, sql);
for (const [name, sql] of [
  ['MySQL \\\' strings', "select * from users where note = 'It\\'s' and nick = 'don\\'t';"],
]) for (const out of [fmt(sql), E.minifySQL(sql)]) check('b: literals copied verbatim: ' + name, out.includes("'It\\'s'") && out.includes("'don\\'t'"), out);

// c) Dialect tokens: parameters, bracketed names, string prefixes, dollar-quoted strings.
eq('c: PostgreSQL / SQLite $1 parameter', E.minifySQL('select * from t where id = $1 and n = ?2'), 'SELECT * FROM t WHERE id = $1 AND n = ?2');
eq('c: named parameters and variables', E.minifySQL('select :id, @p1, @@session.sql_mode from t where a = :id'), 'SELECT :id, @p1, @@session.sql_mode FROM t WHERE a = :id');
eq('c: PostgreSQL cast keeps working', E.minifySQL('select id::text from t'), 'SELECT id :: text FROM t');
eq('c: bracketed name stays whole and keeps its case', E.minifySQL('select [order id], [订单编号], [a]]b] from t'), 'SELECT [order id], [订单编号], [a]]b] FROM t');
eq('c: N, X, B and E prefixes stay on the string', E.minifySQL("select N'Zoë', X'41', B'101', E'It\\'s', 'C:\\' from t"), "SELECT N'Zoë', X'41', B'101', E'It\\'s', 'C:\\' FROM t");
eq('c: dollar-quoted body is copied as written', E.minifySQL("select $$ it's  a  'body' $$, $fn$ select  1 $fn$ from t"), "SELECT $$ it's  a  'body' $$, $fn$ select  1 $fn$ FROM t");
eq('c: format keeps a bracketed name on its line', fmt('select [order id], count(*) from [order items] group by [order id]'),
  lines('SELECT', '  [order id],', '  COUNT(*)', 'FROM [order items]', 'GROUP BY [order id]'));
for (const [name, sql, params] of [
  ['bracketed names', 'select [order id], "a""b" from [order items];'],
  ['bracketed Chinese name', 'select [订单编号], [收货人] from [订单] where [状态] = \'待发货\';'],
  ['blob literal', "select X'41' = X'41' as same, p from paths;"],
  ['positional and named parameters', 'select $1 + 1, ?2, :id, @n, $v from paths where p <> :id;', { $1: 5, '?2': 6, ':id': 'x', '@n': 7, $v: 8 }],
]) sameExecution(name, sql, params);
for (const [name, sql] of [
  ['SQL Server N strings', "select [order id] from t where name = N'Zoë' and memo = N'张三';"],
  ['PostgreSQL E strings and casts', "select E'It\\'s'::text, id::int from t where id = $1;"],
  ['PostgreSQL dollar quoting', "create function f() returns int as $body$ select  1 $body$ language sql;"],
  ['MySQL variables', 'select @@session.sql_mode, @x := 1 from dual;'],
]) sameTokens(name, sql);

// e) Line comments must not swallow the code after them. MySQL starts a comment at # and at "-- "
// only when the second dash is followed by whitespace or a control character ("--x" is two minus
// signs); standard SQL, PostgreSQL and SQLite start a comment at any "--", and PostgreSQL uses # as
// an operator. A "--" comment followed by whitespace is a comment everywhere and Minify removes it,
// as before; "#…" and "--x…" are kept to the end of the line and Minify ends the line after them.
eq('e: MySQL # comment is kept and ends the line', E.minifySQL('SELECT 1 # note\nFROM t'), 'SELECT 1 # note\nFROM t');
eq('e: --x after a number is kept and ends the line', E.minifySQL('SELECT 1--x\nFROM t'), 'SELECT 1 --x\nFROM t');
eq('e: "-- " comment is still removed', E.minifySQL('SELECT 1 -- note\nFROM t'), 'SELECT 1 FROM t');
eq('e: a number is not followed by its own minus sign', E.minifySQL('select 3-2, 1e-3, .5, 0x1F from t'), 'SELECT 3 - 2, 1e-3, .5, 0x1F FROM t');
eq('e: format starts a new line after a line comment', fmt('select a, -- first\n b, c # third\n from t'),
  lines('SELECT', '  a,', '  -- first', '  b,', '  c # third', 'FROM t'));
eq('e: format keeps the field after an end-of-line comment', fmt('select a -- why\n, b from t'),
  lines('SELECT', '  a -- why', '  ,', '  b', 'FROM t'));
for (const [name, sql] of [
  ['"--x" comment after a number (standard reading)', 'select 1--x\nfrom paths;'],
  ['"-- " comment before a comma', 'select p -- note\n, 1 from paths;'],
  ['"-- " comment after a comma', 'select p, -- note\n 1 from paths;'],
  ['comment between clauses', 'select count(*) -- n\nfrom paths -- table\nwhere p <> \'\';'],
]) sameExecution(name, sql);
// MySQL reading: drop # comments, read "--x" as "- -x", "-- " to the end of the line as a comment.
const mysqlReading = sql => sql.replace(/#[^\n]*/g, '').replace(/--(?=[^\s\x00-\x1f\x7f])/g, '- -').replace(/--[\s\x00-\x1f\x7f][^\n]*/g, '');
for (const [name, sql] of [
  ['MySQL # comment', 'select 1 # note\nfrom paths;'],
  ['MySQL "--1" is minus minus one', 'select 2--1\nfrom paths;'],
  ['MySQL # comment after a comma', 'select p, # note\n 2 from paths;'],
]) {
  const want = sqliteRows(mysqlReading(sql));
  same('exec (MySQL reading): input runs: ' + name, want.error ?? null, null);
  for (const [label, out] of [['format', fmt(sql)], ['format lower', E.formatSQL(sql, '    ', false)], ['minify', E.minifySQL(sql)], ['minify lower', E.minifySQL(sql, false)]]) {
    same('exec (MySQL reading): ' + label + ': ' + name, sqliteRows(mysqlReading(out)), want);
  }
}
for (const [name, sql] of [
  ['PostgreSQL # operator', 'select 5 # 3 as x, data #> \'{a}\' from t\nwhere id = 1;'],
  ['SQL Server #temp table', 'select * from #orders where id = 1\norder by id;'],
]) {
  sameTokens(name, sql);
  for (const out of [fmt(sql), E.minifySQL(sql)]) check('e: # line kept verbatim: ' + name, out.includes(sql.slice(sql.indexOf('#'), sql.indexOf('\n'))), out);
}

// d) Minify follows the uppercase option.
eq('d: minify with uppercase off', E.minifySQL('SELECT a, COUNT(*) FROM t WHERE b IS NULL', false), 'select a, count(*)from t where b is null');
eq('d: minify with uppercase on (default)', E.minifySQL('select a from t'), 'SELECT a FROM t');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = lifecyclePage(lang); p.input(cfg.input, 'Select Id From Users'); p.get('sf-uppercase').checked = false; p.get('sf-minify').click();
  same(lang + ' d: page Minify uses the unchecked uppercase option', p.get(cfg.output).value, 'select Id from Users');
  p.get('sf-uppercase').checked = true; p.get('sf-minify').click();
  same(lang + ' d: page Minify uses the checked uppercase option', p.get(cfg.output).value, 'SELECT Id FROM Users');
}

const mdxCompiler=await import(requireRoot.resolve('@mdx-js/mdx'));
for(const lang of ['en','zh','ja','ko']) {
  const S=pageStrings[lang], payload=clientStrings(lang);
  same(lang+' tip keys',Object.keys(S.tips),['input','indent','uppercase','format','minify','clear','copy']);
  same(lang+' short complete tips',Object.values(S.tips).every(x=>typeof x==='string'&&x.length>0&&x.length<=280),true);
  same(lang+' client has only runtime strings',Object.keys(payload),['copy','copied','copyFailed','formatted','minified']);
  same(lang+' tips excluded from payload and script',Object.values(S.tips).some(x=>JSON.stringify(payload).includes(x)||pageScript.includes(x)),false);
  same(lang+' localized empty hint exists',typeof S.outputPlaceholder==='string'&&S.outputPlaceholder.length>0,true);
  const text=readFileSync(join(root,'src/content/tools/sql-formatter',lang+'.mdx'),'utf8');
  const parts=text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/),front=requireRoot('js-yaml').load(parts[1]),body=parts[2];
  same(lang+' six bounded plain steps',front.steps.length===6&&front.steps.every(x=>typeof x==='string'&&[...x].length<=280)&&front.steps.reduce((n,x)=>n+[...x].length,0)<=1200,true);
  // Minify keeps # and --x comments and ends the line after them (review S2-4 part 3, must-fix 1).
  same(lang+' Minify tip and step mention the kept # / --x comments',[S.tips.minify.includes('#')&&S.tips.minify.includes('--x'),front.steps[3].includes('#')&&front.steps[3].includes('--x')],[true,true]);
  same(lang+' steps before FAQ',parts[1].indexOf('steps:')<parts[1].indexOf('faqItems:'),true);
  same(lang+' MDX content contract', contractProblems('sql-formatter', lang), '');
  // Worked examples are recomputed with the engine: a block after an unformatted input must be its
  // formatted output; every block is an input, an output, a minified output or already formatted.
  const allSqlBlocks=[...body.matchAll(/```sql\n([\s\S]*?)\n```/g)];
  same(lang+' has worked SQL examples',allSqlBlocks.length>=6,true);
  const sqlBlocks=allSqlBlocks.filter(m=>!annotatedRegions[lang].some(([a,b])=>m.index>a&&m.index<b)).map(m=>m[1]);
  const minifiedAt=i=>allSqlBlocks.some(x=>x.index<allSqlBlocks.find(m=>m[1]===sqlBlocks[i]).index&&E.minifySQL(fmt(x[1]))===sqlBlocks[i]);
  const minified=i=>i>=0&&minifiedAt(i);
  same(lang+' each example output equals the engine format of the input before it',sqlBlocks.flatMap((b,i)=>i>0&&fmt(sqlBlocks[i-1])!==sqlBlocks[i-1]&&!minified(i-1)&&fmt(sqlBlocks[i-1])!==b?[b]:[]),[]);
  same(lang+' every SQL block is an input, an engine output, a minified output or already formatted',sqlBlocks.filter((b,i)=>!(fmt(b)===sqlBlocks[i+1]||(i>0&&fmt(sqlBlocks[i-1])===b)||minified(i)||fmt(b)===b)),[]);
  same(lang+' Usage removed',/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body),false);
  let mdxError='';try{await mdxCompiler.compile(body);}catch(e){mdxError=String(e);}same(lang+' MDX compiles',mdxError,'');
}
const {transform}=await import(requireRoot.resolve('@astrojs/compiler',{paths:[requireRoot.resolve('astro')]}));
const compiled=await transform(pageSource,{filename:join(root,pageFile)});
same('Astro diagnostics have no errors',compiled.diagnostics.filter(d=>d.severity===1),[]);
same('compiled CSS contains no unresolved global selectors',compiled.css.some(c=>c.includes(':global')),false);
let compileError='';try{await requireRoot('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(e){compileError=String(e);}same('generated Astro module parses',compileError,'');
same('source unchanged during test',hash(readFileSync(join(root,pageFile),'utf8')),hash(pageSource));

process.removeListener('unhandledRejection',onUnhandled);

console.log((failures ? 'FAILED' : 'PASSED') + ': ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
