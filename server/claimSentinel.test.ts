import { describe, expect, it } from "vitest";
import {
  CLAIM_SENTINEL,
  CLAIM_SENTINEL_MYSQL,
  isClaimSentinel,
} from "./db";

describe("claim SENTINEL helpers", () => {
  it("exports the epoch lock used by claim/reset paths", () => {
    expect(CLAIM_SENTINEL.toISOString()).toBe("1970-01-01T00:00:01.000Z");
    expect(CLAIM_SENTINEL_MYSQL).toBe("1970-01-01 00:00:01");
  });

  it("recognizes Date and MySQL string forms of the claim lock", () => {
    expect(isClaimSentinel(CLAIM_SENTINEL)).toBe(true);
    expect(isClaimSentinel(new Date("1970-01-01T00:00:01.000Z"))).toBe(true);
    expect(isClaimSentinel(CLAIM_SENTINEL_MYSQL)).toBe(true);
    expect(isClaimSentinel("1970-01-01T00:00:01.000Z")).toBe(true);
    expect(isClaimSentinel("1970-01-01 00:00:01.000")).toBe(true);
  });

  it("rejects null, real send times, and unrelated timestamps", () => {
    expect(isClaimSentinel(null)).toBe(false);
    expect(isClaimSentinel(undefined)).toBe(false);
    expect(isClaimSentinel("")).toBe(false);
    expect(isClaimSentinel(new Date("2026-11-23T12:00:00.000Z"))).toBe(false);
    expect(isClaimSentinel("2026-11-23 12:00:00")).toBe(false);
    // Epoch midnight without the :01 second is not the claim lock
    expect(isClaimSentinel(new Date(0))).toBe(false);
    expect(isClaimSentinel("1970-01-01 00:00:00")).toBe(false);
  });
});
