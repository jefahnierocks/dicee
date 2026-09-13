# Debugging Protocol for Claude/Cascade

> **Cloudflare operations warning:** Direct deployment and production log-tail
> examples in this legacy protocol are not authorized workflow. Follow
> `AGENTS.md` and `docs/cloudflare/README.md`; prefer local tests and dry runs,
> and require explicit operator authority for live deployment or observability.

## The Anti-Pattern: Code Reading Loop

```
❌ "Let me check the backend..." → looks fine
❌ "Let me check the frontend..." → looks fine  
❌ "Let me check the state handling..." → looks fine
❌ (loops forever without finding the bug)
```

**Why this fails**: Code that "looks fine" can still be broken. Reading code tells you what SHOULD happen. Only execution traces tell you what DOES happen.

## The Pattern: Trace First, Then Fix

```
✅ Identify the event/data chain (A → B → C → D)
✅ Add ONE log at the suspected break point
✅ Deploy and execute the failing action
✅ Read the logs
✅ Binary search to the exact failure location
✅ Fix that specific thing
```

## Protocol Steps

### Step 1: Map the Chain

Write out the exact sequence that should happen:

```
1. User clicks button
2. Client calls handler
3. Handler sends WebSocket message
4. Server receives message
5. Server processes and broadcasts response
6. Client receives response
7. UI updates
```

### Step 2: Add ONE Log at the Midpoint

Don't add logs everywhere. Start at the boundary between "working" and "unknown":

```typescript
// Example: At the start of server message handler
console.log(`[GameRoom] >>> RECEIVED: ${data.type} from ${userId}`);
```

### Step 3: Deploy and Test

```bash
# Deploy the ONE change
cd packages/cloudflare-do && npx wrangler deploy

# Watch logs
npx wrangler tail --format=pretty

# Test the failing action
```

### Step 4: Read the Result and Binary Search

**If log appears** → Problem is AFTER that point. Add log further down.
**If log missing** → Problem is BEFORE that point. Add log earlier.

Each test narrows the search by half. A 10-step chain takes at most 4 tests.

## Permission Granted

You have explicit permission to:

- Make small diagnostic changes without a complete fix
- Deploy "just for logging"
- Report "I don't know yet, here's what I learned"
- Ask for test results before continuing investigation

## Common Break Points

### WebSocket Flows
1. **Client not sending** - Check browser console for outgoing message
2. **Server not receiving** - Check wrangler tail for incoming message
3. **Validation failing silently** - Add log inside validation function
4. **Broadcast not reaching client** - Check socket count in broadcast

### Event Type Mismatches
- Server sends `CONNECTED`, client expects `room.state`
- Server sends `GAME_STARTED`, client expects `game.started`
- Always check BOTH sides of the event name

## Example: Quick Play Bug (2025-12-10)

**Symptom**: Game hangs at "Starting game..." screen

**Chain**:
```
1. User clicks Quick Play
2. Client navigates to room
3. Client connects WebSocket
4. Server sends CONNECTED
5. Client handler triggers QUICK_PLAY_START  ← BUG HERE
6. Server receives QUICK_PLAY_START
7. Server starts game, broadcasts QUICK_PLAY_STARTED
8. Client receives, updates UI
```

**Discovery**:
- Added log at step 6 (server receive)
- Log never appeared
- Moved investigation to step 5
- Found: Handler was checking for `room.state` but server sends `CONNECTED`

**Fix**: One line change - check for both event types

**Time to fix**: ~10 minutes with protocol, would have been hours of code reading
