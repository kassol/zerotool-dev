// Read the component, its tool pages, ToolLayout, persistence policy and
// scripts/test-css-clip-path-generator.fixtures.json (Chrome 152 results); write only stdout.
// Run real functions and complete page scripts. No browser or network is used at test time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parseFragment } from 'parse5';
import yaml from 'js-yaml';
import { createRequire } from 'node:module';
const { transform } = createRequire(import.meta.resolve('astro/package.json'))('@astrojs/compiler');
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

// ---------- Independent check: Chrome reads the generated clip-path ----------
// The corpus below is built with the page's own buildClipPath / overlay functions from a seeded
// random generator. scripts/test-css-clip-path-generator.fixtures.json holds what Chrome 152 did
// with each value (recorded in Ego Chromium with getComputedStyle, CSS.supports, a real <style>
// sheet and elementsFromPoint hit tests on a 400 × 200 box; see scripts/AGENTS.md for the
// recording steps). This test checks, without a browser:
//   1. every value the visual editor writes is accepted by Chrome (computed value is not "none"),
//      and Chrome's computed numbers are the generated numbers (inset shorthand expanded);
//   2. the area Chrome clips (hit test grid) is the area the preview overlay draws, away from
//      the edge (points within 1.5 px of the overlay outline are not compared);
//   3. raw CSS mode accepts a value only when Chrome's stylesheet parser keeps it and keeps the
//      next rule, and rejects the rest (url(), var() and env() are rejected on purpose).
// Node has no CSS engine to use instead: css-tree 3.2.1 (installed for svgo) rejects the valid
// circle(50% at 50% 50%) because its <radial-size> has no percentage.
// Run with --corpus to print the corpus for a new recording.
const W = 400, H = 200;
const GRID = [];
for (let y = 5; y < H; y += 15) for (let x = 5; x < W; x += 15) GRID.push([x, y]);
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(20261007);
const pick = (max, dp) => String(Math.round(rnd() * max * 10 ** dp) / 10 ** dp);
function overlayFor(shape) {
  context.previewEl.clientWidth = W; context.previewEl.clientHeight = H;
  context.currentShape = shape;
  if (shape === 'polygon') { vm.runInContext('renderPolyShape()', context); return { points: context.polyShape.attrs.points.split(' ').map((p) => p.split(',').map(Number)) }; }
  if (shape === 'inset') { context.updateInsetOverlay(); const a = context.insetShape.attrs; return { x: a.x, y: a.y, w: a.width, h: a.height, rx: a.rx, ry: a.ry }; }
  context.updateCircleOverlay(); const a = context.ellipseShape.attrs; return { cx: a.cx, cy: a.cy, rx: a.rx, ry: a.ry };
}
const corpus = [];
for (const name of Object.keys(context.PRESETS)) {
  context.vertices = context.PRESETS[name].map((v) => ({ ...v }));
  context.currentShape = 'polygon';
  corpus.push({ id: 'preset-' + name, shape: 'polygon', value: vm.runInContext('buildClipPath()', context), overlay: overlayFor('polygon') });
}
for (let i = 0; i < 40; i++) {
  const n = 3 + Math.floor(rnd() * 8);
  context.vertices = Array.from({ length: n }, () => ({ x: Number(pick(100, 2)), y: Number(pick(100, 2)) }));
  context.currentShape = 'polygon';
  corpus.push({ id: 'polygon-' + i, shape: 'polygon', value: vm.runInContext('buildClipPath()', context), overlay: overlayFor('polygon') });
}
for (let i = 0; i < 30; i++) {
  for (const [k, max] of [['circle-r', 80], ['circle-cx', 100], ['circle-cy', 100]]) nodes.get('#cpg-' + k).value = pick(max, i % 3);
  context.currentShape = 'circle';
  corpus.push({ id: 'circle-' + i, shape: 'circle', value: vm.runInContext('buildClipPath()', context), overlay: overlayFor('circle') });
}
for (let i = 0; i < 30; i++) {
  for (const [k, max] of [['ellipse-rx', 80], ['ellipse-ry', 80], ['ellipse-cx', 100], ['ellipse-cy', 100]]) nodes.get('#cpg-' + k).value = pick(max, i % 3);
  context.currentShape = 'ellipse';
  corpus.push({ id: 'ellipse-' + i, shape: 'ellipse', value: vm.runInContext('buildClipPath()', context), overlay: overlayFor('ellipse') });
}
for (let i = 0; i < 40; i++) {
  // Every fourth case lets opposite offsets add up to more than 100% (CSS Shapes: scaled down).
  const big = i % 4 === 3 ? 100 : 48;
  for (const k of ['top', 'right', 'bottom', 'left']) nodes.get('#cpg-inset-' + k).value = pick(big, i % 3);
  nodes.get('#cpg-inset-round').value = i % 5 === 0 ? '0' : pick(50, i % 2);
  context.currentShape = 'inset';
  corpus.push({ id: 'inset-' + i, shape: 'inset', value: vm.runInContext('buildClipPath()', context), overlay: overlayFor('inset') });
}
const RAW = ['polygon(50% 0%, 100% 100%, 0% 100%)', 'circle(40px at 50% 50%)', 'ellipse(30% 20%)', 'inset(10% round 16px) content-box', 'path("M 20 20 H 180 V 120 H 20 Z")',
  'shape(from 50% 0%, line to 100% 100%, line to 0% 100%, close)', 'xywh(10px 10px 50% 50% round 8px)', 'rect(10px 90% 90% 10px)', 'content-box', 'none', 'circle(50%) border-box',
  'polygon(50% 0%, 100% 100%', 'circle(abc)', 'polygon(0 0', 'circle(50%))', 'inset(10%) )(', 'path("M 0 0 H 10', 'circle(50%);color:red', 'foo', 'polygon(0 0, 100% 0, 50%)',
  'url(#clip)', 'circle(var(--r))', 'circle(env(safe-area-inset-top))', '\\75rl(#x)', 'circle(v/**/ar(--r))', 'inherit', 'ellipse(10% 20% 30%)', 'inset(-10%)', 'circle(-5%)'];
if (process.argv.includes('--corpus')) {
  console.log(JSON.stringify({ w: W, h: H, grid: GRID, visual: corpus.map(({ id, value }) => ({ id, value })), raw: RAW }));
  process.exit(0);
}
const fixture = JSON.parse(fs.readFileSync(new URL('./test-css-clip-path-generator.fixtures.json', import.meta.url), 'utf8'));
assert.equal(fixture.visual.length, corpus.length, 'fixture covers the whole corpus (re-record after changing it)');
const nums = (s) => (String(s).match(/-?\d*\.?\d+(?:e-?\d+)?/g) || []).map(Number);
function expectedNumbers(c) {
  const v = nums(c.value);
  if (c.shape !== 'inset') return v;
  return v; // inset(t r b l [round r]) as written by the tool
}
function chromeNumbers(c, computed) {
  const v = nums(computed);
  if (c.shape !== 'inset') return v;
  // Chrome serializes the shortest inset form: expand 1–4 offsets back to t r b l.
  const roundAt = computed.indexOf(' round ');
  const off = nums(roundAt >= 0 ? computed.slice(0, roundAt) : computed);
  const t = off[0], r = off[1] ?? t, b = off[2] ?? t, l = off[3] ?? r;
  const radius = roundAt >= 0 ? nums(computed.slice(roundAt)) : [];
  return [t, r, b, l, ...radius.slice(0, 1)];
}
function insideOverlay(c, x, y) {
  const o = c.overlay;
  if (c.shape === 'polygon') {
    let wn = 0; const p = o.points;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
      const cross = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
      if (y1 <= y) { if (y2 > y && cross > 0) wn++; } else if (y2 <= y && cross < 0) wn--;
    }
    return wn !== 0;
  }
  if (c.shape === 'inset') {
    if (x < o.x || x > o.x + o.w || y < o.y || y > o.y + o.h) return false;
    if (!o.rx || !o.ry) return true;
    const cx = x < o.x + o.rx ? o.x + o.rx : x > o.x + o.w - o.rx ? o.x + o.w - o.rx : x;
    const cy = y < o.y + o.ry ? o.y + o.ry : y > o.y + o.h - o.ry ? o.y + o.h - o.ry : y;
    return ((x - cx) / o.rx) ** 2 + ((y - cy) / o.ry) ** 2 <= 1;
  }
  if (!o.rx || !o.ry) return false;
  return ((x - o.cx) / o.rx) ** 2 + ((y - o.cy) / o.ry) ** 2 <= 1;
}
let compared = 0, skippedEdge = 0;
for (let i = 0; i < corpus.length; i++) {
  const c = corpus[i], f = fixture.visual[i];
  assert.equal(f.value, c.value, `fixture ${c.id} was recorded for the value the page writes now`);
  assert.ok(f.supports && f.computed && f.computed !== 'none', `${c.id}: Chrome accepts ${c.value}`);
  assert.deepEqual(chromeNumbers(c, f.computed), expectedNumbers(c), `${c.id}: Chrome reads ${c.value} as ${f.computed}`);
  GRID.forEach(([x, y], k) => {
    const model = insideOverlay(c, x, y);
    const stable = [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5], [0, 1.5], [0, -1.5], [1.5, 0], [-1.5, 0]].every(([dx, dy]) => insideOverlay(c, x + dx, y + dy) === model);
    if (!stable) { skippedEdge++; return; }
    compared++;
    assert.equal(f.hits[k] === '1', model, `${c.id}: point (${x}, ${y}) is ${model ? 'inside' : 'outside'} the preview outline, but Chrome ${f.hits[k] === '1' ? 'shows' : 'clips'} it (${c.value})`);
  });
}
assert.ok(compared > 20000, 'enough hit-test points compared: ' + compared);
console.log(`PASS ${corpus.length} generated values: Chrome accepts each one with the same numbers; ${compared} hit-test points match the preview outline (${skippedEdge} edge points skipped)`);
assert.deepEqual(fixture.raw.map((r) => r.value), RAW, 'raw fixture covers the raw corpus');
let rawChecked = 0;
for (const r of fixture.raw) {
  const tool = context.isLocalValue(r.value) && r.supports;
  if (tool) assert.ok(r.sheetKeeps && r.nextRuleIntact, `raw: the tool accepts ${r.value}, so Chrome's stylesheet parser must keep it and the next rule`);
  else assert.ok(!(r.sheetKeeps && r.nextRuleIntact) || /url\s*\(|var\s*\(|env\s*\(|\\|\/\*|;/i.test(r.value) || r.value === 'inherit',
    `raw: the tool rejects ${r.value}, which Chrome keeps; only url(), var(), env(), escapes, comments, a ";" that ends the declaration and inherit are rejected on purpose`);
  rawChecked++;
}
console.log(`PASS ${rawChecked} raw CSS values: the tool's verdict matches Chrome's stylesheet parser`);


// Real page input/copy events followed by the real ToolLayout Ctrl/Cmd+L handler.
// Only DOM, CSS.supports, storage, time and clipboard are boundary doubles.
function loadClipPage(lang = 'en', supports = null) {
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
  const L = vm.runInNewContext(source.slice(startLabels, endLabels) + '\n({...labels[' + JSON.stringify(lang) + '], ...extra[' + JSON.stringify(lang) + ']})');
  const store = new Map(), localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i] ?? null, get length() { return store.size; } };
  Object.assign(document, { body: new Element('body'), querySelector: selector => selector === '.tool-widget' ? wrap : wrap.querySelector(selector), createElement: tag => new Element(tag), addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, execCommand: () => false });
  const policy = fs.readFileSync(new URL('../src/data/persistence.ts', import.meta.url), 'utf8').match(/export const toolPersistencePolicy = ([\s\S]*?) as const/)[1];
  const sandbox = { document, L, localStorage, toolPersistencePolicy: vm.runInNewContext('(' + policy + ')'), _slug: 'css-clip-path-generator', console,
    navigator: { clipboard: { writeText: value => { clipboard.push(value); return Promise.resolve(); } } },
    CSS: { supports: supports || ((property, value) => property === 'clip-path' && /^(polygon|circle|ellipse|inset)\(/.test(value)) },
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
// ---------- CSS value errors name the cause (2026-10-08, W2) ----------
// Before: every refused value got one sentence ("Invalid or unsupported clip-path value in this
// browser."), and unknown words got the "needs a page context" sentence. The diagnose block runs
// only after CSS.supports() or the engine has refused the value; checked against the Chrome
// verdicts recorded in the fixture: no value Chrome keeps gets an error, and the refused ones get
// the cause and position.
{
  const a = script.indexOf('/* diagnose:start'), b = script.indexOf('/* diagnose:end */');
  pageCheck('diagnose block present', a > 0 && b > a);
  const D = a > 0 && b > a ? vm.runInNewContext(script.slice(a, b) + '\n({ diagnoseClipPath, diagnoseText })') : { diagnoseClipPath: () => 'missing', diagnoseText: () => null };
  const chromeKeeps = (r) => r.sheetKeeps && r.nextRuleIntact;
  const pageRefuses = /url\s*\(|var\s*\(|env\s*\(|\\|\/\*|;|^inherit$/i;
  for (const r of fixture.raw) if (chromeKeeps(r) && !pageRefuses.test(r.value)) pageCheck('no error for a value Chrome keeps: ' + r.value, D.diagnoseClipPath(r.value) === null);
  for (const c of corpus) pageCheck('no error for generated value ' + c.id, D.diagnoseClipPath(c.value) === null);
  const want = [
    // [value, code, args] — the first group is the fixture's refused values.
    ['polygon(50% 0%, 100% 100%', 'unclosedParen', { fn: 'polygon', pos: 1 }],
    ['circle(abc)', 'badValue', { fn: 'circle', token: 'abc' }],
    ['polygon(0 0', 'unclosedParen', { fn: 'polygon', pos: 1 }],
    ['circle(50%))', 'extraParen', { pos: 12 }],
    ['inset(10%) )(', 'extraParen', { pos: 12 }],
    ['path("M 0 0 H 10', 'unclosedQuote', { pos: 6 }],
    ['foo', 'unknownWord', { word: 'foo' }],
    ['polygon(0 0, 100% 0, 50%)', 'pointCount', { n: 3, got: 1 }],
    ['ellipse(10% 20% 30%)', 'argCount', { fn: 'ellipse', want: 'want_rr', got: 3 }],
    ['circle(-5%)', 'negative', { fn: 'circle', token: '-5%' }],
    // Typical mistakes outside the fixture.
    ['polgon(50% 0%, 100% 100%, 0% 100%)', 'unknownFn', { name: 'polgon', pos: 1 }],
    ['circle(50 at 50% 50%)', 'unitless', { token: '50' }],
    ['inset(10pz)', 'badUnit', { token: '10pz', unit: 'pz' }],
    ['circle(50% at middle)', 'badPosition', { fn: 'circle', token: 'middle' }],
    ['circle(50%) border-box content-box', 'twoParts', { word: 'content-box' }],
    ['none border-box', 'noneAlone', {}],
    ['polygon()', 'noPoints', {}],
    ['xywh(0 0 -10px 10px)', 'negative', { fn: 'xywh', token: '-10px' }],
    ['circle(calc(50% - 4px) at 50% 50%', 'unclosedParen', { fn: 'circle', pos: 1 }],
    ['inset(0 0 0 0 0)', 'argCount', { fn: 'inset', want: 'want_inset', got: 5 }],
  ];
  for (const [value, code, args] of want) {
    const r = fixture.raw.find((x) => x.value === value);
    if (r) pageCheck('fixture: Chrome refuses ' + value, !chromeKeeps(r));
    const d = D.diagnoseClipPath(value);
    pageCheck('diagnose ' + value + ' → ' + code, !!d && d.code === code && JSON.stringify(d.args) === JSON.stringify(args));
  }
  pageCheck('a typo gets a suggestion', (D.diagnoseClipPath('polgon(0 0)') || {}).hint === 'polygon');
  // Real page, four languages: the status line gives the localized cause, the old CSS goes.
  const accepted = new Map(fixture.raw.map((r) => [r.value, chromeKeeps(r) && r.supports]));
  const supports = (prop, value) => prop === 'clip-path' && (accepted.has(value) ? accepted.get(value) : D.diagnoseClipPath(value) === null);
  const expect = {
    en: ['Character 12: “)” has no matching “(”.', 'polygon() point 3 has 1 value(s). Each point is “x y”; separate points with commas.', 'Character 1: polgon() is not a clip-path shape. Use polygon(), circle(), ellipse(), inset(), rect(), xywh(), path() or shape(). Did you mean polygon()?'],
    zh: ['第 12 个字符：「)」没有对应的「(」。', 'polygon() 第 3 个点有 1 个值。每个点写成「x y」，点与点之间用逗号分隔。', '第 1 个字符：polgon() 不是 clip-path 形状。可用 polygon()、circle()、ellipse()、inset()、rect()、xywh()、path() 或 shape()。是不是 polygon()？'],
    ja: ['12 文字目：「)」に対応する「(」がありません。', 'polygon() の 3 番目の点に値が 1 個あります。点は「x y」で書き、点と点はカンマで区切ります。', '1 文字目：polgon() は clip-path の図形ではありません。polygon()、circle()、ellipse()、inset()、rect()、xywh()、path()、shape() を使ってください。polygon() のことですか？'],
    ko: ['12번째 문자: 「)」에 맞는 「(」가 없습니다.', 'polygon()의 3번째 점에 값이 1개 있습니다. 점은 「x y」로 쓰고 점 사이는 쉼표로 구분합니다.', '1번째 문자: polgon()은(는) clip-path 도형이 아닙니다. polygon(), circle(), ellipse(), inset(), rect(), xywh(), path(), shape()를 쓰세요. polygon()을(를) 쓰려던 것인가요?'],
  };
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const page = loadClipPage(lang, supports);
    page.wrap.querySelector('.cpg-tab[data-shape="raw"]').click();
    ['circle(50%))', 'polygon(0 0, 100% 0, 50%)', 'polgon(50% 0%, 100% 100%, 0% 100%)'].forEach((value, k) => {
      page.type('circle(30% at 40% 60%)');
      const okBefore = page.get('cpg-code').textContent !== '' && !page.get('cpg-copy').disabled;
      page.type(value);
      pageCheck(lang + ' page: ' + value + ' gives the cause', okBefore && page.get('cpg-status').textContent === expect[lang][k] && page.get('cpg-code').textContent === '' && page.get('cpg-copy').disabled);
    });
    page.type('url(#clip)');
    const L2 = vm.runInNewContext(source.slice(source.indexOf('const labels = '), source.indexOf('const L = ')) + '\n({...labels[' + JSON.stringify(lang) + '], ...extra[' + JSON.stringify(lang) + ']})');
    pageCheck(lang + ' page: url() keeps the page-context message', page.get('cpg-status').textContent === L2.localOnly);
    // The tool page quotes the first message and the start of the second as the page gives them.
    const mdx = fs.readFileSync(new URL(`../src/content/tools/css-clip-path-generator/${lang}.mdx`, import.meta.url), 'utf8');
    const second = expect[lang][1].slice(0, expect[lang][1].search(/[.。] ?/) + 1);
    pageCheck(lang + ' mdx quotes the page messages', mdx.includes(expect[lang][0]) && mdx.includes(second) && /polgon\(\)/.test(mdx));
  }
}
// ---------- v2 page layout ----------
const pageMarkup = source.slice(source.indexOf('\n---', 4) + 4, source.indexOf('<script'));
const layoutStyles = source.match(/<style>([\s\S]*?)<\/style>/)[1];
const tipStrings = JSON.parse(source.match(/const STRINGS = ([\s\S]*?);\nconst L =/)[1]);
const tipIds = [...pageMarkup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m => m[1]);
pageCheck('v2 generate registry', /'css-clip-path-generator':\s*'generate'/.test(fs.readFileSync(new URL('../src/data/tool-layouts.ts', import.meta.url), 'utf8')));
pageCheck('v2 direct root and shared rail', /^\s*<div\s+class="cpg-wrap"/.test(pageMarkup) && /class="cpg-rail zt-rail"/.test(pageMarkup));
pageCheck('v2 controls precede preview', pageMarkup.indexOf('id="cpg-raw"') < pageMarkup.indexOf('id="cpg-preview-bg"'));
pageCheck('v2 existing primary operations stay available', /id="cpg-copy"/.test(pageMarkup) && /id="cpg-reset"/.test(pageMarkup) && !/btn-primary/.test(pageMarkup));
pageCheck('v2 fixed scrollable keyboard-accessible code', /<pre[^>]*id="cpg-pre"[^>]*tabindex="0"[^>]*role="region"/.test(pageMarkup) && /\.cpg-pre\s*\{[^}]*height:\s*11rem;[^}]*overflow:\s*auto/s.test(layoutStyles));
pageCheck('v2 rail and preview have bounded flexible space', /grid-template-columns:\s*clamp\(270px, 26vw, 320px\) minmax\(0, 1fr\)/.test(layoutStyles) && /\.cpg-wrap\s*\{[^}]*min-height:\s*0/.test(layoutStyles));
pageCheck('v2 preview adapts to both available dimensions', /container-type:\s*size/.test(layoutStyles) && /100cqw/.test(layoutStyles) && /100cqh/.test(layoutStyles) && /option\[value="2"\]:checked/.test(layoutStyles) && /option\[value="0.5"\]:checked/.test(layoutStyles));
pageCheck('v2 860 stacking and 640 touch targets', /max-width:\s*860px/.test(layoutStyles) && /max-width:\s*640px/.test(layoutStyles) && /\.cpg-controls-col\s*\{[^}]*height:\s*10.5rem/.test(layoutStyles) && /\.cpg-tab\s*\{[^}]*min-height:\s*44px/.test(layoutStyles));
pageCheck('v2 tips stay out of runtime strings', /define:vars=\{\{ L \}\}/.test(source) && !/TIPS|STRINGS/.test(script) && /const L = \{ \.\.\.labels\[lang\], \.\.\.extra\[lang\] \};/.test(source));
pageCheck('v2 tip IDs are unique', tipIds.length === 10 && new Set(tipIds).size === tipIds.length);
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const tips = tipStrings[lang].tips;
  pageCheck(lang + ' v2 same eight nonempty tip facts', Object.keys(tips).join('|') === 'shape|vertices|geometry|raw|preview|reference|copy|reset' && Object.values(tips).every(t => typeof t === 'string' && t.trim().length > 0));
  const mdx = fs.readFileSync(new URL(`../src/content/tools/css-clip-path-generator/${lang}.mdx`, import.meta.url), 'utf8');
  const meta = yaml.load(mdx.match(/^---\n([\s\S]*?)\n---/)[1]);
  pageCheck(lang + ' v2 five bounded steps', meta.steps.length === 5 && meta.steps.every(s => typeof s === 'string' && s.length <= 280) && meta.steps.join('').length <= 1200);
  pageCheck(lang + ' v2 FAQ SEO limits and checked examples remain', meta.faqItems.length >= 4 && !!meta.seoTitle && !!meta.seoDescription && /cpg-check:/.test(mdx) && /^## (Limits|动画与限制|制限事項|애니메이션과 제한 사항)$/m.test(mdx));
  pageCheck(lang + ' v2 HowTo removed and resize example conditional', !/^## (How to use|三步生成 clip-path|使い方|사용 방법)$/m.test(mdx) && !/300px desktop|桌面端 300px|デスクトップの 300px|데스크톱의 300px/.test(mdx));
}
const compiled = await transform(source, { filename: 'CssClipPathGeneratorTool.astro' });
pageCheck('v2 Astro compiles and resolves CSS scoping', !compiled.diagnostics.some(d => d.severity === 1) && compiled.css.length > 0 && compiled.css.every(css => !css.includes(':global(')));

console.log(`${pagePasses} page checks passed, ${pageFailures} failed`);
process.exitCode = pageFailures ? 1 : 0;
