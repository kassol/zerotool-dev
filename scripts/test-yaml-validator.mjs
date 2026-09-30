// YAML Validator — multi-document YAML (--- separated) is valid, with a result per document
//
// Read:  src/components/tools/YamlValidatorTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
//        node_modules/js-yaml (the library the tool bundles)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: several documents separated by `---` are valid (js-yaml load() threw "expected a
// single document" before; the tool now uses loadAll()), one result per document with its line
// range, an error in one document reported with its document number and absolute line while the
// other documents still get a result, `...` end markers, directives, leading comments, empty
// documents, `---` inside a quoted or block scalar, single documents unchanged.
//
// Run: node scripts/test-yaml-validator.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import yaml from 'js-yaml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/YamlValidatorTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in YamlValidatorTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { validateYaml };')();

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
const v = (text) => E.validateYaml(text, yaml);
const values = (r) => r.documents.map((d) => d.value);

// ---------- the reported defect: multi-document YAML rejected ----------
{
  const r = v('name: a\n---\nname: b\n');
  check('two documents are valid', r.ok, r.documents[0].error && r.documents[0].error.message);
  eq('one value per document', values(r), [{ name: 'a' }, { name: 'b' }]);
  eq('line ranges', r.documents.map((d) => [d.index, d.startLine, d.endLine]), [[1, 1, 1], [2, 2, 4]]);
}
{
  const text = 'apiVersion: v1\nkind: Service\n---\napiVersion: apps/v1\nkind: Deployment\n---\nkind: ConfigMap\n';
  const r = v(text);
  check('Kubernetes-style three documents', r.ok);
  eq('three kinds', values(r).map((d) => d.kind), ['Service', 'Deployment', 'ConfigMap']);
  eq('values equal loadAll', values(r), yaml.loadAll(text));
}
{
  const r = v('---\na: 1\n---\nb: 2\n');
  eq('leading --- does not add an empty document', values(r), [{ a: 1 }, { b: 2 }]);
}
{
  const r = v('# header comment\n---\na: 1\n---\nb: 2');
  eq('comments before the first --- are not a document', values(r), [{ a: 1 }, { b: 2 }]);
  eq('ranges skip the comment', r.documents.map((d) => d.startLine), [2, 4]);
}
eq('empty document between markers', values(v('a: 1\n---\n---\nb: 2')), [{ a: 1 }, null, { b: 2 }]);
eq('... end marker', values(v('a: 1\n...\n---\nb: 2')), [{ a: 1 }, { b: 2 }]);
eq('... then a bare document', values(v('a: 1\n...\nb: 2')), [{ a: 1 }, { b: 2 }]);
eq('directive before ---', values(v('a: 1\n...\n%YAML 1.2\n---\nb: 2')), [{ a: 1 }, { b: 2 }]);
eq('--- with content on the same line', values(v('--- a\n--- b')), ['a', 'b']);
eq('--- inside a quoted value is not a marker', values(v('a: "x --- y"\n---\nb: 1')), [{ a: 'x --- y' }, { b: 1 }]);
eq('indented --- in a block scalar is not a marker', values(v('a: |\n  line\n  ---\n  end\n')), [{ a: 'line\n---\nend\n' }]);
eq('---x is not a marker', values(v('a: 1\n---x: 2')), [{ a: 1, '---x': 2 }]);
eq('CRLF', values(v('a: 1\r\n---\r\nb: 2\r\n')), [{ a: 1 }, { b: 2 }]);

// ---------- errors: per document, absolute lines ----------
{
  const r = v('a: 1\n---\nb: [1, 2\n---\nc: 3\n');
  check('error makes the stream invalid', !r.ok);
  eq('every document has a result', r.documents.map((d) => d.ok), [true, false, true]);
  eq('valid documents keep their values', [r.documents[0].value, r.documents[2].value], [{ a: 1 }, { c: 3 }]);
  const bad = r.documents[1];
  eq('failing document number and range', [bad.index, bad.startLine, bad.endLine], [2, 2, 3]);
  check('error line is in the full text', bad.error.mark.line + 1 >= 3, 'line ' + (bad.error.mark.line + 1));
  check('snippet uses full-text line numbers', /\b3 \|/.test(bad.error.message), bad.error.message);
}
{
  const r = v('a: 1\n---\nb:\n  - x\n - y\n');
  eq('bad indentation in document 2', r.documents.map((d) => d.ok), [true, false]);
  eq('mark line 5', r.documents[1].error.mark.line + 1, 5);
}
{
  const r = v('a: 1\na: 2\n');
  check('duplicate key still an error (single document)', !r.ok && r.documents.length === 1);
  eq('single document error line', r.documents[0].error.mark.line + 1, 2);
}
{
  const r = v('a: 1\n%YAML 1.2\n---\nb: 2');
  check('directive without ... before it is an error (whole stream is the reference)', !r.ok,
    JSON.stringify(r.documents.map((d) => d.ok)));
}

// ---------- single documents unchanged ----------
eq('single document', values(v('name: Alice\nage: 30')), [{ name: 'Alice', age: 30 }]);
eq('comment only', values(v('# nothing')), [null]);
check('single document ok', v('a: [1, 2]').ok);
{
  const big = 'x: 1\n' + '\n'.repeat(20000) + 'y';
  const t0 = Date.now();
  v(big);
  check('long blank runs stay fast', Date.now() - t0 < 1000, (Date.now() - t0) + ' ms');
}

console.log(passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
