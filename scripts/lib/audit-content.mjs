// Pure checks used by audit.mjs. Reads no files and writes nothing; callers supply
// published source text or a tool's four MDX files. YAML uses the installed js-yaml.
import { load as loadYaml } from 'js-yaml';

const LANGS = ['en', 'zh', 'ja', 'ko'];
// Match guarantees about data confinement as well as absolute run claims. A
// statement about processing or uploads is different from claiming that data
// cannot leave the page (copy, download and third-party scripts still matter).
const ABSOLUTE_RUN_CLAIMS = [
  /100\s*[%％]\s*-?\s*(client|browser|local|offline|private|in[- ](your )?browser|客户端|浏览器|本地|离线|クライアント|ブラウザ|ローカル|オフライン|클라이언트|브라우저|로컬|오프라인)/i,
  /\bentirely (in|on) (your|the) browser/i,
  /\b(?:fully|entirely) client[- ]side/i,
  /\bcompletely (private|client[- ]side|local)/i,
  /纯浏览器/,
  /完全在浏览器/,
  /ブラウザ完結/,
  /完全ブラウザ/,
  /完全にブラウザ/,
  /完全(?:な|に)?クライアントサイド/,
  /브라우저에서 완결/,
  /완전히 브라우저/,
  /(?:完全|완전)\s*브라우저\s*처리/,
  /\bnever\s+leaves?\s+(?:(?:your|the|this)\s+)?(?:browser|tab|page|device|machine|computer)\b/i,
  /\bnothing\s+leaves?\s+(?:(?:your|the|this)\s+)?(?:browser|tab|page|device|machine|computer)\b/i,
  /\b(?:stays?|remains?)\s+(?:in|inside|within)\s+(?:(?:your|the|this)\s+)?browser\b(?![’']?s?\s+(?:history|local\s*storage|storage|cache|memory)|(?:\s+tab)?\s+until\b)/i,
  /(?:不(?:会)?离开|从未离开过?)(?:(?:你|您)的?|当前)?(?:浏览器|设备|机器|电脑|计算机|标签页|页面|本机|本地)/,
  /数据不出(?:本机|本地|设备|浏览器)/,
  /留在(?:(?:你|您)的?|本|当前)?浏览器(?!历史|的(?:历史|本地存储|缓存))/,
  /ブラウザー?(?:の|から)?外に(?:は)?出ません/,
  /ブラウザー?(?:(?:タブ)?内|の中)に(?:留ま|とどま)/,
  /マシン(?:から|の外に)(?:は)?出ません/,
  /(?:ブラウザー?|マシン)を離れ(?:ない|ません)/,
  /(?:브라우저|기기|머신)\s*밖으로\s*나가지\s*않/,
  /(?:브라우저|기기)(?:를|을)\s*벗어나지\s*않/,
  /(?:브라우저|기기|머신|로컬)(?:\s*탭)?(?:을|를)\s*떠나지\s*않/,
  /브라우저\s*(?:안에|내에|에)(?:만)?\s*남/,
];

function frontmatter(text) {
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) throw new Error('missing or unclosed frontmatter');
  const data = loadYaml(match[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('frontmatter must be a YAML mapping');
  }
  return data;
}

export function absoluteRunClaimIssues(rel, text) {
  if (rel.startsWith('src/content/blog/')) {
    // Only skip drafts whose frontmatter parses successfully.
    try { if (frontmatter(text).draft === true) return []; } catch {}
  }
  const issues = [];
  text.split('\n').forEach((line, i) => {
    for (const re of ABSOLUTE_RUN_CLAIMS) {
      const match = line.match(re);
      if (match) issues.push(`${rel}:${i + 1}: "${match[0]}" — state processing, uploads or copies explicitly`);
    }
  });
  return issues;
}

export function toolFaqIssues(slug, pages) {
  const issues = [];
  const counts = [];
  for (const lang of LANGS) {
    const rel = `src/content/tools/${slug}/${lang}.mdx`;
    const text = pages[lang];
    if (typeof text !== 'string') {
      issues.push(`${rel}: missing MDX file`);
      continue;
    }
    let faq;
    try { faq = frontmatter(text).faqItems; }
    catch (error) {
      issues.push(`${rel}: invalid frontmatter: ${error.message}`);
      continue;
    }
    if (!Array.isArray(faq) || faq.length === 0) {
      issues.push(`${rel}: faqItems must be a nonempty array`);
      continue;
    }
    counts.push([lang, faq.length]);
    faq.forEach((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push(`${rel}: faqItems[${i}] must be a question/answer mapping`);
        return;
      }
      for (const key of ['question', 'answer']) {
        if (typeof item[key] !== 'string' || !item[key].trim()) {
          issues.push(`${rel}: faqItems[${i}].${key} must be a nonempty string`);
        }
      }
    });
  }
  if (counts.length === LANGS.length && new Set(counts.map(([, n]) => n)).size > 1) {
    issues.push(`${slug}: FAQ counts differ (${counts.map(([lang, n]) => `${lang}=${n}`).join(', ')})`);
  }
  return issues;
}
