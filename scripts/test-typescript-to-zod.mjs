// TypeScript to Zod — generated schemas run under Zod 3 and Zod 4
//
// Read:  src/components/tools/TypescriptToZodTool.astro (extracts the real engine block between
//        the `engine:start` / `engine:end` markers), src/content/tools/typescript-to-zod/en.mdx,
//        node_modules/typescript, node_modules/zod (type-checks in memory, writes no files)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: Record<K, V> becomes z.record(K, V) (the single-argument z.record(V) parses as before in
// Zod 3 but rejects every object in Zod 4, which needs the key schema); every generated module is
// type-checked with the TypeScript compiler API (strict, against the types of `zod` 3.25 and
// `zod/v4`) and evaluated with both, and sample payloads are parsed. extends → .extend() (two
// bases, generic base, base declared later, non-object base → z.intersection, undeclared base →
// note); index signatures → .catchall(V) next to properties (extra keys kept and checked) or
// z.record(z.string(), V) alone; a property named readonly; schemas written dependencies first
// (they used to follow the input and threw ReferenceError); self and mutual recursion with
// z.lazy() and a written-out TS type with z.ZodType<T>; enum declarations (string, numeric with
// auto-increment, mixed, const / declare, computed → note); the page examples and messages.
// Run: node scripts/test-typescript-to-zod.mjs

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const source = readFileSync(join(root, 'src/components/tools/TypescriptToZodTool.astro'), 'utf8');
const page = readFileSync(join(root, 'src/content/tools/typescript-to-zod/en.mdx'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in TypescriptToZodTool.astro');
  process.exit(1);
}
const E = new Function('var MSG_NO_DECL = "No interface or type declarations found.";\n' + source.slice(startIndex, endIndex) + '\nreturn { tokenize, parse, generate };')();
const convert = (src) => E.generate(E.parse(E.tokenize(src)));
const zods = { v3: require('zod').z, v4: require('zod/v4').z };

// Turn the generated module into a function that returns its schemas
function load(code, z) {
  const names = [...code.matchAll(/^export const (\w+) =/gm)].map((m) => m[1]);
  const body = code
    .replace(/^import .*$/m, '')
    .replace(/^export type .*$/gm, '')
    .replace(/^export const /gm, 'const ');
  return new Function('z', body + '\nreturn { ' + names.join(', ') + ' };')(z);
}

let failures = 0;
let passes = 0;
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + '\n  expected ' + e + '\n  actual   ' + a);
}

// ---------- Record ----------
const rec = convert('interface Scores { byUser: Record<string, number>; perms: Record<"read" | "write", boolean>; }');
eq('Record with string keys', rec.includes('byUser: z.record(z.string(), z.number()),'), true);
eq('Record with literal keys', rec.includes('perms: z.record(z.enum(["read", "write"]), z.boolean()),'), true);
for (const [v, z] of Object.entries(zods)) {
  const { ScoresSchema } = load(rec, z);
  eq(v + ': full payload', ScoresSchema.safeParse({ byUser: { ann: 3 }, perms: { read: true, write: false } }).success, true);
  eq(v + ': wrong value type', ScoresSchema.safeParse({ byUser: { ann: '3' }, perms: { read: true, write: false } }).success, false);
}
// Zod 4 checks every key of a literal-key record (as TypeScript does); Zod 3 does not
eq('v4: missing literal key fails', load(rec, zods.v4).ScoresSchema.safeParse({ byUser: {}, perms: { read: true } }).success, false);
eq('v3: missing literal key passes', load(rec, zods.v3).ScoresSchema.safeParse({ byUser: {}, perms: { read: true } }).success, true);

// ---------- page examples ----------
const USER_INPUT = `interface Address {
  street: string;
  city: string;
  zipCode?: string;
}

export interface User {
  id: number;
  name: string;
  role: "admin" | "user" | "guest";
  age?: number;
  isActive: boolean;
  tags: string[];
  address: Address;
}

export type Status = "active" | "inactive" | "pending";`;
const SIGNUP_INPUT = `interface SignupForm {
  email: string;
  password: string;
  nickname?: string;
  referrer: string | null;
  age?: number | undefined;
  plan: "free" | "pro";
}`;
for (const [label, input] of [['User example', USER_INPUT], ['Signup example', SIGNUP_INPUT]]) {
  const out = convert(input);
  eq('page shows input for ' + label, page.includes(input), true);
  eq('page shows output for ' + label, page.includes(out), true);
  for (const [v, z] of Object.entries(zods)) eq(v + ': ' + label + ' loads', typeof load(out, z), 'object');
}
for (const [v, z] of Object.entries(zods)) {
  const { SignupFormSchema } = load(convert(SIGNUP_INPUT), z);
  eq(v + ': signup without format rules passes', SignupFormSchema.safeParse({ email: 'not-an-email', password: '1', referrer: null, plan: 'pro' }).success, true);
  eq(v + ': signup without referrer fails', SignupFormSchema.safeParse({ email: 'a@example.com', password: 'x', plan: 'free' }).success, false);
  eq(v + ': signup with unknown plan fails', SignupFormSchema.safeParse({ email: 'a@example.com', password: 'x', referrer: 'ad', plan: 'team' }).success, false);
}

// ---------- TypeScript compiler check (strict) against zod 3 and zod/v4 types ----------
const TS_OPTIONS = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts'], types: [], skipLibCheck: true };
function tsErrors(code, entry) {
  const text = code.replace('from "zod";', 'from "' + entry + '";');
  const fileName = join(root, '__typescript_to_zod_check__.ts');
  const host = ts.createCompilerHost(TS_OPTIONS);
  const origGet = host.getSourceFile;
  const origExists = host.fileExists;
  const origRead = host.readFile;
  host.getSourceFile = (name, lang) => (name === fileName ? ts.createSourceFile(name, text, lang) : origGet.call(host, name, lang));
  host.fileExists = (name) => name === fileName || origExists.call(host, name);
  host.readFile = (name) => (name === fileName ? text : origRead.call(host, name));
  const program = ts.createProgram([fileName], TS_OPTIONS, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}
// load() for code that may contain TypeScript-only syntax (type annotations, interfaces)
function loadTs(code, z) {
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(() => ({ z }), module, module.exports);
  return module.exports;
}
function checkCase(label, input, samples) {
  const out = convert(input);
  for (const entry of ['zod', 'zod/v4']) eq(label + ': tsc strict (' + entry + ')', tsErrors(out, entry), []);
  for (const [v, z] of Object.entries(zods)) {
    let S;
    try { S = loadTs(out, z); } catch (e) { eq(label + ' ' + v + ': loads', e.name + ': ' + e.message, 'no error'); continue; }
    for (const [schema, value, ok] of samples) eq(label + ' ' + v + ': ' + schema + ' ' + JSON.stringify(value), S[schema].safeParse(value).success, ok);
  }
  return out;
}

// ---------- extends ----------
const ext = checkCase('extends', 'interface Base { id: string }\ninterface Admin extends Base { level: number }', [
  ['AdminSchema', { id: 'a', level: 2 }, true],
  ['AdminSchema', { level: 2 }, false],
]);
eq('extends uses .extend()', ext.includes('export const AdminSchema = BaseSchema.extend({\n  level: z.number(),\n});'), true);
const ext2 = checkCase('two bases, generic base', 'interface Named { name: string }\ninterface Stamped<T> { at: T }\ninterface Doc extends Named, Stamped<number> { body: string }', [
  ['DocSchema', { name: 'n', at: 'x', body: 'b' }, true],
  ['DocSchema', { at: 1, body: 'b' }, false],
]);
eq('two bases: .extend(Other.shape)', ext2.includes('NamedSchema.extend(StampedSchema.shape).extend({'), true);
const ext3 = checkCase('base declared later', 'interface Admin extends Base { level: number }\ninterface Base { id: string }', [
  ['AdminSchema', { id: 'a', level: 1 }, true],
  ['AdminSchema', { level: 1 }, false],
]);
eq('base is written first', ext3.indexOf('BaseSchema =') < ext3.indexOf('AdminSchema ='), true);
const ext4 = checkCase('base is an intersection alias', 'type Base = { id: string } & { v: number }\ninterface Admin extends Base { level: number }', [
  ['AdminSchema', { id: 'a', v: 1, level: 1 }, true],
  ['AdminSchema', { id: 'a', level: 1 }, false],
]);
eq('non-object base uses z.intersection', ext4.includes('export const AdminSchema = z.intersection(BaseSchema, z.object({'), true);
const ext5 = convert('interface Admin extends Imported { level: number }');
eq('undeclared base keeps a note', ext5.includes('export const AdminSchema = z.object({\n  level: z.number(),\n}) /* extends Imported: not declared in the input */;'), true);

// ---------- index signatures ----------
const idx = checkCase('index signature with properties', 'interface Env { NODE_ENV: string; [key: string]: string }', [
  ['EnvSchema', { NODE_ENV: 'prod', PORT: '80' }, true],
  ['EnvSchema', { NODE_ENV: 'prod', PORT: 80 }, false],
  ['EnvSchema', { PORT: '80' }, false],
]);
eq('catchall', idx.includes('}).catchall(z.string());'), true);
for (const [v, z] of Object.entries(zods)) eq(v + ': catchall keeps the extra key', loadTs(idx, z).EnvSchema.parse({ NODE_ENV: 'x', PORT: '80' }).PORT, '80');
const rec2 = checkCase('index signature only', 'interface Dict { readonly [key: string]: number }\ntype Flags = { [name: string]: boolean }', [
  ['DictSchema', { a: 1 }, true],
  ['DictSchema', { a: '1' }, false],
  ['FlagsSchema', { x: true }, true],
]);
eq('only an index signature → z.record', rec2.includes('export const DictSchema = z.record(z.string(), z.number());'), true);
const rp = convert('interface T { readonly: boolean; readonly id: string }');
eq('a property named readonly', rp.includes('  readonly: z.boolean(),\n  id: z.string(),'), true);

// ---------- declaration order ----------
const order = checkCase('later declaration', 'interface Order { customer: Customer; items: Item[] }\ninterface Customer { name: string }\ntype Item = { sku: string }', [
  ['OrderSchema', { customer: { name: 'a' }, items: [{ sku: 'x' }] }, true],
  ['OrderSchema', { customer: {}, items: [] }, false],
]);
eq('dependencies first, input order otherwise', [...order.matchAll(/^export const (\w+)/gm)].map((m) => m[1]), ['CustomerSchema', 'ItemSchema', 'OrderSchema']);

// ---------- recursion ----------
const cat = checkCase('recursive type', 'interface Category { name: string; children: Category[] }', [
  ['CategorySchema', { name: 'a', children: [{ name: 'b', children: [] }] }, true],
  ['CategorySchema', { name: 'a', children: [{ name: 'b' }] }, false],
]);
eq('recursive: z.lazy', cat.includes('children: z.array(z.lazy(() => CategorySchema)),'), true);
eq('recursive: annotated with the TS type', cat.includes('export const CategorySchema: z.ZodType<Category> = z.object({'), true);
eq('recursive: TS type written out', cat.includes('export interface Category { name: string; children: Category[] }'), true);
const mut = checkCase('mutual recursion', 'type Expr = Num | Add;\ninterface Num { kind: "num"; value: number }\ninterface Add { kind: "add"; left: Expr; right: Expr }', [
  ['ExprSchema', { kind: 'add', left: { kind: 'num', value: 1 }, right: { kind: 'num', value: 2 } }, true],
  ['ExprSchema', { kind: 'add', left: { kind: 'num' }, right: { kind: 'num', value: 2 } }, false],
]);
eq('mutual recursion: only cycle members (Expr, Add) annotated', (mut.match(/: z\.ZodType</g) || []).length, 2);

// ---------- enums ----------
const en = checkCase('enums', 'enum Color { Red = "RED", Green = "GREEN" }\nexport const enum Level { Low, Mid = 5, High }\ndeclare enum Mixed { A = "a", B = 2 }\ninterface Pixel { color: Color; level: Level; m: Mixed }', [
  ['PixelSchema', { color: 'RED', level: 6, m: 'a' }, true],
  ['PixelSchema', { color: 'red', level: 6, m: 'a' }, false],
  ['PixelSchema', { color: 'RED', level: 1, m: 'a' }, false],
  ['PixelSchema', { color: 'RED', level: 0, m: 2 }, true],
]);
eq('string enum → z.enum', en.includes('export const ColorSchema = z.enum(["RED", "GREEN"]);'), true);
eq('numeric enum → literal union with auto-increment', en.includes('export const LevelSchema = z.union([z.literal(0), z.literal(5), z.literal(6)]);'), true);
eq('mixed enum', en.includes('export const MixedSchema = z.union([z.literal("a"), z.literal(2)]);'), true);
const comp = convert('enum E { A = 1 << 2, B }');
eq('computed member → unknown with a note', comp.includes('export const ESchema = z.unknown() /* enum E: computed member A */;'), true);
const unk = convert('interface Member { joined: Date }');
eq('Date reference', unk.includes('joined: z.unknown() /* Date */,'), true);

// ---------- page ----------
eq('page no longer says extends is skipped', page.includes('</code> is skipped.'), false);
const MENU = 'interface Menu extends Base { root: Category; [key: string]: unknown }\ninterface Base { id: string }\ninterface Category { name: string; children: Category[] }';
eq('page shows the recursion example input', page.includes(MENU), true);
const menuOut = checkCase('page recursion example', MENU, [
  ['MenuSchema', { id: 'm', root: { name: 'r', children: [] }, extra: 1 }, true],
  ['MenuSchema', { root: { name: 'r', children: [] } }, false],
]);
eq('page shows the recursion example output', page.includes(menuOut), true);
eq('page no longer says index signatures are skipped', /Index signatures are skipped/.test(page), false);
let noDecl = '';
try { convert('const x = 1;'); } catch (e) { noDecl = e.message; }
eq("no declarations message", noDecl, "No interface or type declarations found.");

// ---------- real page lifecycle ----------
// Execute the complete production script and actual shared keyboard listener.
// Only DOM, timers, highlighting and clipboard delivery are controlled here.
{
  console.log('Original regression: ' + passes + ' passed, ' + failures + ' failed');
  const cfg = {"slug": "typescript-to-zod", "file": "TypescriptToZodTool.astro", "input": "ttz-input", "output": "ttz-output-code", "status": "ttz-status", "copy": "ttz-copy", "clear": "ttz-clear", "example": "ttz-example", "invalid": "const x = 1;", "sample": "interface Fresh { active: boolean; }", "valueOutput": false};
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
    const queued=page(lang,shellFirst);queued.input(cfg.sample);queued.advance(30);queued.example();const highlighted=queued.highlights.filter(id=>id==='ttz-input-hl-code').length,generated=queued.tracks.length;queued.copy().resolve();await settle();queued.advance(300);same(tag+' Example cancels queued conversion before Copy',queued.get(cfg.copy).textContent,labels[lang].copied);same(tag+' Example does not run queued conversion again',queued.tracks.length,generated);same(tag+' Example cancels obsolete highlighting',queued.highlights.filter(id=>id==='ttz-input-hl-code').length,highlighted);
    queued.input(cfg.sample);const beforeShortcut=queued.tracks.length;queued.key('Enter');same(tag+' no primary button means CtrlEnter does not generate',queued.tracks.length,beforeShortcut);queued.advance(300);same(tag+' CtrlEnter leaves the real debounce intact',queued.tracks.length,beforeShortcut+1);same(tag+' input highlighting remains queued',queued.get('ttz-input-hl-code').textContent,cfg.sample+'\n');
    for(const focus of [p.get('ttz-output'),p.document.querySelector('[data-zt-tip="ttz-tip-copy"]')]){p.example();focus.focus();focus.dispatch('keydown',{key:'L',metaKey:true});same(tag+' output area CtrlL returns to editable input',[p.document.activeElement.id,p.out(),p.get(cfg.input).value,p.get(cfg.status).textContent],[cfg.input,'','','']);}
    p.input('interface T { x: string; }');p.advance(79);const beforeHL=p.get('ttz-input-hl-code').textContent;p.advance(1);same(tag+' 80ms highlighting reads current input',p.get('ttz-input-hl-code').textContent,'interface T { x: string; }\n');p.get(cfg.input).scrollTop=21;p.get(cfg.input).scrollLeft=17;p.get(cfg.input).dispatch('scroll');same(tag+' input scroll is mirrored',[p.get('ttz-input-hl-code').parentElement.scrollTop,p.get('ttz-input-hl-code').parentElement.scrollLeft],[21,17]);p.get(cfg.clear).click();p.advance(300);same(tag+' Clear also clears input highlighting',p.get('ttz-input-hl-code').textContent,'');
  }
  await settle();same('no unhandled copy rejection',unhandled,[]);process.removeListener('unhandledRejection',onUnhandled);
}

// ---------- v2 page layout ----------
{
  const { createHash } = await import('node:crypto');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const check = (name, passed) => eq('v2 ' + name, !!passed, true);
  const strings = new Function(source.slice(source.indexOf('const STRINGS'), source.indexOf('const L = STRINGS')) + ';return STRINGS;')();
  const markup = source.split('\n---')[1].split('<script')[0], css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
  const script = source.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)[1];
  check('registered convert', /'typescript-to-zod':\s*'convert'/.test(readFileSync(join(root, 'src/data/tool-layouts.ts'), 'utf8')));
  check('direct flex root', /^\s*<div\s+class="ttz-wrap"/.test(markup) && /\.ttz-wrap\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;/.test(css));
  check('actions then reserved status then panels', markup.indexOf('class="ttz-actions"') < markup.indexOf('id="ttz-status"') && markup.indexOf('id="ttz-status"') < markup.indexOf('class="ttz-panels zt-io"') && /\.ttz-status\s*\{[^}]*height:\s*2\.4rem/.test(css));
  eq('v2 two shared panes', (markup.match(/\bzt-io-pane\b/g)||[]).length, 2);
  check('overlay and output fill panes', markup.includes('class="ttz-input-wrap zt-io-fill"') && markup.includes('class="ttz-output zt-io-fill"'));
  check('accessible output scroller', /id="ttz-output"[^>]*tabindex="0"[^>]*aria-labelledby="ttz-output-label"/.test(markup) && /\.ttz-output\s*\{[^}]*overflow:\s*auto/.test(css));
  check('overlay still shares text metrics and scroll is mirrored', css.includes('white-space: pre-wrap') && css.includes('pointer-events: none') && script.includes('pre.scrollTop = inputEl.scrollTop') && script.includes('pre.scrollLeft = inputEl.scrollLeft'));
  const mobile=css.slice(css.indexOf('@media (max-width: 860px)'));
  check('mobile input144 and output22rem', /\.ttz-input-wrap\s*\{[^}]*height:\s*144px/.test(mobile) && /\.ttz-output\s*\{[^}]*height:\s*22rem/.test(mobile));
  check('empty output follows actual text and hides on mobile', css.includes('.ttz-output-pane:has(#ttz-output-code:empty) .ttz-empty { display: flex; }') && mobile.includes('.ttz-output-pane:has(#ttz-output-code:empty) { display: none; }'));
  check('phone touch sizing and global dark ancestors', css.includes('@media (max-width: 640px)') && css.includes('min-height: 44px') && css.includes(':global([data-theme="dark"])') && css.includes(':global(:root:not([data-theme="light"]))'));
  check('no automatic Generate control, binding or label', !source.includes('ttz-convert') && !Object.values(strings).some(v=>'generate' in v));
  eq('v2 retained actual operation IDs', [...markup.matchAll(/<button\b[^>]*id="([^"]+)"/g)].map(m=>m[1]).sort(), ['ttz-clear','ttz-copy','ttz-example']);
  check('build-time strings and tips excluded from script data', source.includes("import Toggletip from '../Toggletip.astro'") && !/data-i18n|define:vars|JSON\.stringify\(STRINGS/.test(source) && !/STRINGS|L\.tips/.test(script));
  const map=[['input','tsInput'],['example','example'],['clear','clear'],['copy','copy']];
  eq('v2 four tips', (markup.match(/<Toggletip\b/g)||[]).length, map.length);
  const protectedContent={"en": ["c13d6d38efa1423c9cf2cad98bfa2d79202f303ec2be56cc0e5d3556e4fb69cb", "bbc6b96d355ad8d232a68c933716fb4599d005d2733f24267417989b7b39088a"], "zh": ["6eac19bc6d1941970a40636a9a30542e2db16621a0f4bf693c7022712576de4a", "dca0cc603c3b6a16f71c9c0deec101699b4b499bbe95c9244faeb1d36f4952c1"], "ja": ["949638ca585cb5021e35c15714ee00787e7f783ec6bfbdd85e245d29652a1c6a", "0ce16f0b2f86b4ae1a031a1bda2ac156716cb6764c1359eb06d3c64f643e1e6b"], "ko": ["6287648c05f9e30912eb83555afa265b7edaa501d67bed1f8836fdd1bb0b2aa9", "efa6af9c764c55a820a810cc936fbf5e2f53aacd47631d6331a2c0f31d6e75a9"]};
  for(const lang of ['en','zh','ja','ko']){
    const L=strings[lang];eq(lang+' v2 same tip keys',Object.keys(L.tips).sort(),map.map(x=>x[0]).sort());
    check(lang+' localized empty text',typeof L.empty==='string'&&!!L.empty.trim());
    for(const [key,about]of map){check(lang+' localized '+key,typeof L.tips[key]==='string'&&!!L.tips[key].trim()&&typeof L[about]==='string'&&!!L[about].trim());eq(lang+' placeholder parity '+key,[...L.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]),[...strings.en.tips[key].matchAll(/\{\w+\}/g)].map(m=>m[0]));check(lang+' binding '+key,markup.includes('<Toggletip id="ttz-tip-'+key+'" lang={lang} about={L.'+about+'}>{L.tips.'+key+'}</Toggletip>'));}
    const mdx=readFileSync(join(root,'src/content/tools/typescript-to-zod/'+lang+'.mdx'),'utf8'),[,fm,body]=mdx.match(/^---\n([\s\S]*?\n)---\n([\s\S]*)$/);
    const stepBlock=fm.match(/^steps:\n((?:  - .*\n)+)/m),steps=stepBlock[1].trimEnd().split('\n').map(line=>JSON.parse(line.slice(4)));
    check(lang+' step limits and before FAQ',steps.length>0&&steps.length<=8&&steps.every(v=>[...v].length<=280)&&steps.reduce((n,v)=>n+[...v].length,0)<=1200&&fm.indexOf('steps:')<fm.indexOf('faqItems:'));
    eq(lang+' protected SEO and FAQ',hash(fm.replace(/^steps:\n(?:  - .*\n)+/m,'')),protectedContent[lang][0]);eq(lang+' all non-Usage content protected',hash(body),protectedContent[lang][1]);
    check(lang+' Usage removed',!/<h2>(How to Use|使用方法|使い方|사용 방법)<\/h2>/.test(body));
  }
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
