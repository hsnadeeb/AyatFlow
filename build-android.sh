#!/usr/bin/env bash
set -euo pipefail

echo "== Ayah Flow: Android build =="
echo "Node: $(node -v)"
echo "npm:  $(npm -v)"

npm install
npx expo install
npx expo doctor

echo
echo "Building preview APK with EAS..."
npx eas build --platform android --profile preview
