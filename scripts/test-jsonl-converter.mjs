// Read: JsonlConverterTool.astro's complete inline script. Write: stdout only.
// Drive the shipped click/input/download handlers with DOM substitutes; no mirrored converter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { contractProblems } from './lib/tool-mdx-contract.mjs';

const source = readFileSync(new URL('../src/components/tools/JsonlConverterTool.astro', import.meta.url), 'utf8');
const STR = vm.runInNewContext(source.match(/\/\/ strings:start\n([\s\S]*?)\/\/ strings:end/)[1].replace(/ as const;/, ';') + ';STRINGS');
const clientStrings = lang => vm.runInNewContext(source.slice(source.indexOf('// strings:end') + '// strings:end'.length, source.indexOf('\n---', source.indexOf('// strings:end'))) + ';CLIENT_T', { STRINGS: STR, lang });
let passed = 0, failed = 0;
async function test(name, run) {
  try { await run(); passed++; }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
}
function page(lang = 'en') {
  const elements = new Map(), copied = [], downloads = [], timers = new Map(), readers = [], docEvents = {};
  let timerId = 0, document;
  function element() {
    const events = {};
    return { value: '', checked: false, disabled: false, textContent: '', children: [],
      focus() { document.activeElement = this; }, classList: { toggle() {} }, addEventListener(k, fn) { events[k] = fn; },
      fire(k, ev = {}) { return events[k]?.(ev); }, click() { if (!this.disabled) { if (this.download) downloads.push(this.href); return this.fire('click'); } },
      appendChild(child) { this.children.push(child); }, remove() {} };
  }
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  get('jlc-ignore-empty').checked = get('jlc-pretty-json').checked = true;
  document = { documentElement: { lang }, activeElement: get('jlc-jsonl'), getElementById: get, querySelectorAll: () => [], querySelector: () => ({ contains: el => [...elements.values()].includes(el) }), createElement: element, body: element(), addEventListener(k, fn) { docEvents[k] = fn; } };
  vm.runInNewContext(source.match(/<script is:inline(?:\s[^>]*)?>([\s\S]*?)<\/script>/)[1], {
    document, t: clientStrings(lang),
    window: {}, navigator: { clipboard: { writeText: async text => copied.push(text) } }, Blob,
    URL: { createObjectURL: blob => blob, revokeObjectURL() {} },
    FileReader: class { constructor() { readers.push(this); } readAsText(file) { this.file = file; }
      finish(text) { this.result = text; this.onload(); } fail() { this.onerror(); } },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id)
  });
  return { get, copied, downloads, readers, docKey(ev) { docEvents.keydown?.({ preventDefault() {}, ...ev }); }, open(target) { get('jlc-open-' + target).click(); get('jlc-file').files = [{ name: 'sample.txt' }]; get('jlc-file').fire('change'); return readers.at(-1); },
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
await test('emptying the JSONL panel also resets its counters and issues', () => {
  for (const action of ['non-array', 'invalid', 'edit']) {
    const p = page(); p.get('jlc-jsonl').value = '1\n{bad}'; p.get('jlc-jsonl').fire('input'); p.flush();
    assert.equal(p.get('jlc-error-lines').textContent, '1');
    if (action === 'edit') { p.get('jlc-json').value = '[1]'; p.get('jlc-json').fire('input'); }
    else { p.get('jlc-json').value = action === 'invalid' ? '[1,' : '{}'; p.get('jlc-to-jsonl').click(); }
    assert.equal(p.get('jlc-jsonl').value, '', action);
    assert.deepEqual(['total', 'valid', 'error', 'empty'].map(k => p.get('jlc-' + k + '-lines').textContent), ['0', '0', '0', '0'], action);
    assert.equal(p.get('jlc-issues-count').textContent, '0', action);
  }
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

// JSON syntax errors (S2-10f, 2026-10-09): lineCol and jsonSyntaxError are copied verbatim from
// json-formatter-engine.js, and errJson, errJsonAt and the jsonParse reasons verbatim from
// HarFileAnalyzerTool.astro. Each bad JSONL line lists its column and cause in the page language
// (the line number is in the row's first cell); a JSON → JSONL syntax error names line, column and
// cause. Before, both showed the browser's English message. Columns count from the start of the line
// as typed, lines from the start of the JSON panel.
{
  const root = new URL('..', import.meta.url);
  const JSON_ENGINE = readFileSync(new URL('src/components/tools/json-formatter-engine.js', root), 'utf8');
  const HAR_SOURCE = readFileSync(new URL('src/components/tools/HarFileAnalyzerTool.astro', root), 'utf8');
  const HAR_S = new Function('return ' + HAR_SOURCE.slice(HAR_SOURCE.indexOf('const STRINGS = ') + 16, HAR_SOURCE.indexOf('\n};\n', HAR_SOURCE.indexOf('const STRINGS = ')) + 2))();
  const fnSrc = (src, name) => {
    const lines = src.split('\n');
    const at = lines.findIndex((l) => new RegExp('^\\s*function ' + name + '\\(').test(l));
    if (at < 0) return '';
    const indent = lines[at].match(/^\s*/)[0];
    let end = at + 1;
    while (end < lines.length && lines[end] !== indent + '}') end++;
    return lines.slice(at, end + 1).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join('\n');
  };
  const ISSUE_AT = { en: 'Column {col}, {reason}.', zh: '第 {col} 列，{reason}。', ja: '{col} 列目、{reason}。', ko: '{col}열, {reason}.' };
  const reason = (lang, code, ch) => HAR_S[lang].jsonParse[code].replace('{ch}', ch ?? '');
  const issue = (lang, code, col, ch) => ISSUE_AT[lang].replace('{col}', col).replace('{reason}', reason(lang, code, ch));
  const errAt = (lang, code, line, col, ch) => HAR_S[lang].errJsonAt.replace('{line}', line).replace('{col}', col).replace('{reason}', reason(lang, code, ch));
  await test('JSON errors: reasons are the text of HarFileAnalyzerTool.astro and reach the script', () => {
    for (const lang of ['en', 'zh', 'ja', 'ko']) {
      // JSON text: STRINGS comes from another vm realm, whose objects have a different prototype.
      for (const key of ['errJson', 'errJsonAt', 'jsonParse']) {
        assert.equal(JSON.stringify(STR[lang][key]), JSON.stringify(HAR_S[lang][key]), lang + ' ' + key);
        assert.equal(JSON.stringify(clientStrings(lang)[key]), JSON.stringify(HAR_S[lang][key]), lang + ' client ' + key);
      }
      assert.equal(STR[lang].issueAt, ISSUE_AT[lang], lang + ' issueAt');
    }
  });
  await test('JSON errors: lineCol and jsonSyntaxError are copied verbatim, outside the protected parsers', () => {
    const rs = source.indexOf('/* ── json-reason:start ── */'), re = source.indexOf('/* ── json-reason:end ── */');
    assert.ok(rs > source.indexOf('      function enableOutput') && re > rs && re < source.indexOf('      function parseJsonl'), 'block position');
    for (const name of ['lineCol', 'jsonSyntaxError']) {
      const mine = fnSrc(source.slice(rs, re), name);
      assert.ok(mine !== '' && mine === fnSrc(JSON_ENGINE, name), name);
    }
  });
  for (const lang of ['en', 'zh', 'ja', 'ko']) {
    const S = STR[lang];
    await test(lang + ' line issues name the column and cause in the page language', () => {
      const p = page(lang);
      p.get('jlc-jsonl').value = '{"ok":1}\n   {"a":1,}\n{\u201cid\u201d: 1}\r\n{"a":1} // note\n{"id":2,"event":"purchase",}';
      p.get('jlc-jsonl').fire('input'); p.flush();
      assert.deepEqual(p.get('jlc-issues-list').children.filter((r) => r.className === 'jlc-issue-row').map((r) => [r.children[0].textContent, r.children[1].textContent]), [
        [S.line + ' 2', issue(lang, 'trailingComma', 10)],
        [S.line + ' 3', issue(lang, 'smartQuote', 2, '\u201c')],
        [S.line + ' 4', issue(lang, 'comment', 9)],
        [S.line + ' 5', issue(lang, 'trailingComma', 27)],
      ]);
      assert.equal(p.get('jlc-error-lines').textContent, '4');
    });
    await test(lang + ' JSON → JSONL syntax error names line, column and cause; old JSONL cleared', () => {
      const p = page(lang); p.get('jlc-json').value = '[1]'; p.get('jlc-to-jsonl').click();
      p.get('jlc-json').value = '\n[\n  {"a":1},\n  {"b":2},\n]'; p.get('jlc-to-jsonl').click();
      assert.equal(p.get('jlc-status').textContent, errAt(lang, 'trailingComma', 4, 10));
      assert.equal(p.get('jlc-jsonl').value, ''); assert.equal(p.get('jlc-copy-jsonl').disabled, true); assert.equal(p.get('jlc-download-jsonl').disabled, true);
      p.get('jlc-json').value = '[{\u201cid\u201d: 1}]'; p.get('jlc-to-jsonl').click();
      assert.equal(p.get('jlc-status').textContent, errAt(lang, 'smartQuote', 1, 3, '\u201c'));
    });
  }
}

// Tool pages (src/content/tools/jsonl-converter/{lang}.mdx):
// {/* jlc-check: {"dir","validOnly","pretty","out","status"} */} → the next fenced block is the input of
// the dir panel ("jsonl" / "json"); after the conversion, out ("json" / "jsonl" panel, or
// "download-json" / "download-jsonl" / "copy-jsonl" / "copy-json") must equal the following block,
// and status (optional) must be the status line. {/* jlc-validate: {"counts","line","message"} */} →
// Automatic validation after input on the next block gives these counters (lines, valid, errors, empty) and this message
// for that line (column and cause in the page language, S2-10f; before, V8 wording).
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
      p.get('jlc-jsonl').value = input; p.get('jlc-jsonl').fire('input'); p.flush();
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

/* ── Full production IIFE and actual ToolLayout shortcuts ── */
{
  const { parseFragment } = await import('parse5');
  const { createHash } = await import('node:crypto');
  const js = source.match(/<script is:inline(?:\s[^>]*)?>([\s\S]*?)<\/script>/)[1];
  const layout = readFileSync(new URL('../src/layouts/ToolLayout.astro', import.meta.url), 'utf8');
  const shortcut = layout.slice(layout.indexOf('// ── Keyboard shortcuts:'), layout.indexOf('// ── Copy button visual feedback'));
  assert.ok(shortcut.includes("document.addEventListener('keydown'"));
  const hash = value => createHash('sha256').update(value).digest('hex');
  const checks = [];
  function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    checks.push(ok);
    if (!ok) console.log('FAIL ' + name + '\n actual: ' + JSON.stringify(actual) + '\n expected: ' + JSON.stringify(expected));
  }
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const unhandled = [];
const onUnhandled = error => unhandled.push(String(error));
process.on('unhandledRejection', onUnhandled);
const descendants = e => e.children.flatMap(c => [c, ...descendants(c)]);
function page(lang = 'en', shellFirst = false, preset = {}, active = null) {
  let document, now = 0, nextTimer = 0;
  const timers = new Map(), copies = [], clears = [], tracks = [], readers = [], downloads = [];
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
    get value() { return this._value || ''; }
    set value(v) { this._value = String(v); if (this.getAttribute('type') === 'file' && v === '') this.files = []; }
    get textContent() { return (this._textContent || '') + this.children.map(c => c.textContent).join(''); }
    set textContent(v) { this._textContent = String(v); this.children = []; }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
    get classList() { const el = this; return { contains(c) { return el.className.split(/\s+/).includes(c); }, add(...cs) { el.className = [...new Set([...el.className.split(/\s+/).filter(Boolean), ...cs])].join(' '); }, remove(...cs) { el.className = el.className.split(/\s+/).filter(c => !cs.includes(c)).join(' '); }, toggle(c, on) { const want = on === undefined ? !this.contains(c) : on; if (want) this.add(c); else this.remove(c); return want; } }; }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); if (k === 'id') this.id = String(v); if (k === 'disabled') this.disabled = true; if (k === 'checked') this.checked = true; if (k === 'value') this.value = String(v); if (k === 'hidden') this.hidden = true; if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v); }
    getAttribute(k) { return Object.hasOwn(this.attributes, k) ? this.attributes[k] : null; }
    removeAttribute(k) { delete this.attributes[k]; if (k === 'disabled') this.disabled = false; if (k === 'hidden') this.hidden = false; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
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
    click() { if (!this.disabled) { if (this.download) downloads.push({ filename: this.download, blob: this.href }); this.focus(); return this.dispatch('click'); } }
  }
  document = new Element('#document'); document.documentElement = { lang };
  document.body = document.appendChild(new Element('body')); document.activeElement = document.body;
  const widget = document.body.appendChild(new Element('section')); widget.className = 'tool-widget';
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const markup = source.replace(/^---[\s\S]*?---\s*/, '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').split('<style')[0]
    .replace(/data-strings=\{JSON\.stringify\(T\)\}/g, 'data-strings="' + esc(JSON.stringify(STR[lang])) + '"')
    .replace(/data-lang=\{lang\}/g, 'data-lang="' + lang + '"').replace(/\{T\.(\w+)\}/g, (_, k) => esc(STR[lang][k]));
  function append(ast, parent) { for (const node of ast.childNodes || []) { if (!node.tagName) { if (node.nodeName === '#text') parent._textContent = (parent._textContent || '') + node.value; continue; } const e = parent.appendChild(new Element(node.tagName)); for (const a of node.attrs) e.setAttribute(a.name, a.value); append(node, e); if (e.tagName === 'TEXTAREA') e.value = e.textContent; } }
  append(parseFragment(markup), widget);
  document.createElement = tag => new Element(tag);
  document.getElementById = id => descendants(document).find(e => e.id === id) || null;
  const get = id => { const e = document.getElementById(id); if (!e) throw Error('Missing production ID ' + id); return e; };
  for (const [id, value] of Object.entries(preset)) get(id).value = value;
  if (active) get(active).focus();
  const context = { document, t: clientStrings(lang), console, exports: {}, module: { exports: {} },
    Blob, URL: { createObjectURL: blob => blob, revokeObjectURL() {} },
    FileReader: class { constructor() { readers.push(this); } readAsText(file) { this.file = file; } finish(text) { this.result = text; this.onload(); } fail() { this.onerror(); } }, _slug: 'jsonl-converter',
    navigator: { clipboard: { writeText(value) { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); copies.push({ value, resolve, reject }); return promise; } } },
    setTimeout(fn, ms = 0) { const id = ++nextTimer; timers.set(id, { fn, ms, due: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); },
    ztPersist: { clear(slug) { clears.push(slug); } }, trackTool(...args) { tracks.push(args); } };
  context.window = context; vm.createContext(context);
  const installShared = () => vm.runInContext(shortcut, context, { filename: 'ToolLayout.shortcuts.js' });
  if (shellFirst) installShared(); vm.runInContext(js, context, { filename: 'JsonlConverterTool.page.js' }); if (!shellFirst) installShared();
  function advance(ms) { const end = now + ms; let executions = 0; for (;;) { const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]; if (!next) break; if (++executions > 1000) throw Error('Timer runaway'); now = next[1].due; timers.delete(next[0]); next[1].fn(); } now = end; }
  return { get, document, context, copies, clears, tracks, timers, advance, readers, downloads,
    open(target) { get('jlc-open-' + target).click(); const f = get('jlc-file'); f.value = 'C:\\fakepath\\sample.txt'; f.files = [{ name: 'sample.txt' }]; f.dispatch('change'); return readers.at(-1); },
    input(id, value) { get(id).focus(); get(id).value = value; get(id).dispatch('input'); },
    key(id, key = 'l', modifier = 'ctrlKey') { (id ? get(id) : document.body).focus(); return document.activeElement.dispatch('keydown', { key, [modifier]: true }); },
    copy(id) { get(id).click(); return copies.at(-1); },
    snapshot() { return { json: get('jlc-json').value, jsonl: get('jlc-jsonl').value, status: get('jlc-status').textContent, statusClass: get('jlc-status').className, copyJson: get('jlc-copy-json').textContent, copyJsonl: get('jlc-copy-jsonl').textContent, disabledJson: get('jlc-copy-json').disabled, disabledJsonl: get('jlc-copy-jsonl').disabled, downloadJson: get('jlc-download-json').disabled, downloadJsonl: get('jlc-download-jsonl').disabled, counts: ['total', 'valid', 'error', 'empty'].map(k => get('jlc-' + k + '-lines').textContent), issues: get('jlc-issues-count').textContent, errorJson: get('jlc-json').classList.contains('jlc-input-error'), errorJsonl: get('jlc-jsonl').classList.contains('jlc-input-error') }; } };
}

const JSONL = '{"n":9007199254740993}\n1e400';
const JSON_OUT = '[\n  {\n    "n": 9007199254740993\n  },\n  1e400\n]';
const golden = p => { p.input('jlc-jsonl', JSONL); p.get('jlc-to-json').click(); };
for (const [name, begin, end, expected] of [
  ['lossless token core', '      // JSON.parse validates', '      function invalidateOutput', 'dbd54ec4bc34a044902843557a0a912e835ffe2f504ff82e34a3b02fe0f35f07'],
  // S2-10f (2026-10-09): a bad line's message is the column and cause in the page language (lineIssueText).
  ['line parser', '      function parseJsonl', '      function updateStats', 'e1b5e6cf468d8b66807897e17854f94a485960d108161b030fccb306f7de3e51'],
  ['JSONL formatting', '      function compactJsonlFromValues', '      function convertJsonlToJson', '0051f32080d31dc299a7bfbbd1cd5500b28704547b9fe1fd075327644cb3fe78'],
  ['download bytes', '      function downloadText', '      function openFile', '3a1e722365c31bebb902c0cfaad017e50cd6397b942c26ead6972516d45ec15b']
]) check(name + ' byte-exact', hash(source.slice(source.indexOf(begin), source.indexOf(end))), expected);
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const S = STR[lang];
  for (const shellFirst of [false, true]) {
    const p = page(lang, shellFirst), tag = lang + '/' + shellFirst;
    golden(p); check(tag + ' actual conversion preserves numeric tokens', p.get('jlc-json').value, JSON_OUT);
    p.get('jlc-download-json').click(); p.get('jlc-download-jsonl').click();
    check(tag + ' real download Blobs contain full exact bytes', await Promise.all(p.downloads.map(async d => [d.filename, await d.blob.text()])), [['jsonl-converted.json', JSON_OUT], ['jsonl-converted.jsonl', JSONL]]);
    p.input('jlc-json', '[2]'); p.advance(350); check(tag + ' JSON editing only invalidates, remains manual', [p.get('jlc-jsonl').value, p.get('jlc-status').textContent], ['', '']);
    p.input('jlc-jsonl', '2'); p.advance(350); check(tag + ' JSONL typing validates without conversion', [p.get('jlc-json').value, p.get('jlc-status').textContent, p.get('jlc-valid-lines').textContent], ['', S.validJsonl, '1']);
    for (const side of ['jsonl', 'json']) {
      p.input('jlc-' + side, side === 'json' ? '[1, 2]' : '1\n2'); p.tracks.length = 0; const key = p.key('jlc-' + side, 'Enter');
      check(tag + '/' + side + ' existing Enter stops shared primary', [key.stopped, key.defaultPrevented, p.tracks.length], [true, true, 1]);
      check(tag + '/' + side + ' manual Enter literal output', p.get(side === 'json' ? 'jlc-jsonl' : 'jlc-json').value, side === 'json' ? '1\n2' : '[\n  1,\n  2\n]');
    }
    p.input('jlc-json', '{'); p.get('jlc-to-jsonl').click(); check(tag + ' invalid JSON positive control error class', p.get('jlc-json').classList.contains('jlc-input-error'), true);
    p.input('jlc-json', ''); check(tag + ' empty JSON edit clears old error class', [p.get('jlc-json').classList.contains('jlc-input-error'), p.get('jlc-status').textContent], [false, '']);
    p.input('jlc-json', '{'); p.get('jlc-to-jsonl').click(); p.get('jlc-json').value = ''; p.get('jlc-to-jsonl').click(); check(tag + ' empty manual JSON clears old error class', p.get('jlc-json').classList.contains('jlc-input-error'), false);
    golden(p); p.get('jlc-valid-only').checked = true; p.input('jlc-jsonl', '{bad}'); p.key('jlc-copy-jsonl', 'L', 'metaKey');
    check(tag + ' CtrlL clears cached outputs and persistence synchronously', [p.get('jlc-jsonl').value, p.get('jlc-json').value, p.get('jlc-copy-json').disabled, p.get('jlc-copy-jsonl').disabled, p.get('jlc-status').textContent, p.clears, p.get('jlc-valid-only').checked], ['', '', true, true, '', ['jsonl-converter'], true]);
    const cleared = p.snapshot(); p.advance(2000); check(tag + ' CtrlL cancels queued validation', p.snapshot(), cleared);
    golden(p); const beforeOutside = p.snapshot(); p.key(null); p.advance(0); check(tag + ' outside shortcut untouched', p.snapshot(), beforeOutside);
    for (const target of ['json', 'jsonl']) for (const outcome of ['finish', 'fail']) {
      const q = page(lang, shellFirst); golden(q); const reader = q.open(target); q.key('jlc-' + target);
      const before = q.snapshot(); reader[outcome](target === 'json' ? '[7]' : '7');
      check(tag + '/' + target + '/' + outcome + ' old reader cannot write before 0ms timer', q.snapshot(), before);
      check(tag + '/' + target + '/' + outcome + ' CtrlL clears selected file', [q.get('jlc-file').value, q.get('jlc-file').files.length], ['', 0]);
      q.advance(1000); check(tag + '/' + target + '/' + outcome + ' old reader leaves empty state', [q.get('jlc-json').value, q.get('jlc-jsonl').value, q.get('jlc-status').textContent], ['', '', '']);
      const current = q.open(target); current.finish(target === 'json' ? '[8]' : '8');
      check(tag + '/' + target + '/' + outcome + ' new file reading recovers', [q.get('jlc-' + target).value, q.get('jlc-status').classList.contains('success')], [target === 'json' ? '[8]' : '8', true]);
    }
    for (const action of ['clear', 'input', 'convert']) {
      const q = page(lang, shellFirst); const reader = q.open('json');
      if (action === 'clear') q.get('jlc-clear').click(); else { q.input('jlc-jsonl', '3'); if (action === 'convert') q.get('jlc-to-json').click(); }
      const current = q.snapshot(); reader.finish('[4]'); reader.fail(); check(tag + ' existing file cancellation after ' + action, q.snapshot(), current);
    }
    const files = page(lang, shellFirst), first = files.open('json'), last = files.open('jsonl'); last.finish('9'); const recent = files.snapshot(); first.finish('[1]'); first.fail(); check(tag + ' newest file keeps its captured target', files.snapshot(), recent);
    for (const side of ['json', 'jsonl']) {
      const id = 'jlc-copy-' + side, field = 'jlc-' + side, labelKey = side === 'json' ? 'copyJson' : 'copyJsonl';
      const q = page(lang, shellFirst); golden(q);
      const savedClipboard = q.context.navigator.clipboard; delete q.context.navigator.clipboard;
      let thrown = ''; try { q.copy(id); } catch (e) { thrown = String(e); }
      check(tag + '/' + side + ' no API controlled localized error', [thrown, q.get('jlc-status').classList.contains('error'), typeof S.copyFailed === 'string' && q.get('jlc-status').textContent === S.copyFailed], ['', true, true]);
      q.context.navigator.clipboard = savedClipboard; const retryApi = q.copy(id); retryApi.resolve(); await settle();
      check(tag + '/' + side + ' API recovery success', [q.get(id).textContent, q.get('jlc-status').classList.contains('error')], [S.copied, false]);
      q.advance(1500); check(tag + '/' + side + ' current copy timer', q.get(id).textContent, S.copy);
      const fail = q.copy(id), beforeUnhandled = unhandled.length; fail.reject(Error('controlled copy rejection')); await settle();
      check(tag + '/' + side + ' rejection caught', unhandled.length - beforeUnhandled, 0);
      check(tag + '/' + side + ' rejection localized', q.get('jlc-status').classList.contains('error') && typeof S.copyFailed === 'string' && q.get('jlc-status').textContent === S.copyFailed, true);
      const retry = q.copy(id); check(tag + '/' + side + ' retry complete bytes', retry.value, q.get(field).value); retry.resolve(); await settle();
      check(tag + '/' + side + ' retry clears copy error', [q.get(id).textContent, q.get('jlc-status').classList.contains('error')], [S.copied, false]);
      for (const action of ['input', 'result', 'clear', 'shortcut']) for (const outcome of ['resolve', 'reject']) {
        const r = page(lang, shellFirst); golden(r); const job = r.copy(id), beforeUnhandled = unhandled.length;
        if (action === 'clear') r.get('jlc-clear').click();
        else if (action === 'shortcut') r.key(id);
        else { r.input(field, side === 'json' ? '[3]' : '3'); if (action === 'result') r.get(side === 'json' ? 'jlc-to-jsonl' : 'jlc-to-json').click(); }
        const current = r.snapshot(); job[outcome](outcome === 'reject' ? Error('controlled stale copy') : undefined); await settle();
        check(tag + '/' + side + '/' + action + '/' + outcome + ' stale feedback ignored', r.snapshot(), current);
        check(tag + '/' + side + '/' + action + '/' + outcome + ' rejection caught', unhandled.length - beforeUnhandled, 0);
      }
      for (const outcome of ['reject', 'resolve']) {
        const r = page(lang, shellFirst); golden(r); const initial = r.snapshot(), expected = { ...initial, [labelKey]: S.copied };
        const old = r.copy(id), fresh = r.copy(id), beforeUnhandled = unhandled.length;
        check(tag + '/' + side + '/' + outcome + ' same-value captured twice', [old.value, fresh.value, old !== fresh], [r.get(field).value, r.get(field).value, true]);
        fresh.resolve(); await settle(); r.advance(500); old[outcome](outcome === 'reject' ? Error('controlled old same-value rejection') : undefined); await settle();
        check(tag + '/' + side + '/' + outcome + ' newest copy survives old completion', r.snapshot(), expected);
        check(tag + '/' + side + '/' + outcome + ' old rejection caught', unhandled.length - beforeUnhandled, 0);
        r.advance(500); r.copy(id).resolve(); await settle(); r.advance(500);
        check(tag + '/' + side + '/' + outcome + ' old timer leaves new feedback', r.snapshot(), expected);
        r.advance(1000); check(tag + '/' + side + '/' + outcome + ' own timer expires', r.snapshot(), initial);
      }
      const canceledDialog = page(lang, shellFirst); golden(canceledDialog);
      const normalBeforeOpen = canceledDialog.snapshot(); canceledDialog.get('jlc-open-' + side).click();
      check(tag + '/' + side + ' canceled Open preserves normal status and output', canceledDialog.snapshot(), normalBeforeOpen);
      canceledDialog.copy(id).reject(Error('controlled rejection before canceled Open')); await settle();
      check(tag + '/' + side + ' canceled Open case starts with owned copy error', [canceledDialog.get('jlc-status').textContent, canceledDialog.get('jlc-status').classList.contains('error')], [S.copyFailed, true]);
      canceledDialog.get('jlc-open-' + side).click();
      const afterDialog = canceledDialog.copy(id); afterDialog.resolve(); await settle();
      check(tag + '/' + side + ' same output retry after canceled Open clears owned error', [afterDialog.value, canceledDialog.get(id).textContent, canceledDialog.get('jlc-status').classList.contains('error')], [canceledDialog.get(field).value, S.copied, false]);
      for (const action of ['clear', 'input']) {
        const r = page(lang, shellFirst); golden(r); r.copy(id).resolve(); await settle();
        if (action === 'clear') r.get('jlc-clear').click(); else r.input(field, side === 'json' ? '[2]' : '2');
        r.advance(350); const current = r.snapshot(); r.advance(1500); check(tag + '/' + side + '/' + action + ' old success timer ignored', r.snapshot(), current);
      }
    }
  }
}

/* ── v2 page layout ── */
check('all FIX behavior checks retained', checks.length, 884);
// S2-10f (2026-10-09) added the json-reason block and the localized JSON syntax errors.
check('client script only loses runtime localization and redundant Validate listener', hash(js), '7b9365f63713e56de1b0a23a16f7f0f508cb9ce40b4133cd2215a889942ff864');
const fmEnd = source.indexOf('\n---', source.indexOf('// strings:end'));
const markup = source.slice(fmEnd + 4, source.indexOf('  <script'));
check('direct tool root', /^\s*<div class="jlc-wrap"/.test(markup), true);
check('controls status paired editors in order', /class="jlc-actions"[\s\S]*id="jlc-status"[\s\S]*class="jlc-panels zt-io"/.test(markup), true);
check('both shared panes and fills', [(markup.match(/class="jlc-panel zt-io-pane"/g) || []).length, (markup.match(/class="tool-textarea jlc-box zt-io-fill"/g) || []).length], [2, 2]);
check('ten functional buttons retained and only redundant Validate removed', [...markup.matchAll(/<button id="([^"]+)"/g)].map(m => m[1]), ['jlc-to-json','jlc-to-jsonl','jlc-load-sample','jlc-clear','jlc-download-json','jlc-download-jsonl','jlc-open-jsonl','jlc-copy-jsonl','jlc-open-json','jlc-copy-json']);
check('twelve source-bound tips', [...markup.matchAll(/<Toggletip id="([^"]+)"/g)].map(m => m[1]), ['jlc-tip-to-json','jlc-tip-to-jsonl','jlc-tip-load-sample','jlc-tip-clear','jlc-tip-ignore-empty','jlc-tip-valid-only','jlc-tip-pretty-json','jlc-tip-jsonl','jlc-tip-copy-jsonl','jlc-tip-json','jlc-tip-copy-json','jlc-tip-issues']);
check('all tip bodies use the Toggletip slot API', [...markup.matchAll(/<Toggletip\b[^>]*>\{TIPS\.(\w+)\}<\/Toggletip>/g)].length, 12);
check('tip explanations never become button text', /<Toggletip\b[^>]*\btext=/.test(markup), false);
check('secondary options and downloads default closed', /<details class="jlc-options">[\s\S]*id="jlc-ignore-empty"[\s\S]*id="jlc-download-json"[\s\S]*<\/details>/.test(markup), true);
check('both textareas remain editable and visible', /<textarea[^>]*(?:readonly|hidden)/.test(markup), false);
check('all labels use build-time strings', /data-i18n|var STRINGS|document.documentElement.lang/.test(source), false);
check('client receives selected strings without tips', /<script is:inline define:vars=\{\{ t: CLIENT_T \}\}>/.test(source), true);
check('removed validation control has no orphan binding', /jlc-validate|\bvalidate:/.test(source), false);
check('tips outside labels and buttons', /<(label|button)\b[^>]*>(?:(?!<\/\1>)[\s\S])*<Toggletip/.test(markup), false);
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1];
check('root flexible with zero minimum', /\.jlc-wrap\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*min-width: 0;[^}]*min-height: 0;/.test(css), true);
check('reserved scrollable status', /#jlc-status\s*\{[^}]*height: 2\.6rem;[^}]*flex: none;[^}]*overflow: auto;/.test(css), true);
check('bounded editors at both breakpoints and touch controls', /\.jlc-box\s*\{[^}]*overflow: auto;/.test(css) && /@media \(max-width: 860px\)[\s\S]*height: 180px;[\s\S]*@media \(max-width: 640px\)[\s\S]*min-height: 44px;[\s\S]*height: 120px;/.test(css), true);
check('fixed issues region scrolls rather than growing', /\.jlc-issues-list\s*\{[^}]*height: 4\.5rem;[^}]*overflow: auto;/.test(css), true);
check('issues region keyboard accessible and named', /id="jlc-issues-list"[^>]*role="region"[^>]*tabindex="0"[^>]*aria-label=\{T.lineIssues\}/.test(markup), true);
check('dynamic issue rows use global selectors', /\.jlc-issues-list :global\(\.jlc-issue-row\)/.test(css) && /\.jlc-issues-list :global\(\.jlc-issue-message\)/.test(css), true);
check('convert registry', readFileSync(new URL('../src/data/tool-layouts.ts', import.meta.url), 'utf8').match(/['"]jsonl-converter['"]\s*:\s*['"]([^'"]+)['"]/)?.[1], 'convert');
const requireRoot = createRequire(import.meta.url), mdxCompiler = await import('@mdx-js/mdx');
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const S = STR[lang], payload = clientStrings(lang);
  check(lang + ' recursive localization key parity', [Object.keys(S), Object.keys(S.tips)], [Object.keys(STR.en), Object.keys(STR.en.tips)]);
  check(lang + ' twelve same tip keys', Object.keys(S.tips), ['jsonl','json','toJson','toJsonl','sample','ignoreEmpty','validOnly','pretty','copyJsonl','copyJson','clear','issues']);
  check(lang + ' tip plain text bounds', Object.values(S.tips).every(v => typeof v === 'string' && v.length && [...v].length <= 280 && !/[<>]/.test(v)), true);
  check(lang + ' tip placeholders match', Object.values(S.tips).map(v => (v.match(/\{\w+\}/g) || []).sort()), Object.values(STR.en.tips).map(v => (v.match(/\{\w+\}/g) || []).sort()));
  check(lang + ' tips excluded client payload', Object.hasOwn(payload, 'tips') || Object.values(S.tips).some(v => JSON.stringify(payload).includes(v)), false);
  const q = page(lang); q.input('jlc-jsonl', '1\n{bad}\n2');
  q.advance(349); check(lang + ' validation does not run early', q.get('jlc-error-lines').textContent, '0');
  q.advance(1); check(lang + ' automatic validation replaces removed button', [q.get('jlc-error-lines').textContent, q.get('jlc-json').value, q.get('jlc-copy-json').disabled], ['1','',true]);
  q.get('jlc-valid-only').checked = true; q.get('jlc-valid-only').dispatch('change');
  check(lang + ' valid-only change validates without converting', [q.get('jlc-json').value, q.get('jlc-copy-json').disabled], ['',true]);
  q.get('jlc-to-json').click(); check(lang + ' manual direction applies valid-only', q.get('jlc-json').value, '[\n  1,\n  2\n]');
  q.get('jlc-pretty-json').checked = false; q.get('jlc-pretty-json').dispatch('change');
  check(lang + ' pretty option still converts when JSONL has input', q.get('jlc-json').value, '[1,2]');
  q.get('jlc-load-sample').click(); check(lang + ' sample converts three records', [q.get('jlc-total-lines').textContent, q.get('jlc-copy-json').disabled, JSON.parse(q.get('jlc-json').value).length], ['3',false,3]);
  const file = q.open('jsonl'); file.finish('9007199254740993\n1e400');
  check(lang + ' JSONL file validates without enabling export', [q.get('jlc-json').value,q.get('jlc-valid-lines').textContent,q.get('jlc-copy-jsonl').disabled], ['', '2', true]);
  const arrayFile = q.open('json'); arrayFile.finish('[9007199254740993,1e400]');
  check(lang + ' JSON array file converts and enables exact export', [q.get('jlc-jsonl').value,q.get('jlc-copy-jsonl').disabled], ['9007199254740993\n1e400',false]);
  q.get('jlc-download-json').click(); q.get('jlc-download-jsonl').click();
  check(lang + ' downloads retain cache and numeric bytes', await Promise.all(q.downloads.map(async d => [d.filename,await d.blob.text()])), [['jsonl-converted.json','[9007199254740993,1e400]'],['jsonl-converted.jsonl','9007199254740993\n1e400']]);
  q.input('jlc-jsonl', Array(80).fill('{bad}').join('\n')); q.advance(350);
  check(lang + ' long issues retain full count and display first40', [q.get('jlc-error-lines').textContent,q.get('jlc-issues-count').textContent,q.get('jlc-issues-list').children.length], ['80','80',40]);
  for (const shellFirst of [false,true]) { const r = page(lang,shellFirst); golden(r); const ev = r.key('jlc-issues-list'); check(lang + '/' + shellFirst + ' keyboard result clear keeps shared shortcut', [ev.defaultPrevented,r.document.activeElement.id,r.clears,r.get('jlc-json').value], [true,'jlc-jsonl',['jsonl-converter'],'']); }
  const content = readFileSync(new URL('../src/content/tools/jsonl-converter/' + lang + '.mdx', import.meta.url), 'utf8');
  const [,front,body] = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/), fm = requireRoot('js-yaml').load(front);
  check(lang + ' six steps before FAQ', fm.steps.length === 6 && front.indexOf('steps:') < front.indexOf('faqItems:'), true);
  check(lang + ' step8/280/1200 limits', fm.steps.length <= 8 && fm.steps.every(v => typeof v === 'string' && [...v].length <= 280) && fm.steps.reduce((n,v) => n + [...v].length,0) <= 1200, true);
  check(lang + ' MDX content contract', contractProblems('jsonl-converter', lang), '');
  let error = ''; try { await mdxCompiler.compile(body); } catch (e) { error = String(e); } check(lang + ' MDX compiles', error, '');
}
const { transform } = await import(requireRoot.resolve('@astrojs/compiler', { paths: [requireRoot.resolve('astro')] }));
const compiled = await transform(source, { filename: new URL('../src/components/tools/JsonlConverterTool.astro', import.meta.url).pathname });
check('Astro no errors', compiled.diagnostics.filter(d => d.severity === 1), []);
let compileError = ''; try { await requireRoot('esbuild').transform(compiled.code, { loader: 'ts', format: 'esm' }); } catch (e) { compileError = String(e); }
check('Astro generated module parses', compileError, '');

await settle(); process.removeListener('unhandledRejection', onUnhandled);
passed += checks.filter(Boolean).length; failed += checks.filter(v => !v).length;
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
