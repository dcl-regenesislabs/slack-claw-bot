#!/usr/bin/env bash
set -euo pipefail

APP_NAME="slack-claw-bot"
ENV_FILE=".env"

# --- Install flyctl if missing ---
if ! command -v fly &>/dev/null; then
  echo "Installing flyctl..."
  curl -L https://fly.io/install.sh | sh
fi

# --- Login if not already ---
if ! fly auth whoami &>/dev/null; then
  echo "Logging in to Fly.io..."
  fly auth login
fi

# --- Create app if it doesn't exist ---
if ! fly status --app "$APP_NAME" &>/dev/null 2>&1; then
  echo "Creating app $APP_NAME..."
  fly launch --no-deploy --copy-config --name "$APP_NAME"
else
  echo "App $APP_NAME already exists."
fi

# --- Sync secrets from .env ---
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE not found. Copy .env.default to .env and fill in your values."
  exit 1
fi

echo "Setting secrets from $ENV_FILE..."
SECRETS_ARGS=()
while IFS= read -r line; do
  # skip comments and blank lines
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  SECRETS_ARGS+=("$line")
done < "$ENV_FILE"

if [[ ${#SECRETS_ARGS[@]} -gt 0 ]]; then
  fly secrets set "${SECRETS_ARGS[@]}" --app "$APP_NAME"
fi

# --- Deploy ---
echo "Deploying..."
fly deploy --app "$APP_NAME"

echo ""
echo "Done! Useful commands:"
echo "  fly logs          # tail logs"
echo "  fly status        # check app status"
echo "  fly ssh console   # shell into container"
