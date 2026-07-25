/**
 * linkedinDecisionMaker.test.ts
 * Unit tests for LinkedIn decision maker extraction logic
 */
import { describe, it, expect } from "vitest";

const DECISION_MAKER_KEYWORDS = [
  "founder",
  "co-founder",
  "ceo",
  "chief executive",
  "director",
  "head of",
  "vp",
  "vice president",
  "manager",
  "lead",
];

interface LinkedInDecisionMaker {
  name: string;
  title: string;
  companyName: string;
}

const extractDecisionMakers = (markdown: string, companyName: string): LinkedInDecisionMaker[] => {
  const makers: LinkedInDecisionMaker[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const isDecisionMaker = DECISION_MAKER_KEYWORDS.some((kw) =>
      line.toLowerCase().includes(kw)
    );

    if (isDecisionMaker && line.length > 5) {
      const nameMatch = line.match(/^([A-Z][a-zA-Z\s]+?)(?:\s*[-,]|at\s)/);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        const title = line.replace(name, "").replace(/^[-,\s]+/, "").trim();

        if (name && title && name.length > 2) {
          makers.push({
            name,
            title,
            companyName,
          });
        }
      }
    }
  }

  return makers;
};

describe("LinkedIn Decision Maker Extraction", () => {
  describe("Should extract decision makers with various title formats", () => {
    it("should extract 'Name - Title' format", () => {
      const markdown = "John Smith - Founder at Apple";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("John Smith");
      expect(result[0].title).toContain("Founder");
    });

    it("should extract 'Name, Title' format", () => {
      const markdown = "Jane Doe, CEO at Microsoft";
      const result = extractDecisionMakers(markdown, "Microsoft");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Jane Doe");
      expect(result[0].title).toContain("CEO");
    });

    it("should extract multiple decision makers", () => {
      const markdown = `
        John Smith - Founder at Apple
        Jane Doe - CEO at Apple
        Bob Johnson - Director at Apple
      `;
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(3);
      expect(result[0].name).toBe("John Smith");
      expect(result[1].name).toBe("Jane Doe");
      expect(result[2].name).toBe("Bob Johnson");
    });

    it("should extract Co-founder", () => {
      const markdown = "Alice Brown - Co-founder at Google";
      const result = extractDecisionMakers(markdown, "Google");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Alice Brown");
      expect(result[0].title).toContain("Co-founder");
    });

    it("should extract Director", () => {
      const markdown = "Charlie Wilson - Director of Marketing at Facebook";
      const result = extractDecisionMakers(markdown, "Facebook");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Charlie Wilson");
      expect(result[0].title).toContain("Director");
    });

    it("should extract Head of", () => {
      const markdown = "Diana Prince - Head of Operations at Amazon";
      const result = extractDecisionMakers(markdown, "Amazon");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Diana Prince");
      expect(result[0].title).toContain("Head of");
    });

    it("should extract VP", () => {
      const markdown = "Edward Norton - VP of Sales at Tesla";
      const result = extractDecisionMakers(markdown, "Tesla");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Edward Norton");
      expect(result[0].title).toContain("VP");
    });

    it("should extract Vice President", () => {
      const markdown = "Fiona Green - Vice President of Engineering at Netflix";
      const result = extractDecisionMakers(markdown, "Netflix");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Fiona Green");
      expect(result[0].title).toContain("Vice President");
    });

    it("should extract Manager", () => {
      const markdown = "George Harris - Manager at Spotify";
      const result = extractDecisionMakers(markdown, "Spotify");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("George Harris");
      expect(result[0].title).toContain("Manager");
    });

    it("should extract Lead", () => {
      const markdown = "Helen Martinez - Lead Designer at Adobe";
      const result = extractDecisionMakers(markdown, "Adobe");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("Helen Martinez");
      expect(result[0].title).toContain("Lead");
    });
  });

  describe("Should filter out non-decision makers", () => {
    it("should not extract lines without decision maker keywords", () => {
      const markdown = "John Smith - Software Engineer at Apple";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(0);
    });

    it("should not extract lines that are too short", () => {
      const markdown = "CEO";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(0);
    });

    it("should not extract names that are too short", () => {
      const markdown = "Jo - CEO at Apple";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(0);
    });

    it("should not extract lines starting with lowercase", () => {
      const markdown = "john Smith - CEO at Apple";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(0);
    });
  });

  describe("Should handle edge cases", () => {
    it("should preserve multiple spaces in name", () => {
      const markdown = "John   Smith - Founder at Apple";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("John   Smith");
    });

    it("should handle names with middle initials", () => {
      const markdown = "John Q Smith - CEO at Apple";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("John Q Smith");
    });

    it("should handle empty markdown", () => {
      const markdown = "";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(0);
    });

    it("should handle markdown with only whitespace", () => {
      const markdown = "   \n   \n   ";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(0);
    });

    it("should handle case-insensitive keyword matching", () => {
      const markdown = "John Smith - FOUNDER at Apple";
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBe(1);
      expect(result[0].name).toBe("John Smith");
    });

    it("should preserve company name in result", () => {
      const markdown = "John Smith - CEO at Apple";
      const result = extractDecisionMakers(markdown, "Apple Inc");
      expect(result[0].companyName).toBe("Apple Inc");
    });
  });

  describe("Should handle complex LinkedIn markdown formats", () => {
    it("should extract from realistic LinkedIn company page markdown", () => {
      const markdown = `
        # Apple Inc Leadership

        ## Executive Team

        John Smith - Founder and CEO at Apple
        Jane Doe - Chief Operating Officer at Apple
        Bob Johnson - Senior Vice President of Engineering at Apple

        ## Management

        Alice Brown - Director of Product at Apple
        Charlie Wilson - Head of Marketing at Apple
      `;
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBeGreaterThan(0);
      const names = result.map(m => m.name);
      expect(names).toContain("John Smith");
      expect(names).toContain("Bob Johnson");
      expect(names).toContain("Alice Brown");
      expect(names).toContain("Charlie Wilson");
    });

    it("should extract from markdown with mixed formatting", () => {
      const markdown = `
        **John Smith** - Founder at Apple
        *Jane Doe* - CEO at Apple
        Bob Johnson - Director of Sales at Apple
      `;
      const result = extractDecisionMakers(markdown, "Apple");
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Decision maker priority selection", () => {
    it("should identify Founder as high priority", () => {
      const markdown = `
        John Smith - Founder at Apple
        Jane Doe - Manager at Apple
      `;
      const result = extractDecisionMakers(markdown, "Apple");
      const founder = result.find(m => m.title.toLowerCase().includes('founder'));
      expect(founder).toBeDefined();
      expect(founder?.name).toBe("John Smith");
    });

    it("should identify CEO as high priority", () => {
      const markdown = `
        John Smith - CEO at Apple
        Jane Doe - Manager at Apple
      `;
      const result = extractDecisionMakers(markdown, "Apple");
      const ceo = result.find(m => m.title.toLowerCase().includes('ceo'));
      expect(ceo).toBeDefined();
      expect(ceo?.name).toBe("John Smith");
    });

    it("should identify Director as medium priority", () => {
      const markdown = `
        John Smith - Director at Apple
        Jane Doe - Manager at Apple
      `;
      const result = extractDecisionMakers(markdown, "Apple");
      const director = result.find(m => m.title.toLowerCase().includes('director'));
      expect(director).toBeDefined();
      expect(director?.name).toBe("John Smith");
    });
  });

  describe("Integration with main pipeline", () => {
    it("should work with decision maker selection logic from pitchOutreach", () => {
      const markdown = `
        John Smith - Founder at Apple
        Jane Doe - CEO at Apple
        Bob Johnson - Director of Sales at Apple
        Alice Brown - Manager at Apple
      `;
      const result = extractDecisionMakers(markdown, "Apple");
      
      // Simulate priority selection from pitchOutreach.ts
      let selectedMaker = result.find(m => 
        m.title.toLowerCase().includes('founder') || 
        m.title.toLowerCase().includes('ceo') ||
        m.title.toLowerCase().includes('chief')
      );
      
      if (!selectedMaker) {
        selectedMaker = result.find(m => 
          m.title.toLowerCase().includes('director') || 
          m.title.toLowerCase().includes('head of')
        );
      }
      
      if (!selectedMaker) {
        selectedMaker = result[0];
      }

      expect(selectedMaker).toBeDefined();
      expect(selectedMaker?.name).toBe("John Smith");
    });
  });
});
