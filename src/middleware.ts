import { defineMiddleware } from 'astro:middleware';
import redirectsText from '../public/_redirects?raw';

// Parse at module load time (once per cold start)
const redirectMap = new Map<string, string>();
for (const line of redirectsText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 3 && parts[2] === '301') {
    redirectMap.set(parts[0], parts[1]);
  }
}

export const onRequest = defineMiddleware((context, next) => {
  const pathname = context.url.pathname;
  const target = redirectMap.get(pathname);
  if (target) {
    return context.redirect(target, 301);
  }
  return next();
});
