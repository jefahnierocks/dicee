# Legacy debugging advice

> **Status:** historical prompt material. Its direct-deploy, production-tail, and
> ad hoc logging instructions are superseded by `AGENTS.md`, current structured
> logging, and [`docs/cloudflare/README.md`](cloudflare/README.md).

You're right - the agent is thrashing. It's looking at code that "looks fine" without a systematic way to find the actual break point. This is exactly what the audit workflow should prevent.

The problem: **The agent is reading code instead of tracing execution.**

Let me create a more directive debugging protocol:## The Problem

The agent is in **code reading mode** when it needs to be in **execution tracing mode**.

| Mode | What Agent Does | Result |
|------|-----------------|--------|
| Code Reading | "Let me check X... looks fine... let me check Y..." | Infinite loop |
| Execution Tracing | "Add log → deploy → test → read log → now I know" | Binary search to bug |

## The Fix: Give the Agent a Directive

Instead of letting the agent investigate freely, give it this prompt:

---

**STOP investigating code. Follow this protocol:**

1. **Add ONE log** at the WebSocket message entry point:
   ```typescript
   // GameRoom.ts, start of handleMessage:
   console.log(`[GameRoom] >>> RECEIVED: ${data.type}`);
   ```

2. **Deploy** that single change

3. **Test** Quick Play → click START YOUR TURN

4. **Report** whether `>>> RECEIVED: DICE_ROLL` appears in wrangler tail

**Do not check any more code until you have this data.**

---

## Why Agents Struggle Here

The agent's training optimizes for "being helpful" which often means "showing work" by looking at lots of code. But debugging requires a different skill: **hypothesis testing**.

The agent needs explicit permission to:
- Make small changes
- Deploy without being "sure" it's the fix
- Report "I don't know yet, here's what I learned"

Without this framing, the agent keeps looking for the answer in the code when the answer is only available at runtime.

## For Your Workflow Documents

Consider adding a `.claude/DEBUGGING.md` that contains:

```markdown
# Debugging Protocol for Claude

When debugging a feature that doesn't work:

1. DO NOT read code looking for what "might be wrong"
2. DO identify the event/data chain (A → B → C → D)
3. DO add ONE log at the midpoint
4. DO deploy and test
5. DO report what the log shows
6. DO binary search to the failure point

You have permission to deploy "just for logging" without a complete fix.
```

This gives the agent a procedural guide instead of letting it fall into analysis paralysis.
