// Resolves the active AI provider configuration from store settings, with
// legacy single-key migration and per-provider env fallbacks.
import type { AIProvider, Settings } from "../types";
import { getClaudeCliToken } from "./claude-cli-auth";

export interface ResolvedAIConfig {
  enabled: boolean;
  provider: AIProvider;
  apiKey: string;
  model: string;
  cliToken?: string;
}

const ENV_KEYS: Record<AIProvider, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

const ENV_MODELS: Record<AIProvider, string> = {
  gemini: "GEMINI_MODEL",
  openai: "OPENAI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
};

const DEFAULT_MODELS: Record<AIProvider, string> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
};

const PROVIDERS: AIProvider[] = ["gemini", "openai", "anthropic"];

export function normalizeProvider(value: unknown): AIProvider {
  return PROVIDERS.includes(value as AIProvider) ? (value as AIProvider) : "gemini";
}

export function resolveAIConfig(settings: Settings): ResolvedAIConfig {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = settings.ai as unknown as Record<string, any>;
  const fallback: ResolvedAIConfig = {
    enabled: false,
    provider: "gemini",
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || DEFAULT_MODELS.gemini,
  };
  if (!ai) return fallback;

  const enabled = Boolean(ai.enabled);
  const provider = normalizeProvider(ai.provider);

  // New multi-provider shape.
  const providers = ai.providers as Record<string, { apiKey?: string; model?: string }> | undefined;
  if (providers && providers[provider]) {
    const cfg = providers[provider];
    return {
      enabled,
      provider,
      apiKey: cfg.apiKey || process.env[ENV_KEYS[provider]] || "",
      model: cfg.model || process.env[ENV_MODELS[provider]] || DEFAULT_MODELS[provider],
    };
  }

  // Legacy shape ({ apiKey, model }) → treat as gemini.
  return {
    enabled,
    provider: "gemini",
    apiKey: (ai.apiKey as string) || process.env.GEMINI_API_KEY || "",
    model: (ai.model as string) || process.env.GEMINI_MODEL || DEFAULT_MODELS.gemini,
  };
}
