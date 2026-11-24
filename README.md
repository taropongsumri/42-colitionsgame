# Coalition Backrooms

2.5D pixel-art quiz/boss game for pisciner 42 Bangkok — three houses compete.

Design docs are in [`readme/`](readme/):
- [`DESIGN.md`](readme/DESIGN.md) — original Thai design notes
- [`DESIGN_EN.md`](readme/DESIGN_EN.md) — English version
- [`questions.json`](readme/questions.json) — 30 seed questions
- [`DATABASE.md`](readme/DATABASE.md) — how to read/edit the local JSON store or MongoDB
- [`DEPLOY.md`](DEPLOY.md) — production setup, reverse proxy, security and backups

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

Open `http://localhost:5173` — that is the **join page**. After the admin accepts your machine code, click **Enter game** to open `/game`.

### Production-style (one process)
```bash
bun run build
bun run start
```
Open `http://localhost:3000`. HTTP and WebSocket share the same port.

Pages: `/` join + machine password · `/game` fullscreen game · `/scoreboard` · `/admin`.

## Game flow implemented so far

1. Open `/` → a 4-character machine code appears. This is the same "password" shown in `/admin`.
2. Open `/admin`, enter the admin password (default `admin` from `.env`).
3. Assign the machine to `h1`, `h2`, or `h3`, then click **Accept**.
4. The join page unlocks **Enter game**. `/game` fills the whole browser; use the **100% / 80%** control to zoom out 20% and see more of the map. Refreshing restores the saved state.
5. Admin can **Kick** or **Move** a session to another machine. One active client per house.
6. Disconnecting during a boss fight resets that boss's HP.
7. The map is ported from the earlier prototype: 40×22-tile white cluster floors with round pizza tables, iMacs, chairs, pillars, stairs, lift and forecourt. Move with **WASD / arrow keys** (**Shift** sprints); a `GO` marker sits on the current plug, and press **E** on a glowing plug (or **Q** for stairs down).
8. Answer in the terminal. Wrong answers lock that house's terminal for 10 seconds.
9. A correct answer clears the room, awards points with a first/second/third-place bonus, and moves the house to the next room.
10. Other houses appear as translucent shadows when they are in the same room (fog of war).
11. `/scoreboard` polls scores and the clock; `/admin` can start/pause/resume/end, add time, adjust score, force-unlock a room, and announce.

## Storage

| Mode | How to enable | Where data lives |
|---|---|---|
| Local (default) | `MONGO_URI=` | `./data/store.json` |
| MongoDB | `MONGO_URI=mongodb://...` | `coalition_content`, `coalition_config`, `coalition_game`, `coalition_logs` |

The local store is reloaded from disk on every operation so the dev web process and socket process see the same state. See [`readme/DATABASE.md`](readme/DATABASE.md) for `jq` / `mongosh` commands and collection names.

## Other commands

```bash
bun run check       # type-check Svelte + TypeScript
bun test            # unit tests
bun run test:e2e    # full HTTP + WebSocket flow (server must be running and questions seeded)
```

Player and pet sprites in `static/sprites/` were copied from the earlier pixel-art prototype so
Phase 2 can render real artwork instead of placeholders. They are scaled 2x with smoothing off.


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
- [x] **Phase 2** — quiz rooms, terminals/locks/hints, sprites, fog/shadows, clock, scoring, scoreboard, admin controls
- [x] **Phase 3** — boss mechanics
- [x] **Phase 4** — full admin, spectator, Discord, audit log
- [x] **Phase 5** — floor progression (5 floors × 6 plugs), boss lifecycle, pixel-art effects (sprint run, plug arrows, fire orb), admin overhaul
- [x] **Phase 6** — hardening (internal auth, origin checks, rate limits, input bounds) and [deploy docs](DEPLOY.md)
