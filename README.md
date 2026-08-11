# notify-fe-headless

A headless, Docker-friendly port of [jlplenio/notify-fe](https://github.com/jlplenio/notify-fe).
It runs the same NVIDIA Founders Edition stock-checking logic as the original web app, but as a background service configured entirely through environment variables — no browser, no UI.

It polls NVIDIA's public store API for the GPU models you choose, and sends a Notification when a card comes into stock (and, optionally, when the API itself goes down or recovers).

This does **not** include the original Next.js frontend — it's a small, dependency-free Node.js process (~250 lines) built for running unattended in a container.

## Configuration (environment variables)

| Variable                    | Default            | Description |
|------------------------------|---------------------|-------------|
| `COUNTRY`                    | `de-de`   | Country name or locale code. Accepts either, e.g. `Deutschland` or `de-de`. See the table below for valid values. |
| `REFRESH_INTERVAL_SECONDS`   | `30`                | How often to poll NVIDIA's API, in seconds. Values below 5 are clamped to 5 with a warning — going much lower risks getting rate-limited. |
| `API_DOWN_ALARM_ENABLED`     | `true`              | `true`/`false`. Sends a Telegram alert when the API becomes unreachable (and when it recovers). |
| `TELEGRAM_API_URL`           | *(empty = disabled)*| Telegram Bot API URL, without `text`/`parse_mode` params: `https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>`. See [setup guide](https://gist.github.com/nafiesl/4ad622f344cd1dc3bb1ecbe468ff9f8a). |
| `DISCORD_WEBHOOK_URL`        | *(empty = disabled)*| Discord incoming webhook URL: `https://discord.com/api/webhooks/<ID>/<TOKEN>`. Create one under a channel's Settings → Integrations → Webhooks. |
| `GPU_MODELS`                 | `5080,5090`         | Comma-separated list of models to monitor. Valid: `5090,5080,5070,4090,4080S,4070S`. |
| `SKU_FEED_URL`                | *(empty = disabled)*| Optional URL to a live SKU-update feed. See "About SKU freshness" below. |
| `PORT`                        | `8080`               | Port for the `/healthz` endpoint. |

### Valid `COUNTRY` values
| Country | Code |
|---|---|
| Deutschland | `de-de` |
| United States | `en-us` |
| United Kingdom | `en-gb` |
| Australia | `en-au` |
| Austria | `de-at` |
| Belgique | `fr-be` |
| Česká Republika | `cs-cz` |
| Danmark | `da-dk` |
| España | `es-es` |
| France | `fr-fr` |
| India | `en-in` |
| Italia | `it-it` |
| 한국 | `ko-kr` |
| Nederlands | `nl-nl` |
| Norge | `nb-no` |
| Polska | `pl-pl` |
| Россия | `ru-ru` |
| Romania | `ro-ro` |
| Suomi | `fi-fi` |
| Sverige | `sv-se` |
| Türkiye | `tr-tr` |

The service validates `COUNTRY` on startup and exits with a clear error (listing all valid values) if it doesn't recognize the input — check `docker logs` if the container exits immediately.

## Running with Docker

```bash
docker run -d --name notify-fe \
  -e COUNTRY="de-de" \
  -e REFRESH_INTERVAL_SECONDS=30 \
  -e API_DOWN_ALARM_ENABLED=true \
  -e TELEGRAM_API_URL="https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>" \
  -e DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/<ID>/<TOKEN>" \
  -e GPU_MODELS="5080,5090" \
  -p 8080:8080 \
  ghcr.io/wiesner-philipp/notify-fe-headless:latest
```

## Running with Docker Compose

Edit the .env File to your likings, then:

```bash
docker compose up -d
```

## Health check

The container exposes `GET /healthz` on `PORT` (default `8080`), returning the current configuration and last-known state of each monitored GPU:

```bash
curl http://localhost:8080/healthz
```

The Dockerfile also wires this up as the container `HEALTHCHECK`.

## About SKU freshness

NVIDIA occasionally rotates the SKU codes behind each GPU model. The original web app kept these fresh by polling a live feed (`r2.jlplen.io/skus.json`) hosted by the project maintainer. That's a personal, rate-limited resource intended for the hosted web app — not something this headless service should hit by default, especially since many people could deploy this container.

By default, this service uses the static SKU table bundled with the upstream repo (plus built-in fallbacks), which covers all current models. If you want live updates and are comfortable relying on that third-party endpoint, you can opt in:

```bash
-e SKU_FEED_URL="https://r2.jlplen.io/skus.json"
```

If you do, please be considerate of the load you put on it, and consider supporting the original project via [ko-fi.com/timesaved](https://ko-fi.com/timesaved). If SKUs go stale, the fix is usually just updating `src/data/sku_patterns.json` from the upstream repo.

## What's different from the original web app

- No browser UI, sound, region-switcher, or auto-opening shop tabs — this is a background poller, useful if you have a server running somewhere.
- Telegram messages include the product URL directly instead of the maintainer's browser redirect/shop-link service, since that's tied to the hosted web app.
- Only Telegram is supported as a notification channel (the original also played a local sound).
- Live SKU updates are opt-in rather than always-on (see above).

## Support
If this tool got you a GPU: Great! You can consider buying me a Coffee [ko-fi.com/philippwiesner](https://ko-fi.com/philippwiesner). Definitely not mandatory tho! :)
