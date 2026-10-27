# W6 batch 2 — json-schema-validator fact check (2026-10-27)

Scope: en/zh/ja/ko tool MDX and visible copy in `JsonSchemaValidatorTool.astro`. Engine blocks, logic, tests and other tools were not edited. Sources were retrieved on 2026-10-27; undated help pages can change.

## Corrections

| # | Claim (original) | Why it was wrong / misleading | Files changed |
|---|---|---|---|
| 1 | `$recursiveRef` "whose first target has no `$recursiveAnchor: true`" is always "cannot be determined" | Engine only flags it when another resource has the anchor; a plain `$recursiveRef` without any anchor behaves as `$ref` (2019-09). | en:179, zh:177 |
| 2 | "`unevaluatedItems` / `unevaluatedProperties` together with `contains`", and separate `if` / branch-`items` cases | Engine pairs `contains` and branch `items` only with `unevaluatedItems`; a partial `if` matters only with `unevaluatedItems` or `unevaluatedProperties`. | en:179, zh:177, ja:155 |
| 3 | "No browser-side validator can get the 2^53 case right" | A validator can read the number source; only comparing the numbers `JSON.parse` returns loses the distinction. Narrowed in en and zh. | en:208, zh:67 |
| 4 | "YAML errors show the path only" | YAML **syntax** errors do carry line and column (`parseErrorText`; the test asserts line 2). Only YAML data **validation** errors lack a line. | en:215, zh:155, ja:180, ko:190 |
| 5 | "Duplicate keys keep the last value" (unqualified) | YAML duplicate keys are a js-yaml parse error; last-wins is JSON only. | en:214, zh:179, ja:179, ko:189 |
| 6 | "Inputs over 1 MB"; "files over 20 MB" | `AUTO_LIMIT` is 1,000,000 UTF-16 code units; `FILE_LIMIT` is 20×1024×1024 bytes (20 MiB). | en:216, zh:180, ja:181, ko:191; component `fileTooBig` |
| 7 | Numeric keyword list omitted `exclusiveMinimum` / `exclusiveMaximum` | `NUMERIC_KEYWORDS` includes both, so an inexact number with either keyword also yields "Cannot be determined". | en:214 |

No change was made for statements that remain accurate: draft list and menu override; draft-04 boolean bounds and `id`; 2020-12 boolean `exclusiveMaximum` invalid; `format` 15-name list and annotation-off default; `$ref` siblings ignored in drafts 4–7; `nullable` ignored; unknown keywords listed; `$dynamicRef` partial Ajv support; `$ref` URLs never fetched; `multipleOf` decimal check; storage, GA/AdSense and event wording.

## Sources

- JSON Schema draft-07 core §8.3 (`$ref` siblings), <https://json-schema.org/draft-07/draft-handrews-json-schema-01>
- JSON Schema 2020-12 validation §7.2.1 (`format` annotation default), <https://json-schema.org/draft/2020-12/json-schema-validation#section-7.2.1>; current draft, <https://json-schema.org/specification>
- Draft-04 validation §5.1.2.1 / §5.1.3.1 (boolean exclusive bounds), <https://json-schema.org/draft-04/draft-fge-json-schema-validation-00>; draft-04 core `id`, <https://datatracker.ietf.org/doc/html/draft-zyp-json-schema-04>
- Python jsonschema: default latest released draft; no format validation without a checker, <https://python-jsonschema.readthedocs.io/en/stable/validate/>
- Go santhosh-tekuri/jsonschema v6: latest implemented draft when `$schema` is missing, <https://pkg.go.dev/github.com/santhosh-tekuri/jsonschema/v6>
- YAML 1.2.2 core schema (dates and `yes`/`no` are strings), <https://yaml.org/spec/1.2.2/#103-core-schema>
- Ajv JSON Schema docs (`$dynamicRef` listed; `new RegExp(value, "u")`), <https://ajv.js.org/json-schema.html>
- RFC 8259 §4 (duplicate names are undefined behaviour), <https://www.rfc-editor.org/rfc/rfc8259#section-4>; JSON Lines, <https://jsonlines.org/>
- JSON Schema Test Suite, <https://github.com/json-schema-org/JSON-Schema-Test-Suite>; bundled fixture commit `5b0ee1613e45fcc2bddac00e07c19cd49b00d8a8`
- Apple QA1173 (HFS+ NFD filenames), <https://developer.apple.com/library/archive/qa/qa1173/_index.html>

## Unverified / unchanged

- Competitor tables (2026-10-02) were not re-run; they remain dated observations.
- The 6 MB / 2 s timing was not re-run.
- Word's AutoFormat As You Type path (`local-smart-quotes`) was not rechecked today.
- Python jsonschema 4.26.0 was checked against its documentation; the local comparison installed 4.23.0 (test skips 4.26-only rows).
- Test Suite counts match the bundled fixture; the page does not date or pin the suite.
- JSON Lines is recognised only when the first non-blank line starts with `{` or `[`; the FAQ wording was left as the format definition and recorded as qualified.
- Out of scope: `scripts/AGENTS.md:351` still records the older 617/618, 840/841, 928/929, 1,243/1,261, 1,249/1,301 counts; the test now asserts 616/618, 839/841, 927/929, 1,230/1,261, 1,210/1,301.

## Implementation anchors

`engine` = `src/components/tools/json-schema-validator-engine.js`; `component` = `src/components/tools/JsonSchemaValidatorTool.astro`.

- Draft map / default: `json-schema-validator-engine.js:14-24, 100-125`; menu and prefs `JsonSchemaValidatorTool.astro:959-978`.
- Format list: `engine:28-37, 127-148`; checkbox `component:769`.
- `$ref` siblings / removed keywords: `engine:39-60, 221-337`.
- Known Ajv limitations: `engine:371-400`.
- Exact numbers / duplicate scan: `engine:675-745`; run `engine:1039-1085`.
- YAML / JSON Lines: `engine:752-800`.
- Size: `component:873-875, 1306`; events / copy `component:1245-1250, 1335-1349`.
- Test suite fixture: `scripts/test-json-schema-validator.mjs:130-180`.

## Tests

- `node scripts/test-json-schema-validator.mjs` before edits: 1,688 passed, 0 failed, 2 skipped.
- After edits: 1,688 passed, 0 failed, 2 skipped. Suite: 616/618, 839/841, 927/929, 1,230/1,261, 1,210/1,301; 0 wrong.
- `node scripts/test-tool-mdx-contract.mjs`: 174 passed. `node scripts/test-tool-content-parity.mjs`: 7,753 passed.
- MDX compile check of the four edited files: all ok. Only the five scoped files were edited; other working-tree changes are outside this batch.
