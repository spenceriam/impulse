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
import packageJson from "../../package.json";

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

// ANSI color per mode — used for ❯ arrow and context bar mode label
const MODE_COLORS: Record<string, number> = {
  WORK: 34, EXPLORE: 32, PLAN: 33, DEBUG: 31,
};

// ── PromptInput: wraps pi-tui Input, intercepts special keys ─────────────────

class PromptInput implements Component, Focusable {
  focused = false;

  private inner = new Input();
  private _modeColorCode = 34; // ANSI color code for the ❯ arrow (matches mode)
  // Paste state
  private _pasteContent: string | null = null;
  private _isPasting = false;
  private _pasteBuffer = "";

  onTabForward?:  () => void;
  onTabBackward?: () => void;
  onAbort?:       () => void;
  onExit?:        () => void;
  onChange?:      (value: string) => void;

  setModeColor(code: number): void { this._modeColorCode = code; }

  get onSubmit() { return this.inner.onSubmit; }
  set onSubmit(fn: ((v: string) => void) | undefined) {
    if (fn !== undefined) this.inner.onSubmit = fn;
    else this.inner.onSubmit = undefined as unknown as (value: string) => void;
  }

  /** Returns the real value (actual paste content if applicable) */
  getSubmitValue(): string {
    return this._pasteContent ?? this.inner.getValue();
  }

  clear(): void {
    this.inner.setValue("");
    this._pasteContent = null;
    this._isPasting = false;
    this._pasteBuffer = "";
  }

  handleInput(data: string): void {
    if (data === "\t")     { this.onTabForward?.();  return; }
    if (data === "\x1b[Z") { this.onTabBackward?.(); return; }
    if (data === "\x03")   { this.onAbort?.();        return; }
    if (data === "\x04")   { this.onExit?.();         return; }

    // ── Bracketed paste detection ──────────────────────────────────────────
    const hasPasteStart = data.includes("\x1b[200~");
    const hasPasteEnd   = data.includes("\x1b[201~");

    if (hasPasteStart) {
      this._isPasting = true;
      const afterStart = data.slice(data.indexOf("\x1b[200~") + 6);
      const content    = hasPasteEnd
        ? afterStart.slice(0, afterStart.indexOf("\x1b[201~"))
        : afterStart;
      this._pasteBuffer = content;

      if (hasPasteEnd) this._finalizePaste();
      return;
    }

    if (this._isPasting) {
      if (hasPasteEnd) {
        this._pasteBuffer += data.slice(0, data.indexOf("\x1b[201~"));
        this._finalizePaste();
      } else {
        this._pasteBuffer += data;
      }
      return;
    }

    // If user starts typing after a paste, clear the stored content
    if (this._pasteContent !== null) this._pasteContent = null;

    this.inner.handleInput(data);
    this.onChange?.(this.inner.getValue());
  }

  private _finalizePaste(): void {
    this._isPasting = false;
    const content = this._pasteBuffer;
    this._pasteBuffer = "";
    const lines = content.split("\n").filter((l) => l.length > 0);

    if (lines.length > 1) {
      // Multi-line paste — show indicator, store real content
      this._pasteContent = content;
      this.inner.setValue(`[Pasted ${lines.length} lines  ${content.length} chars]`);
    } else if (content.length > 120) {
      // Long single-line paste — show indicator
      this._pasteContent = content;
      this.inner.setValue(`[Pasted ${content.length} chars]`);
    } else {
      // Short paste — insert normally
      this._pasteContent = null;
      this.inner.handleInput("\x1b[200~" + content + "\x1b[201~");
    }
  }

  invalidate(): void { this.inner.invalidate(); }

  render(width: number): string[] {
    // pi-tui Input ALWAYS renders "> " (2 chars) as its own prompt prefix.
    // We strip it and replace with our mode-colored ❯ .
    // Pass full width so content area = width - 2 (matching the "> " overhead).
    const innerLines = this.inner.render(width);
    const firstLine = innerLines[0] ?? "";
    // Strip Input's hardcoded "> " prefix
    const content = firstLine.startsWith("> ") ? firstLine.slice(2) : firstLine;
    const ARROW = `  \x1b[${this._modeColorCode}m\u276f\x1b[0m `;
    return [ARROW + content, ...innerLines.slice(1).map((l) => "    " + l)];
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
  private spinnerText!: Text;
  private contextBar!: ContextBarComponent;
  private promptInput!: PromptInput;
  private autocompleteText!: Text; // slash command suggestions

  // Manual spinner — avoids Loader auto-start issues
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerMsg = "";
  private spinnerIdx = 0;
  private readonly SPIN_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];

  private spinStart(msg: string): void {
    this.spinnerMsg = msg;
    this.spinnerText.setText(`  ${A.dim}${this.SPIN_FRAMES[0]!}  ${msg}${A.reset}`);
    this.tui.requestRender();
    if (this.spinnerInterval) return;
    this.spinnerIdx = 0;
    this.spinnerInterval = setInterval(() => {
      this.spinnerIdx = (this.spinnerIdx + 1) % this.SPIN_FRAMES.length;
      this.spinnerText.setText(`  ${A.dim}${this.SPIN_FRAMES[this.spinnerIdx]!}  ${this.spinnerMsg}${A.reset}`);
      this.tui.requestRender();
    }, 80);
  }
  private spinStop(): void {
    if (this.spinnerInterval) { clearInterval(this.spinnerInterval); this.spinnerInterval = null; }
    this.spinnerText.setText("");
    this.tui.requestRender();
  }

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

    // Welcome header
    this.chat.addChild(new Spacer(1));
    this.chat.addChild(new Text(
      `  ${clr.bold("IMPULSE")} ${A.dim}|${A.reset} cli coding agent ${A.dim}|${A.reset} ${A.fg(90, "v" + (packageJson as {version:string}).version)}`,
      0, 0
    ));
    this.chat.addChild(new Text(
      `  ${A.fg(90, "Tab/Shift-Tab: mode  ·  /help: commands  ·  Ctrl+C: abort  ·  Ctrl+D: exit")}`,
      0, 0
    ));
    this.chat.addChild(new Text(A.dim + "─".repeat(60) + A.reset, 0, 0));
    this.chat.addChild(new Spacer(1));

    // 2. Spinner — plain Text, manually animated via setInterval in spinStart/spinStop
    this.spinnerText = new Text("", 0, 0);
    this.tui.addChild(this.spinnerText);

    // 3. Separator ABOVE input
    this.tui.addChild(new SeparatorLine());

    // Slash command autocomplete — shown only when input starts with /
    this.autocompleteText = new Text("", 0, 0);
    this.tui.addChild(this.autocompleteText);

    // 4. Prompt input (just › , no mode label)
    this.promptInput = new PromptInput();
    this.promptInput.onSubmit = (_displayedValue) => {
      const actual = this.promptInput.getSubmitValue();
      this.promptInput.clear();
      void this.onSubmit(actual);
    };
    this.promptInput.onTabForward  = () => this.cycleMode(1);
    this.promptInput.onTabBackward = () => this.cycleMode(-1);
    this.promptInput.onAbort = () => {
      if (this.isRunning) {
        this.loop.abort();
        this.spinStop();
        this.addChatLine(`  ${clr.warn("⊘")}  ${clr.dim("aborted")}`);
        this.isRunning = false;
      } else {
        // Ctrl+C while idle = exit with stats
        this.showExitStats();
        this.tui.stop();
        process.exit(0);
      }
    };
    this.promptInput.onExit = () => { this.showExitStats(); this.tui.stop(); process.exit(0); };
    this.promptInput.onChange = (val) => this.updateAutocomplete(val);
    this.tui.addChild(this.promptInput);

    // 5. Separator BELOW input
    this.tui.addChild(new SeparatorLine());

    // 6. Context bar — sticky absolute bottom
    this.contextBar = new ContextBarComponent({
      workerModel: config.defaultModel,
      contextTokens: 0,
      contextWindow: this.contextWindow,
      mode: this.mode,
      ...(this.advisorModel ? { advisorModel: this.advisorModel } : {}),
    });
    this.tui.addChild(this.contextBar);

    // ── Start TUI (takes over terminal raw mode) ──────────────────────────
    this.syncModeColor(); // set initial arrow color
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
    this.syncModeColor();
    this.addChatLine(`  ${A.fg(MODE_COLORS[prev] ?? 34, prev)} → ${A.fg(MODE_COLORS[this.mode] ?? 34, this.mode)}`);
    this.tui.requestRender();
  }

  private syncModeColor(): void {
    this.promptInput.setModeColor(MODE_COLORS[this.mode] ?? 34);
  }


  // ── Input submission ──────────────────────────────────────────────────────

  private async onSubmit(value: string): Promise<void> {
    const input = value.trim();
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


    // User message block
    this.addChatLine("");
    this.addChatLine(`  ${A.fg(36, "you")}`);
    this.addChatLine(`  ${userMessage}`);
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
        this.spinStart(PHRASES[0]!);
      },
      onToken: (text) => {
        this.spinStop();
        this.closeThinking();
        if (!this.streamingText) {
          // Add impulse response header on first token
          this.chat.addChild(new Spacer(1));
          this.chat.addChild(new Text(`  ${A.dim}impulse${A.reset}`, 0, 0));
          this.streamingText = new Text("", 0, 0);
          this.chat.addChild(this.streamingText);
        }
        this.streamingRaw += text;
        this.streamingText.setText("  " + this.streamingRaw.replace(/\n/g, "\n  "));
        this.tui.requestRender();
      },
      onThinking: (text) => {
        this.spinStop();
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
        this.spinStart(PHRASES[phraseIdx]!);
        this.tui.requestRender();
      },
      onAdvisorStart: (model) => {
        this.spinStop();
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
        this.spinStop();
        this.closeThinking();
        if (this.streamingRaw) { this.addChatLine(""); this.streamingRaw = ""; this.streamingText = null; }
        const argStr = this.fmtArgs(args);
        this.addChatLine(`  ${A.fg(33, "▶")}  ${clr.tool(name)}  ${clr.dim(argStr)}`);
        this.spinStart(`running ${name}…`);
        this.tui.requestRender();
      },
      onToolEnd: (_id, _name, result, durationMs) => {
        this.spinStop();
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
        this.spinStop();
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
        this.spinStop();
        this.addChatLine(`  ${clr.warn("⟳")}  ${clr.dim("compacting context…")}`);
        this.spinStart("compacting…");
        this.tui.requestRender();
      },
      onCompacted: (removedCount) => {
        this.spinStop();
        this.addChatLine(`  ${clr.success("✓")}  ${clr.dim(`compacted — removed ${removedCount} messages`)}`);
        this.tui.requestRender();
      },
      onTurnEnd: (usage) => {
        this.spinStop();
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
        this.chat.addChild(new Spacer(1));
        this.isRunning = false;
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
      },
      onError: (err) => {
        this.spinStop();
        this.addChatLine(`  ${clr.error("Error:")} ${err.message}`);
        this.isRunning = false;
        this.tui.setFocus(this.promptInput);
        this.tui.requestRender();
      },
    };

    await this.loop.run(userMessage, this.mode, events);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private addChatLine(text: string): void {
    this.chat.addChild(new Text(text, 0, 0));
  }

  // ── Slash autocomplete ────────────────────────────────────────────────────

  private readonly SLASH_CMDS = [
    { cmd: "/advisor",  hint: "on | off | <model>  set advisor" },
    { cmd: "/mode",     hint: "WORK | EXPLORE | PLAN | DEBUG" },
    { cmd: "/new",      hint: "[name]  start new session" },
    { cmd: "/help",     hint: "show commands" },
    { cmd: "/clear",    hint: "clear screen" },
    { cmd: "/exit",     hint: "quit" },
    { cmd: "/quit",     hint: "quit" },
  ];

  private updateAutocomplete(val: string): void {
    if (!val.startsWith("/") || val.length < 1) {
      this.autocompleteText.setText("");
      this.tui.requestRender();
      return;
    }
    const matches = this.SLASH_CMDS.filter((c) =>
      c.cmd.startsWith(val.split(" ")[0]!.toLowerCase())
    );
    if (matches.length === 0) {
      this.autocompleteText.setText("");
    } else {
      const lines = matches
        .map((m) => `  ${A.fg(36, m.cmd)}  ${A.fg(90, m.hint)}`)
        .join("\n");
      this.autocompleteText.setText(lines);
    }
    this.tui.requestRender();
  }

  // ── Exit stats ────────────────────────────────────────────────────────────

  private showExitStats(): void {
    const session = SessionManager.getCurrentSession();
    if (!session) return;
    const msgs    = session.messages.length;
    const turns   = session.messages.filter((m) => m.role === "user").length;
    const created = new Date(session.created_at);
    const now     = new Date();
    const diffMs  = now.getTime() - created.getTime();
    const mins    = Math.floor(diffMs / 60000);
    const dur     = mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`;
    this.addChatLine("");
    this.addChatLine(`  ${clr.dim("─".repeat(46))}`);
    this.addChatLine(`  ${clr.bold("Session summary")}`  );
    this.addChatLine(`  ${clr.dim("session")}   ${session.name}`);
    this.addChatLine(`  ${clr.dim("duration")}  ${dur}`);
    this.addChatLine(`  ${clr.dim("turns")}     ${turns}`);
    this.addChatLine(`  ${clr.dim("messages")}  ${msgs}`);
    this.addChatLine(`  ${clr.dim("model")}     ${session.model || "(none)"}`);
    this.addChatLine(`  ${clr.dim("─".repeat(46))}`);
    this.addChatLine("");
    this.tui.requestRender();
  }

  private closeThinking(): void {
    if (this.thinkingOpen && this.thinkingText) {
      this.chat.addChild(new Text(clr.dim("└────────────────────────────────────────────────────"), 0, 0));
      this.chat.addChild(new Spacer(1));
      this.thinkingOpen = false;
    }
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
        this.showExitStats();
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
