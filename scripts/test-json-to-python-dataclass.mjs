// JSON to Python Dataclass — TypedDict marks keys missing from some samples as NotRequired
//
// Read:  src/components/tools/JsonToPythonDataclassTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift from the
//        shipped source)
// Write: stdout only (test results); runs `python3` on generated code when it is available
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers the reported defect: in TypedDict mode a key that is absent from some objects was written
// as `Optional[T]`, which still makes the key required (PEP 589) and only allows None; it is now
// `NotRequired[T]` (PEP 655, typing in Python 3.11+), and `NotRequired[Optional[T]]` when the key
// is also null somewhere. Dataclass and Pydantic output keep `Optional[T] = None`. Also: an empty array
// in one sample no longer turns `List[str]` into `Union[List[str], List[Any]]`, and int with float is float
// (PEP 484 numeric tower) instead of `Union[int, float]`.
// With python3 >= 3.11 the generated TypedDict is executed and its __required_keys__ /
// __optional_keys__ are checked; otherwise SKIP.
//
// Run: node scripts/test-json-to-python-dataclass.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToPythonDataclassTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in JsonToPythonDataclassTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { generatePython };')();

let failures = 0, passes = 0, skips = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, 'got ' + a + ', expected ' + e);
}
const gen = (v, mode) => E.generatePython(v, 'Root', mode).code;

const SAMPLE = [
  { id: 1, name: 'Pen', note: null, tags: ['a'] },
  { id: 2, name: 'Ink', discount: 0.1, tags: [] },
];
eq('TypedDict: missing → NotRequired, null → Optional', gen(SAMPLE, 'typeddict').split('\n'), [
  'from typing import Any, List, NotRequired, Optional, TypedDict',
  '',
  'class Root(TypedDict):',
  '    id: int',
  '    name: str',
  '    note: NotRequired[Optional[Any]]',
  '    tags: List[str]',
  '    discount: NotRequired[float]',
]);
eq('TypedDict: null but always present → Optional only', gen({ a: null, b: 1 }, 'typeddict').split('\n'), [
  'from typing import Any, Optional, TypedDict', '', 'class Root(TypedDict):', '    a: Optional[Any]', '    b: int',
]);
eq('TypedDict: nothing missing → no NotRequired import', gen({ a: 1 }, 'typeddict').split('\n')[0], 'from typing import TypedDict');
eq('dataclass unchanged', gen(SAMPLE, 'dataclass').split('\n').slice(-6), [
  'class Root:', '    id: int', '    name: str', '    tags: List[str]', '    note: Optional[Any] = None', '    discount: Optional[float] = None',
]);
eq('pydantic unchanged', gen(SAMPLE, 'pydantic').split('\n').slice(-2), ['    note: Optional[Any] = None', '    discount: Optional[float] = None']);
eq('int and float across samples → float', gen([{ p: 2 }, { p: 1.5 }], 'dataclass').split('\n').pop(), '    p: float');
eq('primitive root → null', E.generatePython(5, 'Root', 'typeddict'), null);

const py = spawnSync('python3', ['-c', 'import sys; print(sys.version_info >= (3, 11))'], { encoding: 'utf8' });
if (py.status !== 0 || py.stdout.trim() !== 'True') {
  skips++;
  console.log('SKIP: python3 >= 3.11 not available');
} else {
  const code = gen(SAMPLE, 'typeddict') + '\nprint(sorted(Root.__required_keys__), sorted(Root.__optional_keys__))\n';
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
  eq('python: required / optional keys', r.stdout.trim(), "['id', 'name', 'tags'] ['discount', 'note']");
  for (const mode of ['dataclass', 'typeddict']) {
    const c = spawnSync('python3', ['-c', gen(SAMPLE, mode)], { encoding: 'utf8' });
    check('python runs the ' + mode + ' output', c.status === 0, c.stderr);
  }
}

console.log(`\n${passes} passed, ${failures} failed${skips ? ', ' + skips + ' skipped' : ''}`);
process.exit(failures ? 1 : 0);
