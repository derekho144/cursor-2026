import { execSync } from "child_process";

// Skip browser downloads in production (Dockerfile sets these env vars)
// or when explicitly told to skip
const skipPlaywright =
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1" ||
  process.env.NODE_ENV === "production";

const skipPuppeteer =
  process.env.PUPPETEER_SKIP_DOWNLOAD === "true" ||
  process.env.NODE_ENV === "production";

if (skipPlaywright && skipPuppeteer) {
  console.log("[postinstall] Skipping browser downloads (production/CI mode)");
  process.exit(0);
}

// Development: install browsers locally
try {
  if (!skipPuppeteer) {
    execSync("node node_modules/puppeteer/install.mjs", {
      stdio: "inherit",
      shell: true,
    });
  }
} catch (e) {
  console.warn("[postinstall] Puppeteer install skipped:", e.message);
}

try {
  if (!skipPlaywright) {
    execSync(
      "PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers npx playwright install chromium",
      { stdio: "inherit", shell: true }
    );
  }
} catch (e) {
  console.warn("[postinstall] Playwright install skipped:", e.message);
}
