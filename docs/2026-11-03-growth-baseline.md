# Growth baseline for the four-week review (2026-11-03)

Internal baseline for the content and internal-link work shipped with v1.142.11. It records what the numbers were, how to measure them again on 2026-12-01, and which differences count as progress. It does not promise rankings, clicks or CTR.

## Data

| Source | File | Window |
|---|---|---|
| Bing Webmaster search | `data/2026-10-30/bwt-search.json` | Weekly rows, three-month export ending 2026-10-27 |
| Bing Webmaster AI | `data/2026-10-30/bwt-ai.json` | Weekly rows, three-month export ending 2026-10-27 |
| Google Search Console | `data/2026-11-03/gsc-performance-page.json`, `gsc-performance-query.json` | 2026-08-01 → 2026-10-31 |
| Prior review | `docs/2026-11-03-bing-ai-and-404-review.md` | Same Bing / AI exports |

Bing page and query rows cover 93 pages; most of them are Chinese tool pages. The six English tool pages in this batch have no Bing page row, so their titles were aligned with the page content and with the GSC query list, not with Bing page×query data.

## Baseline values

### Bing search

| Metric | 2026-10-14 → 10-20 | 2026-10-21 → 10-27 | Change |
|---|---:|---:|---:|
| Clicks | 333 | 287 | −13.8% |
| Impressions | 9,875 | 8,304 | −15.9% |

The three-month export daily averages rose from 28.1 to 31.3 clicks, so the weekly drop is treated as within-week noise, not a structural decline. The week ending 2026-10-27 is the comparison week for the December review.

### Bing AI citations

| Metric | 2026-10-14 → 10-20 | 2026-10-21 → 10-27 | Change |
|---|---:|---:|---:|
| Citations | 2,689 | 1,952 | −27.4% |

The three-month export daily average moved from 321.7 to 316.6 (−1.6%). AI citations are recorded as context; no product change follows from one week.

### Google Search Console, non-brand

| Metric | Value |
|---|---:|
| Clicks | 3 |
| Impressions | 582 |
| CTR | 0.52% |

Non-brand means query rows after removing `site:` queries and the brand terms `zerotool`, `zero tool` and `zerotool.dev`. The page-level totals in GSC also include `site:` and brand impressions, so they are not a non-brand measure.

### Concentration

| Metric | Value |
|---|---:|
| Bing clicks, total | 814 |
| Bing clicks, `/zh/tools/totp-generator/` | 367 |
| Share | 45.1% |

The page is the site's strongest search asset. The goal is to route adjacent needs to sibling pages, not to reduce the TOTP page's own performance.

## Decision thresholds for 2026-12-01

Measure with the same queries and the same filters as above.

| Signal | Threshold | Reading |
|---|---|---|
| Bing weekly clicks | 230–344 (287 ±20%) | Inside the band: treat as weekly fluctuation. Outside: inspect the query and page rows before drawing a conclusion. |
| TOTP share of Bing clicks | Below 40% | Progress in diversification. The page may still grow; the share must fall. |
| Bing weekly impressions | Record only | No pass/fail threshold. Use it to explain a click change. |
| Bing three-month daily clicks | Record only | Compare with 31.3; do not use one week's average as a trend. |
| AI citations, weekly and three-month daily | Record only | Compare with 1,952 and 316.6. No pass/fail threshold. |
| GSC non-brand clicks / impressions / CTR | Record only | Compare with 3 / 582 / 0.52%. The volume is too small for weekly significance. |

These thresholds are review rules, not forecasts. A threshold miss starts an investigation; it does not by itself justify a rollback.

## Review checklist for 2026-12-01

1. Collect Bing search and AI exports for the week ending 2026-11-29 into `data/2026-12-01/`. Keep the raw exports; do not overwrite the 2026-10-30 files.
2. Compute weekly clicks and impressions from the `kind=site` rows for 2026-11-23 → 11-29. Compare with 287 and 8,304.
3. Compute the three-month daily click average from the same export. Compare with 31.3.
4. Compute the TOTP page share: clicks on `/zh/tools/totp-generator/` divided by all Bing clicks in the same window. Compare with 45.1% and the 40% threshold.
5. Collect GSC performance for 2026-09-01 → 2026-11-30 (or the current 90-day range). Recompute non-brand clicks, impressions and CTR with the same `site:` and brand exclusions. Compare with 3 / 582 / 0.52%.
6. Pull GSC page rows for the changed URLs: `/tools/line-tools/`, `/tools/yaml-validator/`, `/tools/jsonl-converter/`, `/tools/gitignore-generator/`, `/tools/base64/`, `/tools/yaml-json/`, `/blog/aspect-ratio-calculator-guide/`, `/blog/dns-lookup-guide/`. Record impressions, clicks and position. A title change is not expected to show a result in the first days.
7. Check that the two redirect targets remain live: `/blog/protobuf-to-json-guide/` → `/tools/protobuf-to-json/` and `/blog/markdown-preview-guide/` → `/tools/markdown-preview/`. No title work is planned on the draft guide files.
8. Check the TOTP sibling pages in GA landing pages for the same four weeks: `/zh/tools/hmac-generator/`, `/zh/tools/qr-code-decoder/`, `/zh/tools/qr-code-generator/`, `/zh/tools/password-generator/`, and the guide `/zh/blog/totp-generator-guide/`. Record sessions and engagement; the TOTP page's own traffic must not be used as the only success measure.
9. Record whether v1.142.11 is the deployed tag and whether any title was reverted after shipping.
10. Write the result into the daily report as an observation. Do not change `scripts/` or the daily-report automation in this review.

## Interpretation limits

- GSC hides anonymous queries. For several of the ten pages, `site:` queries account for most or all recorded impressions. High impressions with zero clicks are therefore not proof of a weak title.
- Bing weekly rows move with the mix of days and with individual high-volume queries. Use the three-month daily average to distinguish direction from noise.
- The two draft guides in the original ten-page list are no longer live pages. Their GSC impressions are historical; the live surface is the tool page they redirect to.
- A title or description change can alter how a page is presented, but cannot make a page rank or earn a click. The December review reports what happened; it does not claim causation without evidence.
