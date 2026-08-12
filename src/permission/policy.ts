export const APPROVAL_POLICIES = ["prompt", "allow-all"] as const;

export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const ALLOW_ALL_WARNING =
  "Allow-All skips permission prompts; it does not sandbox commands or protect files/network; use only with a trusted workspace or active sandbox.";

let persisted: ApprovalPolicy = "prompt";
let launchOverride: ApprovalPolicy | undefined;

export function configureApprovalPolicy(input: {
  persisted: ApprovalPolicy;
  launchOverride?: ApprovalPolicy;
}): void {
  persisted = input.persisted;
  launchOverride = input.launchOverride;
}

export function persistedApprovalPolicy(): ApprovalPolicy {
  return persisted;
}

export function effectiveApprovalPolicy(): ApprovalPolicy {
  return currentExecutionContext()?.runtime?.getApprovalPolicy() ?? launchOverride ?? persisted;
}

export function setPersistedApprovalPolicy(policy: ApprovalPolicy): void {
  persisted = policy;
}

export function resetApprovalPolicyForTests(): void {
  persisted = "prompt";
  launchOverride = undefined;
}
import { currentExecutionContext } from "../execution/context.js";
