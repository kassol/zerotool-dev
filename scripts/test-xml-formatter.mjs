// XML Formatter — prolog (XML declaration, DOCTYPE) preservation and DOM serialization regression test
//
// Read:  src/components/tools/XmlFormatterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Node has no DOMParser, so the tests build the node tree that the browser's DOMParser
// returns: the XML declaration is not a node, the DOCTYPE is a DocumentType node (nodeType 10)
// without its internal subset, comments and processing instructions are nodes.
//
// Covers: scanProlog (declaration with double / single quotes, encoding and standalone;
// xml-stylesheet is a PI and not the declaration; DOCTYPE with SYSTEM / PUBLIC ids; internal
// subset with ">" and "]" inside quoted literals, comments and PIs; comments and PIs before the
// DOCTYPE; no prolog); prettyPrint and minify keep the declaration and the DOCTYPE in document
// order, keep comments and PIs in the prolog, inside elements and after the root, and write a
// PI without data as <?target?>.
//
// Run: node scripts/test-xml-formatter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/XmlFormatterTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in XmlFormatterTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { scanProlog, prettyPrint, minify };')();

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

// ---------- DOM node builders (shape of DOMParser output) ----------
const doc = (...childNodes) => ({ nodeType: 9, childNodes });
const doctype = (name, publicId = '', systemId = '') => ({ nodeType: 10, name, publicId, systemId });
const el = (tagName, attrs, ...childNodes) => ({
  nodeType: 1, tagName, childNodes,
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
});
const text = (data) => ({ nodeType: 3, data });
const comment = (data) => ({ nodeType: 8, data });
const pi = (target, data) => ({ nodeType: 7, target, data });

// ---------- the reported defect: declaration and DOCTYPE are dropped ----------
const src1 = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE note SYSTEM "note.dtd">\n<note><to>Tove</to></note>';
const doc1 = doc(doctype('note', '', 'note.dtd'), el('note', {}, el('to', {}, text('Tove'))));
eq('format keeps declaration and DOCTYPE', E.prettyPrint(doc1, '  ', E.scanProlog(src1)),
  '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE note SYSTEM "note.dtd">\n<note>\n  <to>Tove</to>\n</note>');
eq('minify keeps declaration and DOCTYPE', E.minify(doc1, E.scanProlog(src1)),
  '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE note SYSTEM "note.dtd"><note><to>Tove</to></note>');

// ---------- scanProlog ----------
eq('declaration only', E.scanProlog('<?xml version="1.0"?><a/>'), { declaration: '<?xml version="1.0"?>', doctype: '' });
eq('single-quoted declaration with standalone', E.scanProlog("<?xml version='1.0' encoding='Shift_JIS' standalone='yes'?>\n<a/>").declaration,
  "<?xml version='1.0' encoding='Shift_JIS' standalone='yes'?>");
eq('no prolog', E.scanProlog('<a><b/></a>'), { declaration: '', doctype: '' });
eq('xml-stylesheet is not the declaration', E.scanProlog('<?xml-stylesheet type="text/xsl" href="s.xsl"?><a/>').declaration, '');
eq('PUBLIC DOCTYPE', E.scanProlog('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html/>').doctype,
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">');
const subset = '<!DOCTYPE doc [\n  <!ELEMENT doc (#PCDATA)>\n  <!ENTITY gt2 "a > b ]">\n  <!-- note: ] > -->\n  <?pi x > ] ?>\n  <!ATTLIST doc v CDATA \'1]>\'>\n]>';
eq('internal subset with > and ] in literals, comments and PIs', E.scanProlog('<?xml version="1.0"?>\n' + subset + '\n<doc/>').doctype, subset);
eq('comment and PI before DOCTYPE', E.scanProlog('<?xml version="1.0"?>\n<!-- head -->\n<?pi a?>\n<!DOCTYPE r>\n<r/>'),
  { declaration: '<?xml version="1.0"?>', doctype: '<!DOCTYPE r>' });
eq('comment mentioning <!DOCTYPE is skipped', E.scanProlog('<!-- <!DOCTYPE fake> --><r/>').doctype, '');
eq('DOCTYPE inside the root is not the prolog', E.scanProlog('<r><![CDATA[<!DOCTYPE x>]]></r>').doctype, '');

// ---------- DOCTYPE with internal subset, format ----------
const doc2 = doc(doctype('doc'), el('doc', {}, text('x')));
eq('format writes the internal subset verbatim', E.prettyPrint(doc2, '  ', E.scanProlog(subset + '<doc>x</doc>')), subset + '\n<doc>x</doc>');

// ---------- comments and processing instructions ----------
const src3 = '<?xml version="1.0"?>\n<?xml-stylesheet type="text/xsl" href="s.xsl"?>\n<!-- before -->\n<r><!-- in --><?go now?><a/></r>\n<!-- after -->';
const doc3 = doc(
  pi('xml-stylesheet', 'type="text/xsl" href="s.xsl"'),
  comment(' before '),
  el('r', {}, comment(' in '), pi('go', 'now'), el('a', {})),
  comment(' after '),
);
eq('format keeps prolog PI and comments in order', E.prettyPrint(doc3, '  ', E.scanProlog(src3)),
  '<?xml version="1.0"?>\n<?xml-stylesheet type="text/xsl" href="s.xsl"?>\n<!-- before -->\n<r>\n  <!-- in -->\n  <?go now?>\n  <a/>\n</r>\n<!-- after -->');
eq('minify keeps prolog PI and comments in order', E.minify(doc3, E.scanProlog(src3)),
  '<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="s.xsl"?><!-- before --><r><!-- in --><?go now?><a/></r><!-- after -->');
eq('PI without data', E.prettyPrint(doc(el('r', {}, pi('flush', ''))), '  ', E.scanProlog('<r><?flush?></r>')), '<r>\n  <?flush?>\n</r>');
eq('minify PI without data', E.minify(doc(el('r', {}, pi('flush', ''))), E.scanProlog('<r><?flush?></r>')), '<r><?flush?></r>');

// ---------- no prolog: output unchanged from before ----------
eq('no prolog format', E.prettyPrint(doc(el('root', { id: '1' }, el('name', {}, text('A & B')))), '\t', E.scanProlog('<root/>')),
  '<root id="1">\n\t<name>A &amp; B</name>\n</root>');


// ---------- complete production page + real shared shortcuts; controlled DOM/clock/clipboard ----------
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { contractProblems } from './lib/tool-mdx-contract.mjs';
const requireRoot = createRequire(join(root, 'package.json'));
const { parseFragment } = requireRoot('parse5');
const ts = requireRoot('typescript');
const pageFile = 'src/components/tools/XmlFormatterTool.astro';
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

// DOMParser boundary only: SAX supplies nodes; the shipped parse/prettyPrint/minify functions run.
// Native browser XML acceptance and geometry require browser QA.
const sax = requireRoot('sax');
const PageDOMParser = class {
  parseFromString(raw) {
    const doc = { nodeType: 9, childNodes: [] }, stack = [doc], parser = sax.parser(true);
    let error = '';
    parser.onerror = e => { error ||= e.message.split('\n')[0]; parser.error = null; };
    parser.onopentag = t => { const n = { nodeType: 1, tagName: t.name, localName: t.name.split(':').at(-1), attributes: Object.entries(t.attributes).map(([name,value]) => ({name,value})), childNodes: [] }; stack.at(-1).childNodes.push(n); stack.push(n); };
    parser.onclosetag = () => stack.pop();
    parser.ontext = data => stack.at(-1).childNodes.push({ nodeType: 3, data });
    parser.oncdata = data => stack.at(-1).childNodes.push({ nodeType: 4, data });
    parser.oncomment = data => stack.at(-1).childNodes.push({ nodeType: 8, data });
    parser.onprocessinginstruction = ({name,body}) => { if (name !== 'xml') stack.at(-1).childNodes.push({ nodeType: 7, target: name, data: body }); };
    try { parser.write(raw).close(); } catch (e) { error ||= e.message; }
    doc.documentElement = doc.childNodes.find(n => n.nodeType === 1);
    doc.querySelector = name => name === 'parsererror' && (error || !doc.documentElement) ? { textContent: error || 'no root' } : null;
    return doc;
  }
};

const cfg = {"input": "xf-input", "output": "xf-output", "primary": "xf-format", "clear": "xf-clear", "status": "xf-status", "copies": ["xf-copy-input", "xf-copy-output"], "copyFields": {"xf-copy-input": "xf-input", "xf-copy-output": "xf-output"}, "raw": "<root><n>1</n><n>2</n></root>", "golden": "<root>\n  <n>1</n>\n  <n>2</n>\n</root>", "next": "<next><n>3</n></next>", "minified": "<root><n>1</n><n>2</n></root>", "extraActions": ["minify"], "slug": "xml-formatter", "prefix": "xf"};
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
  const context = { document, console, DOMParser: PageDOMParser, exports: {}, module: { exports: {} },
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
same('protected conversion bytes',Buffer.byteLength(protectedCore),6771);
same('protected conversion SHA256',hash(protectedCore),'d6bf2e18ed3a908eaabba30a004546f7c4a3f6a81956e5a7e0cb67900034886e');

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

  p=lifecyclePage(lang,shellFirst);golden(p);p.input(cfg.input,'<broken>');p.advance(300);same(tag+' real XML error clears previous output',[p.get(cfg.output).value,p.get(cfg.status).classList.contains('error')],['',true]);golden(p);same(tag+' valid XML recovers',p.get(cfg.output).value,cfg.golden);

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
  {
    p=lifecyclePage(lang,shellFirst);golden(p);const [a,b]=cfg.copies,first=p.copy(a),second=p.copy(b);second.reject(Error('other button'));await settle();first.resolve();await settle();
    same(tag+' buttons have independent requests and error ownership',[p.get(a).textContent,p.get(cfg.status).textContent],[S.copied,failureText[lang]]);p.copy(b).resolve();await settle();same(tag+' error owner retries successfully',[p.get(a).textContent,p.get(b).textContent,p.get(cfg.status).textContent],[S.copied,S.copied,'']);
  }
}
// ---------- v2 page layout ----------
same('all FIX checks retained', [passes, failures], [923, 0]);
same('client handlers and algorithms retain FIX bytes after bindings', hash(pageScript.slice(pageScript.indexOf("      var inputEl = document.getElementById('xf-input');"))), 'c33049a8c448c3f537c19ccf15de7979df300024176c9fff04d69387ebbcf0bd');
const markup = pageSource.replace(/^---[\s\S]*?---\s*/, '').split('<script')[0];
const css = pageSource.match(/<style>([\s\S]*?)<\/style>/)[1];
same('direct tool root carries client-only strings', /^<div class="xf-wrap" data-strings=\{JSON\.stringify\(CLIENT_T\)\}>/.test(markup), true);
same('options and actions precede stable status then shared panes', /xf-options[\s\S]*xf-toolbar[\s\S]*id="xf-status"[\s\S]*xf-panels zt-io/.test(markup), true);
same('shared pane and fill count', [(markup.match(/zt-io-pane/g)||[]).length,(markup.match(/zt-io-fill/g)||[]).length], [2,2]);
same('all original functional buttons remain', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]), ['xf-format','xf-minify','xf-clear','xf-copy-input','xf-copy-output']);
same('format remains the only primary action', (markup.match(/class="btn-primary"/g)||[]).length, 1);
same('seven adjacent tip IDs', [...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m=>m[1]), ['xf-tip-indent','xf-tip-format','xf-tip-minify','xf-tip-clear','xf-tip-input','xf-tip-copy-input','xf-tip-copy-output']);
same('no tips are inside labels or buttons', /<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markup), false);
same('input editable and output remains readonly', [/<textarea id="xf-input"[^>]*\breadonly/.test(markup),/<textarea id="xf-output"[^>]*\breadonly/.test(markup)], [false,true]);
same('root zero minima and flex column', /\.xf-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0;/.test(css), true);
same('status fixed and internally scrollable', /\.xf-status\s*\{[^}]*height: 2\.6rem;[^}]*flex: none;[^}]*overflow: auto;/.test(css), true);
same('long textarea content scrolls inside pane', /\.xf-box\s*\{[^}]*overflow: auto;/.test(css), true);
same('empty desktop output has a localized sentence', /<p class="xf-empty">\{T.formattedXmlPh\}<\/p>/.test(markup), true);
same('empty state follows actual textarea value via placeholder state', /\.xf-result:has\(#xf-output:placeholder-shown\) \.xf-empty \{ display: flex; \}/.test(css), true);
same('860 stacked empty result hidden and bounded editors', /@media \(max-width: 860px\)[\s\S]*\.xf-box \{ height: 180px; \}[\s\S]*\.xf-result:has\(#xf-output:placeholder-shown\) \{ display: none; \}/.test(css), true);
same('640 bounded editors and 44px heads', /@media \(max-width: 640px\)[\s\S]*min-height: 44px;[\s\S]*height: 120px;/.test(css), true);
same('select remains at least 44px high', /\.xf-options select \{ min-height: 44px;/.test(css), true);
same('theme feedback uses semantic tokens', /var\(--color-success\)/.test(css)&&/var\(--color-danger\)/.test(css), true);
same('runtime i18n mutation removed', /data-i18n|var STRINGS/.test(pageSource), false);
same('script stays inline inside root without relocation or reindent', /  <script is:inline>[\s\S]*  <\/script>\s*<\/div>\s*<style>/.test(pageSource), true);
const registry = readFileSync(join(root, 'src/data/tool-layouts.ts'),'utf8');
same('xml-formatter registered convert', /['"]xml-formatter['"]\s*:\s*['"]convert['"]/.test(registry), true);
const sharedCss = readFileSync(join(root,'src/styles/tool-common.css'),'utf8');
same('shared long content filling keeps zero flex basis', /\.zt-io-fill\s*\{[^}]*flex:\s*1 1 0;/.test(sharedCss), true);
// Worked examples on the tool pages, recomputed with the protected serializers. The DOM shapes
// stand in for the browser's DOMParser (native parsing is browser QA, as for thinFixtures below).
const cdata=(data)=>({nodeType:4,data});
const pageFixtures=[
  { input:'<root><user id="1"><name>Alice</name><email>alice@example.com</email></user></root>', dom:doc(el('root',{},el('user',{id:'1'},el('name',{},text('Alice')),el('email',{},text('alice@example.com'))))) },
  { input:'<?xml version="1.0" encoding="UTF-8"?><!-- order 1042 --><order id="1042" status="paid"><item sku="A-1" qty="2"/><note><![CDATA[Leave at <door> & ring]]></note><total currency="EUR">59.90</total></order>', dom:doc(comment(' order 1042 '),el('order',{id:'1042',status:'paid'},el('item',{sku:'A-1',qty:'2'}),el('note',{},cdata('Leave at <door> & ring')),el('total',{currency:'EUR'},text('59.90')))) },
  { input:'<p>Hello <b>world</b>!</p>', dom:doc(el('p',{},text('Hello '),el('b',{},text('world')),text('!'))) },
  { input:'<root><value>  x  </value><blank> </blank><empty/></root>', dom:doc(el('root',{},el('value',{},text('  x  ')),el('blank',{},text(' ')),el('empty',{}))) },
  { input:"<item name='A &amp; B'>1 &lt; 2</item>", dom:doc(el('item',{name:'A & B'},text('1 < 2'))) },
];
const exampleTexts=new Set(pageFixtures.flatMap(f=>{const prolog=E.scanProlog(f.input);return [f.input,E.prettyPrint(f.dom,'  ',prolog),E.minify(f.dom,prolog)];}));
same('order example minifies back to its one-line input',E.minify(pageFixtures[1].dom,E.scanProlog(pageFixtures[1].input)),pageFixtures[1].input);
const mdxCompiler=await import(requireRoot.resolve('@mdx-js/mdx'));
for(const lang of ['en','zh','ja','ko']) {
  const S=pageStrings[lang], payload=clientStrings(lang);
  same(lang+' tip keys',Object.keys(S.tips),['input','indent','format','minify','clear','copyInput','copyOutput']);
  same(lang+' short complete tips',Object.values(S.tips).every(x=>typeof x==='string'&&x.length>0&&x.length<=280),true);
  same(lang+' client has only runtime strings',Object.keys(payload),['copy','copied','copyFailed']);
  same(lang+' tips excluded from payload and script',Object.values(S.tips).some(x=>JSON.stringify(payload).includes(x)||pageScript.includes(x)),false);
  same(lang+' localized empty hint exists',typeof S.formattedXmlPh==='string'&&S.formattedXmlPh.length>0,true);
  const text=readFileSync(join(root,'src/content/tools/xml-formatter',lang+'.mdx'),'utf8');
  const parts=text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/),front=requireRoot('js-yaml').load(parts[1]),body=parts[2];
  same(lang+' six bounded plain steps',front.steps.length===6&&front.steps.every(x=>typeof x==='string'&&[...x].length<=280)&&front.steps.reduce((n,x)=>n+[...x].length,0)<=1200,true);
  same(lang+' steps before FAQ',parts[1].indexOf('steps:')<parts[1].indexOf('faqItems:'),true);
  same(lang+' MDX content contract', contractProblems('xml-formatter', lang), '');
  same(lang+' every XML example is a fixture input or its engine output',[...body.matchAll(/```xml\n([\s\S]*?)\n```/g)].map(m=>m[1]).filter(b=>!exampleTexts.has(b)),[]);
  same(lang+' Usage removed',/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body),false);
  let mdxError='';try{await mdxCompiler.compile(body);}catch(e){mdxError=String(e);}same(lang+' MDX compiles',mdxError,'');
}

// Actual protected serializers and the two thin-page examples; native DOMParser is browser QA.
const thinFixtures = [
  { input: '<root><value>  x  </value><blank> </blank><empty/></root>', dom: doc(el('root', {}, el('value', {}, text('  x  ')), el('blank', {}, text(' ')), el('empty', {}))), pretty: '<root>\n  <value>x</value>\n  <blank/>\n  <empty/>\n</root>', minified: '<root><value>x</value><blank></blank><empty/></root>' },
  { input: "<item name='A &amp; B'>1 &lt; 2</item>", dom: doc(el('item', { name: 'A & B' }, text('1 < 2'))), pretty: '<item name="A &amp; B">1 &lt; 2</item>', minified: '<item name="A &amp; B">1 &lt; 2</item>' }
];
const enBody=readFileSync(join(root,'src/content/tools/xml-formatter/en.mdx'),'utf8');
for(const fixture of thinFixtures) {
  const prolog=E.scanProlog(fixture.input);
  same('thin Format exact '+fixture.input,E.prettyPrint(fixture.dom,'  ',prolog),fixture.pretty);
  same('thin Minify exact '+fixture.input,E.minify(fixture.dom,prolog),fixture.minified);
  same('thin examples have no invented prolog '+fixture.input,prolog,{declaration:'',doctype:''});
  same('thin actual input and both outputs present in EN',[fixture.input,fixture.pretty,fixture.minified].every(value=>enBody.includes('```xml\n'+value+'\n```')),true);
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
