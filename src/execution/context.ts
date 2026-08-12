import { AsyncLocalStorage } from "async_hooks";
import type { ExecutionBoundary } from "./boundary.js";
import type { ApprovalPolicy } from "../permission/policy.js";
import type {
  RuntimeConfig,
  RuntimeMode,
  RuntimeSessionToolProvider,
} from "../runtime/types.js";

export interface SessionPermissionInput {
  permission: string;
  patterns: string[];
  message: string;
  metadata?: Record<string, unknown>;
  tool?: { messageID: string; callID: string };
}

export type SessionPermissionDecision = "allow" | "reject" | "cancel";

export interface SessionQuestionInput {
  prompt: string;
  choices?: Array<{ id: string; label: string; description?: string }>;
  multiple?: boolean;
}

export interface RuntimeExecutionHooks {
  readonly sessionId: string;
  getMode(): RuntimeMode;
  setMode(mode: RuntimeMode): void;
  canMutate(): boolean;
  getToolProvider(): RuntimeSessionToolProvider | undefined;
  getApprovalPolicy(): ApprovalPolicy;
  getConfig(): RuntimeConfig;
  requestPermission(input: SessionPermissionInput): Promise<SessionPermissionDecision>;
  requestQuestion(input: SessionQuestionInput): Promise<string[] | null>;
}

export interface ExecutionContext {
  cwd: string;
  boundary: ExecutionBoundary;
  additionalRoots?: string[];
  signal?: AbortSignal;
  runtime?: RuntimeExecutionHooks;
  capabilities?: {
    backgroundProcesses: boolean;
    interactiveTerminal: boolean;
  };
}

const storage = new AsyncLocalStorage<ExecutionContext>();

export function runWithExecutionContext<T>(
  context: ExecutionContext,
  action: () => Promise<T>
): Promise<T> {
  return storage.run(context, action);
}

export function currentExecutionContext(): ExecutionContext | undefined {
  return storage.getStore();
}

export function executionCwd(): string {
  return storage.getStore()?.cwd ?? process.cwd();
}

export function isIsolatedMutationContext(): boolean {
  const kind = storage.getStore()?.boundary.descriptor.kind;
  return kind === "isolated-preview" || kind === "workspace-sandbox";
}
