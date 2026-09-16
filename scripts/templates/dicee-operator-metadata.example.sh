#!/usr/bin/env bash
# shellcheck disable=SC2034 # This file is sourced by operator wrappers.

# Copy to .dicee/operator-metadata.sh, replace every placeholder from the
# private operator inventory, and set mode 0600. Never commit the populated
# file. This file contains identifiers only; credential values remain in the
# configured secret manager.

# Required by every credential launcher; the loader fails closed without them.
DICEE_OP_ACCOUNT="your-account.1password.com"
DICEE_OP_VAULT="your-private-vault"
DICEE_OP_ITEM_CLOUDFLARE="your-cloudflare-item"
DICEE_OP_ITEM_ELEVENLABS_LOCAL="your-local-audio-item"
DICEE_CLOUDFLARE_ACCOUNT_ID="00000000000000000000000000000000"

# Required by the scripts that declare them, not by the launchers.
DICEE_SUPABASE_PROJECT_REF="your-project-ref"

# Non-secret identifiers kept for operator reference.
DICEE_CLOUDFLARE_DOMAIN="example.com"
DICEE_SUPABASE_PROJECT_NAME="your-project"
DICEE_AUDIO_PROJECT_NAME="your-audio-project"
