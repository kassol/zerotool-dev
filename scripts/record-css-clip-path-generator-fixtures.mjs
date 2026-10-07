// Browser side of the css-clip-path-generator fixture (scripts/test-css-clip-path-generator.fixtures.json).
// Not a test (no `test-` prefix). Run it inside a browser page; it reads the corpus printed by
// `node scripts/test-css-clip-path-generator.mjs --corpus` and returns the fixture object.
// The recording used Ego Chromium through ego-browser (page.evaluate(recordClipPathFixture, corpus)).
//
// For each visual value: CSS.supports('clip-path', v), getComputedStyle(box).clipPath on a
// 400 × 200 box at (10, 10), and an elementsFromPoint hit test for every grid point (1 = the
// box receives the point, so it is inside the clip area). For each raw value: whether a real
// <style> sheet keeps the declaration and still parses the rule that follows it.
export function recordClipPathFixture(corpus) {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:10px;top:10px;width:' + corpus.w + 'px;height:' + corpus.h + 'px;background:#c00;margin:0;padding:0;border:0;z-index:2147483647';
  document.body.appendChild(box);
  const visual = corpus.visual.map(({ id, value }) => {
    box.style.clipPath = '';
    box.style.clipPath = value;
    const computed = getComputedStyle(box).clipPath;
    const hits = corpus.grid.map(([x, y]) => (document.elementsFromPoint(10 + x, 10 + y).includes(box) ? '1' : '0')).join('');
    return { id, value, supports: CSS.supports('clip-path', value), computed, hits };
  });
  box.remove();
  const raw = corpus.raw.map((value) => {
    const style = document.createElement('style');
    style.textContent = '.a { clip-path: ' + value + '; }\n.b { color: red; }';
    document.head.appendChild(style);
    const rules = [...style.sheet.cssRules];
    const a = rules.find((r) => r.selectorText === '.a');
    const b = rules.find((r) => r.selectorText === '.b');
    style.remove();
    return { value, supports: CSS.supports('clip-path', value), sheetKeeps: !!(a && a.style.clipPath), nextRuleIntact: !!(b && b.style.color === 'red') };
  });
  return { recorded: new Date().toISOString().slice(0, 10), userAgent: navigator.userAgent, w: corpus.w, h: corpus.h, visual, raw };
}
