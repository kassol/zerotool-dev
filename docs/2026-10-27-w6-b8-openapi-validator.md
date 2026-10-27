# W6 batch 8 — openapi-validator fact check (2026-10-27)

Scope: en/zh/ja/ko tool MDX, plus the visible copy in `OpenapiValidatorTool.astro`. The engine, Worker, scripts, analytics, `persistence.ts` and `network.ts` were not edited. Primary sources were retrieved on 2026-10-27.

## Result

136 statement records: 71 supported, 33 qualified, 31 corrected, 1 unverified. Nine corrections, applied consistently in all four languages where the claim exists. FAQ count, ids, order, `steps`, `seoTitle`, `engine:start/end`, persistence, network and analytics are unchanged. The single `unverified` record is the undated 2.7 s timing; the other figures that were not re-run today sit inside records that were corrected or qualified for another reason and are listed under "Unverified / unchanged".

## Corrections

| # | Claim (before) | Why it was wrong | Files changed |
|---|---|---|---|
| 1 | Privacy: "all checks run in a Web Worker" | The page falls back to `import('./openapi-validator-run.js')` when a Worker cannot start (`OpenapiValidatorTool.astro:803-811`). The privacy answer now says browser, Worker, or page if no Worker. | en:15, zh:15, ja:15, ko:15 |
| 2 | Large-file window: "up to 300 lines" | The window is also capped at 49,152 characters (`VIEW_LIMIT = 512*1024, WIN_LINES = 300, WIN_CHARS = 48*1024`, `OpenapiValidatorTool.astro:584`). Added in the en local FAQ and every limits list. | en:27, en:171, zh:172, ja:172, ko:163 |
| 3 | Limits: "$ref URLs are not fetched; add the files instead" | A URL reference is classified `url` before any file lookup (`openapi-validator-engine.js:188-196`) and stays a note (`:1125`); adding a file cannot satisfy it. Now: URL refs are notes and not checked; add the file only for a missing local file. | en:168, zh:169, ja:170, ko:160 |
| 4 | Table: "Every `$ref` points to something" | URL, anchor and missing-file refs are notes, not errors (`engine:1125-1131`). Row narrowed to local `$ref` in this file or another added file. | en:83, zh:149, ja:149, ko:140 |
| 5 | FAQ: "Notes list what was not checked" | Notes also carry caveats from checks that did run: approximate large integers (`engine:1175-1181`), unused components that may be used by missing files (`:1170`), example-budget stop (`:1168`). Now "what was not checked and values to keep in mind". | en:21, zh:21, ja:21, ko:21 |
| 6 | Limits: "over 2 MB … over 50 MB" | `AUTO_LIMIT = 2*1024*1024` UTF-16 code units and `LOAD_LIMIT = 50*1024*1024` bytes (`OpenapiValidatorTool.astro:578-579`). Replaced with 2,097,152 characters and 50 MiB. | en:170, zh:171, ja:171, ko:162 |
| 7 | ja warning row omitted `nullable` | The engine warns on `nullable` in 3.1/3.2 (`engine:894`); en/zh/ko already listed it. Added to the ja table. | ja:154 |
| 8 | Draft-04 citation: "§5.1.2.1" only | §5.1.2.1 is maximum/exclusiveMaximum; minimum/exclusiveMinimum is §5.1.3.1. Both are now cited. | en:89, zh:153, ja:153, ko:144 |
| 9 | ja: "OpenAPI 3.1 Schema is JSON Schema 2020-12 itself" | 3.1's Schema Object is a dialect based on 2020-12 plus the OAS base vocabulary (OAS 3.1.1 §4.8.20), not the 2020-12 meta-schema verbatim. Reworded to "a dialect based on 2020-12". | ja:84 |

Dated observations (competitor runs, GitHub/e-Gov/data.go.kr samples, the 32 s / 5 s timings) were left dated as written and are recorded as `qualified`.

## Verified as written

- **Versions and schemas.** Swagger 2.0 and OpenAPI 3.0/3.1/3.2 are the only accepted inputs (`engine:442-448`). All four local schema files are byte-identical to the first-party copies fetched today: `spec.openapis.org/oas/3.0/schema/2024-10-18`, `/3.1/schema/2026-08-03`, `/3.2/schema/2026-08-30`, and `OAI/OpenAPI-Specification/_archive_/schemas/v2.0/schema.json` (SHA-256 `b36871c8…`). The dates in the version FAQ are therefore correct.
- **Normative rules.** Same-template paths MUST NOT coexist; a parameter list MUST NOT contain duplicates; tag names MUST be unique; security requirement names MUST match a declared scheme; server-variable defaults SHOULD be in the enum in 3.0.4 and MUST be in 3.1.1. Each was quoted from the fetched 3.0.4 / 3.1.1 text and each has a matching engine rule (`engine:646-725`).
- **Boolean exclusive bounds.** Wright draft 00 §5.3/§5.5 keeps the boolean and defines it relative to `maximum`/`minimum` without requiring the pairing; draft 4 §5.1.2.1/§5.1.3.1 requires it. The 2.0 error / 3.0 warning split matches `boundaryChecks` (`engine:904-926`).
- **YAML.** `CORE_SCHEMA` plus merge keys (`engine:23`) keeps `2024-01-15` a string; duplicate mapping keys fail in JSON too; js-yaml 4.3.2 enforces 100 nesting levels, 10,000 merge work units and 100 mappings in one merge sequence (`node_modules/js-yaml/lib/loader.js:154-155, 375-378, 438`). The localized reasons name the numbers (`OpenapiValidatorTool.astro:120-124`).
- **Limits and storage.** 2,097,152 code units, 50 MiB total, 300 problems in the list first, 4 s example budget, 512 K / 300 lines / 49,152 characters window, 200,000-object bundle cap (`component:578-584`, `engine:1044-1045`). No `ztPersist`, no `persistence.ts` entry and no `network.ts` entry; the privacy answer's event timing matches `run()` / `schedule()` (`component:820-864`).
- **Examples.** All twelve `{/* ov */}` blocks still recompute to the displayed line, column, level and text in all four languages.

## Sources (retrieved 2026-10-27)

- OpenAPI 3.1.1: <https://spec.openapis.org/oas/v3.1.1.html> — Paths Object (templated-name MUST), Parameter Object (duplicate MUST), Security Requirement Object, Server Variable Object (enum MUST), Tag Object (unique MUST), §4.8.19.2 (examples SHOULD match the schema and serialized form), §4.8.19.3 (string value for non-JSON media types), §4.8.20 (Schema Object dialect, OAS base vocabulary).
- OpenAPI 3.0.4: <https://spec.openapis.org/oas/v3.0.4.html> — same clauses; server-variable enum is SHOULD.
- Schemas: <https://spec.openapis.org/oas/3.0/schema/2024-10-18>, <https://spec.openapis.org/oas/3.1/schema/2026-08-03>, <https://spec.openapis.org/oas/3.2/schema/2026-08-30>, <https://raw.githubusercontent.com/OAI/OpenAPI-Specification/main/_archive_/schemas/v2.0/schema.json>.
- JSON Schema validation: <https://www.ietf.org/archive/id/draft-fge-json-schema-validation-00.txt> §5.1.2.1/§5.1.3.1 (linked, not re-fetched today); <https://www.ietf.org/archive/id/draft-wright-json-schema-validation-00.txt> §5.3/§5.5.
- YAML 1.2.2 core schema: <https://yaml.org/spec/1.2.2/#1023-core-schema>.
- js-yaml 4.3.2: `node_modules/js-yaml/lib/loader.js`.

## Unverified / unchanged

- The en body's "2.7 seconds in Node.js 24" has no date and was not re-run. The 2026-10-02 batch report records 4.0 s inside the browser Worker and 7.8 s end to end, a different environment.
- The GitHub counts (2 errors, 187 example warnings, 7 unused schemas) are the dated 2026-10-02 observation; the 9.9 MB file was not re-fetched today.
- The e-Gov (ja) and data.go.kr (ko) sample results are dated 2026-10-02 / 2026-10-03 and were not re-run.
- The "about 10 MB stalls the page for about half a second" figure is the 2026-10-02 measurement and was not re-measured.
- The large-integer note says "larger than 2^53" but the engine flags every unsafe integer, including 2^53 and negative values. The string is asserted byte for byte by `scripts/test-openapi-validator.mjs:231-232`, so it was left unchanged.
- "2,097,152 characters" counts UTF-16 code units. The steps and the visible copy use the same wording; not changed.
- Competitor behaviour (Redocly 2.57.0, Spectral 6.17.0, swagger-parser 13.1.0, Swagger Editor 5.8.9, ApiNotes, APIMatic, Elysia Tools, AppKits, アサリツールズ, DevUtilities) was not re-run today and remains dated.

## Implementation anchors

`engine` = `src/components/tools/openapi-validator-engine.js`; `component` = `src/components/tools/OpenapiValidatorTool.astro`.

- Version selection: `engine:442-448`; schema imports `openapi-validator-run.js:8-12`.
- Refs, anchors, missing files: `engine:181-204, 1111-1136`.
- Path/parameter/security/duplicates: `engine:646-725`.
- Schema objects, boundary keywords: `engine:881-926`.
- Examples: `engine:812-876, 1166-1168`.
- Unused components and big integers: `engine:934-975, 1175-1181`.
- Limits and window: `component:578-584`; window helpers `component:602-618`.
- Worker fallback and events: `component:803-811, 820-864`.
- Schemas: `src/data/openapi-schemas/{swagger-2.0,oas-3.0-2024-10-18,oas-3.1-2026-08-03,oas-3.2-2026-08-30}.json`.

## Tests

- `node scripts/test-openapi-validator.mjs`: 2,768 passed, 0 failed, before and after the edits.
- `node scripts/test-tool-content-parity.mjs`: 7,753 passed, 0 failed (141 tools, 0 pending).
- `node scripts/audit.mjs --quiet`: 24 PASS, 0 WARN, 0 FAIL.
- Only the four MDX files were edited (31 changed lines). No build was run, per the batch rules.
