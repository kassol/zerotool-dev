# W6 batch 2 — bcrypt-generator fact check (2026-10-27)

Scope: `bcrypt-generator` en/zh/ja/ko MDX and visible component strings. Reviewed 44 candidate statements, all 24 FAQ answers and 11 component strings. Read-only evidence: `src/data/persistence.ts`, `src/data/network.ts`, `scripts/test-bcrypt-generator.fixtures.json` (recorded 2026-10-02). External rules re-fetched 2026-10-27.

## Corrections

| # | Location | Before | After | Evidence |
|---|---|---|---|---|
| 1 | en.mdx:20, :91; zh.mdx:20, :95; ja.mdx:20, :80; ko.mdx:20; component `issue_over72` ×4 | Spring Security 6.3+ refuses hashes over 72 bytes | 6.3.8 / 6.4.4 or later | CVE-2025-22228: 6.3.0–6.3.7 and 6.4.0–6.4.3 affected, fixed in 6.3.8 and 6.4.4; 6.3.8 `BCrypt.java` throws `password cannot be more than 72 bytes` |
| 2 | ko.mdx:84 | "6.3.10부터 encode()"; "6.3 이후에도 matches() 통과" | 6.2.8 truncates; 6.3.8 / 6.4.4 throws; 6.5.11 `matches()` compares the first 72 bytes | Same advisory; 6.5.x `BCrypt.java` uses `!for_check`; fixture `spring-6` `verifyOver72=true`, `hashOver72=error` |
| 3 | zh.mdx:34 | RuoYi "加密密码" | "计算密码哈希"; method name `encryptPassword` kept as the code name | OWASP Password Storage: hashing is one-way |
| 4 | component zh `passwordPh` | 要加密的密码 | 要哈希的密码 | OWASP Password Storage |
| 5 | en.mdx:20; zh.mdx:20; ja.mdx:20, :73 | CJK characters "3 bytes"; 漢字 3 bytes | "most" / 通常 / ほとんど | Unicode FAQ: UTF-8 uses 1–4 bytes; supplementary-plane kanji take 4 bytes |

## Reviewed, no change

- Library matrix matches the fixture: PHP 8.4.26, Laravel 13.34.0, Symfony 8.1.0, Python bcrypt 4.2.0/5.0.0, Node.js bcrypt 6.0.0, bcryptjs 3.0.3, Go x/crypto 0.57.0, Spring Security 6.5.11/7.1.1.
- PHP: `$2y$` is the only algorithm registered for `password_get_info()` (php-src), which explains Laravel's `RuntimeException`; bcrypt rejects NUL and truncates at 72 bytes; cost default moved 10 → 12 in 8.4.
- Node bcrypt supports `$2a$`/`$2b$` only (README), so `$2y$` returns false; Python bcrypt 5 raises for >72 bytes; Go returns `ErrPasswordTooLong`; Symfony pre-hashes >72-byte and NUL passwords with SHA-512 + base64.
- Format claims: 60-character hash, 16-byte salt in characters 8–29, 22-character salt / 31-character checksum, cost 4–31, 2^cost work, OWASP minimum 10, Argon2id 19 MiB / 2 iterations, `bcrypt(base64(hmac-sha384(...)))`, pure SHA-512 pre-hash called "dangerous".
- `$2x$` handling, non-canonical padding, empty-password results (Spring Security 7 and Symfony return false), parser cleanups (`{bcrypt}`, `user:`, `$$`, Django).
- Privacy: `persistence.ts` is `disabled`; the slug is absent from `network.ts`; the worker loads only `/vendor/bcryptjs.min.js`; no storage, fetch or analytics in the component.
- Counts preserved: FAQ ids and counts, 6 steps per language, seoTitle keys and all other frontmatter.

## Unverified or left unchanged

- Competitor paragraphs (en:110, ja:88, ko:92) are dated 2026-10-02 observations; not re-run in this batch (no browser automation).
- `phpass ... WordPress before 6.8` (component `scheme_phpass`): no WordPress primary source fetched today.
- The 256-byte prefix-swap caveat: Openwall confirms `$2b$` behaves as `$2y$`, but the OpenBSD >255-byte bug was not verified from an OpenBSD source today.
- `$2b$ ... 2014 password-length fix`: Openwall confirms OpenBSD 5.5+ and OpenBSD 5.5 is dated 2014-05-01; the OpenBSD commit message was not fetched.
- Laravel link points to 12.x while the table tests 13.34.0; behavior is the same, so the link was not changed.
- zh seoTitle "Bcrypt 在线加密与校验" still says 加密. Preserved per instruction; recommend 哈希. `tools.ts` zh name/description are outside this batch.

## Sources

- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html (2026-10-27)
- PHP `password_hash`, `crypt`, `password_get_info`: https://www.php.net/manual/en/function.password-hash.php, https://www.php.net/manual/en/function.crypt.php, https://www.php.net/manual/en/function.password-get-info.php (2026-10-27)
- php-src PHP-8.4 `ext/standard/password.c`: https://github.com/php/php-src/blob/PHP-8.4/ext/standard/password.c (2026-10-27)
- Openwall crypt_blowfish: https://www.openwall.com/crypt/ (2026-10-27)
- Node bcrypt README and v6.0.0 `bcrypt.js`: https://github.com/kelektiv/node.bcrypt.js/blob/master/README.md, https://github.com/kelektiv/node.bcrypt.js/blob/master/bcrypt.js (2026-10-27)
- Python bcrypt README: https://github.com/pyca/bcrypt/blob/main/README.rst (2026-10-27)
- Go x/crypto/bcrypt: https://pkg.go.dev/golang.org/x/crypto/bcrypt (2026-10-27)
- Laravel hashing docs and config: https://laravel.com/docs/12.x/hashing, https://github.com/laravel/framework/blob/13.x/config/hashing.php (2026-10-27)
- Symfony 8.1 `NativePasswordHasher`: https://github.com/symfony/symfony/blob/8.1/src/Symfony/Component/PasswordHasher/Hasher/NativePasswordHasher.php (2026-10-27)
- Spring Security CVE-2025-22228: https://spring.io/security/cve-2025-22228 (2026-10-27)
- Spring Security 6.3.8 / 6.5.x `BCrypt.java`, 6.4.4 sources jar, 7.0.x `AbstractValidatingPasswordEncoder`: https://github.com/spring-projects/spring-security/blob/6.3.8/crypto/src/main/java/org/springframework/security/crypto/bcrypt/BCrypt.java, https://github.com/spring-projects/spring-security/blob/6.5.x/crypto/src/main/java/org/springframework/security/crypto/bcrypt/BCrypt.java, https://repo1.maven.org/maven2/org/springframework/security/spring-security-crypto/6.4.4/spring-security-crypto-6.4.4-sources.jar, https://github.com/spring-projects/spring-security/blob/7.0.x/crypto/src/main/java/org/springframework/security/crypto/password/AbstractValidatingPasswordEncoder.java (2026-10-27)
- Unicode UTF-8 FAQ: https://www.unicode.org/faq/utf_bom.html (2026-10-27); Docker Compose interpolation: https://docs.docker.com/reference/compose-file/interpolation/ (2026-10-27)

## Tests

- `node scripts/test-bcrypt-generator.mjs`: before exit 0 (1711 passed, 0 failed); after exit 0 (1711 passed, 0 failed).
- `node scripts/test-tool-content-parity.mjs`: exit 0 (7753 passed, 0 failed).
- `node scripts/audit.mjs --quiet`: exit 0 (24 PASS, 0 WARN, 0 FAIL).
- No test asserted the old "6.3+" wording, so no test change was needed.

## Blockers

- zh seoTitle and `tools.ts` zh naming need a separate decision; both are outside the allowed edit scope.
- Re-measuring the dated competitor claims needs a browser, which this batch forbids.
