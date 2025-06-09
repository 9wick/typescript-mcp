import { describe, it, expect } from "vitest";
import { formatRenameSymbolResult } from "./rename_symbol.ts";
import type { RenameSymbolResult } from "./rename_symbol.ts";

describe("rename_symbol", () => {
  describe("formatRenameSymbolResult", () => {
    it("should format rename with no files changed", async () => {
      const result: RenameSymbolResult = {
        message: "Renamed 'oldName' to 'newName'",
        changedFiles: [],
      };

      const formatted = await formatRenameSymbolResult(result, "/project");
      expect(formatted).toMatch("Renamed 'oldName' to 'newName' in 0 file(s) with 0 change(s).");
      expect(formatted).toMatch("Changes:");
    });

    it("should format rename with single file changed", async () => {
      const result: RenameSymbolResult = {
        message: "Renamed 'getUserId' to 'getUserID'",
        changedFiles: [
          {
            filePath: "/project/src/user.ts",
            changes: [
              {
                line: 10,
                column: 5,
                oldText: "getUserId",
                newText: "getUserID",
              },
            ],
          },
        ],
      };

      const formatted = await formatRenameSymbolResult(result, "/project");
      expect(formatted).toMatch("Renamed 'getUserId' to 'getUserID' in 1 file(s) with 1 change(s).");
      expect(formatted).toMatch("src/user.ts:");
      // Since we can't read the actual file in tests, it will fall back to simple format
      expect(formatted).toMatch('Line 10: "getUserId" → "getUserID"');
    });

    it("should format rename with multiple files and changes", async () => {
      const result: RenameSymbolResult = {
        message: "Renamed 'Component' to 'BaseComponent'",
        changedFiles: [
          {
            filePath: "/project/src/components/Button.tsx",
            changes: [
              {
                line: 5,
                column: 14,
                oldText: "Component",
                newText: "BaseComponent",
              },
              {
                line: 15,
                column: 22,
                oldText: "Component",
                newText: "BaseComponent",
              },
            ],
          },
          {
            filePath: "/project/src/components/Form.tsx",
            changes: [
              {
                line: 3,
                column: 14,
                oldText: "Component",
                newText: "BaseComponent",
              },
            ],
          },
          {
            filePath: "/project/src/index.ts",
            changes: [
              {
                line: 1,
                column: 10,
                oldText: "Component",
                newText: "BaseComponent",
              },
            ],
          },
        ],
      };

      const formatted = await formatRenameSymbolResult(result, "/project");
      expect(formatted).toMatch("Renamed 'Component' to 'BaseComponent' in 3 file(s) with 4 change(s).");
      expect(formatted).toMatch("src/components/Button.tsx:");
      expect(formatted).toMatch("src/components/Form.tsx:");
      expect(formatted).toMatch("src/index.ts:");
    });

    it("should format class rename with many changes", async () => {
      const result: RenameSymbolResult = {
        message: "Renamed class 'User' to 'UserModel'",
        changedFiles: [
          {
            filePath: "/project/src/models/user.ts",
            changes: [
              {
                line: 5,
                column: 14,
                oldText: "User",
                newText: "UserModel",
              },
            ],
          },
          {
            filePath: "/project/src/services/auth.ts",
            changes: [
              {
                line: 8,
                column: 22,
                oldText: "User",
                newText: "UserModel",
              },
              {
                line: 15,
                column: 16,
                oldText: "User",
                newText: "UserModel",
              },
              {
                line: 20,
                column: 12,
                oldText: "User",
                newText: "UserModel",
              },
            ],
          },
          {
            filePath: "/project/src/api/user.api.ts",
            changes: [
              {
                line: 3,
                column: 10,
                oldText: "User",
                newText: "UserModel",
              },
              {
                line: 10,
                column: 25,
                oldText: "User",
                newText: "UserModel",
              },
            ],
          },
        ],
      };

      const formatted = await formatRenameSymbolResult(result, "/project");
      expect(formatted).toMatch("Renamed class 'User' to 'UserModel' in 3 file(s) with 6 change(s).");
      expect(formatted).toMatch("src/models/user.ts:");
      expect(formatted).toMatch("src/services/auth.ts:");
      expect(formatted).toMatch("src/api/user.api.ts:");
    });

    it("should handle empty changes array", async () => {
      const result: RenameSymbolResult = {
        message: "Renamed 'unusedSymbol' to 'newUnusedSymbol'",
        changedFiles: [
          {
            filePath: "/project/src/unused.ts",
            changes: [],
          },
        ],
      };

      const formatted = await formatRenameSymbolResult(result, "/project");
      expect(formatted).toMatch("Renamed 'unusedSymbol' to 'newUnusedSymbol' in 1 file(s) with 0 change(s).");
      expect(formatted).toMatch("src/unused.ts:");
    });
  });
});