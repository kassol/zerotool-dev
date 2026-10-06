// CSP Header Generator — the Strict preset no longer outputs a policy that blocks every script
//
// Read:  src/components/tools/CspHeaderGeneratorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers), the 4 tool page mdx files,
//        src/content/blog/csp-header-generator-guide/{en,zh,ja,ko}.mdx (section 9; the en `csp-run`
//        server is written to a temp directory, started on a free port and fetched)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers:
//   - Strict preset follows web.dev "Strict CSP" (nonce-based): script-src 'nonce-{RANDOM}'
//     'strict-dynamic', object-src 'none'. Before the fix it was `script-src 'self'
//     'strict-dynamic'` with no nonce or hash; CSP3 §6.7.1.1 blocks every parser-inserted
//     script and §6.7.3.3 every inline script in that case, so the page ran no script and the
//     tool showed no warning.
//   - The `{RANDOM}` placeholder does not match the CSP3 nonce-source grammar
//     (base64-value = 1*( ALPHA / DIGIT / "+" / "/" / "-" / "_" )*2( "=" )), so it always
//     produces a warning that the server must replace it per response.
//   - 'strict-dynamic' without a nonce / hash in script-src (or in default-src when script-src
//     is absent) is a warning; with a nonce or hash it is not; a malformed nonce is a warning.
//   - <meta> output drops report-uri, frame-ancestors and sandbox only (CSP3 §3.3); report-to
//     stays.
//   - Express output generates a fresh nonce per response with helmet's function-directive
//     form; the generated code is executed with a stub `require` / `app` and the directive
//     functions produce a valid nonce-source for two requests with different nonces.
//   - 4 language STRINGS have the same keys; tool pages no longer describe the old preset.
//
// Run: node scripts/test-csp-header-generator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes, createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = process.env.ZT_TEST_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const { parseFragment } = createRequire(join(root, 'package.json'))('parse5');
const source = readFileSync(process.env.ZT_FIX_SOURCE || join(root, 'src/components/tools/CspHeaderGeneratorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in CspHeaderGeneratorTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) +
  '\nreturn { STRINGS, PRESETS, PRESET_FLAGS, NONCE_PLACEHOLDER, buildPolicy, buildOutput, validatePolicy };')();
const T = E.STRINGS.en;

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
function stateFor(preset, extra) {
  const directives = {};
  for (const [k, v] of Object.entries(E.PRESETS[preset])) directives[k] = v.slice();
  return Object.assign({ mode: 'enforce', upgrade: !!E.PRESET_FLAGS[preset].upgrade, block: false, directives }, extra || {});
}
const keys = (state) => E.validatePolicy(state).map((w) => w.key);

// CSP3 nonce-source grammar
const NONCE_RE = /^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/;
const HASH_RE = /^'sha(256|384|512)-[A-Za-z0-9+/_-]+={0,2}'$/;

// ── 1. Strict preset ──
{
  const s = stateFor('strict');
  const scriptSrc = s.directives['script-src'];
  check('strict script-src has a nonce placeholder', scriptSrc.includes(E.NONCE_PLACEHOLDER), JSON.stringify(scriptSrc));
  check("strict script-src keeps 'strict-dynamic'", scriptSrc.includes("'strict-dynamic'"));
  eq('strict object-src', s.directives['object-src'], ["'none'"]);
  check('strict base-uri is set', Array.isArray(s.directives['base-uri']) && s.directives['base-uri'].length > 0);
  eq('placeholder text', E.NONCE_PLACEHOLDER, "'nonce-{RANDOM}'");
  check('placeholder is not a valid nonce-source (browsers would ignore it)', !NONCE_RE.test(E.NONCE_PLACEHOLDER));
  const k = keys(s);
  check('strict preset warns that the placeholder must be replaced per response', k.includes('warnNoncePlaceholder'), JSON.stringify(k));
  check('strict preset with placeholder is not reported as nonce-less', !k.includes('warnStrictDynamicNoNonce'), JSON.stringify(k));
  const header = E.buildOutput(s, 'header', T);
  check('header output contains the placeholder', header.includes("script-src 'nonce-{RANDOM}' 'strict-dynamic'"), header);
}

// ── 2. the old preset (persisted state from before the fix) ──
{
  const s = stateFor('strict');
  s.directives['script-src'] = ["'self'", "'strict-dynamic'"];
  const w = E.validatePolicy(s);
  const hit = w.find((x) => x.key === 'warnStrictDynamicNoNonce');
  check("'self' 'strict-dynamic' without nonce is a warning", hit && hit.level === 'warn' && hit.directive === 'script-src', JSON.stringify(w));
  check('the warning text mentions that scripts are blocked', /block/i.test(T.warnStrictDynamicNoNonce));
}
{
  const s = { mode: 'enforce', upgrade: false, block: false, directives: { 'default-src': ["'self'", "'strict-dynamic'"] } };
  check('default-src strict-dynamic without script-src and nonce warns', keys(s).includes('warnStrictDynamicNoNonce'));
  s.directives['script-src'] = ["'self'"];
  check('default-src strict-dynamic is ignored once script-src exists', !keys(s).includes('warnStrictDynamicNoNonce'));
}
for (const src of ["'nonce-" + randomBytes(16).toString('base64') + "'", "'sha256-" + randomBytes(32).toString('base64') + "'"]) {
  const s = stateFor('strict');
  s.directives['script-src'] = [src, "'strict-dynamic'"];
  const k = keys(s);
  check('strict-dynamic with ' + src.slice(1, 6) + ' source has no nonce warnings', !k.includes('warnStrictDynamicNoNonce') && !k.includes('warnNoncePlaceholder') && !k.includes('warnNonceInvalid'), JSON.stringify(k));
}
{
  const s = stateFor('strict');
  s.directives['script-src'] = ["'nonce-abc$def'", "'strict-dynamic'"];
  const k = keys(s);
  check('malformed nonce is reported', k.includes('warnNonceInvalid'), JSON.stringify(k));
  check('malformed nonce counts as no nonce for strict-dynamic', k.includes('warnStrictDynamicNoNonce'), JSON.stringify(k));
}
check('moderate preset has no nonce warnings', !keys(stateFor('moderate')).some((k) => /Nonce|StrictDynamic/.test(k)));

// ── 3. <meta> output (CSP3 §3.3) ──
{
  const s = stateFor('strict');
  s.directives['report-uri'] = ['/csp'];
  s.directives['report-to'] = ['csp-endpoint'];
  s.directives['sandbox'] = ['allow-scripts'];
  const meta = E.buildOutput(Object.assign({}, s, { format: 'meta' }), 'meta', T);
  check('meta keeps report-to', meta.includes('report-to csp-endpoint'), meta);
  check('meta drops report-uri', !meta.includes('report-uri'), meta);
  check('meta drops frame-ancestors', !meta.includes('frame-ancestors'), meta);
  check('meta drops sandbox', !meta.includes('sandbox'), meta);
  const k = keys(Object.assign({}, s, { format: 'meta' }));
  check('meta warns about report-uri', k.includes('warnReportUriMeta'), JSON.stringify(k));
  check('meta notes report-to needs Reporting-Endpoints', k.includes('warnReportToMeta'), JSON.stringify(k));
  const header = E.buildOutput(s, 'header', T);
  check('header keeps report-uri and frame-ancestors', header.includes('report-uri /csp') && header.includes("frame-ancestors 'none'"), header);
}

// ── 4. Express output: per-response nonce through helmet function directives ──
function runExpress(code) {
  let options = null;
  const middlewares = [];
  const app = { use: (fn) => middlewares.push(fn) };
  const helmet = { contentSecurityPolicy: (o) => { options = o; return function helmetCsp() {}; } };
  const req = (name) => {
    if (name === 'helmet') return helmet;
    if (name === 'crypto' || name === 'node:crypto') return { randomBytes };
    throw new Error('unexpected require ' + name);
  };
  new Function('require', 'app', code)(req, app);
  return { options, middlewares };
}
{
  const s = stateFor('strict');
  const code = E.buildOutput(s, 'express', T);
  let run;
  try { run = runExpress(code); } catch (e) { check('express output runs', false, e.message + '\n' + code); }
  if (run) {
    check('express output registers a nonce middleware before helmet', run.middlewares.length === 2 && run.middlewares[1].name === 'helmetCsp', run.middlewares.length);
    const sources = run.options.directives['script-src'];
    check('script-src has a function source', sources.some((x) => typeof x === 'function'), JSON.stringify(sources));
    const seen = new Set();
    for (let i = 0; i < 2; i++) {
      const res = { locals: {} };
      run.middlewares[0]({}, res, () => {});
      const out = sources.map((x) => (typeof x === 'function' ? x({}, res) : x));
      const nonce = out.find((x) => /^'nonce-/.test(x));
      check('request ' + i + ': function source returns a valid nonce-source', NONCE_RE.test(nonce || ''), nonce);
      check('request ' + i + ': nonce has at least 128 bits', nonce && Buffer.from(nonce.slice(7, -1), 'base64').length >= 16, nonce);
      seen.add(nonce);
      check("request " + i + ": 'strict-dynamic' kept", out.includes("'strict-dynamic'"));
    }
    check('two requests get different nonces', seen.size === 2);
    check('no placeholder left in express code', !code.includes('{RANDOM}'), code);
    eq('other directives stay arrays', run.options.directives['object-src'], ["'none'"]);
  }
  const plain = E.buildOutput(stateFor('moderate'), 'express', T);
  const r2 = runExpress(plain);
  check('express without nonce has no nonce middleware', r2.middlewares.length === 1, r2.middlewares.length);
  eq('express moderate script-src', r2.options.directives['script-src'], ["'self'"]);
}

// ── 5. nginx output ──
{
  const out = E.buildOutput(stateFor('strict'), 'nginx', T);
  check('nginx output notes the placeholder', /^#/.test(out) && out.includes('{RANDOM}'), out);
  const last = out.split('\n').pop();
  check('nginx add_header line', /^add_header Content-Security-Policy ".*" always;$/.test(last), last);
}

// ── 6. buildPolicy unchanged for plain directives ──
eq('basic preset policy', E.buildPolicy(stateFor('basic'), false), "default-src 'self'");
eq('moderate preset policy', E.buildPolicy(stateFor('moderate'), false),
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; upgrade-insecure-requests");

// ── 7. strings ──
const base = Object.keys(E.STRINGS.en).sort();
for (const lang of ['zh', 'ja', 'ko']) eq(lang + ' STRINGS keys match en', Object.keys(E.STRINGS[lang]).sort(), base);
for (const k of ['warnNoncePlaceholder', 'warnStrictDynamicNoNonce', 'warnNonceInvalid', 'warnReportUriMeta', 'warnReportToMeta']) {
  check('en has ' + k, typeof T[k] === 'string' && T[k].length > 0);
}

// ── 8. tool pages ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/csp-header-generator', lang + '.mdx'), 'utf8');
  check(lang + " page shows the nonce placeholder", mdx.includes("nonce-{RANDOM}") || mdx.includes("nonce-&#123;RANDOM&#125;") || mdx.includes("{'nonce-{RANDOM}'}") || mdx.includes('nonce-{"{"}RANDOM{"}"}'), lang);
  check(lang + ' page shows the actual Strict header output', mdx.includes(E.buildOutput(stateFor('strict'), 'header', T)), lang);
  check(lang + ' page explains why strict-dynamic needs a nonce (CSP3 §8.2 link)', mdx.includes('https://www.w3.org/TR/CSP3/#strict-dynamic-usage'), lang);
  check(lang + ' page no longer says report-to is ignored in <meta>', !/`frame-ancestors`[、，,・]\s*`report-uri`[、，,・]\s*`report-to`/.test(mdx), lang);
}

// ── 9. the content security policy guide (en) and the other language versions ──
// `csp-check: strict header|meta` → the next code block equals the Strict preset output in that tab.
// `csp-hash: <script text>` → the hash quoted after it is the tool's computeHash() algorithm (SHA-256
// of the UTF-8 bytes, base64); the one-leading-space variant and the Nginx / Apache samples use the
// same values. `csp-run` → the Node server in the next js block is started on a free port and fetched.
{
  const guide = readFileSync(join(root, 'src/content/blog/csp-header-generator-guide/en.mdx'), 'utf8');
  const fm = guide.match(/^---\n([\s\S]*?)\n---/)[1];
  check('en guide is indexable', !/^noindex:\s*true/m.test(fm) && !/^draft:\s*true/m.test(fm));
  const tpl = [/^## What (is|are) /m, /^## .*Online/m, /^## .* in Code/m, /^## (Summary|Conclusion)/m].filter((re) => re.test(guide));
  check('en guide has no template headings', tpl.length === 0, tpl.map(String).join(' '));
  const strict = stateFor('strict');
  for (const [tag, format] of [['strict header', 'header'], ['strict meta', 'meta']]) {
    const m = guide.match(new RegExp('\\{/\\* csp-check: ' + tag + ' \\*/\\}\\s*```\\w+\\n([\\s\\S]*?)```'));
    check('en guide has csp-check: ' + tag, !!m);
    if (m) eq('en guide ' + tag + ' output', m[1].trimEnd(), E.buildOutput(Object.assign({}, strict, { format }), format, T));
  }
  const { createHash } = await import('node:crypto');
  const sha = (s) => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'";
  const hm = guide.match(/\{\/\* csp-hash: (.+?) \*\/\}\s*\nthe source is `('sha256-[^`]+')`/);
  check('en guide has csp-hash', !!hm);
  if (hm) {
    eq('en guide hash', hm[2], sha(hm[1]));
    check('en guide quotes the script it hashes', guide.includes('<script>' + hm[1] + '</script>'));
    check('en guide one-space hash', guide.includes('hashes to `' + sha(' ' + hm[1]) + '`'), sha(' ' + hm[1]));
    check('nginx sample uses the same hash', guide.includes('add_header Content-Security-Policy "script-src ' + hm[2] + " 'strict-dynamic'"));
    check('apache sample uses the same hash', guide.includes('Header always set Content-Security-Policy "script-src ' + hm[2] + " 'strict-dynamic'"));
  }
  check('en guide quotes the placeholder warning shown by the tool', T.warnNoncePlaceholder.includes('placeholder'));
  check('en guide quotes the old-preset warning text', guide.includes('every `<script>` on the page is blocked') && T.warnStrictDynamicNoNonce.includes('every <script> on the page is blocked'));

  const run = guide.match(/\{\/\* csp-run \*\/\}\s*```js\n([\s\S]*?)```/);
  check('en guide has csp-run', !!run);
  if (run) {
    const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'csp-guide-'));
    const file = join(dir, 'server.mjs');
    check('csp-run listens on 8080', run[1].includes('server.listen(8080);'));
    writeFileSync(file, run[1].replace('server.listen(8080);', 'server.listen(0);\nexport { server };'));
    const { server } = await import(file);
    await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
    const base = 'http://127.0.0.1:' + server.address().port;
    const seen = new Set();
    for (let i = 0; i < 2; i++) {
      const res = await fetch(base + '/');
      const csp = res.headers.get('content-security-policy');
      const html = await res.text();
      const nonce = (csp.match(/'nonce-([^']+)'/) || [])[1];
      check('csp-run response ' + i + ' has a valid nonce-source', NONCE_RE.test("'nonce-" + nonce + "'"), csp);
      check('csp-run response ' + i + ' nonce has 128 bits', nonce && Buffer.from(nonce, 'base64').length === 16, nonce);
      check('csp-run response ' + i + ' policy', csp === `script-src 'nonce-${nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'none'`, csp);
      check('csp-run response ' + i + ' trusted script carries the nonce', html.includes(`<script nonce="${nonce}">`));
      check('csp-run response ' + i + ' has one script without a nonce', (html.match(/<script>/g) || []).length === 1);
      seen.add(nonce);
    }
    check('csp-run gives each response a new nonce', seen.size === 2);
    const w = await fetch(base + '/widget.js');
    check('csp-run serves widget.js as text/javascript', w.headers.get('content-type') === 'text/javascript');
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }

  // zh / ja / ko keep their text but no longer describe the pre-2026-10-01 Strict preset or a
  // generated nonce, and do not say report-to is dropped from <meta>.
  for (const lang of ['zh', 'ja', 'ko']) {
    const g = readFileSync(join(root, 'src/content/blog/csp-header-generator-guide', lang + '.mdx'), 'utf8');
    check(lang + ' guide no longer describes Strict as self + strict-dynamic', !/Strict\s*(设置|は|는)\s*`script-src 'self'/.test(g) && g.includes("`script-src 'nonce-{RANDOM}' 'strict-dynamic'`"));
    check(lang + ' guide no longer says + nonce uses getRandomValues', !g.includes('getRandomValues'));
    check(lang + " guide no longer lists report-to among the directives <meta> ignores", !/`frame-ancestors`[、，,]\s*`report-uri`[、，,]\s*`report-to`/.test(g));
    check(lang + ' guide no longer says the tool drops report-to from <meta>', !/report-to`?\s*(也|も|도)/.test(g));
    check(lang + " guide server samples have a nonce or hash with 'strict-dynamic'", !/(add_header|Header always set|Content-Security-Policy:) [^\n]*'self' 'strict-dynamic'/.test(g));
  }
}

// ---------- complete page copy lifecycle ----------
const layout=readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');const a=layout.indexOf("      document.addEventListener('keydown'",layout.indexOf('// ── Keyboard shortcuts'));const shortcut=layout.slice(a,layout.indexOf('      // ── Copy button visual feedback',a));if(!shortcut.includes('window.ztPersist.clear(_slug)'))throw Error('shortcut drift');
const flushPage = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
function ssrStrings(src) {
 const front=/^---\n([\s\S]*?)\n---/.exec(src)?.[1]||'';
 const table=/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/.exec(front)?.[1];
 return table?vm.runInNewContext(table+';STRINGS'):null;
}
function renderMarkup(src,lang='en') {
 const data=ssrStrings(src),L=data&&(data[lang]||data.en),escape=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
 let markup=src.slice(src.indexOf('---',3)+3,src.indexOf('<script is:inline>')).replace(/<style[\s\S]*?<\/style>/g,'').replace(/\{\/\*[\s\S]*?\*\/\}/g,'');
 if(!L)return markup;
 markup=markup.replace(/([\w-]+)=\{L\.(\w+)\}/g,(_,key,value)=>key+'="'+escape(L[value])+'"');
 return markup.replace(/\{L\.(?:tips\.)?(\w+)\}/g,(m,key)=>escape(m.includes('.tips.')?L.tips[key]:L[key]));
}
function page(s,lang='en',order='before'){
 const docHandlers={},copies=[],digests=[],exec=[],saved=[],cleared=[],tracks=[];let document,now=0,seq=0,selection=null;const timers=new Map();
 const scrollCalls=[];const walk=n=>n.children.flatMap(c=>[c,...walk(c)]);
 function simple(e,selector){let rest=selector;const tag=rest.match(/^[a-z][a-z0-9-]*/i);if(tag){if(e.tagName!==tag[0].toUpperCase())return false;rest=rest.slice(tag[0].length);}for(const m of rest.matchAll(/([.#])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)){if(m[1]==='#'&&e.id!==m[2]||m[1]==='.'&&!e.classList.contains(m[2]))return false;if(m[3]&&(e.getAttribute(m[3])===null||m[4]!==undefined&&e.getAttribute(m[3])!==m[4]))return false;}return true;}
 function matches(e,selector){if(selector.includes(','))return selector.split(/,\s*/).some(x=>matches(e,x));const parts=selector.split(/\s+(?![^\[]*\])/);if(!simple(e,parts.pop()))return false;for(const part of parts.reverse()){let p=e.parentNode;while(p&&!simple(p,part))p=p.parentNode;if(!p)return false;e=p;}return true;}
 function element(tag,attrs={}){
  const listeners={};const el={tagName:tag.toUpperCase(),attributes:{...attrs},parentNode:null,childNodes:[],dataset:Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5),v])),style:{},disabled:'disabled'in attrs,checked:'checked'in attrs,_value:attrs.value,
   get children(){return this.childNodes.filter(n=>n.tagName);},get id(){return this.attributes.id||'';},set id(v){this.attributes.id=v;},get type(){return this.attributes.type||(this.tagName==='INPUT'?'text':'');},set type(v){this.attributes.type=v;},get className(){return this.attributes.class||'';},set className(v){this.attributes.class=String(v);},
   get options(){return walk(this).filter(e=>e.tagName==='OPTION');},get value(){if(this._value!==undefined)return this._value;if(this.tagName==='SELECT'){const x=this.options.find(e=>e.attributes.selected!==undefined)||this.options[0];return x?x.value:'';}return '';},set value(v){this._value=String(v);},
   get textContent(){return this.childNodes.map(n=>n.tagName?n.textContent:n.value).join('');},set textContent(v){this.childNodes=[{value:String(v),parentNode:this}];},
   get innerHTML(){return this._html||'';},set innerHTML(v){this._html=String(v);this.childNodes=parseFragment(this._html).childNodes.map(n=>wrap(n,this));},
   getAttribute(k){return Object.hasOwn(this.attributes,k)?this.attributes[k]:null;},setAttribute(k,v){this.attributes[k]=String(v);if(k==='disabled')this.disabled=true;},removeAttribute(k){delete this.attributes[k];if(k==='disabled')this.disabled=false;},
   appendChild(n){n.parentNode=this;this.childNodes.push(n);return n;},removeChild(n){this.childNodes=this.childNodes.filter(x=>x!==n);n.parentNode=null;},remove(){this.parentNode?.removeChild(this);},contains(n){for(;n;n=n.parentNode)if(n===this)return true;return false;},closest(q){for(let n=this;n;n=n.parentNode)if(matches(n,q))return n;return null;},
   querySelectorAll(q){return walk(this).filter(e=>matches(e,q));},querySelector(q){return this.querySelectorAll(q)[0]||null;},
   addEventListener(k,f){(listeners[k]||=[]).push(f);},scrollIntoView(options){scrollCalls.push({id:this.id,options});},focus(){document.activeElement=this;},select(){selection=this;},dispatch(k,init={}){const e={type:k,target:this,currentTarget:this,defaultPrevented:false,cancelBubble:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;},...init};for(const f of listeners[k]||[])f.call(this,e);if(!e.cancelBubble)for(const f of docHandlers[k]||[])f.call(document,e);return e;},click(){if(!this.disabled)this.dispatch('click');},
  };el.classList={contains:c=>el.className.split(/\s+/).includes(c),add(...c){el.className=[...new Set([...el.className.split(/\s+/).filter(Boolean),...c])].join(' ');},remove(...c){el.className=el.className.split(/\s+/).filter(x=>!c.includes(x)).join(' ');},toggle(c,on){const add=on===undefined?!this.contains(c):on;this[add?'add':'remove'](c);return add;}};return el;
 }
 function wrap(n,parent){if(!n.tagName)return{value:n.value||'',parentNode:parent};const e=element(n.tagName,Object.fromEntries((n.attrs||[]).map(a=>[a.name,a.value])));e.parentNode=parent;e.childNodes=(n.childNodes||[]).map(n=>wrap(n,e));if(e.tagName==='TEXTAREA')e.value=e.textContent;return e;}
 const body=element('body'),widget=element('section',{class:'tool-widget'});body.appendChild(widget);const markup=renderMarkup(s.source,lang);widget.childNodes=parseFragment(markup).childNodes.map(n=>wrap(n,widget));
 document={body,documentElement:{lang},activeElement:body,createElement:tag=>element(tag),getElementById(id){const e=walk(body).find(e=>e.id===id);if(!e)throw Error('Missing real DOM '+id);return e;},querySelectorAll:q=>body.querySelectorAll(q),querySelector:q=>body.querySelector(q),addEventListener(k,f){(docHandlers[k]||=[]).push(f);},execCommand(command){exec.push({command,text:selection?.value});return options.fallbackSuccess;}};
 const options={holdDigest:false,fallbackSuccess:false,phone:false};
 const globals={document,TextEncoder,Uint8Array,URL,isSecureContext:true,matchMedia(){return {matches:options.phone};},btoa:bin=>Buffer.from(bin,'binary').toString('base64'),crypto:{subtle:{digest(algo,bytes){const real=webcrypto.subtle.digest(algo,bytes);const job={algo,input:Buffer.from(bytes).toString('utf8'),ready:false};digests.push(job);if(!options.holdDigest)return real;return new Promise((resolve,reject)=>{job.resolve=()=>resolve(job.value);job.reject=()=>reject(Error('controlled digest rejection'));real.then(value=>{job.value=value;job.ready=true;},reject);});}}},navigator:{clipboard:{writeText:text=>new Promise((resolve,reject)=>copies.push({text,resolve,reject})),write(){throw Error('unexpected native clipboard');}}},setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,due:now+delay,delay});return id;},clearTimeout:id=>timers.delete(id),ztPersist:{load(){return null;},save:(slug,v)=>saved.push({slug,value:JSON.parse(JSON.stringify(v))}),clear:slug=>cleared.push(slug)},trackTool:(...x)=>tracks.push(x),fetch(){throw Error('network forbidden');}};
 const context={...globals,_slug:s.slug};context.window=context;const ctx=vm.createContext(context);if(order==='before')vm.runInContext(shortcut,ctx);vm.runInContext(s.source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1],ctx,{filename:s.file});if(order==='after')vm.runInContext(shortcut,ctx);
 const $=id=>document.getElementById(id);return{$,document,globals,options,copies,digests,exec,saved,cleared,tracks,timers,scrollCalls,input(id,value,ev='input'){$(id).focus();$(id).value=value;$(id).dispatch(ev);},click:selector=>{const e=selector.startsWith('#')?$(selector.slice(1)):document.querySelector(selector);if(!e)throw Error('No real selector '+selector);e.click();},key(id){$(id).focus();$(id).dispatch('keydown',{key:'l',ctrlKey:true});},advance(ms){const end=now+ms;for(let g=0;;g++){if(g>100)throw Error('timer runaway');const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=end;},async deliver(n){for(let i=0;!digests[n].ready&&i<30;i++)await flushPage();if(!digests[n].ready)throw Error('real digest not ready');digests[n].resolve();await flushPage();}};
}

const spec = { slug: 'csp-header-generator', file: 'src/components/tools/CspHeaderGeneratorTool.astro', source };
const normalCopy = { en: 'Copy', zh: '复制', ja: 'コピー', ko: '복사' };
const copiedLabel = { en: 'Copied!', zh: '已复制！', ja: 'コピーしました！', ko: '복사됨!' };
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const p = page(spec, lang);
  p.input('csp-preset', 'basic', 'change');
  p.input('csp-hash-input', 'const café = 1;'); p.click('#csp-hash-add');
  for (let i = 0; i < 30 && !p.$('csp-hash-value').textContent.startsWith("'sha"); i++) await flushPage();
  const hash = "'sha256-" + createHash('sha256').update('const café = 1;').digest('base64') + "'";
  for (const id of ['csp-copy', 'csp-hash-copy']) {
    const value = id === 'csp-copy' ? "Content-Security-Policy: default-src 'self'; script-src 'self' " + hash : hash;
    let n = p.copies.length; p.click('#' + id);
    eq(lang + ' ' + id + ': copies complete actual bytes', p.copies[n].text, value);
    p.copies[n].reject(Error('controlled current refusal')); await flushPage();
    check(lang + ' ' + id + ': failure keeps original retryable label', p.$(id).textContent === normalCopy[lang] && p.$('csp-status').textContent === 'Copy failed.');
    n = p.copies.length; p.click('#' + id); p.copies[n].resolve(); await flushPage();
    check(lang + ' ' + id + ': direct retry clears failure', p.$(id).textContent === copiedLabel[lang] && p.$('csp-status').textContent === '');
    p.advance(1500);
    eq(lang + ' ' + id + ': feedback restores original label', p.$(id).textContent, normalCopy[lang]);
  }
}


// Exercise the real async digest and both shared-shortcut installation orders.
const hashOf = (algo, input) => "'" + algo.toLowerCase().replace('-', '') + '-' + createHash(algo.toLowerCase().replace('-', '')).update(input).digest('base64') + "'";
for (const algo of ['SHA-256', 'SHA-384', 'SHA-512']) {
  const p = page(spec); p.options.holdDigest = true;
  p.input('csp-hash-algo', algo, 'change'); p.input('csp-hash-input', 'π\nemoji 😀'); p.click('#csp-hash-add');
  await p.deliver(0);
  eq(algo + ': actual digest matches independent oracle', p.$('csp-hash-value').textContent, hashOf(algo, 'π\nemoji 😀'));
}
for (const mutation of ['input', 'empty', 'algorithm', 'target', 'preset', 'reset', 'clear']) {
  for (const completion of ['resolve', 'reject']) {
    const p = page(spec); p.options.holdDigest = true;
    p.input('csp-preset', 'basic', 'change'); p.input('csp-hash-input', 'old task'); p.click('#csp-hash-add');
    if (mutation === 'input') p.input('csp-hash-input', 'new task');
    if (mutation === 'empty') p.input('csp-hash-input', '');
    if (mutation === 'algorithm') p.input('csp-hash-algo', 'SHA-512', 'change');
    if (mutation === 'target') p.input('csp-hash-target', 'style-src', 'change');
    if (mutation === 'preset') p.input('csp-preset', 'empty', 'change');
    if (mutation === 'reset') p.click('#csp-reset');
    if (mutation === 'clear') p.key('csp-hash-input');
    const output = p.$('csp-output').textContent, saved = p.saved.length;
    if (completion === 'resolve') await p.deliver(0); else { p.digests[0].reject(); await flushPage(); }
    check(mutation + '/' + completion + ': obsolete hash cannot mutate policy or feedback', p.$('csp-output').textContent === output && p.saved.length === saved && p.$('csp-hash-copy').disabled && !p.$('csp-status').textContent);
    if (mutation === 'empty' || mutation === 'clear') check(mutation + ': empty hash cannot compute', p.$('csp-hash-add').disabled);
  }
}
for (const newerCompletion of ['resolve', 'reject']) {
  const p = page(spec); p.options.holdDigest = true;
  p.input('csp-preset', 'basic', 'change'); p.input('csp-hash-input', 'same task'); p.click('#csp-hash-add'); p.click('#csp-hash-add');
  await p.deliver(1); const output = p.$('csp-output').textContent;
  if (newerCompletion === 'resolve') await p.deliver(0); else { p.digests[0].reject(); await flushPage(); }
  check('same input new request wins over old ' + newerCompletion, p.$('csp-output').textContent === output && p.$('csp-hash-value').textContent === hashOf('SHA-256', 'same task') && !p.$('csp-status').textContent);
}
for (const presentation of ['mode', 'format']) {
  const p = page(spec); p.options.holdDigest = true; p.input('csp-preset', 'basic', 'change');
  p.input('csp-hash-input', 'retained'); p.click('#csp-hash-add');
  p.click(presentation === 'mode' ? '[data-mode="report-only"]' : '[data-format="nginx"]');
  await p.deliver(0);
  check(presentation + ': presentation changes preserve current digest', p.$('csp-output').textContent.includes(hashOf('SHA-256', 'retained')) && !p.$('csp-hash-copy').disabled);
}
for (const order of ['before', 'after']) for (const mod of ['ctrlKey', 'metaKey']) {
  const p = page(spec, 'en', order); p.options.holdDigest = true; p.input('csp-preset', 'basic', 'change');
  p.input('csp-hash-input', 'old'); p.click('#csp-hash-add'); const output = p.$('csp-output').textContent;
  const saved = p.saved.length; p.$('csp-hash-input').focus(); p.$('csp-hash-input').dispatch('keydown', { key: 'L', [mod]: true });
  check(order + '/' + mod + ': clear is synchronous and retains policy/options', p.$('csp-hash-input').value === '' && p.$('csp-hash-copy').disabled && p.$('csp-hash-add').disabled && p.$('csp-output').textContent === output && p.$('csp-preset').value === 'basic' && p.saved.length === saved && p.cleared.length === 1);
  await p.deliver(0); eq(order + '/' + mod + ': cleared old digest remains inert', p.$('csp-output').textContent, output);
  p.input('csp-hash-input', 'current'); const host = p.document.querySelector('.csp-source-input'); host.value = 'https://assets.example.com'; host.focus();
  const digests = p.digests.length; host.dispatch('keydown', { key: 'Enter', [mod]: true });
  check(order + '/' + mod + ': host Enter adds host once without triggering primary hash', p.digests.length === digests && p.$('csp-output').textContent.includes('https://assets.example.com'));
  const retained = p.$('csp-hash-input').value; p.document.body.focus(); p.document.body.dispatch('keydown', { key: 'l', [mod]: true });
  check(order + '/' + mod + ': outside focus does not clear', p.$('csp-hash-input').value === retained && p.cleared.length === 1);
}
// Same-result and cross-button requests still have distinct feedback ownership.
for (const older of ['resolve', 'reject']) for (const current of ['resolve', 'reject']) {
  const p = page(spec); p.input('csp-hash-input', 'hash'); p.click('#csp-hash-add');
  for (let i = 0; p.$('csp-hash-copy').disabled && i < 30; i++) await flushPage();
  p.click('#csp-copy'); p.click('#csp-hash-copy'); p.copies[1][current](); await flushPage();
  const label = p.$('csp-hash-copy').textContent, status = p.$('csp-status').textContent;
  p.copies[0][older](); await flushPage();
  check('cross button ' + older + '/' + current + ': latest request owns status', p.$('csp-copy').textContent === 'Copy' && p.$('csp-hash-copy').textContent === label && p.$('csp-status').textContent === status && p.exec.length === 0);
}
for (const completion of ['resolve', 'reject']) {
  const p = page(spec); p.click('#csp-copy'); p.input('csp-preset', 'basic', 'change'); p.copies[0][completion](); await flushPage();
  check('new policy invalidates old copy ' + completion, p.$('csp-copy').textContent === 'Copy' && !p.$('csp-status').textContent);
}
{
  const p = page(spec); p.click('#csp-copy'); p.copies[0].resolve(); await flushPage();
  const cancelled = [...p.timers.values()].find(t => t.delay === 1500).fn; p.advance(500); p.click('#csp-copy'); p.copies[1].resolve(); await flushPage();
  cancelled(); p.advance(1000); eq('cancelled/expired timer cannot clear latest copied feedback', p.$('csp-copy').textContent, 'Copied!');
  p.advance(500); eq('latest timer restores stable original', p.$('csp-copy').textContent, 'Copy');
  p.click('#csp-copy'); p.copies[2].reject(); await flushPage(); const oldStatus = [...p.timers.values()].find(t => t.delay === 3000).fn;
  p.advance(500); p.click('#csp-copy'); p.copies[3].reject(); await flushPage(); oldStatus(); p.advance(2500);
  eq('older status timer cannot clear current failure', p.$('csp-status').textContent, 'Copy failed.'); p.advance(500); eq('current status timer expires normally', p.$('csp-status').textContent, '');
}
for (const kind of ['missing', 'throw']) {
  const p = page(spec); let native = 0;
  const proto = { get clipboard() { native++; throw Error('native clipboard forbidden'); } };
  Object.setPrototypeOf(p.globals.navigator, proto);
  Object.defineProperty(p.globals.navigator, 'clipboard', { configurable: true, value: kind === 'missing' ? undefined : { writeText() { throw Error('sync failure'); } } });
  p.click('#csp-copy'); await flushPage();
  check(kind + ': copy failure is visible without native/fallback access', !native && p.exec.length === 0 && p.$('csp-status').textContent === 'Copy failed.' && !p.$('csp-copy').disabled);
}
// ---------- v2 page layout (DESIGN.md, kind: generate) ----------
{
 const markupStart=source.indexOf('\n---\n',4)+5,markup=source.slice(markupStart,source.indexOf('<style',markupStart));
 const script=source.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1]||'';
 const data=ssrStrings(source);
 check('v2: tool root and shared generate rail are direct',/^\s*<div class="csp-wrap">/.test(markup)&&markup.includes('class="csp-rail zt-rail"')&&source.includes('grid-template-columns: 300px minmax(0, 1fr)'));
 check('v2: actions and reserved status precede controls',markup.indexOf('id="csp-reset"')<markup.indexOf('id="csp-status"')&&markup.indexOf('id="csp-copy"')<markup.indexOf('id="csp-status"')&&markup.indexOf('id="csp-status"')<markup.indexOf('class="csp-body"')&&source.includes('min-height: 2.8em'));
 check('v2: output, validation and actual editor area have scroll bounds',/\.csp-output-pre \{[^}]*overflow: auto;[^}]*flex: 1 1 0;/.test(source)&&/\.csp-validation \{[^}]*max-height: 12rem;[^}]*overflow: auto;/.test(source)&&source.includes('.csp-editor-area { flex: 1 1 0; min-height: 120px; overflow: auto;'));
 check('v2: stack, empty result hide and mobile target declarations',source.includes('@media (max-width: 860px)')&&source.includes('.csp-result[data-empty="true"] { display: none; }')&&source.includes('@media (max-width: 640px)')&&source.includes('.csp-actions button, .csp-select, .csp-source-input, #csp-hash-input, #csp-hash-add, #csp-hash-copy { min-height: 44px; }')&&source.includes('.csp-mode-btn, .csp-tab, .csp-directive-remove, .csp-source-add-btn, .csp-keyword-chip, .csp-section-summary, .csp-flag { min-height: 24px; min-width: 24px; }'));
 check('v2: no runtime static DOM translation and tips stay outside client',!script.includes('data-i18n')&&!script.includes('.tips')&&!source.includes('define:vars')&&!source.includes('data-strings'));
 const tipIds=[...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(x=>x[1]);
 check('v2: eight unique SSR explanations',tipIds.length===8&&new Set(tipIds).size===8);
 check('v2: only manual hash action initiates compute',script.includes('var value = await computeHash();')&&script.match(/computeHash\(\)/g).length===2);
 check('v2: original four mode/format controls and both copies retained',(markup.match(/data-format=/g)||[]).length===4&&(markup.match(/data-mode=/g)||[]).length===2&&['csp-reset','csp-add-btn','csp-hash-add','csp-copy','csp-hash-copy'].every(id=>markup.includes('id="'+id+'"')));
 if(data)for(const lang of ['en','zh','ja','ko']){
  const L=data[lang],p=page(spec,lang),html=renderMarkup(source,lang);
  eq(lang+' v2: UI and explanation key sets agree',Object.keys(L).sort(),Object.keys(data.en).sort());
  check(lang+' v2: eight plaintext localized facts',Object.keys(L.tips).sort().join('|')==='copy|directives|flags|format|hash|mode|preset|reset'&&Object.values(L.tips).every(x=>typeof x==='string'&&x.length>20&&!/<\/?[a-z]|https?:\/\//i.test(x)));
  for(const key of Object.keys(L).filter(key=>key in E.STRINGS[lang]))eq(lang+' v2: SSR '+key+' equals protected client wording',L[key],E.STRINGS[lang][key]);
  check(lang+' v2: localized labels exist before client boot',html.includes('>'+L.resetBtn+'</button>')&&html.includes('>'+L.hashAddBtn.replace('&','&amp;')+'</button>')&&html.includes('>'+L.presetLabel+'</label>'));
  eq(lang+' v2: bootstrap preserves empty-saved-preference transport flags',p.$('csp-output').textContent,E.buildOutput(stateFor('strict',{upgrade:false}),'header',E.STRINGS[lang]));
  p.input('csp-preset','strict','change');eq(lang+' v2: selecting Strict uses its actual transport flag',p.$('csp-output').textContent,E.buildOutput(stateFor('strict'),'header',E.STRINGS[lang]));
  check(lang+' v2: nonce consequence stays directly visible',p.$('csp-validation').textContent.includes(E.STRINGS[lang].warnNoncePlaceholder));
  p.options.phone=true;p.input('csp-preset','empty','change');
  eq(lang+' v2: empty policy marks result empty',[p.$('csp-result').dataset.empty,p.$('csp-copy').disabled,p.$('csp-output').textContent],['true',true,E.STRINGS[lang].warnEmpty]);
  const before=p.scrollCalls.length;p.input('csp-preset','basic','change');
  eq(lang+' v2: real policy change requests mobile reveal',p.scrollCalls.at(-1),{id:'csp-result',options:{block:'start',behavior:'auto'}});
  eq(lang+' v2: boot does not force a result scroll',before,0);
  p.input('csp-hash-input','  exact π  ');eq(lang+' v2: hash editing alone never computes',p.digests.length,0);
  p.click('#csp-hash-add');for(let i=0;p.$('csp-hash-copy').disabled&&i<30;i++)await flushPage();
  eq(lang+' v2: manual hash uses full whitespace UTF8 bytes',p.$('csp-hash-value').textContent,hashOf('SHA-256','  exact π  '));
  const out=p.$('csp-output').textContent;p.key('csp-hash-input');
  eq(lang+' v2: shortcut keeps policy and populated result',[p.$('csp-output').textContent,p.$('csp-result').dataset.empty],[out,'false']);
  check(lang+' v2: shortcut clears derived hash only',p.$('csp-hash-value').textContent===L.hashEmpty&&p.$('csp-hash-copy').disabled&&p.$('csp-hash-add').disabled);
  const mdx=readFileSync(join(root,'src/content/tools/csp-header-generator',lang+'.mdx'),'utf8'),fm=/^---\n([\s\S]*?)\n---/.exec(mdx)?.[1]||'';
  const steps=[...fm.slice(fm.indexOf('steps:\n'),fm.indexOf('faqItems:')).matchAll(/^  - (".*")$/gm)].map(x=>JSON.parse(x[1]));
  check(lang+' v2: seven bounded steps replace Usage',steps.length===7&&steps.every(x=>x.length<=280&&!/<\/?[a-z]/i.test(x))&&steps.join('').length<=1200&&!/<h2>(How to use|使用步骤|使い方|사용 방법)<\/h2>/.test(mdx));
  check(lang+' v2: steps name current manual hash and Copy',steps.join('').includes(L.hashAddBtn)&&steps.join('').includes(L.copy));
 }
 const layouts=readFileSync(join(root,'src/data/tool-layouts.ts'),'utf8');
 if(process.env.ZT_B13_REGISTRATION_PENDING==='1')console.log('PENDING: generate registration is reserved for root adoption; not counted as PASS');
 else check('v2: registered with the implemented generate page',layouts.includes("'csp-header-generator': 'generate'"));
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
