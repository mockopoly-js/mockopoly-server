# 🎲 Mockopoly — Game Server

> Real-time multiplayer game server for Mockopoly. Handles all game logic, state management, and live synchronisation across connected players via Socket.io.

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=flat-square&logo=socket.io&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white)

---

## Overview

The Mockopoly server is the **single source of truth** for all game state. Every player action — rolling dice, buying a property, paying rent, making a trade — is sent to this server, validated against the game rules, applied to the canonical `GameState`, and then broadcast back to all players in the room.

The client never modifies its local state directly. It only sends *intents* (socket events) and renders whatever state the server returns.

**Companion repo:** [`mockopoly-client`](https://git.personal/monopoly/mockopoly-client) — the Phaser.js browser client.

---

## Features

- 🏠 **Full Monopoly ruleset** — all 40 board spaces, correct rent tables, houses, hotels, mortgages
- 🎴 **Chance & Community Chest** — shuffled card decks with all standard card effects
- 🏦 **Property auction** — auto-auction when a player declines to buy
- 🤝 **Player trading** — offer/counter-offer/accept/reject property + cash trades
- 🚔 **Jail mechanics** — pay fine, use Get Out of Jail Free card, or roll doubles
- 💸 **Bankruptcy resolution** — asset liquidation flow and creditor transfer
- 🔁 **Reconnect support** — players can rejoin mid-game using a reconnect token
- 🏷️ **Room codes** — 6-character alphanumeric codes for private lobbies
- 🔧 **Extensible special rules** — `config.specialRules` flag system for custom game modes

---

## Architecture

### Server-Authoritative Model

```
Client                          Server
  │                               │
  │── turn:roll-dice ────────────>│
  │                               │  1. Validate (is it this player's turn?)
  │                               │  2. Roll dice (server-side RNG)
  │                               │  3. Move player, apply landing effects
  │                               │  4. Mutate GameState
  │<─── turn:dice-rolled ─────────│  5. Emit animation event first
  │<─── game:state-update ────────│  6. Broadcast full new state to all players
```

### State Sync Strategy

After every meaningful state mutation, the server broadcasts the **full `GameState`** to all players in the room. This keeps the client simple (no diff merging), and makes reconnects trivial (just send the current state).

Animation events (`turn:dice-rolled`, `turn:player-moved`) are emitted *before* the state update, so the client can play animations then reconcile state silently.

### Key Modules

| Module | Responsibility |
|--------|---------------|
| `GameManager` | Registry of all active rooms (`Map<roomCode, GameState>`) |
| `GameState` | Mutable state class — all mutation methods live here |
| `GameEngine` | Pure validation — determines if any action is legal |
| `TurnManager` | Turn order, doubles tracking, jail logic |
| `CardDecks` | Shuffled Chance + Community Chest decks |
| `PropertyManager` | Ownership, houses/hotels, mortgage |

---

## Prerequisites

- **Node.js** v20 or higher
- **npm** v10 or higher

---

## Installation

```bash
git clone git@personal:monopoly/mockopoly-server.git
cd mockopoly-server
npm install
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Port the HTTP + WebSocket server listens on |
| `CLIENT_URL` | `http://localhost:5173` | CORS origin — set to your deployed client URL in production |
| `ROOM_CODE_LENGTH` | `6` | Character length of generated room codes |
| `MAX_PLAYERS` | `4` | Maximum players allowed per room |
| `ROOM_TIMEOUT_MINUTES` | `60` | Minutes of inactivity before a room is auto-cleaned up |

---

## Running Locally

```bash
npm run dev
```

Expected output:
```
🎲 Mockopoly server running on http://localhost:3001
```

Health check:
```bash
curl http://localhost:3001/health
# {"status":"ok","uptime":12.34}
```

The server is now ready to accept Socket.io connections from the client at `ws://localhost:3001`.

---

## Socket Events Reference

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `room:create` | `{ playerName, token }` | Create a new room, receive room code |
| `room:join` | `{ roomCode, playerName, token }` | Join an existing room by code |
| `room:ready` | `{ isReady }` | Toggle ready state in lobby |
| `room:start` | — | Host starts the game (2+ players ready) |
| `turn:roll-dice` | — | Roll both dice (current player only) |
| `turn:buy-property` | — | Purchase the property just landed on |
| `turn:pass-buy` | — | Decline to buy, triggers auction |
| `turn:end-turn` | — | End current turn |
| `jail:pay-fine` | — | Pay £50 to leave jail |
| `jail:use-card` | — | Use a Get Out of Jail Free card |
| `build:buy-house` | `{ spaceIndex }` | Build a house on an owned property |
| `build:buy-hotel` | `{ spaceIndex }` | Upgrade 4 houses to a hotel |
| `build:sell-house` | `{ spaceIndex }` | Sell a house back to the bank |
| `build:sell-hotel` | `{ spaceIndex }` | Downgrade hotel back to 4 houses |
| `mortgage:apply` | `{ spaceIndex }` | Mortgage a property |
| `mortgage:lift` | `{ spaceIndex }` | Unmortgage a property |
| `trade:offer` | `{ toPlayerId, offer }` | Send a trade offer to another player |
| `trade:counter` | `{ tradeId, counterOffer }` | Counter an incoming trade offer |
| `trade:accept` | `{ tradeId }` | Accept a trade offer |
| `trade:reject` | `{ tradeId }` | Reject a trade offer |
| `auction:bid` | `{ amount }` | Place a bid in the current auction |
| `auction:pass` | — | Withdraw from the current auction |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `game:state-update` | `{ state: GameState }` | Full state broadcast after every mutation |
| `room:created` | `{ roomCode, state }` | Confirms room creation with initial state |
| `room:joined` | `{ state }` | Confirms join with current full state |
| `room:rejected` | `{ reason }` | Room full, code invalid, etc. |
| `turn:dice-rolled` | `{ playerId, dice, isDoubles }` | Triggers dice animation on client |
| `turn:player-moved` | `{ playerId, from, to, passedGo }` | Triggers token movement tween |
| `turn:landed` | `{ playerId, spaceIndex, spaceType }` | Player has arrived at space |
| `card:drawn` | `{ playerId, deck, card }` | Triggers card reveal animation |
| `jail:sent` | `{ playerId }` | Player is sent to jail |
| `player:bankrupt` | `{ playerId, creditorId }` | Player has gone bankrupt |
| `game:over` | `{ winnerId, finalStandings }` | Game has ended |
| `error` | `{ code, message }` | Validation error (only sent to requesting socket) |

---

## Project Structure

```
src/
├── index.ts                # HTTP server + Socket.io initialisation
├── types/
│   ├── GameState.ts        # All shared TypeScript interfaces (source of truth)
│   └── SocketEvents.ts     # Socket event name constants + payload types
├── constants/
│   ├── board.ts            # All 40 space definitions, prices, rent tables, card data
│   └── rules.ts            # Starting money, jail fine, animation timing constants
├── socket/
│   ├── roomHandlers.ts     # room:create, room:join, room:ready, room:start
│   ├── gameHandlers.ts     # All turn, jail, build, mortgage, auction events
│   └── tradeHandlers.ts    # trade:offer, trade:counter, trade:accept, trade:reject
└── game/
    ├── GameManager.ts      # Active room registry Map<roomCode, GameState>
    ├── GameState.ts        # Mutable state class + all mutation methods
    ├── GameEngine.ts       # Pure rule validation — is this action legal?
    ├── TurnManager.ts      # Turn order, doubles tracking, jail turn counting
    ├── CardDecks.ts        # Chance + Community Chest shuffled decks
    └── PropertyManager.ts  # Ownership, house/hotel counts, mortgage state
```

---

## Branch Workflow

```
master      ← production-ready code only
staging     ← integration branch — all features merge here first
feature/*   ← individual feature branches, always cut from staging
fix/*       ← bug fix branches, always cut from staging
```

**Day-to-day workflow:**

```bash
# 1. Always start from latest staging
git checkout staging
git pull origin staging

# 2. Cut a new branch
git checkout -b feature/my-feature

# 3. Implement, commit
git add <files>
git commit -m "feat: describe your change"

# 4. Push and open a PR into staging
git push origin feature/my-feature

# 5. After review + merge to staging, staging is merged to master for releases
```

---

## Contributing

1. Branch off `staging` using `feature/<name>` or `fix/<name>`
2. Keep commits atomic and descriptive (`feat:`, `fix:`, `refactor:`, `chore:`)
3. Never commit `.env` — use `.env.example` to document new variables
4. The `GameEngine.ts` validation must reject any invalid action before `GameState` is mutated
5. After any `GameState` mutation, always call the broadcast helper to sync all clients
