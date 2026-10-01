// Regex Tester — styles for the match list, and the results quoted on the en tool page
//
// Read:  src/components/tools/RegexTesterTool.astro, src/content/tools/regex-tester/en.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// The match list (ul.rgx-match-list, span.rgx-pos, ul.rgx-groups) is built with innerHTML, so it
// does not get Astro's scope attribute; before the fix its rules were plain scoped selectors and
// never applied (the list kept browser bullets and no borders). They must be written as
// `.rgx-matches :global(...)` (AGENTS.md rule 11). The second part runs the patterns from the
// page's "Tested Patterns" table and "Flags in Practice" list with the same loop as the tool
// (always global, zero-length matches advance lastIndex) and compares the matches and indexes.
//
// Run: node scripts/test-regex-tester.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(root, 'src/components/tools/RegexTesterTool.astro'), 'utf8');
const style = src.slice(src.indexOf('<style>'), src.indexOf('</style>'));
const script = src.slice(src.indexOf('<script'), src.indexOf('</script>'));

let passes = 0, failures = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + g + '\n  expected: ' + w); }
}

for (const cls of ['rgx-match-list', 'rgx-pos', 'rgx-groups']) {
  eq(`script creates .${cls}`, script.includes(cls), true);
  const uses = [...style.matchAll(new RegExp('(\\.rgx-matches :global\\()?\\.' + cls + '(?![\\w-])', 'g'))];
  eq(`.${cls} has rules, all under .rgx-matches :global(...)`, uses.length > 0 && uses.every((m) => m[1]), true);
}

// Same loop as run() in the component
function run(pattern, flags, text) {
  const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push([m[0], m.index, ...Array.from(m).slice(1)]);
    if (m[0].length === 0) re.lastIndex++;
    if (!flags.includes('g')) break;
  }
  return out;
}
eq('greedy', run('<.+>', 'g', '<a>foo</a>').map((m) => m[0]), ['<a>foo</a>']);
eq('lazy', run('<.+?>', 'g', '<a>foo</a>').map((m) => m[0]), ['<a>', '</a>']);
eq('signed decimal', run('-?\\d+(?:\\.\\d+)?', 'g', 'temp -3.5, max 42').map((m) => m[0]), ['-3.5', '42']);
eq('hex colors', run('#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})\\b', 'g', '#fff #1a73e8 #12345g').map((m) => m[0]), ['#fff', '#1a73e8']);
eq('lookbehind', run('(?<=\\$)\\d+', 'g', 'cost $42').map((m) => m[0]), ['42']);
eq('named groups listed by number', run('^(?<ts>\\S+)\\s+(?<level>\\w+)\\s+(?<msg>.+)$', 'g', '2026-04-07T14:23:01 ERROR connection refused')[0].slice(2), ['2026-04-07T14:23:01', 'ERROR', 'connection refused']);
eq('date format only', run('^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$', 'g', '2026-02-31').length, 1);
eq('\\w is ASCII only', run('\\w+', 'g', 'café 東京').map((m) => m[0]), ['caf']);
eq('no u flag: \\p{L} is literal', run('\\p{L}', 'g', 'p{L} a').map((m) => m[0]), ['p{L}']);
const LOG = 'ERROR disk full\nWARN retry 3\nERROR timeout';
eq('^ERROR with g', run('^ERROR .+', 'g', LOG).map((m) => [m[0], m[1]]), [['ERROR disk full', 0]]);
eq('^ERROR with gm', run('^ERROR .+', 'gm', LOG).map((m) => [m[0], m[1]]), [['ERROR disk full', 0], ['ERROR timeout', 29]]);
eq('dot without s', run('a.b', 'g', 'a\nb').length, 0);
eq('dot with s', run('a.b', 'gs', 'a\nb').length, 1);
eq('i does not ignore accents', run('cafe', 'gi', 'Café CAFE cafe').map((m) => m[0]), ['CAFE', 'cafe']);
eq('emoji adds 2 to the index', run('\\d', 'g', '😀 id=7')[0][1], 6);
const mdx = readFileSync(join(root, 'src/content/tools/regex-tester/en.mdx'), 'utf8');
eq('page states index 29', mdx.includes('the second at index 29'), true);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
