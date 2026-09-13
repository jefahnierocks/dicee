# Agentic Debugging Protocol

> **Cloudflare operations warning:** The direct `npx wrangler deploy`, log-tail,
> production URL, and ad hoc identifier-logging examples below are legacy and
> must not be executed as agent instructions. Use
> [`docs/cloudflare/README.md`](cloudflare/README.md), current structured logging,
> focused local tests, and dry runs. Live deployment and observability access
> remain operator-gated.

## The Anti-Pattern: Code Reading

```
❌ "Let me check the backend..."
❌ "The backend looks fine, let me check the frontend..."
❌ "Let me check the state handling..."
❌ "Let me check the WebSocket..."
❌ (loops forever)
```

**Why this fails**: Code that "looks fine" can still be broken. Reading code tells you what SHOULD happen. Only execution traces tell you what DOES happen.

## The Pattern: Trace First, Then Fix

```
✅ Add logging at suspected break point
✅ Execute the failing action
✅ Read the logs
✅ Identify exact failure location
✅ Fix that specific thing
```

---

## Protocol: "ROLLING..." Stuck Bug

### Step 1: Identify the Chain

Write out the exact sequence that should happen:

```
1. User clicks START YOUR TURN
2. Client calls rollDice() in game store
3. Store calls roomService.sendDiceRoll()
4. roomService sends { type: 'DICE_ROLL' } over WebSocket
5. Server receives in handleMessage()
6. Server routes to handleDiceRoll()
7. handleDiceRoll validates (canRollDice)
8. handleDiceRoll generates dice
9. handleDiceRoll broadcasts DICE_ROLLED
10. Client receives DICE_ROLLED
11. Client normalizes to 'dice.rolled'
12. Store handles dice.rolled event
13. UI updates with dice values
```

### Step 2: Add ONE Log at the Suspected Break

Don't add logs everywhere. Start at the boundary between "working" and "unknown":

We KNOW: QUICK_PLAY_STARTED reaches client (logs show it)
We DON'T KNOW: Does DICE_ROLL reach server?

**Add this ONE log:**

```typescript
// In GameRoom.ts handleMessage(), at the very start
async handleMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  const data = JSON.parse(message as string);
  console.log(`[GameRoom] RECEIVED: ${data.type} from ${this.getConnectionState(ws)?.playerId}`);
  // ... rest of handler
}
```

### Step 3: Deploy and Test

```bash
# Deploy the ONE change
cd packages/cloudflare-do && npx wrangler deploy

# Watch logs
npx wrangler tail --format=pretty | grep "RECEIVED"

# Test: Click START YOUR TURN
```

### Step 4: Read the Result

**If you see:**
```
[GameRoom] RECEIVED: DICE_ROLL from e953d428-...
```
→ Server receives it. Problem is AFTER receive. Add log inside handleDiceRoll.

**If you DON'T see it:**
→ Client isn't sending, or WebSocket is broken. Add log on client side.

### Step 5: Binary Search to the Break

Each test narrows the search by half:

```
Chain: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13
                              ↑
                        Add log here first
                        
If log appears → problem is 7-13, add log at 10
If log missing → problem is 1-6, add log at 3
```

---

## Common Break Points for WebSocket Flows

### Break Point A: Client Not Sending

**Symptom**: No server log for received message
**Check**: Browser console for outgoing message
**Common causes**:
- Button disabled (canRoll is false)
- Event handler not attached
- roomService.send() not called

**Diagnostic**:
```typescript
// In the click handler
function handleStartTurn() {
  console.log('[DEBUG] handleStartTurn called');
  console.log('[DEBUG] canRoll =', canRoll);
  if (!canRoll) {
    console.log('[DEBUG] Cannot roll, aborting');
    return;
  }
  console.log('[DEBUG] Calling rollDice()');
  rollDice();
}
```

### Break Point B: Server Not Receiving

**Symptom**: Client sends, server log never appears
**Check**: WebSocket connection state
**Common causes**:
- WebSocket disconnected after QUICK_PLAY_STARTED
- Message routing not matching command type
- Message parsing error (silent catch)

**Diagnostic**:
```typescript
// At the START of handleMessage, before any parsing
async handleMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
  console.log(`[GameRoom] RAW MESSAGE:`, typeof raw === 'string' ? raw.slice(0, 100) : 'binary');
  // ... rest
}
```

### Break Point C: Validation Failing Silently

**Symptom**: Server receives, no broadcast, no error
**Check**: Validation function return value
**Common causes**:
- canRollDice returns false
- Player ID mismatch
- Game phase mismatch

**Diagnostic**:
```typescript
// In handleDiceRoll
const canRoll = this.canRollDice(playerId, ...);
console.log(`[GameRoom] canRollDice result:`, canRoll);
if (!canRoll) {
  console.log(`[GameRoom] VALIDATION FAILED - returning without response`);
  return; // THIS IS THE BUG - should send error
}
```

### Break Point D: Broadcast Not Reaching Client

**Symptom**: Server logs broadcast, client doesn't receive
**Check**: Socket count in broadcast log
**Common causes**:
- WebSocket tagged wrong, excluded from broadcast
- Client disconnected
- Event filtered by normalizer

**Diagnostic**:
```typescript
// In broadcast()
const sockets = this.ctx.getWebSockets();
console.log(`[Broadcast] ${event.type} to ${sockets.length} sockets`);
sockets.forEach((s, i) => {
  const state = this.getConnectionState(s);
  console.log(`  Socket ${i}: player=${state?.playerId}, readyState=${s.readyState}`);
});
```

---

## The Debugging Commit Pattern

When debugging, make small, targeted commits:

```bash
# Commit 1: Add diagnostic logging
git commit -m "debug: add logging to handleMessage"

# Commit 2: Deploy and test
# (capture logs)

# Commit 3: Add more specific logging based on results
git commit -m "debug: add logging to handleDiceRoll validation"

# Commit 4: Deploy and test again
# (identify root cause)

# Commit 5: Remove debug logging, add actual fix
git commit -m "fix: send error response when validation fails"

# Commit 6: Clean up
git commit -m "chore: remove debug logging"
```

---

## For the Current Bug: Exact Steps

### Right Now, Do This:

**1. Add this ONE log to GameRoom.ts:**

```typescript
// Find handleMessage method, add at the very start:
async handleMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  const data = JSON.parse(message as string);
  console.log(`[GameRoom] >>> RECEIVED: ${data.type}`);
  // ... rest of existing code
}
```

**2. Deploy:**
```bash
cd packages/cloudflare-do && npx wrangler deploy
```

**3. Test:**
- Open https://dicee.pages.dev
- Click Quick Play
- Click START YOUR TURN
- Watch wrangler tail

**4. Report back with:**
- Does `>>> RECEIVED: DICE_ROLL` appear?
- If yes, does any other log appear after it?
- If no, what's the last log that DOES appear?

**This is the ONLY thing to do right now.** Don't check more code. Don't speculate. Get the data.

---

## Why This Works

The agent's failure mode is **analysis paralysis**: looking at more and more code without learning anything new.

The solution is **empirical debugging**: make ONE change, observe ONE result, draw ONE conclusion, repeat.

```
Reading code: O(files × lines) - scales badly
Tracing execution: O(log n) - binary search
```

A 13-step chain takes at most 4 tests to find the break point with binary search. But infinite code reading if you're just looking for something that "looks wrong."
