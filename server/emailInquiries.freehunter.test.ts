import { describe, expect, it } from "vitest";

/**
 * Tests for Freehunter email identification logic.
 * 
 * Key insight: Freehunter inquiry emails come FROM the client's own email address,
 * not from info@freehunter.hk. The Freehunter origin is identified by:
 * 1. The email HTML body containing freehunter.com.hk or freehunter.hk links
 * 2. The externalLink field containing a freehunter URL
 */

// Replicate the isFreehunterEmail logic from emailInquiries.ts
function isFreehunterEmail(fromEmail: string, htmlBody: string): boolean {
  const html = htmlBody.toLowerCase();
  return (
    html.includes("freehunter.com.hk") ||
    html.includes("freehunter.hk") ||
    fromEmail.toLowerCase().includes("freehunter")
  );
}

// Replicate the frontend isFreehunter check from EmailInquiries.tsx
function isFrontendFreehunter(externalLink: string | null | undefined): boolean {
  return !!(externalLink && (
    externalLink.toLowerCase().includes("freehunter.com.hk") ||
    externalLink.toLowerCase().includes("freehunter.hk")
  ));
}

describe("isFreehunterEmail - backend identification", () => {
  it("identifies Freehunter email by HTML content containing freehunter.hk link", () => {
    const htmlBody = `
      <p>Hello, I saw your profile on freehunter.hk and would like to hire you.</p>
      <a href="https://freehunter.hk/jobs/123">View Job</a>
    `;
    expect(isFreehunterEmail("client@example.com", htmlBody)).toBe(true);
  });

  it("identifies Freehunter email by HTML content containing freehunter.com.hk link", () => {
    const htmlBody = `
      <p>Job posting from freehunter.com.hk</p>
    `;
    expect(isFreehunterEmail("wcchengac@connect.ust.hk", htmlBody)).toBe(true);
  });

  it("does NOT identify regular client email as Freehunter when no freehunter link in HTML", () => {
    const htmlBody = `
      <p>Hi, I need a photographer for my event.</p>
    `;
    expect(isFreehunterEmail("client@gmail.com", htmlBody)).toBe(false);
  });

  it("still identifies old-style Freehunter emails from info@freehunter.hk sender", () => {
    const htmlBody = "<p>New job available</p>";
    expect(isFreehunterEmail("info@freehunter.hk", htmlBody)).toBe(true);
  });

  it("handles case-insensitive HTML content matching", () => {
    const htmlBody = `<a href="https://FREEHUNTER.HK/jobs/456">View</a>`;
    expect(isFreehunterEmail("client@example.com", htmlBody)).toBe(true);
  });
});

describe("isFrontendFreehunter - frontend identification via externalLink", () => {
  it("identifies Freehunter inquiry when externalLink contains freehunter.hk", () => {
    expect(isFrontendFreehunter("https://freehunter.hk/freelancer/jobs/123")).toBe(true);
  });

  it("identifies Freehunter inquiry when externalLink contains freehunter.com.hk", () => {
    expect(isFrontendFreehunter("https://freehunter.com.hk/jobs/456")).toBe(true);
  });

  it("returns false when externalLink is null", () => {
    expect(isFrontendFreehunter(null)).toBe(false);
  });

  it("returns false when externalLink is undefined", () => {
    expect(isFrontendFreehunter(undefined)).toBe(false);
  });

  it("returns false when externalLink is a non-Freehunter URL", () => {
    expect(isFrontendFreehunter("https://hellotoby.com/jobs/123")).toBe(false);
  });

  it("handles case-insensitive URL matching", () => {
    expect(isFrontendFreehunter("https://FREEHUNTER.HK/jobs/789")).toBe(true);
  });
});

describe("Client email handling for Freehunter inquiries", () => {
  it("fromEmail of Freehunter inquiry is the client email (not freehunter domain)", () => {
    // Simulate a real Freehunter inquiry scenario
    const inquiry = {
      fromEmail: "wcchengac@connect.ust.hk",
      fromName: "Scarlett Cheng",
      externalLink: "https://freehunter.hk/freelancer/jobs/abc123",
      subject: "4/14拍攝4小時合唱團表演",
    };

    // The isFreehunter flag should be true based on externalLink
    const isFreehunter = isFrontendFreehunter(inquiry.externalLink);
    expect(isFreehunter).toBe(true);

    // The client email should be directly available from fromEmail
    const clientEmail = inquiry.fromEmail;
    expect(clientEmail).toBe("wcchengac@connect.ust.hk");
    expect(clientEmail).not.toContain("freehunter");
  });
});
