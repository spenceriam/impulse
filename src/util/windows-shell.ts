import fs from "fs";
import path from "path";

export type WindowsCommandShellType = "powershell5" | "powershell7" | "cmd" | "git-bash" | "wsl";

export interface WindowsCommandShell {
  type: WindowsCommandShellType;
  executable: string;
  displayName: string;
  version?: string;
  supportsChainedCommands: boolean;
  commandSeparator: "&&" | ";";
}

export interface WindowsProcessInfo {
  name?: string;
  executablePath?: string;
}

const DETECTION_TIMEOUT_MS = 1500;

function streamToText(
  stream: ReadableStream<Uint8Array> | number | null | undefined
): Promise<string> {
  return stream instanceof ReadableStream
    ? new Response(stream).text().catch(() => "")
    : Promise.resolve("");
}

async function readStdoutAndDrainStderr(
  proc: ReturnType<typeof Bun.spawn>,
  timeoutMs = DETECTION_TIMEOUT_MS
): Promise<{ stdout: string; timedOut: boolean }> {
  const stdoutPromise = streamToText(proc.stdout);
  const stderrPromise = streamToText(proc.stderr);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timeoutId = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        // Process may have already exited.
      }
      resolve("timeout");
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      Promise.all([stdoutPromise, stderrPromise, proc.exited]).then(([stdout]) => stdout),
      timeoutPromise,
    ]);

    return result === "timeout"
      ? { stdout: "", timedOut: true }
      : { stdout: result, timedOut: false };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isFile(candidate: string | undefined): candidate is string {
  if (!candidate) return false;
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function pathCandidates(name: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const pathValue = env["PATH"] ?? "";
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, name));
}

function firstExistingFile(candidates: string[]): string | null {
  return candidates.find((candidate) => isFile(candidate)) ?? null;
}

function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return firstExistingFile(pathCandidates(name, env));
}

function shellDisplayName(type: WindowsCommandShellType, version?: string): string {
  switch (type) {
    case "powershell7":
      return version ? `PowerShell ${version} (pwsh)` : "PowerShell 7.x (pwsh)";
    case "powershell5":
      return version ? `Windows PowerShell ${version}` : "Windows PowerShell 5.x";
    case "cmd":
      return "Windows Command Prompt (cmd.exe)";
    case "git-bash":
      return "Git Bash";
    case "wsl":
      return version ? `WSL (${version})` : "WSL (Windows Subsystem for Linux)";
  }
}

function makeShell(
  type: WindowsCommandShellType,
  executable: string,
  version?: string
): WindowsCommandShell {
  // powershell5 uses ; for chaining; all other types (including wsl) support &&
  const supportsChainedCommands = type !== "powershell5";
  return {
    type,
    executable,
    displayName: shellDisplayName(type, version),
    ...(version ? { version } : {}),
    supportsChainedCommands,
    commandSeparator: supportsChainedCommands ? "&&" : ";",
  };
}

export function classifyWindowsShellExecutable(
  executablePathOrName: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): WindowsCommandShellType | null {
  const raw = executablePathOrName?.trim();
  if (!raw) return null;

  const normalized = raw.replaceAll("\\", "/").toLowerCase();
  const base = path.basename(normalized);

  if (base === "pwsh.exe" || base === "pwsh") return "powershell7";
  if (base === "powershell.exe" || base === "powershell") return "powershell5";
  if (base === "cmd.exe" || base === "cmd") return "cmd";
  if (base === "bash.exe" || base === "bash") {
    if (env["MSYSTEM"] || env["MINGW_PREFIX"] || normalized.includes("/git/")) {
      return "git-bash";
    }
  }
  if (base === "wsl.exe" || base === "wsl") return "wsl";

  return null;
}

export function resolveWindowsShellFromSignals(input: {
  env?: NodeJS.ProcessEnv;
  processTree?: WindowsProcessInfo[];
  pwshPath?: string | null;
  powershellPath?: string | null;
}): WindowsCommandShell | null {
  const env = input.env ?? process.env;

  const shellEnv = env["SHELL"];
  const shellEnvType = classifyWindowsShellExecutable(shellEnv, env);
  if (shellEnvType === "git-bash" && shellEnv) {
    return makeShell("git-bash", shellEnv);
  }

  if (env["MSYSTEM"] || env["MINGW_PREFIX"]) {
    const bashPath = firstExistingFile([
      shellEnv ?? "",
      findOnPath("bash.exe", env) ?? "",
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    ]);
    if (bashPath) return makeShell("git-bash", bashPath);
  }

  for (const proc of input.processTree ?? []) {
    const type =
      classifyWindowsShellExecutable(proc.executablePath, env) ??
      classifyWindowsShellExecutable(proc.name, env);
    if (!type) continue;
    const executable = proc.executablePath && isFile(proc.executablePath)
      ? proc.executablePath
      : type === "powershell7"
        ? input.pwshPath ?? "pwsh"
        : type === "powershell5"
          ? input.powershellPath ?? "powershell.exe"
          : type === "cmd"
            ? env["COMSPEC"] ?? "cmd.exe"
            : shellEnv ?? findOnPath("bash.exe", env) ?? "bash.exe";
    return makeShell(type, executable);
  }

  if (input.pwshPath) return makeShell("powershell7", input.pwshPath);
  return makeShell("powershell5", input.powershellPath ?? "powershell.exe");
}

async function detectPowerShellExecutable(
  executable: string,
  type: "powershell5" | "powershell7"
): Promise<WindowsCommandShell | null> {
  try {
    const proc = Bun.spawn({
      cmd: [executable, "-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const result = await readStdoutAndDrainStderr(proc);
    const version = result.stdout.trim();
    if (!result.timedOut && proc.exitCode === 0 && version) {
      return makeShell(type, executable, version);
    }
  } catch {
    // Shell not available.
  }

  return null;
}

async function detectPowerShellFallback(
  env: NodeJS.ProcessEnv = process.env
): Promise<{
  pwsh: WindowsCommandShell | null;
  powershell: WindowsCommandShell;
}> {
  const pwshPath = findOnPath("pwsh.exe", env) ?? findOnPath("pwsh", env) ?? "pwsh";
  const pwsh = await detectPowerShellExecutable(pwshPath, "powershell7");
  const psPath = env["SystemRoot"]
    ? path.join(env["SystemRoot"], "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const powershell =
    (await detectPowerShellExecutable(psPath, "powershell5")) ??
    makeShell("powershell5", psPath);

  return { pwsh, powershell };
}

async function detectWindowsProcessTree(): Promise<WindowsProcessInfo[]> {
  const script = `
$pidToCheck = ${process.ppid}
for ($i = 0; $i -lt 8 -and $pidToCheck -gt 0; $i++) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId = $pidToCheck" -ErrorAction SilentlyContinue
  if ($null -eq $p) { break }
  "$($p.Name)|$($p.ExecutablePath)"
  $pidToCheck = [int]$p.ParentProcessId
}
`.trim();

  try {
    const proc = Bun.spawn({
      cmd: ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
      stdout: "pipe",
      stderr: "pipe",
    });
    const result = await readStdoutAndDrainStderr(proc);
    if (result.timedOut || proc.exitCode !== 0) return [];

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, executablePath] = line.split("|", 2);
        return {
          ...(name ? { name } : {}),
          ...(executablePath ? { executablePath } : {}),
        };
      });
  } catch {
    return [];
  }
}

let cachedWindowsShell: Promise<WindowsCommandShell> | undefined;

export async function detectWindowsCommandShell(
  env: NodeJS.ProcessEnv = process.env
): Promise<WindowsCommandShell> {
  if (process.platform !== "win32") {
    return makeShell("powershell5", "powershell.exe");
  }

  cachedWindowsShell ??= (async () => {
    const [fallback, processTree] = await Promise.all([
      detectPowerShellFallback(env),
      detectWindowsProcessTree(),
    ]);
    const resolved = resolveWindowsShellFromSignals({
      env,
      processTree,
      pwshPath: fallback.pwsh?.executable ?? null,
      powershellPath: fallback.powershell.executable,
    });

    if (!resolved) return fallback.pwsh ?? fallback.powershell;
    if (resolved.type === "powershell7") return fallback.pwsh ?? resolved;
    if (resolved.type === "powershell5") return fallback.powershell;
    return resolved;
  })();

  return cachedWindowsShell;
}

export function clearWindowsShellCache(): void {
  cachedWindowsShell = undefined;
}

// ---------------------------------------------------------------------------
// WSL detection (#115)
// ---------------------------------------------------------------------------

let cachedWslAvailable: Promise<WindowsCommandShell | null> | undefined;

/**
 * Probe whether WSL is installed and return a shell descriptor for it.
 * Returns null when wsl.exe is not found or the WSL service is not running.
 * Result is cached for the process lifetime.
 */
export async function detectWslShell(): Promise<WindowsCommandShell | null> {
  cachedWslAvailable ??= detectWslShellUncached();
  return cachedWslAvailable;
}

async function detectWslShellUncached(): Promise<WindowsCommandShell | null> {
  const wslPath = findOnPath("wsl.exe") ?? findOnPath("wsl");
  if (!wslPath) return null;
  try {
    const proc = Bun.spawn({
      cmd: [wslPath, "-l", "--quiet"],
      stdout: "pipe",
      stderr: "pipe",
    });
    const { stdout, timedOut } = await readStdoutAndDrainStderr(proc, 3000);
    if (timedOut || proc.exitCode !== 0) return null;
    // stdout lists distro names; any output means WSL has ≥1 distro
    const distros = stdout.split(/\r?\n/).map((l) => l.replace(/\0/g, "").trim()).filter(Boolean);
    if (distros.length === 0) return null;
    const version = distros[0]; // use first distro name as display label
    return makeShell("wsl", wslPath, version);
  } catch {
    return null;
  }
}

export function clearWslCache(): void {
  cachedWslAvailable = undefined;
}
