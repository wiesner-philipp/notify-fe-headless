"use strict";

const localeInfo = require("./data/locale_info.json");
const skuPatterns = require("./data/sku_patterns.json");

// Same GPU catalogue / default SKUs as the original notify-fe frontend.
const GPU_ORDER = ["5090", "5080", "5070", "4090", "4080S", "4070S"];

const DEFAULT_SKUS = {
  "5090": "NVGFT590",
  "5080": "NVGFT580",
  "5070": "NVGFT570",
  "4090": "NVGFT490",
  "4080S": "NVGFT480S",
  "4070S": "NVGFT470S",
};

const DEFAULT_INCLUDED_GPUS = ["5080", "5090"];

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const v = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return true;
  if (["false", "0", "no", "off"].includes(v)) return false;
  console.warn(
    `[config] Could not parse boolean from "${value}", using default (${fallback}).`,
  );
  return fallback;
}

// Accepts either a locale code ("de-de") or a country name ("Deutschland"),
// matching the same list the original UI's region dropdown used.
function resolveLocale(rawInput) {
  const input = (rawInput || "").trim();
  const codes = Object.values(localeInfo);
  if (!input) return "en-gb";

  const lower = input.toLowerCase();
  if (codes.includes(lower)) return lower;

  const nameMatch = Object.entries(localeInfo).find(
    ([name]) => name.toLowerCase() === lower,
  );
  if (nameMatch) return nameMatch[1];

  const available = Object.entries(localeInfo)
    .map(([name, code]) => `${name} (${code})`)
    .join(", ");
  throw new Error(`Unknown COUNTRY "${rawInput}". Use one of: ${available}`);
}

function resolveGpuModels(rawInput) {
  const input = (rawInput || DEFAULT_INCLUDED_GPUS.join(",")).trim();
  const requested = input
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  const valid = requested.filter((g) => GPU_ORDER.includes(g));
  const invalid = requested.filter((g) => !GPU_ORDER.includes(g));

  if (invalid.length > 0) {
    console.warn(
      `[config] Ignoring unknown GPU model(s) in GPU_MODELS: ${invalid.join(", ")}. Valid options: ${GPU_ORDER.join(", ")}`,
    );
  }
  if (valid.length === 0) {
    throw new Error(
      `No valid GPU models configured. Valid options: ${GPU_ORDER.join(", ")}`,
    );
  }
  return valid;
}

function resolveInterval(rawInput) {
  const parsed = parseInt(rawInput ?? "30", 10);
  const value = Number.isFinite(parsed) ? parsed : 30;
  if (value < 5) {
    console.warn(
      `[config] REFRESH_INTERVAL_SECONDS=${value} is very low and risks getting rate-limited by NVIDIA. Clamping to 5s.`,
    );
    return 5;
  }
  return value;
}

const NTFY_PRIORITIES = ["min", "low", "default", "high", "max", "urgent"];

function resolveNtfyPriority(rawInput) {
  const input = (rawInput || "").trim().toLowerCase();
  if (!input) return "";
  if (NTFY_PRIORITIES.includes(input)) return input;
  console.warn(
    `[config] Unknown NTFY_PRIORITY "${rawInput}", ignoring it. Valid values: ${NTFY_PRIORITIES.join(", ")}.`,
  );
  return "";
}

function loadConfig(env = process.env) {
  const locale = resolveLocale(env.COUNTRY);
  const gpuModels = resolveGpuModels(env.GPU_MODELS);
  const refreshIntervalSeconds = resolveInterval(env.REFRESH_INTERVAL_SECONDS);
  const apiDownAlarmEnabled = parseBool(env.API_DOWN_ALARM_ENABLED, true);
  const telegramApiUrl = (env.TELEGRAM_API_URL || "").trim();
  const discordWebhookUrl = (env.DISCORD_WEBHOOK_URL || "").trim();
  const ntfyUrl = (env.NTFY_URL || "").trim();
  const ntfyToken = (env.NTFY_TOKEN || "").trim();
  const ntfyPriority = resolveNtfyPriority(env.NTFY_PRIORITY);
  const skuFeedUrl = (env.SKU_FEED_URL || "").trim();
  const port = parseInt(env.PORT ?? "8080", 10) || 8080;

  return {
    locale,
    gpuModels,
    refreshIntervalSeconds,
    apiDownAlarmEnabled,
    telegramApiUrl,
    discordWebhookUrl,
    ntfyUrl,
    ntfyToken,
    ntfyPriority,
    skuFeedUrl,
    port,
  };
}

module.exports = {
  loadConfig,
  localeInfo,
  skuPatterns,
  GPU_ORDER,
  DEFAULT_SKUS,
};
