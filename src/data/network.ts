// Tools that send requests off the page because of what they do. Each slug has an
// i18n key `network.{slug}` that says what is sent and where. ToolLayout shows it in
// the trust bar instead of `tool.trustPrivacy`; the About pages list the same tools.
export const networkToolSlugs: readonly string[] = [
  'dns-lookup',          // DoH query to dns.google or cloudflare-dns.com
  'qr-code-decoder',     // URL mode fetches the image from the entered address
  'markdown-preview',    // ![alt](url) renders an <img> that loads from url
  'meta-tag-generator',  // social previews render the og:image / twitter:image URL
];

export function networkNoteKey(slug: string): string | null {
  return networkToolSlugs.includes(slug) ? `network.${slug}` : null;
}
