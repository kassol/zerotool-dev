// GraphQL Formatter — 4-space output keeps block string values unchanged
//
// Read:  src/components/tools/GraphqlFormatterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers), node_modules/graphql (16.x, the
//        same parser and printer the page loads), the 4 tool page mdx files
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Before the fix, 4-space mode doubled every run of leading spaces, including lines inside
// block strings ("""..."""). The GraphQL spec (BlockStringValue) removes only the common
// indentation, so doubling changed the relative indentation and therefore the description
// text. Each case re-parses the 4-space output with graphql-js and checks that print() of it
// equals the 2-space output (same document, same string values), that structural indentation
// is a multiple of 4, and a literal expected output.
//
// Run: node scripts/test-graphql-formatter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse, print } from 'graphql';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/GraphqlFormatterTool.astro'), 'utf8');
const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in GraphqlFormatterTool.astro');
  process.exit(1);
}
const E = new Function(source.slice(startIndex, endIndex) + '\nreturn { reindent, blockStringRanges };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

function format(src, indent) {
  const printed = print(parse(src));
  return E.reindent(printed, indent, E.blockStringRanges(parse(printed)));
}
function blockValues(doc) {
  const out = [];
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.kind === 'StringValue') out.push(n.value);
    for (const k of Object.keys(n)) if (k !== 'loc') walk(n[k]);
  })(doc);
  return out;
}

const SDL = `"""
The root query.
  Indented second line.
"""
type Query {
  """
  Returns a user.
    Indented note.

  Last line.
  """
  user(id: ID!, filter: UserFilter = {name: "a", tags: ["x"]}): User @deprecated(reason: """
  Use node().
    Since v2.
  """)
  users: [User!]!
}

input UserFilter { name: String tags: [String!] }

type User implements Node & Entity {
  id: ID!
  "single line"
  name: String
}`;

const QUERY = `query Q($id: ID!) { node(id: $id) { ... on User { posts(first: 10, after: "x") { edges { node { id body(format: """
  # Heading
    code
""") } } } } } }`;

const SAMPLE = /var SAMPLE = \[([\s\S]*?)\]\.join/.exec(source)[1].split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l.replace(/,$/, '').replace(/^'|'$/g, '"'))).join('\n');

for (const [name, src] of [['SDL with descriptions', SDL], ['query with block string argument', QUERY], ['built-in sample', SAMPLE]]) {
  const two = format(src, '  ');
  const four = format(src, '    ');
  check(name + ': 2-space output is graphql-js print()', two === print(parse(src)));
  check(name + ': 4-space output parses to the same document', print(parse(four)) === two, '\n' + four);
  check(name + ': string values unchanged', JSON.stringify(blockValues(parse(four))) === JSON.stringify(blockValues(parse(two))));
  const ranges = E.blockStringRanges(parse(four));
  const inBlock = (pos) => ranges.some(([a, b]) => pos > a && pos < b);
  let off = 0; let bad = '';
  for (const line of four.split('\n')) {
    const n = /^ */.exec(line)[0].length;
    if (!inBlock(off) && n % 4 !== 0 && !bad) bad = JSON.stringify(line);
    off += line.length + 1;
  }
  check(name + ': structural indentation is a multiple of 4', !bad, bad);
}

const SMALL = 'type Query {\n  """\n  Returns a user.\n    Indented note.\n  """\n  user(id: ID!): User\n}';
check('literal 4-space output', format(SMALL, '    ') === 'type Query {\n    """\n    Returns a user.\n      Indented note.\n    """\n    user(id: ID!): User\n}', format(SMALL, '    '));
check('description value', blockValues(parse(format(SMALL, '    ')))[0] === 'Returns a user.\n  Indented note.');

for (const lang of ['en', 'zh', 'ja', 'ko']) {
  const mdx = readFileSync(join(root, 'src/content/tools/graphql-formatter', lang + '.mdx'), 'utf8');
  check(lang + ': page no longer says 4-space mode changes block strings', !/doubl|加倍|2 倍|두 배/.test(mdx), lang);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
