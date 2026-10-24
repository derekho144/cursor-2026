import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the db module
vi.mock("./db", () => ({
  getClients: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getClientById: vi.fn().mockResolvedValue(null),
  createClient: vi.fn().mockResolvedValue({ id: 1, name: "Test Client", company: null, email: null, phone: null, address: null, notes: null, createdAt: new Date(), updatedAt: new Date() }),
  updateClient: vi.fn().mockResolvedValue({ id: 1, name: "Updated Client" }),
  deleteClient: vi.fn().mockResolvedValue(undefined),
  searchClients: vi.fn().mockResolvedValue([]),
  getQuotes: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  getQuoteById: vi.fn().mockResolvedValue(null),
  createQuote: vi.fn().mockResolvedValue({ id: 1, quoteNumber: "QT-2026-0001" }),
  updateQuote: vi.fn().mockResolvedValue({ id: 1 }),
  deleteQuote: vi.fn().mockResolvedValue(undefined),
  getDashboardStats: vi.fn().mockResolvedValue({
    totalQuotes: 0,
    totalRevenue: 0,
    monthlyAdSpend: 0,
  }),
  getAdExpenses: vi.fn().mockResolvedValue([]),
  getAdExpenseSummary: vi.fn().mockResolvedValue([]),
  upsertAdExpense: vi.fn().mockResolvedValue(1),
  deleteAdExpense: vi.fn().mockResolvedValue(undefined),
  getAdPlatformConfigs: vi.fn().mockResolvedValue([]),
  upsertAdPlatformConfig: vi.fn().mockResolvedValue(undefined),
  updateAdPlatformSyncStatus: vi.fn().mockResolvedValue(undefined),
  createAdSyncLog: vi.fn().mockResolvedValue(undefined),
  getAdSyncLogs: vi.fn().mockResolvedValue([]),
  getPlatformCredential: vi.fn().mockResolvedValue(null),
  getAllPlatformCredentials: vi.fn().mockResolvedValue([]),
  savePlatformCredential: vi.fn().mockResolvedValue(undefined),
  deletePlatformCredential: vi.fn().mockResolvedValue(undefined),
  getPro360Cookies: vi.fn().mockResolvedValue(null),
  savePro360Cookies: vi.fn().mockResolvedValue(undefined),
  getHelloTobyCookies: vi.fn().mockResolvedValue(null),
  saveHelloTobyCookies: vi.fn().mockResolvedValue(undefined),
  getPlatformEfficiency: vi.fn().mockResolvedValue([]),
  upsertClientFromQuote: vi.fn().mockResolvedValue({ id: 1, name: "Test Client" }),
  listRecentAdsWhatsappClicks: vi.fn().mockResolvedValue([
    {
      id: 9,
      source: "google_ads",
      refCode: "W7K3M",
      gclid: "test-gclid",
      adsCampaignId: "24002224927",
      adsCampaignName: "Search #3",
      utmCampaign: "search-3",
      landingPageUrl: "https://jdstudiohk.com/food-photography",
      clickedAt: new Date("2026-10-20T04:00:00Z"),
      quoteId: null,
    },
  ]),
  findAdsWhatsappClickByRef: vi.fn().mockImplementation(async (ref: string) => {
    if (String(ref).toUpperCase().includes("W7K3M")) {
      return {
        id: 9,
        source: "google_ads",
        refCode: "W7K3M",
        gclid: "test-gclid",
        adsCampaignId: "24002224927",
        adsCampaignName: "Search #3",
        landingPageUrl: "https://jdstudiohk.com/food-photography",
        quoteId: null,
      };
    }
    return null;
  }),
  linkWhatsappClickToQuote: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("./adsOfflineConversions", () => ({
  scheduleQuoteInquiryConversionUpload: vi.fn(),
  scheduleQuoteAcceptedConversionUpload: vi.fn(),
  ensureAdsOfflineConversionSchema: vi.fn().mockResolvedValue(undefined),
}));

// Mock scheduler
vi.mock("./scheduler", () => ({
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  getSchedulerStatus: vi.fn().mockResolvedValue({
    lastSyncAt: null,
    nextSyncAt: null,
    intervalDays: 7,
    hellotoby: { lastSyncAt: null, nextSyncAt: null },
  }),
}));

// Mock scrapers
vi.mock("./scrapers/hellotoby", () => ({
  scrapeHellotobyExpenses: vi.fn(),
  scrapePro360Expenses: vi.fn(),
  scrapePro360WithCookies: vi.fn(),
  scrapeHelloTobyWithCookies: vi.fn(),
}));

// Mock LLM and storage
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: "Professional photography service description." } }],
  }),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.example.com/quotes/test.html", key: "quotes/test.html" }),
}));

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-user",
      email: "admin@jdstudiohk.com",
      name: "JD Admin",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("quotes router", () => {
  it("list returns empty array initially", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.quotes.list({ limit: 20, offset: 0 });
    expect(result).toEqual({ data: [], total: 0 });
  });

  it("create returns new quote with id", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.quotes.create({
      clientName: "Test Client",
      serviceType: "corporate_event",
      leadSource: "Other",
      subtotal: 5000,
      discountAmount: 0,
      total: 5000,
      currency: "HKD",
      items: [
        {
          description: "Corporate Event Photography",
          quantity: 1,
          unit: "day",
          unitPrice: 5000,
          amount: 5000,
        },
      ],
    });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("quoteNumber");
  });

  it("create persists Ads attribution and links WA click", async () => {
    const db = await import("./db");
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await caller.quotes.create({
      clientName: "Ads Lead",
      serviceType: "food_beverage",
      leadSource: "Google",
      gclid: "test-gclid",
      adsCampaignId: "24002224927",
      adsCampaignName: "Search #3",
      landingPageUrl: "https://jdstudiohk.com/food-photography",
      utmSource: "google",
      utmMedium: "cpc",
      whatsappClickId: 9,
      subtotal: 3000,
      discountAmount: 0,
      total: 3000,
      currency: "HKD",
      items: [
        {
          description: "Food photography",
          quantity: 1,
          unit: "式",
          unitPrice: 3000,
          amount: 3000,
        },
      ],
    });
    expect(db.createQuote).toHaveBeenCalled();
    const arg = (db.createQuote as any).mock.calls.at(-1)?.[0];
    expect(arg.gclid).toBe("test-gclid");
    expect(arg.adsCampaignId).toBe("24002224927");
    expect(arg.landingPageUrl).toBe("https://jdstudiohk.com/food-photography");
    expect(arg.whatsappClickId).toBe(9);
    expect(db.linkWhatsappClickToQuote).toHaveBeenCalledWith(9, 1);
    const oci = await import("./adsOfflineConversions");
    expect(oci.scheduleQuoteInquiryConversionUpload).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, gclid: "test-gclid" })
    );
  });

  it("recentAdsWaClicks returns attributed clicks", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.quotes.recentAdsWaClicks({ limit: 10 });
    expect(result).toHaveLength(1);
    expect(result[0].gclid).toBe("test-gclid");
    expect(result[0].adsCampaignId).toBe("24002224927");
  });

  it("lookupAdsWaClickByRef matches short code from WA first line", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const hit = await caller.quotes.lookupAdsWaClickByRef({
      ref: "你好，我想查詢JD Studio的攝影服務（W7K3M）",
    });
    expect(hit?.id).toBe(9);
    expect(hit?.refCode).toBe("W7K3M");
    const miss = await caller.quotes.lookupAdsWaClickByRef({ ref: "W9999" });
    expect(miss).toBeNull();
  });

  it.each([
    "graphic_design",
    "ad_video",
    "web_development",
    "ai_photography",
    "menu_design",
  ])("create quote with new service type: %s", async (serviceType) => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.quotes.create({
      clientName: "Test Client",
      serviceType: serviceType as any,
      leadSource: "Other",
      subtotal: 5000,
      discountAmount: 0,
      total: 5000,
      currency: "HKD",
      items: [
        {
          description: "Test service item",
          quantity: 1,
          unit: "式",
          unitPrice: 5000,
          amount: 5000,
        },
      ],
    });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("quoteNumber");
  });

  it("delete returns success", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.quotes.delete({ id: 1 });
    expect(result).toEqual({ success: true });
  });
});

describe("adExpenses router", () => {
  it("list returns empty array", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adExpenses.list({ year: 2026 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("upsert creates expense record", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adExpenses.upsert({
      platform: "google_ads",
      year: 2026,
      month: 3,
      amount: 3500,
    });
    expect(result).toHaveProperty("success", true);
  });

  it("getPlatformConfigs returns array", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adExpenses.getPlatformConfigs();
    expect(Array.isArray(result)).toBe(true);
  });

  it("savePlatformConfig returns success", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adExpenses.savePlatformConfig({
      platform: "hellotoby",
      isEnabled: true,
    });
    expect(result).toEqual({ success: true });
  });

  it("saveHelloTobyCookies validates and stores cookies", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const validCookies = JSON.stringify([
      { name: "nftoken", value: "abc123", domain: "www.hellotoby.com" },
      { name: "nfsession", value: "xyz789", domain: "www.hellotoby.com" },
    ]);
    const result = await caller.adExpenses.saveHelloTobyCookies({
      cookiesJson: validCookies,
      accountEmail: "derekho1155@gmail.com",
      skipProbe: true,
    });
    expect(result).toEqual({ success: true, accountEmail: "derekho1155@gmail.com" });
  });

  it("saveHelloTobyCookies rejects invalid cookies without nftoken or nfsession", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const invalidCookies = JSON.stringify([
      { name: "some_other_cookie", value: "value", domain: "www.hellotoby.com" },
    ]);
    await expect(
      caller.adExpenses.saveHelloTobyCookies({
        cookiesJson: invalidCookies,
        accountEmail: "derekho1155@gmail.com",
        skipProbe: true,
      })
    ).rejects.toThrow();
  });

  it("saveHelloTobyCookies requires account email", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const validCookies = JSON.stringify([
      { name: "nftoken", value: "abc123", domain: "www.hellotoby.com" },
    ]);
    await expect(
      caller.adExpenses.saveHelloTobyCookies({
        cookiesJson: validCookies,
        accountEmail: "not-an-email" as any,
        skipProbe: true,
      })
    ).rejects.toThrow();
  });

  it("getSchedulerStatus returns hellotoby field", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adExpenses.getSchedulerStatus();
    expect(result).toHaveProperty("intervalDays", 7);
    expect(result).toHaveProperty("hellotoby");
  });

  it("triggerAutoSync rejects unsupported platforms", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.adExpenses.triggerAutoSync({ platform: "freehunter" })).rejects.toThrow();
  });

  it("triggerAutoSync fails gracefully when HelloToby cookies not set", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    // getHelloTobyCookies returns null by default in mock
    await expect(caller.adExpenses.triggerAutoSync({ platform: "hellotoby" })).rejects.toThrow();
  });
});

describe("dashboard router", () => {
  it("stats returns dashboard statistics", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.stats();
    expect(result).toHaveProperty("totalQuotes");
    expect(result).toHaveProperty("totalRevenue");
    expect(result).toHaveProperty("monthlyAdSpend");
  });
});

describe("clients router", () => {
  it("list returns empty array initially", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.list({ limit: 20, offset: 0 });
    expect(result).toEqual({ data: [], total: 0 });
  });

  it("search returns array", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.search({ query: "test" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("create returns new client with id", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.create({
      name: "Test Client",
      company: "Test Co",
      email: "test@example.com",
      phone: "+852 1234 5678",
    });
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("name", "Test Client");
  });

  it("getById throws NOT_FOUND when client does not exist", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.clients.getById({ id: 999 })).rejects.toThrow();
  });

  it("delete returns success", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.delete({ id: 1 });
    expect(result).toEqual({ success: true });
  });
});
