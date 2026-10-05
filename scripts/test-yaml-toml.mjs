// YAML ↔ TOML — behavior quoted on the yaml-toml tool pages
//
// Read:  src/components/tools/YamlTomlTool.astro, run through scripts/astro-page-harness.mjs with
//        the npm js-yaml and smol-toml it imports; src/content/tools/yaml-toml/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Each conversion types into the page's own textarea, so the result is what the page shows
// (fidelity checks, timestamp handling and the dump options included). The inputs are the ones
// shown on the en page (worked example, Cargo.toml example, "Values That Change" table, dates,
// values TOML cannot hold, error messages); the dates example and the stop message are also
// checked to appear verbatim on all four language pages. The old page put `tags` after
// `[database]`, which in TOML makes it a key of that table.
//
// Run: node scripts/test-yaml-toml.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './astro-page-harness.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const comp = readFileSync(join(root, 'src/components/tools/YamlTomlTool.astro'), 'utf8');
let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
eq('component dumps YAML with the options used here', /jsyaml\.dump\([^,]+, \{ indent: 2, lineWidth: -1, noRefs: true \}\)/.test(comp), true);
eq('component imports js-yaml and smol-toml', /from 'js-yaml'/.test(comp) && /from 'smol-toml'/.test(comp), true);

function convert(input, output, text, lang = 'en') {
  const page = loadPage('src/components/tools/YamlTomlTool.astro', { lang, stringsSelector: '.yt-wrap' });
  page.type(input, text);
  const out = page.el(output).value;
  const status = page.el('yt-status').textContent;
  return out || 'ERR ' + status;
}
const y2t = (y, lang) => convert('yt-yaml', 'yt-toml', y, lang);
const t2y = (t) => convert('yt-toml', 'yt-yaml', t);
const pages = Object.fromEntries(['en', 'zh', 'ja', 'ko'].map((l) => [l, readFileSync(join(root, 'src/content/tools/yaml-toml/' + l + '.mdx'), 'utf8')]));

eq('worked example', y2t('database:\n  host: localhost\n  port: 5432\n  enabled: true\ntags:\n  - web\n  - backend'),
  'tags = [ "web", "backend" ]\n\n[database]\nhost = "localhost"\nport = 5432\nenabled = true\n');
eq('Cargo.toml example', t2y('[package]\nname = "zerotool"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\n\n[[bin]]\nname = "cli"\npath = "src/main.rs"\n'),
  "package:\n  name: zerotool\n  version: 0.1.0\n  edition: '2021'\ndependencies:\n  serde:\n    version: '1.0'\n    features:\n      - derive\nbin:\n  - name: cli\n    path: src/main.rs\n");
eq('services list becomes [[services]]', y2t('services:\n  - name: web\n  - name: api'), '[[services]]\nname = "web"\n\n[[services]]\nname = "api"\n');
eq('1.10 becomes 1.1', y2t('version: 1.10'), 'version = 1.1\n');
eq('YAML date becomes a TOML local date', y2t('released: 2026-10-01'), 'released = 2026-10-01\n');
eq('yes stays a string', y2t('flag: yes'), 'flag = "yes"\n');
eq('large YAML integer stops the conversion with its path', y2t('big: 9007199254740993'), 'ERR Not converted: TOML cannot hold these values without changing them: /big: integer 9007199254740993 is outside ±(2^53 − 1), so JavaScript would round it');
eq('YAML null stops the conversion with its path', y2t('empty: ~'), 'ERR Not converted: TOML cannot hold these values without changing them: /empty: null — TOML has no null');
eq('hex becomes decimal', t2y('hex = 0xff'), 'hex: 255\n');
eq('local time gains milliseconds', t2y('local = 09:30:00'), 'local: 09:30:00.000\n');
eq('offset date-time keeps offset', t2y('created = 2026-10-01T09:30:00+09:00'), 'created: 2026-10-01T09:30:00.000+09:00\n');
eq('multi-document error', y2t('a: 1\n---\nb: 2').startsWith('ERR Invalid YAML: expected a single document in the stream, but found more'), true);
eq('root list error', y2t('- a'), 'ERR Invalid YAML: YAML root must be a mapping (object), not a scalar or sequence.');
eq('large TOML integer is rejected', /integer value cannot be represented losslessly/.test(t2y('big = 9007199254740993')), true);
eq('duplicate key is rejected', /trying to redefine an already defined table or value/.test(t2y('a = 1\na = 2')), true);
eq('anchors are expanded', y2t('x: &a {k: 1}\ny: *a'), '[x]\nk = 1\n\n[y]\nk = 1\n');

const DATES_YAML = 'release:\n  date: 2026-10-01\n  at: 2026-10-01 09:30:00 +9\n  utc: 2026-10-01T00:30:00Z\n  label: "2026-10-01"\n  ratio: .inf';
const datesToml = y2t(DATES_YAML);
eq('dates example output', datesToml, '[release]\ndate = 2026-10-01\nat = 2026-10-01T09:30:00.000+09:00\nutc = 2026-10-01T00:30:00.000Z\nlabel = "2026-10-01"\nratio = inf\n');
const STOP_YAML = 'service:\n  id: 9007199254740993\n  owner: ~';
for (const [lang, text] of Object.entries(pages)) {
  eq(lang + ' page shows the dates example input', text.includes('```yaml\n' + DATES_YAML + '\n```'), true);
  eq(lang + ' page shows the dates example output', text.includes('```toml\n' + datesToml + '```'), true);
  eq(lang + ' page shows the stop example input', text.includes('```yaml\n' + STOP_YAML + '\n```'), true);
  const msg = y2t(STOP_YAML, lang).replace(/^ERR /, '');
  eq(lang + ' page quotes the stop message: ' + msg, text.includes('<code>' + msg + '</code>'), true);
  eq(lang + ' page no longer says null becomes an empty string', /空字符串|空文字列|빈 문자열|empty string/.test(text), false);
  eq(lang + ' page states the js-yaml limits', text.includes('js-yaml 4.3.2') && text.includes('100') && text.includes('10,000'), true);
}
eq('en page names the parser versions', pages.en.includes('1.7.1 for TOML') && pages.en.includes('js-yaml</a> 4.3.2'), true);


// ---------- complete production page + real shared shortcuts; controlled DOM/clock/clipboard ----------
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const requireRoot = createRequire(join(root, 'package.json'));
const { parseFragment } = requireRoot('parse5');
const ts = requireRoot('typescript');
const pageFile = 'src/components/tools/YamlTomlTool.astro';
const requirePage = createRequire(join(root, pageFile));
const pageSource = readFileSync(join(root, pageFile), 'utf8');
const pageScript = pageSource.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
const labels = pageSource.match(/(?:const|var) STRINGS = (\{[\s\S]*?\n\s*\});/);
const pageStrings = vm.runInNewContext('(' + labels[1] + ')');
const clientStrings = lang => vm.runInNewContext(pageSource.slice(pageSource.indexOf('const T = STRINGS'), pageSource.indexOf('\n---',pageSource.indexOf('const T = STRINGS'))) + '\n;CLIENT_T', { STRINGS: pageStrings, lang });
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

const cfg = {"input": "yt-yaml", "output": "yt-toml", "clear": "yt-clear", "status": "yt-status", "copies": ["yt-copy-yaml", "yt-copy-toml"], "copyFields": {"yt-copy-yaml": "yt-yaml", "yt-copy-toml": "yt-toml"}, "raw": "name: demo", "golden": "name = \"demo\"\n", "next": "name: newer", "extraActions": ["swap"], "slug": "yaml-toml", "prefix": "yt"};
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

const protectedCore = pageScript.slice(pageScript.indexOf('    const YAML_SCHEMA'),pageScript.indexOf('    function syncCopy'));
same('protected conversion bytes',Buffer.byteLength(protectedCore),1442);
same('protected conversion SHA256',hash(protectedCore),'725ec0e5017b11f990d01026472a95a5c3485e833a2cee62fe513e09120c3df2');

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

  p=lifecyclePage(lang,shellFirst);golden(p);p.input('yt-toml','name = "reverse"');p.advance(300);same(tag+' real reverse conversion',p.get('yt-yaml').value,'name: reverse\n');
  for(const side of ['yaml','toml']) {
    p=lifecyclePage(lang,shellFirst);golden(p);p.input('yt-'+side,side==='yaml'?'x: 2':'x = 2');const before=p.snapshot();p.key('yt-'+side,'Enter');
    same(tag+'/'+side+' CtrlEnter has no action or Swap',[p.snapshot(),p.tracks.filter(t=>t[1]==='swap').length],[before,0]);
    p.advance(300);same(tag+'/'+side+' automatic conversion preserves labeled formats',[p.get('yt-yaml').value,p.get('yt-toml').value],side==='yaml'?['x: 2','x = 2\n']:['x: 2\n','x = 2']);
  }
  p=lifecyclePage(lang,shellFirst);p.input('yt-yaml','name: earlier');p.advance(100);p.input('yt-toml','name = "latest"');p.advance(300);same(tag+' latest edited pane wins',[p.get('yt-yaml').value,p.get('yt-toml').value],['name: latest\n','name = "latest"']);
  p=lifecyclePage(lang,shellFirst);golden(p);p.input('yt-toml','');p.advance(300);same(tag+' clearing reverse input clears both',[p.get('yt-yaml').value,p.get('yt-toml').value],['','']);
  p=lifecyclePage(lang,shellFirst);golden(p);p.input('yt-yaml','x: ~');p.advance(300);same(tag+' real fidelity failure drops old output',[p.get('yt-toml').value,p.get('yt-copy-toml').disabled,p.get(cfg.status).textContent.includes('/x')],['',true,true]);
  p=lifecyclePage(lang,shellFirst);golden(p);const panels=p.document.querySelector('.yt-panels'), original=[...panels.children], values=p.snapshot().values, status=p.get(cfg.status).textContent;
  p.get('yt-swap').click();same(tag+' Swap moves whole real panels',panels.children.map(e=>e.querySelector('textarea').id),['yt-toml','yt-yaml']);same(tag+' Swap retains identities',panels.children[0]===original[1]&&panels.children[1]===original[0],true);same(tag+' Swap retains labels and copy association',panels.children.map(e=>[e.querySelector('label').getAttribute('for'),e.querySelector('button').id]),[['yt-toml','yt-copy-toml'],['yt-yaml','yt-copy-yaml']]);same(tag+' Swap leaves exact bytes/status',[p.snapshot().values,p.get(cfg.status).textContent],[values,status]);same(tag+' Swap focuses new left pane',p.document.activeElement.id,'yt-toml');
  p.get('yt-swap').click();same(tag+' second Swap restores original order and focus',[panels.children.map(e=>e.querySelector('textarea').id),p.document.activeElement.id],[['yt-yaml','yt-toml'],'yt-yaml']);
  p.input('yt-toml','new = 4');p.advance(100);const pending=p.snapshot().values;p.get('yt-swap').click();same(tag+' Swap cancels pending conversion',p.timers.size,0);p.advance(1000);same(tag+' queued Swap preserves both current texts',p.snapshot().values,pending);p.input('yt-toml','after = 9');p.advance(300);same(tag+' moved pane retains actual listener',p.get('yt-yaml').value,'after: 9\n');
  p=lifecyclePage(lang,shellFirst,{'yt-yaml':'a: 1','yt-toml':'b = 2'},'yt-toml');same(tag+' initial focused TOML recovery unchanged',[p.get('yt-yaml').value,p.get('yt-toml').value],['b: 2\n','b = 2']);

  for (const id of cfg.copies) {
    p=lifecyclePage(lang,shellFirst);golden(p);const values=p.snapshot().values;p.copy(id).reject(Error('before swap'));await settle();
    same(tag+'/'+id+' copy failure before Swap is visible',p.get(cfg.status).textContent,failureText[lang]);
    p.get('yt-swap').click();same(tag+'/'+id+' Swap clears owned copy failure without changing text',[p.get(cfg.status).textContent,p.snapshot().values],['',values]);
    p.copy(id).resolve();await settle();same(tag+'/'+id+' direct copy after Swap recovers',[p.get(id).textContent,p.get(cfg.status).textContent,p.snapshot().values],[S.copied,'',values]);
  }

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
      if(action==='clear')p.get(cfg.clear).click();else if(action==='shortcut')p.key(id);else if(action==='swap')p.get('yt-swap').click();else{p.input(cfg.input,cfg.next);if(action==='result')p.advance(300);}
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
  {
    p=lifecyclePage(lang,shellFirst);golden(p);const [a,b]=cfg.copies,first=p.copy(a),second=p.copy(b);second.reject(Error('other button'));await settle();first.resolve();await settle();
    same(tag+' buttons have independent requests and error ownership',[p.get(a).textContent,p.get(cfg.status).textContent],[S.copied,failureText[lang]]);p.copy(b).resolve();await settle();same(tag+' error owner retries successfully',[p.get(a).textContent,p.get(b).textContent,p.get(cfg.status).textContent],[S.copied,S.copied,'']);
  }
}

// ---------- v2 page layout ----------
same('all FIX checks retained with automatic direction coverage', [passes,failures], [1070,0]);
same('only redundant local Enter block removed from FIX script',hash(pageScript),'4c85341f760d75a229ffca8b4e5aaf66e1580908f16f062eb1cb748db34f9b1a');
const PROTECTED_CONTENT = {
  "en": {
    "front": "a87775d492b6de4bfdad04d66c93c6b1862240e528f492aa780903aadf152047",
    "body": "d015aadcee73319cb29348aba66834652336ab4a8da58792cf01670c223b7107",
    "examples": "fe538d9b63e8c19f07318c4275dfddb9d34b08c6a4d2c23ca65d3462eb7eb79a",
    "client": "979df8ff9b2911ea43d9fca232a1dc57774226d2b9ed23a4706487f045b346bf"
  },
  "zh": {
    "front": "586e60af7aa38464964116168acbfaa06d699ed300f2b78345f29b78ad0505da",
    "body": "a63ac2aba5e1fcd718f3a3dd9696db922aeb6f945f78da92090b36138389ce8a",
    "examples": "c22647bf37a6761a3bfd7f37e8c7ba8b5cb49dbe5213f5e8c078bc32d7953d4d",
    "client": "ced8bb1aa005f4317db32d9cfe09ecc00f5b50258d89be5e61c1bce69c94a329"
  },
  "ja": {
    "front": "53cdec8a77e73be28dfb4fb7c398d0fd8619cd5bb30bb37af495c64695616afd",
    "body": "3deea18d26c144346a27ba12633e1de3dfa1da8eb9c166fcb43e54c36d2fd593",
    "examples": "c22647bf37a6761a3bfd7f37e8c7ba8b5cb49dbe5213f5e8c078bc32d7953d4d",
    "client": "2ea3c60d0d0c219f360d02d78f9a5581a108ed33d8f604681ed6abf8cd727536"
  },
  "ko": {
    "front": "a25da09f01728f949fa00812fcfb9e54037047bb44d2b7230523defc68556f40",
    "body": "700f168351edb8bfe3cecfa1350ba4867a4eedaf3ab879958796015136f4f158",
    "examples": "c22647bf37a6761a3bfd7f37e8c7ba8b5cb49dbe5213f5e8c078bc32d7953d4d",
    "client": "a2cb7ff39720d80e9f9541299cd97407d95e6dac2dd8cc0a2ee99badcff91ae9"
  }
};
const markup=pageSource.replace(/^---[\s\S]*?---\s*/,'').split('<script')[0], css=pageSource.match(/<style>([\s\S]*?)<\/style>/)[1];
same('root is direct and contains filtered client strings',/^<div class="yt-wrap" data-lang=\{lang\} data-strings=\{JSON\.stringify\(CLIENT_T\)\}>/.test(markup),true);
same('toolbar then status then both shared panes',/yt-toolbar[\s\S]*id="yt-status"[\s\S]*yt-panels zt-io/.test(markup),true);
same('both shared panes and fills',[(markup.match(/zt-io-pane/g)||[]).length,(markup.match(/zt-io-fill/g)||[]).length],[2,2]);
same('both editors always present editable',/readonly|hidden|data-empty/.test(markup),false);
same('no empty editor CSS hiding',/display: none|visibility: hidden/.test(css),false);
same('Swap is secondary and no global primary action remains',/id="yt-swap" class="btn-secondary"/.test(markup)&&!markup.includes('btn-primary'),true);
same('four functional buttons retained',[...markup.matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]),['yt-swap','yt-clear','yt-copy-yaml','yt-copy-toml']);
same('six control-adjacent tips',[...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m=>m[1]),['yt-tip-swap','yt-tip-clear','yt-tip-yaml','yt-tip-copy-yaml','yt-tip-toml','yt-tip-copy-toml']);
same('tips outside labels and buttons',/<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markup),false);
same('root has flex column and zero minima',/\.yt-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0;/.test(css),true);
same('status reserves bounded scrolling space',/\.yt-status\s*\{[^}]*height: 2\.6rem;[^}]*flex: none;[^}]*overflow: auto;/.test(css),true);
same('long text scrolls inside both editors',/\.yt-box\s*\{[^}]*min-width: 0;[^}]*overflow: auto;/.test(css),true);
same('860 and640 bounded editors with phone44px header',/@media \(max-width: 860px\)[\s\S]*height: 180px;[\s\S]*@media \(max-width: 640px\)[\s\S]*min-height: 44px;[\s\S]*height: 120px;/.test(css),true);
same('feedback themes use semantic tokens',css.includes('var(--color-success)')&&css.includes('var(--color-danger)'),true);
same('script remains at original indent inside root',/  <script>[\s\S]*  <\/script>\s*<\/div>\s*<style>/.test(pageSource),true);
same('local Enter is absent',/key === 'Enter'/.test(pageScript),false);
same('yaml-toml registered convert',/['"]yaml-toml['"]\s*:\s*['"]convert['"]/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')),true);
same('shared long filling has zero basis',/\.zt-io-fill\s*\{[^}]*flex:\s*1 1 0;/.test(readFileSync(join(root,'src/styles/tool-common.css'),'utf8')),true);
const mdxCompiler=await import(requireRoot.resolve('@mdx-js/mdx'));
for(const lang of ['en','zh','ja','ko']) {
  const S=pageStrings[lang],payload=clientStrings(lang),expected=PROTECTED_CONTENT[lang];
  same(lang+' exact six tip keys',Object.keys(S.tips),['yaml','toml','copyYaml','copyToml','swap','clear']);
  same(lang+' short complete tips',Object.values(S.tips).every(x=>typeof x==='string'&&x.length>0&&x.length<=280),true);
  same(lang+' original client messages byte exact',hash(JSON.stringify(payload)),expected.client);
  same(lang+' tip payload excluded',Object.hasOwn(payload,'tips')||Object.values(S.tips).some(x=>JSON.stringify(payload).includes(x)||pageScript.includes(x)),false);
  const parts=readFileSync(join(root,'src/content/tools/yaml-toml',lang+'.mdx'),'utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/),front=requireRoot('js-yaml').load(parts[1]),body=parts[2];
  same(lang+' six bounded steps',front.steps.length===6&&front.steps.every(x=>typeof x==='string'&&[...x].length<=280)&&front.steps.reduce((n,x)=>n+[...x].length,0)<=1200,true);
  same(lang+' steps before FAQ',parts[1].indexOf('steps:')<parts[1].indexOf('faqItems:'),true);
  same(lang+' other frontmatter bytes unchanged',hash(parts[1].replace(/steps:\n[\s\S]*?(?=faqItems:)/,'')),expected.front);
  same(lang+' nonUsage body bytes unchanged',hash(body),expected.body);
  same(lang+' worked example bytes unchanged',hash(JSON.stringify([...body.matchAll(/```[^\n]*\n[\s\S]*?```/g)].map(m=>m[0]))),expected.examples);
  same(lang+' removed Usage and Enter instructions absent',/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>|Ctrl.{0,5}Enter|Cmd.{0,5}Enter/.test(body),false);
  let mdxError='';try{await mdxCompiler.compile(body);}catch(e){mdxError=String(e);}same(lang+' MDX compiles',mdxError,'');
}
const {transform}=await import(requireRoot.resolve('@astrojs/compiler',{paths:[requireRoot.resolve('astro')]}));
const compiled=await transform(pageSource,{filename:join(root,pageFile)});
same('Astro compiles without errors',compiled.diagnostics.filter(d=>d.severity===1),[]);
same('one compiled client module',compiled.scripts.length,1);
same('all tip text excluded from compiled client',Object.values(pageStrings).some(s=>Object.values(s.tips).some(t=>compiled.scripts.some(script=>script.code.includes(t)))),false);
same('CSS contains no unresolved globals',compiled.css.some(c=>c.includes(':global')),false);
let compileError='';try{await requireRoot('esbuild').transform(compiled.code,{loader:'ts',format:'esm'});}catch(e){compileError=String(e);}same('generated Astro module parses',compileError,'');
same('source unchanged during test',hash(readFileSync(join(root,pageFile),'utf8')),hash(pageSource));

process.removeListener('unhandledRejection',onUnhandled);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
