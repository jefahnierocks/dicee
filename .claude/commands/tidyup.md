# Session Tidyup

Clean up the development session, persist state, and prepare handoff notes.

## Instructions

Run these tasks in order before ending the session:

### 1. Update Phase State

Read and update `.claude/state/current-phase.json`:
- Update `lastUpdated` timestamp to current ISO time
- Update `lastAgent` to the current agent (claude-code, windsurf, codex)
- Update `lastSession.date` to today's date
- Update `lastSession.work` with a brief summary of completed work

### 2. Update MCP Memory Graph

Add any significant observations to the knowledge graph:
- New patterns discovered
- Decisions made
- Blockers encountered
- Test counts if tests were run

Use `mcp__memory__add_observations` to update relevant entities.

### 3. Generate Handoff Notes

Update `.claude/state/session-handoff.md` with:

```markdown
# Session Handoff Notes

**Date**: [today's date]
**Phase**: [current phase]
**Status**: [in-progress tasks summary]
**Test Suite**: [test count if known]

---

## Latest: [Brief title of work done]

**Completed**: [date]
**Scope**: [what was worked on]

### Summary
[2-3 bullet points of what was accomplished]

### Files Modified
[List key files that were changed]

---

## Next Steps

[Bulleted list of recommended next actions]

---

## Quality Gate Status

```bash
# Status at session end
pnpm exec tsc      # [PASS/FAIL]
pnpm test          # [X tests - PASS/FAIL]
pnpm build         # [PASS/FAIL]
```

---

**Session Updated**: [timestamp]
**Latest Work**: [one-line summary]
**Next Action**: [primary next step]
**Current Phase**: [phase name]
```

### 4. Run Final Quality Check

Execute quick quality verification:
```bash
pnpm exec tsc --noEmit 2>&1 | tail -3
```

Report any issues that should be noted for the next session.

### 5. Archive Tool Log (Optional)

If `.claude/state/tool-log.jsonl` is large (>1000 lines), suggest archiving:
```bash
wc -l .claude/state/tool-log.jsonl
```

If large, recommend running the archive hook manually or note it for next session.

## Output Format

```
## Session Tidied Up

### State Updates
- ✓ Updated current-phase.json (lastUpdated: [timestamp])
- ✓ Updated durable handoff artifacts
- ✓ Generated handoff notes

### Session Summary
- **Work Completed**: [brief summary]
- **Tasks Completed**: [count]
- **Tests Status**: [pass/fail count]

### Quality Gate
- TypeScript: ✓ Clean
- Tests: [X] passing

### Handoff Ready
Next agent can pick up with: [primary next task]

### Reminders
- [Any notes for next session]
- [Any blockers to address]
```

## When to Use

Run `/tidyup` when:
- Ending a work session
- Handing off to another agent (Claude, Windsurf, Codex)
- Before context compaction
- After completing a significant task

## Notes

- Always run `/tidyup` before ending a session
- Handoff notes are critical for session continuity
- Update timestamps ensure accurate state tracking
- Durable handoffs, source, tests, and Git history provide cross-session context
