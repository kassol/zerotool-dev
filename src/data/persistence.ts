export type PersistencePolicy = 'input' | 'preference' | 'disabled';

/**
 * Per-tool persistence policy for ToolLayout's ztPersist API.
 *
 * - input: default behavior; save/load tool input and clear it with the tool Clear action.
 * - preference: save small user preferences; global/tool Clear actions should not erase it.
 * - disabled: never persist; historical values are wiped on page load for privacy.
 */
export const toolPersistencePolicy = {
  'basic-auth-header-generator': 'disabled',
  'jwt-decoder': 'disabled',
  'jwt-generator': 'disabled',
  'pkce-generator': 'disabled',
  'file-hash-checker': 'disabled',
  'image-compressor': 'disabled',
  'har-file-analyzer': 'disabled',
  'uuid-generator': 'preference',
  'cron-job-generator': 'preference',
  'css-filter-generator': 'preference',
  'timezone-converter': 'preference',
  'csp-header-generator': 'preference',
  'svg-optimizer': 'preference',
  'mime-type-lookup': 'preference',
  'eyedropper-color-picker': 'preference',
  'qr-code-generator': 'preference',
  'zero-width-character-detector': 'disabled',
  'csr-decoder': 'disabled',
  'secret-redactor': 'disabled',
  'sqlite-viewer': 'disabled',
  'pixelate-image': 'disabled',
  'totp-generator': 'disabled',
  'aes-encrypt-decrypt': 'disabled',
  'hmac-generator': 'disabled',
  'bcrypt-generator': 'disabled',
  'password-generator': 'disabled',
  'htpasswd-generator': 'disabled',
  'rsa-key-generator': 'disabled',
  'wifi-qr-code-generator': 'disabled',
  'env-file-parser': 'disabled',
  'cookie-parser': 'disabled',
  'http-header-analyzer': 'disabled',
  'curl-to-code': 'disabled',
  'iban-validator-parser': 'disabled',
  'exif-metadata-viewer': 'disabled',
  'gif-splitter': 'preference',
  'sprite-sheet-generator': 'preference',
  'gif-compressor': 'preference',
  'image-splitter': 'preference',
  'string-escape': 'preference',
  'color-palette-generator': 'preference',
} as const satisfies Record<string, PersistencePolicy>;

export const disabledPersistenceSlugs = Object.entries(toolPersistencePolicy)
  .filter(([, policy]) => policy === 'disabled')
  .map(([slug]) => slug);
