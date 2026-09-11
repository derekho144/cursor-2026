import { execSync } from "child_process";

// Default: skip browser downloads (production, Manus/CI install, most local installs).
// Opt in explicitly for local PDF/browser work:
//   INSTALL_BROWSER_BINARIES=1 pnpm install
const wantBrowsers = process.env.INSTALL_BROWSER_BINARIES === "1";

const skipPlaywright =
  !wantBrowsers ||
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === "1" ||
  process.env.NODE_ENV === "production";

const skipPuppeteer =
  !wantBrowsers ||
  process.env.PUPPETEER_SKIP_DOWNLOAD === "true" ||
  process.env.NODE_ENV === "production";

if (skipPlaywright && skipPuppeteer) {
  console.log(
    "[postinstall] Skipping browser downloads (set INSTALL_BROWSER_BINARIES=1 to opt in)"
  );
  process.exit(0);
}

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
