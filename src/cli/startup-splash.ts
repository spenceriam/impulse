/**
 * Pre-TUI startup lines on stdout (before pi-tui alternate screen).
 */

import { Global } from "../global.js";
import { SessionStoreInstance } from "../session/store.js";
import { load as loadConfig } from "../util/config.js";
import { checkForUpdate } from "../util/update-check.js";
import packageJson from "../../package.json";
import {
  printStdoutLogo,
  printWelcomeMeta,
  stdoutSublinePrefix,
} from "./welcome-banner.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function dimSplashLine(text: string): string {
  return dim(`${stdoutSublinePrefix()}${text}`);
}

export type StartupResumeOption = "picker" | { sessionId: string };

export type StartupSplashOptions = {
  resume?: StartupResumeOption;
};

function splitProviderModel(model: string): { provider: string; modelName: string } {
  const slash = model.indexOf("/");
  if (slash <= 0) return { provider: model, modelName: model };
  return {
    provider: model.slice(0, slash),
    modelName: model.slice(slash + 1),
  };
}

export async function printStartupSplash(options?: StartupSplashOptions): Promise<void> {
  const version = packageJson.version;
  console.log("");
  printStdoutLogo();
  printWelcomeMeta(version);

  const update = await checkForUpdate();
  if (update) {
    console.log(
      dimSplashLine(
        `Update available: v${update.currentVersion} → v${update.latestVersion}  (${update.updateCommand})`
      )
    );
  }

  const configPath = `${Global.Path.home}/config.json`;
  console.log(dimSplashLine(`Loading config from ${configPath}`));

  const config = await loadConfig();
  const defaultProvider = config.defaultProvider?.trim() || "";
  const defaultModel = config.defaultModel?.trim() || "";

  const resume = options?.resume;
  if (resume && resume !== "picker" && resume.sessionId) {
    try {
      const session = await SessionStoreInstance.read(resume.sessionId);
      const title =
        session.headerTitle?.trim() || session.name?.trim() || "Untitled session";
      console.log(dimSplashLine(`Resuming session: "${title}"`));
      console.log(dimSplashLine(`Session ID: ${session.id}`));
      if (session.model?.trim()) {
        const { provider, modelName } = splitProviderModel(session.model.trim());
        console.log(dimSplashLine(`Session provider: ${provider}`));
        console.log(dimSplashLine(`Session model: ${modelName}`));
      } else if (defaultProvider || defaultModel) {
        console.log(dimSplashLine(`Starting with provider: ${defaultProvider || "(not configured)"}`));
        console.log(dimSplashLine(`Starting with model: ${defaultModel || "(not configured)"}`));
      }
    } catch {
      console.log(dimSplashLine(`Resuming session: ${resume.sessionId}`));
      console.log(dimSplashLine(`(session file not found — will prompt or start fresh)`));
      if (defaultProvider || defaultModel) {
        console.log(dimSplashLine(`Starting with provider: ${defaultProvider || "(not configured)"}`));
        console.log(dimSplashLine(`Starting with model: ${defaultModel || "(not configured)"}`));
      }
    }
  } else if (resume === "picker") {
    console.log(dimSplashLine("Resuming: session picker"));
    console.log(
      dimSplashLine(
        `Defaults if you pick a session: provider ${defaultProvider || "(not configured)"}, model ${defaultModel || "(not configured)"}`
      )
    );
  } else {
    console.log(dimSplashLine(`Starting with provider: ${defaultProvider || "(not configured)"}`));
    console.log(dimSplashLine(`Starting with model: ${defaultModel || "(not configured)"}`));
  }

  console.log("");
}

export async function waitForTuiStart(options?: { timeoutMs?: number }): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 3000;
  console.log(dimSplashLine("Starting… (press any key to skip)"));

  if (!process.stdin.isTTY) {
    await Bun.sleep(timeoutMs);
    console.log("");
    return;
  }

  const wasRaw = process.stdin.isRaw ?? false;
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", onData);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(wasRaw);
      }
      process.stdin.pause();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const onData = () => finish();
    process.stdin.once("data", onData);
  });

  console.log("");
}
