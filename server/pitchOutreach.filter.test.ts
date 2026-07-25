/**
 * pitchOutreach.filter.test.ts
 * Unit tests for job title filtering logic in the pitch outreach system
 */
import { describe, it, expect } from "vitest";

// Replicate the filtering logic from pitchOutreach.ts
const CORE_KEYWORDS = [
  'photographer', 'videographer', 'cinematographer',
  '攝影師', '攝錄師',
];

const isRelevantJob = (title: string): boolean => {
  const t = title.toLowerCase();
  return CORE_KEYWORDS.some(kw => t.includes(kw.toLowerCase()));
};

describe("Job Title Filtering Logic", () => {
  describe("Should accept relevant job titles", () => {
    it("should accept 'Product Photographer'", () => {
      expect(isRelevantJob("Product Photographer")).toBe(true);
    });

    it("should accept 'Food Photographer'", () => {
      expect(isRelevantJob("Food Photographer")).toBe(true);
    });

    it("should accept 'Fashion Photographer'", () => {
      expect(isRelevantJob("Fashion Photographer")).toBe(true);
    });

    it("should accept 'Commercial Photographer'", () => {
      expect(isRelevantJob("Commercial Photographer")).toBe(true);
    });

    it("should accept 'Videographer'", () => {
      expect(isRelevantJob("Videographer")).toBe(true);
    });

    it("should accept 'Video Production Videographer'", () => {
      expect(isRelevantJob("Video Production Videographer")).toBe(true);
    });

    it("should accept 'Cinematographer'", () => {
      expect(isRelevantJob("Cinematographer")).toBe(true);
    });

    it("should accept '攝影師' (Chinese)", () => {
      expect(isRelevantJob("攝影師")).toBe(true);
    });

    it("should accept '產品攝影師' (Chinese)", () => {
      expect(isRelevantJob("產品攝影師")).toBe(true);
    });

    it("should accept '攝錄師' (Chinese)", () => {
      expect(isRelevantJob("攝錄師")).toBe(true);
    });

    it("should accept 'Junior Photographer'", () => {
      expect(isRelevantJob("Junior Photographer")).toBe(true);
    });

    it("should accept 'Senior Videographer'", () => {
      expect(isRelevantJob("Senior Videographer")).toBe(true);
    });

    it("should accept 'Lead Cinematographer'", () => {
      expect(isRelevantJob("Lead Cinematographer")).toBe(true);
    });
  });

  describe("Should reject irrelevant job titles", () => {
    it("should reject 'Product Designer'", () => {
      expect(isRelevantJob("Product Designer")).toBe(false);
    });

    it("should reject 'Fashion Designer'", () => {
      expect(isRelevantJob("Fashion Designer")).toBe(false);
    });

    it("should reject 'UX Designer'", () => {
      expect(isRelevantJob("UX Designer")).toBe(false);
    });

    it("should reject 'Graphic Designer'", () => {
      expect(isRelevantJob("Graphic Designer")).toBe(false);
    });

    it("should reject 'Web Designer'", () => {
      expect(isRelevantJob("Web Designer")).toBe(false);
    });

    it("should reject 'Product Manager'", () => {
      expect(isRelevantJob("Product Manager")).toBe(false);
    });

    it("should reject 'Marketing Manager'", () => {
      expect(isRelevantJob("Marketing Manager")).toBe(false);
    });

    it("should reject 'Sales Executive'", () => {
      expect(isRelevantJob("Sales Executive")).toBe(false);
    });

    it("should reject 'HR Manager'", () => {
      expect(isRelevantJob("HR Manager")).toBe(false);
    });

    it("should reject 'Software Engineer'", () => {
      expect(isRelevantJob("Software Engineer")).toBe(false);
    });

    it("should reject 'Data Analyst'", () => {
      expect(isRelevantJob("Data Analyst")).toBe(false);
    });

    it("should reject 'Content Writer'", () => {
      expect(isRelevantJob("Content Writer")).toBe(false);
    });

    it("should reject 'Social Media Manager'", () => {
      expect(isRelevantJob("Social Media Manager")).toBe(false);
    });

    it("should reject 'Video Editor' (not videographer)", () => {
      expect(isRelevantJob("Video Editor")).toBe(false);
    });

    it("should reject 'Photo Retoucher' (not photographer)", () => {
      expect(isRelevantJob("Photo Retoucher")).toBe(false);
    });

    it("should reject 'Photography Assistant' (not photographer)", () => {
      expect(isRelevantJob("Photography Assistant")).toBe(false);
    });
  });

  describe("Case insensitivity", () => {
    it("should accept 'PHOTOGRAPHER' (uppercase)", () => {
      expect(isRelevantJob("PHOTOGRAPHER")).toBe(true);
    });

    it("should accept 'PhOtOgRaPhEr' (mixed case)", () => {
      expect(isRelevantJob("PhOtOgRaPhEr")).toBe(true);
    });

    it("should accept 'VIDEOGRAPHER' (uppercase)", () => {
      expect(isRelevantJob("VIDEOGRAPHER")).toBe(true);
    });

    it("should accept 'CINEMATOGRAPHER' (uppercase)", () => {
      expect(isRelevantJob("CINEMATOGRAPHER")).toBe(true);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty string", () => {
      expect(isRelevantJob("")).toBe(false);
    });

    it("should handle whitespace only", () => {
      expect(isRelevantJob("   ")).toBe(false);
    });

    it("should reject 'photo' alone (not in keywords)", () => {
      expect(isRelevantJob("Photo Specialist")).toBe(false);
    });

    it("should reject 'video' alone (not in keywords)", () => {
      expect(isRelevantJob("Video Specialist")).toBe(false);
    });
  });
});
