/**
 * CLI Renderer — wires Impulse components with plain terminal I/O.
 *
 * Uses process.stdout.write for all output (append-only, no full-screen clears).
 * pi-tui is used for the ContextBarComponent's render() helpers only.
 * The main output pipeline is deliberately simple: just write tokens as they
 * arrive, update tool lines in-place, print the context bar after each turn.
 */

import { ProcessTerminal } from "@mariozechner/pi-tui";
import { ContextBarComponent } from "./components/context-bar.js";
import { StreamingBlock } from "./components/streaming-block.js";
import { ToolBlock } from "./components/tool-block.js";
import { Spinner } from "./spinner.js";
import { AgentLoop, type LoopEvents } from "../agent/loop.js";
import { load as loadConfig, save as saveConfig, type Config } from "../util/config.js";
import { SessionManager } from "../session/manager.js";
import { setCurrentMode } from "../tools/mode-state.js";
import { normalizeMode } from "../constants.js";
import type { Mode } from "../constants.js";
import * as readline from "readline";

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const ansi = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  fg:     (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};
const clr = {
  user:    (s: string) => ansi.fg(36, s),
  success: (s: string) => ansi.fg(32, s),
  error:   (s: string) => ansi.fg(31, s),
  warn:    (s: string) => ansi.fg(33, s),
  dim:     (s: string) => ansi.fg(90, s),
  bold:    (s: string) => `${ansi.bold}${s}${ansi.reset}`,
  advisor: (s: string) => ansi.fg(35, s),
  tool:    (s: string) => ansi.fg(36, s),
};

// ── Renderer ──────────────────────────────────────────────────────────────────

export class ImpulseRenderer {
  private terminal = new ProcessTerminal();
  private loop = new AgentLoop();
  private spinner = new Spinner();
  private contextBar!: ContextBarComponent;
  private currentStreamBlock: StreamingBlock | null = null;
  private activeToolBlocks: Map<string, ToolBlock> = new Map();

  private mode: Mode = "WORK";
  private contextTokens = 0;
  private contextWindow = 200000;
  private advisorModel: string | undefined;
  private isRunning = false;

  private makePrompt(): string {
    const pct = this.contextWindow > 0
      ? Math.round((this.contextTokens / this.contextWindow) * 100) : 0;
    return `  ${clr.dim(`[${this.mode}]`)} ${clr.dim(`${pct}%`)} ${clr.user("›")} `;
  }

  async start(): Promise<void> {
    const config = await loadConfig();
    this.mode = normalizeMode(config.defaultMode) as Mode;
    this.advisorModel = config.advisorModel;
    this.contextWindow = 200000;

    setCurrentMode(this.mode);

    // Ensure there's an active session
    if (!SessionManager.getCurrentSession()) {
      await SessionManager.createNew();
    }

    this.contextBar = new ContextBarComponent({
      workerModel: config.defaultModel,
      contextTokens: 0,
      contextWindow: this.contextWindow,
      mode: this.mode,
      ...(this.advisorModel ? { advisorModel: this.advisorModel } : {}),
    });

    this.printWelcome(config.defaultModel);
    await this.inputLoop();
  }

  // ── Welcome banner ──────────────────────────────────────────────────────────

  private printWelcome(model: string): void {
    const w = this.terminal.columns || 80;
    const bar = ansi.dim + "─".repeat(w) + ansi.reset;
    process.stdout.write(`\n${clr.bold("  IMPULSE")}  ${clr.dim("cli coding agent")}\n`);
    process.stdout.write(`  ${clr.dim(`model: ${model}  |  mode: ${this.mode}`)}\n`);
    process.stdout.write(`  ${clr.dim("/help for commands  ·  Ctrl+C abort  ·  Ctrl+D exit")}\n`);
    process.stdout.write(`${bar}\n\n`);
  }

  // ── Input loop ──────────────────────────────────────────────────────────────

  private async inputLoop(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      historySize: 100,
    });

    rl.on("close", () => { this.loop.abort(); process.exit(0); });

    // ── Ctrl+C: abort running turn, don't exit ────────────────────────────
    process.on("SIGINT", () => {
      if (this.isRunning) {
        this.loop.abort();
        process.stdout.write(`\n  ${clr.warn("⊘")}  aborted\n\n`);
        this.isRunning = false;
      } else {
        process.stdout.write("\n");
        process.exit(0);
      }
    });

    // ── Tab / Shift-Tab: cycle modes without /mode command ────────────────
    const modes: Mode[] = ["WORK", "EXPLORE", "PLAN", "DEBUG"];
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdin.on("keypress", (_ch, key) => {
      if (!key) return;
      // Only act when not mid-turn and readline is at the prompt
      if (this.isRunning) return;

      if (key.name === "tab" && !key.shift) {
        // Tab → cycle forward
        const idx = modes.indexOf(this.mode);
        this.mode = modes[(idx + 1) % modes.length]!;
        setCurrentMode(this.mode);
        this.contextBar.update({ mode: this.mode });
        // Redraw prompt
        rl.setPrompt(this.makePrompt());
        process.stdout.write(`\r\x1b[2K  ${clr.dim(`→ mode: ${this.mode}`)}\n`);
        rl.prompt(true);
      } else if (key.name === "tab" && key.shift) {
        // Shift+Tab → cycle backward
        const idx = modes.indexOf(this.mode);
        this.mode = modes[(idx - 1 + modes.length) % modes.length]!;
        setCurrentMode(this.mode);
        this.contextBar.update({ mode: this.mode });
        rl.setPrompt(this.makePrompt());
        process.stdout.write(`\r\x1b[2K  ${clr.dim(`→ mode: ${this.mode}`)}\n`);
        rl.prompt(true);
      }
    });

    const makePrompt = () => this.makePrompt();

    rl.setPrompt(makePrompt());
    rl.prompt();

    for await (const line of rl) {
      const input = line.trim();
      if (!input) { rl.setPrompt(makePrompt()); rl.prompt(); continue; }

      if (input.startsWith("/")) {
        await this.handleSlash(input);
      } else {
        rl.pause();
        await this.runTurn(input);
        rl.resume();
      }

      rl.setPrompt(makePrompt());
      rl.prompt();
    }
  }

  // ── Agent turn ──────────────────────────────────────────────────────────────

  private async runTurn(userMessage: string): Promise<void> {
    this.isRunning = true;
    this.currentStreamBlock = new StreamingBlock();
    this.activeToolBlocks.clear();

    // ── User message block ────────────────────────────────────────────────────
    const w = this.terminal.columns || 80;
    process.stdout.write(`\n  ${clr.user("╭─ You " + "─".repeat(Math.max(0, w - 10)) )}\n`);
    process.stdout.write(`  ${clr.user("│")}  ${userMessage}\n`);
    process.stdout.write(`  ${clr.user("╰" + "─".repeat(Math.max(0, w - 4)))}\n\n`);

    let thinkingStarted = false;
    let hasWrittenText = false;

    const events: LoopEvents = {
      onTurnStart: () => {
        this.spinner.start("connecting…");
      },
      onToken: (text) => {
        if (this.spinner.isActive) this.spinner.clear();
        if (thinkingStarted) {
          process.stdout.write(`\n${clr.dim("└────────────────────────────────────────")}\n\n`);
          thinkingStarted = false;
        }
        if (!hasWrittenText) {
          process.stdout.write("  "); // indent first line
          hasWrittenText = true;
        }
        process.stdout.write(text.replace(/\n/g, "\n  "));
      },
      onThinking: (text) => {
        if (this.spinner.isActive) this.spinner.clear();
        if (!thinkingStarted) {
          process.stdout.write(`${clr.dim("┌─ Thinking ─────────────────────────────")}\n`);
          process.stdout.write(clr.dim("│ "));
          thinkingStarted = true;
        }
        process.stdout.write(ansi.dim + text.replace(/\n/g, `\n${ansi.reset}${clr.dim("│ ")}`) + ansi.reset);
      },
      onAdvisorStart: (model) => {
        if (this.spinner.isActive) this.spinner.clear();
        const short = model.split("/").pop() ?? model;
        process.stdout.write(`\n  ${clr.dim(`[advisor • consulting ${short}…]`)}`);
      },
      onAdvisorToken: (_text) => { /* buffered silently */ },
      onAdvisorEnd: (summary) => {
        const raw = summary.trim();
        const oneliner = raw.split(/[.!?\n]/)[0]?.trim() ?? raw;
        const truncated = oneliner.length > 80 ? oneliner.slice(0, 77) + "…" : oneliner;
        process.stdout.write(`\r\x1b[2K  ${clr.dim(`[advisor: ${truncated}]`)}\n`);
      },
      onToolStart: (_id, name, args) => {
        if (this.spinner.isActive) this.spinner.clear();
        if (thinkingStarted) {
          process.stdout.write(`\n${clr.dim("└────────────────────────────────────────")}\n`);
          thinkingStarted = false;
        }
        if (hasWrittenText) { process.stdout.write("\n"); hasWrittenText = false; }
        const argStr = this.fmtArgs(args);
        process.stdout.write(`\n  ${ansi.fg(33, "▶")}  ${clr.tool(name)}  ${clr.dim(argStr)}\n`);
        this.spinner.start(`running ${name}…`);
      },
      onToolEnd: (_id, _name, result, durationMs) => {
        this.spinner.clear();
        const icon = result.success ? clr.success("✓") : clr.error("✗");
        const dur = clr.dim(`${durationMs}ms`);
        const lines = result.output.trim().split("\n");
        const preview = lines[0]?.slice(0, 65) ?? "";
        const more = lines.length > 1 ? clr.dim(` (+${lines.length - 1} lines)`) : "";
        process.stdout.write(`  ${icon}  ${clr.dim(preview)}${more}  ${dur}\n`);
        if (!result.success) {
          // Show first error line in red
          process.stdout.write(`  ${clr.error("  " + (lines[1] ?? "").slice(0, 70))}\n`);
        }
      },
      onPermissionRequest: (toolName, description, resolve) => {
        this.spinner.clear();
        void this.askPermission(toolName, description).then(({ approved, always }) => {
          resolve(approved, always);
        });
      },
      onCompacting: () => {
        this.spinner.clear();
        process.stdout.write(`\n  ${clr.warn("⟳")}  ${clr.dim("compacting context…")}\n`);
        this.spinner.start("compacting…");
      },
      onCompacted: (removedCount) => {
        this.spinner.clear();
        process.stdout.write(`  ${clr.success("✓")}  ${clr.dim(`compacted — removed ${removedCount} messages`)}\n`);
      },
      onTurnEnd: (usage) => {
        this.spinner.clear();
        if (thinkingStarted) {
          process.stdout.write(`\n${clr.dim("└────────────────────────────────────────")}\n`);
          thinkingStarted = false;
        }
        if (hasWrittenText) process.stdout.write("\n");
        this.contextTokens = usage.inputTokens;
        this.isRunning = false;
        this.currentStreamBlock?.finalize();
        this.printContextBar(usage.tokensPerSecond, usage.durationMs);
      },
      onError: (err) => {
        this.spinner.clear();
        this.isRunning = false;
        process.stdout.write(`\n  ${clr.error("Error:")} ${err.message}\n`);
      },
    };

    await this.loop.run(userMessage, this.mode, events);
    process.stdout.write("\n");
  }

  // ── Context bar ─────────────────────────────────────────────────────────────

  private printContextBar(tokensPerSecond?: number, durationMs?: number): void {
    this.contextBar.update({
      contextTokens: this.contextTokens,
      contextWindow: this.contextWindow,
      mode: this.mode,
      ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
      ...(durationMs !== undefined ? { lastTurnMs: durationMs } : {}),
    });
    const w = this.terminal.columns || 80;
    process.stdout.write(`\n${ansi.dim}${"─".repeat(w)}${ansi.reset}\n`);
    for (const l of this.contextBar.render(w)) process.stdout.write(l + "\n");
    process.stdout.write(`${ansi.dim}${"─".repeat(w)}${ansi.reset}\n\n`);
  }

  private askPermission(
    toolName: string,
    description: string
  ): Promise<{ approved: boolean; always: boolean }> {
    return new Promise((resolve) => {
      process.stdout.write(
        `\n  ${clr.warn("⚠")}  ${clr.tool(toolName)}  ${clr.dim(description)}\n` +
        `  ${clr.dim("[y]es  [n]o  [a]lways  [s]ession")}  `
      );

      const onKey = (key: Buffer | string) => {
        const k = key.toString().toLowerCase().trim();
        process.stdin.setRawMode?.(false);
        process.stdin.removeListener("data", onKey);
        process.stdout.write("\n");
        if (k === "y" || k === "\r" || k === "\n") resolve({ approved: true,  always: false });
        else if (k === "a")                         resolve({ approved: true,  always: true  });
        else if (k === "s")                         resolve({ approved: true,  always: false });
        else                                        resolve({ approved: false, always: false });
      };

      process.stdin.setRawMode?.(true);
      process.stdin.once("data", onKey);
    });
  }

  // ── Slash commands ───────────────────────────────────────────────────────────

  private async handleSlash(input: string): Promise<void> {
    const parts = input.slice(1).trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? "";
    const arg = parts.slice(1).join(" ").trim();

    switch (cmd) {
      case "advisor": await this.cmdAdvisor(arg); break;
      case "mode":    this.cmdMode(arg);          break;
      case "clear":   process.stdout.write("\x1b[2J\x1b[H"); break;
      case "new":     await SessionManager.createNew(arg || undefined);
                      process.stdout.write(`  ${clr.success("✓")} New session started\n`); break;
      case "help":    this.printHelp();           break;
      case "quit":
      case "exit":    process.exit(0);            break;
      default:        process.stdout.write(`  ${clr.warn("?")} Unknown: /${cmd} — try /help\n`);
    }
  }

  private async cmdAdvisor(arg: string): Promise<void> {
    const config = await loadConfig();

    if (arg === "off") {
      // Remove advisorModel from config
      const { advisorModel: _removed, ...rest } = config;
      await saveConfig(rest as Config);
      this.advisorModel = undefined;
      this.contextBar.update({ workerModel: config.defaultModel, contextTokens: this.contextTokens,
        contextWindow: this.contextWindow, mode: this.mode });
      process.stdout.write(`  ${clr.success("✓")} Advisor disabled\n`);
      return;
    }

    if (arg === "on" || arg === "") {
      process.stdout.write(`\n  ${clr.bold("Advisor model")}  ${clr.dim("(e.g. openrouter/anthropic/claude-opus-4.7)")}\n`);
      const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((res) =>
        rl2.question(`  ${clr.user("›")} `, (a) => { rl2.close(); res(a.trim()); })
      );
      if (!answer) { process.stdout.write(`  ${clr.dim("Cancelled.")}\n`); return; }
      config.advisorModel = answer;
      await saveConfig(config);
      this.advisorModel = answer;
      this.contextBar.update({ advisorModel: answer });
      process.stdout.write(`  ${clr.success("✓")} Advisor → ${answer}\n`);
      return;
    }

    // /advisor <model> — direct set
    config.advisorModel = arg;
    await saveConfig(config);
    this.advisorModel = arg;
    this.contextBar.update({ advisorModel: arg });
    process.stdout.write(`  ${clr.success("✓")} Advisor → ${arg}\n`);
  }

  private cmdMode(arg: string): void {
    const modes: Mode[] = ["WORK", "EXPLORE", "PLAN", "DEBUG"];
    if (!arg) {
      process.stdout.write(`  mode: ${this.mode}  options: ${modes.join(" | ")}\n`); return;
    }
    const m = arg.toUpperCase() as Mode;
    if (modes.includes(m)) {
      this.mode = m;
      setCurrentMode(m);
      this.contextBar.update({ mode: m });
      process.stdout.write(`  ${clr.success("✓")} Mode → ${m}\n`);
    } else {
      process.stdout.write(`  ${clr.error("✗")} Unknown mode. Options: ${modes.join(", ")}\n`);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private fmtArgs(args: Record<string, unknown>): string {
    const keys = ["path", "filePath", "file", "command", "pattern", "description", "prompt"];
    for (const k of keys) {
      if (typeof args[k] === "string") {
        const v = String(args[k]);
        return v.length > 55 ? v.slice(0, 52) + "…" : v;
      }
    }
    return Object.entries(args).slice(0, 1)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("").slice(0, 55);
  }

  private printHelp(): void {
    process.stdout.write(`
  ${clr.bold("Commands")}
  ${clr.dim("─────────────────────────────────────────")}
  ${clr.user("/advisor on")}          ${clr.dim("Pick advisor model interactively")}
  ${clr.user("/advisor off")}         ${clr.dim("Disable advisor")}
  ${clr.user("/advisor <model>")}     ${clr.dim("Set advisor directly")}
  ${clr.user("/mode <MODE>")}         ${clr.dim("WORK | EXPLORE | PLAN | DEBUG")}
  ${clr.user("/new [name]")}          ${clr.dim("Start new session")}
  ${clr.user("/clear")}               ${clr.dim("Clear screen")}
  ${clr.user("/help")}                ${clr.dim("This message")}
  ${clr.user("/exit")}                ${clr.dim("Quit")}

  ${clr.bold("Modes")}
  ${clr.dim("─────────────────────────────────────────")}
  ${clr.user("WORK")}    ${clr.dim("Full agent — reads + writes files, runs bash")}
  ${clr.user("EXPLORE")} ${clr.dim("Read-only — no writes or bash")}
  ${clr.user("PLAN")}    ${clr.dim("Docs/PRD writing only")}
  ${clr.user("DEBUG")}   ${clr.dim("Like WORK, focused on debugging")}

  ${clr.dim("Ctrl+C  abort current turn")}
  ${clr.dim("Ctrl+D  exit")}

`);
  }
}
