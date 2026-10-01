// SQL Formatter — parenthesis nesting (CTEs, subqueries, function calls) regression test
//
// Read:  src/components/tools/SqlFormatterTool.astro (extracts the real engine block
//        between the `engine:start` / `engine:end` markers, so this test cannot drift
//        from the shipped source)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Covers: formatSQL — a function call inside a CTE or subquery keeps its ")" on the same line
// and does not end the subquery indentation early; commas inside function arguments do not
// split SELECT fields; a subquery in the SELECT list is indented under its field and the
// fields after it are still split; nested subqueries; parenthesized expressions right after
// SELECT; the documented examples (JOIN query, WHERE IN subquery) are unchanged; an unmatched
// ")" does not throw; tab indent; lowercase keywords; minifySQL output is unchanged.
//
// Run: node scripts/test-sql-formatter.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'src/components/tools/SqlFormatterTool.astro'), 'utf8');

const START_MARK = '/* ── engine:start ── */';
const END_MARK = '/* ── engine:end ── */';
const startIndex = source.indexOf(START_MARK);
const endIndex = source.indexOf(END_MARK);
if (startIndex < 0 || endIndex <= startIndex) {
  console.error('FAIL: could not locate the engine block in SqlFormatterTool.astro');
  process.exit(1);
}
const block = source.slice(startIndex, endIndex);
const E = new Function(block + '\nreturn { formatSQL, minifySQL };')();

let failures = 0;
let passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}
function eq(name, actual, expected) {
  check(name, actual === expected, '\n--- got ---\n' + actual + '\n--- expected ---\n' + expected);
}
const fmt = (sql, indent = '  ', upper = true) => E.formatSQL(sql, indent, upper);
const lines = (...l) => l.join('\n');

// ---------- the reported defect: function call inside a CTE ----------
eq('CTE with SUM()',
  fmt('with recent as (select user_id, sum(total) as spent from orders where created_at > 100 group by user_id) select u.name, r.spent from users u join recent r on r.user_id = u.id order by r.spent desc;'),
  lines(
    'WITH recent AS (',
    '  SELECT',
    '    user_id,',
    '    SUM(total) AS spent',
    '  FROM orders',
    '  WHERE created_at > 100',
    '  GROUP BY user_id',
    ')',
    'SELECT',
    '  u.name,',
    '  r.spent',
    'FROM users u',
    'JOIN recent r ON r.user_id = u.id',
    'ORDER BY r.spent DESC;',
  ));

eq('function call with several arguments inside a subquery',
  fmt('select * from t where id in (select coalesce(a, b, 0) from v where x > 1)'),
  lines(
    'SELECT',
    '  *',
    'FROM t',
    'WHERE id IN (',
    '  SELECT',
    '    coalesce(a, b, 0)',
    '  FROM v',
    '  WHERE x > 1',
    ')',
  ));

eq('nested function calls in a CTE',
  fmt('with s as (select round(avg(price), 2) as p from items) select p from s'),
  lines(
    'WITH s AS (',
    '  SELECT',
    '    ROUND(AVG(price), 2) AS p',
    '  FROM items',
    ')',
    'SELECT',
    '  p',
    'FROM s',
  ).replace('ROUND', 'round'));

eq('window function with ORDER BY inside a CTE',
  fmt('with r as (select id, row_number() over (partition by g order by t desc) as rn from events) select * from r where rn = 1'),
  lines(
    'WITH r AS (',
    '  SELECT',
    '    id,',
    '    row_number() over(partition BY g ORDER BY t DESC) AS rn',
    '  FROM events',
    ')',
    'SELECT',
    '  *',
    'FROM r',
    'WHERE rn = 1',
  ));

// ---------- subquery in the SELECT list ----------
eq('scalar subquery as a field',
  fmt('select a, (select max(x) from t) as m, b from u'),
  lines(
    'SELECT',
    '  a,',
    '  (',
    '    SELECT',
    '      MAX(x)',
    '    FROM t',
    '  ) AS m,',
    '  b',
    'FROM u',
  ));

// ---------- nested subqueries ----------
eq('subquery inside subquery',
  fmt('select * from a where id in (select a_id from b where c_id in (select id from c where n = count(1)))'),
  lines(
    'SELECT',
    '  *',
    'FROM a',
    'WHERE id IN (',
    '  SELECT',
    '    a_id',
    '  FROM b',
    '  WHERE c_id IN (',
    '    SELECT',
    '      id',
    '    FROM c',
    '    WHERE n = COUNT(1)',
    '  )',
    ')',
  ));

eq('parenthesized expression as the first field',
  fmt('select (a + b) as s, c from t'),
  lines('SELECT', '  (a + b) AS s,', '  c', 'FROM t'));

// ---------- documented examples stay the same ----------
eq('JOIN example from the tool page',
  fmt('select u.id, u.name, o.total from users u join orders o on u.id = o.user_id where o.total > 100 and u.active = 1 order by o.total desc limit 10;'),
  lines('SELECT', '  u.id,', '  u.name,', '  o.total', 'FROM users u', 'JOIN orders o ON u.id = o.user_id', 'WHERE o.total > 100', '  AND u.active = 1', 'ORDER BY o.total DESC', 'LIMIT 10;'));
eq('subquery example from the tool page',
  fmt('select * from users where id in (select user_id from orders where total > 100);'),
  lines('SELECT', '  *', 'FROM users', 'WHERE id IN (', '  SELECT', '    user_id', '  FROM orders', '  WHERE total > 100', ');'));

// ---------- options and robustness ----------
eq('tab indent', fmt('with r as (select sum(x) from t) select 1', '\t'),
  lines('WITH r AS (', '\tSELECT', '\t\tSUM(x)', '\tFROM t', ')', 'SELECT', '\t1'));
eq('lowercase keywords', fmt('WITH r AS (SELECT SUM(x) FROM t) SELECT 1', '  ', false),
  lines('with r as (', '  select', '    sum(x)', '  from t', ')', 'select', '  1'));
let threw = false;
try { fmt('select a) from t'); } catch { threw = true; }
check('unmatched ) does not throw', !threw);
eq('empty input', fmt('   '), '');

// ---------- examples on the English tool page ----------
eq('page: aggregates and comments',
  fmt("select status, count(*) as n -- per status\nfrom orders /* this year */ where created_at >= '2026-01-01' group by status having count(*) > 5 order by n desc;"),
  lines('SELECT', '  status,', '  COUNT(*) AS n -- per status', 'FROM orders /* this year */',
    "WHERE created_at >= '2026-01-01'", 'GROUP BY status', 'HAVING COUNT(*) > 5', 'ORDER BY n DESC;'));
eq('page: update', fmt("update orders set status = 'shipped', shipped_at = now() where id = 42;"),
  lines('UPDATE orders', "SET status = 'shipped', shipped_at = now()", 'WHERE id = 42;'));
eq('page: insert', fmt("insert into users (name, email) values ('Ann', 'ann@example.com'), ('Bo', 'bo@example.com');"),
  lines('INSERT INTO users(name, email)', "VALUES('Ann', 'ann@example.com'),('Bo', 'bo@example.com');"));
eq('page: lowercase keywords', fmt("Select Id From Users Where Name Like 'A%'", '  ', false),
  lines('select', '  Id', 'from Users', "where Name like 'A%'"));
eq('page: quoted names and doubled quotes', fmt("SELECT \"Order Id\", `name` FROM t WHERE note = 'it''s here'"),
  lines('SELECT', '  "Order Id",', '  `name`', 'FROM t', "WHERE note = 'it''s here'"));

// ---------- minify unchanged ----------
eq('minify', E.minifySQL('WITH r AS (\n  SELECT SUM(total) -- c\n  FROM t\n) SELECT 1;'), 'WITH r AS(SELECT SUM(total)FROM t)SELECT 1;');

console.log((failures ? 'FAILED' : 'PASSED') + ': ' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
