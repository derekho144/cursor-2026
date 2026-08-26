import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  localOpenIdForUsername,
} from "./passwordAuth";

describe("passwordAuth", () => {
  it("hashes and verifies password", () => {
    const hash = hashPassword("Secret123!");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("Secret123!", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("builds local openId from username", () => {
    expect(localOpenIdForUsername("Alice")).toBe("local_alice");
  });
});
