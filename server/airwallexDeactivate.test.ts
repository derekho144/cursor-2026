import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const deactivateRemoteMock = vi.fn();
const isConfiguredMock = vi.fn();
const getDbMock = vi.fn();

vi.mock("./airwallex", async () => {
  const actual = await vi.importActual<typeof import("./airwallex")>("./airwallex");
  return {
    ...actual,
    deactivateAirwallexPaymentLink: (...args: unknown[]) =>
      deactivateRemoteMock(...args),
    isAirwallexConfigured: () => isConfiguredMock(),
  };
});

vi.mock("./db", () => ({
  getDb: () => getDbMock(),
  resyncClientMembershipFromQuotes: vi.fn(),
}));

describe("deactivateUnpaidAirwallexLinksForQuote", () => {
  beforeEach(() => {
    vi.resetModules();
    listMock.mockReset();
    updateSetMock.mockReset();
    updateWhereMock.mockReset();
    deactivateRemoteMock.mockReset();
    isConfiguredMock.mockReset();
    getDbMock.mockReset();

    updateWhereMock.mockResolvedValue(undefined);
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    getDbMock.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => listMock(),
            limit: () => listMock(),
          }),
        }),
      }),
      update: () => ({ set: updateSetMock }),
      execute: vi.fn(),
    });
  });

  it("no-ops when quoteId is invalid", async () => {
    const { deactivateUnpaidAirwallexLinksForQuote } = await import(
      "./airwallexPayment"
    );
    const result = await deactivateUnpaidAirwallexLinksForQuote(0);
    expect(result).toEqual({ deactivated: 0 });
    expect(deactivateRemoteMock).not.toHaveBeenCalled();
  });

  it("no-ops when there are no UNPAID links", async () => {
    isConfiguredMock.mockReturnValue(true);
    const rows = [
      {
        id: 1,
        quoteId: 3,
        kind: "deposit",
        airwallexId: "pl_paid",
        url: "https://pay/pl_paid",
        amount: "100.00",
        currency: "HKD",
        status: "PAID",
        paymentIntentId: "int_1",
        paidAt: new Date(),
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        quoteId: 3,
        kind: "balance",
        airwallexId: "pl_off",
        url: "https://pay/pl_off",
        amount: "100.00",
        currency: "HKD",
        status: "DISABLED",
        paymentIntentId: null,
        paidAt: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    getDbMock.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => rows,
            limit: async () => rows,
          }),
        }),
      }),
      update: () => ({ set: updateSetMock }),
      execute: vi.fn().mockResolvedValue(undefined),
    });

    const { deactivateUnpaidAirwallexLinksForQuote } = await import(
      "./airwallexPayment"
    );
    const result = await deactivateUnpaidAirwallexLinksForQuote(3);
    expect(result).toEqual({ deactivated: 0 });
    expect(deactivateRemoteMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("deactivates remote UNPAID links then marks DISABLED locally", async () => {
    isConfiguredMock.mockReturnValue(true);
    deactivateRemoteMock.mockResolvedValue(undefined);

    const unpaidRows = [
      {
        id: 1,
        quoteId: 42,
        kind: "deposit",
        airwallexId: "pl_live_1",
        url: "https://pay.airwallex.com/pl_live_1",
        amount: "5000.00",
        currency: "HKD",
        status: "UNPAID",
        paymentIntentId: null,
        paidAt: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        quoteId: 42,
        kind: "balance",
        airwallexId: "pl_live_2",
        url: "https://pay.airwallex.com/pl_live_2",
        amount: "5000.00",
        currency: "HKD",
        status: "UNPAID",
        paymentIntentId: null,
        paidAt: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    // listAirwallexPaymentLinksForQuote: select().from().where().orderBy()
    getDbMock.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => unpaidRows,
            limit: async () => unpaidRows,
          }),
        }),
      }),
      update: () => ({ set: updateSetMock }),
      execute: vi.fn().mockResolvedValue(undefined),
    });

    const { deactivateUnpaidAirwallexLinksForQuote } = await import(
      "./airwallexPayment"
    );
    const result = await deactivateUnpaidAirwallexLinksForQuote(42);
    expect(result.deactivated).toBe(2);
    expect(deactivateRemoteMock).toHaveBeenCalledWith("pl_live_1");
    expect(deactivateRemoteMock).toHaveBeenCalledWith("pl_live_2");
    expect(updateSetMock).toHaveBeenCalledWith({ status: "DISABLED" });
    expect(updateSetMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when remote deactivate errors (does not delete-safe)", async () => {
    isConfiguredMock.mockReturnValue(true);
    deactivateRemoteMock.mockRejectedValue(new Error("upstream 500"));

    const unpaidRows = [
      {
        id: 1,
        quoteId: 7,
        kind: "full",
        airwallexId: "pl_fail",
        url: "https://pay.airwallex.com/pl_fail",
        amount: "10000.00",
        currency: "HKD",
        status: "UNPAID",
        paymentIntentId: null,
        paidAt: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    getDbMock.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => unpaidRows,
            limit: async () => unpaidRows,
          }),
        }),
      }),
      update: () => ({ set: updateSetMock }),
      execute: vi.fn().mockResolvedValue(undefined),
    });

    const { deactivateUnpaidAirwallexLinksForQuote } = await import(
      "./airwallexPayment"
    );
    await expect(deactivateUnpaidAirwallexLinksForQuote(7)).rejects.toThrow(
      /無法停用 Airwallex/
    );
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("marks DISABLED locally when Airwallex is not configured", async () => {
    isConfiguredMock.mockReturnValue(false);
    const unpaidRows = [
      {
        id: 1,
        quoteId: 9,
        kind: "deposit",
        airwallexId: "pl_local",
        url: "https://example/pl_local",
        amount: "1000.00",
        currency: "HKD",
        status: "UNPAID",
        paymentIntentId: null,
        paidAt: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    getDbMock.mockResolvedValue({
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: async () => unpaidRows,
            limit: async () => unpaidRows,
          }),
        }),
      }),
      update: () => ({ set: updateSetMock }),
      execute: vi.fn().mockResolvedValue(undefined),
    });

    const { deactivateUnpaidAirwallexLinksForQuote } = await import(
      "./airwallexPayment"
    );
    const result = await deactivateUnpaidAirwallexLinksForQuote(9);
    expect(result.deactivated).toBe(1);
    expect(deactivateRemoteMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith({ status: "DISABLED" });
  });
});
