export interface ToolInfo {
  slug: string;
  name: string;
  description: string;
  category: 'data' | 'encoding' | 'text' | 'security' | 'dev';
}

export const allTools: ToolInfo[] = [
  { slug: 'json-formatter', name: 'JSON Formatter', description: 'Format and validate JSON instantly', category: 'data' },
  { slug: 'base64', name: 'Base64 Encoder/Decoder', description: 'Encode or decode Base64 strings', category: 'encoding' },
  { slug: 'uuid-generator', name: 'UUID Generator', description: 'Generate UUIDs v1, v4, and v7', category: 'dev' },
  { slug: 'url-encode', name: 'URL Encoder/Decoder', description: 'Encode or decode URL components', category: 'encoding' },
  { slug: 'text-case', name: 'Text Case Converter', description: 'Convert text between cases', category: 'text' },
  { slug: 'markdown-preview', name: 'Markdown Preview', description: 'Live preview Markdown rendering', category: 'text' },
  { slug: 'color-converter', name: 'Color Converter', description: 'Convert between HEX, RGB, HSL', category: 'dev' },
  { slug: 'regex-tester', name: 'Regex Tester', description: 'Test regular expressions with live matching', category: 'dev' },
  { slug: 'hash-generator', name: 'Hash Generator', description: 'Generate MD5, SHA-1, SHA-256 hashes', category: 'security' },
  { slug: 'timestamp-converter', name: 'Timestamp Converter', description: 'Convert Unix timestamps to dates', category: 'dev' },
  { slug: 'jwt-decoder', name: 'JWT Decoder', description: 'Decode and inspect JWT tokens', category: 'security' },
  { slug: 'diff-checker', name: 'Diff Checker', description: 'Compare two texts side by side', category: 'text' },
  { slug: 'password-generator', name: 'Password Generator', description: 'Generate strong random passwords', category: 'security' },
  { slug: 'qr-code-generator', name: 'QR Code Generator', description: 'Generate QR codes from text or URLs', category: 'dev' },
  { slug: 'cron-parser', name: 'Cron Expression Parser', description: 'Parse and explain cron expressions', category: 'dev' },
];

/** Return related tools for a given slug: same category first, then others. */
export function getRelatedTools(currentSlug: string, count = 4): ToolInfo[] {
  const current = allTools.find(t => t.slug === currentSlug);
  if (!current) return allTools.filter(t => t.slug !== currentSlug).slice(0, count);

  const sameCategory = allTools.filter(t => t.slug !== currentSlug && t.category === current.category);
  const otherCategory = allTools.filter(t => t.slug !== currentSlug && t.category !== current.category);
  return [...sameCategory, ...otherCategory].slice(0, count);
}
