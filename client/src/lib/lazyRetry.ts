import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_KEY = "jd-chunk-reload";

function isChunkLoadError(error: unknown): boolean {
  const message = String((error as Error)?.message || error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|error loading dynamically imported module/i.test(
    message
  );
}

/**
 * Vite lazy() wrapper: after deploy, an old tab may request a stale hashed
 * chunk. The server used to return index.html (200), which surfaces as
 * "Importing a module script failed". One hard reload picks up the new HTML.
 */
export function lazyRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* private mode */
      }
      return mod;
    } catch (error) {
      let alreadyReloaded = false;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_KEY) === "1";
      } catch {
        /* private mode */
      }
      if (isChunkLoadError(error) && !alreadyReloaded && typeof window !== "undefined") {
        try {
          sessionStorage.setItem(RELOAD_KEY, "1");
        } catch {
          /* private mode */
        }
        window.location.reload();
        return new Promise(() => {
          /* wait for reload */
        });
      }
      throw error;
    }
  });
}

export { isChunkLoadError };
