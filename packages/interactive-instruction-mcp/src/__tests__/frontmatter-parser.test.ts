import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  stripFrontmatter,
  updateFrontmatter,
} from "../utils/frontmatter-parser.js";

describe("parseFrontmatter", () => {
  describe("standard frontmatter (at file start)", () => {
    it("should parse description only", () => {
      const content = `---
description: This is a test document.
---

# Title

Body content`;

      const result = parseFrontmatter(content);
      expect(result.description).toBe("This is a test document.");
      expect(result.triggers).toBeUndefined();
    });

    it("should parse description and triggers", () => {
      const content = `---
description: Test document
triggers:
  - When doing X
  - When doing Y
  - When doing Z
---

# Title`;

      const result = parseFrontmatter(content);
      expect(result.description).toBe("Test document");
      expect(result.triggers).toEqual([
        "When doing X",
        "When doing Y",
        "When doing Z",
      ]);
    });

    it("should parse triggers only (no description)", () => {
      const content = `---
triggers:
  - Trigger A
  - Trigger B
---

# Title`;

      const result = parseFrontmatter(content);
      expect(result.description).toBeUndefined();
      expect(result.triggers).toEqual(["Trigger A", "Trigger B"]);
    });

    it("should handle inline array syntax", () => {
      const content = `---
description: Test
triggers: [a, b, c]
---

# Title`;

      const result = parseFrontmatter(content);
      expect(result.description).toBe("Test");
      expect(result.triggers).toEqual(["a", "b", "c"]);
    });

    it("should handle single inline trigger value", () => {
      const content = `---
description: Test
triggers: single trigger
---

# Title`;

      const result = parseFrontmatter(content);
      expect(result.triggers).toEqual(["single trigger"]);
    });

    it("should handle Japanese content", () => {
      const content = `---
description: MCPツールを作成・変更した時は、以下のプロセスに従うこと。
triggers:
  - TypeScript ファイルの大規模リファクタリング
  - 関数シグネチャの一括変更
---

# タイトル`;

      const result = parseFrontmatter(content);
      expect(result.description).toBe(
        "MCPツールを作成・変更した時は、以下のプロセスに従うこと。"
      );
      expect(result.triggers).toEqual([
        "TypeScript ファイルの大規模リファクタリング",
        "関数シグネチャの一括変更",
      ]);
    });

    it("should handle CRLF line endings", () => {
      const content =
        "---\r\ndescription: Test with CRLF\r\ntriggers:\r\n  - Trigger 1\r\n---\r\n\r\n# Title";

      const result = parseFrontmatter(content);
      expect(result.description).toBe("Test with CRLF");
      expect(result.triggers).toEqual(["Trigger 1"]);
    });

    it("should handle empty lines in frontmatter", () => {
      const content = `---
description: Test

triggers:
  - Trigger 1
---

# Title`;

      const result = parseFrontmatter(content);
      expect(result.description).toBe("Test");
      expect(result.triggers).toEqual(["Trigger 1"]);
    });
  });

  describe("no frontmatter", () => {
    it("should return empty object when no frontmatter", () => {
      const content = `# Title

Body content`;

      const result = parseFrontmatter(content);
      expect(result).toEqual({});
    });

    it("should return empty for content without markers", () => {
      const content = `Just plain text without any markers`;
      const result = parseFrontmatter(content);
      expect(result).toEqual({});
    });

    it("should not match incomplete frontmatter (missing closing)", () => {
      const content = `---
description: Incomplete
# Title`;

      const result = parseFrontmatter(content);
      expect(result).toEqual({});
    });
  });
});

describe("stripFrontmatter", () => {
  describe("standard frontmatter", () => {
    it("should remove frontmatter from start of content", () => {
      const content = `---
description: Test
---

# Title

Body`;

      const result = stripFrontmatter(content);
      expect(result).toBe("# Title\n\nBody");
    });

    it("should handle CRLF line endings", () => {
      const content =
        "---\r\ndescription: Test\r\n---\r\n\r\n# Title\r\n\r\nBody";
      const result = stripFrontmatter(content);
      expect(result).toContain("# Title");
      expect(result).toContain("Body");
      expect(result).not.toContain("description:");
    });

    it("should handle frontmatter with triggers", () => {
      const content = `---
description: Test
triggers:
  - A
  - B
---

# Title

Body`;

      const result = stripFrontmatter(content);
      expect(result).toBe("# Title\n\nBody");
    });
  });

  describe("no frontmatter", () => {
    it("should return content unchanged when no frontmatter", () => {
      const content = `# Title

Body`;

      const result = stripFrontmatter(content);
      expect(result).toBe("# Title\n\nBody");
    });

    it("should trim whitespace", () => {
      const content = `   # Title

Body   `;

      const result = stripFrontmatter(content);
      expect(result).toBe("# Title\n\nBody");
    });
  });
});

describe("updateFrontmatter", () => {
  describe("adding frontmatter", () => {
    it("should add frontmatter with description and triggers", () => {
      const content = `# Title

Body`;

      const result = updateFrontmatter({
        content,
        frontmatter: {
          description: "New description",
          triggers: ["Trigger 1", "Trigger 2"],
        },
      });

      expect(result).toContain("---\ndescription: New description");
      expect(result).toContain("triggers:");
      expect(result).toContain("  - Trigger 1");
      expect(result).toContain("  - Trigger 2");
      expect(result).toContain("# Title\n\nBody");
    });

    it("should add frontmatter with description only", () => {
      const content = `# Title

Body`;

      const result = updateFrontmatter({
        content,
        frontmatter: {
          description: "Only description",
        },
      });

      expect(result).toContain("description: Only description");
      expect(result).not.toContain("triggers:");
    });

    it("should add frontmatter with triggers only", () => {
      const content = `# Title

Body`;

      const result = updateFrontmatter({
        content,
        frontmatter: {
          triggers: ["Trigger 1"],
        },
      });

      expect(result).toContain("triggers:");
      expect(result).toContain("  - Trigger 1");
      expect(result).not.toContain("description:");
    });
  });

  describe("replacing frontmatter", () => {
    it("should replace existing frontmatter at start", () => {
      const content = `---
description: Old description
triggers:
  - Old trigger
---

# Title

Body`;

      const result = updateFrontmatter({
        content,
        frontmatter: {
          description: "New description",
          triggers: ["New trigger"],
        },
      });

      expect(result).toContain("description: New description");
      expect(result).toContain("  - New trigger");
      expect(result).not.toContain("Old description");
      expect(result).not.toContain("Old trigger");
    });

  });

  describe("edge cases", () => {
    it("should handle empty triggers array", () => {
      const content = `# Title`;

      const result = updateFrontmatter({
        content,
        frontmatter: {
          description: "Test",
          triggers: [],
        },
      });

      expect(result).toContain("description: Test");
      expect(result).not.toContain("triggers:");
    });

    it("should handle empty frontmatter object", () => {
      const content = `# Title

Body`;

      const result = updateFrontmatter({
        content,
        frontmatter: {},
      });

      // Empty frontmatter produces ---\n\n--- due to serializeFrontmatter returning \n
      expect(result).toMatch(/^---\n+---/);
      expect(result).toContain("# Title\n\nBody");
    });
  });
});
