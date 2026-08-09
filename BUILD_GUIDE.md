# Ayat Flow Build Guide

## Safe APK Build Process

This project has been configured to safely build APKs while preserving all custom Android changes (including the widget implementation).

## Build Scripts

### 1. Build Release APK (Recommended)
```bash
npm run build:apk
```

This script:
- Builds a release APK using the existing android folder
- Names the APK with version and timestamp: `Ayat Flow_v0.1.0_build20250109_123456.apk`
- Copies the APK to your Downloads folder
- Preserves all custom Android changes

### 2. Manual Gradle Build
```bash
cd android
./gradlew assembleRelease
```

The APK will be at: `android/app/build/outputs/apk/release/app-release.apk`

## Important Notes

### ⚠️ Prebuild Warning
**DO NOT run** `npx expo prebuild` or `eas build` unless you want to regenerate the entire android folder. These commands will:
- Delete your android folder
- Regenerate it from scratch
- **Destroy your custom widget implementation**

### When to Use Prebuild
Only run prebuild if:
- You need to regenerate the android folder from scratch
- You've made changes to app.json that require native code generation
- You're setting up the project for the first time

After running prebuild, you'll need to:
1. Re-add all widget files (AyahWidgetProvider.kt, AyahWidgetModule.kt, etc.)
2. Re-add widget XML files
3. Re-update AndroidManifest.xml
4. Re-add quran-data.json to android assets
5. Re-add the AyahWidgetPackage to MainApplication.kt

### Safe Workflow
1. Use `npm run build:apk` for regular builds
2. Make changes to the existing android folder manually
3. Never run prebuild unless absolutely necessary
4. Keep backups of your android folder before major changes

## APK Versioning

The build script automatically:
- Reads version from `app.json`
- Includes version in APK filename
- Adds timestamp for unique identification
- Places APK in Downloads folder

## Troubleshooting

### Build Fails
1. Check that Java SDK is installed: `java -version`
2. Check that Android SDK is installed: `echo $ANDROID_HOME`
3. Try cleaning build: `cd android && ./gradlew clean`
4. Check Gradle wrapper: `cd android && ./gradlew --version`

### Widget Not Working After Build
1. Verify AyahWidgetProvider.kt exists in android/app/src/main/java/com/hasnadeeb/ayahflow/
2. Check AndroidManifest.xml has the widget receiver
3. Verify widget XML files exist in android/app/src/main/res/xml/
4. Ensure quran-data.json is in android/app/src/main/assets/

### APK Not Found
1. Check android/app/build/outputs/apk/release/ directory
2. Verify build completed successfully
3. Check for build errors in the console output

## Development vs Production

### Development
- Use `npx expo start` for development
- Use `npx expo run:android` to run on connected device
- These preserve your android folder

### Production
- Use `npm run build:apk` for release builds
- This uses your existing android folder with all customizations
- Safe for production deployment