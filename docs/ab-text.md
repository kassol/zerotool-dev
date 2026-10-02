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

## Release handoff

The fixed item list remains read-only. These changes do not close the items;
production build, complete tests and production evidence remain release-line work.
