// Read the page engine, its vendor script and the installed protobufjs distribution.
// Write stdout only. Each untrusted parse runs in a separate vm with a hard timeout.
// Advisories: GHSA-j3f2-48v5-ccww (EOF loop), GHSA-jvwf-75h9-cwgg (built-in mutation).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/components/tools/ProtobufToJsonTool.astro');
const engine = source.slice(source.indexOf('/* ── engine:start ── */'), source.indexOf('/* ── engine:end ── */'));
const vendor = read('public/vendor/protobuf.min.js');
const timeout = process.env.CI ? 4000 : 1000;
let failures = 0;
function test(name, fn) {
  const start = performance.now();
  try { fn(); console.log(`PASS ${name} (${(performance.now() - start).toFixed(1)} ms)`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}

test('page vendor matches the locked npm distribution', () => {
  assert.equal(vendor, read('node_modules/protobufjs/dist/protobuf.min.js'));
  assert.doesNotMatch(source, /src="[^\"]*long\.min\.js"/);
});

for (const input of [
  'option foo',
  'syntax="proto3"; message M { option foo',
  'syntax="proto3"; option (audit).constructor.keys = "audit-marker"; message M {}',
  'syntax="proto3"; message M { option (audit).constructor.keys = "audit-marker"; }',
  'syntax="proto3"; option (audit).__proto__.auditMarker = "audit-marker"; message M {}',
]) {
  test(JSON.stringify(input), () => {
    const ctx = vm.createContext({ TextEncoder, TextDecoder, atob, input });
    vm.runInContext('this.window = this; this.self = this;', ctx, { timeout });
    vm.runInContext(vendor, ctx, { timeout });
    vm.runInContext(engine, ctx, { timeout });
    vm.runInContext(`
      var builtins = [Object, Object.prototype, Array, Array.prototype, Function, Function.prototype];
      var snapshots = builtins.map(x => Object.getOwnPropertyDescriptors(x));
      var ownKeys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor;
      var same = Object.is;
    `, ctx, { timeout });
    const result = vm.runInContext(`
      (() => {
        try { buildSchema(protobuf, [{name: 'main.proto', text: input}]); return 'accepted'; }
        catch (e) { return e.message; }
      })()
    `, ctx, { timeout });
    if (input.endsWith('option foo')) assert.notEqual(result, 'accepted', 'EOF must be rejected');
    assert.equal(vm.runInContext(`builtins.every((x, i) => {
      var before = snapshots[i], keys = ownKeys(x);
      return keys.length === ownKeys(before).length && keys.every(k => {
        var a = before[k], b = descriptor(x, k);
        return a && ownKeys(a).every(p => same(a[p], b[p]));
      });
    })`, ctx, { timeout }), true, 'built-in descriptors changed');
    assert.equal(vm.runInContext(`
      buildSchema(protobuf, [{name: 'valid.proto', text: 'syntax="proto3"; message Good { int64 id = 1; }'}])
        .root.lookupType('Good').fields.id.type
    `, ctx, { timeout }), 'int64', 'valid input must work after the rejected input');
    assert.equal(vm.runInContext('protobuf.util.Long == null && typeof Long === "undefined"', ctx), true);
  });
}
console.log(`Protobuf parser security: ${failures} failures`);
process.exitCode = failures ? 1 : 0;
