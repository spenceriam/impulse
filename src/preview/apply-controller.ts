export const USER_PREVIEW_APPLY_AUTHORITY = Symbol("direct user preview apply");

type CheckResult =
  | { ok: true; changedFiles: string[] }
  | { ok: false; status: "missing" | "conflict"; notice: string; safeToReturnToAsk: true };

type ApplyResult =
  | { ok: true; status: "applied"; changedFiles: string[] }
  | {
      ok: false;
      status: "missing" | "conflict" | "rollback" | "cleanup";
      notice: string;
      safeToReturnToAsk: boolean;
      remainsAgent?: boolean;
    };

interface PreviewApplyControllerOptions {
  checkApply(id: string): Promise<CheckResult>;
  apply(id: string): Promise<ApplyResult>;
  transition(mode: "ASK" | "AGENT"): Promise<boolean>;
}

export class PreviewApplyController {
  private readonly consumed = new Set<string>();

  constructor(private readonly options: PreviewApplyControllerOptions) {}

  async apply(id: string, authority: symbol): Promise<
    | ApplyResult
    | { ok: false; status: "authority" | "elevation-failed" | "deescalation-failed"; notice: string; remainsAgent?: boolean }
  > {
    if (authority !== USER_PREVIEW_APPLY_AUTHORITY || this.consumed.has(id)) {
      return {
        ok: false,
        status: "authority",
        notice: "Apply requires a fresh direct user confirmation.",
      };
    }

    const preflight = await this.options.checkApply(id);
    if (!preflight.ok) return preflight;
    this.consumed.add(id);

    if (!(await this.options.transition("AGENT"))) {
      this.consumed.delete(id);
      return {
        ok: false,
        status: "elevation-failed",
        notice: "Could not enter AGENT; preview was not applied.",
      };
    }

    const result = await this.options.apply(id);
    if (!result.ok && !result.safeToReturnToAsk) {
      return { ...result, remainsAgent: true };
    }

    if (!(await this.options.transition("ASK"))) {
      return {
        ok: false,
        status: "deescalation-failed",
        notice: result.ok
          ? "Preview applied, but cleanup could not confirm return to ASK; AGENT remains visible."
          : `${result.notice} Cleanup could not confirm return to ASK; AGENT remains visible.`,
        remainsAgent: true,
      };
    }
    return result;
  }
}
