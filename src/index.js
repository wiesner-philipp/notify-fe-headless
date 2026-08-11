"use strict";

const http = require("http");
const { loadConfig, skuPatterns, DEFAULT_SKUS } = require("./config");

const NVIDIA_API_BASE =
  "https://api.store.nvidia.com/partner/v1/feinventory?skus=";
const SKU_FEED_MIN_INTERVAL_MS = 15000;

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`[fatal] ${err.message}`);
  process.exit(1);
}

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}
function warn(...args) {
  console.warn(`[${new Date().toISOString()}]`, ...args);
}
function logError(...args) {
  console.error(`[${new Date().toISOString()}]`, ...args);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- SKU resolution ---------------------------------------------------
//
// SKUs occasionally change on NVIDIA's side. The original frontend pulled a
// live-updated SKU table from the maintainer's own Cloudflare R2 bucket.
// That's a personal, rate-limited resource of the upstream project, so this
// headless service does NOT hit it by default -- it relies on the static
// SKU table below (copied from the upstream repo) plus the built-in
// defaults. If you want live SKU updates, opt in via SKU_FEED_URL (see
// README) and please be considerate of the upstream maintainer's resources.

let dynamicSkuData = null;

async function refreshSkuFeed() {
  if (!config.skuFeedUrl) return;
  try {
    const sep = config.skuFeedUrl.includes("?") ? "&" : "?";
    const res = await fetchWithTimeout(
      `${config.skuFeedUrl}${sep}nocache=${Date.now()}`,
      {},
      5000,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    dynamicSkuData = await res.json();
    log(`SKU feed refreshed from ${config.skuFeedUrl}`);
  } catch (err) {
    warn(
      `Failed to refresh SKU feed: ${err.message}. Keeping previously known SKUs.`,
    );
  }
}

function getSku(gpuName) {
  const dynamic = dynamicSkuData?.[config.locale]?.[gpuName]?.sku;
  const pattern = skuPatterns[gpuName]?.[config.locale]?.[0];
  return dynamic || pattern || DEFAULT_SKUS[gpuName];
}

// --- Telegram -----------------------------------------------------------

async function sendTelegramNotification(message) {
  if (!config.telegramApiUrl) return;
  try {
    const url = new URL(config.telegramApiUrl);
    url.searchParams.set("text", `Notify-FE Alarm: ${message}`);
    const res = await fetchWithTimeout(url.toString(), {}, 5000);
    if (!res.ok) {
      logError(`Telegram notification failed with HTTP ${res.status}`);
    }
  } catch (err) {
    logError(`Telegram notification error: ${err.message}`);
  }
}

// --- GPU polling ----------------------------------------------------------

const gpuState = new Map(); // name -> { available, apiReachable }
for (const name of config.gpuModels) {
  gpuState.set(name, { available: false, apiReachable: false });
}

async function pollGpu(gpuName) {
  const sku = getSku(gpuName);
  const url = `${NVIDIA_API_BASE}${sku}&locale=${config.locale}`;
  const prev = gpuState.get(gpuName);

  let apiReachable = false;
  let apiError = false;
  let isActive = false;
  let productUrl = null;

  try {
    const res = await fetchWithTimeout(url, {}, 5000);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const listMap = Array.isArray(data.listMap) ? data.listMap : [];
    apiReachable = listMap.length > 0 && "is_active" in (listMap[0] ?? {});
    isActive = listMap.some((item) => item.is_active === "true");
    productUrl = listMap[0]?.product_url ?? null;
  } catch (err) {
    // Network error / timeout / non-200 -- treated as a transient API error,
    // distinct from a structurally "unreachable" (empty/malformed) response.
    // This mirrors the upstream frontend's distinction so the down-alarm
    // doesn't fire on every blip.
    apiError = true;
    apiReachable = false;
  }

  if (!prev.available && isActive) {
    const msg = `🎯 ${gpuName} is now in stock! ${productUrl ?? ""}`.trim();
    log(msg);
    void sendTelegramNotification(msg);
  } else if (prev.available && !isActive) {
    log(`${gpuName} is no longer in stock (${config.locale}).`);
  }

  if (
    config.apiDownAlarmEnabled &&
    prev.apiReachable &&
    !apiReachable &&
    !apiError
  ) {
    const msg = `⚠️ API became unreachable for ${gpuName}`;
    warn(msg);
    void sendTelegramNotification(msg);
  } else if (
    config.apiDownAlarmEnabled &&
    !prev.apiReachable &&
    apiReachable
  ) {
    const msg = `✅ API is reachable again for ${gpuName}`;
    log(msg);
    void sendTelegramNotification(msg);
  }

  gpuState.set(gpuName, { available: isActive, apiReachable });
}

async function pollAll() {
  await Promise.all(
    config.gpuModels.map((name) =>
      pollGpu(name).catch((err) =>
        logError(`Unhandled error polling ${name}: ${err.message}`),
      ),
    ),
  );
}

// --- Health endpoint ------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        locale: config.locale,
        gpuModels: config.gpuModels,
        state: Object.fromEntries(gpuState),
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

// --- Startup / shutdown ----------------------------------------------------

let pollTimer;
let skuFeedTimer;

async function start() {
  log("Starting notify-fe headless service");
  log(`  Country/locale        : ${config.locale}`);
  log(`  GPU models            : ${config.gpuModels.join(", ")}`);
  log(`  Refresh interval      : ${config.refreshIntervalSeconds}s`);
  log(
    `  API down alarm        : ${config.apiDownAlarmEnabled ? "enabled" : "disabled"}`,
  );
  log(
    `  Telegram notifications: ${config.telegramApiUrl ? "enabled" : "disabled"}`,
  );
  log(
    `  Dynamic SKU feed      : ${config.skuFeedUrl ? config.skuFeedUrl : "disabled (using static SKU table)"}`,
  );

  server.listen(config.port, () =>
    log(`Health endpoint listening on :${config.port}/healthz`),
  );

  if (config.skuFeedUrl) {
    await refreshSkuFeed();
    skuFeedTimer = setInterval(refreshSkuFeed, SKU_FEED_MIN_INTERVAL_MS);
  }

  await pollAll();
  pollTimer = setInterval(
    () => void pollAll(),
    config.refreshIntervalSeconds * 1000,
  );
}

function shutdown(signal) {
  log(`Received ${signal}, shutting down.`);
  clearInterval(pollTimer);
  clearInterval(skuFeedTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

void start();
