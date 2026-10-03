// Read: JsonlConverterTool.astro's complete inline script. Write: stdout only.
// Drive the shipped click/input/download handlers with DOM substitutes; no mirrored converter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/components/tools/JsonlConverterTool.astro', import.meta.url), 'utf8');
let passed = 0, failed = 0;
async function test(name, run) {
  try { await run(); passed++; }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}
function page(lang = 'en') {
  const elements = new Map(), copied = [], downloads = [], timers = new Map(), readers = [], docEvents = {};
  let timerId = 0;
  function element() {
    const events = {};
    return { value: '', checked: false, disabled: false, textContent: '', children: [],
      classList: { toggle() {} }, addEventListener(k, fn) { events[k] = fn; },
      fire(k, ev = {}) { return events[k]?.(ev); }, click() { if (!this.disabled) { if (this.download) downloads.push(this.href); return this.fire('click'); } },
      appendChild(child) { this.children.push(child); }, remove() {} };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  get('jlc-ignore-empty').checked = get('jlc-pretty-json').checked = true;
  vm.runInNewContext(source.match(/<script is:inline>([\s\S]*?)<\/script>/)[1], {
    document: { documentElement: { lang }, getElementById: get, querySelectorAll: () => [], createElement: element, body: element(), addEventListener(k, fn) { docEvents[k] = fn; } },
    window: {}, navigator: { clipboard: { writeText: async text => copied.push(text) } }, Blob,
    URL: { createObjectURL: blob => blob, revokeObjectURL() {} },
    FileReader: class { constructor() { readers.push(this); } readAsText(file) { this.file = file; }
      finish(text) { this.result = text; this.onload(); } fail() { this.onerror(); } },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id)
  });
  return { get, copied, downloads, readers, docKey(ev) { docEvents.keydown?.(ev); }, open(target) { get('jlc-open-' + target).click(); get('jlc-file').files = [{ name: 'sample.txt' }]; get('jlc-file').fire('change'); return readers.at(-1); },
    flush() { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()); } };
}
const records = ['9007199254740991', '9007199254740992', '9007199254740993', '1e400', '-0', '1.00', '1E+03', '1e-400', '{"n":9007199254740993,"a":[-0,1e400],"s":"1e400"}'];
for (const raw of records) {
  await test('JSONL → JSON preserves ' + raw, () => {
    const p = page(); p.get('jlc-pretty-json').checked = false;
    p.get('jlc-jsonl').value = raw; p.get('jlc-to-json').click();
    assert.equal(p.get('jlc-json').value, '[' + raw + ']');
  });
  await test('JSON → JSONL preserves ' + raw, () => {
    const p = page(); p.get('jlc-json').value = '[' + raw + ']'; p.get('jlc-to-jsonl').click();
    assert.equal(p.get('jlc-jsonl').value, raw);
  });
}
await test('duplicate keys keep the last value at every depth', () => {
  const p = page(); p.get('jlc-json').value = '[{"n":1,"n":1e400,"a":{"x":2,"x":-0},"__proto__":3}]';
  p.get('jlc-to-jsonl').click(); assert.equal(p.get('jlc-jsonl').value, '{"n":1e400,"a":{"x":-0},"__proto__":3}');
});
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  await test(lang + ' multi-line error clears old JSON and blocks copy/download', async () => {
    const p = page(lang); p.get('jlc-jsonl').value = '{"ok":1}'; p.get('jlc-to-json').click();
    p.get('jlc-jsonl').value = '9007199254740993\n{"bad":}\n1e400'; p.get('jlc-to-json').click();
    assert.equal(p.get('jlc-json').value, ''); assert.equal(p.get('jlc-copy-json').disabled, true);
    assert.equal(p.get('jlc-download-json').disabled, true); assert.equal(p.get('jlc-error-lines').textContent, '1');
    assert.match(JSON.stringify(p.get('jlc-issues-list').children.at(-1)), /2/);
    p.get('jlc-copy-json').click(); p.get('jlc-download-json').click();
    assert.equal(p.copied.length, 0); assert.equal(p.downloads.length, 0);
  });
  await test(lang + ' invalid/non-array/empty JSON clears old JSONL', () => {
    for (const raw of ['[1,]', '{}', '']) {
      const p = page(lang); p.get('jlc-json').value = '[1]'; p.get('jlc-to-jsonl').click();
      p.get('jlc-json').value = raw; p.get('jlc-to-jsonl').click();
      assert.equal(p.get('jlc-jsonl').value, ''); assert.equal(p.get('jlc-copy-jsonl').disabled, true);
      assert.equal(p.get('jlc-download-jsonl').disabled, true);
    }
  });
}
await test('valid-only is explicit and preserves numbers on download', async () => {
  const p = page(); p.get('jlc-jsonl').value = '9007199254740993\n{bad}\n1e400';
  p.get('jlc-download-jsonl').click(); assert.equal(p.downloads.length, 0);
  p.get('jlc-valid-only').checked = true; p.get('jlc-to-json').click();
  p.get('jlc-download-jsonl').click(); assert.equal(await p.downloads.at(-1).text(), '9007199254740993\n1e400');
});
await test('pretty output keeps numbers, escapes, empty containers and scalar records', () => {
  const p = page(); p.get('jlc-jsonl').value = '{"n":1e400,"s":"a\\nb"}\n[]\n{}\nnull\ntrue'; p.get('jlc-to-json').click();
  assert.equal(p.get('jlc-json').value, '[\n  {\n    "n": 1e400,\n    "s": "a\\nb"\n  },\n  [],\n  {},\n  null,\n  true\n]');
});
await test('editing either input invalidates the opposite output immediately', () => {
  const p = page(); p.get('jlc-jsonl').value = '1'; p.get('jlc-to-json').click();
  p.get('jlc-jsonl').value = '{'; p.get('jlc-jsonl').fire('input');
  assert.equal(p.get('jlc-json').value, '');
  p.get('jlc-json').value = '[1]'; p.get('jlc-to-jsonl').click(); p.get('jlc-json').fire('input');
  assert.equal(p.get('jlc-jsonl').value, '');
});
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  await test(lang + ' invalid file keeps the conversion error', () => {
    for (const target of ['json', 'jsonl']) { const p = page(lang); p.open(target).finish('{bad}');
      assert.match(p.get('jlc-status').className, /error/); assert.equal(p.get('jlc-copy-json').disabled, true); }
  });
  await test(lang + ' read failure invalidates both successful outputs', () => {
    const p = page(lang); p.get('jlc-jsonl').value = '1'; p.get('jlc-to-json').click(); p.open('json').fail();
    p.get('jlc-copy-json').click(); p.get('jlc-download-jsonl').click();
    assert.equal(p.copied.length, 0); assert.equal(p.downloads.length, 0); assert.match(p.get('jlc-status').className, /error/);
  });
}
await test('a later file selection wins and retains its captured target', () => {
  const p = page(); const first = p.open('json'); const last = p.open('jsonl'); last.finish('2'); first.finish('[1]');
  assert.equal(p.get('jlc-jsonl').value, '2'); assert.equal(p.get('jlc-json').value, '');
});
await test('editing, clearing and converting invalidate pending file callbacks', () => {
  for (const action of ['input', 'clear', 'convert']) { const p = page(); const reader = p.open('json');
    p.get('jlc-jsonl').value = '3';
    if (action === 'input') p.get('jlc-jsonl').fire('input');
    if (action === 'clear') p.get('jlc-clear').click();
    if (action === 'convert') p.get('jlc-to-json').click();
    const before = p.get('jlc-json').value; reader.finish('[1]'); assert.equal(p.get('jlc-json').value, before);
  }
});
await test('pending validation cannot clear an explicit valid-only output', () => {
  const p = page(); p.get('jlc-jsonl').value = '1\n{bad}'; p.get('jlc-jsonl').fire('input');
  p.get('jlc-valid-only').checked = true; p.get('jlc-to-json').click(); p.flush();
  assert.equal(p.get('jlc-json').value, '[\n  1\n]'); assert.equal(p.get('jlc-download-json').disabled, false);
});
// ToolLayout's document keydown clicks the first .btn-primary (JSONL → JSON) on Ctrl/Cmd+Enter
// and empties the text fields on Ctrl/Cmd+L without input events.
await test('panel Ctrl+Enter stops the page-wide shortcut', () => {
  const p = page();
  for (const id of ['jlc-jsonl', 'jlc-json']) {
    const ev = { key: 'Enter', metaKey: true, stopped: 0, prevented: 0, stopPropagation() { this.stopped++; }, preventDefault() { this.prevented++; } };
    p.get(id).value = id === 'jlc-json' ? '[1, 2]' : '1'; p.get(id).fire('keydown', ev);
    assert.ok(ev.stopped && ev.prevented, id);
  }
  assert.equal(p.get('jlc-jsonl').value, '1\n2');
});
await test('Ctrl+L drops cached copy/download output', async () => {
  const p = page(); p.get('jlc-jsonl').value = '9007199254740993'; p.get('jlc-to-json').click();
  p.get('jlc-jsonl').value = ''; p.get('jlc-json').value = '';
  p.docKey({ key: 'L', ctrlKey: true }); p.flush();
  for (const id of ['jlc-copy-json', 'jlc-copy-jsonl', 'jlc-download-json', 'jlc-download-jsonl']) {
    assert.equal(p.get(id).disabled, true, id); p.get(id).click();
  }
  assert.equal(p.copied.length, 0); assert.equal(p.downloads.length, 0);
  assert.equal(p.get('jlc-total-lines').textContent, '0'); assert.equal(p.get('jlc-status').textContent, '');
});

// Tool pages (src/content/tools/jsonl-converter/{lang}.mdx):
// {/* jlc-check: {"dir","validOnly","pretty","out","status"} */} → the next fenced block is the input of
// the dir panel ("jsonl" / "json"); after the conversion, out ("json" / "jsonl" panel, or
// "download-json" / "download-jsonl" / "copy-jsonl" / "copy-json") must equal the following block,
// and status (optional) must be the status line. {/* jlc-validate: {"counts","line","message"} */} →
// Validate on the next block gives these counters (lines, valid, errors, empty) and this message
// for that line (V8 wording, the same engine as Chrome).
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const rel = `src/content/tools/jsonl-converter/${lang}.mdx`;
  const mdx = readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
  const fences = from => [...mdx.slice(from).matchAll(/```\w*\n([\s\S]*?)\n```/g)].map(m => m[1]);
  let n = 0;
  for (const m of mdx.matchAll(/\{\/\* jlc-check: (\{.*?\}) \*\/\}/g)) {
    n++;
    await test(rel + ' example ' + n, async () => {
      const spec = JSON.parse(m[1]), [input, expected] = fences(m.index), p = page(lang);
      p.get('jlc-pretty-json').checked = spec.pretty !== false; p.get('jlc-valid-only').checked = !!spec.validOnly;
      p.get(spec.dir === 'json' ? 'jlc-json' : 'jlc-jsonl').value = input;
      p.get(spec.dir === 'json' ? 'jlc-to-jsonl' : 'jlc-to-json').click();
      if (spec.status) { assert.equal(p.get('jlc-status').textContent, spec.status); assert.ok(mdx.includes(spec.status)); }
      let out;
      if (spec.out === 'json' || spec.out === 'jsonl') out = p.get('jlc-' + spec.out).value;
      else if (spec.out.startsWith('download')) { p.get('jlc-' + spec.out).click(); out = await p.downloads.at(-1).text(); }
      else { p.get('jlc-' + spec.out).click(); await 0; out = p.copied.at(-1); }
      assert.equal(out, expected);
    });
  }
  for (const m of mdx.matchAll(/\{\/\* jlc-validate: (\{.*?\}) \*\/\}/g)) {
    n++;
    await test(rel + ' validate example ' + n, () => {
      const spec = JSON.parse(m[1]), [input] = fences(m.index), p = page(lang);
      p.get('jlc-jsonl').value = input; p.get('jlc-validate').click();
      assert.deepEqual(['total', 'valid', 'error', 'empty'].map(k => Number(p.get('jlc-' + k + '-lines').textContent)), spec.counts);
      const row = p.get('jlc-issues-list').children.find(r => r.children?.[0]?.textContent.endsWith(' ' + spec.line));
      assert.equal(row?.children[1].textContent, spec.message);
      assert.ok(mdx.includes(spec.message));
      for (const id of ['jlc-copy-json', 'jlc-copy-jsonl', 'jlc-download-json', 'jlc-download-jsonl']) assert.equal(p.get(id).disabled, true, id);
    });
  }
  await test(rel + ' has checked examples and no 2^53 precision-loss claim', () => {
    assert.ok(n >= 3, String(n));
    assert.ok(!/lose precision|丢精度|精度が落ちます|정밀도가 떨어집니다/.test(mdx), 'old precision claim');
    for (const [raw, out] of [['[{"b":1,"2":2,"1":3}]', '{"1":3,"2":2,"b":1}'], ['[{"x":1,"x":2}]', '{"x":2}']]) {
      const p = page(lang); p.get('jlc-json').value = raw; p.get('jlc-to-jsonl').click();
      assert.equal(p.get('jlc-jsonl').value, out); assert.ok(mdx.includes(raw.slice(1, -1)) && mdx.includes(out), 'limit ' + out);
    }
    assert.ok(!/after validation to export|校验后使用|検証後に \.jsonl|검증 후 \.jsonl/.test(mdx), 'old validate-then-download claim');
  });
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
