// Read the component's real functions; write only stdout. No browser is launched.
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
assert.match(script, /zt:clear/, 'site clear resets tool state');
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
