# Audio Generation System

This document covers the project-level flow for generating and shipping audio assets.

## Overview

Dicee uses the ElevenLabs Sound Effects API through the `audio-gen` CLI in `packages/web/src/tools/audio-gen/`.

- asset generation happens on an operator machine
- generated files are committed into `packages/web/static/audio/`
- Cloudflare Pages serves the resulting static audio files directly

## Secret Handling

The ElevenLabs key used for local generation is a local operator/bootstrap secret.

- source of truth: the operator-selected item named in the ignored metadata file
- field: `api-key`
- entrypoint: `./scripts/with-dicee-elevenlabs-local.sh`

Do not persist `ELEVENLABS_API_KEY` into shell startup files.

If the application itself ever needs ElevenLabs at runtime, that runtime key belongs in Infisical and must be treated separately from the local generation key.

## Standard Workflow

```bash
pnpm audio:list
pnpm audio:status
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --phase mvp --dry-run
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --phase mvp
```

After generation:

1. review or post-process the files if needed
2. update `packages/web/src/lib/services/audio.ts` if a new asset path is required
3. commit the generated audio files
4. deploy normally through the existing Cloudflare Pages flow

## Production Flow

1. `audio-gen` writes files into `packages/web/static/audio/`
2. SvelteKit copies `static/` into `.svelte-kit/cloudflare`
3. Cloudflare Pages serves those files as static assets
4. the browser fetches `/audio/...` directly from Pages/CDN output

## Troubleshooting

### Missing `ELEVENLABS_API_KEY`

Use the wrapper:

```bash
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --asset MVP-01
```

### Failed generation entries

```bash
cat packages/web/static/audio/generation-manifest.json | jq '.results | to_entries[] | select(.value.status == "failed")'
```
