#!/bin/bash
# One-click deploy to Cloudflare Pages
# Usage: PROJECT_NAME=my-site bash scripts/deploy.sh

set -e

PROJECT_NAME="${PROJECT_NAME:?PROJECT_NAME is required. Example: PROJECT_NAME=my-site bash scripts/deploy.sh}"

echo "[1/3] Building..."
npm run build

echo "[2/3] Deploying to Cloudflare Pages (project: $PROJECT_NAME)..."
npx wrangler pages deploy dist --project-name="$PROJECT_NAME"

echo "[3/3] Done. Check: https://dash.cloudflare.com/pages"
