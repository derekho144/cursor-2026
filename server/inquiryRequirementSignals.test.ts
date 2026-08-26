import { describe, expect, it } from "vitest";
import {
  extractRequirementSignals,
  formatSignalsForPrompt,
  isMultiScopeSignals,
} from "../shared/inquiryRequirementSignals";
import {
  HKSEA_FIXTURE,
  HKRC_FIXTURE,
  HA_FIXTURE,
} from "./inquiryComprehension.fixtures";

describe("extractRequirementSignals", () => {
  it("HKSEA: 200 artwork + 去背 + ~5h event, not 7-day delivery", () => {
    const signals = extractRequirementSignals(HKSEA_FIXTURE);
    expect(signals.some((s) => s.kind === "background_removal")).toBe(true);
    const shots = signals.find((s) => s.kind === "shot_count");
    expect(shots?.value).toBe(200);
    const hours = signals.filter((s) => s.kind === "event_hours");
    expect(hours.some((s) => s.value === 5)).toBe(true);
    expect(signals.some((s) => s.kind === "event_days" && s.value === 7)).toBe(
      false
    );
    expect(isMultiScopeSignals(signals)).toBe(true);
  });

  it("HKRC: 3 days + 120 photos, not 3 hours", () => {
    const signals = extractRequirementSignals(HKRC_FIXTURE);
    expect(signals.some((s) => s.kind === "event_days" && s.value === 3)).toBe(
      true
    );
    expect(signals.some((s) => s.kind === "shot_count" && s.value === 120)).toBe(
      true
    );
    expect(signals.some((s) => s.kind === "event_hours" && s.value === 3)).toBe(
      false
    );
    expect(formatSignalsForPrompt(signals)).toContain("3 天");
  });

  it("plain 3-hour graduation is hours + shots, not days", () => {
    const signals = extractRequirementSignals(HA_FIXTURE);
    expect(signals.some((s) => s.kind === "event_hours" && s.value === 3)).toBe(
      true
    );
    expect(signals.some((s) => s.kind === "event_days")).toBe(false);
    expect(signals.some((s) => s.kind === "shot_count" && s.value === 40)).toBe(
      true
    );
  });

  it("does not treat 2026 as a shot count", () => {
    const signals = extractRequirementSignals(HKSEA_FIXTURE);
    expect(signals.some((s) => s.kind === "shot_count" && s.value === 2026)).toBe(
      false
    );
  });

  it("does not treat 12月15-22日 as 7 hours", () => {
    const signals = extractRequirementSignals(HKSEA_FIXTURE);
    const hours = signals.filter((s) => s.kind === "event_hours");
    expect(hours).toHaveLength(1);
    expect(hours[0].value).toBe(5);
  });
});
