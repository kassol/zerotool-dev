// Guide post directory for a tool: `src/content/blog/{dir}/`. Most guides use
// `{toolSlug}-guide`. These were published under another name; renaming the
// directory would change a live URL, so they are mapped here.
export const guideDirOverrides: Record<string, string> = {
  'aspect-ratio': 'aspect-ratio-calculator-guide',
  'lorem-ipsum': 'lorem-ipsum-generator-guide',
  'number-base': 'number-base-converter-guide',
  'url-encode': 'url-encode-decode-guide',
};

export function guideDirFor(toolSlug: string): string {
  return Object.prototype.hasOwnProperty.call(guideDirOverrides, toolSlug)
    ? guideDirOverrides[toolSlug]
    : `${toolSlug}-guide`;
}
