// JSON to Java POJO — type inference, number widening, page examples
//
// Read:  src/components/tools/JsonToJavaTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers)
// Write: a temporary directory under os.tmpdir() when javac is available (removed); stdout
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: before the fix a field whose samples were 9.5 and 20 became Object, and whole numbers
// above 2,147,483,647 became int (javac rejects such a literal and Jackson fails on the value).
// Now int/long/double samples widen to the widest of them, integers outside the int range give
// long (boxed Long in lists), and other mixes stay Object. Also the Lombok example (root class
// first) and the Jackson order example on the tool pages. When javac is installed, the None-mode
// output of the order example and of the long/double sample is split into one file per class
// and compiled; otherwise SKIP.
//
// Run: node scripts/test-json-to-java-pojo.mjs

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/JsonToJavaTool.astro'), 'utf8');
const a = source.indexOf('/* ── engine:start ── */');
const b = source.indexOf('/* ── engine:end ── */');
if (a < 0 || b <= a) { console.error('FAIL: engine block not found'); process.exit(1); }
const E = new Function(source.slice(a, b) + '\nreturn { buildClass, renderClasses, mergeTypes };')();

let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
function classes(json, rootName = 'RootObject') { const c = {}; E.buildClass(JSON.parse(json), rootName, c); return c; }
function gen(json, mode) { return E.renderClasses(classes(json), mode); }
function field(c, cls, name) { return (c[cls] || []).find((f) => f.fieldName === name)?.type; }

eq('mergeTypes int+double', E.mergeTypes(['int', 'double']), 'double');
eq('mergeTypes int+long', E.mergeTypes(['int', 'long']), 'long');
eq('mergeTypes int+String', E.mergeTypes(['int', 'String']), 'Object');
eq('mergeTypes single', E.mergeTypes(['boolean']), 'boolean');

const order = '{"order_id": 9007, "customer": {"name": "Alice", "vip": true}, "items": [{"sku": "A-1", "qty": 2, "price": 9.5}, {"sku": "B-2", "qty": 1, "price": 20}], "note": null}';
const oc = classes(order);
eq('price 9.5 and 20 → double', field(oc, 'ItemsItem', 'price'), 'double');
eq('qty stays int', field(oc, 'ItemsItem', 'qty'), 'int');
eq('null → Object', field(oc, 'RootObject', 'note'), 'Object');
eq('class order', Object.keys(oc).join(','), 'RootObject,Customer,ItemsItem');
eq('jackson annotation for order_id', /@JsonProperty\("order_id"\)\n    private int orderId;/.test(gen(order, 'jackson')), true);

const big = classes('{"id": 1730000000000, "small": 7, "neg": -2147483649, "edge": 2147483647, "scores": [1, 2.5], "ids": [1, 1730000000000], "mixed": [1, "a"]}');
eq('millisecond timestamp → long', field(big, 'RootObject', 'id'), 'long');
eq('small → int', field(big, 'RootObject', 'small'), 'int');
eq('below int range → long', field(big, 'RootObject', 'neg'), 'long');
eq('2147483647 → int', field(big, 'RootObject', 'edge'), 'int');
eq('[1, 2.5] → List<Double>', field(big, 'RootObject', 'scores'), 'List<Double>');
eq('[1, 1730000000000] → List<Long>', field(big, 'RootObject', 'ids'), 'List<Long>');
eq('[1, "a"] → List<Object>', field(big, 'RootObject', 'mixed'), 'List<Object>');

eq('Lombok page example', gen('{"user": {"first_name": "Alice", "age": 30}, "tags": ["admin"]}', 'lombok'),
  'import java.util.List;\nimport lombok.Data;\n\n@Data\npublic class RootObject {\n    private User user;\n    private List<String> tags;\n}\n\n@Data\npublic class User {\n    private String firstName;\n    private int age;\n}');

// Tool pages show the same examples
for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, `src/content/tools/json-to-java-pojo/${lang}.mdx`), 'utf8');
  eq(lang + ' page shows price as double', mdx.includes('    private double price;') && !mdx.includes('private Object price'), true);
  eq(lang + ' page Lombok example starts with RootObject', /@Data\\npublic class RootObject[\s\S]*@Data\\npublic class User/.test(mdx), true);
}

let hasJavac = true;
try { execFileSync('javac', ['-version'], { stdio: 'ignore' }); } catch { hasJavac = false; }
if (!hasJavac) {
  console.log('SKIP javac compile (javac not installed)');
} else {
  for (const [name, json] of [['order', order], ['numbers', '{"id": 1730000000000, "scores": [1, 2.5], "price": [{"v": 1}, {"v": 2.5}]}']]) {
    const dir = mkdtempSync(join(tmpdir(), 'pojo-test-'));
    try {
      const out = gen(json, 'none');
      const imports = out.match(/^import .*;$/gm) || [];
      const blocks = out.split(/\n\n(?=public class )/).filter((x) => /^public class /.test(x));
      const files = [];
      for (const blk of blocks) {
        const cls = blk.match(/^public class (\w+)/)[1];
        const f = join(dir, cls + '.java');
        writeFileSync(f, imports.join('\n') + '\n\n' + blk + '\n');
        files.push(f);
      }
      let ok = true;
      try { execFileSync('javac', ['-d', dir, ...files], { stdio: 'pipe' }); } catch (e) { ok = false; console.log(String(e.stderr)); }
      eq('javac compiles the ' + name + ' example (' + files.length + ' files)', ok, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
