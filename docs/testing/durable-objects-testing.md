# Durable Objects Testing Guide

> **Reconciliation pending:** Test counts, Wrangler APIs, global-tool installs,
> token-extraction suggestions, and auth-bypass examples in this 2025 guide may
> be stale or unsafe. Current tests, package scripts, `AGENTS.md`, and
> [`docs/cloudflare/README.md`](../cloudflare/README.md) outrank it. Never add an
> authentication bypass or expose a session token to follow this document.

Comprehensive testing strategy for the `@dicee/cloudflare-do` package.

## Test Coverage Summary

| Test Suite | Tests | Coverage |
|------------|-------|----------|
| Unit Tests (scoring) | 40 | Dice generation, category scoring, bonuses |
| Unit Tests (machine) | 77 | State transitions, validators, helpers |
| Unit Tests (state) | 60 | GameStateManager, player management, alarms |
| Unit Tests (chat) | 64 | ChatManager, reactions, typing indicators |
| Unit Tests (auth) | 22 | JWT verification, JWKS caching, helpers |
| Integration Tests | 12 | HTTP routing, room isolation |
| **Total** | **275** | |

## Running Tests

```bash
# From packages/cloudflare-do directory

# Unit tests only (fast, no worker startup)
pnpm test

# Integration tests (starts worker via unstable_dev)
pnpm test:integration

# All tests
pnpm test:all

# Watch mode for development
pnpm test:watch
```

## Unit Tests

### Scoring (`src/game/__tests__/scoring.test.ts`)

Tests dice generation and all Dicee scoring categories:

- `generateDice` - Random 5-dice generation
- `rollWithKept` - Re-roll with kept dice mask
- `calculateCategoryScore` - All 13 categories:
  - Upper section: ones, twos, threes, fours, fives, sixes
  - Lower section: threeOfAKind, fourOfAKind, fullHouse, smallStraight, largeStraight, dicee, chance
- `calculateAllPotentialScores` - Full scorecard preview
- `applyScore` - Score application with Dicee bonus
- `calculateTotal` - Total with upper bonus

### State Machine (`src/game/__tests__/machine.test.ts`)

Tests transition validators and state machine logic:

- Command validators:
  - `canStartGame` - Host, player count, phase checks
  - `canRollDice` - Turn ownership, rolls remaining, phase
  - `canKeepDice` - Turn decide phase only
  - `canScoreCategory` - Available categories, turn ownership
  - `canRematch` - Host only, game_over phase
- Phase helpers:
  - `getNextPhaseAfterScore` - Game completion detection
  - `getNextPlayerIndex` - Round-robin with wrap
  - `isNewRound` - Round boundary detection
  - `validateTransition` - Phase transition matrix
- Turn helpers:
  - `resetTurnState` - New turn initialization
  - `hasDice`, `canStillRoll` - Turn state predicates
- Phase predicates:
  - `isGameActive`, `isWaiting`, `isGameOver`
  - `isPlayerTurnInMachine`

### GameStateManager (`src/game/__tests__/state.test.ts`)

Tests game state management with mocked DurableObjectState:

- State access: `getState`, `saveState`, `hasState`
- Initialization: `initializeFromRoom`
- Game flow:
  - `startGame` - Phase transition, player order randomization
  - `rollDice` - Dice generation, roll tracking
  - `keepDice` - Kept dice mask management
  - `scoreCategory` - Scoring, turn advancement, game completion
  - `skipTurn` - AFK auto-scoring
  - `resetForRematch` - State reset
- Player management:
  - `updatePlayerConnection` - Connection tracking
  - `addPlayer`, `removePlayer`
- Alarm management:
  - `scheduleAfkWarning`, `scheduleAfkTimeout`
  - `scheduleRoomCleanup`, `scheduleGameStart`
  - `cancelAlarm`, `getAlarmData`

### ChatManager (`src/chat/__tests__/ChatManager.test.ts`)

Tests lobby chat system:

- Message storage and retrieval
- Quick chat vs custom messages
- Reactions (add/remove/toggle)
- Typing indicators
- Message validation
- History pagination

### Authentication (`src/__tests__/auth.test.ts`)

Tests JWT verification:

- Input validation (missing token, URL)
- Successful verification with mocked jose
- JWKS caching behavior
- Error handling (expired, invalid signature, missing claims)
- Helper functions: `extractDisplayName`, `extractAvatarUrl`
- Cache clearing

## Integration Tests

### Worker (`src/__tests__/worker.integration.test.ts`)

Uses `unstable_dev` from Wrangler to test the worker:

- Health check endpoint
- Routing:
  - Valid/invalid room codes
  - Case normalization
  - Room code format validation
- Room isolation (different codes → different DOs)
- CORS behavior

**Note**: WebSocket upgrade tests are skipped because `unstable_dev`'s fetch API doesn't support the `Upgrade` header. See WebSocket Testing section below.

## WebSocket Testing with wscat

For manual WebSocket testing during development:

### Prerequisites

```bash
# Start the worker
cd packages/cloudflare-do
pnpm dev
```

Use an already reviewed WebSocket client or the repository's automated test
harness. Do not install an unpinned global package solely to follow this guide.

### Getting a Test Token

Manual authentication testing must use a dedicated local/test identity and the
approved local credential flow. Never copy a live browser session token, mint a
token through an ad hoc dashboard query, or add a code path that bypasses
authentication. This legacy guide does not define credential issuance; prefer
the automated auth and Worker integration tests.

### Connection Examples

```bash
# Connect to a room (replace TOKEN with actual JWT)
wscat -H 'Authorization: Bearer YOUR_JWT_TOKEN' -c 'ws://localhost:8787/room/TEST01'

# Once connected, send messages:
# Join room
{"type":"room.join"}

# Start game (host only)
{"type":"game.start"}

# Roll dice
{"type":"dice.roll","payload":{"kept":[false,false,false,false,false]}}

# Keep dice (after rolling)
{"type":"dice.keep","payload":{"indices":[0,2,4]}}

# Score a category
{"type":"category.score","payload":{"category":"ones"}}

# Chat messages
{"type":"chat.message","payload":{"type":"custom","content":"Hello!"}}
{"type":"chat.message","payload":{"type":"quick","quickChatKey":"gg"}}

# Typing indicator
{"type":"chat.typing","payload":{"isTyping":true}}

# Add reaction
{"type":"chat.reaction","payload":{"messageId":"msg-123","emoji":"👍"}}
```

### Test Scenarios

1. **Two-player game flow**:
   - Open two terminal windows
   - Connect both to same room with different tokens
   - Player 1 (host) starts game
   - Take turns rolling and scoring

2. **Disconnection handling**:
   - Connect and join a room
   - Close connection (Ctrl+C)
   - Reconnect and verify state restored

3. **AFK timeout**:
   - Start a game
   - Don't take action for 60 seconds
   - Verify auto-score occurs

## E2E Testing with Playwright

For full end-to-end multiplayer testing:

```bash
# From project root
pnpm test:e2e

# Run specific multiplayer tests
pnpm test:e2e -- --grep "multiplayer"
```

See `packages/web/tests/e2e/multiplayer/` for test files.

## Mocking Strategies

### DurableObjectState Mock

```typescript
function createMockStorage(): MockStorage {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;

  return {
    get: vi.fn(async <T>(key: string) => data.get(key) as T),
    put: vi.fn(async (key: string, value: unknown) => data.set(key, value)),
    delete: vi.fn(async (key: string) => data.delete(key)),
    setAlarm: vi.fn(async (time: number) => { alarm = time; }),
    deleteAlarm: vi.fn(async () => { alarm = null; }),
    // ... etc
  };
}
```

### Jose JWT Mock

```typescript
vi.mock('jose', async () => {
  const actual = await vi.importActual<typeof jose>('jose');
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(),
    jwtVerify: vi.fn(),
  };
});

// In tests:
vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
  payload: validClaims,
  protectedHeader: { alg: 'RS256' },
});
```

## CI Integration

Tests run automatically on every PR via GitHub Actions:

```yaml
# .github/workflows/ci.yml
- name: Run DO tests
  run: pnpm --filter @dicee/cloudflare-do test
```

## Test File Structure

```
packages/cloudflare-do/
├── src/
│   ├── __tests__/
│   │   ├── auth.test.ts           # JWT verification tests
│   │   ├── worker.integration.test.ts  # Worker routing tests
│   │   └── helpers/
│   │       └── test-jwt.ts        # JWT creation helpers
│   ├── chat/
│   │   └── __tests__/
│   │       └── ChatManager.test.ts
│   └── game/
│       └── __tests__/
│           ├── scoring.test.ts    # Dice and scoring
│           ├── machine.test.ts    # State machine
│           └── state.test.ts      # GameStateManager
├── vitest.config.ts               # Unit test config
└── vitest.integration.config.ts   # Integration test config
```

## Debugging Tests

### Watch mode with filtering

```bash
# Run tests matching pattern
pnpm test -- --grep "canStartGame"

# Run single file
pnpm test -- src/game/__tests__/scoring.test.ts
```

### Verbose output

```bash
pnpm test -- --reporter=verbose
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "name": "Debug Vitest",
  "type": "node",
  "request": "launch",
  "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
  "args": ["run", "--reporter=verbose"],
  "cwd": "${workspaceFolder}/packages/cloudflare-do"
}
```
