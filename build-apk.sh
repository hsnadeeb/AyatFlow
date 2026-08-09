#!/bin/bash

# Safe APK Build Script for Ayat Flow
# This script builds a release APK and copies it to the Downloads folder
# It preserves all custom android folder changes

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/android"
DOWNLOADS_DIR="$HOME/Downloads"

# Get version from app.json
VERSION=$(node -e "console.log(require('$SCRIPT_DIR/app.json').expo.version)")
VERSION_CODE=$(node -e "console.log(require('$SCRIPT_DIR/app.json').expo.android.versionCode)")
APP_NAME=$(node -e "console.log(require('$SCRIPT_DIR/app.json').expo.name)")
PACKAGE_NAME=$(node -e "console.log(require('$SCRIPT_DIR/app.json').expo.android.package)")

# Create filename with version and timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
APK_FILENAME="${APP_NAME}_v${VERSION}_build${TIMESTAMP}.apk"
OUTPUT_APK="$DOWNLOADS_DIR/$APK_FILENAME"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Ayat Flow APK Build Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}App Information:${NC}"
echo -e "  Name: ${APP_NAME}"
echo -e "  Version: ${VERSION}"
echo -e "  Version Code: ${VERSION_CODE}"
echo -e "  Package: ${PACKAGE_NAME}"
echo ""
echo -e "${GREEN}Build Configuration:${NC}"
echo -e "  Output: ${OUTPUT_APK}"
echo -e "  Android Directory: ${ANDROID_DIR}"
echo ""

# Check if android directory exists
if [ ! -d "$ANDROID_DIR" ]; then
    echo -e "${RED}Error: Android directory not found at $ANDROID_DIR${NC}"
    echo -e "${YELLOW}Run 'npx expo prebuild' first to generate the android folder${NC}"
    exit 1
fi

# Check if gradlew exists
if [ ! -f "$ANDROID_DIR/gradlew" ]; then
    echo -e "${RED}Error: gradlew not found in android directory${NC}"
    exit 1
fi

# Make gradlew executable
chmod +x "$ANDROID_DIR/gradlew"

echo -e "${YELLOW}Building release APK...${NC}"
echo ""

# Navigate to android directory and build
cd "$ANDROID_DIR"

# Clean build to ensure fresh compilation
echo -e "${BLUE}Cleaning previous builds...${NC}"
./gradlew clean

# Build release APK
echo -e "${BLUE}Building release APK...${NC}"
./gradlew assembleRelease

# Find the generated APK
APK_PATH=$(find "$ANDROID_DIR/app/build/outputs/apk/release" -name "*.apk" | head -n 1)

if [ -z "$APK_PATH" ]; then
    echo -e "${RED}Error: APK build failed - no APK file found${NC}"
    exit 1
fi

echo -e "${GREEN}APK built successfully at: $APK_PATH${NC}"
echo ""

# Copy to Downloads folder
echo -e "${BLUE}Copying APK to Downloads folder...${NC}"
cp "$APK_PATH" "$OUTPUT_APK"

if [ -f "$OUTPUT_APK" ]; then
    echo -e "${GREEN}✓ APK copied to: $OUTPUT_APK${NC}"
    echo ""
    
    # Get file size
    FILE_SIZE=$(du -h "$OUTPUT_APK" | cut -f1)
    echo -e "${GREEN}Build Summary:${NC}"
    echo -e "  File: $APK_FILENAME"
    echo -e "  Size: $FILE_SIZE"
    echo -e "  Location: $OUTPUT_APK"
    echo ""
    echo -e "${GREEN}✓ Build completed successfully!${NC}"
else
    echo -e "${RED}Error: Failed to copy APK to Downloads folder${NC}"
    exit 1
fi

# Navigate back to project root
cd "$SCRIPT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}Build completed successfully!${NC}"
echo -e "${BLUE}========================================${NC}"