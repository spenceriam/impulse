export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: string;
  status: "running" | "success" | "error" | "cancelled";
  result?: string;
  metadata?: Record<string, unknown>;
}
