# AB text fixes

Scope: `fix/ab-text`, based on `8d1d71ad1a9ff83192e4e2ba18d6d5147db4a39b`.
Only the three text tools, their tests and four-language tool content change.
No dependencies, shared modules, full build, merge, push or release actions.
Shared AGENTS change logs and final site validation belong to the release branch.

## B-REGEX-BACKTRACK-MAINTHREAD

- `RegexTesterTool.astro`: native RegExp in a terminable Blob Worker, 2 s deadline,
  cancellation, input generation invalidation and pagehide cleanup. No page-thread fallback.
- Completed runs count all matches. Highlight: 100,000 UTF-16 units / 1,000 matches.
  List: 100 matches / 20 groups / 1,000 units per value / 100,000 units total.
- Real input-listener regression: red 22 pass / 3 fail; green 99 pass / 0 fail,
  Node 22.23.3. Existing assertions remain.
- Actual Astro Container component preview, same browser and machine, one attempt
  per phase: `^(a+)+$`, 28 `a` plus `!`. Baseline total 2174.5 ms / longest
  longtask 1847 ms / DOM 41; current total 2408.7 ms (includes debounce and timeout),
  longest longtask 0 ms / DOM 43. Current run timed out with no complete result.
- Baseline page heap used 40,305,872 → 40,476,072 B; current after 243,663,489 B.
  Current before sample was empty because Performance.memory fields are not enumerable.
  Browser-wide heap samples include prior pages and do not establish a heap reduction.
  Load averages: baseline 5.37/5.88/8.49; current 7.70/8.07/8.65.
- Four-language matching, UTF-16 indices, groups and cancellation verified in Ego.
  Idle cancellation button is hidden. Evidence: `regex-{red,green}.log`,
  `regex-{baseline,current,browser}.json` in the external task evidence directory.

## B-DIFF-QUADRATIC-MEMORY design

- Replace the full LCS table with four rolling Uint32 rows. Propagate the old
  equal-first / add-on-tie traceback's crossing column at the middle row, then
  recurse on the two ranges. Release the rows before recursion.
- Prototype verification: 16,129 exhaustive pairs and 10,000 seeded random
  pairs have the exact old operation sequence. Keep the old pairing tests.
- Run comparison and row indexing in a terminable Blob Worker. Page both views
  by 100 rows; keep complete counts and result data in the Worker. Cancel,
  input, swap, clear and pagehide invalidate the prior generation.

### Verification and stop point

- Real Compare-click regression: red 5,982 pass / 3 fail (including the old
  traceback oracle); final targeted run 6,052 pass / 0 fail on Node 22.23.3.
  Evidence: `diff-oracle-red.log`, `diff-expanded-green.log`, `diff-final-green.log`
  in the external task evidence directory. Existing assertions remain.
- Tests execute the actual Blob Worker through worker_threads. Coverage includes
  four-language counts, 100-row pages, line numbers, both views, pairing,
  stale page replies, input/cancel/swap/clear/pagehide invalidation and Worker failure.
- Actual Astro Container preview serves the current component after the preview
  CSS-import fix. This is not full browser acceptance for Diff.
- Not completed: view changes during calculation and rapid-page race tests;
  four-language content updates; the fixed 10,000-line-per-side benchmark.
  Worker-inclusive comparable peak heap collection is unresolved, so neither
  the 50% peak reduction nor the 100 ms main-thread target is verified.

## B-ZEROWIDTH-DOM-VOLUME

No implementation or new regression/benchmark was started. Full scanning,
visualization and the existing download behavior remain unchanged.

## Release handoff

The fixed item list remains read-only. These changes do not close the items;
production build, complete tests and production evidence remain release-line work.
Work stopped at the user's closeout request after the one final Diff targeted run.
No full build, merge, push, tag or release was run. Keep the worktree and evidence.
Regex still needs comparable before/after heap evidence, including its Worker.
