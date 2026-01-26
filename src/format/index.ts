/**
 * Format Module
 * Auto-formats files after write/edit operations using project-detected formatters
 * Based on OpenCode's formatter system
 */

import { extname } from "path";
import { Bus } from "../bus";
import { FileEvents } from "./events";
import { ALL_FORMATTERS, type FormatterInfo } from "./formatters";

export namespace Format {
  // Cache for enabled status to avoid repeated checks
  const enabledCache = new Map<string, boolean>();
  
  /**
   * Initialize the formatter system
   * Subscribes to file edit events and runs appropriate formatters
   */
  export function init(): void {
    Bus.subscribe((event) => {
      if (event.type === FileEvents.Edited.name) {
        const payload = event.properties as { file: string; isNew?: boolean };
        formatFile(payload.file);
      }
    });
  }
  
  /**
   * Check if a formatter is enabled (with caching)
   */
  async function isEnabled(formatter: FormatterInfo): Promise<boolean> {
    const cached = enabledCache.get(formatter.name);
    if (cached !== undefined) {
      return cached;
    }
    
    const enabled = await formatter.enabled();
    enabledCache.set(formatter.name, enabled);
    return enabled;
  }
  
  /**
   * Get all formatters that can handle a given file extension
   */
  async function getFormattersForExtension(ext: string): Promise<FormatterInfo[]> {
    const result: FormatterInfo[] = [];
    
    for (const formatter of ALL_FORMATTERS) {
      if (!formatter.extensions.includes(ext)) continue;
      if (!(await isEnabled(formatter))) continue;
      result.push(formatter);
    }
    
    return result;
  }
  
  /**
   * Format a file using detected formatters
   */
  async function formatFile(filePath: string): Promise<void> {
    const ext = extname(filePath);
    if (!ext) return;
    
    const formatters = await getFormattersForExtension(ext);
    if (formatters.length === 0) return;
    
    // Use first matching formatter (priority by order in ALL_FORMATTERS)
    const formatter = formatters[0];
    if (!formatter) return;
    
    try {
      const command = formatter.command.map(arg => 
        arg === "$FILE" ? filePath : arg
      );
      
      const proc = Bun.spawn({
        cmd: command,
        cwd: process.cwd(),
        env: { ...process.env, ...formatter.environment },
        stdout: "ignore",
        stderr: "ignore",
      });
      
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        // Silently fail - don't interrupt the workflow
        // Could add debug logging here with --verbose flag
      }
    } catch {
      // Silently fail - formatter errors shouldn't block the AI workflow
    }
  }
  
  /**
   * Get status of all formatters for display
   */
  export async function status(): Promise<Array<{
    name: string;
    extensions: string[];
    enabled: boolean;
  }>> {
    const result = [];
    
    for (const formatter of ALL_FORMATTERS) {
      const enabled = await isEnabled(formatter);
      result.push({
        name: formatter.name,
        extensions: formatter.extensions,
        enabled,
      });
    }
    
    return result;
  }
  
  /**
   * Clear the enabled cache (useful when project config changes)
   */
  export function clearCache(): void {
    enabledCache.clear();
  }
}
