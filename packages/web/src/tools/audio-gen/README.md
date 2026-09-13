# Audio Generation Tool

CLI support for generating audio assets with the ElevenLabs Sound Effects API.

## Secret Handling

Local audio generation is an operator workflow, not a runtime/app secret workflow.

- Store the local-only ElevenLabs key in an operator-selected credential-manager item
- Run the generator through `./scripts/with-dicee-elevenlabs-local.sh`
- Do not export `ELEVENLABS_API_KEY` into your shell startup files
- If the application ever needs an ElevenLabs runtime key, store that separate key in Infisical instead

## Quick Start

```bash
pnpm audio:list
pnpm audio:status
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --phase mvp --dry-run
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --phase mvp
```

## Commands

```bash
pnpm audio:list
pnpm audio:status
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --asset MVP-01
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --category dice
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --phase mvp --verbose
```

## Asset Flow

1. Generate files into `packages/web/static/audio/`
2. Commit the resulting audio assets
3. SvelteKit copies `static/` into `.svelte-kit/cloudflare`
4. Cloudflare Pages serves the files directly from static asset output

## Troubleshooting

### `ELEVENLABS_API_KEY` is not set

Run the command through the wrapper instead of setting the variable yourself:

```bash
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --phase mvp
```

### 401 or 429 responses

- 401: rotate or replace the local-only key in 1Password
- 429: wait and retry with a smaller batch

### Failed generation entries

```bash
cat packages/web/static/audio/generation-manifest.json | jq '.results | to_entries[] | select(.value.status == "failed")'
```

## References

- `docs/audio-generation.md`
- `docs/references/audio-plan.md`
- `packages/web/src/lib/services/audio.ts`
