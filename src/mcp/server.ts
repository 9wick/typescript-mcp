#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import { moveFile } from "../commands/move_file.ts";
import { renameSymbol } from "../commands/rename_symbol.ts";
import { deleteSymbol } from "../commands/delete_symbol.ts";
import { findReferences } from "../navigations/find_references.ts";
import { goToDefinition } from "../navigations/go_to_definition.ts";
import { getDiagnostics } from "../navigations/get_diagnostics.ts";
import { getModuleSymbols } from "../navigations/get_module_symbols.ts";
import { getTypeSignature } from "../navigations/get_type_signature.ts";
import { findProjectForFile } from "../utils/project_cache.ts";
import { toMcpToolHandler } from "./mcp_server_utils.ts";

const server = new McpServer({
  name: "typescript",
  version: "1.0.0",
});

// Tool: Move File
server.tool(
  "move-file",
  "Move a TypeScript/JavaScript file to a new location and update all import statements",
  {
    oldPath: z.string().describe("Current file path (relative to root)"),
    newPath: z.string().describe("New file path (relative to root)"),
    root: z.string().describe("Root directory for resolving relative paths"),
    overwrite: z
      .boolean()
      .optional()
      .default(false)
      .describe("Overwrite the destination file if it exists"),
  },
  toMcpToolHandler(async ({ oldPath, newPath, root, overwrite }) => {
    // Always treat paths as relative to root
    const absoluteOldPath = path.join(root, oldPath);
    const absoluteNewPath = path.join(root, newPath);

    const project = await findProjectForFile(absoluteOldPath);

    // Ensure the source file is loaded in the project
    let sourceFile = project.getSourceFile(absoluteOldPath);
    if (!sourceFile) {
      // Try to add the file if it's not in the project (e.g., excluded in tsconfig)
      try {
        sourceFile = project.addSourceFileAtPath(absoluteOldPath);
      } catch (error) {
        throw new Error(`File not found: ${absoluteOldPath}`);
      }
    }

    // Perform the move
    const result = moveFile(project, {
      oldFilename: absoluteOldPath,
      newFilename: absoluteNewPath,
      overwrite,
    });

    if (result.isErr()) {
      throw new Error(result.error);
    }

    // Save all changes
    await project.save();

    const { message, changedFiles } = result.value;
    return `${message}. Updated imports in ${changedFiles.length} file(s).`;
  })
);

// Tool: Rename Symbol
server.tool(
  "rename-symbol",
  "Rename a TypeScript/JavaScript symbol (variable, function, class, etc.) across the codebase",
  {
    filePath: z
      .string()
      .describe("File path containing the symbol (relative to root)"),
    line: z
      .number()
      .describe("Line number where the symbol is defined (1-based)"),
    oldName: z.string().describe("Current name of the symbol"),
    newName: z.string().describe("New name for the symbol"),
    root: z.string().describe("Root directory for resolving relative paths"),
  },
  toMcpToolHandler(async ({ filePath, line, oldName, newName, root }) => {
    // Always treat paths as relative to root
    const absolutePath = path.join(root, filePath);
    // Check if file exists
    const project = await findProjectForFile(absolutePath);

    // Ensure the source file is loaded in the project
    let sourceFile = project.getSourceFile(absolutePath);
    if (!sourceFile) {
      // Try to add the file if it's not in the project (e.g., excluded in tsconfig)
      try {
        sourceFile = project.addSourceFileAtPath(absolutePath);
      } catch (error) {
        throw new Error(`File not found: ${absolutePath}`);
      }
    }

    // Perform the rename
    const result = await renameSymbol(project, {
      filePath: absolutePath,
      line,
      symbolName: oldName,
      newName,
      renameInStrings: true,
      renameInComments: false,
    });

    if (result.isErr()) {
      throw new Error(result.error);
    }

    // Save all changes
    await project.save();

    const { message, changedFiles } = result.value;
    return `${message} in ${changedFiles.length} file(s).`;
  })
);

// Tool: Delete Symbol
server.tool(
  "delete-symbol",
  "Delete a TypeScript/JavaScript symbol (variable, function, class, etc.) and all its references",
  {
    filePath: z
      .string()
      .describe("File path containing the symbol (relative to root)"),
    line: z
      .number()
      .describe("Line number where the symbol is defined (1-based)"),
    symbolName: z.string().describe("Name of the symbol to delete"),
    removeReferences: z
      .boolean()
      .optional()
      .default(true)
      .describe("Also delete all references to the symbol"),
    root: z.string().describe("Root directory for resolving relative paths"),
  },
  toMcpToolHandler(async ({ filePath, line, symbolName, root }) => {
    // Always treat paths as relative to root
    const absolutePath = path.join(root, filePath);

    // Check if file exists
    await fs.access(absolutePath);

    const project = await findProjectForFile(absolutePath);

    // Ensure the source file is loaded in the project
    let sourceFile = project.getSourceFile(absolutePath);
    if (!sourceFile) {
      // Try to add the file if it's not in the project (e.g., excluded in tsconfig)
      try {
        sourceFile = project.addSourceFileAtPath(absolutePath);
      } catch (error) {
        throw new Error(`File not found: ${absolutePath}`);
      }
    }

    // Perform the removal
    const result = await deleteSymbol(project, {
      filePath: absolutePath,
      line,
      symbolName,
    });

    if (result.isErr()) {
      throw new Error(result.error);
    }

    // Save all changes
    await project.save();
    const { message, removedFromFiles } = result.value;
    return `${message} from ${removedFromFiles.length} file(s).`;
  })
);

// Tool: Find References
server.tool(
  "find-references",
  "Find all references to a TypeScript/JavaScript symbol across the codebase",
  {
    filePath: z
      .string()
      .describe("File path containing the symbol (relative to root)"),
    line: z
      .number()
      .describe("Line number where the symbol is located (1-based)"),
    symbolName: z
      .string()
      .describe("Name of the symbol to find references for"),
    root: z.string().describe("Root directory for resolving relative paths"),
  },
  toMcpToolHandler(async ({ filePath, line, symbolName, root }) => {
    // Always treat paths as relative to root
    const absolutePath = path.join(root, filePath);

    // Check if file exists
    await fs.access(absolutePath);

    const project = await findProjectForFile(absolutePath);

    // Ensure the source file is loaded in the project
    let sourceFile = project.getSourceFile(absolutePath);
    if (!sourceFile) {
      // Try to add the file if it's not in the project (e.g., excluded in tsconfig)
      try {
        sourceFile = project.addSourceFileAtPath(absolutePath);
      } catch (error) {
        throw new Error(`File not found: ${absolutePath}`);
      }
    }

    // Get the line text
    const fullText = sourceFile.getFullText();
    const lines = fullText.split("\n");
    const lineText = lines[line - 1];

    if (!lineText) {
      throw new Error(`Invalid line number: ${line}`);
    }

    // Find the column position of the symbol in the line
    const symbolIndex = lineText.indexOf(symbolName);
    if (symbolIndex === -1) {
      throw new Error(`Symbol "${symbolName}" not found on line ${line}`);
    }

    // Convert to 1-based column (symbolIndex is 0-based)
    const column = symbolIndex + 1;

    // Find references
    const result = findReferences(project, {
      filePath: absolutePath,
      line,
      column,
    });

    if (result.isErr()) {
      throw new Error(result.error);
    }

    const { message, references, symbol } = result.value;

    // Format the output
    const output = [
      message,
      `Symbol: ${symbol.name} (${symbol.kind})`,
      "",
      "References:",
    ];

    for (const ref of references) {
      const relativePath = path.relative(root, ref.filePath);
      output.push(
        `  ${relativePath}:${ref.line}:${ref.column} - ${ref.lineText}`
      );
    }

    return output.join("\n");
  })
);

// Tool: Get Definitions
server.tool(
  "get-definitions",
  "Get the definition(s) of a TypeScript/JavaScript symbol",
  {
    filePath: z
      .string()
      .describe("File path containing the symbol (relative to root)"),
    line: z
      .number()
      .describe("Line number where the symbol is located (1-based)"),
    symbolName: z
      .string()
      .describe("Name of the symbol to get definitions for"),
    root: z.string().describe("Root directory for resolving relative paths"),
    before: z
      .number()
      .optional()
      .describe("Number of lines to show before the definition"),
    after: z
      .number()
      .optional()
      .describe("Number of lines to show after the definition"),
  },
  toMcpToolHandler(async ({ filePath, line, symbolName, root, before, after }) => {
    // Always treat paths as relative to root
    const absolutePath = path.join(root, filePath);

    // Check if file exists
    await fs.access(absolutePath);

    const project = await findProjectForFile(absolutePath);

    // Get the source file to find the column position
    let sourceFile = project.getSourceFile(absolutePath);
    if (!sourceFile) {
      // Try to add the file if it's not in the project (e.g., excluded in tsconfig)
      try {
        sourceFile = project.addSourceFileAtPath(absolutePath);
      } catch (error) {
        throw new Error(`File not found: ${absolutePath}`);
      }
    }

    // Get the line text
    const fullText = sourceFile.getFullText();
    const lines = fullText.split("\n");
    const lineText = lines[line - 1];

    if (!lineText) {
      throw new Error(`Invalid line number: ${line}`);
    }

    // Find the column position of the symbol in the line
    const symbolIndex = lineText.indexOf(symbolName);
    if (symbolIndex === -1) {
      throw new Error(`Symbol "${symbolName}" not found on line ${line}`);
    }

    // Convert to 1-based column (symbolIndex is 0-based)
    const column = symbolIndex + 1;

    // Find definition using the column position
    const result = goToDefinition(project, {
      filePath: absolutePath,
      line,
      column,
    });

    if (result.isErr()) {
      throw new Error(result.error);
    }

    const { message, definitions, symbol } = result.value;

    // Format the output
    const output = [
      message,
      `Symbol: ${symbol.name} (${symbol.kind})`,
      "",
      "Definitions:",
    ];

    for (const def of definitions) {
      const relativePath = path.relative(root, def.filePath);
      output.push(
        `  ${relativePath}:${def.line}:${def.column} - ${def.lineText}`
      );
      
      // Add context lines if requested
      if (before || after) {
        const defSourceFile = project.getSourceFile(def.filePath);
        if (defSourceFile) {
          const fullText = defSourceFile.getFullText();
          const lines = fullText.split("\n");
          
          const startLine = Math.max(0, def.line - 1 - (before || 0));
          const endLine = Math.min(lines.length, def.line + (after || 0));
          
          if (before && startLine < def.line - 1) {
            output.push("");
            for (let i = startLine; i < def.line - 1; i++) {
              output.push(`    ${i + 1}: ${lines[i]}`);
            }
          }
          
          // Show the definition line with arrow
          output.push(`  → ${def.line}: ${lines[def.line - 1]}`);
          
          if (after && def.line < endLine) {
            for (let i = def.line; i < endLine; i++) {
              output.push(`    ${i + 1}: ${lines[i]}`);
            }
          }
        }
      }
    }

    return output.join("\n");
  })
);

// Tool: Get Diagnostics
server.tool(
  "get-diagnostics",
  "Get TypeScript diagnostics (errors, warnings) for a single file",
  {
    filePath: z
      .string()
      .describe("File path to check for diagnostics (relative to root)"),
    root: z.string().describe("Root directory for resolving relative paths"),
  },
  toMcpToolHandler(async ({ filePath, root }) => {
    // Always treat paths as relative to root
    const absolutePath = path.join(root, filePath);

    // Check if file exists
    await fs.access(absolutePath);

    const project = await findProjectForFile(absolutePath);

    // Ensure the source file is loaded in the project
    let sourceFile = project.getSourceFile(absolutePath);
    if (!sourceFile) {
      // Try to add the file if it's not in the project (e.g., excluded in tsconfig)
      try {
        sourceFile = project.addSourceFileAtPath(absolutePath);
      } catch (error) {
        throw new Error(`File not found: ${absolutePath}`);
      }
    }

    // Get diagnostics
    const result = getDiagnostics(project, {
      filePaths: [absolutePath],
    });

    if (result.isErr()) {
      throw new Error(result.error);
    }

    const { message } = result.value;
    
    // Return ts-morph's formatted output directly
    return message;
  })
);

// Tool: Get Module Symbols (simplified version)
server.tool(
  "get-module-symbols",
  "Get all exported symbols from a TypeScript/JavaScript module without detailed signatures",
  {
    moduleName: z
      .string()
      .describe("The module to analyze (e.g., 'neverthrow', './local-module')"),
    root: z.string().describe("Root directory for resolving relative paths"),
    filePath: z
      .string()
      .optional()
      .describe("Context file for resolving relative imports"),
  },
  toMcpToolHandler(async ({ moduleName, root, filePath }) => {
    const project = await findProjectForFile(filePath ? path.join(root, filePath) : root);

    // Get module symbols
    const result = getModuleSymbols(project, {
      moduleName,
      filePath: filePath ? path.join(root, filePath) : undefined,
    });

    if (result.isErr()) {
      throw new Error(result.error);
    }

    const { message, symbols } = result.value;

    // Format the output
    const output = [
      message,
      "",
    ];

    // Add symbols by category
    if (symbols.types.length > 0) {
      output.push(`📋 Types: ${symbols.types.map(s => s.name).join(", ")}`);
    }
    if (symbols.interfaces.length > 0) {
      output.push(`📐 Interfaces: ${symbols.interfaces.map(s => s.name).join(", ")}`);
    }
    if (symbols.classes.length > 0) {
      output.push(`🏗️ Classes: ${symbols.classes.map(s => s.name).join(", ")}`);
    }
    if (symbols.functions.length > 0) {
      output.push(`⚡ Functions: ${symbols.functions.map(s => s.name).join(", ")}`);
    }
    if (symbols.variables.length > 0) {
      output.push(`📦 Variables: ${symbols.variables.map(s => s.name).join(", ")}`);
    }
    if (symbols.others.length > 0) {
      output.push(`❓ Others: ${symbols.others.map(s => s.name).join(", ")}`);
    }

    return output.join("\n");
  })
);

// Tool: Get Type Signature
server.tool(
  "get-type-signature",
  "Get detailed signature information for a specific type (function, class, interface, type alias, etc.)",
  {
    moduleName: z
      .string()
      .describe("The module containing the type (e.g., 'neverthrow', './utils')"),
    typeName: z
      .string()
      .describe("The name of the type to analyze"),
    root: z.string().describe("Root directory for resolving relative paths"),
    filePath: z
      .string()
      .optional()
      .describe("Context file for resolving relative imports"),
  },
  toMcpToolHandler(async ({ moduleName, typeName, root, filePath }) => {
    const project = await findProjectForFile(filePath ? path.join(root, filePath) : root);

    // Get type signature
    const result = getTypeSignature(project, {
      moduleName,
      typeName,
      filePath: filePath ? path.join(root, filePath) : undefined,
    });

    if (result.isErr()) {
      throw new Error(result.error);
    }

    const { message, signature, documentation, relatedTypes } = result.value;

    // Format the output
    const output = [
      message,
      "",
    ];

    // Add definitions if available
    if (signature.definitions && signature.definitions.length > 0) {
      output.push("📍 Definitions:");
      for (const def of signature.definitions) {
        const relativePath = path.relative(root, def.filePath);
        let defStr = `  ${def.kind}: ${relativePath}:${def.line}:${def.column}`;
        
        // Add name information
        if (def.name) {
          defStr += ` (${def.name})`;
        }
        if (def.kind === "Alias" && def.originalName) {
          defStr += ` → ${def.originalName}`;
        }
        
        output.push(defStr);
      }
      output.push("");
    }

    // Add related types if available
    if (relatedTypes && relatedTypes.length > 0) {
      output.push("🔗 Related Types:");
      for (const relType of relatedTypes) {
        const relativePath = path.relative(root, relType.filePath);
        let relStr = `  ${relType.kind}: ${relativePath}:${relType.line}:${relType.column}`;
        
        if (relType.name) {
          relStr += ` (${relType.name})`;
        }
        if (relType.importedFrom) {
          relStr += ` from "${relType.importedFrom}"`;
        }
        
        output.push(relStr);
      }
      output.push("");
    }

    // Add documentation if available
    if (documentation) {
      output.push("📖 Documentation:");
      output.push(documentation);
      output.push("");
    }

    // Format based on the kind of type
    if (signature.kind === "function" && signature.functionSignatures) {
      output.push("📝 Function Signatures:");
      for (let i = 0; i < signature.functionSignatures.length; i++) {
        const sig = signature.functionSignatures[i];
        
        if (signature.functionSignatures.length > 1) {
          output.push(`\nOverload ${i + 1}:`);
        }
        
        // Format as TypeScript function signature
        let signatureStr = "  ";
        
        // Add type parameters if present
        if (sig.typeParameters && sig.typeParameters.length > 0) {
          signatureStr += `<${sig.typeParameters.join(", ")}>(`;
        } else {
          signatureStr += "(";
        }
        
        // Add parameters
        const paramStrs = sig.parameters.map(param => {
          let paramStr = param.name;
          if (param.optional && !param.defaultValue) {
            paramStr += "?";
          }
          paramStr += ": " + param.type;
          if (param.defaultValue) {
            paramStr += " = " + param.defaultValue;
          }
          return paramStr;
        });
        
        signatureStr += paramStrs.join(", ");
        signatureStr += "): " + sig.returnType;
        
        output.push(signatureStr);
      }
    } else if (signature.kind === "type" && signature.typeDefinition) {
      output.push(`📋 Type Definition:`);
      if (signature.typeParameters && signature.typeParameters.length > 0) {
        output.push(`  Type Parameters: <${signature.typeParameters.join(", ")}>`);
      }
      output.push(`  Type: ${signature.typeDefinition}`);
    } else if ((signature.kind === "interface" || signature.kind === "class") && (signature.properties || signature.methods)) {
      output.push(`${signature.kind === "interface" ? "📐 Interface" : "🏗️ Class"} Definition:`);
      
      if (signature.typeParameters && signature.typeParameters.length > 0) {
        output.push(`  Type Parameters: <${signature.typeParameters.join(", ")}>`);
      }
      
      if (signature.properties && signature.properties.length > 0) {
        output.push("\n  Properties:");
        for (const prop of signature.properties) {
          output.push(`    ${prop.name}${prop.optional ? "?" : ""}: ${prop.type}`);
        }
      }
      
      if (signature.methods && signature.methods.length > 0) {
        output.push("\n  Methods:");
        for (const method of signature.methods) {
          for (const sig of method.signatures) {
            const typeParamStr = sig.typeParameters && sig.typeParameters.length > 0
              ? `<${sig.typeParameters.join(", ")}>`
              : "";
            
            const paramStrs = sig.parameters.map(p => {
              let paramStr = p.name;
              if (p.optional && !p.defaultValue) {
                paramStr += "?";
              }
              paramStr += ": " + p.type;
              if (p.defaultValue) {
                paramStr += " = " + p.defaultValue;
              }
              return paramStr;
            });
            
            const signatureStr = `    ${method.name}${typeParamStr}(${paramStrs.join(", ")}): ${sig.returnType}`;
            output.push(signatureStr);
          }
        }
      }
    } else if (signature.kind === "variable" && signature.typeDefinition) {
      output.push(`📦 Variable Type:`);
      output.push(`  Type: ${signature.typeDefinition}`);
    }

    return output.join("\n");
  })
);

// Start the server
async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("TypeScript Refactoring MCP Server running on stdio");
  } catch (error) {
    console.error("Error starting MCP server:", error);
    process.exit(1);
  }
}

main();
