/**
 * Cross-platform process-tree kill for background jobs (#116).
 *
 * A bare proc.kill() only signals the direct child. On Windows, a shell
 * wrapper (bash.exe / powershell.exe / cmd.exe) spawning something like
 * `npm run dev` leaves the real node process orphaned. On POSIX, Bun.spawn
 * has no detached/process-group option, so the child shares impulse's own
 * process group — `kill(-pid)` would kill impulse itself, not just the job.
 * Instead we look up the actual descendant PIDs via `ps` and signal each.
 */

const GRACE_MS = 500;

/**
 * Parse `pid ppid` pairs (one per line, e.g. from `ps -A -o pid=,ppid=`) into
 * the list of descendants of rootPid, ordered deepest-first so children are
 * signaled before their parents. Pure — exported for tests.
 */
export function collectDescendants(psOutput: string, rootPid: number): number[] {
  const pairs: Array<{ pid: number; ppid: number }> = [];
  for (const line of psOutput.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!match) continue;
    pairs.push({ pid: Number(match[1]), ppid: Number(match[2]) });
  }

  const childrenOf = new Map<number, number[]>();
  for (const { pid, ppid } of pairs) {
    const list = childrenOf.get(ppid) ?? [];
    list.push(pid);
    childrenOf.set(ppid, list);
  }

  // BFS from rootPid, then reverse so the deepest descendants come first.
  const ordered: number[] = [];
  const queue = [...(childrenOf.get(rootPid) ?? [])];
  const seen = new Set<number>(queue);
  while (queue.length > 0) {
    const pid = queue.shift()!;
    ordered.push(pid);
    for (const child of childrenOf.get(pid) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        queue.push(child);
      }
    }
  }
  return ordered.reverse();
}

async function posixDescendants(rootPid: number): Promise<number[]> {
  try {
    const proc = Bun.spawn({ cmd: ["ps", "-A", "-o", "pid=,ppid="], stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return collectDescendants(output, rootPid);
  } catch {
    return [];
  }
}

/** Kill a background job's full process tree. Best-effort; never throws. */
export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    try {
      const proc = Bun.spawn({
        cmd: ["taskkill", "/PID", String(pid), "/T", "/F"],
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
    } catch {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    }
    return;
  }

  const descendants = await posixDescendants(pid);
  const targets = [...descendants, pid];
  for (const target of targets) {
    try {
      process.kill(target, "SIGTERM");
    } catch {
      /* already gone, or we lack permission — best-effort */
    }
  }

  await new Promise((resolve) => setTimeout(resolve, GRACE_MS));

  for (const target of targets) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/**
 * Synchronous variant for use in a `process.on("exit")` handler, where async
 * work cannot complete. Skips the SIGTERM grace period and goes straight to
 * SIGKILL since the host process is already shutting down.
 */
export function killProcessTreeSync(pid: number): void {
  if (process.platform === "win32") {
    try {
      Bun.spawnSync({ cmd: ["taskkill", "/PID", String(pid), "/T", "/F"], stdout: "ignore", stderr: "ignore" });
    } catch {
      try {
        process.kill(pid);
      } catch {
        /* already gone */
      }
    }
    return;
  }

  try {
    const proc = Bun.spawnSync({ cmd: ["ps", "-A", "-o", "pid=,ppid="], stdout: "pipe", stderr: "ignore" });
    const output = proc.stdout.toString();
    const descendants = collectDescendants(output, pid);
    for (const target of [...descendants, pid]) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}
