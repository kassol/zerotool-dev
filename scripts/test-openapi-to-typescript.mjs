// OpenAPI to TypeScript — generated TypeScript compiles and the Zod module loads and validates
//
// Read:  src/components/tools/OpenapiToTypescriptTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers and transpiles it with the
//        TypeScript compiler; also reads the built-in EXAMPLE spec), node_modules/typescript,
//        node_modules/zod, src/content/tools/openapi-to-typescript/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Every fixture is generated with path types and Zod schemas on, then:
//   - type-checked with the TypeScript compiler API (strict, lib es2022 + dom, `zod` resolved
//     from node_modules), so the output must compile with zero diagnostics;
//   - transpiled to CommonJS and executed with the real zod 3.25, then sample values are
//     parsed with the generated schemas.
// Defects covered (before the fix): an external $ref became a type named `unknown` and the
// invalid line `export type unknown = unknown;`; a schema named `pet-status` was renamed to
// `pet_status` and then looked up under the new name, so its enum became `unknown`; `const`
// was ignored (`Record<string, unknown>`); Zod schemas were emitted in declaration order
// without z.lazy, so a forward reference or recursion threw ReferenceError on load.
// Also: names that are TypeScript keywords / start with a digit, JSON Pointer escapes in
// refs (~1), unresolved refs are reported, the tool page examples match the engine output.
//
// Run: node scripts/test-openapi-to-typescript.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import jsyaml from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = process.env.OPENAPI_TS_SOURCE || join(root, 'src/components/tools/OpenapiToTypescriptTool.astro');
const source = readFileSync(sourcePath, 'utf8');
const require = createRequire(join(root, 'package.json'));
const { z } = require('zod');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in OpenapiToTypescriptTool.astro');
  process.exit(1);
}
const engineJs = ts.transpileModule(source.slice(startIndex, endIndex), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const E = new Function(engineJs + '\nreturn { generateAll };')();
const EXAMPLE = /const EXAMPLE = `([\s\S]*?)`;/.exec(source)[1];

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

const OPTIONS = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], skipLibCheck: true };
function compile(code) {
  const fileName = join(root, '__openapi_to_ts_check__.ts');
  const host = ts.createCompilerHost(OPTIONS);
  const origGet = host.getSourceFile;
  const origExists = host.fileExists;
  const origRead = host.readFile;
  host.getSourceFile = (name, lang) => (name === fileName ? ts.createSourceFile(name, code, lang) : origGet.call(host, name, lang));
  host.fileExists = (name) => name === fileName || origExists.call(host, name);
  host.readFile = (name) => (name === fileName ? code : origRead.call(host, name));
  const program = ts.createProgram([fileName], OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}
function load(code) {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)((n) => (n === 'zod' ? { z } : require(n)), module, module.exports);
  return module.exports;
}
function gen(yaml, extra) {
  const doc = jsyaml.load(yaml, { schema: jsyaml.JSON_SCHEMA });
  return E.generateAll(doc, Object.assign({ optional: false, includePaths: true, includeZod: true, namespace: 'Components' }, extra || {}));
}
function run(label, yaml, assertions) {
  let r;
  try { r = gen(yaml); } catch (e) { check(label + ': generates', false, e.message); return; }
  const code = r.sections.join('\n\n');
  const diags = compile(code);
  check(label + ': output compiles with TypeScript (strict)', diags.length === 0, diags.join(' | ') + '\n' + code);
  let mod = null;
  try { mod = load(code); } catch (e) { check(label + ': Zod module loads', false, e.message + '\n' + code); }
  if (mod) passes++;
  if (assertions) assertions(code, mod, r);
}
function accepts(schema, value) { return schema.safeParse(value).success; }

// ── 1. built-in example ──
run('built-in example', EXAMPLE, (code, m) => {
  if (!m) return;
  check('example: PetSchema rejects status "lost"', !accepts(m.PetSchema, { id: 1, name: 'a', status: 'lost' }));
  check('example: PetSchema accepts tag null', accepts(m.PetSchema, { id: 1, name: 'a', status: 'sold', tag: null }));
});

// ── 2. external $ref and const (3.1) ──
const EVENT = `openapi: 3.1.0
info: { title: Events, version: 1.0.0 }
paths: {}
components:
  schemas:
    Event:
      type: object
      required: [id, kind, createdAt]
      properties:
        id: { type: integer, format: int64 }
        kind: { const: order.created }
        createdAt: { type: string, format: date-time }
        note: { type: [string, 'null'] }
        owner: { $ref: 'https://example.com/schemas/user.yaml#/User' }`;
run('3.1 const + external ref', EVENT, (code, m, r) => {
  check('no `export type unknown`', !/export type unknown\b/.test(code), code);
  check('const becomes a literal type', code.includes('kind: "order.created";'), code);
  check('external ref reported as unresolved', r.unsupportedRefs.includes('https://example.com/schemas/user.yaml#/User'), JSON.stringify(r.unsupportedRefs));
  check('external ref typed as unknown with a comment', /owner\?: unknown \/\* unresolved \$ref: https:\/\/example\.com\/schemas\/user\.yaml#\/User \*\/;/.test(code), code);
  if (!m) return;
  check('const: Zod accepts order.created', accepts(m.EventSchema, { id: 1, kind: 'order.created', createdAt: '2026-10-01T00:00:00Z' }));
  check('const: Zod rejects other kind', !accepts(m.EventSchema, { id: 1, kind: 'order.deleted', createdAt: '2026-10-01T00:00:00Z' }));
});

// ── 3. names that are not identifiers ──
const NAMES = `openapi: 3.0.3
info: { title: N, version: 1.0.0 }
paths: {}
components:
  schemas:
    Pet:
      type: object
      required: [status]
      properties:
        status: { $ref: '#/components/schemas/pet-status' }
        slashed: { $ref: '#/components/schemas/a~1b' }
    pet-status:
      type: string
      enum: [available, sold]
    a/b:
      type: integer
    unknown:
      type: string
    class:
      type: boolean
    1st:
      type: number`;
run('non-identifier schema names', NAMES, (code, m, r) => {
  check('pet-status enum keeps its values', /export type pet_status = "available" \| "sold";/.test(code), code);
  check('Pet.status refers to pet_status', code.includes('status: pet_status;'), code);
  check('~1 in a ref resolves to a/b', code.includes('slashed?: a_b;'), code);
  check('keyword names are renamed', code.includes('export type unknown_ = string;') && code.includes('export type class_ = boolean;') && code.includes('export type _1st = number;'), code);
  check('no unresolved refs', r.unsupportedRefs.length === 0, JSON.stringify(r.unsupportedRefs));
  if (!m) return;
  check('Zod: pet status enum enforced', !accepts(m.PetSchema, { status: 'lost' }) && accepts(m.PetSchema, { status: 'sold' }));
});

// ── 4. forward reference and recursion ──
const RECUR = `openapi: 3.0.3
info: { title: R, version: 1.0.0 }
paths:
  /tree:
    get:
      operationId: getTree
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Node' }
components:
  schemas:
    Order:
      type: object
      required: [customer]
      properties:
        customer: { $ref: '#/components/schemas/Customer' }
    Customer:
      type: object
      required: [name]
      properties:
        name: { type: string }
    Node:
      type: object
      required: [value]
      properties:
        value: { type: string }
        children:
          type: array
          items: { $ref: '#/components/schemas/Node' }
    A:
      type: object
      properties:
        b: { $ref: '#/components/schemas/B' }
    B:
      type: object
      properties:
        a: { $ref: '#/components/schemas/A' }
        n: { type: integer, nullable: true }`;
run('forward ref and recursion', RECUR, (code, m) => {
  check('forward ref uses z.lazy', code.includes('customer: z.lazy(() => CustomerSchema)'), code);
  check('self recursion is annotated', code.includes('export const NodeSchema: z.ZodType<Node> ='), code);
  check('mutual recursion is annotated', code.includes('export const ASchema: z.ZodType<A> =') && code.includes('export const BSchema: z.ZodType<B> ='), code);
  check('non-recursive schema is not annotated', code.includes('export const CustomerSchema = '), code);
  if (!m) return;
  check('forward ref: Order accepts', accepts(m.OrderSchema, { customer: { name: 'x' } }));
  check('forward ref: Order rejects bad customer', !accepts(m.OrderSchema, { customer: {} }));
  const tree = { value: 'root', children: [{ value: 'a', children: [{ value: 'b' }] }] };
  check('recursion: Node accepts a tree', accepts(m.NodeSchema, tree));
  check('recursion: Node rejects a bad grandchild', !accepts(m.NodeSchema, { value: 'r', children: [{ value: 'a', children: [{ value: 1 }] }] }));
  check('mutual recursion: A accepts', accepts(m.ASchema, { b: { a: { b: { n: null } } } }));
  check('mutual recursion: A rejects', !accepts(m.ASchema, { b: { n: 'x' } }));
});

// ── 5. other unresolved refs ──
run('unresolved local refs', `openapi: 3.0.3
info: { title: U, version: 1.0.0 }
paths:
  /x:
    get:
      responses:
        '200': { $ref: '#/components/responses/Ok' }
components:
  schemas:
    X:
      type: object
      properties:
        missing: { $ref: '#/components/schemas/Missing' }
        file: { $ref: './common.yaml#/Thing' }`, (code, m, r) => {
  for (const ref of ['#/components/schemas/Missing', './common.yaml#/Thing', '#/components/responses/Ok']) {
    check('reported: ' + ref, r.unsupportedRefs.includes(ref), JSON.stringify(r.unsupportedRefs));
  }
});

// ── 6. tool pages ──
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/openapi-to-typescript', lang + '.mdx'), 'utf8');
  check(lang + ': page no longer shows `export type unknown = unknown`', !mdx.includes('export type unknown = unknown'), lang);
  const blocks = [...mdx.matchAll(/\{\/\* o2t: (\w+) \*\/\}\s*<pre><code>\{`([\s\S]*?)`\}<\/code><\/pre>/g)];
  check(lang + ': page has annotated examples', blocks.length >= 2, String(blocks.length));
  for (const [, which, text] of blocks) {
    const r = which === 'event' ? gen(EVENT, { includePaths: false, includeZod: false }) : gen(RECUR, { includePaths: false, includeZod: true });
    const full = r.sections.join('\n\n');
    const want = text.trim();
    check(lang + ': example ' + which + ' is the engine output', full.includes(want), '\n--- page ---\n' + want + '\n--- engine ---\n' + full);
  }
}

// ---------- real page lifecycle ----------
// Execute the complete production script and actual shared keyboard listener.
// Only DOM, timers, highlighting and clipboard delivery are controlled here.
{
  console.log('Original regression: ' + passes + ' passed, ' + failures + ' failed');
  const cfg = {"slug": "openapi-to-typescript", "file": "OpenapiToTypescriptTool.astro", "input": "opts-input", "output": "opts-output-code", "status": "opts-status", "copy": "opts-copy", "clear": "opts-clear", "example": "opts-example", "operation": "opts-generate", "invalid": "openapi: [", "sample": "{\"openapi\":\"3.0.3\",\"info\":{\"title\":\"Fresh\",\"version\":\"1\"},\"paths\":{},\"components\":{\"schemas\":{\"Fresh\":{\"type\":\"object\",\"properties\":{\"active\":{\"type\":\"boolean\"}}}}}}", "valueOutput": false};
  const vm = await import('node:vm');
  const tsPage = (await import('typescript')).default;
  const { createRequire: pageRequire } = await import('node:module');
  const requirePage = pageRequire(join(root, 'src/components/tools/' + cfg.file));
  const labels = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + ';return STRINGS;')();
  const layout = readFileSync(join(root, 'src/layouts/ToolLayout.astro'), 'utf8');
  const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
  if (!shortcut.includes("document.addEventListener('keydown'")) throw Error('Shared shortcut not found');
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  const js = tsPage.transpileModule(script, { compilerOptions: { target: tsPage.ScriptTarget.ES2022, module: tsPage.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
  const unhandled = [], onUnhandled = error => unhandled.push(String(error));
  process.on('unhandledRejection', onUnhandled);
  const same = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) passes++;
    else { failures++; console.log('FAIL page ' + name + '\n got ' + JSON.stringify(got) + '\n expected ' + JSON.stringify(want)); }
  };
  function page(lang, shellFirst) {
    const copies = [], timers = new Map(), clears = [], tracks = [], blobs = [], highlights = [];
    let now = 0, timerID = 0, document;
    const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
    function simple(e, selector) {
      if (e.tagName === '#TEXT') return false;
      const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)], plain = selector.replace(/\[[^\]]+\]/g, '');
      const tag = /^[a-z][\w-]*/i.exec(plain)?.[0], id = /#([\w-]+)/.exec(plain)?.[1];
      return (!tag || e.tagName === tag.toUpperCase()) && (!id || e.id === id)
        && [...plain.matchAll(/\.([\w-]+)/g)].every(m => e.className.split(/\s+/).includes(m[1]))
        && attrs.every(a => a[2] === undefined ? e.getAttribute(a[1]) !== null : e.getAttribute(a[1]) === a[2]);
    }
    function matches(e, selector) {
      return selector.split(',').some(part => {
        const parts = part.trim().split(/\s+(?![^\[]*\])/); if (!simple(e, parts.pop())) return false;
        let parent = e.parentNode;
        while (parts.length) { while (parent && !simple(parent, parts.at(-1))) parent = parent.parentNode; if (!parent) return false; parts.pop(); parent = parent.parentNode; }
        return true;
      });
    }
    class Element {
      constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], parentNode: null, attributes: {}, dataset: {}, listeners: {}, id: '', className: '', text: '', value: '', hidden: false, disabled: false, checked: false, scrollTop: 0, scrollLeft: 0 }); }
      get parentElement() { return this.parentNode; }
      setAttribute(key, value) { this.attributes[key] = String(value); if (['id','class','type','value'].includes(key)) this[key === 'class' ? 'className' : key] = String(value); if (['hidden','disabled','checked'].includes(key)) this[key] = true; if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = String(value); }
      getAttribute(key) { return this.attributes[key] ?? null; }
      removeAttribute(key) { delete this.attributes[key]; if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]; }
      get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
      set textContent(value) { this.text = String(value); this.children = []; }
      get classList() { const el=this; return { add(...names) { el.className=[...new Set([...el.className.split(/\s+/).filter(Boolean),...names])].join(' '); }, remove(...names) { el.className=el.className.split(/\s+/).filter(n=>!names.includes(n)).join(' '); }, contains(name) { return el.className.split(/\s+/).includes(name); } }; }
      appendChild(e) { this.children.push(e); e.parentNode=this; return e; }
      contains(e) { return this === e || descendants(this).includes(e); }
      querySelectorAll(selector) { return descendants(this).filter(e=>matches(e,selector)); }
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
      dispatch(type, extra={}) { const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extra}; for(let e=this;e;e=e.parentNode){event.currentTarget=e; for(const fn of e.listeners[type]||[]) fn.call(e,event); if(event.stopped)break;} return event; }
      click() { if(!this.disabled)return this.dispatch('click'); }
      focus() { document.activeElement=this; }
    }
    document=new Element('#document');document.documentElement={lang}; document.body=document.appendChild(new Element('body'));document.activeElement=document.body;
    const widget=document.body.appendChild(new Element('section'));widget.className='tool-widget';
    const esc=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const decode=value=>value.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    const markup=source.replace(/^---[\s\S]*?---\s*/,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').split('<style')[0]
      .replace(/<Toggletip id="([^"]+)"[^>]*>[\s\S]*?<\/Toggletip>/g,(_,id)=>'<span class="zt-tip"><button type="button" class="zt-tip-btn" data-zt-tip="'+id+'">?</button></span>')
      .replace(/<!--[\s\S]*?-->/g,'').replace(/placeholder=\{`[\s\S]*?`\}/g,'').replace(/placeholder='[^']*'/g,'')
      .replace(/=\{L\.(\w+)\}/g,(_,key)=>'="'+esc(labels[lang][key])+'"').replace(/\{L\.(\w+)\}/g,(_,key)=>esc(labels[lang][key])).replace(/=\{lang\}/g,'="'+lang+'"');
    const stack=[widget];
    for(const token of markup.matchAll(/<\/?[a-z][^>]*>|[^<]+/gi)) { const text=token[0]; if(text.startsWith('</'))stack.pop();else if(text.startsWith('<')){const tag=/^<([\w-]+)/.exec(text)[1],e=new Element(tag);for(const a of text.matchAll(/([\w-]+)="([^"]*)"/g))e.setAttribute(a[1],decode(a[2]));for(const a of ['hidden','disabled','readonly','checked'])if(new RegExp('\\s'+a+'(?=\\s|/?>)').test(text))e.setAttribute(a,'');stack.at(-1).appendChild(e);if(!/\/>$/.test(text)&&!['input','br','hr','img'].includes(tag))stack.push(e);}else{const e=new Element('#text');e.text=decode(text);stack.at(-1).appendChild(e);} }
    if(stack.length!==1)throw Error('Unbalanced source markup');
    document.getElementById=id=>descendants(document).find(e=>e.id===id)??null;document.createElement=tag=>new Element(tag);
    const get=id=>{const e=document.getElementById(id);if(!e)throw Error('Missing actual source ID '+id);return e;};
    const clipboard={writeText(value){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});copies.push({value:String(value),resolve,reject});return promise;}};
    const context={document,console,exports:{},Blob,Error,_slug:cfg.slug,navigator:{clipboard},
      require(name){if(name==='highlight.js/lib/core')return{registerLanguage(){},highlightElement(e){highlights.push(e.id);e.setAttribute('data-highlighted','yes');}};if(name.startsWith('highlight.js/lib/languages/'))return()=>({});return requirePage(name);},
      setTimeout(fn,ms=0){const id=++timerID;timers.set(id,{fn,ms,due:now+ms});return id;},clearTimeout(id){timers.delete(id);},
      URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test';},revokeObjectURL(){}},ztPersist:{clear(slug){clears.push(slug);}},trackTool(...args){tracks.push(args);}};
    context.window=context;vm.createContext(context);const shared=()=>vm.runInContext(shortcut,context);
    if(shellFirst)shared();vm.runInContext(js,context,{filename:cfg.file});if(!shellFirst)shared();
    function advance(ms){const target=now+ms;for(;;){const next=[...timers].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];if(!next)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=target;}
    const out=()=>cfg.valueOutput?get(cfg.output).value:get(cfg.output).textContent;
    return{get,document,context,copies,timers,clears,tracks,blobs,highlights,advance,out,
      input(value,id=cfg.input){get(id).value=value;get(id).dispatch('input');},
      key(key='l',modifier='ctrlKey',target=cfg.input){(target?get(target):document.body).focus();return document.activeElement.dispatch('keydown',{key,[modifier]:true});},
      example(){get(cfg.example).click();},copy(){get(cfg.copy).click();return copies.at(-1);},
      snapshot(){return{input:get(cfg.input).value,output:out(),status:get(cfg.status).textContent,statusClass:get(cfg.status).className,copy:get(cfg.copy).textContent,copyClass:get(cfg.copy).className};}};
  }
  for(const lang of ['en','zh','ja','ko'])for(const shellFirst of [false,true]){
    const p=page(lang,shellFirst),tag=lang+'/'+shellFirst;
    p.example();same(tag+' actual Example creates output',!!p.out(),true);
    p.input(cfg.invalid);p.advance(300);same(tag+' invalid input clears old output',p.out(),'');same(tag+' invalid input shows error',p.get(cfg.status).classList.contains('error'),true);
    p.input('   ');p.advance(300);same(tag+' empty removes input error',p.get(cfg.input).classList.contains('error'),false);same(tag+' empty clears status/output',[p.out(),p.get(cfg.status).textContent],['','']);
    for(const [key,mod,target]of [['l','ctrlKey',cfg.input],['L','metaKey',cfg.copy]]){
      p.example();p.input(cfg.sample);const event=p.key(key,mod,target);
      same(tag+' shortcut synchronously clears '+key,[p.get(cfg.input).value,p.out(),p.get(cfg.status).textContent,event.defaultPrevented],['','','',true]);
      same(tag+' shortcut returns focus to input '+key,p.document.activeElement.id,cfg.input);p.advance(300);same(tag+' queued debounce stays cancelled '+key,[p.out(),p.get(cfg.status).textContent],['','']);
    }
    same(tag+' shared clear executes in both orders',p.clears,[cfg.slug,cfg.slug]);p.example();const outside=p.snapshot();p.key('l','ctrlKey',null);same(tag+' outside shortcut unchanged',p.snapshot(),outside);
    p.get(cfg.input).focus();p.get(cfg.input).dispatch('keydown',{key:'l'});same(tag+' unmodified key unchanged',p.snapshot(),outside);
    p.input(cfg.sample);p.get(cfg.clear).click();p.advance(300);same(tag+' Clear drops pending work',[p.get(cfg.input).value,p.out(),p.get(cfg.status).textContent],['','','']);
    p.example();const output=p.out(),status=p.get(cfg.status).textContent;
    const rejected=p.copy();same(tag+' exact full copy bytes',rejected.value,output);rejected.reject(Error('denied'));await settle();same(tag+' current rejection is localized',p.get(cfg.copy).textContent,labels[lang].copyFailed);same(tag+' current failure keeps output/status',[p.out(),p.get(cfg.status).textContent],[output,status]);
    const retry=p.copy();retry.resolve();await settle();same(tag+' direct retry success',p.get(cfg.copy).textContent,labels[lang].copied);p.advance(1500);same(tag+' success settles to Copy',p.get(cfg.copy).textContent,labels[lang].copy);
    p.context.navigator.clipboard=undefined;let thrown;try{p.copy();}catch(e){thrown=String(e);}same(tag+' absent Clipboard API is handled',thrown,undefined);same(tag+' absent API localized',p.get(cfg.copy).textContent,labels[lang].copyFailed);
    p.context.navigator.clipboard={writeText(){throw Error('sync failure');}};thrown=undefined;try{p.copy();}catch(e){thrown=String(e);}same(tag+' synchronous clipboard throw handled',thrown,undefined);
    for(const finish of ['resolve','reject'])for(const action of ['clear','shortcut','input','result']){
      const q=page(lang,shellFirst);q.example();const job=q.copy();
      if(action==='clear')q.get(cfg.clear).click();else if(action==='shortcut')q.key('L','metaKey',cfg.copy);else{q.input(cfg.sample);if(action==='result')q.advance(300);}
      const current=q.snapshot();job[finish](finish==='reject'?Error('late'):undefined);await settle();same(tag+' stale completion immediately preserves '+action+'/'+finish,q.snapshot(),current);q.advance(1500);same(tag+' stale '+finish+' after '+action,q.snapshot(),action==='input'?{...current,output:q.out(),status:q.get(cfg.status).textContent,statusClass:q.get(cfg.status).className}:current);same(tag+' stale feedback stays reset '+action+'/'+finish,q.get(cfg.copy).textContent,labels[lang].copy);
    }
    const q=page(lang,shellFirst);q.example();q.copy().resolve();await settle();const old=[...q.timers.values()].filter(t=>t.ms===1500).map(t=>t.fn);same(tag+' real success timer exists',old.length>0,true);q.advance(400);q.copy().resolve();await settle();old.forEach(fn=>fn());same(tag+' old timer cannot reset new Copied',q.get(cfg.copy).textContent,labels[lang].copied);q.advance(1500);same(tag+' latest timer settles',q.get(cfg.copy).textContent,labels[lang].copy);
    const r=page(lang,shellFirst);r.example();const one=r.copy(),two=r.copy();two.resolve();await settle();one.reject(Error('older request'));await settle();same(tag+' older rejection cannot replace new success',r.get(cfg.copy).textContent,labels[lang].copied);
    const queued=page(lang,shellFirst);queued.input(cfg.sample);queued.advance(30);queued.example();const generated=queued.tracks.length;queued.copy().resolve();await settle();queued.advance(300);same(tag+' Example cancels queued conversion before Copy',queued.get(cfg.copy).textContent,labels[lang].copied);same(tag+' Example does not run queued conversion again',queued.tracks.length,generated);
    queued.input(cfg.sample);queued.get('opts-paths').dispatch('change');const manual=queued.tracks.length;queued.advance(300);same(tag+' immediate option update cancels queued conversion',queued.tracks.length,manual);
    for(const focus of [p.get('opts-output'),p.document.querySelector('[data-zt-tip="opts-tip-copy"]')]){p.example();focus.focus();focus.dispatch('keydown',{key:'L',metaKey:true});same(tag+' output CtrlL moves focus to input',[p.document.activeElement.id,p.out(),p.get(cfg.status).textContent],[cfg.input,'','']);}
    const keyboard=page(lang,shellFirst);keyboard.example();keyboard.input(cfg.sample);const before=keyboard.tracks.filter(t=>t[1]==='generate').length;const event=keyboard.key('Enter','ctrlKey');same(tag+' no primary means CtrlEnter is not intercepted',event.defaultPrevented,false);same(tag+' removed local/shared action means zero immediate generation',keyboard.tracks.filter(t=>t[1]==='generate').length-before,0);keyboard.advance(300);same(tag+' normal input debounce still generates once',keyboard.tracks.filter(t=>t[1]==='generate').length-before,1);keyboard.input('Different','opts-root');keyboard.advance(300);keyboard.get('opts-optional').checked=true;keyboard.get('opts-optional').dispatch('change');same(tag+' real optional option reaches generated code',keyboard.out().includes('active?: boolean'),true);keyboard.get(cfg.clear).click();same(tag+' explicit Clear retains root/options',[keyboard.get('opts-root').value,keyboard.get('opts-optional').checked],['Different',true]);keyboard.example();keyboard.key('L','metaKey',cfg.copy);same(tag+' shared shortcut clears extra text input and keeps checkbox',[keyboard.get('opts-root').value,keyboard.get('opts-optional').checked],['',true]);
  }
  await settle();same('no unhandled copy rejection',unhandled,[]);process.removeListener('unhandledRejection',onUnhandled);
}

// ---------- v2 page layout ----------
{
  const { createHash } = await import('node:crypto');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const layoutCheck = (name, passed) => check('v2 ' + name, !!passed);
  const equalLayout = (name, got, want) => layoutCheck(name, JSON.stringify(got)===JSON.stringify(want));
  const strings = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + ';return STRINGS;')();
  const markup = source.split('\n---')[1].split('<script')[0], css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  layoutCheck('registered convert', /'openapi-to-typescript':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  layoutCheck('direct flex root', /^\s*<div\s+class="opts-wrap"/.test(markup) && /\.opts-wrap\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;/.test(css));
  layoutCheck('actions then reserved status then panels', markup.indexOf('class="opts-actions"') < markup.indexOf('id="opts-status"') && markup.indexOf('id="opts-status"') < markup.indexOf('class="opts-panels zt-io"') && /#opts-status\s*\{[^}]*height:\s*2\.4rem/.test(css));
  equalLayout('v2 two shared panes', (markup.match(/\bzt-io-pane\b/g)||[]).length, 2);
  layoutCheck('input and output fill panes', markup.includes('class="opts-input zt-io-fill"') && markup.includes('class="opts-output zt-io-fill"'));
  layoutCheck('accessible output scroller', /id="opts-output"[^>]*tabindex="0"[^>]*aria-labelledby="opts-output-label"/.test(markup) && /\.opts-output\s*\{[^}]*overflow:\s*auto/.test(css));
  equalLayout('three native options',(markup.match(/type="checkbox"/g)||[]).length,3);
  const mobile=css.slice(css.indexOf('@media (max-width: 860px)'));
  layoutCheck('mobile input144 and output22rem', /\.opts-input\s*\{[^}]*height:\s*144px/.test(mobile) && /\.opts-output\s*\{[^}]*height:\s*22rem/.test(mobile));
  layoutCheck('empty output follows actual text and hides on mobile', css.includes('.opts-output-pane:has(#opts-output-code:empty) .opts-empty { display: flex; }') && mobile.includes('.opts-output-pane:has(#opts-output-code:empty) { display: none; }'));
  layoutCheck('phone touch sizing and theme token surfaces', css.includes('@media (max-width: 640px)') && css.includes('min-height: 44px') && css.includes('var(--color-text)') && css.includes('var(--color-bg-secondary)'));
  layoutCheck('no automatic Generate control, binding or label', !source.includes('opts-generate') && !script.includes('generateBtn') && !script.includes("inputEl.addEventListener('keydown'") && !Object.values(strings).some(v=>'generate' in v));
  equalLayout('v2 retained actual operation IDs', [...markup.matchAll(/<button\b[^>]*id="([^"]+)"/g)].map(m=>m[1]).sort(), ['opts-clear','opts-copy','opts-example']);
  layoutCheck('build-time strings and tips excluded from script data', source.includes("import Toggletip from '../Toggletip.astro'") && !/data-i18n|define:vars|JSON\.stringify\(STRINGS/.test(source) && !/STRINGS|L\.tips/.test(script));
  const map=[['input','inputLabel'],['root','rootName'],['optional','makeOptional'],['paths','includePaths'],['zod','includeZod'],['example','example'],['clear','clear'],['copy','copy']];
  equalLayout('v2 eight tips', (markup.match(/<Toggletip\b/g)||[]).length, map.length);
  const protectedContent={"en": ["04ca15936fa50a4676ad30f3c0b0b2122a69375378079df39a7fd31ed42aaae9", "e75fd66cef488c645c8f26684900cc6fd6dd4f45544f5132b135990bdc53fa44"], "zh": ["eab2555bd7bfb407c80fa3864c23f0bfbfbf3f6215edf7e296ece427ed541cd2", "8c7672d0a260bbe329002ccaf23d443dc804726ff4f3b55d6bed425b8c02abc1"], "ja": ["d038cf3a0e0eea579ff5b337055d3faabd1fed15f07336d114d2964ba5feba31", "a23bc73f6eb226ce9837d7c580a2a0db14de617fbf7e51305eef4c2d7fb7e9a4"], "ko": ["64f423c180a3d5731b8657918ff270b8511c0ae5451dfc3cdfecad2e03323c68", "0debaf3244ed2b0d01ceed3c5c0e672582b59e71d212b4ba72dad12cfa80467d"]};
  for(const lang of ['en','zh','ja','ko']){
    const L=strings[lang];equalLayout(lang+' v2 same tip keys',Object.keys(L.tips).sort(),map.map(x=>x[0]).sort());
    layoutCheck(lang+' localized empty text',typeof L.empty==='string'&&!!L.empty.trim());
    for(const [key,about]of map){layoutCheck(lang+' localized '+key,typeof L.tips[key]==='string'&&!!L.tips[key].trim()&&typeof L[about]==='string'&&!!L[about].trim());equalLayout(lang+' placeholder parity '+key,[...L.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]),[...strings.en.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]));layoutCheck(lang+' binding '+key,markup.includes('<Toggletip id="opts-tip-'+key+'" lang={lang} about={L.'+about+'}>{L.tips.'+key+'}</Toggletip>'));}
    const mdx=readFileSync(join(root,'src/content/tools/openapi-to-typescript/'+lang+'.mdx'),'utf8'),[,fm,body]=mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
    const stepBlock=fm.match(/^steps:\n((?:  - .*\n)+)/m),steps=stepBlock[1].trimEnd().split('\n').map(line=>JSON.parse(line.slice(4)));
    layoutCheck(lang+' step limits and before FAQ',steps.length>0&&steps.length<=8&&steps.every(v=>[...v].length<=280)&&steps.reduce((n,v)=>n+[...v].length,0)<=1200&&fm.indexOf('steps:')<fm.indexOf('faqItems:'));
    equalLayout(lang+' protected SEO and FAQ',hash(fm.replace(/^steps:\n(?:  - .*\n)+/m,'')),protectedContent[lang][0]);equalLayout(lang+' all non-Usage content protected',hash(body),protectedContent[lang][1]);
    layoutCheck(lang+' Usage removed',!/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
