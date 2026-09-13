#!/usr/bin/env bash
# shellcheck disable=SC2034 # This file is sourced by operator wrappers.

# Copy to .dicee/operator-metadata.sh, replace every placeholder from the
# private operator inventory, and set mode 0600. Never commit the populated
# file. This file contains identifiers only; credential values remain in the
# configured secret manager.

DICEE_OP_ACCOUNT="your-account.1password.com"
DICEE_OP_VAULT="your-private-vault"

DICEE_OP_ITEM_INFISICAL_DEV="your-infisical-dev-item"
DICEE_OP_ITEM_INFISICAL_STAGING="your-infisical-staging-item"
DICEE_OP_ITEM_INFISICAL_PROD="your-infisical-production-item"
DICEE_OP_ITEM_CLOUDFLARE="your-cloudflare-item"
DICEE_OP_ITEM_VERCEL="your-optional-vercel-item"
DICEE_OP_ITEM_PARTYKIT="your-optional-partykit-item"
DICEE_OP_ITEM_ELEVENLABS_LOCAL="your-optional-elevenlabs-item"

DICEE_INFISICAL_INSTANCE_URL="https://infisical.example.com"
DICEE_INFISICAL_PROJECT_ID="00000000-0000-4000-8000-000000000000"
DICEE_INFISICAL_PROJECT_SLUG="your-project-slug"
DICEE_INFISICAL_ORG_NAME="your-organization"

DICEE_INFISICAL_DEV_IDENTITY_NAME="your-development-identity"
DICEE_INFISICAL_DEV_IDENTITY_ID="00000000-0000-4000-8000-000000000000"
DICEE_INFISICAL_STAGING_IDENTITY_NAME="your-staging-identity"
DICEE_INFISICAL_STAGING_IDENTITY_ID="00000000-0000-4000-8000-000000000000"
DICEE_INFISICAL_PROD_IDENTITY_NAME="your-production-identity"
DICEE_INFISICAL_PROD_IDENTITY_ID="00000000-0000-4000-8000-000000000000"

DICEE_CLOUDFLARE_ACCOUNT_ID="00000000000000000000000000000000"
DICEE_CLOUDFLARE_DOMAIN="example.com"
DICEE_SUPABASE_PROJECT_NAME="your-project"
DICEE_SUPABASE_PROJECT_REF="your-project-ref"
DICEE_VERCEL_PROJECT_NAME="your-optional-vercel-project"
DICEE_PARTYKIT_PROJECT_NAME="your-optional-partykit-project"
DICEE_AUDIO_PROJECT_NAME="your-audio-project"
