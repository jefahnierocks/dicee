# Run Quality Gate

Run the repository completion gate before handing off a change.

## Instructions

Run the quality gate script:

```bash
./scripts/quality-gate.sh
```

It runs `pnpm validate:ci`, which is the completion gate named in `AGENTS.md`:

1. `pnpm validate`: `check` (Rust, TypeScript, Python, Worker types), `lint`
   (Rust, Python, Biome, AKG), `test:agent`, and `build`
2. `pnpm audit:dependencies`: high-severity dependency audit (queries the
   package registry)
3. `pnpm security:public`: public-safety scan of the publication candidate

Pass `--fix` to run `pnpm format` first.

If any check fails:
1. Report which check failed
2. Show the error output
3. Suggest fixes

If a lane cannot run for environment reasons (no network, missing
dependencies), name it and show the exact error instead of reporting a pass.

Run the quality gate now and report results.
