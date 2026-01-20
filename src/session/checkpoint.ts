import { Bus, SessionEvents } from "../bus";

class CheckpointManagerImpl {
  private static instance: CheckpointManagerImpl;
  private checkpointBranchPrefix = "glm-checkpoint-";

  private constructor() {}

  static getInstance(): CheckpointManagerImpl {
    if (!CheckpointManagerImpl.instance) {
      CheckpointManagerImpl.instance = new CheckpointManagerImpl();
    }
    return CheckpointManagerImpl.instance;
  }

  private async execGit(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; success: boolean }> {
    const options = cwd ? { cwd } : {};
    try {
      const result = Bun.spawnSync({
        cmd: ["git", ...args],
        ...options,
        stdout: "pipe",
        stderr: "pipe",
      });

      return {
        stdout: result.stdout?.toString("utf-8") ?? "",
        stderr: result.stderr?.toString("utf-8") ?? "",
        success: result.exitCode === 0,
      };
    } catch (e) {
      return {
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        success: false,
      };
    }
  }

  private getBranchName(sessionID: string, messageIndex: number): string {
    return `${this.checkpointBranchPrefix}${sessionID}-${messageIndex}`;
  }

  private parseCheckpointBranch(branch: string): { sessionID: string; messageIndex: number } | null {
    const match = branch.match(/^glm-checkpoint-(.+)-(\d+)$/);
    if (!match || !match[1] || !match[2]) return null;

    return {
      sessionID: match[1],
      messageIndex: parseInt(match[2], 10),
    };
  }

  async isGitRepo(cwd?: string): Promise<boolean> {
    const result = await this.execGit(["rev-parse", "--is-inside-work-tree"], cwd);
    return result.success && result.stdout.trim() === "true";
  }

  async getCurrentBranch(cwd?: string): Promise<string | null> {
    const result = await this.execGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
    if (!result.success) return null;
    return result.stdout.trim();
  }

  async createCheckpoint(
    sessionID: string,
    messageIndex: number,
    messageSummary?: string,
    cwd?: string
  ): Promise<boolean> {
    if (!(await this.isGitRepo(cwd))) {
      return false;
    }

    const currentBranch = await this.getCurrentBranch(cwd);
    if (!currentBranch) return false;

    try {
      const branchName = this.getBranchName(sessionID, messageIndex);

      const createResult = await this.execGit(["checkout", "-b", branchName], cwd);
      if (!createResult.success) {
        console.error(`Failed to create branch ${branchName}:`, createResult.stderr);
        return false;
      }

      const message = `glm-checkpoint: ${messageSummary ?? `message ${messageIndex}`}`;
      const addResult = await this.execGit(["add", "."], cwd);
      if (!addResult.success) {
        console.error(`Failed to stage changes:`, addResult.stderr);
        await this.execGit(["checkout", currentBranch], cwd);
        return false;
      }

      const commitResult = await this.execGit(["commit", "-m", message], cwd);
      if (!commitResult.success) {
        console.error(`Failed to commit:`, commitResult.stderr);
        await this.execGit(["checkout", currentBranch], cwd);
        return false;
      }

      const checkoutResult = await this.execGit(["checkout", currentBranch], cwd);
      if (!checkoutResult.success) {
        console.error(`Failed to checkout back to ${currentBranch}:`, checkoutResult.stderr);
        return false;
      }

      return true;
    } catch (e) {
      console.error(`Failed to create checkpoint for session ${sessionID}:`, e);
      return false;
    }
  }

  async listCheckpoints(sessionID: string, cwd?: string): Promise<{ index: number; branch: string; date: string }[]> {
    const result = await this.execGit(["branch", "-a"], cwd);
    if (!result.success) return [];

    const branches = result.stdout.split("\n").map((b) => b.trim());
    const checkpoints: { index: number; branch: string; date: string }[] = [];

    for (const branch of branches) {
      const cleanBranch = branch.replace(/^\*?\s*/, "");
      const parsed = this.parseCheckpointBranch(cleanBranch);

      if (parsed && parsed.sessionID === sessionID) {
        const logResult = await this.execGit(
          ["log", "-1", "--format=%ci", cleanBranch],
          cwd
        );
        const date = logResult.success ? logResult.stdout.trim() : "";

        checkpoints.push({
          index: parsed.messageIndex,
          branch: cleanBranch,
          date,
        });
      }
    }

    return checkpoints.sort((a, b) => a.index - b.index);
  }

  async undoToCheckpoint(
    sessionID: string,
    messageIndex: number,
    cwd?: string
  ): Promise<boolean> {
    const checkpoints = await this.listCheckpoints(sessionID, cwd);
    const target = checkpoints.find((c) => c.index === messageIndex);

    if (!target) return false;

    const currentBranch = await this.getCurrentBranch(cwd);
    if (!currentBranch) return false;

    try {
      const result = await this.execGit(["checkout", target.branch], cwd);
      if (!result.success) {
        console.error(`Failed to checkout ${target.branch}:`, result.stderr);
        return false;
      }

      Bus.publish(SessionEvents.Checkpoint, {
        sessionID,
        action: "undo",
        toIndex: messageIndex,
      });

      return true;
    } catch (e) {
      console.error(`Failed to undo to checkpoint for session ${sessionID}:`, e);
      return false;
    }
  }

  async redoToCheckpoint(
    sessionID: string,
    messageIndex: number,
    cwd?: string
  ): Promise<boolean> {
    const checkpoints = await this.listCheckpoints(sessionID, cwd);
    const target = checkpoints.find((c) => c.index === messageIndex);

    if (!target) return false;

    try {
      const result = await this.execGit(["checkout", target.branch], cwd);
      if (!result.success) {
        console.error(`Failed to checkout ${target.branch}:`, result.stderr);
        return false;
      }

      Bus.publish(SessionEvents.Checkpoint, {
        sessionID,
        action: "redo",
        toIndex: messageIndex,
      });

      return true;
    } catch (e) {
      console.error(`Failed to redo to checkpoint for session ${sessionID}:`, e);
      return false;
    }
  }

  async cleanupCheckpoints(sessionID: string, cwd?: string): Promise<boolean> {
    const checkpoints = await this.listCheckpoints(sessionID, cwd);
    const currentBranch = await this.getCurrentBranch(cwd);

    if (currentBranch && checkpoints.some((c) => c.branch === currentBranch)) {
      const checkoutResult = await this.execGit(["checkout", "-"], cwd);
      if (!checkoutResult.success) {
        console.error(`Failed to checkout previous branch:`, checkoutResult.stderr);
        return false;
      }
    }

    for (const checkpoint of checkpoints) {
      const deleteResult = await this.execGit(["branch", "-D", checkpoint.branch], cwd);
      if (!deleteResult.success) {
        console.error(`Failed to delete branch ${checkpoint.branch}:`, deleteResult.stderr);
      }
    }

    return true;
  }
}

export const CheckpointManager = CheckpointManagerImpl.getInstance();
