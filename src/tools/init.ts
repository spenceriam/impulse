/**
 * Tool Initialization
 * 
 * Imports all tools to register them with the Tool registry.
 * Import this module early in the app startup to ensure all tools are available.
 */

// File operations
import "./file-read";
import "./file-write";
import "./file-edit";

// Search operations
import "./glob";
import "./grep";

// Shell
import "./bash";

// Task management
import "./todo-write";
import "./todo-read";
import "./task";

// Interactive
import "./question";

// Session
import "./set-header";
import "./set-mode";

// MCP discovery
import "./mcp-discover";

// Re-export registry for convenience
export { Tool } from "./registry";
