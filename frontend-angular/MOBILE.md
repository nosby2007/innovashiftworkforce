# InnovaShift Workforce Mobile Build

InnovaShift Workforce is now configured as both:

- a production PWA served by Firebase Hosting
- a Capacitor mobile app for Android and iOS

## PWA

Build:

```powershell
npm run build:pwa
```

Deploy from the repository root:

```powershell
firebase deploy --only "hosting" --project atlanta-e04aa --non-interactive
```

Production URL:

```text
https://atlanta-e04aa.web.app
```

On mobile, open the site in Chrome or Safari and use the browser install action to add it to the home screen.

## Capacitor

Sync web assets into native projects:

```powershell
npm run mobile:sync
```

Open Android Studio:

```powershell
npm run mobile:android
```

Open Xcode on macOS:

```powershell
npm run mobile:ios
```

## Android SDK Requirement

Android debug builds require Android Studio or a valid SDK path.

Set one of these environment variables:

```powershell
$env:ANDROID_HOME="C:\Users\<you>\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
```

Or create `android/local.properties`:

```properties
sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

Then run:

```powershell
cd android
.\gradlew.bat assembleDebug
```
