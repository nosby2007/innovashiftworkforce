# Deploying to Firebase

Every push to `main` runs `.github/workflows/deploy.yml`, which builds the
frontend and functions and runs `firebase deploy` (hosting + functions +
Firestore rules/indexes + Storage rules) against the `atlanta-e04aa`
project. Until the one-time setup below is done, the workflow builds
successfully but **skips the deploy step** with a warning — it will not
fail loudly, it just won't ship anything.

## One-time setup (do this once, from your own Google account)

### 1. Create a deploy service account

In the [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts?project=atlanta-e04aa):

1. **IAM & Admin → Service Accounts → Create Service Account**.
   - Name: `github-actions-deploy` (or anything memorable).
2. Grant it these roles:
   - **Firebase Admin** (`roles/firebase.admin`) — covers Hosting,
     Functions, Firestore rules, Storage rules.
   - **Service Account User** (`roles/iam.serviceAccountUser`) — required
     so it can deploy Cloud Functions, which run under their own service
     account.
3. Open the new service account → **Keys → Add Key → Create new key →
   JSON**. This downloads a `.json` file — treat it like a password, it
   grants deploy access to your whole project.

### 2. Add it as a GitHub secret

In the GitHub repo → **Settings → Secrets and variables → Actions → New
repository secret**:

- Name: `FIREBASE_SERVICE_ACCOUNT`
- Value: paste the **entire contents** of the JSON key file you just
  downloaded.

That's it — the next push to `main` (or a manual run via the **Actions**
tab → **Deploy → Run workflow**) will deploy for real.

### 3. Rotate/remove the key if it's ever exposed

If the JSON key is ever committed, pasted somewhere public, or you're
unsure whether it leaked, delete it immediately from **IAM & Admin →
Service Accounts → (the account) → Keys** and create a new one, then
update the GitHub secret.

## Things this workflow does *not* handle

A few pieces from earlier features need their own one-time setup and
aren't part of this deploy pipeline:

- **`ACTION_TOKEN_SECRET`** (push notification accept-links) — set via
  `firebase functions:secrets:set ACTION_TOKEN_SECRET` from your own
  machine with the Firebase CLI logged in (this is Firebase Secret
  Manager, not a GitHub secret, so CI can't set it for you).
- **Web push VAPID key** — done (`VAPID_KEY` is set in
  `push-notifications.service.ts`).
- **Native push (Android)** — done. The app is registered in Firebase
  (App ID `1:404381833719:android:5df93f9adcee078f4d36f2`) and
  `google-services.json` is committed at
  `frontend-angular/android/app/google-services.json`. iOS still needs
  `GoogleService-Info.plist` from Firebase Console if/when that platform
  is built.
- **Two-factor authentication** — Firebase Console → Authentication →
  Sign-in method → Advanced → enable Multi-Factor Authentication + TOTP.

## Android — deploy to testers (`android-distribute.yml`)

Every push to `main` that touches `frontend-angular/**` builds a debug
APK and uploads it to **Firebase App Distribution**, so testers get a
new build automatically without going through Play Store review. Two
one-time steps beyond the `FIREBASE_SERVICE_ACCOUNT` secret above:

1. **Grant the deploy service account App Distribution access** — same
   service account as the main deploy workflow, one more role: open
   [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=atlanta-e04aa)
   → the `github-actions-deploy` account → **Permissions** tab (or grant
   it from the project IAM page) → add role **Firebase App Distribution
   Admin** (`roles/firebaseappdistro.admin`).
2. **Create a tester group** — Firebase Console → your project → **App
   Distribution** → **Testers & Groups** → create a group named
   `internal-testers` (or edit the `--groups` value in
   `.github/workflows/android-distribute.yml` to match whatever name you
   use) and add tester emails to it.

This ships a **debug-signed APK** — fine for internal testers, but not
suitable for the Play Store. A real Play Store release needs a release
signing keystore (store it as a GitHub secret, never commit it) wired
into `frontend-angular/android/app/build.gradle`'s `signingConfigs`, plus
switching the workflow from `assembleDebug` to `assembleRelease` and
adding the Play Console publishing step separately.

## Manual deploy (without CI)

If you ever need to deploy from your own machine instead:

```bash
firebase login
cd frontend-angular && npm run build && cd ..
firebase deploy --project atlanta-e04aa
```
