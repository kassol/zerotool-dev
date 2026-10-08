#!/usr/bin/env node
// Site-wide S2 content parity check for the tool pages (S2-PLAN.md §4.4, 2026-10-08).
//
// Every tool: the MDX contract of scripts/lib/tool-mdx-contract.mjs (four files, steps
// limits, nonempty FAQ items, no Usage section, equal FAQ and step counts).
// Tools not in S2_PENDING, in addition: a Limits section (three v2 samples exempt), FAQ ids
// with the same sequence in the four languages, at least 3 common questions including
// `privacy` (until the tool leaves FAQ_IDS_TODO), H2 sequences that differ between
// languages, and body text at or above BODY_FLOOR (page-quality standard §0 units).
// It also checks that the S2 lists in the library still describe the files.
// Run: node scripts/test-tool-content-parity.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BODY_FLOOR, FAQ_COUNT_MISMATCH, FAQ_IDS_TODO, LANGS, LIMITS_EXEMPT, LIMITS_HEADINGS, PRIVACY_ID, ROOT,
  S2_PENDING, STEPS_COUNT_MISMATCH, bodySize, headings, toolMdxContract,
} from './lib/tool-mdx-contract.mjs';

let passes = 0, failures = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else { failures++; console.log(`FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

const toolsTs = readFileSync(join(ROOT, 'src', 'data', 'tools.ts'), 'utf8');
const slugs = [...toolsTs.matchAll(/\{ slug: '([a-z0-9-]+)'/g)].map((m) => m[1]).sort();
const dirs = readdirSync(join(ROOT, 'src', 'content', 'tools')).sort();
check('tools.ts lists 141 tools', slugs.length === 141, String(slugs.length));
check('every tool has a content directory and no extra directories', JSON.stringify(dirs) === JSON.stringify(slugs), dirs.filter((d) => !slugs.includes(d)).concat(slugs.filter((s) => !dirs.includes(s))).join(', '));

// ── The lists stay accurate ─────────────────────────────────────────────────
const known = new Set(slugs);
for (const [name, set] of Object.entries({ S2_PENDING, FAQ_COUNT_MISMATCH, STEPS_COUNT_MISMATCH, FAQ_IDS_TODO, LIMITS_EXEMPT })) {
  const unknown = [...set].filter((s) => !known.has(s));
  check(`${name} names only registered tools`, unknown.length === 0, unknown.join(', '));
}
for (const s of Object.keys(LIMITS_HEADINGS)) check(`LIMITS_HEADINGS names a registered tool: ${s}`, known.has(s));
const both = [...FAQ_IDS_TODO].filter((s) => S2_PENDING.has(s));
check('FAQ_IDS_TODO and S2_PENDING do not overlap', both.length === 0, both.join(', '));

const docsOf = new Map();
for (const slug of slugs) docsOf.set(slug, toolMdxContract(slug));
const faqsOf = (slug) => LANGS.map((l) => docsOf.get(slug).docs[l].data?.faqItems ?? []);
const stepsOf = (slug) => LANGS.map((l) => docsOf.get(slug).docs[l].data?.steps ?? []);

for (const s of FAQ_COUNT_MISMATCH) {
  check(`FAQ_COUNT_MISMATCH: ${s} is pending`, S2_PENDING.has(s));
  const counts = faqsOf(s).map((f) => f.length);
  check(`FAQ_COUNT_MISMATCH: ${s} counts still differ (remove it when they match)`, new Set(counts).size > 1, counts.join('/'));
}
for (const s of STEPS_COUNT_MISMATCH) {
  const counts = stepsOf(s).map((f) => f.length);
  check(`STEPS_COUNT_MISMATCH: ${s} counts still differ (remove it when they match)`, new Set(counts).size > 1, counts.join('/'));
}
for (const s of FAQ_IDS_TODO) {
  const withId = faqsOf(s).flat().filter((f) => f?.id !== undefined).length;
  check(`FAQ_IDS_TODO: ${s} has no FAQ ids yet (remove it when ids are added)`, withId === 0, `${withId} items with id`);
}

// ── Every tool: the basic contract ───────────────────────────────────────────
for (const slug of slugs) {
  for (const r of docsOf.get(slug).results) check(r.message, r.ok);
}

// ── Tools that finished S2 (or were never in it): all rules ──────────────────
const done = slugs.filter((s) => !S2_PENDING.has(s));
for (const slug of done) {
  const { docs } = docsOf.get(slug);
  if (!FAQ_IDS_TODO.has(slug)) {
    for (const r of toolMdxContract(slug, { requireFaqIds: true }).results.filter((r) => /FAQ id/.test(r.rule))) check(r.message, r.ok);
    const common = faqsOf(slug)[0].map((f) => f?.id).filter((id) => typeof id === 'string' && !id.startsWith('local-'));
    check(`${slug} has at least 3 common FAQ questions`, common.length >= 3, common.join(', '));
    check(`${slug} has the common FAQ question "${PRIVACY_ID}"`, common.includes(PRIVACY_ID), common.join(', '));
    for (const lang of LANGS) {
      const locals = faqsOf(slug)[LANGS.indexOf(lang)].filter((f) => String(f?.id).startsWith('local-')).length;
      check(`${slug} ${lang} has at most 1 local FAQ question`, locals <= 1, String(locals));
    }
  }
  const h2 = LANGS.map((l) => JSON.stringify(headings(docs[l].body)));
  for (let i = 0; i < LANGS.length; i++) {
    for (let j = i + 1; j < LANGS.length; j++) {
      check(`${slug} ${LANGS[i]} and ${LANGS[j]} H2 sequences differ`, h2[i] !== h2[j], h2[i]);
    }
  }
  for (const lang of LANGS) {
    const size = bodySize(lang, docs[lang].body);
    check(`${slug} ${lang} body is at least ${BODY_FLOOR[lang]}`, size >= BODY_FLOOR[lang], String(size));
  }
}

console.log(`\n${slugs.length} tools: ${done.length} with all rules, ${S2_PENDING.size} pending (basic checks only), ${FAQ_IDS_TODO.size} without FAQ ids yet`);
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
