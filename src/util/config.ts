import { Global } from "../global";
import fs from "fs/promises";
import path from "path";
import z from "zod";

const ConfigSchema = z.object({
  apiKey: z.string().optional().describe("Z.AI API key for authentication"),
  defaultModel: z.string().default("glm-4.7").describe("Default GLM model to use"),
  defaultMode: z.string().default("AUTO").describe("Default mode: AUTO, AGENT, PLANNER, PLAN-PRD, DEBUG"),
  thinking: z.boolean().default(true).describe("Enable thinking mode"),
});

type Config = z.infer<typeof ConfigSchema>;

const configPath = path.join(Global.Path.config, "config.json");

async function loadConfigFile(): Promise<Partial<Config>> {
  try {
    const content = await fs.readFile(configPath, "utf-8");
    return JSON.parse(content);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
    return {};
  }
}

async function loadEnvVars(): Promise<Partial<Config>> {
  const env: Partial<Config> = {};

  if (process.env["GLM_API_KEY"]) {
    env.apiKey = process.env["GLM_API_KEY"];
  }

  return env;
}

function applyDefaults(config: Partial<Config>): Config {
  return ConfigSchema.parse({
    apiKey: config.apiKey,
    defaultModel: config.defaultModel,
    defaultMode: config.defaultMode,
    thinking: config.thinking,
  });
}

let cachedConfig: Config | null = null;

export async function load(): Promise<Config> {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const fileConfig = await loadConfigFile();
  const envConfig = await loadEnvVars();
  const merged = { ...fileConfig, ...envConfig };
  cachedConfig = applyDefaults(merged);
  return cachedConfig;
}

export async function save(config: Config): Promise<void> {
  await fs.mkdir(Global.Path.config, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  cachedConfig = config;
}

export type { Config };
