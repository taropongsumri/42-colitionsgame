# Coalition Backrooms

2.5D pixel-art quiz/boss game for pisciner 42 Bangkok — three houses compete.

Design docs are in [`readme/`](readme/):
- [`DESIGN.md`](readme/DESIGN.md) — original Thai design notes
- [`DESIGN_EN.md`](readme/DESIGN_EN.md) — English version
- [`questions.json`](readme/questions.json) — 30 seed questions

## Requirements

- [Bun](https://bun.sh) 1.3+
- MongoDB is **not required for Phase 0**. It will be needed from Phase 1 onward.

## Setup

```bash
bun install
cp .env.example .env
```

## Run

### Development
```bash
bun run dev
```
This starts two processes:
- Vite on `http://localhost:5173` (the app, with HMR)
- A custom Bun server on `http://localhost:3000` handling `/ws/*` WebSocket connections

Open `http://localhost:5173`. The page will connect to `ws://localhost:3000/ws/spike`.

### Production-style (single process)
```bash
bun run build
bun run start
```
Open `http://localhost:3000`. HTTP and WebSocket share the same port.

## Other commands

```bash
bun run check   # type-check Svelte + TypeScript
bun test        # run tests
```

## Architecture note

SvelteKit 2 no longer exports a `websocket` handler from `hooks.server.ts`, so the
`svelte-adapter-bun` generated server never enables `Bun.serve({ websocket })`.
This project therefore uses a custom Bun server (`server.ts`) that:

1. Handles `/ws/*` upgrades itself.
2. Delegates all other HTTP requests to the adapter handler (`build/handler.js`) in production.
3. Proxies HTTP to Vite in development.

This keeps HTTP and WebSocket in one process in production, as required by the design.

## Phase 0 status

- [x] Bun + SvelteKit + `svelte-adapter-bun` scaffold
- [x] Compatible dependency versions installed
- [x] HTTP + WebSocket spike verified in dev and prod
- [x] Shared types and typed client/server protocol
- [x] Health endpoint and protocol tests
