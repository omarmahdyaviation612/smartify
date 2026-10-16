# Smartify — Android app (Trusted Web Activity)

The Android app is a **Trusted Web Activity (TWA)**: a native shell that opens
`https://smartify-ai.com/ar` full-screen inside Chrome, with no address bar.
Every website deploy updates the app instantly — you only rebuild the app to
change the icon, name, package or start URL.

Why TWA and not a WebView / Capacitor wrapper:
- Clerk's Google sign-in is blocked by Google inside WebViews; it works in a TWA.
- Clerk session cookies, the microphone (Tutor / lessons) and web push behave
  exactly like on the website.
- The Next.js app is server-rendered with Clerk middleware, so it can't be
  bundled offline anyway.

## Settings (`app/build.gradle`)

| What | Value |
|---|---|
| Package name (permanent after first Play upload) | `com.smartifyai.app` |
| Start URL | `https://smartify-ai.com/ar` |
| Status bar colour | `#0B1530` (same as web `theme_color`) |
| min / target SDK | 24 / 36 |

## Building

**GitHub Actions (no Android Studio needed):** Actions tab → "Android app (TWA)"
→ Run workflow. Download the artifact zip: it has the `.aab` (upload to Play)
and a `.apk` (install directly on a phone to test).

Without signing secrets the workflow builds only a debug APK. With the four
`SMARTIFY_*` secrets set it builds a signed release AAB + APK.

**Locally (Android Studio):** open this `apps/android` folder, create
`keystore.properties` next to `settings.gradle`:

```
storeFile=/absolute/path/to/smartify-upload.jks
storePassword=...
keyAlias=smartify-upload
keyPassword=...
```

then Build → Generate Signed App Bundle, or `gradle bundleRelease`.

## Full-screen verification (Digital Asset Links)

Chrome only hides the address bar if
`https://smartify-ai.com/.well-known/assetlinks.json` lists the SHA-256 of the
key that signed the installed app. The file lives at
`apps/frontend/public/.well-known/assetlinks.json` and is excluded from the
Clerk/locale middleware (the matcher skips any path containing a dot).

- It already contains the **upload key** fingerprint (for APKs from CI).
- After the first upload to Play with Play App Signing, copy the **App signing
  key SHA-256** from Play Console → Test and release → App integrity, add it
  as a second entry in `sha256_cert_fingerprints`, and redeploy the website.
  Without this, the Play-installed app shows a thin URL bar at the top.
- Debug APKs are signed with a throwaway debug key, so they show the URL bar.

Check it with:
https://developers.google.com/digital-asset-links/tools/generator
