import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  existsSync: vi.fn(),
  chromium: {
    args: ["--mock-sparticuz-arg"],
    executablePath: vi.fn(),
    setGraphicsMode: true,
  },
}));

vi.mock("puppeteer-core", () => ({
  default: { launch: mocks.launch },
}));
vi.mock("@sparticuz/chromium", () => ({ default: mocks.chromium }));
vi.mock("fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("fs")>()),
  existsSync: mocks.existsSync,
}));

// Import the production function itself: only external browser/filesystem
// dependencies are mocked, not the resolver, generator, or retry loop.
import { generatePdfFromHtml } from "./routers/quotePdf";

const HTML = '<!DOCTYPE html><html lang="zh-Hant"><body>報價 PDF</body></html>';
const PDF_BYTES = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
const PDF_OPTIONS = {
  format: "A4",
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
};
const PLATFORM_PATH = "/mock/platform/chromium";
const SPARTICUZ_PATH = "/mock/sparticuz/chromium";

function makeBrowser() {
  const page = {
    setViewport: vi.fn().mockResolvedValue(undefined),
    setContent: vi.fn().mockResolvedValue(undefined),
    // Puppeteer's page-side fonts callback is not run in Node.
    evaluate: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(PDF_BYTES),
  };
  const browser = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return { browser, page };
}

function expectRenderOptions(page: ReturnType<typeof makeBrowser>["page"]) {
  expect(page.setViewport).toHaveBeenCalledTimes(1);
  expect(page.setViewport).toHaveBeenCalledWith({
    width: 794,
    height: 1123,
    deviceScaleFactor: 2,
  });
  expect(page.setContent).toHaveBeenCalledTimes(1);
  expect(page.setContent).toHaveBeenCalledWith(HTML, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  expect(page.evaluate).toHaveBeenCalledTimes(1);
  expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function));
  expect(page.pdf).toHaveBeenCalledTimes(1);
  expect(page.pdf).toHaveBeenCalledWith(PDF_OPTIONS);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("PUPPETEER_EXECUTABLE_PATH", PLATFORM_PATH);
  mocks.existsSync.mockReturnValue(true);
  mocks.chromium.executablePath.mockResolvedValue(SPARTICUZ_PATH);
  mocks.chromium.setGraphicsMode = true;
});

afterEach(() => {
  // The optional font timeout can remain queued after evaluate resolves.
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("generatePdfFromHtml retry regression", () => {
  it("retries a transient launch failure with a new launch and closes the successful browser", async () => {
    const launchError = new Error("Transient Chromium startup failure");
    const { browser, page } = makeBrowser();
    mocks.launch.mockRejectedValueOnce(launchError).mockResolvedValueOnce(browser);

    await Promise.all([
      expect(generatePdfFromHtml(HTML, "[RetryTest]", [], 0)).resolves.toEqual(
        Buffer.from(PDF_BYTES)
      ),
      vi.runAllTimersAsync(),
    ]);

    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.launch.mock.calls[1]).toEqual(mocks.launch.mock.calls[0]);
    expect(browser.newPage).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expectRenderOptions(page);
  });

  it("closes the failed PDF browser before retrying with a fresh browser and page", async () => {
    const first = makeBrowser();
    const second = makeBrowser();
    first.page.pdf.mockRejectedValueOnce(new Error("Printing failed"));
    mocks.launch
      .mockResolvedValueOnce(first.browser)
      .mockResolvedValueOnce(second.browser);

    await Promise.all([
      expect(generatePdfFromHtml(HTML, "[RetryTest]", [], 0)).resolves.toEqual(
        Buffer.from(PDF_BYTES)
      ),
      vi.runAllTimersAsync(),
    ]);

    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(first.browser).not.toBe(second.browser);
    expect(first.page).not.toBe(second.page);
    expect(first.browser.newPage).toHaveBeenCalledTimes(1);
    expect(second.browser.newPage).toHaveBeenCalledTimes(1);
    expect(first.browser.close).toHaveBeenCalledTimes(1);
    expect(second.browser.close).toHaveBeenCalledTimes(1);
    expect(first.page.pdf.mock.invocationCallOrder[0]).toBeLessThan(
      first.browser.close.mock.invocationCallOrder[0]
    );
    expect(first.browser.close.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.launch.mock.invocationCallOrder[1]
    );
    expectRenderOptions(first.page);
    expectRenderOptions(second.page);
    expect(mocks.launch.mock.calls[1]).toEqual(mocks.launch.mock.calls[0]);
  });

  it("throws the second launch error after exactly two failed launches", async () => {
    const firstError = new Error("First launch failed");
    const lastError = new Error("Second launch failed");
    mocks.launch.mockRejectedValueOnce(firstError).mockRejectedValueOnce(lastError);

    await Promise.all([
      expect(generatePdfFromHtml(HTML, "[RetryTest]", [], 0)).rejects.toBe(lastError),
      vi.runAllTimersAsync(),
    ]);

    expect(mocks.launch).toHaveBeenCalledTimes(2);
  });

  it("throws the second PDF error after two attempts and closes both browsers", async () => {
    const first = makeBrowser();
    const second = makeBrowser();
    const lastError = new Error("Second PDF failed");
    first.page.pdf.mockRejectedValueOnce(new Error("First PDF failed"));
    second.page.pdf.mockRejectedValueOnce(lastError);
    mocks.launch
      .mockResolvedValueOnce(first.browser)
      .mockResolvedValueOnce(second.browser);

    await Promise.all([
      expect(generatePdfFromHtml(HTML, "[RetryTest]", [], 0)).rejects.toBe(lastError),
      vi.runAllTimersAsync(),
    ]);

    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(first.page.pdf).toHaveBeenCalledTimes(1);
    expect(second.page.pdf).toHaveBeenCalledTimes(1);
    expect(first.browser.close).toHaveBeenCalledTimes(1);
    expect(second.browser.close).toHaveBeenCalledTimes(1);
  });

  it.each(["platform", "sparticuz"] as const)(
    "preserves the HTML, viewport and PDF options for a successful %s render",
    async (runtime) => {
      if (runtime === "sparticuz") {
        vi.stubEnv("PUPPETEER_EXECUTABLE_PATH", "");
      }
      const { browser, page } = makeBrowser();
      mocks.launch.mockResolvedValueOnce(browser);

      const result = await generatePdfFromHtml(
        HTML,
        "[RetryTest]",
        ["--ignored-for-compatibility"],
        0
      );

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(Buffer.from(PDF_BYTES));
      expect(mocks.launch).toHaveBeenCalledTimes(1);
      expect(mocks.launch).toHaveBeenCalledWith({
        executablePath: runtime === "platform" ? PLATFORM_PATH : SPARTICUZ_PATH,
        headless: true,
        args: expect.arrayContaining([
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--font-render-hinting=none",
          ...(runtime === "sparticuz" ? mocks.chromium.args : []),
        ]),
      });
      expect(mocks.launch.mock.calls[0][0].args).not.toContain(
        "--ignored-for-compatibility"
      );
      expect(mocks.existsSync).toHaveBeenCalledTimes(1);
      expect(mocks.existsSync).toHaveBeenCalledWith(
        runtime === "platform" ? PLATFORM_PATH : SPARTICUZ_PATH
      );
      expect(mocks.chromium.executablePath).toHaveBeenCalledTimes(
        runtime === "sparticuz" ? 1 : 0
      );
      if (runtime === "sparticuz") {
        expect(mocks.chromium.setGraphicsMode).toBe(false);
      }
      expect(browser.newPage).toHaveBeenCalledTimes(1);
      expect(browser.close).toHaveBeenCalledTimes(1);
      expectRenderOptions(page);
    }
  );

  it("does not discard successfully generated PDFs when browser.close rejects", async () => {
    const first = makeBrowser();
    const closeError = new Error("Browser cleanup failed after successful PDF");
    first.browser.close.mockRejectedValueOnce(closeError);
    mocks.launch.mockResolvedValueOnce(first.browser);

    await Promise.all([
      expect(generatePdfFromHtml(HTML, "[RetryTest]", [], 0)).resolves.toEqual(Buffer.from(PDF_BYTES)),
      vi.runAllTimersAsync(),
    ]);

    expect(mocks.launch).toHaveBeenCalledTimes(1);
    expectRenderOptions(first.page);
    expect(first.browser.close).toHaveBeenCalledTimes(1);
    expect(await first.page.pdf.mock.results[0].value).toBe(PDF_BYTES);
  });

  it("preserves the last render error even when cleanup also fails on both attempts", async () => {
    const first = makeBrowser();
    const second = makeBrowser();
    const lastRenderError = new Error("Original second PDF failure");
    first.page.pdf.mockRejectedValueOnce(new Error("First PDF failure"));
    second.page.pdf.mockRejectedValueOnce(lastRenderError);
    const closeError = new Error("Browser cleanup failed");
    first.browser.close.mockRejectedValueOnce(closeError);
    second.browser.close.mockRejectedValueOnce(closeError);
    mocks.launch
      .mockResolvedValueOnce(first.browser)
      .mockResolvedValueOnce(second.browser);

    await Promise.all([
      expect(generatePdfFromHtml(HTML, "[RetryTest]", [], 0)).rejects.toBe(lastRenderError),
      vi.runAllTimersAsync(),
    ]);

    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(first.browser.close).toHaveBeenCalledTimes(1);
    expect(second.browser.close).toHaveBeenCalledTimes(1);
  });
});
