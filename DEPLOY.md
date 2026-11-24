# Deployment guide

Production runs as **one Bun process** (`server.ts`) that serves the built SvelteKit
app over HTTP and owns every WebSocket. Vite is not involved in production.

## 1. Requirements

- Bun 1.3+
- A reverse proxy with TLS (nginx/Caddy) is strongly recommended — it terminates
  HTTPS and forwards WebSocket upgrades so browsers can use `wss://`.
- MongoDB is optional. Without `MONGO_URI`, all state lives in `./data/store.json`.

## 2. Install and build

```bash
bun install
cp .env.example .env      # then edit the values (see below)
bun run seed              # imports the 90-question bank
bun run check             # 0 errors expected
bun test
bun run build
```

`bun run build` writes the SvelteKit adapter output to `build/`. `server.ts`
imports `build/handler.js` when `MODE=prod`.

## 3. Configuration

| Variable | Purpose | Production guidance |
|---|---|---|
| `MODE` | `dev` (Vite + socket server) or `prod` (single process) | `prod` |
| `PORT` | HTTP + WebSocket port | 3000, bind only to localhost behind a proxy |
| `PUBLIC_ORIGIN` | External browser origin, e.g. `https://play.example.com` | **Required** when behind a proxy; WebSocket `Origin` headers are checked against it |
| `ADMIN_PASSWORD` | `/admin` login | Change from `admin` |
| `SPECTATOR_KEY` | Key typed on `/spectate` | Change from `spectate` |
| `INTERNAL_SECRET` | Shared secret for `/internal/*` control calls from the web process | Set a long random value; empty disables those endpoints |
| `MONGO_URI` | MongoDB connection string | Empty = local JSON store |
| `DATA_DIR` | Directory for the JSON store | persistent volume, e.g. `/var/lib/coalition` |
| `DISCORD_WEBHOOK_URL` | Optional event webhook | Optional |

The server logs a warning at startup for any default credential or missing
`PUBLIC_ORIGIN` / `INTERNAL_SECRET`. Generate secrets with:

```bash
openssl rand -hex 32
```

## 4. Run

```bash
MODE=prod bun run start
```

Then check:

```bash
curl http://localhost:3000/api/health
# {"ok":true,...}
```

Pages:

- `/` — join page, shows the 4-character machine password
- `/game` — fullscreen game (WASD move, **Shift sprint**, E interact, Q stairs)
- `/scoreboard` — live scores and clock
- `/admin` — accept/kick/move machines, start/pause/end, force unlock, announcements
- `/spectate` — read-only flying orb; enter `SPECTATOR_KEY`, choose fire/water skin

## 5. Reverse proxy (nginx example)

```nginx
server {
    listen 443 ssl;
    server_name play.example.com;

    ssl_certificate     /etc/letsencrypt/live/play.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/play.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for /ws/play and /ws/spectate
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

Set `PUBLIC_ORIGIN=https://play.example.com`. Without it, the WebSocket
origin check rejects browser connections that arrive through the proxy.

## 6. Persistence and backups

- **Local JSON store** (`MONGO_URI` empty): stop the game process before editing
  `data/store.json` by hand, or the next write will overwrite your edit.
  Back up the whole `DATA_DIR` directory (state, config and logs live there).
- **MongoDB**: four databases — `coalition_content`, `coalition_config`,
  `coalition_game`, `coalition_logs`. Use your normal Mongo backup/restore flow.
- Questions are seeded once with `bun run seed`. Re-running it replaces the
  question bank; it does not reset houses or sessions.

## 7. Security checklist

Done in code (Phase 6):

- `/internal/*` endpoints require `x-internal-secret`; fail closed when unset.
- WebSocket upgrades validate `Origin` against an explicit allow-list.
- Inbound frames larger than 4 KB are rejected before parsing.
- Cosmetic ghost/orb coordinates are clamped to the current floor map.
- Cosmetic updates are rate-limited to 30 per second per socket.
- Server-authoritative answers and boss solutions are never broadcast to clients.
- Spectator orbs are sent only to `/ws/spectate`, never to players.

Operator responsibilities:

- Change `ADMIN_PASSWORD`, `SPECTATOR_KEY` and set `INTERNAL_SECRET`.
- Serve over HTTPS/WSS; do not expose port 3000 directly to the internet.
- Restrict admin and spectator access at the proxy if the event is private.
- Keep `data/` out of any public web root (it contains session tokens).

## 8. systemd unit

```ini
[Unit]
Description=Coalition Backrooms
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/coalition-backrooms
EnvironmentFile=/srv/coalition-backrooms/.env
ExecStart=/usr/local/bin/bun run server.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now coalition-backrooms
sudo journalctl -u coalition-backrooms -f
```

## 9. Updates and rollback

```bash
git pull
bun install
bun run build
sudo systemctl restart coalition-backrooms
```

Keep a copy of `build/` and `data/` before upgrading; rollback is restoring both
and restarting. Schema changes are additive so older state files remain readable.

## 10. Troubleshooting

| Symptom | Check |
|---|---|
| `403 Forbidden origin` on WebSocket | `PUBLIC_ORIGIN` must match the browser's exact scheme + host + port |
| Admin announce/kick does nothing | `INTERNAL_SECRET` unset or different in the web and socket processes |
| `401` on `/ws/spectate` | Wrong `SPECTATOR_KEY` |
| State resets after restart | `DATA_DIR` is temporary or `MONGO_URI` points at an empty database |
| Hydration errors in browser | Do not run Vite in `MODE=prod`; use `bun run build` first |
