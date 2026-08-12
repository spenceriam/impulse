import type { ApprovalPolicy } from "../permission/policy.js";
import type { ExecutionBoundaryDescriptor } from "../execution/boundary.js";
import type { PresentationDensity } from "../cli/presentation-density.js";
import type { ThinkingDisplay, ReasoningLevel } from "../util/config.js";
import type { ToolDefinition } from "../api/types.js";

export type RuntimeMode = "ASK" | "AGENT";
export type RuntimeStopReason = "end-turn" | "max-tokens" | "refusal" | "cancelled" | "error";

export interface RuntimeConfig {
  density: PresentationDensity;
  thinkingDisplay: ThinkingDisplay;
  reasoningLevel: ReasoningLevel;
  communicationStyle: "concise" | "balanced" | "detailed";
  approvalPolicy: ApprovalPolicy;
  workerModel?: string;
  subagentModel?: string;
}

export type RuntimeConfigKey = keyof RuntimeConfig;

export type RuntimePromptContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; uri?: string }
  | { type: "resource"; uri: string; text?: string; mimeType?: string };

export interface RuntimePrompt {
  text: string;
  content: RuntimePromptContent[];
}

export interface RuntimeUsage {
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  contextWindow: number;
  costUsd?: number;
}

export type RuntimeToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch-mode"
  | "other";

export interface RuntimeToolLocation {
  path: string;
  line?: number;
}

export interface RuntimePermissionRequest {
  id: string;
  toolCallId: string;
  title: string;
  kind: RuntimeToolKind;
  options: Array<{ id: string; label: string; kind: "allow-once" | "allow-always" | "reject-once" | "reject-always" }>;
  locations?: RuntimeToolLocation[];
  rawInput?: unknown;
}

export type RuntimePermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export interface RuntimeQuestionRequest {
  id: string;
  prompt: string;
  choices?: Array<{ id: string; label: string; description?: string }>;
  multiple?: boolean;
}

export type RuntimeQuestionOutcome =
  | { outcome: "answered"; values: string[] }
  | { outcome: "cancelled"; reason?: string };

export interface RuntimePlanEntry {
  id: string;
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in-progress" | "completed";
}

export type RuntimeEvent =
  | { type: "turn-start"; prompt: RuntimePrompt }
  | { type: "assistant-token"; text: string; messageId?: string }
  | { type: "thinking-token"; text: string; messageId?: string }
  | { type: "tool-start"; id: string; name: string; title: string; kind: RuntimeToolKind; locations?: RuntimeToolLocation[]; rawInput?: unknown }
  | { type: "tool-update"; id: string; title?: string; status?: "pending" | "in-progress" | "completed" | "failed"; locations?: RuntimeToolLocation[]; rawInput?: unknown; rawOutput?: unknown; output?: string }
  | { type: "tool-end"; id: string; name: string; success: boolean; output: string; durationMs: number; rawOutput?: unknown }
  | { type: "permission-request"; request: RuntimePermissionRequest }
  | { type: "permission-outcome"; requestId: string; outcome: RuntimePermissionOutcome }
  | { type: "question"; request: RuntimeQuestionRequest }
  | { type: "question-outcome"; requestId: string; outcome: RuntimeQuestionOutcome }
  | { type: "plan"; id: string; title?: string; entries: RuntimePlanEntry[] }
  | { type: "plan-update"; id: string; entries: RuntimePlanEntry[] }
  | { type: "mode"; mode: RuntimeMode }
  | { type: "config"; config: RuntimeConfig }
  | { type: "info"; message: string; title?: string; updatedAt?: string }
  | { type: "usage"; usage: RuntimeUsage }
  | { type: "turn-end"; stopReason: RuntimeStopReason }
  | { type: "turn-error"; error: Error }
  | { type: "turn-cancel" };

export interface RuntimeHistoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface RuntimeSessionSnapshot {
  id: string;
  cwd: string;
  additionalRoots: string[];
  mode: RuntimeMode;
  approvalPolicy: ApprovalPolicy;
  boundary: ExecutionBoundaryDescriptor;
  config: RuntimeConfig;
  history: RuntimeHistoryMessage[];
  pendingPermissionIds: string[];
  pendingQuestionIds: string[];
  plan?: { id: string; title?: string; entries: RuntimePlanEntry[] };
  turnActive: boolean;
  closed: boolean;
}

export interface RuntimeTurnResult {
  stopReason: RuntimeStopReason;
  usage?: RuntimeUsage;
}

export interface RuntimeSessionToolDescriptor {
  name: string;
  title: string;
  kind: RuntimeToolKind;
  readOnly: boolean;
  serverName?: string;
  originalName?: string;
}

export interface RuntimeSessionToolResult {
  success: boolean;
  output: string;
  metadata?: Record<string, unknown>;
}

/** Session-owned tools, such as ACP-provided MCP servers. */
export interface RuntimeSessionToolProvider {
  definitions(mode: RuntimeMode): ToolDefinition[];
  descriptor(name: string): RuntimeSessionToolDescriptor | undefined;
  execute(
    name: string,
    input: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<RuntimeSessionToolResult>;
}

export interface RuntimeTurnDriverContext {
  readonly session: RuntimeSessionSnapshot;
  readonly prompt: RuntimePrompt;
  readonly signal: AbortSignal;
  emit(event: RuntimeEvent): void;
  requestPermission(request: Omit<RuntimePermissionRequest, "id">): Promise<RuntimePermissionOutcome>;
  requestQuestion(request: Omit<RuntimeQuestionRequest, "id">): Promise<RuntimeQuestionOutcome>;
}

export interface RuntimeTurnDriver {
  run(context: RuntimeTurnDriverContext): Promise<RuntimeTurnResult>;
  closeSession?(sessionId: string): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export interface RuntimeHistoryBinding {
  load(): Promise<RuntimeHistoryMessage[]>;
  append(message: RuntimeHistoryMessage): Promise<void>;
  close(): Promise<void>;
}
