/**
 * Decide whether a missing path should fall through to index.html (SPA)
 * or return a hard 404.
 *
 * Hashed Vite assets under /assets/* must NEVER receive HTML — browsers
 * report that as "Importing a module script failed" after a deploy when an
 * old tab requests a stale chunk name.
 */
export function shouldSpaFallback(pathname: string): boolean {
  const pathOnly = pathname.split("?")[0]?.split("#")[0] || "/";
  if (pathOnly.startsWith("/assets/")) return false;
  if (/\.(?:js|mjs|cjs|css|map|woff2?|ttf|eot|png|jpe?g|gif|webp|svg|ico|webmanifest|txt|json)$/i.test(pathOnly)) {
    return false;
  }
  return true;
}
