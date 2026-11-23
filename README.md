# Coalition Backrooms

2.5D pixel-art quiz/boss game for pisciner 42 Bangkok — three houses compete.

Design docs are in [`readme/`](readme/):
- [`DESIGN.md`](readme/DESIGN.md) — original Thai design notes
- [`DESIGN_EN.md`](readme/DESIGN_EN.md) — English version
- [`questions.json`](readme/questions.json) — 30 seed questions

## Requirements

- [Bun](https://bun.sh) 1.3+
- MongoDB is **optional for local development**. Leave `MONGO_URI` empty to use a JSON file store.

## Setup

```bash
bun install
cp .env.example .env
bun run seed        # import readme/questions.json
```

## Run

### Development (two processes)
```bash
bun run dev
```
- Vite: `http://localhost:5173` — the app, with HMR
- Bun socket server: `http://localhost:3000` — `/ws/*` plus an HTTP proxy to Vite

Open `http://localhost:5173`.

### Production-style (one process)
```bash
bun run build
bun run start
```
Open `http://localhost:3000`. HTTP and WebSocket share the same port.

## Game flow implemented so far

1. Open the game → a 4-character machine code appears.
2. Open `/admin`, enter the admin password (default `admin` from `.env`).
3. Assign the machine to `h1`, `h2`, or `h3`, then click **Accept**.
4. The game page now shows the house and saved state. Refreshing restores it.
5. Admin can **Kick** or **Move** a session to another machine. One active client per house.
6. Disconnecting during a boss fight resets that boss's HP.

## Storage

| Mode | How to enable | Where data lives |
|---|---|---|
| Local (default) | `MONGO_URI=` | `./data/store.json` |
| MongoDB | `MONGO_URI=mongodb://...` | `coalition_content`, `coalition_config`, `coalition_game`, `coalition_logs` |

The local store is reloaded from disk on every operation so the dev web process and socket process see the same state.

## Other commands

```bash
bun run check       # type-check Svelte + TypeScript
bun test            # unit tests
bun run test:e2e    # full HTTP + WebSocket flow (server must be running)
```

## Architecture note

SvelteKit 2 no longer exports a `websocket` handler from `hooks.server.ts`, so the
`svelte-adapter-bun` generated server never enables `Bun.serve({ websocket })`.
This project therefore uses a custom Bun server (`server.ts`) that:

1. Handles `/ws/*` upgrades itself (including cookie-based session lookup).
2. Delegates other HTTP requests to the adapter handler in production.
3. Proxies HTTP to Vite in development.

## Phase status

- [x] **Phase 0** — scaffold, compatible dependencies, HTTP + WebSocket spike, shared protocol
- [x] **Phase 1** — config, local/Mongo storage, machine codes, admin accept/kick/move, reconnect, boss-disconnect reset, live config, seed script
- [ ] Phase 2 — quiz rooms, terminal, doors/fog, scoring, scoreboard
- [ ] Phase 3 — boss mechanics
- [ ] Phase 4 — full admin, spectator, Discord, audit log
- [ ] Phase 5 — pixel-art client and effects
- [ ] Phase 6 — hardening and deploy docs
