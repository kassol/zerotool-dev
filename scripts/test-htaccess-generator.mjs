// .htaccess Generator — Apache 2.4 access control and current header advice
//
// Read:  src/components/tools/HtaccessGeneratorTool.astro (extracts the real `lines()` function
//        between the `engine:start` / `engine:end` markers and runs it with stand-in form
//        controls, so this test cannot drift from the shipped source)
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Apache 2.4 controls access with `Require` (mod_authz_core); `Order` / `Deny` are Apache 2.2
// directives that 2.4 accepts only when mod_access_compat is loaded (Apache "Upgrading to 2.4
// from 2.2"). The OWASP HTTP Headers Cheat Sheet and MDN advise `X-XSS-Protection: 0` (or not
// sending it), because the old XSS auditor could be abused; "1; mode=block" is what the tool
// wrote before.
//
// The ja guide (src/content/blog/htaccess-generator-guide/ja.mdx) quotes the default output
// (`hta-default`) and Apache 2.4 results (`hta-apache`): each case writes the .htaccess body to a
// temporary document root, starts Apache with `-X` and the given AllowOverride / Options /
// mod_access_compat, and checks status codes, Cache-Control, Location and error-log text.
// Apache cases are skipped when no Apache 2.4 binary with modules is found.
//
// Run: node scripts/test-htaccess-generator.mjs

import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { reportContract, fencedBlocks } from './lib/tool-mdx-contract.mjs';

const root = process.env.ZT_B13_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(process.env.ZT_B13_SOURCE || join(root, 'src/components/tools/HtaccessGeneratorTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in HtaccessGeneratorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const makeLines = new Function('els', block + '\nreturn lines;');

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

const off = { checked: false, value: '' };
function form(overrides) {
  const names = ['https', 'wwwEnable', 'indexEnable', 'cacheEnable', 'secEnable', 'secDirListing', 'secHtaccess', 'secEnvFiles', 'secXss', 'redirEnable'];
  const els = new Proxy({}, { get: (_, k) => overrides[k] || (names.includes(k) ? off : { checked: false, value: '' }) });
  return makeLines(els)();
}
const on = { checked: true, value: '' };
const all = form({ secEnable: on, secDirListing: on, secHtaccess: on, secEnvFiles: on, secXss: on });

check('no Apache 2.2 Order directive', !/^\s*Order\b/m.test(all), all);
check('no Apache 2.2 Deny directive', !/^\s*Deny from\b/m.test(all), all);
check('.htaccess is blocked with Require all denied', /<Files "\.htaccess">\n  Require all denied\n<\/Files>/.test(all), all);
check('.env is blocked with Require all denied', /<Files "\.env">\n  Require all denied\n<\/Files>/.test(all), all);
check('X-XSS-Protection is 0', /Header always set X-XSS-Protection "0"/.test(all), all);
check('X-XSS-Protection 1; mode=block is gone', !/mode=block/.test(all), all);
check('other headers kept', /X-Content-Type-Options "nosniff"/.test(all) && /X-Frame-Options "SAMEORIGIN"/.test(all), all);

// Apache 2.4's mime.types maps .ttf to font/ttf; a rule for application/x-font-ttf alone never
// matches there (checked with Apache 2.4.67: no Expires header on a .ttf file).
const cache = form({ cacheEnable: on, cacheImages: { value: '1 year' }, cacheCss: { value: '1 month' }, cacheFonts: { value: '1 year' } });
check('TTF caching uses font/ttf', /ExpiresByType font\/ttf "access plus 1 year"/.test(cache), cache);
check('TTF caching keeps the legacy application/x-font-ttf type', /ExpiresByType application\/x-font-ttf "access plus 1 year"/.test(cache), cache);
check('JavaScript caching covers text/javascript', /ExpiresByType text\/javascript "access plus 1 month"/.test(cache), cache);

// ---------- ja guide: default output and Apache 2.4 runs ----------
// The default form state is read from the component markup (checked boxes, input values,
// selected options), so the guide's "default output" follows the shipped tool.
function defaultEls() {
  const map = {
    https: 'hta-https', wwwEnable: 'hta-www-enable', indexEnable: 'hta-index-enable', indexFiles: 'hta-index-files',
    cacheEnable: 'hta-cache-enable', cacheImages: 'hta-cache-images', cacheCss: 'hta-cache-css', cacheFonts: 'hta-cache-fonts',
    secEnable: 'hta-security-enable', secDirListing: 'hta-sec-dirlisting', secHtaccess: 'hta-sec-htaccess',
    secEnvFiles: 'hta-sec-envfiles', secXss: 'hta-sec-xss', redirEnable: 'hta-redir-enable',
    redirFrom: 'hta-redir-from', redirTo: 'hta-redir-to', redirType: 'hta-redir-type',
  };
  const els = {};
  for (const [key, id] of Object.entries(map)) {
    const tagMatch = new RegExp('<(input|select)[^>]*id="' + id + '"[^>]*>').exec(source);
    if (!tagMatch) { els[key] = { checked: false, value: '' }; continue; }
    const tag = tagMatch[0];
    if (tagMatch[1] === 'select') {
      const body = source.slice(tagMatch.index, source.indexOf('</select>', tagMatch.index));
      const sel = /<option value="([^"]+)" selected/.exec(body) || /<option value="([^"]+)"/.exec(body);
      els[key] = { checked: false, value: sel[1] };
    } else {
      const val = /value="([^"]*)"/.exec(tag);
      els[key] = { checked: /\schecked\b/.test(tag), value: val ? val[1] : '' };
    }
  }
  return els;
}
const toolDefault = makeLines(defaultEls())();
check('default form state enables HTTPS, index, caching and three security items',
  /# Force HTTPS/.test(toolDefault) && /DirectoryIndex index\.php index\.html index\.htm/.test(toolDefault) &&
  /ExpiresActive On/.test(toolDefault) && /Options -Indexes/.test(toolDefault) && !/X-XSS-Protection/.test(toolDefault), toolDefault);
const toolDefaultNoHttps = toolDefault.slice(toolDefault.indexOf('# Directory Index'));

const guidePath = join(root, 'src/content/blog/htaccess-generator-guide/ja.mdx');
const guide = readFileSync(guidePath, 'utf8');
const fm = /^---\n([\s\S]*?)\n---/.exec(guide)[1];
check('ja guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
const h2 = [...guide.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
check('ja guide has no template headings', !h2.some((h) => /online|オンライン|まとめ/i.test(h)), h2.join(' | '));
const defIdx = guide.indexOf('{/* hta-default */}');
const defBlock = /```apache\n([\s\S]*?)\n```/.exec(guide.slice(defIdx));
check('ja guide quotes the tool default output verbatim', defIdx >= 0 && defBlock && defBlock[1] === toolDefault, defBlock && defBlock[1]);

// ---------- tool page: `hta-check` examples (src/content/tools/htaccess-generator/{lang}.mdx) ----------
// `{/* hta-check: {…} */}` sets the form like a user would, starting from the default state:
//   https: bool; www: false | "add" | "remove"; index: false | "default files";
//   cache: false | [images, css/js, fonts]; security: false | {dir, ht, env, xss} (missing keys keep
//   the default); redirect: false | [from, to, "301" | "302"]; part: true.
// Without `part`, a code block after the annotation (before the next annotation or H2) must equal
// the generated file. With `part`, the blank-line-separated sections of that block must appear as
// sections of the generated file, in the same order (the page quotes only the changed blocks).
const makeLinesWww = new Function('els', 'wwwMode', block + '\nreturn lines;');
function formFrom(spec) {
  const els = defaultEls();
  let mode = 'add';
  const set = (key, checked) => { els[key] = { ...els[key], checked }; };
  if ('https' in spec) set('https', !!spec.https);
  if ('www' in spec) { set('wwwEnable', !!spec.www); if (spec.www) mode = spec.www; }
  if ('index' in spec) { set('indexEnable', spec.index !== false); if (spec.index !== false) els.indexFiles = { checked: false, value: spec.index }; }
  if ('cache' in spec) {
    set('cacheEnable', spec.cache !== false);
    if (spec.cache) ['cacheImages', 'cacheCss', 'cacheFonts'].forEach((k, i) => { els[k] = { checked: false, value: spec.cache[i] }; });
  }
  if ('security' in spec) {
    set('secEnable', spec.security !== false);
    const map = { dir: 'secDirListing', ht: 'secHtaccess', env: 'secEnvFiles', xss: 'secXss' };
    for (const [k, key] of Object.entries(map)) if (spec.security && k in spec.security) set(key, !!spec.security[k]);
  }
  if ('redirect' in spec) {
    set('redirEnable', !!spec.redirect);
    if (spec.redirect) {
      els.redirFrom = { checked: false, value: spec.redirect[0] };
      els.redirTo = { checked: false, value: spec.redirect[1] };
      els.redirType = { checked: false, value: spec.redirect[2] || '301' };
    }
  }
  return makeLinesWww(els, () => mode)();
}
const sectionsOf = (text) => text.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
function verifyCheck({ spec, after }) {
  const out = formFrom(spec);
  const blocks = fencedBlocks(after).map((b) => b.text);
  if (!blocks.length) return 'no code block after the annotation';
  if (!spec.part) return blocks.includes(out) ? null : 'generated file not quoted verbatim:\n' + out;
  const want = sectionsOf(out);
  const ok = blocks.some((b) => {
    let i = 0;
    for (const s of sectionsOf(b)) { i = want.indexOf(s, i); if (i < 0) return false; i++; }
    return true;
  });
  return ok ? null : 'quoted sections are not sections of the generated file:\n' + out;
}
check('hta-check: default spec equals the default form state', formFrom({}) === toolDefault);
reportContract(check, 'htaccess-generator', { stepCount: 5, annotations: [{ tag: 'hta-check', min: 2, verify: verifyCheck }] });

// Each `hta-apache` annotation names the .htaccess body: "ht" (a literal, "tool-default" or
// "tool-default-no-https") or, when absent, the closest ```apache block above it. The ja guide
// and the four tool pages are read. A request is [path, status, cache-control?, location?, host?].
const cases = [];
const apacheSources = [['ja guide', guide], ...['en', 'zh', 'ja', 'ko'].map((l) => [l + ' tool page', readFileSync(join(root, 'src/content/tools/htaccess-generator', l + '.mdx'), 'utf8')])];
for (const [label, text] of apacheSources) {
  let count = 0;
  for (const m of text.matchAll(/\{\/\* hta-apache: (.+?) \*\/\}/g)) {
    const spec = JSON.parse(m[1]);
    spec.source = label;
    if (spec.ht === 'tool-default') spec.body = toolDefault + '\n';
    else if (spec.ht === 'tool-default-no-https') spec.body = toolDefaultNoHttps + '\n';
    else if (spec.ht) spec.body = spec.ht;
    else {
      const before = text.slice(0, m.index);
      const blocks = [...before.matchAll(/```apache\n([\s\S]*?)```/g)];
      spec.body = blocks[blocks.length - 1][1];
    }
    cases.push(spec);
    count++;
  }
  if (label === 'ja guide') check('ja guide has Apache cases', count >= 8, count);
}

// Apache runs only where an Apache 2.4 binary and its module directory exist (macOS ships
// /usr/sbin/httpd with /usr/libexec/apache2; Debian / Ubuntu use /usr/sbin/apache2 with
// /usr/lib/apache2/modules). Set HTTPD and HTTPD_MODULES to point elsewhere. Otherwise SKIP.
const httpdCandidates = [[process.env.HTTPD, process.env.HTTPD_MODULES], ['/usr/sbin/httpd', '/usr/libexec/apache2'], ['/usr/sbin/apache2', '/usr/lib/apache2/modules']];
const found = httpdCandidates.find(([bin, mods]) => bin && mods && existsSync(bin) && existsSync(join(mods, 'mod_rewrite.so')));
const mimeTypes = ['/private/etc/apache2/mime.types', '/etc/mime.types'].find((f) => existsSync(f));
let skipped = 0;
if (!found || !mimeTypes) {
  skipped = cases.length;
} else {
  const [httpdBin, modDir] = found;
  const base = mkdtempSync(join(tmpdir(), 'hta-'));
  const docs = join(base, 'docs');
  mkdirSync(join(docs, 'app'), { recursive: true });
  mkdirSync(join(docs, 'emptydir'));
  writeFileSync(join(docs, 'index.html'), 'hello\n');
  writeFileSync(join(docs, 'index.php'), 'php\n');
  writeFileSync(join(docs, 'app.css'), 'css\n');
  writeFileSync(join(docs, 'a.ttf'), 'ttf\n');
  writeFileSync(join(docs, '.env'), 'SECRET=1\n');
  writeFileSync(join(docs, 'app', 'foo'), 'foo\n');
  const port = 18000 + Math.floor(Math.random() * 1000);
  const mods = ['mpm_prefork', 'unixd', 'authz_core', 'authz_host', 'dir', 'mime', 'log_config', 'rewrite', 'expires', 'headers', 'alias', 'autoindex', 'setenvif'];
  function conf(spec) {
    const lines = [
      'ServerRoot "' + base + '"', 'Listen 127.0.0.1:' + port, 'ServerName localhost',
      ...mods.filter((m) => existsSync(join(modDir, 'mod_' + m + '.so'))).map((m) => `LoadModule ${m}_module ${join(modDir, 'mod_' + m + '.so')}`),
      ...(spec.compat ? [`LoadModule access_compat_module ${join(modDir, 'mod_access_compat.so')}`] : []),
      'TypesConfig ' + mimeTypes, 'PidFile ' + join(base, 'httpd.pid'), 'ErrorLog ' + join(base, 'error.log'), 'LogLevel warn',
      'DocumentRoot "' + docs + '"',
      '<Files ".ht*">', '  Require all denied', '</Files>',
      '<Directory "' + docs + '">', '  Options ' + (spec.options || 'FollowSymLinks'), '  AllowOverride ' + spec.override, '  Require all granted', '</Directory>',
    ];
    return lines.join('\n') + '\n';
  }
  function request(path, host = 'example.test') {
    return new Promise((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port, path, headers: { Host: host } }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode, cc: res.headers['cache-control'] || null, loc: res.headers.location || null }));
      });
      req.on('error', () => resolve(null));
      req.end();
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const spec of cases) {
    const label = 'Apache (' + spec.source + ') ' + JSON.stringify(spec.requests) + ' ' + (spec.override) + (spec.compat ? ' +compat' : '');
    writeFileSync(join(docs, '.htaccess'), spec.body);
    writeFileSync(join(base, 'error.log'), '');
    writeFileSync(join(base, 'httpd.conf'), conf(spec));
    const child = spawn(httpdBin, ['-X', '-f', join(base, 'httpd.conf')], { stdio: 'ignore' });
    let ready = null;
    for (let i = 0; i < 50 && !ready; i++) { await sleep(100); ready = await request('/__ping'); }
    if (!ready) { child.kill('SIGKILL'); skipped += 1; continue; }
    for (const [path, status, cc, loc, host] of spec.requests) {
      const r = await request(path, host);
      check(label + ' ' + path + ' status', r && r.status === status, r && r.status);
      if (cc !== undefined && cc !== null) check(label + ' ' + path + ' Cache-Control', r && r.cc === cc, r && r.cc);
      if (loc !== undefined && loc !== null) check(label + ' ' + path + ' Location', r && r.loc === loc, r && r.loc);
    }
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
    if (spec.log) check(label + ' error log mentions ' + spec.log, readFileSync(join(base, 'error.log'), 'utf8').includes(spec.log));
  }
  rmSync(base, { recursive: true, force: true });
}
if (skipped) console.log(`SKIP: ${skipped} Apache cases (no Apache 2.4 binary with modules found, or it did not start)`);

console.log(`\n${passes} passed, ${failures} failed${skipped ? `, ${skipped} skipped` : ''}`);
process.exitCode = failures ? 1 : 0;

// Lifecycle regression: runs the complete actual page scripts and shared shortcuts.
// DOM, timers, clipboard promises and persistence are controlled; no native clipboard or network.
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const { loadPage } = await import(pathToFileURL(join(root, 'scripts/astro-page-harness.mjs')).href);
const requireFromRoot = createRequire(join(root, 'package.json'));
const { parseFragment, defaultTreeAdapter } = requireFromRoot('parse5');
const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const must=(ok,message)=>{if(!ok)throw Error(message);};
const assert=(name,actual,expected)=>{if(same(actual,expected)){passes++;return;}failures++;console.log('FAIL: '+name+' expected '+JSON.stringify(expected)+' actual '+JSON.stringify(actual));};
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
let activePage;const onUnhandled=e=>activePage?.errors.push(String(e));process.on('unhandledRejection',onUnhandled);
const SLUG='htaccess-generator',component=process.env.ZT_B13_SOURCE?relative(root,process.env.ZT_B13_SOURCE):'src/components/tools/HtaccessGeneratorTool.astro';
const templates={};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function lifecyclePage(lang='en',order='shared-after',noClipboard=false,saved={}){
  const clipboard=[],timers=new Map(),persistCalls=[],execCalls=[],downloads=[],urls=new Map();let stored=structuredClone(saved);
  let timerId=0,clock=0,doc;
  const descendants = el => el.children.flatMap(child => [child, ...descendants(child)]);
  const matchOne = (el, selector) => {
    if (el.tagName.startsWith('#')) return false;
    const parts = selector.trim().split(/\s+(?![^\[]*\])/);
    if (parts.length > 1) {
      if (!matchOne(el, parts.pop())) return false;
      for (let parent = el.parentNode; parent; parent = parent.parentNode) if (matchOne(parent, parts.join(' '))) return true;
      return false;
    }
    const not=selector.match(/:not\(([^)]+)\)/);if(not){if(matchOne(el,not[1]))return false;selector=selector.replace(not[0],'');}
    if(selector.endsWith(':checked')){if(!el.checked)return false;selector=selector.slice(0,-8);}
    const attrs=[...selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    const plain=selector.replace(/\[[^\]]+\]/g,'');
    const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
    return (!tag || el.tagName === tag.toUpperCase()) && (!id || el.id === id)
      && [...plain.matchAll(/\.([\w-]+)/g)].every(m => el.classList.contains(m[1]))
      && attrs.every(m => m[2] === undefined ? el.getAttribute(m[1]) !== null : el.getAttribute(m[1]) === m[2]);
  };
  const matches = (el, selector) => selector.split(',').some(part => matchOne(el, part.trim()));
  class EventStub {
    constructor(type, extra = {}) { Object.assign(this, { type, bubbles: false, defaultPrevented: false }, extra); }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.stopped = true; }
  }
  class Element {
    constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, listeners: {}, id: '', className: '', type: tag === 'input' ? 'text' : '', style: {}, text: '', _value: '', dirtyValue: false, disabled: false, hidden: false }); }
    get value() {
      if (!this.dirtyValue && this.tagName === 'TEXTAREA') return this.textContent;
      if (!this.dirtyValue && this.tagName === 'SELECT') return (this.querySelector('option[selected]') || this.querySelector('option'))?.value ?? '';
      return this._value;
    }
    set value(v) { this._value = String(v); this.dirtyValue = true; }
    get firstChild() { return this.children[0]??null; }
    get firstElementChild() { return this.children.find(c=>!c.tagName.startsWith('#'))??null; }
    get previousElementSibling() { const a=this.parentNode?.children.filter(c=>!c.tagName.startsWith('#'))||[];return a[a.indexOf(this)-1]??null; }
    get dataset() { const el=this;return new Proxy({}, {get(_,key){return el.getAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()));},set(_,key,value){el.setAttribute('data-'+String(key).replace(/[A-Z]/g,x=>'-'+x.toLowerCase()),value);return true;}}); }
    get parentElement() { return this.parentNode; }
    get isConnected() { return doc.contains(this); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className = (el.className + ' ' + c).trim(); }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c,force) { const yes=force??!this.contains(c);yes?this.add(c):this.remove(c);return yes; } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (['id', 'class', 'type', 'value'].includes(k)) this[k === 'class' ? 'className' : k] = String(v); if (['hidden', 'disabled', 'checked'].includes(k)) this[k] = true; }
    getAttribute(k) { if (['id', 'class', 'type'].includes(k)) return this[k === 'class' ? 'className' : k] || null; return this.attributes[k] ?? null; }
    removeAttribute(k) { delete this.attributes[k]; if (['hidden','disabled','checked'].includes(k)) this[k]=false; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(v) { for (const child of this.children) child.parentNode = null; this.children = []; this.text = String(v); }
    set innerHTML(v) {
      this.textContent = '';
      // parse5 supplies the real HTML tokenizer/entity table in the actual element context.
      // In particular, textarea uses RCDATA. No homemade entity decoder is used.
      const context = defaultTreeAdapter.createElement(this.tagName.toLowerCase(), 'http://www.w3.org/1999/xhtml', []);
      for (const node of parseFragment(context, String(v)).childNodes) this.appendChild(fromParse5(node));
    }
    appendChild(child) { if(child.tagName==='#DOCUMENT-FRAGMENT'){for(const c of [...child.children])this.appendChild(c);child.children=[];return child;}this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { const i=this.children.indexOf(child);if(i>=0)this.children.splice(i,1);child.parentNode=null;return child; }
    matches(selector) { return matches(this,selector); }
    querySelectorAll(selector) { return descendants(this).filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    contains(el) { return el === this || descendants(this).includes(el); }
    closest(selector) { for (let el = this; el; el = el.parentNode) if (matches(el, selector)) return el; return null; }
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
    dispatchEvent(event) {
      event.target = this;
      for (let el = this; el; el = el.parentNode) {
        event.currentTarget = el;
        for (const fn of el.listeners[event.type] || []) fn.call(el, event);
        if (!event.bubbles || event.stopped) break;
      }
      return !event.defaultPrevented;
    }
    dispatch(type, extra = {}) { return this.dispatchEvent(new EventStub(type, { bubbles: true, ...extra })); }
    click() { if(this.disabled)return;if(this.tagName==='A'){must(urls.has(this.href),'download Blob exists');downloads.push({name:this.download,url:this.href,blob:urls.get(this.href)});return;}this.dispatch('click'); }
    select() { doc.selectedElement=this; }
    focus() { doc.activeElement = this; }
    setSelectionRange(start,end) { this.selectionStart=start;this.selectionEnd=end; }
  }
  function fromParse5(node) {
    const el = new Element(node.tagName || node.nodeName);
    if (node.nodeName === '#text') el.text = node.value;
    for (const attr of node.attrs || []) el.setAttribute(attr.name, attr.value);
    for (const child of node.childNodes || []) if (child.nodeName !== '#comment') el.appendChild(fromParse5(child));
    return el;
  }

  doc=new Element('#document');doc.documentElement=new Element('html');doc.documentElement.lang=lang;doc.appendChild(doc.documentElement);
  doc.body=new Element('body');doc.documentElement.appendChild(doc.body);
  const widget=new Element('section');widget.className='tool-widget';doc.body.appendChild(widget);
  const labels=vm.runInNewContext(source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
  const escaped=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  widget.innerHTML=source.replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0].replace('data-strings={JSON.stringify(CLIENT_T)}','data-strings="'+escaped(JSON.stringify({copy:labels[lang].copy,copied:labels[lang].copied,copyFailed:labels[lang].copyFailed}))+'"').replace(/\{L\.(\w+)\}/g,(_,k)=>escaped(labels?.[lang]?.[k]??''));
  doc.getElementById=id=>descendants(doc).find(el=>el.id===id)??null;
  doc.createElement=tag=>new Element(tag);doc.createDocumentFragment=()=>new Element('#document-fragment');doc.activeElement=doc.body;
  doc.execCommand=command=>{execCalls.push(command);throw Error('Native clipboard prohibited');};
  const persist={clear(slug){if(slug!=='cron-job-generator')stored={};persistCalls.push(['clear',slug]);},save(slug,data){stored=JSON.parse(JSON.stringify(data));persistCalls.push(['save',slug,stored]);},load(){return structuredClone(stored);}};
  const globals={document:doc,Date:class extends Date{constructor(...a){super(...(a.length?a:['2026-10-05T08:00:00Z']));}static now(){return Date.parse('2026-10-05T08:00:00Z');}},Blob,crypto:webcrypto,URL:{createObjectURL(blob){const url='blob:probe-'+urls.size;urls.set(url,blob);return url;},revokeObjectURL(url){urls.delete(url);}},require(name){if(name==='../../data/gitignore-templates')return templates;throw Error('Unreviewed import '+name);},fetch(){throw Error('Network prohibited');},
    _slug:SLUG,ztPersist:persist,trackTool(){},
    navigator:noClipboard?{}:{clipboard:{writeText(value){const d=deferred();clipboard.push({...d,value:String(value)});return d.promise;},write(){throw Error('Unexpected clipboard.write');}}},
    setTimeout(fn,ms){timers.set(++timerId,{fn,ms,due:clock+ms});return timerId;},clearTimeout(id){timers.delete(id);},
  };
  if(order==='shared-before')vm.runInNewContext(shortcut,{document:doc,window:{ztPersist:persist},_slug:SLUG},{filename:'ToolLayout.astro:actual-shortcut'});
  const actual=loadPage(component,{lang,globals});
  if(order==='shared-after')actual.run(shortcut);
  const get=id=>{const el=doc.getElementById(id);must(el,SLUG+' ID '+id);return el;};
  const errors=[];activePage={errors};
  return{errors,doc,get,widget,clipboard,timers,persistCalls,execCalls,downloads,stored:()=>structuredClone(stored),actual,
    input(id,value,event='input'){get(id).value=value;get(id).dispatch(event);},
    ctrlL(id,key='l',mod='ctrlKey'){const el=get(id);el.focus();el.dispatch('keydown',{key,[mod]:true});},
    choose(id,checked){get(id).checked=checked;get(id).dispatch('change');},
    tick(ms){clock+=ms;for(;;){const ready=[...timers].filter(([,t])=>t.due<=clock).sort((a,b)=>a[1].due-b[1].due)[0];if(!ready)break;timers.delete(ready[0]);ready[1].fn();}},
  };
}

const LABELS={en:{copy:'Copy',copied:'Copied!',failed:'Copy failed',download:'Download'},zh:{copy:'复制',copied:'已复制！',failed:'复制失败',download:'下载'},ja:{copy:'コピー',copied:'コピー済み！',failed:'コピーに失敗しました',download:'ダウンロード'},ko:{copy:'복사',copied:'복사됨!',failed:'복사 실패',download:'다운로드'}};
const COPY='hta-copy',INPUT='hta-index-files',DELAY=1500,CLEAR_STORE={},ACTIONS=['CtrlL','new result','all off'];
const output=p=>p.get('hta-output').textContent;
const settings=p=>p.doc.querySelectorAll('input[type="checkbox"],input[type="radio"],select').map(e=>[e.id,e.value,e.checked]);
function ready(lang='en',order='shared-after',noClipboard=false){return lifecyclePage(lang,order,noClipboard);}
function act(p,action){if(action==='CtrlL')p.ctrlL(INPUT);else if(action==='all off')for(const id of ['hta-https','hta-www-enable','hta-index-enable','hta-cache-enable','hta-security-enable','hta-redir-enable'])p.choose(id,false);else p.input(INPUT,'home.html index.html');}
const feedbackState=p=>[output(p),p.get(COPY).textContent,p.get(COPY).disabled,p.get('hta-status').textContent];
const empty=p=>output(p)===''&&p.doc.querySelectorAll('input[type="text"]').every(e=>e.value==='')&&p.get(COPY).disabled&&p.get('hta-status').textContent==='';
function restoreResult(p){p.input(INPUT,'home.html index.html');}
const recover=p=>output(p).includes('DirectoryIndex home.html index.html');
let p=ready();assert('actual default matches quoted full output',output(p),toolDefault);p.choose('hta-redir-enable',true);p.input('hta-redir-from','/old');p.input('hta-redir-to','https://example.test/new');p.input('hta-redir-type','302','change');assert('actual change/input redirect',output(p).endsWith('Redirect 302 /old https://example.test/new'),true);p.choose('hta-www-enable',true);const radios=p.doc.querySelectorAll('input[name="hta-www"]');radios.forEach(r=>r.checked=r.value==='remove');radios[1].dispatch('change');assert('actual radio WWW applied',output(p).includes('https://%1%{REQUEST_URI} [L,R=301]'),true);act(p,'all off');assert('all off keeps original empty notice and disables copy',[output(p),p.get(COPY).disabled],['# (no options selected)',true]);

// Default files: a value of spaces only is treated like an empty field (the page and the tip say
// an empty value uses index.php index.html). Before, the engine wrote "DirectoryIndex " with no
// file names, and Apache then served no index file (403 on every directory).
for (const lang of ['en','zh','ja','ko']) {
  const q=ready(lang);
  for (const [value,want] of [['   ','DirectoryIndex index.php index.html'],['','DirectoryIndex index.php index.html'],['  home.html  index.php ','DirectoryIndex home.html  index.php'],['\t','DirectoryIndex index.php index.html']]) {
    q.input(INPUT,value);
    const line=output(q).split('\n').find(l=>l.startsWith('DirectoryIndex'));
    assert(lang+' default files '+JSON.stringify(value)+' write a usable DirectoryIndex',line,want);
  }
  assert(lang+' the default files field keeps what was typed',q.get(INPUT).value,'\t');
}

for(const lang of ['en','zh','ja','ko'])for(const order of ['shared-before','shared-after']){
 const id=SLUG+'/'+lang+'/'+order;
 let primary=ready(lang,order);const beforeEnter=output(primary);primary.ctrlL(INPUT,'Enter');assert(id+' shared primary behavior',output(primary),beforeEnter);
 let p=ready(lang,order);const copy=p.get(COPY),first=output(p);copy.click();assert(id+' exact copy snapshot',p.clipboard.at(-1)?.value,first);p.clipboard.at(-1)?.resolve();await settle();assert(id+' normal success',copy.textContent,LABELS[lang].copied);p.tick(DELAY);assert(id+' restore label',copy.textContent,LABELS[lang].copy);
 p=ready(lang,order);const opts=settings(p);p.ctrlL(INPUT,'L','metaKey');assert(id+' text and results cleared',empty(p),true);assert(id+' options retained',settings(p),opts);assert(id+' shared persistence clear once',p.persistCalls.filter(c=>c[0]==='clear').length,1);const n=p.clipboard.length;p.get(COPY).click();assert(id+' empty result cannot copy',p.clipboard.length,n);p.tick(1000);assert(id+' late save stays clear',p.stored(),CLEAR_STORE);
 p=ready(lang,order);const old=output(p);p.doc.body.focus();p.doc.body.dispatch('keydown',{key:'l',ctrlKey:true});assert(id+' outside tool unchanged',output(p),old);assert(id+' outside tool no persistence clear',p.persistCalls.filter(c=>c[0]==='clear').length,0);p.get(INPUT).dispatch('keydown',{key:'l'});assert(id+' unmodified L unchanged',output(p),old);
 p=ready(lang,order);const beforeReject=output(p);p.get(COPY).click();p.clipboard.at(-1)?.reject(Error('controlled rejection'));await settle();assert(id+' reject handled',p.errors,[]);assert(id+' localized failure',p.get(COPY).textContent,LABELS[lang].failed);assert(id+' rejected result intact',output(p),beforeReject);p.get(COPY).click();p.clipboard.at(-1)?.resolve();await settle();assert(id+' retry succeeds',p.get(COPY).textContent,LABELS[lang].copied);
 for(const mode of ['absent','own undefined','sync throw']){
  p=ready(lang,order,mode==='absent');if(mode==='own undefined'){Object.defineProperty(p.actual.ctx.navigator,'clipboard',{value:undefined,writable:true,configurable:true});}if(mode==='sync throw')p.actual.ctx.navigator.clipboard.writeText=()=>{throw Error('controlled synchronous throw');};let thrown='';try{p.get(COPY).click();}catch(e){thrown=e.name;}await settle();assert(id+'/'+mode+' handled',thrown,'');assert(id+'/'+mode+' visible',p.get(COPY).textContent,LABELS[lang].failed);assert(id+'/'+mode+' no native clipboard',p.execCalls,[]);assert(id+'/'+mode+' no unhandled',p.errors,[]);p.actual.ctx.navigator.clipboard={writeText(value){const d=deferred();p.clipboard.push({...d,value:String(value)});return d.promise;}};p.get(COPY).click();assert(id+'/'+mode+' retry copies intact output',p.clipboard.at(-1)?.value,output(p));p.clipboard.at(-1)?.resolve();await settle();assert(id+'/'+mode+' same-result retry succeeds',p.get(COPY).textContent,LABELS[lang].copied);
 }
 for(const action of ACTIONS)for(const outcome of ['resolve','reject']){
  p=ready(lang,order);p.get(COPY).click();const job=p.clipboard.at(-1);act(p,action);const state=feedbackState(p);job?.[outcome](outcome==='reject'?Error('controlled late rejection'):undefined);await settle();assert(id+'/'+action+'/'+outcome+' old callback inert',feedbackState(p),state);assert(id+'/'+action+'/'+outcome+' handled',p.errors,[]);
 }
 for(const outcome of ['resolve','reject']){
  p=ready(lang,order);p.get(COPY).click();const oldJob=p.clipboard.at(-1);p.get(COPY).click();p.clipboard.at(-1)?.resolve();await settle();oldJob?.[outcome](outcome==='reject'?Error('old concurrent reject'):undefined);await settle();assert(id+'/'+outcome+' old request inert',p.get(COPY).textContent,LABELS[lang].copied);assert(id+'/'+outcome+' no unhandled',p.errors,[]);
 }
 p=ready(lang,order);p.get(COPY).click();p.clipboard.at(-1)?.resolve();await settle();const stale=[...p.timers.values()].find(t=>t.ms===DELAY)?.fn;p.tick(100);p.get(COPY).click();p.clipboard.at(-1)?.resolve();await settle();stale?.();assert(id+' forced old timer inert',p.get(COPY).textContent,LABELS[lang].copied);p.tick(DELAY-100);assert(id+' old deadline inert',p.get(COPY).textContent,LABELS[lang].copied);p.tick(100);assert(id+' newest timer restores',p.get(COPY).textContent,LABELS[lang].copy);
 p=ready(lang,order);p.ctrlL(INPUT);restoreResult(p);assert(id+' real input recovers result',recover(p),true);assert(id+' recovery copy enabled',p.get(COPY).disabled,false);
}
// ---------- v2 page layout ----------
const ssr=vm.runInNewContext(source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1]+';STRINGS');
for(const lang of ['en','zh','ja','ko']){
 const q=lifecyclePage(lang),L=ssr[lang];
 assert(lang+' default output marker',q.doc.querySelector('.hta-wrap').dataset.empty,'false');
 q.ctrlL(INPUT);assert(lang+' CtrlL empty marker',q.doc.querySelector('.hta-wrap').dataset.empty,'true');
 q.input(INPUT,'home.html');assert(lang+' real input restores preview',q.doc.querySelector('.hta-wrap').dataset.empty,'false');
 assert(lang+' SSR labels before runtime replacement',q.doc.querySelector('label.hta-toggle').textContent.includes(L.forceHttps),true);
 assert(lang+' seven SSR tip keys',Object.keys(L.tips).sort(),['cache','copy','https','index','redirect','security','www']);
 assert(lang+' client only original copy feedback',Object.keys(JSON.parse(q.doc.querySelector('.hta-wrap').dataset.strings)).sort(),['copied','copy','copyFailed']);
 const prefix=process.env.ZT_B13_MDX_PREFIX,mdx=readFileSync(prefix?prefix+'-'+lang+'.mdx':join(root,'src/content/tools/htaccess-generator',lang+'.mdx'),'utf8');const y=requireFromRoot('js-yaml').load(mdx.split('---')[1]);
 assert(lang+' steps limits and position',y.steps.length<=8&&y.steps.every(x=>x.length<=280)&&y.steps.join('').length<=1200&&mdx.indexOf('steps:')<mdx.indexOf('faqItems:'),true);
 assert(lang+' Usage removed',!/<h2>(?:How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(mdx),true);
}
assert('desktop grid uses a definite zero flex basis to bound long output', /\.hta-main\s*\{[^}]*\bflex:\s*1 1 0;/.test(source), true);
assert('generate rail/result bounded structure',source.includes('hta-controls zt-rail')&&source.includes('grid-template-columns: 300px minmax(0, 1fr)')&&source.includes('overflow: auto'),true);
assert('SSR replaces runtime labels',!source.includes('data-i18n')&&!source.includes('var STRINGS'),true);
assert('seven static localized tips',[...source.matchAll(/<Toggletip id="hta-tip-/g)].length,7);
assert('only original Copy business action',[...source.matchAll(/<button[^>]*id="([^"]+)"/g)].map(x=>x[1]),['hta-copy']);
assert('status before settings and minimum 2.8em',source.indexOf('id="hta-status"')<source.indexOf('id="hta-https"')&&source.includes('min-height: 2.8em'),true);
assert('native Options closed by default',/<details class="hta-options">/.test(source)&&!/<details class="hta-options"[^>]*\bopen\b/.test(source),true);
assert('stacked empty result hidden/phone targets',source.includes('@media (max-width: 860px)')&&source.includes('@media (max-width: 640px)')&&source.includes('min-height: 44px')&&source.includes('min-height: 24px')&&source.includes('.hta-wrap[data-empty="true"] .hta-result { display: none; }'),true);
if(!/['"]htaccess-generator['"]\s*:\s*['"]generate['"]/.test(readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8')))console.log('PENDING: root generate registration, compile and native layout acceptance');
process.removeListener('unhandledRejection',onUnhandled);
console.log(passes+' passed, '+failures+' failed');process.exitCode=failures?1:0;
