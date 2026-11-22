import { describe, expect, it } from "vitest";
import { mysqlInsertId } from "./db";

describe("mysqlInsertId", () => {
  it("reads drizzle/mysql2 tuple shape [ResultSetHeader, …]", () => {
    expect(mysqlInsertId([{ insertId: 42, affectedRows: 1 }, undefined])).toBe(42);
  });

  it("reads bare ResultSetHeader shape", () => {
    expect(mysqlInsertId({ insertId: 7, affectedRows: 1 })).toBe(7);
  });

  it("returns 0 when insertId is missing or invalid", () => {
    expect(mysqlInsertId(undefined)).toBe(0);
    expect(mysqlInsertId({})).toBe(0);
    expect(mysqlInsertId([{ insertId: 0 }])).toBe(0);
    expect(mysqlInsertId([{ insertId: -1 }])).toBe(0);
  });
});
