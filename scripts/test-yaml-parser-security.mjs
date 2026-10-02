// Read the installed js-yaml parser. Write stdout/stderr only.
// Bounded child processes cover GHSA-52cp-r559-cp3m, h67p-54hq-rp68,
// 5p4m-2wfm-xmqj and 2883-xcg3-v3hh. No attack input reaches a browser.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const cases = ['chain', 'repeated-alias', 'omap', 'empty-sources', 'normal-merges'];
if (process.argv[2] === '--case') {
  const kind = process.argv[3];
  const schema = process.argv[4] === 'core-merge' ? yaml.CORE_SCHEMA.extend({ implicit: [yaml.types.merge] }) : yaml.DEFAULT_SCHEMA;
  const load = text => yaml.load(text, { schema });
  const start = performance.now();
  if (kind === 'chain') {
    const n = 1600;
    const input = 'a0: &a0 { k0: 0 }\n' + Array.from({ length: n }, (_, j) => {
      const i = j + 1;
      return `a${i}: &a${i} { <<: *a${i - 1}, k${i}: ${i} }`;
    }).join('\n');
    assert.throws(() => load(input), /merge keys exceeded maxTotalMergeKeys \(10000\)/, 'default merge work budget must reject the chain');
  } else if (kind === 'repeated-alias') {
    const n = 9000;
    const input = 'base: &b {' + Array.from({ length: n }, (_, i) => `k${i}: ${i}`).join(',') + '}\nresult: {<<: [' + Array(n).fill('*b').join(',') + ']}';
    assert.throws(() => load(input), /abnormal merge sequence size/, 'merge sequences are limited to 100 sources');
    const boundedSequence = input.replace(Array(n).fill('*b').join(','), '*b,*b');
    assert.throws(() => load(boundedSequence), /merge keys exceeded maxTotalMergeKeys \(10000\)/, 'repeated keys also consume the work budget');
  } else if (kind === 'omap') {
    const n = 100000;
    const result = load('!!omap\n' + Array.from({ length: n }, (_, i) => `- k${i}: ${i}`).join('\n'));
    assert.equal(result.length, n);
    for (let i = 0; i < n; i++) assert.deepEqual(result[i], { ['k' + i]: i });
    assert.throws(() => load('!!omap\n- a: 1\n- a: 2'), /omap/);
  } else if (kind === 'empty-sources') {
    const n = 20000;
    // Keep each sequence within 100 so this exercises the 4.3.2 source charge,
    // independently of the older sequence-size guard and key-count budget.
    const input = 'arr: &arr [' + Array(100).fill('{}').join(',') + ']\ntargets:\n' + '  - <<: *arr\n'.repeat(n);
    assert.throws(() => load(input), /merge keys exceeded maxTotalMergeKeys \(10000\)/, 'empty sources must consume merge work budget');
  } else {
    // YAML merge spec: earlier source wins; explicit keys override merged keys.
    const result = load('a: &a {x: 1, y: 2}\nb: &b {x: 9, z: 3}\nresult: {<<: [*a, *b, *a], y: 8}');
    assert.deepEqual(result.result, { x: 1, y: 8, z: 3 });
    const many = load('base: &b {x: 1}\nitems:\n' + '  - {<<: *b, y: 2}\n'.repeat(500));
    assert.equal(many.items.length, 500);
    assert(many.items.every(x => x.x === 1 && x.y === 2));
    const boundary = 'base: &b {x: 1}\nitems:\n' + '  - {<<: *b}\n'.repeat(5000);
    assert.equal(load(boundary).items.length, 5000, '10,000 merge work units are allowed');
    assert.throws(() => load(boundary + '  - {<<: *b}\n'), /maxTotalMergeKeys/, '10,001 merge work units are rejected');
    const docs = yaml.loadAll('a: &a {x: 1}\nb: {<<: *a}\n---\na: &a {x: 2}\nb: {<<: *a}', { schema });
    assert.deepEqual(docs.map(x => x.b.x), [1, 2]);
    assert.deepEqual(load('base: &b {__proto__: {polluted: true}, constructor: ok}\nr: {<<: *b}').r,
      JSON.parse('{"__proto__":{"polluted":true},"constructor":"ok"}'));
    assert.equal({}.polluted, undefined);
  }
  assert.deepEqual(load('title: "中文 日本語 한글"\nvalues: [1, 2]'), { title: '中文 日本語 한글', values: [1, 2] });
  console.log(`PASS ${kind}/${process.argv[4]} and subsequent valid input (${(performance.now() - start).toFixed(1)} ms)`);
} else {
  let failures = 0, count = 0;
  for (const schema of ['default', 'core-merge']) for (const kind of cases) {
    if (schema === 'core-merge' && kind === 'omap') continue; // OpenAPI does not enable !!omap.
    count++;
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--case', kind, schema], {
      encoding: 'utf8', timeout: process.env.CI ? 12000 : 3000, killSignal: 'SIGKILL',
    });
    if (child.status !== 0) {
      failures++;
      console.error(`FAIL ${kind}/${schema}: ${child.error?.code || child.signal || child.status}\n${child.stderr}`);
    } else process.stdout.write(child.stdout);
  }
  console.log(`YAML parser security: ${count - failures} passed, ${failures} failures`);
  process.exitCode = failures ? 1 : 0;
}
