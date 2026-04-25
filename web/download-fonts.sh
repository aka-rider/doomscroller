#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p public/fonts

# Google Fonts API serves different files based on User-Agent.
# Use a modern Chrome UA to get woff2.
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Source Serif 4 — variable weight (roman)
CSS_URL="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,300..900&display=swap"
CSS=$(curl -s -A "$UA" "$CSS_URL")
echo "$CSS" | grep -oE 'https://[^)]+\.woff2' | tail -1 | xargs -I{} curl -s -o public/fonts/source-serif-4-latin.woff2 "{}"

# Source Serif 4 — variable weight (italic)
CSS_URL="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@1,8..60,300..900&display=swap"
CSS=$(curl -s -A "$UA" "$CSS_URL")
echo "$CSS" | grep -oE 'https://[^)]+\.woff2' | tail -1 | xargs -I{} curl -s -o public/fonts/source-serif-4-latin-italic.woff2 "{}" 2>/dev/null || true

# Inter — variable weight
CSS_URL="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap"
CSS=$(curl -s -A "$UA" "$CSS_URL")
echo "$CSS" | grep -oE 'https://[^)]+\.woff2' | tail -1 | xargs -I{} curl -s -o public/fonts/inter-latin.woff2 "{}"

# JetBrains Mono
CSS_URL="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&display=swap"
CSS=$(curl -s -A "$UA" "$CSS_URL")
echo "$CSS" | grep -oE 'https://[^)]+\.woff2' | tail -1 | xargs -I{} curl -s -o public/fonts/jetbrains-mono-latin.woff2 "{}"

echo "Fonts downloaded to public/fonts/"
ls -la public/fonts/
