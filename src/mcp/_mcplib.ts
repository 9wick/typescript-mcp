/**
 * Generic MCP (Model Context Protocol) Server Library
 * Provides utilities and base classes for building MCP servers
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type z, ZodObject, ZodType } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Debug logging for MCP servers.
 * 
 * IMPORTANT: MCP servers communicate via stdio, so regular console.log output
 * would interfere with the protocol. All debug/logging output MUST be sent
 * to stderr using console.error instead.
 * 
 * This function provides a convenient way to output debug messages that won't
 * interfere with MCP communication.
 * 
 * @example
 * debug("Server started");
 * debug("Processing request:", requestData);
 */
export function debug(...args: unknown[]): void {
  console.error(...args);
}

// Re-export commonly used types from MCP SDK
export { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * Tool result format for MCP
 */
export interface ToolResult {
  content: { type: "text"; text: string; [x: string]: unknown }[];
  isError?: boolean;
  [x: string]: unknown;
}

/**
 * Tool definition interface
 */
export interface ToolDef<S extends ZodType> {
  name: string;
  description: string;
  schema: S;
  execute: (args: z.infer<S>) => Promise<string> | string;
}

/**
 * MCP Server configuration options
 */
export interface McpServerOptions {
  name: string;
  version: string;
  description?: string;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

/**
 * Base class for MCP servers with common functionality
 */
export class BaseMcpServer {
  protected server: McpServer;
  protected tools: Map<string, ToolDef<any>> = new Map();
  protected defaultRoot?: string;

  constructor(options: McpServerOptions) {
    this.server = new McpServer({
      name: options.name,
      version: options.version,
    });
  }

  /**
   * Set default root directory for tools that accept a root parameter
   */
  setDefaultRoot(root: string): void {
    this.defaultRoot = root;
  }

  /**
   * Register a tool with the server
   */
  registerTool<S extends ZodType>(tool: ToolDef<S>): void {
    this.tools.set(tool.name, tool);
    this._registerToolWithServer(tool);
  }

  /**
   * Register multiple tools at once
   */
  registerTools(tools: ToolDef<any>[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Start the server with stdio transport
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Get the underlying MCP server instance
   */
  getServer(): McpServer {
    return this.server;
  }

  /**
   * Internal method to register tool with MCP server
   */
  private _registerToolWithServer<S extends ZodType>(tool: ToolDef<S>): void {
    // Check if the schema is a ZodObject to extract shape
    if (tool.schema instanceof ZodObject) {
      const schemaShape = tool.schema.shape;

      // Create a wrapper handler that adds default root if not provided
      const wrappedHandler =
        this.defaultRoot && "root" in schemaShape
          ? (args: z.infer<S>) => {
              // If root is not provided in args, use the default
              const argsWithRoot = {
                ...args,
                root: (args as Record<string, unknown>).root || this.defaultRoot,
              } as z.infer<S>;
              return tool.execute(argsWithRoot);
            }
          : tool.execute;

      this.server.tool(
        tool.name,
        tool.description,
        schemaShape,
        toMcpToolHandler(wrappedHandler)
      );
    } else {
      // For non-ZodObject schemas, register without shape
      this.server.tool(
        tool.name,
        tool.description,
        toMcpToolHandler(tool.execute)
      );
    }
  }
}

/**
 * Convert a string-returning handler to MCP response format with error handling
 */
export function toMcpToolHandler<T>(
  handler: (args: T) => Promise<string> | string
): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    try {
      const message = await handler(args);
      return {
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  };
}

/**
 * Create a simple tool definition
 */
export function createTool<S extends ZodType>(tool: ToolDef<S>): ToolDef<S> {
  return tool;
}

/**
 * Configuration file helpers
 */
export interface McpConfig {
  mcpServers?: Record<
    string,
    {
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  >;
}

export interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
}

/**
 * Read JSON file safely
 */
export function readJsonFile(filePath: string): unknown {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Error parsing ${filePath}: ${e}`);
  }
}

/**
 * Write JSON file
 */
export function writeJsonFile(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Merge arrays without duplicates
 */
export function mergeArrays<T>(existing: T[] | undefined, additions: T[] | undefined): T[] {
  const existingArray = existing || [];
  const additionsArray = additions || [];
  return [...existingArray, ...additionsArray].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );
}

/**
 * Generate MCP permission names from tool definitions
 * @param serverName The name of the MCP server (used as prefix)
 * @param tools Array of tool definitions
 * @returns Array of permission strings in the format "mcp__<serverName>__<toolName>"
 */
export function generatePermissions(
  serverName: string,
  tools: ToolDef<any>[]
): string[] {
  return tools.map(tool => `mcp__${serverName}__${tool.name}`);
}

/**
 * Initialize MCP configuration for a project
 */
export function initializeMcpConfig(
  projectRoot: string,
  serverName: string,
  config: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  },
  permissions: string[]
): void {
  const mcpConfigPath = path.join(projectRoot, ".mcp.json");
  const claudeDir = path.join(projectRoot, ".claude");
  const claudeSettingsPath = path.join(claudeDir, "settings.json");

  // Update MCP config
  const existingMcpConfig = (readJsonFile(mcpConfigPath) as McpConfig | null) || {};
  const mergedMcpConfig: McpConfig = {
    ...existingMcpConfig,
    mcpServers: {
      ...existingMcpConfig.mcpServers,
      [serverName]: config,
    },
  };
  writeJsonFile(mcpConfigPath, mergedMcpConfig);

  // Update Claude settings
  const existingSettings = (readJsonFile(claudeSettingsPath) as ClaudeSettings | null) || {};
  const mergedSettings: ClaudeSettings = {
    ...existingSettings,
    permissions: {
      allow: mergeArrays(existingSettings.permissions?.allow, permissions),
      deny: existingSettings.permissions?.deny || [],
    },
  };
  writeJsonFile(claudeSettingsPath, mergedSettings);
}


// Tests
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  const { z } = await import("zod");

  describe("toMcpToolHandler", () => {
    it("should convert string to MCP format when no error occurs", async () => {
      const handler = toMcpToolHandler(() => {
        return "Success message";
      });

      const result = await handler({});
      expect(result).toEqual({
        content: [{ type: "text", text: "Success message" }],
      });
    });

    it("should catch and format errors", async () => {
      const handler = toMcpToolHandler(() => {
        throw new Error("Test error message");
      });

      const result = await handler({});
      expect(result).toEqual({
        content: [{ type: "text", text: "Error: Test error message" }],
        isError: true,
      });
    });

    it("should handle non-Error thrown values", async () => {
      const handler = toMcpToolHandler(() => {
        throw "String error";
      });

      const result = await handler({});
      expect(result).toEqual({
        content: [{ type: "text", text: "Error: String error" }],
        isError: true,
      });
    });
  });

  describe("mergeArrays", () => {
    it("should merge arrays without duplicates", () => {
      const result = mergeArrays([1, 2, 3], [3, 4, 5]);
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it("should handle empty arrays", () => {
      expect(mergeArrays([], [1, 2])).toEqual([1, 2]);
      expect(mergeArrays([1, 2], [])).toEqual([1, 2]);
      expect(mergeArrays([], [])).toEqual([]);
    });

    it("should handle undefined arrays", () => {
      expect(mergeArrays(undefined, [1, 2])).toEqual([1, 2]);
      expect(mergeArrays([1, 2], undefined)).toEqual([1, 2]);
      expect(mergeArrays(undefined, undefined)).toEqual([]);
    });
  });

  describe("generatePermissions", () => {
    it("should generate permission names from tool definitions", () => {
      const tools: ToolDef<any>[] = [
        {
          name: "test_tool",
          description: "Test tool",
          schema: z.object({}),
          execute: () => "result",
        },
        {
          name: "another_tool",
          description: "Another tool",
          schema: z.object({}),
          execute: () => "result",
        },
      ];

      const permissions = generatePermissions("myserver", tools);
      expect(permissions).toEqual([
        "mcp__myserver__test_tool",
        "mcp__myserver__another_tool",
      ]);
    });

    it("should handle empty tools array", () => {
      const permissions = generatePermissions("myserver", []);
      expect(permissions).toEqual([]);
    });
  });
}