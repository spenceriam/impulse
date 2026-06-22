import { z } from "zod";
import { Tool, ToolResult } from "./registry";
import { load as loadConfig, isModelConfigured } from "../util/config.js";

const DESCRIPTION = `Run lightweight Impulse configuration diagnostics.

Checks provider/model configuration without making network calls.`;

const DoctorSchema = z.object({
  includeEnv: z.boolean().optional().describe("Include provider environment variable hints"),
});

type DoctorInput = z.infer<typeof DoctorSchema>;

const PROVIDER_ENV_VARS: Record<string, string[]> = {
  "z.ai": ["ZAI_API_KEY", "GLM_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  nous: ["NOUS_API_KEY"],
  ollama: ["OLLAMA_API_KEY"],
};

export const doctorTool: Tool<DoctorInput> = Tool.define(
  "doctor",
  DESCRIPTION,
  DoctorSchema,
  async (input: DoctorInput): Promise<ToolResult> => {
    const config = await loadConfig();
    const providers = config.providers as Record<string, { apiKey?: string; baseUrl?: string; type?: string } | undefined>;
    const configured = Object.entries(providers)
      .filter(([, value]) => Boolean(value?.apiKey || value?.baseUrl))
      .map(([key, value]) => {
        const bits = [
          value?.apiKey ? "apiKey" : null,
          value?.baseUrl ? `baseUrl=${value.baseUrl}` : null,
          value?.type ? `type=${value.type}` : null,
        ].filter(Boolean);
        return `- ${key}: ${bits.join(", ") || "present"}`;
      });

    const lines = [
      "Impulse diagnostics",
      "",
      `Default provider: ${config.defaultProvider || "(not set)"}`,
      `Default model: ${config.defaultModel || "(not set)"}`,
      `Model configured: ${isModelConfigured(config) ? "yes" : "no"}`,
      `Reasoning level: ${config.reasoningLevel}`,
      `Max output tokens: ${config.maxOutputTokens}`,
      "",
      configured.length > 0
        ? `Configured providers:\n${configured.join("\n")}`
        : "Configured providers: none",
    ];

    if (input.includeEnv) {
      const envLines = Object.entries(PROVIDER_ENV_VARS).map(([provider, keys]) => {
        const present = keys.filter((key) => Boolean(process.env[key]));
        return `- ${provider}: ${present.length > 0 ? present.join(", ") : "(none)"}`;
      });
      lines.push("", `Provider env vars:\n${envLines.join("\n")}`);
    }

    const warnings: string[] = [];
    if (!isModelConfigured(config)) {
      warnings.push("Run /model or --setup to choose a provider and model.");
    }
    if (!providers[config.defaultProvider]?.apiKey && !providers[config.defaultProvider]?.baseUrl) {
      warnings.push(`Default provider "${config.defaultProvider}" is not configured in config providers.`);
    }
    if (warnings.length > 0) {
      lines.push("", `Warnings:\n${warnings.map((w) => `- ${w}`).join("\n")}`);
    }

    return {
      success: warnings.length === 0,
      output: lines.join("\n"),
      metadata: {
        defaultProvider: config.defaultProvider,
        defaultModel: config.defaultModel,
        configuredProviders: configured.length,
        warnings,
      },
    };
  }
);
