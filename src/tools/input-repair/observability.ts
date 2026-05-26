import * as logger from "../../util/logger";
import { logToolInputRepair as logDebugRepair } from "../../util/debug-log";
import type { RepairEvent } from "./types";

/**
 * Log successful tool input repairs for observability.
 */
export async function logRepairs(
  toolName: string,
  repairs: RepairEvent[]
): Promise<void> {
  if (repairs.length === 0) return;

  const summary = repairs
    .map((r) => `${r.name}@${r.path.join(".") || "(root)"}`)
    .join(", ");

  void logger.info(`tool_input_repair: ${toolName} [${summary}]`);
  void logDebugRepair(toolName, repairs);
}
