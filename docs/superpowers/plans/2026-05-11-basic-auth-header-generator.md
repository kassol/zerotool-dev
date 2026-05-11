# Basic Auth Header Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a privacy-safe Basic Auth Header Generator that generates and decodes HTTP Basic authentication headers entirely in the browser.

**Architecture:** Follow the existing ZeroTool pattern: one self-contained Astro tool component with inline script, shared tool CSS classes, metadata in `src/data/tools.ts`, icon in `src/data/icons.ts`, route wiring through `src/components/tools/registry.ts`, and MDX content in Astro collections. Credential persistence is disabled through `src/data/persistence.ts`.

**Tech Stack:** Astro 5 static site, inline browser JavaScript, `TextEncoder`, `TextDecoder`, `btoa`, `atob`, existing ZeroTool design tokens and audit/build scripts.

---

## File Structure

- Create `src/components/tools/BasicAuthHeaderGeneratorTool.astro`: the only interactive UI and all Basic auth logic.
- Modify `src/components/tools/registry.ts`: import and map `basic-auth-header-generator` to the component.
- Modify `src/data/tools.ts`: add the tool metadata, translations, category, and related tools.
- Modify `src/data/icons.ts`: add a Lucide-style `basic-auth-header-generator` icon.
- Modify `src/data/persistence.ts`: disable persistence for the slug.
- Create `src/content/tools/basic-auth-header-generator/{en,zh,ja,ko}.mdx`: tool SEO/FAQ/body content.
- Create `src/content/blog/basic-auth-header-generator-guide/{en,zh,ja,ko}.mdx`: guide blog in all four languages.
- Generate `public/og/basic-auth-header-generator.png` with the existing OG generator.
- No external dependency is added.

## Task 1: Add The Tool Component

**Files:**
- Create: `src/components/tools/BasicAuthHeaderGeneratorTool.astro`

- [ ] **Step 1: Add the component shell and UI**

Create `src/components/tools/BasicAuthHeaderGeneratorTool.astro` with this structure:

```astro
---
// BasicAuthHeaderGeneratorTool - generate and decode HTTP Basic auth headers
// entirely in the browser. No network calls, no persistence.
---

<div class="bahg-wrap">
  <section class="bahg-card" aria-labelledby="bahg-generate-title">
    <div class="bahg-card-head">
      <h2 id="bahg-generate-title" data-i18n="generateTitle">Generate Basic Auth Header</h2>
      <p data-i18n="generateHint">Enter credentials and copy the Authorization header.</p>
    </div>

    <div class="bahg-grid">
      <label class="bahg-field">
        <span class="tool-label" data-i18n="usernameLabel">Username</span>
        <input id="bahg-username" class="tool-input" type="text" spellcheck="false" autocomplete="off" placeholder="Aladdin" />
      </label>

      <label class="bahg-field">
        <span class="tool-label" data-i18n="passwordLabel">Password</span>
        <span class="bahg-password-row">
          <input id="bahg-password" class="tool-input" type="password" spellcheck="false" autocomplete="off" placeholder="open sesame" />
          <button id="bahg-toggle-password" class="btn-secondary" type="button" data-i18n="showBtn">Show</button>
        </span>
      </label>
    </div>

    <div class="bahg-actions">
      <button id="bahg-generate" class="btn-primary" type="button" data-i18n="generateBtn">Generate Header</button>
      <button id="bahg-load-example" class="btn-secondary" type="button" data-i18n="exampleBtn">Load Example</button>
      <button id="bahg-clear-generate" class="btn-ghost" type="button" data-i18n="clearBtn">Clear</button>
    </div>

    <p id="bahg-generate-status" class="tool-status none" aria-live="polite"></p>

    <div id="bahg-output" class="bahg-output" hidden>
      <div class="bahg-result-row">
        <span class="tool-result-label" data-i18n="fullHeaderLabel">Full header</span>
        <code id="bahg-full-header" class="tool-result-value"></code>
        <button class="btn-copy" type="button" data-copy-target="bahg-full-header" data-i18n="copyBtn">Copy</button>
      </div>
      <div class="bahg-result-row">
        <span class="tool-result-label" data-i18n="tokenLabel">Token only</span>
        <code id="bahg-token" class="tool-result-value"></code>
        <button class="btn-copy" type="button" data-copy-target="bahg-token" data-i18n="copyBtn">Copy</button>
      </div>
      <div class="bahg-result-block">
        <div class="bahg-result-head">
          <span class="tool-result-label">cURL</span>
          <button class="btn-copy" type="button" data-copy-target="bahg-curl" data-i18n="copyBtn">Copy</button>
        </div>
        <pre id="bahg-curl" class="bahg-code"></pre>
      </div>
      <div class="bahg-result-block">
        <div class="bahg-result-head">
          <span class="tool-result-label">Fetch</span>
          <button class="btn-copy" type="button" data-copy-target="bahg-fetch" data-i18n="copyBtn">Copy</button>
        </div>
        <pre id="bahg-fetch" class="bahg-code"></pre>
      </div>
    </div>
  </section>

  <section class="bahg-card" aria-labelledby="bahg-decode-title">
    <div class="bahg-card-head">
      <h2 id="bahg-decode-title" data-i18n="decodeTitle">Decode Basic Auth Header</h2>
      <p data-i18n="decodeHint">Paste a full header, Basic token, or token-only value.</p>
    </div>

    <label class="bahg-field">
      <span class="tool-label" data-i18n="headerInputLabel">Header or token</span>
      <textarea id="bahg-decode-input" class="tool-textarea" rows="5" spellcheck="false" autocomplete="off" placeholder="Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=="></textarea>
    </label>

    <div class="bahg-actions">
      <button id="bahg-decode" class="btn-primary" type="button" data-i18n="decodeBtn">Decode Header</button>
      <button id="bahg-load-decode-example" class="btn-secondary" type="button" data-i18n="exampleBtn">Load Example</button>
      <button id="bahg-clear-decode" class="btn-ghost" type="button" data-i18n="clearBtn">Clear</button>
    </div>

    <p id="bahg-decode-status" class="tool-status none" aria-live="polite"></p>

    <div id="bahg-decoded" class="bahg-decoded" hidden>
      <div class="tool-result-row">
        <span class="tool-result-label" data-i18n="decodedUsernameLabel">Username</span>
        <code id="bahg-decoded-username" class="tool-result-value"></code>
        <button class="btn-copy" type="button" data-copy-target="bahg-decoded-username" data-i18n="copyBtn">Copy</button>
      </div>
      <div class="tool-result-row">
        <span class="tool-result-label" data-i18n="decodedPasswordLabel">Password</span>
        <code id="bahg-decoded-password" class="tool-result-value"></code>
        <button class="btn-copy" type="button" data-copy-target="bahg-decoded-password" data-i18n="copyBtn">Copy</button>
      </div>
    </div>
  </section>

  <p class="bahg-privacy" data-i18n="privacyNote">Everything runs in your browser. Basic auth is Base64 encoding, not encryption. Use HTTPS when sending it.</p>
</div>
```

- [ ] **Step 2: Add the inline script**

Append this `<script is:inline>` below the markup:

```html
<script is:inline>
  (function () {
    var STRINGS = {
      en: {
        generateTitle: 'Generate Basic Auth Header', generateHint: 'Enter credentials and copy the Authorization header.', usernameLabel: 'Username', passwordLabel: 'Password', showBtn: 'Show', hideBtn: 'Hide', generateBtn: 'Generate Header', exampleBtn: 'Load Example', clearBtn: 'Clear', copyBtn: 'Copy', copiedBtn: 'Copied!', fullHeaderLabel: 'Full header', tokenLabel: 'Token only', decodeTitle: 'Decode Basic Auth Header', decodeHint: 'Paste a full header, Basic token, or token-only value.', headerInputLabel: 'Header or token', decodeBtn: 'Decode Header', decodedUsernameLabel: 'Username', decodedPasswordLabel: 'Password', privacyNote: 'Everything runs in your browser. Basic auth is Base64 encoding, not encryption. Use HTTPS when sending it.', generatedOk: 'Header generated.', decodedOk: 'Header decoded.', errUsername: 'Username is required.', errPassword: 'Password is required.', errEmptyDecode: 'Paste a Basic auth header or token.', errScheme: 'Only the Basic authentication scheme is supported.', errBase64: 'The token is not valid Base64.', errMalformed: 'Decoded Basic auth value must contain username and password separated by a colon.'
      },
      zh: {
        generateTitle: '生成 Basic Auth Header', generateHint: '输入用户名和密码，复制 Authorization 头。', usernameLabel: '用户名', passwordLabel: '密码', showBtn: '显示', hideBtn: '隐藏', generateBtn: '生成 Header', exampleBtn: '加载示例', clearBtn: '清除', copyBtn: '复制', copiedBtn: '已复制！', fullHeaderLabel: '完整 Header', tokenLabel: '仅 Token', decodeTitle: '解码 Basic Auth Header', decodeHint: '粘贴完整 Header、Basic token 或纯 token。', headerInputLabel: 'Header 或 token', decodeBtn: '解码 Header', decodedUsernameLabel: '用户名', decodedPasswordLabel: '密码', privacyNote: '全部处理都在浏览器内完成。Basic auth 是 Base64 编码，不是加密。发送时请使用 HTTPS。', generatedOk: 'Header 已生成。', decodedOk: 'Header 已解码。', errUsername: '用户名不能为空。', errPassword: '密码不能为空。', errEmptyDecode: '请粘贴 Basic auth header 或 token。', errScheme: '仅支持 Basic 认证方案。', errBase64: 'Token 不是有效的 Base64。', errMalformed: '解码后的 Basic auth 值必须包含用冒号分隔的用户名和密码。'
      },
      ja: {
        generateTitle: 'Basic Auth Header 生成', generateHint: '認証情報を入力して Authorization ヘッダーをコピーします。', usernameLabel: 'ユーザー名', passwordLabel: 'パスワード', showBtn: '表示', hideBtn: '非表示', generateBtn: 'Header を生成', exampleBtn: '例を読み込む', clearBtn: 'クリア', copyBtn: 'コピー', copiedBtn: 'コピー済み！', fullHeaderLabel: '完全な Header', tokenLabel: 'Token のみ', decodeTitle: 'Basic Auth Header をデコード', decodeHint: '完全な Header、Basic token、または token のみを貼り付けます。', headerInputLabel: 'Header または token', decodeBtn: 'Header をデコード', decodedUsernameLabel: 'ユーザー名', decodedPasswordLabel: 'パスワード', privacyNote: 'すべてブラウザ内で処理されます。Basic auth は Base64 エンコードであり、暗号化ではありません。送信時は HTTPS を使用してください。', generatedOk: 'Header を生成しました。', decodedOk: 'Header をデコードしました。', errUsername: 'ユーザー名を入力してください。', errPassword: 'パスワードを入力してください。', errEmptyDecode: 'Basic auth header または token を貼り付けてください。', errScheme: 'Basic 認証方式のみ対応しています。', errBase64: 'Token は有効な Base64 ではありません。', errMalformed: 'デコード後の Basic auth 値には、コロンで区切られたユーザー名とパスワードが必要です。'
      },
      ko: {
        generateTitle: 'Basic Auth Header 생성', generateHint: '자격 증명을 입력하고 Authorization 헤더를 복사합니다.', usernameLabel: '사용자 이름', passwordLabel: '비밀번호', showBtn: '표시', hideBtn: '숨기기', generateBtn: 'Header 생성', exampleBtn: '예시 불러오기', clearBtn: '지우기', copyBtn: '복사', copiedBtn: '복사됨!', fullHeaderLabel: '전체 Header', tokenLabel: 'Token만', decodeTitle: 'Basic Auth Header 디코드', decodeHint: '전체 Header, Basic token 또는 token만 붙여넣으세요.', headerInputLabel: 'Header 또는 token', decodeBtn: 'Header 디코드', decodedUsernameLabel: '사용자 이름', decodedPasswordLabel: '비밀번호', privacyNote: '모든 처리는 브라우저에서 실행됩니다. Basic auth는 Base64 인코딩이며 암호화가 아닙니다. 전송 시 HTTPS를 사용하세요.', generatedOk: 'Header가 생성되었습니다.', decodedOk: 'Header가 디코딩되었습니다.', errUsername: '사용자 이름이 필요합니다.', errPassword: '비밀번호가 필요합니다.', errEmptyDecode: 'Basic auth header 또는 token을 붙여넣으세요.', errScheme: 'Basic 인증 방식만 지원합니다.', errBase64: 'Token이 유효한 Base64가 아닙니다.', errMalformed: '디코딩된 Basic auth 값에는 콜론으로 구분된 사용자 이름과 비밀번호가 있어야 합니다.'
      }
    };

    var pageLang = (document.documentElement.lang || 'en').slice(0, 2);
    var t = STRINGS[pageLang] || STRINGS.en;
    var EXAMPLE_USER = 'Aladdin';
    var EXAMPLE_PASS = 'open sesame';
    var EXAMPLE_HEADER = 'Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==';

    function byId(id) { return document.getElementById(id); }
    function setStatus(el, message, type) { el.textContent = message; el.className = 'tool-status ' + type; }
    function bytesToBase64(bytes) {
      var binary = '';
      bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
      return btoa(binary);
    }
    function base64ToBytes(token) {
      var normalized = token.replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) return null;
      try {
        var binary = atob(normalized);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      } catch (error) {
        return null;
      }
    }
    function encodeBasic(username, password) {
      return bytesToBase64(new TextEncoder().encode(username + ':' + password));
    }
    function extractToken(raw) {
      var value = raw.trim();
      value = value.replace(/^Authorization\s*:\s*/i, '').trim();
      var schemeMatch = value.match(/^([A-Za-z]+)\s+(.+)$/);
      if (schemeMatch) {
        if (schemeMatch[1].toLowerCase() !== 'basic') return { error: t.errScheme };
        value = schemeMatch[2].trim();
      }
      return { token: value };
    }
    function decodeBasic(raw) {
      var extracted = extractToken(raw);
      if (extracted.error) return { error: extracted.error };
      if (!extracted.token) return { error: t.errEmptyDecode };
      var bytes = base64ToBytes(extracted.token);
      if (!bytes) return { error: t.errBase64 };
      var decoded = new TextDecoder().decode(bytes);
      var sep = decoded.indexOf(':');
      if (sep === -1) return { error: t.errMalformed };
      return { username: decoded.slice(0, sep), password: decoded.slice(sep + 1), token: extracted.token };
    }
    function buildCurl(header) { return 'curl -H "' + header + '" https://api.example.com/resource'; }
    function buildFetch(header) { return "fetch('https://api.example.com/resource', {\n  headers: {\n    Authorization: '" + header.replace(/^Authorization:\s*/i, '') + "'\n  }\n});"; }

    document.querySelectorAll('.bahg-wrap [data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    var usernameEl = byId('bahg-username');
    var passwordEl = byId('bahg-password');
    var generateStatus = byId('bahg-generate-status');
    var outputEl = byId('bahg-output');
    var decodeInput = byId('bahg-decode-input');
    var decodeStatus = byId('bahg-decode-status');
    var decodedEl = byId('bahg-decoded');
    var togglePassword = byId('bahg-toggle-password');

    function generate() {
      var username = usernameEl.value;
      var password = passwordEl.value;
      if (!username) { outputEl.hidden = true; setStatus(generateStatus, t.errUsername, 'error'); return; }
      if (!password) { outputEl.hidden = true; setStatus(generateStatus, t.errPassword, 'error'); return; }
      var token = encodeBasic(username, password);
      var header = 'Authorization: Basic ' + token;
      byId('bahg-full-header').textContent = header;
      byId('bahg-token').textContent = token;
      byId('bahg-curl').textContent = buildCurl(header);
      byId('bahg-fetch').textContent = buildFetch(header);
      outputEl.hidden = false;
      setStatus(generateStatus, t.generatedOk, 'success');
      window.trackTool && window.trackTool('basic-auth-header-generator', 'generate');
    }
    function decode() {
      var raw = decodeInput.value;
      if (!raw.trim()) { decodedEl.hidden = true; setStatus(decodeStatus, t.errEmptyDecode, 'error'); return; }
      var result = decodeBasic(raw);
      if (result.error) { decodedEl.hidden = true; setStatus(decodeStatus, result.error, 'error'); return; }
      byId('bahg-decoded-username').textContent = result.username;
      byId('bahg-decoded-password').textContent = result.password;
      decodedEl.hidden = false;
      setStatus(decodeStatus, t.decodedOk, 'success');
      window.trackTool && window.trackTool('basic-auth-header-generator', 'decode');
    }

    byId('bahg-generate').addEventListener('click', generate);
    byId('bahg-decode').addEventListener('click', decode);
    byId('bahg-load-example').addEventListener('click', function () { usernameEl.value = EXAMPLE_USER; passwordEl.value = EXAMPLE_PASS; generate(); });
    byId('bahg-load-decode-example').addEventListener('click', function () { decodeInput.value = EXAMPLE_HEADER; decode(); });
    byId('bahg-clear-generate').addEventListener('click', function () { usernameEl.value = ''; passwordEl.value = ''; outputEl.hidden = true; setStatus(generateStatus, '', 'none'); });
    byId('bahg-clear-decode').addEventListener('click', function () { decodeInput.value = ''; decodedEl.hidden = true; setStatus(decodeStatus, '', 'none'); });
    togglePassword.addEventListener('click', function () {
      var showing = passwordEl.type === 'text';
      passwordEl.type = showing ? 'password' : 'text';
      togglePassword.textContent = showing ? t.showBtn : t.hideBtn;
    });
    document.querySelectorAll('.bahg-wrap [data-copy-target]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = byId(btn.getAttribute('data-copy-target'));
        var value = target ? target.textContent : '';
        if (!value) return;
        navigator.clipboard.writeText(value).then(function () {
          var previous = btn.textContent;
          btn.textContent = t.copiedBtn;
          btn.classList.add('copied');
          setTimeout(function () { btn.textContent = previous; btn.classList.remove('copied'); }, 1400);
        });
      });
    });
  })();
</script>
```

- [ ] **Step 3: Add component styles**

Append this `<style is:global>` below the script:

```astro
<style is:global>
  .bahg-wrap {
    display: grid;
    gap: 1rem;
  }
  .bahg-card {
    display: grid;
    gap: 1rem;
    padding: 1rem;
    border-radius: var(--radius-lg);
    background: var(--color-surface);
    box-shadow: inset 0 0 0 1px var(--color-border-soft), var(--shadow-subtle);
  }
  .bahg-card-head h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(1.25rem, 2vw, 1.65rem);
    line-height: 1.08;
    color: var(--color-text);
  }
  .bahg-card-head p,
  .bahg-privacy {
    margin: 0.35rem 0 0;
    color: var(--color-text-secondary);
    font-size: 0.92rem;
    line-height: 1.5;
  }
  .bahg-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.85rem;
  }
  .bahg-field {
    display: grid;
    gap: 0.42rem;
  }
  .bahg-password-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
  }
  .bahg-actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .bahg-output,
  .bahg-decoded {
    display: grid;
    gap: 0.7rem;
  }
  .bahg-result-row,
  .bahg-result-block {
    display: grid;
    gap: 0.55rem;
    padding: 0.75rem;
    border-radius: var(--radius-md);
    background: var(--color-bg-secondary);
    box-shadow: inset 0 0 0 1px var(--color-border-soft);
  }
  .bahg-result-row {
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
  }
  .bahg-result-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }
  .bahg-code {
    margin: 0;
    padding: 0.8rem;
    border-radius: var(--radius-md);
    background: var(--color-surface-muted);
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 0.82rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    box-shadow: inset 0 0 0 1px var(--color-border-soft);
  }
  .bahg-privacy {
    padding: 0.8rem 0.95rem;
    border-radius: var(--radius-md);
    background: var(--color-surface-muted);
    box-shadow: inset 0 0 0 1px var(--color-border-soft);
  }
  @media (max-width: 700px) {
    .bahg-grid,
    .bahg-result-row {
      grid-template-columns: 1fr;
    }
    .bahg-password-row {
      grid-template-columns: 1fr;
    }
    .bahg-actions > button,
    .bahg-result-row > button,
    .bahg-result-head > button {
      width: 100%;
    }
  }
</style>
```

- [ ] **Step 4: Run a local algorithm sanity check**

Run:

```bash
node --input-type=module - <<'EOF'
const enc = new TextEncoder();
const dec = new TextDecoder();
const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const token = bytesToBase64(enc.encode('Aladdin:open sesame'));
if (token !== 'QWxhZGRpbjpvcGVuIHNlc2FtZQ==') throw new Error(token);
const decoded = dec.decode(Uint8Array.from(atob('dXNlcjpwOmE6c3M='), c => c.charCodeAt(0)));
if (decoded !== 'user:p:a:ss') throw new Error(decoded);
console.log('basic auth algorithm sanity check passed');
EOF
```

Expected output:

```text
basic auth algorithm sanity check passed
```

- [ ] **Step 5: Change checkpoint**

Inspect the diff. Only run a git commit if Sir explicitly requested commits in this session.

```bash
git diff -- src/components/tools/BasicAuthHeaderGeneratorTool.astro
```

If commits were explicitly requested, use:

```bash
git add src/components/tools/BasicAuthHeaderGeneratorTool.astro
git commit -m "feat(basic-auth): add header generator component"
```

## Task 2: Wire Metadata, Icon, Registry, And Privacy

**Files:**
- Modify: `src/components/tools/registry.ts`
- Modify: `src/data/tools.ts`
- Modify: `src/data/icons.ts`
- Modify: `src/data/persistence.ts`

- [ ] **Step 1: Register the component**

In `src/components/tools/registry.ts`, add this import near the other imports:

```ts
import BasicAuthHeaderGeneratorTool from './BasicAuthHeaderGeneratorTool.astro';
```

Add this map entry in `toolComponentMap`:

```ts
'basic-auth-header-generator': BasicAuthHeaderGeneratorTool,
```

- [ ] **Step 2: Add the tool metadata**

In `src/data/tools.ts`, add this object before the closing `];`:

```ts
  { slug: 'basic-auth-header-generator', translations: { en: { name: 'Basic Auth Header Generator', description: 'Generate and decode HTTP Basic Authentication headers in your browser. Copy Authorization headers, tokens, cURL snippets, and Fetch examples with no upload.' }, zh: { name: 'Basic Auth Header 生成器', description: '在浏览器中生成和解码 HTTP Basic Authentication 头，复制 Authorization header、token、cURL 片段和 Fetch 示例，零上传。' }, ja: { name: 'Basic Auth Header ジェネレーター', description: 'HTTP Basic Authentication ヘッダーをブラウザで生成・デコード。Authorization header、token、cURL、Fetch 例をアップロードなしでコピー。' }, ko: { name: 'Basic Auth Header 생성기', description: '브라우저에서 HTTP Basic Authentication 헤더 생성 및 디코드. Authorization header, token, cURL, Fetch 예시를 업로드 없이 복사.' } }, category: 'security', relatedSlugs: ['jwt-decoder', 'jwt-generator', 'hmac-generator', 'curl-to-code'] },
```

- [ ] **Step 3: Add the icon**

In `src/data/icons.ts`, add this Lucide-style entry:

```ts
'basic-auth-header-generator': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8V6a5 5 0 0 1 10 0v2"/><path d="M8 14h.01"/><path d="M12 14h4"/></svg>',
```

- [ ] **Step 4: Disable persistence**

In `src/data/persistence.ts`, add the slug to `toolPersistencePolicy`:

```ts
  'basic-auth-header-generator': 'disabled',
```

- [ ] **Step 5: Run static audit and expect content failures only**

Run:

```bash
node scripts/audit.mjs --quiet
```

Expected at this stage: audit may report missing `src/content/tools/basic-auth-header-generator/{en,zh,ja,ko}.mdx`. Any registry, icon, category, or orphan component FAIL must be fixed before moving on.

- [ ] **Step 6: Change checkpoint**

Inspect the diff. Only commit if Sir explicitly requested commits.

```bash
git diff -- src/components/tools/registry.ts src/data/tools.ts src/data/icons.ts src/data/persistence.ts
```

Commit command if explicitly requested:

```bash
git add src/components/tools/registry.ts src/data/tools.ts src/data/icons.ts src/data/persistence.ts
git commit -m "feat(basic-auth): register tool metadata"
```

## Task 3: Add Tool SEO Content

**Files:**
- Create: `src/content/tools/basic-auth-header-generator/en.mdx`
- Create: `src/content/tools/basic-auth-header-generator/zh.mdx`
- Create: `src/content/tools/basic-auth-header-generator/ja.mdx`
- Create: `src/content/tools/basic-auth-header-generator/ko.mdx`

- [ ] **Step 1: Create EN tool content**

Use this structure in `en.mdx`:

```mdx
---
seoTitle: "Basic Auth Header Generator - Encode and Decode Authorization Headers"
seoDescription: "Generate and decode HTTP Basic Authentication headers in your browser. Copy Authorization headers, Base64 tokens, cURL examples, and Fetch snippets with no upload."
faqItems:
  - question: "Is Basic auth encrypted?"
    answer: "No. Basic auth uses Base64 encoding, not encryption. Send Basic auth only over HTTPS."
  - question: "Can I decode an existing Basic auth header?"
    answer: "Yes. Paste a full Authorization header, a Basic token, or a token-only value to inspect the username and password pair."
  - question: "Are credentials uploaded?"
    answer: "No. Generation and decoding run in your browser, and this tool does not persist entered credentials."
---

Use this Basic Auth Header Generator to create the exact `Authorization: Basic ...` value required by many HTTP APIs, reverse proxies, legacy dashboards, and test endpoints.

The tool joins the username and password with a colon, encodes the pair as UTF-8, then converts the bytes to Base64. It also decodes existing Basic auth headers so you can verify copied tokens before using them in a request.

Basic authentication is simple, but it is not secret by itself. Base64 is reversible. Use HTTPS whenever a Basic auth header is sent over the network.
```

- [ ] **Step 2: Create ZH tool content**

Use translated frontmatter/body in `zh.mdx`. Keep `Basic auth`, `Authorization`, `Base64`, `HTTPS`, `cURL`, and `Fetch` technically recognizable. Include the same three FAQ meanings as EN.

- [ ] **Step 3: Create JA tool content**

Use translated frontmatter/body in `ja.mdx`. Keep `Basic auth`, `Authorization`, `Base64`, `HTTPS`, `cURL`, and `Fetch` technically recognizable. Include the same three FAQ meanings as EN.

- [ ] **Step 4: Create KO tool content**

Use translated frontmatter/body in `ko.mdx`. Keep `Basic auth`, `Authorization`, `Base64`, `HTTPS`, `cURL`, and `Fetch` technically recognizable. Include the same three FAQ meanings as EN.

- [ ] **Step 5: Run audit**

Run:

```bash
node scripts/audit.mjs --quiet
```

Expected: no FAIL from missing tool content. Blog warnings are acceptable only if the audit reports them as WARN, not FAIL.

- [ ] **Step 6: Change checkpoint**

Inspect the diff. Only commit if Sir explicitly requested commits.

```bash
git diff -- src/content/tools/basic-auth-header-generator
```

Commit command if explicitly requested:

```bash
git add src/content/tools/basic-auth-header-generator
git commit -m "docs(basic-auth): add tool content"
```

## Task 4: Add The Four-Language Guide Blog

**Files:**
- Create: `src/content/blog/basic-auth-header-generator-guide/en.mdx`
- Create: `src/content/blog/basic-auth-header-generator-guide/zh.mdx`
- Create: `src/content/blog/basic-auth-header-generator-guide/ja.mdx`
- Create: `src/content/blog/basic-auth-header-generator-guide/ko.mdx`

- [ ] **Step 1: Write EN guide**

Create `en.mdx` with this frontmatter:

```mdx
---
title: "How to Generate and Decode a Basic Auth Header"
description: "Learn the HTTP Basic Authentication header format, how Base64 encoding works, how to use Basic auth with cURL and Fetch, and how to decode a copied header safely."
pubDate: 2026-05-11
ogImage: "/og/basic-auth-header-generator.png"
lang: "en"
tags: ["security", "api", "http"]
---
```

Use these sections:

```mdx
## What a Basic auth header contains

`Authorization: Basic <token>` contains a Base64-encoded `username:password` pair.

## Generate a header for cURL

```bash
curl -H "Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==" https://api.example.com/resource
```

## Use Basic auth with Fetch

```js
fetch('https://api.example.com/resource', {
  headers: {
    Authorization: 'Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ=='
  }
});
```

## Decode before you reuse a token

Use the [Basic Auth Header Generator](/tools/basic-auth-header-generator/) to decode copied headers and check the credential pair.

## Security notes

Base64 is reversible. HTTPS protects the header in transit. Do not paste production credentials into shared machines or screenshots.

## Related tools

- [JWT Decoder](/tools/jwt-decoder/)
- [JWT Generator](/tools/jwt-generator/)
- [HMAC Generator](/tools/hmac-generator/)
- [cURL to Code Converter](/tools/curl-to-code/)
```

- [ ] **Step 2: Translate ZH guide with prefixed internal links**

Create `zh.mdx` with `lang: "zh"`. Internal links must use `/zh/tools/.../`, for example:

```mdx
使用 [Basic Auth Header 生成器](/zh/tools/basic-auth-header-generator/) 解码复制来的 header。
```

- [ ] **Step 3: Translate JA guide with prefixed internal links**

Create `ja.mdx` with `lang: "ja"`. Internal links must use `/ja/tools/.../`.

- [ ] **Step 4: Translate KO guide with prefixed internal links**

Create `ko.mdx` with `lang: "ko"`. Internal links must use `/ko/tools/.../`.

- [ ] **Step 5: Run audit for blog naming and internal links**

Run:

```bash
node scripts/audit.mjs --quiet
```

Expected: no FAIL from blog frontmatter, naming, or localized internal links.

- [ ] **Step 6: Change checkpoint**

Inspect the diff. Only commit if Sir explicitly requested commits.

```bash
git diff -- src/content/blog/basic-auth-header-generator-guide
```

Commit command if explicitly requested:

```bash
git add src/content/blog/basic-auth-header-generator-guide
git commit -m "docs(basic-auth): add guide blog"
```

## Task 5: Build, Generate OG, And Browser-Verify

**Files:**
- Generated: `public/og/basic-auth-header-generator.png`
- Modify only if failures require fixes: files from Tasks 1-4

- [ ] **Step 1: Run full audit**

Run:

```bash
node scripts/audit.mjs
```

Expected:

```text
PASS: 16 WARN: 0 FAIL: 0
```

- [ ] **Step 2: Run full build**

Run:

```bash
npm run build
```

Expected: `astro build` completes and `public/og/basic-auth-header-generator.png` exists after OG generation.

- [ ] **Step 3: Start local preview for browser checks**

Run:

```bash
npm run dev
```

Expected: Astro serves `http://localhost:4321/`.

- [ ] **Step 4: Browser-check core routes**

Use browser automation or manual browser checks for:

```text
/tools/basic-auth-header-generator/
/zh/tools/basic-auth-header-generator/
/ja/tools/basic-auth-header-generator/
/ko/tools/basic-auth-header-generator/
```

Expected:

```text
All four routes load.
No console errors.
No horizontal overflow at 1366x900 and 390x844.
```

- [ ] **Step 5: Browser-check generated output**

Input:

```text
Username: Aladdin
Password: open sesame
```

Expected full header:

```text
Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==
```

Expected token:

```text
QWxhZGRpbjpvcGVuIHNlc2FtZQ==
```

- [ ] **Step 6: Browser-check decode output**

Input:

```text
Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==
```

Expected:

```text
Username: Aladdin
Password: open sesame
```

Input:

```text
Basic dXNlcjpwOmE6c3M=
```

Expected:

```text
Username: user
Password: p:a:ss
```

- [ ] **Step 7: Browser-check errors**

Inputs and expected states:

```text
Bearer abc -> Only the Basic authentication scheme is supported.
not-base64 -> The token is not valid Base64.
bm9jb2xvbg== -> Decoded Basic auth value must contain username and password separated by a colon.
```

- [ ] **Step 8: Final diff review**

Run:

```bash
git diff --stat
git diff -- AGENTS.md docs src public
```

Expected: only Basic Auth tool files, docs updates, and generated OG image are changed.

- [ ] **Step 9: Final commit only if explicitly requested**

Do not commit unless Sir explicitly asks. If commits are requested after all checks pass, use:

```bash
git add AGENTS.md docs src public/og/basic-auth-header-generator.png
git commit -m "feat(basic-auth): add header generator tool"
```

## Self-Review

Spec coverage:

- Generation and decoding are covered by Task 1.
- No network requests and no external dependencies are covered by Task 1 and File Structure.
- Registry, metadata, icon, and persistence policy are covered by Task 2.
- Four-language tool content is covered by Task 3.
- Four-language blog content and localized internal links are covered by Task 4.
- Audit, build, OG generation, route checks, behavior checks, and visual checks are covered by Task 5.

Red-flag scan:

- No unfinished markers or open implementation gaps remain.
- Translation tasks specify exact meanings and required link prefixes, while allowing natural localized prose.

Type consistency:

- Slug is consistently `basic-auth-header-generator`.
- Component name is consistently `BasicAuthHeaderGeneratorTool`.
- CSS prefix is consistently `bahg-`.
- Persistence policy value is consistently `disabled`.
