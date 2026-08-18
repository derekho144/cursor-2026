import { describe, expect, it } from "vitest";
import { detectCrewHighValue } from "./inquiryCrewHighValue";

describe("detectCrewHighValue", () => {
  it("treats AWL-style 2 chief + 2 video assistants as high value", () => {
    const r = detectCrewHighValue(
      "邀請報價\n拍攝安排：2 Chief photographer + 2 拍攝助理 (video)"
    );
    expect(r.photographerCount).toBe(2);
    expect(r.assistantCount).toBe(2);
    expect(r.hasVideoTeam).toBe(true);
    expect(r.highValue).toBe(true);
  });

  it("treats 2 cameras / 兩機 as NOT automatically high value", () => {
    expect(detectCrewHighValue("需要兩機拍攝全日活動").highValue).toBe(false);
    expect(detectCrewHighValue("2 cameras required").cameraCount).toBe(2);
    expect(detectCrewHighValue("雙機位 coverage").highValue).toBe(false);
  });

  it("does not flag 2 photographers for a short 3-hour shoot as high value", () => {
    const r = detectCrewHighValue("2 位攝影師，拍攝約 3 小時，只要拍照");
    expect(r.photographerCount).toBe(2);
    expect(r.hasVideoTeam).toBe(false);
    expect(r.highValue).toBe(false);
  });

  it("does not flag a single photographer default inquiry", () => {
    const r = detectCrewHighValue("想問下公司活動攝影報價，大約 4 小時，一位攝影師就可以。");
    expect(r.highValue).toBe(false);
  });

  it("does not treat 機構 as cameras", () => {
    expect(detectCrewHighValue("本機構需要產品攝影報價").highValue).toBe(false);
  });
});
