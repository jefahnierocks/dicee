# Audio generation tool

A CLI that generates Dicee's sound assets with the ElevenLabs Sound Effects API. Generation is an operator workflow on a local machine. The app ships only the committed audio files; there is no runtime ElevenLabs key.

## Commands

```bash
pnpm audio:list
pnpm audio:status
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --phase mvp --dry-run
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --phase mvp
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --asset MVP-01
./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen -- --category dice --verbose
```

The flags are `--asset <id>`, `--phase mvp|complete`, `--category <name>`, `--output <dir>`, `--dry-run`, `--verbose`, `--list`, `--status` and `--help` (`cli/generate.ts`). Always run a dry run before a paid batch.

## Secret handling

- Keep the local-only ElevenLabs key in the operator's 1Password item.
- `./scripts/with-dicee-elevenlabs-local.sh` reads the key at launch and passes it to one child process through the environment.
- Never export `ELEVENLABS_API_KEY` from shell startup files or `.envrc`.

## Asset flow

1. `audio:gen` writes files into `packages/web/static/audio/`: sound effects under `packages/web/static/audio/sfx/`, ambience under `packages/web/static/audio/ambient/`, and results in `packages/web/static/audio/generation-manifest.json`.
2. Review the files and commit them.
3. The SvelteKit Cloudflare adapter copies `static/` into the Pages build output, so the browser fetches `/audio/...` from Pages.
4. The player in `packages/web/src/lib/services/audio.ts` maps sounds to `/audio/sfx/{category}/{file}.ogg`. Update its sound bank when you add a sound.

Shipping the new files follows the normal deploy path in [docs/cloudflare.md](../../../../../docs/cloudflare.md).

## Audio plan

The asset list is the plan: `config/assets.ts` defines every asset with its ID, category, phase (`mvp` or `complete`) and generation prompt, and `schema/assets.schema.ts` validates it. Change the plan there, then check it with `pnpm audio:list` and `pnpm audio:status`.

## Troubleshooting

- **`ELEVENLABS_API_KEY` is not set.** Run the command through `./scripts/with-dicee-elevenlabs-local.sh` instead of setting the variable yourself.
- **401.** Replace the local-only key in 1Password.
- **429.** Wait, then retry with a smaller batch (`--asset` or `--category`).
- **Failed entries.** List them from the manifest:

```bash
jq '.results | to_entries[] | select(.value.status == "failed")' packages/web/static/audio/generation-manifest.json
```

## ElevenLabs API references

- [API authentication](https://elevenlabs.io/docs/api-reference/authentication): the key travels in the `xi-api-key` header (`API_KEY_HEADER` in `schema/elevenlabs.schema.ts`).
- [Create sound effect](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert): `POST /v1/sound-generation` (`SOUND_EFFECTS_ENDPOINT`).
- The client in `client/elevenlabs.ts` uses `https://api.elevenlabs.io` unless `ELEVENLABS_BASE_URL` is set. It also reads `ELEVENLABS_TIMEOUT_MS`, `ELEVENLABS_RETRIES` and `ELEVENLABS_RETRY_DELAY_MS`.
