# Coalition Backrooms — Design Document

A 2.5D pixel-art quiz/boss game for pisciner 42 Bangkok. Three "houses" compete against each other inside a backrooms-style dungeon.

This document records every decision made during design discussions. It is the single source of truth when implementing the game.

---

## 1. Players & Connection

### Setup
- There are **3 houses**, each with **8–9 people**.
- Each house uses **one single client machine** (1 house = 1 character), for **3 clients total**.
- Real quests happen **outside the game** (organized by staff). The game only needs to:
  1. Display the quest.
  2. Accept a code or answer from the player.
  3. Validate it on the server.

### Join flow
1. The client opens the URL and sees a **4-character machine code**.
2. An admin decides which house that machine belongs to and clicks **Accept**.
3. The server stores a session token in a cookie.

### Reconnection & session rules
- Refreshing the page or losing network connection automatically restores the same house, room, and HP.
- An admin can **Kick** a session or **move** it to another machine. A house can have only one active client at a time.
- **If a player disconnects during a boss fight, the boss's HP resets to full.**

---

## 2. Map & Rooms

- The map is a chain of small connected rooms, with **one question per room**.
- Answering correctly unlocks the door to the next room. Other rooms are hidden by **fog of war**.
- All houses use the **same layout**, but each house gets **different questions in every room** (`questionIds: { h1, h2, h3 }`).

### Classroom (code-writing backroom)
- The room contains **round tables split into 4 pizza-like slices**, spread around the room.
- The main power socket is in a hole in the center of the table.
- The **glowing socket** marks the real table. Walk to it and press `E` to open a terminal and answer.
- A wrong answer makes the socket spark with electricity and **locks the terminal for 10 seconds** (configurable).
- One of the fake tables hides a **hint**, but only if that question actually has a `hint`.

### Other houses' shadows
- When another house is in the **same room number** as you, it appears as a translucent shadow in that house's color.
- The shadow uses the character shape of that house (see Characters).

---

## 3. Boss Room

- The player is warped to another world, themed per staff member (details to be provided later).
- There is **one single question per boss**, designed as a long task — e.g. run 1 km to fetch the answer and bring it back.

### Waiting phase ("monkey typing")
- The player types easy English words from the boss's word pool.
- Correctly typed words **add shield**. The boss attacks on a rhythm and consumes the shield. Once the shield is gone, the player loses HP.
- Each correct word also chips a small amount of boss HP, but **never below 10%** (only the finishing move can take the last 10%).
- A typo **sticks**: the player must fix the wrong character before continuing.

### Attack phase ("Audition")
1. Press `Tab` to enter attack mode. During this mode there is **no shield**.
2. Type the answer with **no visible feedback** — the screen shows only `■` characters.
3. Press `Enter` to submit to the server for validation.
4. If **correct**: a rhythm combo plays at the boss's BPM. Letters pop up one by one, each with a move tied to its character type (vowel / consonant / digit / symbol), ending with a finishing move that takes the final 10% HP.
5. If **wrong**: the input shatters, the boss counterattacks, and the game returns to the waiting phase.

### On HP reaching zero
- The player is **stunned for 30 seconds** with a glitch effect.
- The boss **recovers some HP**.
- The house loses points (default: **50**).
- The answer-submission lock grows longer each time: **30 → 60 → 90 seconds → ...**
- The accumulated lock duration **resets when that boss is defeated**.

---

## 4. Scoring

- Play time is limited, default **90 minutes** (configurable).
- Passing a room awards points; defeating a boss awards a **large point bonus**.
- **Order bonus:** 1st place **+50%**, 2nd place **+20%**, 3rd place **+0%**.
- Scores may go **negative**.
- The scoreboard shows: score, current room, HP during boss fights, and time remaining.

---

## 5. House Characters (locked per house)

| House | Animal | Colors | Boss moves |
|---|---|---|---|
| h1 | Scorpion | Orange–yellow | Tail stab, claw pinch, poison |
| h2 | Elephant | Gray | Ground stomp, trunk swipe, water spray |
| h3 | Octopus | Purple | Tentacle whip, ink spray, whirlpool |

- The player character is a **person in a mascot costume** with a hood covering the head, plus the animal's ears or tail.
- A **tiny animal companion** follows the player as a pet. During boss combos, the pet performs a **paired move** with the player.
- Other houses' shadows use that house's character shape, rendered translucent.

---

## 6. Spectator Mode (for tutors & staff)

- Open at `/spectate` with a spectator key defined in `config.ts`. No admin approval needed and no viewer limit.
- Spectators are **free-floating light orbs** that pass through walls, ignore fog of war, and fly (`WASD`) to any room or boss world.
- **Visibility toggle:** spectators can switch whether players can see their orb. Admins have a global switch to force-hide all orbs.
- Spectators **cannot interact** with the game at all — no answering questions, no opening hints.

---

## 7. Admin (GUI)

### Lobby
- See machines waiting to join, assign houses, Accept, Kick, and move machines.

### Control buttons
- Pause / Resume.
- Add or subtract score, with a reason.
- Force-unlock a room.
- Broadcast a message to players' screens.
- Edit answers live.
- Add or remove time.

### Management
- Manage the question bank (IDs), dungeon (room order), bosses, and all live config.

---

## 8. Technical Stack

- **Runtime/framework:** Bun + SvelteKit with `svelte-adapter-bun`; WebSocket runs in the same process. Deployed on Linux Ubuntu.
- **Client:** 2.5D pixel art drawn on canvas.
  - Art assets from the **pxl** skill.
  - Skill effects from **pixelfx** (`vendor/pixelfx`).
- **Two-layer config:**
  - `config.ts`: secrets (Mongo URI, Discord webhook, admin password, port) and all default values.
  - Live config: stored in MongoDB, editable from the admin page, effective immediately, with a **Reset to defaults** button.
  - Secrets are **never sent to the browser**.

### Databases (4 separate MongoDB databases)
| Database | Contents |
|---|---|
| `coalition_content` | Questions, dungeons, bosses |
| `coalition_config` | Live config with edit history |
| `coalition_game` | Sessions, houses, progress, scores |
| `coalition_logs` | Checkpoints, every answer attempt, stuns, admin audit, Discord sends |

### Discord webhook
- Fires **only on important events**, not on player movement. Rate limit: ~30 messages/minute.
- Events: game start, room cleared, boss entered, stun, boss defeated, admin button pressed, game end.
- **Answers are validated on the server only and are never sent to the client.**

---

## 9. Still Open

- Boss themes and word pools (waiting for staff information).
- Final number of rooms and actual question content.
