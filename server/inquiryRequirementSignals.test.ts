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
  VIDEO_CLIPS_FIXTURE,
  CITIC_MEETING_FIXTURE,
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

  it("reads 剪埋三條影片每條20秒 as clips + seconds, not event hours", () => {
    const signals = extractRequirementSignals(VIDEO_CLIPS_FIXTURE);
    expect(signals.some((s) => s.kind === "video_edit")).toBe(true);
    expect(signals.some((s) => s.kind === "video_count" && s.value === 3)).toBe(
      true
    );
    expect(signals.some((s) => s.kind === "clip_seconds" && s.value === 20)).toBe(
      true
    );
    expect(signals.some((s) => s.kind === "event_hours" && s.value === 5)).toBe(
      true
    );
    expect(isMultiScopeSignals(signals)).toBe(true);
  });

  it("CITIC #12480003: 4h + 200 photos + 30 retouch + 1-min video, not 3-day deadline", () => {
    const signals = extractRequirementSignals(CITIC_MEETING_FIXTURE);
    expect(signals.some((s) => s.kind === "event_hours" && s.value === 4)).toBe(
      true
    );
    expect(signals.some((s) => s.kind === "shot_count" && s.value === 200)).toBe(
      true
    );
    expect(
      signals.some((s) => s.kind === "retouch_count" && s.value === 30)
    ).toBe(true);
    expect(
      signals.some((s) => s.kind === "revision_rounds" && s.value === 3)
    ).toBe(true);
    expect(
      signals.some((s) => s.kind === "clip_seconds" && s.value === 60)
    ).toBe(true);
    expect(signals.some((s) => s.kind === "video_edit")).toBe(true);
    expect(signals.some((s) => s.kind === "event_days")).toBe(false);
    expect(isMultiScopeSignals(signals)).toBe(true);
  });
});
