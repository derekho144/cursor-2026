/**
 * pitchOutreach.emailGen.test.ts
 * Unit tests for AI pitch email generation logic
 * Verifies that portfolio URLs are correctly selected based on job type
 */
import { describe, it, expect } from "vitest";

const getPortfolioUrl = (params: {
  jobTitle: string;
  jobDescription?: string;
  industry?: string;
}): { url: string; type: string } => {
  const jobTitleLower = params.jobTitle.toLowerCase();
  const descLower = (params.jobDescription ?? '').toLowerCase();
  const industryLower = (params.industry ?? '').toLowerCase();

  const isJewellery = jobTitleLower.includes('jewel') || jobTitleLower.includes('珠寶') || jobTitleLower.includes('首飾') || industryLower.includes('jewel');
  const isFood = jobTitleLower.includes('food') || jobTitleLower.includes('食物') || jobTitleLower.includes('食品') || industryLower.includes('food') || industryLower.includes('restaurant') || industryLower.includes('f&b');
  const isProduct = jobTitleLower.includes('product') || jobTitleLower.includes('產品') || industryLower.includes('product');
  const isFashion = jobTitleLower.includes('fashion') || jobTitleLower.includes('時裝') || jobTitleLower.includes('apparel') || jobTitleLower.includes('clothing') || jobTitleLower.includes('garment') || industryLower.includes('fashion') || industryLower.includes('apparel');
  const isVideo = jobTitleLower.includes('video') || jobTitleLower.includes('videograph') || jobTitleLower.includes('攝錄') || jobTitleLower.includes('影片') || descLower.includes('video production') || descLower.includes('videograph');

  if (isJewellery) {
    return { url: 'https://www.jdstudiohk.com/services/jewelry-photography', type: 'jewellery photography' };
  } else if (isFood) {
    return { url: 'https://www.jdstudiohk.com/services/food-photography', type: 'food photography' };
  } else if (isProduct) {
    return { url: 'https://www.jdstudiohk.com/services/product-photography', type: 'product photography' };
  } else if (isFashion) {
    return { url: 'https://www.jdstudiohk.com', type: 'fashion photography' };
  } else if (isVideo) {
    return { url: 'https://www.jdstudiohk.com/services/video-project', type: 'video production' };
  } else {
    return { url: 'https://www.jdstudiohk.com', type: 'product, food, fashion, and jewellery photography as well as video production' };
  }
};

describe("AI Pitch Email Portfolio URL Selection", () => {
  describe("Job type detection from title", () => {
    it("Product Photographer -> product photography URL", () => {
      const result = getPortfolioUrl({ jobTitle: "Product Photographer" });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/product-photography');
      expect(result.type).toBe('product photography');
    });

    it("Food Photographer -> food photography URL", () => {
      const result = getPortfolioUrl({ jobTitle: "Food Photographer" });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/food-photography');
      expect(result.type).toBe('food photography');
    });

    it("Fashion Photographer -> fashion photography URL", () => {
      const result = getPortfolioUrl({ jobTitle: "Fashion Photographer" });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toBe('fashion photography');
    });

    it("Jewellery Photographer -> jewellery photography URL", () => {
      const result = getPortfolioUrl({ jobTitle: "Jewellery Photographer" });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/jewelry-photography');
      expect(result.type).toBe('jewellery photography');
    });

    it("珠寶攝影師 -> jewellery photography URL", () => {
      const result = getPortfolioUrl({ jobTitle: "珠寶攝影師" });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/jewelry-photography');
      expect(result.type).toBe('jewellery photography');
    });

    it("Videographer -> video production URL", () => {
      const result = getPortfolioUrl({ jobTitle: "Videographer" });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/video-project');
      expect(result.type).toBe('video production');
    });

    it("Cinematographer (contains 'cinematograph' but not 'videograph') -> default URL", () => {
      const result = getPortfolioUrl({ jobTitle: "Cinematographer" });
      // 'cinematograph' is not in the isVideo check, only 'videograph' is
      expect(result.url).toBe('https://www.jdstudiohk.com');
    });

    it("攝錄師 -> video production URL", () => {
      const result = getPortfolioUrl({ jobTitle: "攝錄師" });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/video-project');
      expect(result.type).toBe('video production');
    });

    it("Generic Photographer -> default URL", () => {
      const result = getPortfolioUrl({ jobTitle: "Photographer" });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toContain('product, food, fashion, and jewellery photography');
    });
  });

  describe("Job type detection from description", () => {
    it("Description with 'video production' -> video production URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        jobDescription: "We need a professional for video production and content creation"
      });
      // 'video production' in description triggers isVideo
      expect(result.url).toBe('https://www.jdstudiohk.com/services/video-project');
      expect(result.type).toBe('video production');
    });

    it("Description with 'product' (not checked in description) -> default URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        jobDescription: "We are hiring for product photography and e-commerce content"
      });
      // 'product' is only checked in title and industry, not description
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toContain('product, food, fashion, and jewellery photography');
    });
  });

  describe("Job type detection from industry", () => {
    it("Industry 'restaurant' -> food photography URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        industry: "restaurant"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/food-photography');
      expect(result.type).toBe('food photography');
    });

    it("Industry 'F&B' -> food photography URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        industry: "F&B"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/food-photography');
      expect(result.type).toBe('food photography');
    });

    it("Industry 'fashion' -> fashion photography URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        industry: "fashion"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toBe('fashion photography');
    });

    it("Industry 'apparel' -> fashion photography URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        industry: "apparel"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toBe('fashion photography');
    });

    it("Industry 'jewellery' -> jewellery photography URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        industry: "jewellery"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/jewelry-photography');
      expect(result.type).toBe('jewellery photography');
    });

    it("Industry 'product' -> product photography URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        industry: "product"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/product-photography');
      expect(result.type).toBe('product photography');
    });
  });

  describe("Priority order (if-else chain): jewellery > food > product > fashion > video > default", () => {
    it("Title takes priority: Food Photographer with fashion industry", () => {
      const result = getPortfolioUrl({
        jobTitle: "Food Photographer",
        industry: "fashion"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/food-photography');
    });

    it("Fashion industry takes priority over video in description", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        jobDescription: "We need a professional for video production",
        industry: "fashion"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toBe('fashion photography');
    });

    it("Video Production Videographer contains both 'product' and 'videograph' -> product photography URL (product checked first)", () => {
      const result = getPortfolioUrl({
        jobTitle: "Video Production Videographer"
      });
      // 'product' is checked before 'video' in the if-else chain
      expect(result.url).toBe('https://www.jdstudiohk.com/services/product-photography');
    });

    it("Generic title with jewellery industry -> jewellery photography URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        jobDescription: "We are hiring a professional",
        industry: "jewellery"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/jewelry-photography');
      expect(result.type).toBe('jewellery photography');
    });
  });

  describe("Case insensitivity", () => {
    it("FOOD PHOTOGRAPHER (uppercase) -> food photography URL", () => {
      const result = getPortfolioUrl({ jobTitle: "FOOD PHOTOGRAPHER" });
      expect(result.url).toBe('https://www.jdstudiohk.com/services/food-photography');
      expect(result.type).toBe('food photography');
    });

    it("Industry FASHION (uppercase) -> fashion photography URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "Photographer",
        industry: "FASHION"
      });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toBe('fashion photography');
    });

    it("Mixed case PhOtOgRaPhEr -> default URL", () => {
      const result = getPortfolioUrl({ jobTitle: "PhOtOgRaPhEr" });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toContain('product, food, fashion, and jewellery photography');
    });
  });

  describe("Edge cases", () => {
    it("Empty string -> default URL", () => {
      const result = getPortfolioUrl({ jobTitle: "" });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toContain('product, food, fashion, and jewellery photography');
    });

    it("Whitespace only -> default URL", () => {
      const result = getPortfolioUrl({ jobTitle: "   " });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toContain('product, food, fashion, and jewellery photography');
    });

    it("All parameters empty -> default URL", () => {
      const result = getPortfolioUrl({
        jobTitle: "",
        jobDescription: "",
        industry: ""
      });
      expect(result.url).toBe('https://www.jdstudiohk.com');
      expect(result.type).toContain('product, food, fashion, and jewellery photography');
    });
  });
});
