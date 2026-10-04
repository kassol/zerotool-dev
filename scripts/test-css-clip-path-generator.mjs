// Read the component, its tool pages, ToolLayout and persistence policy; write only stdout.
// Run real functions and complete page scripts. No browser or network is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseFragment } from 'parse5';
const source = fs.readFileSync(new URL('../src/components/tools/CssClipPathGeneratorTool.astro', import.meta.url), 'utf8');
const script = source.match(/<script is:inline[^>]*>([\s\S]*?)<\/script>/)[1];
function declaration(name) {
  const start = script.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  // A following same-indent declaration/comment bounds the original UI functions.
  const tail = script.slice(start);
  return tail.slice(0, tail.indexOf('\n      }') + 8);
}
const nodes = new Map();
function node(id, value = '0') {
  const n = { value, attrs: {}, listeners: {}, style: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, f) { this.listeners[k] = f; } };
  nodes.set(id, n); return n;
}
for (const [id, value] of Object.entries({ 'circle-r': 50, 'circle-cx': 0, 'circle-cy': 0, 'ellipse-cx': 0, 'ellipse-cy': 0, 'ellipse-rx': 0, 'ellipse-ry': 0, 'inset-top': 10, 'inset-right': 10, 'inset-bottom': 10, 'inset-left': 10, 'inset-round': 2.5 })) node('#cpg-' + id, String(value));
const context = vm.createContext({ currentShape: 'circle', vertices: [{x: 12.25, y: 0},{x:100,y:100},{x:0,y:100}], PREVIEW_SIZE:300, wrap: {querySelector: id => nodes.get(id)}, ellipseShape: node('ellipse'), insetShape: node('inset'), previewEl: {clientWidth: 400, clientHeight:200}, circleSvg: node('circleSvg'), insetSvg: node('insetSvg') });
context.L = {vertices:'Vertex', delete:'Delete vertex'};
vm.runInContext(declaration('updateCircleOverlay'), context);
vm.runInContext('updateCircleOverlay()', context);
assert.equal(context.ellipseShape.attrs.cx, 0, 'zero center must remain zero');
console.log('PASS zero circle center');
context.currentShape = 'ellipse';
vm.runInContext('updateCircleOverlay()', context);
assert.equal(context.ellipseShape.attrs.rx, 0, 'zero ellipse radius must remain zero');
context.currentShape = 'circle';
vm.runInContext('updateCircleOverlay()', context);
assert.ok(Math.abs(context.ellipseShape.attrs.rx - 158.11388300841898) < 1e-9, '50% circle radius on 400 × 200 is 158.113883px (CSS Shapes §5.1)');
assert.equal(context.ellipseShape.attrs.ry, context.ellipseShape.attrs.rx, 'circle stays circular on rectangular previews');
vm.runInContext(declaration('buildClipPath'), context);
context.currentShape = 'polygon';
assert.equal(vm.runInContext('buildClipPath()', context), 'polygon(12.25% 0%, 100% 100%, 0% 100%)', 'polygon keeps decimal coordinates');
context.currentShape = 'inset';
assert.equal(vm.runInContext('buildClipPath()', context), 'inset(10% 10% 10% 10% round 2.5%)', 'inset round keeps decimals');
const range = node('#range');
const num = node('#num', '150.25');
num.min = '0'; num.max = '100';
context.callback = () => {};
vm.runInContext(declaration('syncSlider') + '\nsyncSlider("#range", "#num", callback)', context);
num.listeners.input();
assert.equal(Number(num.value), 100, 'clamped value is written back before CSS generation');
context.handlesEl = { children: [], appendChild(n) { this.children.push(n); } };
context.document = { createElement: () => node('handle') };
context.makeDraggable = () => {};
vm.runInContext(declaration('renderHandles') + '\nrenderHandles()', context);
assert.equal(context.handlesEl.children[0].style.left, '12.25%', 'handles use preview-relative percentages');
context.polySvg = node('polySvg'); context.polyShape = node('polyShape');
vm.runInContext(declaration('renderPolyShape') + '\nrenderPolyShape()', context);
assert.equal(context.polySvg.attrs.viewBox, '0 0 400 200', 'polygon overlay follows the rectangular preview');
assert.equal(context.polyShape.attrs.points, '49,0 400,200 0,200');
vm.runInContext(declaration('updateInsetOverlay') + '\nupdateInsetOverlay()', context);
assert.equal(context.insetShape.attrs.x, 40);
assert.equal(context.insetShape.attrs.y, 20);
assert.equal(context.insetShape.attrs.rx, 10);
assert.equal(context.insetShape.attrs.ry, 5);
context.vertexListEl = { children: [], appendChild(n) {this.children.push(n)}, querySelectorAll() {return []} };
context.addVertexBtn = {};
vm.runInContext(declaration('renderVertexList') + '\nrenderVertexList()', context);
assert.match(context.vertexListEl.children[0].innerHTML, /value="12\.25"/, 'numeric list preserves decimals');
const vx = {dataset:{axis:'x'}, value:''};
context.vertexListEl.querySelectorAll = () => [vx];
vm.runInContext(declaration('updateVertexInputs') + '\nupdateVertexInputs(0)', context);
assert.equal(Number(vx.value), 12.25, 'drag update preserves decimals');
assert.doesNotMatch(declaration('makeDraggable'), /document\.addEventListener/, 'removed handles must not leave document listeners');
assert.match(declaration('makeDraggable'), /keydown/, 'handles have keyboard editing');
assert.match(declaration('makeDraggable'), /pointercancel/, 'touch cancellation ends dragging');
assert.doesNotMatch(declaration('applyBackground'), /bg\.style\.backgroundImage/, 'background choice changes the clipped element');
assert.match(script, /catch[\s\S]*execCommand/, 'clipboard fallback handles rejected writes');
assert.match(script, /zt:clear/, 'legacy zt:clear listener remains available');
assert.match(declaration('showFrame'), /boxGuides\.hidden = !on/, 'reference-box outlines follow the frame option');
vm.runInContext(declaration('highlight'), context);
assert.doesNotMatch(vm.runInContext('highlight("<img onerror=x>")', context), /<img/, 'raw CSS highlighting escapes user input');
vm.runInContext(source.match(/\/\/ engine:start([\s\S]*?)\/\/ engine:end/)[1], context);
for (const value of ['path("M 0 0 H 10 (")', 'circle(40px at 50% 50%)', 'path("M 20 20 H 180 V 120 H 20 Z")', 'shape(from 50% 0%, line to 100% 100%, line to 0% 100%, close)', 'inset(10% round 16px) content-box', 'content-box', 'none']) {
  assert.equal(context.isLocalValue(value), true);
  const raw = context.cssOutput(value, true);
  assert.equal(raw, '.element {\n  -webkit-clip-path: ' + value + ';\n  clip-path: ' + value + ';\n}');
  const fragment = parseFragment(context.highlight(raw));
  const text = n => n.nodeName === '#text' ? n.value : (n.childNodes || []).map(text).join('');
  assert.equal(text(fragment), raw);
}
for (const value of ['url(https://example.com/x.svg#clip)', 'URL(#clip)', 'circle(50%);color:red', 'circle(var(--r))', '\\75rl(#x)', '<img src=x>', 'inherit', 'circle(v/**/ar(--r))', 'circle(env(safe-area-inset-top))', 'polygon(50% 0%, 100% 100%', 'path("M 0 0 H 10', 'circle(50%))', 'inset(10%) )(']) assert.equal(context.isLocalValue(value), false, value);
// Real listener callbacks, including captured touch pointers and keyboard edits.
const handle = node('interactive');
handle.setPointerCapture = () => {};
context.previewWrap = {querySelector() {return {getBoundingClientRect() {return {width:400,height:200}}}}};
context.update = () => {};
context.updateVertexInputs = () => {};
vm.runInContext(declaration('makeDraggable'), context);
context.makeDraggable(handle, 0);
handle.listeners.keydown({key:'ArrowRight', shiftKey:false, preventDefault(){}});
assert.equal(context.vertices[0].x, 13.25);
handle.listeners.keydown({key:'ArrowDown', shiftKey:true, preventDefault(){}});
assert.equal(context.vertices[0].y, 10);
handle.listeners.pointerdown({button:0, pointerId:1, clientX:100,clientY:50, preventDefault(){}});
handle.listeners.pointermove({clientX:149,clientY:75});
assert.equal(context.vertices[0].x, 25.5);
assert.equal(context.vertices[0].y, 22.5);
assert.equal(handle.style.left, '25.5%');
handle.listeners.pointercancel();
handle.listeners.pointermove({clientX:300,clientY:200});
assert.equal(context.vertices[0].x, 25.5);
handle.listeners.keydown({key:'ArrowLeft',shiftKey:true,preventDefault(){}});
assert.equal(context.vertices[0].x, 15.5);
nodes.get('#cpg-inset-top').value = '80'; nodes.get('#cpg-inset-bottom').value = '60';
context.updateInsetOverlay();
assert.equal(context.insetShape.attrs.height, 0, 'opposite inset offsets scale proportionally');
assert.ok(Math.abs(context.insetShape.attrs.y - 200 * 80 / 140) < 1e-9);
for (let i=1;i<=100;i++) {
  context.previewEl.clientWidth = i*3; context.previewEl.clientHeight=i*7;
  context.currentShape='circle'; context.updateCircleOverlay();
  assert.ok(Math.abs(context.ellipseShape.attrs.rx - Math.hypot(i*3,i*7)/Math.SQRT2/2) < 1e-9);
   assert.ok(Math.abs(context.ellipseShape.attrs.rx - context.ellipseShape.attrs.ry) < 1e-9);
}
console.log('PASS CSS clip-path regression checks');

// Every number and CSS value quoted on the 4 tool pages is recomputed here.
// Pages mark examples with {/* cpg-check: {...} */}; the expected text must also appear in the page.
vm.runInContext(script.match(/var PRESETS = \{[\s\S]*?\};/)[0], context);
const fmt = (n) => String(Math.round(n * 100) / 100);
function setShape(c) {
  context.currentShape = c.shape;
  if (c.vertices) context.vertices = c.vertices.map(([x, y]) => ({ x, y }));
  for (const [k, v] of Object.entries(c.values || {})) nodes.get('#cpg-' + k).value = String(v);
}
function runCheck(c) {
  if (c.kind === 'value') { setShape(c); return vm.runInContext('buildClipPath()', context); }
  if (c.kind === 'css') { setShape(c); return context.cssOutput(vm.runInContext('buildClipPath()', context), !!c.prefix); }
  if (c.kind === 'preset') { context.currentShape = 'polygon'; context.vertices = context.PRESETS[c.name].map((v) => ({ ...v })); return vm.runInContext('buildClipPath()', context); }
  if (c.kind === 'radius') {
    context.currentShape = 'circle'; context.previewEl.clientWidth = c.w; context.previewEl.clientHeight = c.h;
    nodes.get('#cpg-circle-r').value = String(c.r); context.updateCircleOverlay();
    return fmt(context.ellipseShape.attrs.rx) + 'px';
  }
  if (c.kind === 'inset') {
    context.previewEl.clientWidth = c.w; context.previewEl.clientHeight = c.h;
    for (const [k, v] of Object.entries({ top: c.t, right: c.r, bottom: c.b, left: c.l, round: 0 })) nodes.get('#cpg-inset-' + k).value = String(v);
    context.updateInsetOverlay();
    const a = context.insetShape.attrs;
    return [a.y / c.h * 100, 100 - (a.y + a.height) / c.h * 100, a.height].map((n, i) => fmt(n) + (i < 2 ? '%' : 'px')).join(' / ');
  }
  if (c.kind === 'drag' || c.kind === 'keys') {
    context.vertices = [{ x: c.start[0], y: c.start[1] }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    context.previewWrap = { querySelector() { return { getBoundingClientRect() { return { width: c.w || 300, height: c.h || 300 }; } }; } };
    const h = node('check-handle'); h.setPointerCapture = () => {};
    context.makeDraggable(h, 0);
    if (c.kind === 'drag') {
      h.listeners.pointerdown({ button: 0, pointerId: 7, clientX: 0, clientY: 0, preventDefault() {} });
      h.listeners.pointermove({ clientX: c.dx, clientY: c.dy });
      h.listeners.pointerup();
    } else {
      for (const key of c.keys) h.listeners.keydown({ key: key.replace('Shift+', ''), shiftKey: key.startsWith('Shift+'), preventDefault() {} });
    }
    return context.vertices[0].x + '% ' + context.vertices[0].y + '%';
  }
  throw new Error('unknown check kind ' + c.kind);
}
let checks = 0;
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = fs.readFileSync(new URL(`../src/content/tools/css-clip-path-generator/${lang}.mdx`, import.meta.url), 'utf8');
  const found = [...mdx.matchAll(/\{\/\* cpg-check: (\{.*?\}) \*\/\}/g)];
  assert.ok(found.length >= 3, `${lang}.mdx has at least 3 recomputed examples`);
  for (const m of found) {
    const c = JSON.parse(m[1]);
    const got = runCheck(c);
    assert.equal(got, c.expect, `${lang}.mdx ${m[1]}`);
    assert.ok(mdx.includes(c.expect), `${lang}.mdx quotes ${c.expect}`);
    checks++;
  }
}
console.log(`PASS ${checks} tool-page examples recomputed by the component`);


// Real page input/copy events followed by the real ToolLayout Ctrl/Cmd+L handler.
// Only DOM, CSS.supports, storage, time and clipboard are boundary doubles.
function loadClipPage() {
  const elements = [], ids = new Map(), timers = new Map(), clipboard = [];
  const document = { activeElement: null, listeners: {} };
  let sequence = 0;
  function matches(el, selector) {
    return selector.split(',').some(part => {
      const attrs = [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
      const plain = part.trim().replace(/\[[^\]]+\]/g, ''), id = /#([\w-]+)/.exec(plain), tag = /^[\w-]+/.exec(plain);
      return (!id || el.id === id[1]) && (!tag || el.tagName === tag[0].toUpperCase()) &&
        [...plain.matchAll(/\.([\w-]+)/g)].every(c => el.classList.contains(c[1])) &&
        attrs.every(a => a[2] === undefined ? el.getAttribute(a[1]) !== null : el.getAttribute(a[1]) === a[2]);
    });
  }
  class Element {
    constructor(tag = 'div') { Object.assign(this, { tagName: tag.toUpperCase(), id: '', type: tag === 'input' ? 'text' : '', value: '', defaultValue: '', checked: false, disabled: false, style: {}, dataset: {}, attrs: {}, children: [], listeners: {}, className: '', clientWidth: 300, clientHeight: 300, offsetWidth: 300, offsetHeight: 300 }); }
    set textContent(v) { this.text = String(v); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(c => c.textContent).join(''); }
    set innerHTML(v) { const text = n => n.nodeName === '#text' ? n.value : (n.childNodes || []).map(text).join(''); this.textContent = text(parseFragment(String(v))); }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(c) { if (!this.contains(c)) el.className += ' ' + c; }, remove(c) { el.className = el.className.split(/\s+/).filter(x => x !== c).join(' '); }, toggle(c, value) { const on = value ?? !this.contains(c); on ? this.add(c) : this.remove(c); return on; } }; }
    setAttribute(k, v) { this.attrs[k] = String(v); if (['id', 'type', 'min', 'max', 'step'].includes(k)) this[k] = String(v); if (k === 'class') this.className = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
    getAttribute(k) { return k === 'type' ? this.type : this.attrs[k] ?? null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    dispatch(type, init = {}) { for (const fn of this.listeners[type] || []) fn({ type, target: this, preventDefault() {}, ...init }); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { document.activeElement = this; }
    contains(el) { return elements.includes(el); }
    querySelectorAll(selector) { return elements.filter(el => matches(el, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    appendChild(el) { this.children.push(el); return el; }
    append(...children) { this.children.push(...children); }
    remove() {} select() {} setPointerCapture() {}
  }
  const markup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
  for (const match of markup.matchAll(/<([a-z][\w-]*)\b([^>]*?)>/g)) {
    const el = new Element(match[1]);
    for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) { el.setAttribute(attr[1], attr[2]); if (attr[1] === 'value') el.value = el.defaultValue = attr[2]; }
    el.checked = /\bchecked(?=\s|\/|$)/.test(match[2]); elements.push(el); if (el.id) ids.set(el.id, el);
  }
  const wrap = elements.find(el => matches(el, '.cpg-wrap'));
  const get = id => { assert.ok(ids.has(id), 'actual markup contains ' + id); return ids.get(id); };
  const startLabels = source.indexOf('const labels = '), endLabels = source.indexOf('const L = ', startLabels);
  const L = vm.runInNewContext(source.slice(startLabels, endLabels) + '\n({...labels.en, ...extra.en})');
  const store = new Map(), localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
  Object.assign(document, { body: new Element('body'), querySelector: selector => selector === '.tool-widget' ? wrap : wrap.querySelector(selector), createElement: tag => new Element(tag), addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, execCommand: () => false });
  const policy = fs.readFileSync(new URL('../src/data/persistence.ts', import.meta.url), 'utf8').match(/export const toolPersistencePolicy = ([\s\S]*?) as const/)[1];
  const sandbox = { document, L, localStorage, toolPersistencePolicy: vm.runInNewContext('(' + policy + ')'), _slug: 'css-clip-path-generator', console,
    navigator: { clipboard: { writeText: value => { clipboard.push(value); return Promise.resolve(); } } },
    CSS: { supports: (property, value) => property === 'clip-path' && /^(polygon|circle|ellipse|inset)\(/.test(value) },
    ResizeObserver: class { observe() {} }, setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox), layout = fs.readFileSync(new URL('../src/layouts/ToolLayout.astro', import.meta.url), 'utf8');
  vm.runInContext(layout.match(/<script is:inline define:vars=\{\{ toolPersistencePolicy \}\}>([\s\S]*?)<\/script>/)[1], ctx);
  vm.runInContext(script, ctx);
  const start = layout.indexOf("document.addEventListener('keydown'", layout.indexOf('// ── Keyboard shortcuts:'));
  vm.runInContext(layout.slice(start, layout.indexOf('// ── Copy button visual feedback', start)), ctx);
  return { get, wrap, document, clipboard,
    type(value) { const el = get('cpg-raw'); el.value = value; el.dispatch('input'); },
    key(init) { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init }; for (const fn of document.listeners.keydown) fn(event); for (const [id, timer] of [...timers]) if (timer.ms === 0) { timers.delete(id); timer.fn(); } return event; }
  };
}
let pagePasses = 0, pageFailures = 0;
function pageCheck(name, ok) { if (ok) pagePasses++; else { pageFailures++; console.error('FAIL ' + name); } }
for (const modifier of ['ctrlKey', 'metaKey']) {
  const page = loadClipPage();
  page.wrap.querySelector('.cpg-tab[data-shape="raw"]').click();
  page.type('circle(30% at 40% 60%)');
  const old = '.element {\n  clip-path: circle(30% at 40% 60%);\n}';
  pageCheck(modifier + ' input generates complete CSS', page.get('cpg-code').textContent === old);
  page.get('cpg-copy').click(); await Promise.resolve();
  pageCheck(modifier + ' copy reads current CSS', page.clipboard.at(-1) === old);
  page.document.activeElement = page.document.body;
  const outside = page.key({ [modifier]: true, key: 'l' });
  pageCheck(modifier + ' outside focus keeps raw value and result', !outside.defaultPrevented && page.get('cpg-raw').value === 'circle(30% at 40% 60%)' && page.get('cpg-code').textContent === old);
  page.get('cpg-raw').focus();
  page.key({ key: 'l' });
  pageCheck(modifier + ' plain L leaves result unchanged', page.get('cpg-code').textContent === old);
  const event = page.key({ [modifier]: true, key: modifier === 'ctrlKey' ? 'l' : 'L' });
  pageCheck(modifier + ' real global shortcut clears raw input', event.defaultPrevented && page.get('cpg-raw').value === '');
  pageCheck(modifier + ' cleared input removes old CSS', page.get('cpg-code').textContent === '');
  pageCheck(modifier + ' cleared input removes old preview', page.get('cpg-preview-el').style.clipPath === '');
  pageCheck(modifier + ' cleared input disables copy', page.get('cpg-copy').disabled);
  const count = page.clipboard.length; page.get('cpg-copy').click(); await Promise.resolve();
  pageCheck(modifier + ' clear prevents copying old result', page.clipboard.length === count);
  page.type('circle(20% at 50% 50%)');
  pageCheck(modifier + ' new input restores current result', !page.get('cpg-copy').disabled && page.get('cpg-preview-el').style.clipPath === 'circle(20% at 50% 50%)');
  page.get('cpg-reset').click();
  pageCheck(modifier + ' explicit Reset still restores raw triangle', page.get('cpg-raw').value === 'polygon(50% 0%, 100% 100%, 0% 100%)' && !page.get('cpg-copy').disabled);
}
console.log(`${pagePasses} page checks passed, ${pageFailures} failed`);
process.exitCode = pageFailures ? 1 : 0;
