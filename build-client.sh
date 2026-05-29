#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/client"
PUBLIC_DIR="$SCRIPT_DIR/gateway/public"

echo "[1/3] Installing client dependencies..."
cd "$CLIENT_DIR"
npm install

echo "[2/3] Building client..."
npm run build

echo "[3/3] Copying dist to gateway/public..."
mkdir -p "$PUBLIC_DIR"
rm -rf "$PUBLIC_DIR"/*
cp -r "$CLIENT_DIR/dist/." "$PUBLIC_DIR/"

echo "Done. Client deployed to gateway/public."
