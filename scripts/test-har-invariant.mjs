// HAR Waterfall Invariant — spec-driven regression test
//
// Read: this file (self-contained, no external file I/O)
// Write: stdout only (test results)
// Exit: 0 if all PASS, 1 if any FAIL
//
// SPEC ANCHOR (accessed 2026-05-22):
//   HAR 1.2 — https://w3c.github.io/web-performance/specs/HAR/Overview.html
//   timings: blocked, dns, connect, ssl, send, wait, receive (-1 = N/A)
//   "If ssl is defined then the time is also included in the connect field
//    (to ensure backward compatibility with HAR 1.1)."
//   ⇒ entry.time = blocked + dns + connect + send + wait + receive   (ssl 不入和)
//
// Layered design:
//   1. specSum() — independent spec-formula computation, decoupled from source code
//   2. mirrorPhaseSegments() / mirrorInvariant() — mirror current source phase logic
//      (src/components/tools/HarFileAnalyzerTool.astro phaseSegments + ingest invariantOk)
//   3. oldBuggyPhaseSegments() / oldBuggyInvariant() — regression guard against
//      the Phase 3 v1 `connect + ssl` double-counting bug
//
// Run: node scripts/test-har-invariant.mjs

// ---------- spec-driven 独立计算（不依赖源算法）----------
function specSum(timings) {
  function v(name) { var x = Number(timings[name]); return isFinite(x) && x > 0 ? x : 0; }
  return v('blocked') + v('dns') + v('connect') + v('send') + v('wait') + v('receive');
}

// ---------- mirror 当前源代码（新算法）----------
function mirrorPhaseSegments(timings) {
  function v(name) { var x = Number(timings[name]); return isFinite(x) ? x : -1; }
  var blocked = v('blocked'), dns = v('dns'), connect = v('connect'), ssl = v('ssl'),
      send = v('send'), wait = v('wait'), receive = v('receive');
  var connectDur = connect >= 0 ? connect : (ssl >= 0 ? ssl : -1);
  return [
    { key: 'queued', dur: blocked },
    { key: 'dns', dur: dns },
    { key: 'connect', dur: connectDur },
    { key: 'send', dur: send },
    { key: 'wait', dur: wait },
    { key: 'receive', dur: receive },
  ];
}
function mirrorInvariant(entryTime, timings) {
  const phases = mirrorPhaseSegments(timings);
  const sum = phases.reduce((a, p) => a + (p.dur > 0 ? p.dur : 0), 0);
  return { sum, ok: Math.abs(entryTime - sum) < 1.5 };
}

// ---------- 旧错算法（regression guard，mirror Phase 3 v1 错误实现）----------
function oldBuggyPhaseSegments(timings) {
  function v(name) { var x = Number(timings[name]); return isFinite(x) ? x : -1; }
  var blocked = v('blocked'), dns = v('dns'), connect = v('connect'), ssl = v('ssl'),
      send = v('send'), wait = v('wait'), receive = v('receive');
  var connectMerged = -1;
  if (connect >= 0 && ssl >= 0) connectMerged = connect + ssl;   // ← bug
  else if (connect >= 0) connectMerged = connect;
  else if (ssl >= 0) connectMerged = ssl;
  return [
    { key: 'queued', dur: blocked },
    { key: 'dns', dur: dns },
    { key: 'connect', dur: connectMerged },
    { key: 'send', dur: send },
    { key: 'wait', dur: wait },
    { key: 'receive', dur: receive },
  ];
}
function oldBuggyInvariant(entryTime, timings) {
  const phases = oldBuggyPhaseSegments(timings);
  const sum = phases.reduce((a, p) => a + (p.dur > 0 ? p.dur : 0), 0);
  return { sum, ok: Math.abs(entryTime - sum) < 1.5 };
}

// ---------- fixtures: spec-driven ----------
// 每个 fixture: timings + entry.time 按 spec 计算；新算法应 OK，旧算法对触发场景应 FAIL
const fixtures = [
  {
    name: 'S1 — spec-compliant sample (connect includes ssl, ssl listed separately)',
    timings: { blocked: 5, dns: 20, connect: 55, ssl: 25, send: 10, wait: 100, receive: 60 },
    // spec sum: 5+20+55+10+100+60 = 250 (ssl not added)
    entryTime: 250,
    expectSpec: true,
    expectNew: true,
    expectOldBuggy: false, // 旧算法 sum=275, diff=25 > 1.5 → false → 证明 v1 实现确实错
  },
  {
    name: 'S2 — Chrome-typical sample (connect contains ssl, ssl=25 listed)',
    timings: { blocked: 1, dns: 5, connect: 40, ssl: 25, send: 0.5, wait: 80, receive: 30 },
    entryTime: 156.5, // 1+5+40+0.5+80+30 = 156.5
    expectSpec: true,
    expectNew: true,
    expectOldBuggy: false,
  },
  {
    name: 'S3 — Firefox-compatible: ssl=-1 (merged into connect or non-HTTPS)',
    timings: { blocked: 5, dns: 20, connect: 30, ssl: -1, send: 10, wait: 100, receive: 60 },
    entryTime: 225, // 5+20+30+10+100+60
    expectSpec: true,
    expectNew: true,
    expectOldBuggy: true, // 旧算法在 ssl=-1 时不触发 bug
  },
  {
    name: 'S4 — ssl-only fallback (connect=-1, ssl=25, non-spec exporter tolerance)',
    timings: { blocked: 5, dns: 20, connect: -1, ssl: 25, send: 10, wait: 100, receive: 60 },
    // spec 严格: connect=-1 视为 0，ssl 不入和 → spec_sum = 195
    // 但实际场景含义: exporter 把 ssl 写到 ssl 字段，应被理解为 connect=ssl 含 SSL → entry.time=220
    // 此 fixture 故意 entryTime=220，揭示 spec sum 与新算法兜底的差异
    entryTime: 220,
    expectSpec: false, // spec 严格下不该等于 220 (sanity 检测应记录差异)
    expectNew: true,   // Coder 兜底: connectDur=ssl=25, sum=220 → ok
    expectOldBuggy: true, // 旧算法 connect=-1 也走 ssl branch，结果同新算法
  },
  {
    name: 'S5 — all -1 (cached / synthetic / from-cache entry)',
    timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: -1, wait: -1, receive: -1 },
    entryTime: 0,
    expectSpec: true,
    expectNew: true,
    expectOldBuggy: true,
  },
  {
    name: 'S6 — blocked=-1 (connection reuse)',
    timings: { blocked: -1, dns: 0, connect: 0, ssl: -1, send: 0.5, wait: 80, receive: 30 },
    entryTime: 110.5, // 0+0+0.5+80+30 (blocked treated as 0)
    expectSpec: true,
    expectNew: true,
    expectOldBuggy: true,
  },
  {
    name: 'S7 — float drift 0.8ms (within tolerance)',
    timings: { blocked: 1, dns: 5, connect: 40, ssl: 25, send: 0.5, wait: 80, receive: 30 },
    entryTime: 157.3, // spec expected 156.5; diff = 0.8
    expectSpec: true,
    expectNew: true,
    expectOldBuggy: false, // 旧算法 sum=181.5, diff=24.2 > 1.5
  },
  {
    name: 'S8 — float drift 2.0ms (over tolerance, new impl should reject)',
    timings: { blocked: 1, dns: 5, connect: 40, ssl: 25, send: 0.5, wait: 80, receive: 30 },
    entryTime: 158.5, // spec expected 156.5; diff = 2.0
    expectSpec: false,
    expectNew: false,
    expectOldBuggy: false,
  },
  {
    name: 'S9 — missing phase fields (HAR 1.1 / legacy exporter)',
    timings: { dns: 20, connect: 50, wait: 60 },
    entryTime: 130, // 20+50+60
    expectSpec: true,
    expectNew: true,
    expectOldBuggy: true,
  },
  {
    name: 'S10 — counter-example: entry.time deliberately off by 20ms',
    timings: { blocked: 5, dns: 20, connect: 30, ssl: -1, send: 10, wait: 100, receive: 60 },
    entryTime: 245, // spec sum=225, deliberately +20
    expectSpec: false,
    expectNew: false,
    expectOldBuggy: false,
  },
];

// ---------- Layer 1: spec sum self-check ----------
console.log('HAR Waterfall Invariant — spec-driven regression test\n');
console.log('Spec anchor: https://w3c.github.io/web-performance/specs/HAR/Overview.html\n');
console.log('Layer 1 — spec sum sanity (entry.time matches independent spec computation, per expectSpec):');
let l1Pass = 0, l1Fail = 0;
for (const f of fixtures) {
  const sum = specSum(f.timings);
  const within = Math.abs(f.entryTime - sum) < 1.5;
  const expectMatch = f.expectSpec === within;
  if (expectMatch) l1Pass++; else l1Fail++;
  console.log(`  ${expectMatch ? 'PASS' : 'FAIL'}  ${f.name}  spec_sum=${sum} entry.time=${f.entryTime} spec_within=${within} expectSpec=${f.expectSpec}`);
}

// ---------- Layer 2: new impl mirror, should match expectNew ----------
console.log('\nLayer 2 — new source impl (mirrored) matches expectNew:');
let l2Pass = 0, l2Fail = 0;
for (const f of fixtures) {
  const r = mirrorInvariant(f.entryTime, f.timings);
  const ok = r.ok === f.expectNew;
  if (ok) l2Pass++; else l2Fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${f.name}  src_sum=${r.sum} src_ok=${r.ok} expected=${f.expectNew}`);
}

// ---------- Layer 3: old buggy impl regression guard, should match expectOldBuggy ----------
console.log('\nLayer 3 — old (buggy) impl regression guard matches expectOldBuggy:');
let l3Pass = 0, l3Fail = 0;
for (const f of fixtures) {
  const r = oldBuggyInvariant(f.entryTime, f.timings);
  const ok = r.ok === f.expectOldBuggy;
  if (ok) l3Pass++; else l3Fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${f.name}  old_sum=${r.sum} old_ok=${r.ok} expected=${f.expectOldBuggy}`);
}

// ---------- Summary ----------
const total = fixtures.length;
console.log(`\nSummary:`);
console.log(`  Layer 1 (spec sum)        : PASS ${l1Pass} / FAIL ${l1Fail} / TOTAL ${total}`);
console.log(`  Layer 2 (new impl mirror) : PASS ${l2Pass} / FAIL ${l2Fail} / TOTAL ${total}`);
console.log(`  Layer 3 (old regression)  : PASS ${l3Pass} / FAIL ${l3Fail} / TOTAL ${total}`);
const allOk = (l1Fail + l2Fail + l3Fail) === 0;
console.log(`\nOverall: ${allOk ? 'PASS' : 'FAIL'}`);
process.exit(allOk ? 0 : 1);
