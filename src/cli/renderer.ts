/**
 * ImpulseRenderer — full TUI using @mariozechner/pi-tui
 *
 * Layout (top → bottom, viewport shows bottom when content overflows):
 *   chatContainer     — conversation history (grows upward as turns add content)
 *   loaderLine        — Braille spinner while agent works (Loader component)
 *   ── separator ──   — always visible divider
 *   contextBar        — model │ tokens │ dir ⎇ branch │ mode │ stats
 *   promptInput       — [MODE] › _   (Input component, Tab cycles modes)
 *
 * Sticky bar: pi-tui renders all children top→bottom and shows the last N
 * lines when content exceeds terminal height, so the bar is always visible.
 */

import {
  TUI,
  ProcessTerminal,
  Container,
  Text,
  Spacer,
  Loader,
  Input,
  type Component,
  type Focusable,
} from "@mariozechner/pi-tui";
import { ContextBarComponent } from "./components/context-bar.js";
import { AgentLoop, type LoopEvents } from "../agent/loop.js";
import { load as loadConfig, save as saveConfig, type Config } from "../util/config.js";
import { SessionManager } from "../session/manager.js";
import { setCurrentMode } from "../tools/mode-state.js";
import { normalizeMode } from "../constants.js";
import type { Mode } from "../constants.js";

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const A = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  fg:     (code: number, s: string) => `\x1b[${code}m${s}\x1b[0m`,
};
const clr = {
  user:    (s: string) => A.fg(36, s),
  success: (s: string) => A.fg(32, s),
  error:   (s: string) => A.fg(31, s),
  warn:    (s: string) => A.fg(33, s),
  dim:     (s: string) => A.fg(90, s),
  bold:    (s: string) => `${A.bold}${s}${A.reset}`,
  tool:    (s: string) => A.fg(36, s),
  advisor: (s: string) => A.fg(35, s),
  mode:    (s: string) => A.fg(34, s),
  sep:     (s: string) => A.fg(90, s),
};

// ── PromptInput: wraps pi-tui Input, intercepts special keys ─────────────────

class PromptInput implements Component, Focusable {
  focused = false;

  private inner = new Input();
  private prefix = "";
  private _prefixWidth = 0;

  onTabForward?: () => void;
  onTabBackward?: () => void;
  onAbort?: () => void;
  onExit?: () => void;

  get onSubmit() { return this.inner.onSubmit; }
  set onSubmit(fn: ((v: string) => void) | undefined) {
    if (fn !== undefined) this.inner.onSubmit = fn;
    else this.inner.onSubmit = undefined as unknown as (value: string) => void;
  }

  setPrefix(text: string, width: number): void {
    this.prefix = text;
    this._prefixWidth = width;
  }

  clear(): void { this.inner.setValue(""); }

  handleInput(data: string): void {
    // Special key intercepts — consume without forwarding
    if (data === "\t")      { this.onTabForward?.();  return; }
    if (data === "\x1b[Z")  { this.onTabBackward?.(); return; } // Shift+Tab
    if (data === "\x03")    { this.onAbort?.();        return; } // Ctrl+C
    if (data === "\x04")    { this.onExit?.();         return; } // Ctrl+D
    this.inner.handleInput(data);
  }

  invalidate(): void { this.inner.invalidate(); }

  render(width: number): string[] {
    // Inner renders within the remaining width after prefix
    const innerLines = this.inner.render(Math.max(1, width - this._prefixWidth));
    // Prepend prefix to first line — CURSOR_MARKER is inside innerLines[0] already
    // so cursor will be positioned at prefix + cursor_offset, which is correct
    return [this.prefix + (innerLines[0] ?? ""), ...innerLines.slice(1)];
  }
}

// ── SeparatorLine: a fixed dim horizontal rule ────────────────────────────────

class SeparatorLine implements Component {
  invalidate() {}
  render(width: number): string[] {
    return [A.dim + "─".repeat(width) + A.reset];
  }
}

// ── ImpulseRenderer ───────────────────────────────────────────────────────────

export class ImpulseRenderer {
  // pi-tui objects
  private terminal = new ProcessTerminal();
  private tui!: TUI;

  // Layout components
  private chat!: Container;
  private loader!: Loader;
  private contextBar!: ContextBarComponent;
  private promptInput!: PromptInput;

  // Streaming state: current assistant text block (updated in-place)
  private streamingText: Text | null = null;
  private streamingRaw = "";
  private thinkingText: Text | null = null;
  private thinkingRaw = "";
  private thinkingOpen = false;

  // Agent + state
  private loop = new AgentLoop();
  private mode: Mode = "WORK";
  private contextTokens = 0;
  private contextWindow = 200000;
  private advisorModel: string | undefined;
  private isRunning = false;

  async start(): Promise<void> {
    const config = await loadConfig();
    this.mode = normalizeMode(config.defaultMode) as Mode;
    this.advisorModel = config.advisorModel;

    setCurrentMode(this.mode);

    if (!SessionManager.getCurrentSession()) {
      await SessionManager.createNew();
    }

    // ── Build TUI layout ──────────────────────────────────────────────────
    this.tui = new TUI(this.terminal);

    // 1. Chat history — grows as turns are added
    this.chat = new Container();
    this.tui.addChild(this.chat);

    // Welcome message
    this.chat.addChild(new Spacer(1));
    this.chat.addChild(new Text(
      `  ${clr.bold("IMPULSE")}  ${clr.dim("cli coding agent")}\n` +
      `  ${clr.dim(`model: ${config.defaultModel}`)}\n` +
      `  ${clr.dim("Tab/Shift-Tab: cycle mode  ·  /help: commands  ·  Ctrl+C: abort  ·  Ctrl+D: exit")}`,
      0, 0
    ));
    this.chat.addChild(new Spacer(1));

    // 2. Loader (spinner) — hidden until agent runs
    this.loader = new Loader(
      this.tui,
      (s) => A.fg(90, s),
      (s) => A.fg(90, s),
      "thinking…",
      { frames: ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"], intervalMs: 80 }
    );
    this.tui.addChild(this.loader);

    // 3. Separator
    this.tui.addChild(new SeparatorLine());

    // 4. Context bar
    this.contextBar = new ContextBarComponent({
      workerModel: config.defaultModel,
      contextTokens: 0,
      contextWindow: this.contextWindow,
      mode: this.mode,
      ...(this.advisorModel ? { advisorModel: this.advisorModel } : {}),
    });
    this.tui.addChild(this.contextBar);

    // 5. Prompt input
    this.promptInput = new PromptInput();
    this.promptInput.onSubmit = (value) => void this.onSubmit(value);
    this.promptInput.onTabForward  = () => this.cycleMode(1);
    this.promptInput.onTabBackward = () => this.cycleMode(-1);
    this.promptInput.onAbort = () => {
      if (this.isRunning) {
        this.loop.abort();
        this.loader.stop();
        this.loader.setMessage("aborted");
        this.addChatLine(`\n  ${clr.warn("⊘")}  ${clr.dim("aborted")}`);
        this.isRunning = false;
        this.enableInput();
      }
    };
    this.promptInput.onExit = () => { this.tui.stop(); process.exit(0); };
    this.updatePromptPrefix();
    this.tui.addChild(this.promptInput);

    // ── Start TUI (takes over terminal raw mode) ──────────────────────────
    this.tui.setFocus(this.promptInput);
    this.tui.start();
  }

  // ── Mode cycling ─────────────────────────────────────────────────────────

  private cycleMode(dir: 1 | -1): void {
    if (this.isRunning) return;
    const modes: Mode[] = ["WORK", "EXPLORE", "PLAN", "DEBUG"];
    const prev = this.mode;
    const idx = modes.indexOf(this.mode);
    this.mode = modes[((idx + dir) + modes.length) % modes.length]!;
    setCurrentMode(this.mode);
    this.contextBar.update({ mode: this.mode });
    this.updatePromptPrefix();
    this.addChatLine(`  ${clr.dim(`${clr.mode(prev)} → ${clr.mode(this.mode)}`)}`);
    this.tui.requestRender();
  }

  private updatePromptPrefix(): void {
    const prefix = `  ${clr.mode(`[${this.mode}]`)} ${clr.user("›")} `;
    const prefixW = 6 + this.mode.length; // visible width: "  [MODE] › "
    this.promptInput.setPrefix(prefix, prefixW);
    this.tui.requestRender?.();
  }

  // ── Input submission ──────────────────────────────────────────────────────

  private async onSubmit(value: string): Promise<void> {
    const input = value.trim();
    this.promptInput.clear();
    if (!input) return;

    if (input.startsWith("/")) {
      await this.handleSlash(input);
      this.tui.requestRender();
      return;
    }

    await this.runTurn(input);
  }

  // ── Agent turn ────────────────────────────────────────────────────────────

  private async runTurn(userMessage: string): Promise<void> {
    this.isRunning = true;
    this.disableInput();

    // User message block
    this.addChatLine("");
    this.addChatLine(`  ${clr.user("╭─ You " + "─".repeat(40))}`);
    this.addChatLine(`  ${clr.user("│")}  ${userMessage}`);
    this.addChatLine(`  ${clr.user("╰" + "─".repeat(46))}`);
    this.addChatLine("");

    this.streamingRaw = "";
    this.streamingText = null;
    this.thinkingRaw = "";
    this.thinkingText = null;
    this.thinkingOpen = false;

    const PHRASES = [
      "composing logic…", "traversing the AST…", "reasoning about types…",
      "consulting the docs…", "diffing reality…", "compiling intentions…",
      "thinking in packets…", "allocating neurons…", "parsing intent…",
      "connecting nodes…", "optimising thoughts…", "resolving dependencies…",
    ];
    let phraseIdx = 0;

    const events: LoopEvents = {
      onTurnStart: () => {
        this.loader.setMessage(PHRASES[0]!);
        this.loader.start();
        this.tui.requestRender();
      },
      onToken: (text) => {
        this.loader.stop();
        this.closeThinking();
        if (!this.streamingText) {
          this.streamingText = new Text("", 0, 0);
          this.chat.addChild(this.streamingText);
        }
        this.streamingRaw += text;
        this.streamingText.setText("  " + this.streamingRaw.replace(/\n/g, "\n  "));
        this.tui.requestRender();
      },
      onThinking: (text) => {
        this.loader.stop();
        if (!this.thinkingText) {
          const header = new Text(clr.dim("┌─ Thinking ──────────────────────────────────────────"), 0, 0);
          this.chat.addChild(header);
          this.thinkingText = new Text("", 0, 0);
          this.chat.addChild(this.thinkingText);
          this.thinkingOpen = true;
        }
        this.thinkingRaw += text;
        this.thinkingText.setText(
          this.thinkingRaw
            .split("\n")
            .map((l) => A.dim + "│ " + l + A.reset)
            .join("\n")
        );
        // Cycle phrase
        phraseIdx = (phraseIdx + 1) % PHRASES.length;
        this.loader.setMessage(PHRASES[phraseIdx]!);
        this.tui.requestRender();
      },
      onAdvisorStart: (model) => {
        this.loader.stop();
        const short = model.split("/").pop() ?? model;
        this.addChatLine(`  ${clr.dim(`[advisor • consulting ${short}…]`)}`);
        this.tui.requestRender();
      },
      onAdvisorToken: (_text) => { /* buffered */ },
      onAdvisorEnd: (summary) => {
        const raw = summary.trim();
        const oneliner = raw.split(/[.!?\n]/)[0]?.trim() ?? raw;
        const truncated = oneliner.length > 80 ? oneliner.slice(0, 77) + "…" : oneliner;
        // Replace last chat line with summary
        this.addChatLine(`  ${clr.dim(`[advisor: ${truncated}]`)}`);
        this.tui.requestRender();
      },
      onToolStart: (_id, name, args) => {
        this.loader.stop();
        this.closeThinking();
        if (this.streamingRaw) { this.addChatLine(""); this.streamingRaw = ""; this.streamingText = null; }
        const argStr = this.fmtArgs(args);
        this.addChatLine(`  ${A.fg(33, "▶")}  ${clr.tool(name)}  ${clr.dim(argStr)}`);
        this.loader.setMessage(`running ${name}…`);
        this.loader.start();
        this.tui.requestRender();
      },
      onToolEnd: (_id, _name, result, durationMs) => {
        this.loader.stop();
        const icon = result.success ? clr.success("✓") : clr.error("✗");
        const dur = clr.dim(`${durationMs}ms`);
        const lines = result.output.trim().split("\n");
        const preview = (lines[0] ?? "").slice(0, 65);
        const extra = lines.length > 1 ? clr.dim(` +${lines.length - 1} lines`) : "";
        this.addChatLine(`  ${icon}  ${clr.dim(preview)}${extra}  ${dur}`);
        if (!result.success && lines[1]) {
          this.addChatLine(`     ${clr.error(lines[1].slice(0, 70))}`);
        }
        this.tui.requestRender();
      },
      onPermissionRequest: (toolName, description, resolve) => {
        this.loader.stop();
        this.addChatLine(`  ${clr.warn("⚠")}  ${clr.tool(toolName)}  ${clr.dim(description)}`);
        this.addChatLine(`  ${clr.dim("[y]es  [n]o  [a]lways")}`);
        this.tui.requestRender();
        // Read a single keypress via stdin
        void this.readKey().then((k) => {
          const approved = k === "y" || k === "\r" || k === "a";
          const always   = k === "a";
          resolve(approved, always);
        });
      },
      onCompacting: () => {
        this.loader.stop();
        this.addChatLine(`  ${clr.warn("⟳")}  ${clr.dim("compacting context…")}`);
        this.loader.setMessage("compacting…");
        this.loader.start();
        this.tui.requestRender();
      },
      onCompacted: (removedCount) => {
        this.loader.stop();
        this.addChatLine(`  ${clr.success("✓")}  ${clr.dim(`compacted — removed ${removedCount} messages`)}`);
        this.tui.requestRender();
      },
      onTurnEnd: (usage) => {
        this.loader.stop();
        this.closeThinking();
        if (this.streamingRaw) { this.addChatLine(""); }
        this.streamingRaw = ""; this.streamingText = null;
        this.thinkingRaw = "";  this.thinkingText = null;

        this.contextTokens = usage.inputTokens;
        this.contextBar.update({
          contextTokens: usage.inputTokens,
          contextWindow: this.contextWindow,
          mode: this.mode,
          ...(usage.tokensPerSecond > 0 ? { tokensPerSecond: usage.tokensPerSecond } : {}),
          lastTurnMs: usage.durationMs,
        });

        this.addChatLine("");
        this.isRunning = false;
        this.enableInput();
        this.tui.requestRender();
      },
      onError: (err) => {
        this.loader.stop();
        this.addChatLine(`  ${clr.error("Error:")} ${err.message}`);
        this.isRunning = false;
        this.enableInput();
        this.tui.requestRender();
      },
    };

    await this.loop.run(userMessage, this.mode, events);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private addChatLine(text: string): void {
    this.chat.addChild(new Text(text, 0, 0));
  }

  private closeThinking(): void {
    if (this.thinkingOpen && this.thinkingText) {
      this.chat.addChild(new Text(clr.dim("└────────────────────────────────────────────────────"), 0, 0));
      this.chat.addChild(new Spacer(1));
      this.thinkingOpen = false;
    }
  }

  private disableInput(): void {
    this.promptInput.setPrefix(
      `  ${clr.dim(`[${this.mode}]`)} ${clr.dim("·")} `,
      6 + this.mode.length
    );
  }

  private enableInput(): void {
    this.updatePromptPrefix();
    this.tui.setFocus(this.promptInput);
  }

  private fmtArgs(args: Record<string, unknown>): string {
    const keys = ["path","filePath","file","command","pattern","description","prompt"];
    for (const k of keys) {
      if (typeof args[k] === "string") {
        const v = String(args[k]);
        return v.length > 55 ? v.slice(0, 52) + "…" : v;
      }
    }
    return Object.entries(args).slice(0, 1).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("").slice(0, 55);
  }

  /** Read a single raw keypress (used for permission prompts) */
  private readKey(): Promise<string> {
    return new Promise((resolve) => {
      const onData = (data: Buffer | string) => {
        process.stdin.removeListener("data", onData);
        resolve(data.toString().toLowerCase().trim());
      };
      process.stdin.once("data", onData);
    });
  }

  // ── Slash commands ────────────────────────────────────────────────────────

  private async handleSlash(input: string): Promise<void> {
    const parts = input.slice(1).trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? "";
    const arg = parts.slice(1).join(" ").trim();

    switch (cmd) {
      case "advisor": await this.cmdAdvisor(arg); break;
      case "mode":    this.cmdMode(arg);           break;
      case "new":
        await SessionManager.createNew(arg || undefined);
        this.addChatLine(`  ${clr.success("✓")} New session started`);
        break;
      case "clear":
        // Clear chat history (keep welcome)
        while ((this.chat as Container & { children?: Component[] }).children?.length) {
          break; // can't easily clear — just add a separator
        }
        this.addChatLine(clr.dim("─".repeat(60)));
        break;
      case "help": this.printHelp(); break;
      case "quit":
      case "exit":
        this.tui.stop();
        process.exit(0);
        break;
      default:
        this.addChatLine(`  ${clr.warn("?")} Unknown: /${cmd} — try /help`);
    }
  }

  private async cmdAdvisor(arg: string): Promise<void> {
    const config = await loadConfig();

    if (arg === "off") {
      const { advisorModel: _r, ...rest } = config;
      await saveConfig(rest as Config);
      this.advisorModel = undefined;
      this.contextBar.update({ workerModel: config.defaultModel, contextTokens: this.contextTokens,
        contextWindow: this.contextWindow, mode: this.mode });
      this.addChatLine(`  ${clr.success("✓")} Advisor disabled`);
      return;
    }

    if (arg === "on" || arg === "") {
      this.addChatLine(`  ${clr.bold("Advisor model")}  ${clr.dim("e.g. openrouter/anthropic/claude-opus-4.7")}`);
      this.addChatLine(`  ${clr.dim("Type the model string and press Enter:")}`);
      this.tui.requestRender();

      await new Promise<void>((resolve) => {
        const prev = this.promptInput.onSubmit;
        this.promptInput.onSubmit = (val) => {
          this.promptInput.clear();
          this.promptInput.onSubmit = prev;
          if (val.trim()) {
            config.advisorModel = val.trim();
            void saveConfig(config).then(() => {
              this.advisorModel = val.trim();
              this.contextBar.update({ advisorModel: val.trim() });
              this.addChatLine(`  ${clr.success("✓")} Advisor → ${val.trim()}`);
              this.tui.requestRender();
            });
          } else {
            this.addChatLine(`  ${clr.dim("Cancelled")}`);
          }
          resolve();
        };
      });
      return;
    }

    config.advisorModel = arg;
    await saveConfig(config);
    this.advisorModel = arg;
    this.contextBar.update({ advisorModel: arg });
    this.addChatLine(`  ${clr.success("✓")} Advisor → ${arg}`);
  }

  private cmdMode(arg: string): void {
    const modes: Mode[] = ["WORK", "EXPLORE", "PLAN", "DEBUG"];
    if (!arg) {
      this.addChatLine(`  mode: ${this.mode}  |  options: ${modes.join(" · ")}`);
      return;
    }
    const m = arg.toUpperCase() as Mode;
    if (modes.includes(m)) {
      const prev = this.mode;
      this.mode = m;
      setCurrentMode(m);
      this.contextBar.update({ mode: m });
      this.updatePromptPrefix();
      this.addChatLine(`  ${clr.dim(`${clr.mode(prev)} → ${clr.mode(m)}`)}`);
    } else {
      this.addChatLine(`  ${clr.error("✗")} Unknown mode. Options: ${modes.join(", ")}`);
    }
  }

  private printHelp(): void {
    const h = [
      "",
      `  ${clr.bold("Commands")}`,
      clr.dim("  ─────────────────────────────────────────"),
      `  ${clr.tool("/advisor on")}      ${clr.dim("Set advisor model")}`,
      `  ${clr.tool("/advisor off")}     ${clr.dim("Disable advisor")}`,
      `  ${clr.tool("/advisor <model>")} ${clr.dim("Set advisor directly")}`,
      `  ${clr.tool("/mode <MODE>")}     ${clr.dim("WORK · EXPLORE · PLAN · DEBUG")}`,
      `  ${clr.tool("/new [name]")}      ${clr.dim("Start new session")}`,
      `  ${clr.tool("/help")}            ${clr.dim("This message")}`,
      `  ${clr.tool("/exit")}            ${clr.dim("Quit")}`,
      "",
      `  ${clr.bold("Keyboard")}`,
      clr.dim("  ─────────────────────────────────────────"),
      `  ${clr.dim("Tab")}              ${clr.dim("Cycle mode forward")}`,
      `  ${clr.dim("Shift+Tab")}        ${clr.dim("Cycle mode backward")}`,
      `  ${clr.dim("Ctrl+C")}           ${clr.dim("Abort current turn")}`,
      `  ${clr.dim("Ctrl+D")}           ${clr.dim("Exit")}`,
      "",
    ];
    for (const line of h) this.addChatLine(line);
  }
}
