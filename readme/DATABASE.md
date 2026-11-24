# Accessing the database

The game has two storage modes. You do **not** need MongoDB to run or test it locally.

## 1. Local JSON store (default)

Enabled when `MONGO_URI` is empty (see `.env`). Everything lives in one file:

```
data/store.json
```

The file is re-read on every store operation, so the Vite process and the Bun WebSocket process always see the same data.

### Read it

```bash
# whole store
cat data/store.json

# pretty-print with jq
jq . data/store.json

# useful slices
jq '.houses' data/store.json
jq '.houses.h1' data/store.json
jq '.questions' data/store.json
jq '.machines' data/store.json
jq '.sessions' data/store.json
jq '.config.value' data/store.json
jq '.logs[-10:]' data/store.json
jq '.meta' data/store.json
```

Top-level keys:

| Key | Contents |
|---|---|
| `machines` | 4-character machine passwords shown on `/` and `/admin` |
| `sessions` | Browser session tokens, assigned house, accepted flag |
| `houses` | `h1` / `h2` / `h3` room, HP, score, solved rooms, answer lock |
| `questions` | the seeded question bank (answers included — server-side only) |
| `config` | live admin config overrides and config history |
| `logs` | answer/admin events (last 2000) |
| `meta` | clock, pause, announcement, finished flag |

### Change it safely

Prefer the app APIs:

```bash
# scoreboard, machines and config are readable with curl
curl http://localhost:3000/api/scoreboard

# admin endpoints need the admin password (default: admin)
curl -H 'x-admin-password: admin' http://localhost:3000/api/admin/machines
curl -H 'x-admin-password: admin' http://localhost:3000/api/admin/config
```

If you edit `data/store.json` directly, stop both dev processes first (or the next write will overwrite your edit), keep valid JSON, then restart.

### Reset / seed

```bash
# replace questions from readme/questions.json
bun run seed

# wipe all local state (questions included) and let the app recreate it
rm -f data/store.json
bun run seed
```

## 2. MongoDB (later / server)

Set a URI in `.env` (or in the process environment):

```env
MONGO_URI=mongodb://127.0.0.1:27017
```

Start the server normally. `src/lib/server/db/index.ts` switches to `MongoStore` automatically. Seed once after switching:

```bash
bun run seed
```

### Databases and collections

| Database | Collection | Same data as local JSON |
|---|---|---|
| `coalition_content` | `questions` | `questions` |
| `coalition_config` | `config`, `configHistory` | `config.value`, `config.history` |
| `coalition_game` | `machines`, `sessions`, `houses`, `meta` | `machines`, `sessions`, `houses`, `meta` |
| `coalition_logs` | `logs` | `logs` |

### Connect with `mongosh`

```bash
mongosh "mongodb://127.0.0.1:27017"

use coalition_content
db.questions.find().pretty()
db.questions.countDocuments()

use coalition_game
db.machines.find().pretty()       // machine passwords
db.sessions.find().pretty()       // browser sessions
db.houses.find().pretty()         // h1 / h2 / h3 state
db.meta.find().pretty()

use coalition_config
db.config.find().pretty()
db.configHistory.find().sort({ at: -1 }).limit(10).pretty()

use coalition_logs
db.logs.find().sort({ at: -1 }).limit(20).pretty()
```

Useful one-liners:

```bash
mongosh "mongodb://127.0.0.1:27017/coalition_game" --eval 'db.houses.find().pretty()'
mongosh "mongodb://127.0.0.1:27017/coalition_game" --eval 'db.sessions.deleteMany({})'   # log everyone out
mongosh "mongodb://127.0.0.1:27017/coalition_content" --eval 'db.questions.countDocuments()'
```

### Local MongoDB with Docker

```bash
docker run -d --name coalition-mongo -p 27017:27017 mongo:7
```

Then put `MONGO_URI=mongodb://127.0.0.1:27017` in `.env`, run `bun run seed`, and restart the server.

## Important: answers never go to clients

Both stores contain question answers, but the browser only receives `prompt` and `hint` through the `/ws/play` `question` message. Never expose these files/collections directly to players, and keep `MONGO_URI` and `ADMIN_PASSWORD` private on the server.
