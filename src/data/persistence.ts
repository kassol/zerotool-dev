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
  'uuid-generator': 'preference',
  'cron-job-generator': 'preference',
  'css-filter-generator': 'preference',
  'timezone-converter': 'preference',
  'csp-header-generator': 'preference',
  'svg-optimizer': 'preference',
} as const satisfies Record<string, PersistencePolicy>;

export const disabledPersistenceSlugs = Object.entries(toolPersistencePolicy)
  .filter(([, policy]) => policy === 'disabled')
  .map(([slug]) => slug);
