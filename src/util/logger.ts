import { Global } from "../global";
import fs from "fs/promises";
import path from "path";

type LogLevel = "debug" | "info" | "warn" | "error";

const logPath = path.join(Global.Path.logs, "glm-cli.log");

const REDACTED_PATTERNS = [
  /["']?api[_-]?key["']?\s*[:=]\s*/gi,
  /["']?bearer["']?\s*[:=]\s*/gi,
  /["']?authorization["']?\s*[:=]\s*/gi,
];

function redactSensitiveData(message: string): string {
  let redacted = message;
  for (const pattern of REDACTED_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function getTimestamp(): string {
  const now = new Date();
  return now.toISOString();
}

async function ensureLogFile(): Promise<void> {
  try {
    await fs.mkdir(Global.Path.logs, { recursive: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
      throw e;
    }
  }
}

function formatLogEntry(level: LogLevel, message: string): string {
  const timestamp = getTimestamp();
  const redactedMessage = redactSensitiveData(message);
  return `[${timestamp}] [${level.toUpperCase()}] ${redactedMessage}`;
}

async function writeToLogFile(entry: string): Promise<void> {
  await ensureLogFile();
  await fs.appendFile(logPath, entry + "\n", "utf-8");
}

let currentLogLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLogLevel];
}

export async function debug(message: string): Promise<void> {
  if (!shouldLog("debug")) return;
  const entry = formatLogEntry("debug", message);
  await writeToLogFile(entry);
  console.debug(message);
}

export async function info(message: string): Promise<void> {
  if (!shouldLog("info")) return;
  const entry = formatLogEntry("info", message);
  await writeToLogFile(entry);
  console.log(message);
}

export async function warn(message: string): Promise<void> {
  if (!shouldLog("warn")) return;
  const entry = formatLogEntry("warn", message);
  await writeToLogFile(entry);
  console.warn(message);
}

export async function error(message: string): Promise<void> {
  if (!shouldLog("error")) return;
  const entry = formatLogEntry("error", message);
  await writeToLogFile(entry);
  console.error(message);
}

export type { LogLevel };

