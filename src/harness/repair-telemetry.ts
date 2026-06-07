/**
 * Aggregate tool_input_repair events by tool × model × repair type.
 */

export type RepairTelemetryKey = `${string}|${string}|${string}`;

const counts = new Map<RepairTelemetryKey, number>();

export function recordToolInputRepair(
  tool: string,
  model: string,
  repairType: string
): void {
  const key = `${tool}|${model}|${repairType}` as RepairTelemetryKey;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

export function getRepairTelemetrySummary(): Array<{
  tool: string;
  model: string;
  repairType: string;
  count: number;
}> {
  const rows: Array<{
    tool: string;
    model: string;
    repairType: string;
    count: number;
  }> = [];
  for (const [key, count] of counts) {
    const [tool, model, repairType] = key.split("|");
    if (!tool || !model || !repairType) continue;
    rows.push({ tool, model, repairType, count });
  }
  return rows.sort((a, b) => b.count - a.count);
}

export function clearRepairTelemetry(): void {
  counts.clear();
}
