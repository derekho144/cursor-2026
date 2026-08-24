import { describe, it, expect } from "vitest";
import {
  parseAllowedPages,
  userCanAccessPage,
  resolvePageIdForPath,
} from "@shared/pagePermissions";

describe("pagePermissions", () => {
  it("parses allowed pages and drops unknowns", () => {
    expect(parseAllowedPages(["quotes", "hack", "clients"])).toEqual([
      "quotes",
      "clients",
    ]);
  });

  it("admin can access any page", () => {
    expect(
      userCanAccessPage({
        role: "admin",
        isActive: true,
        allowedPages: [],
        pageId: "expenses",
      })
    ).toBe(true);
  });

  it("inactive user cannot access", () => {
    expect(
      userCanAccessPage({
        role: "user",
        isActive: false,
        allowedPages: ["quotes"],
        pageId: "quotes",
      })
    ).toBe(false);
  });

  it("user only sees allowed pages", () => {
    expect(
      userCanAccessPage({
        role: "user",
        isActive: true,
        allowedPages: ["quotes", "clients"],
        pageId: "quotes",
      })
    ).toBe(true);
    expect(
      userCanAccessPage({
        role: "user",
        isActive: true,
        allowedPages: ["quotes", "clients"],
        pageId: "expenses",
      })
    ).toBe(false);
  });

  it("resolves path to page id", () => {
    expect(resolvePageIdForPath("/")).toBe("dashboard");
    expect(resolvePageIdForPath("/quotes/12/edit")).toBe("quotes");
    expect(resolvePageIdForPath("/employees")).toBe("employees");
    expect(resolvePageIdForPath("/pricing-learning")).toBe("pricing-learning");
    expect(resolvePageIdForPath("/delivery/abc")).toBe(null);
  });
});
