# Truxon — Real-time GPS Truck Tracking

Real-time driver/truck tracking built with **Leaflet** maps and **Firebase Firestore**.
Drivers broadcast their live coordinates every 5 seconds and a dashboard shows the
trucks moving on the map in real time.

## Features

- **Driver mode** (`/driver.html`): publishes live position to Firestore every 5 seconds,
  using either the browser's real GPS (`navigator.geolocation`) or a built-in route
  simulation (handy for demos / desktops without GPS).
- **Dashboard** (`/index.html`): subscribes to Firestore with `onSnapshot` and renders
  every truck as a heading-aware marker. Markers **animate smoothly** between updates
  instead of jumping, and stale trucks (no update for 30s) fade out.
- **Demo/offline mode**: if Firebase isn't configured (or `?demo=1` is passed to the
  dashboard), fake trucks are simulated locally so the UI still works.

## Data model

Firestore collection `drivers`, one document per driver (doc id = driver/truck id):

```
drivers/{driverId} = {
  name:      string,
  lat:       number,
  lng:       number,
  heading:   number,   // degrees, 0 = north
  speed:     number,   // km/h
  status:    string,   // "active"
  updatedAt: serverTimestamp
}
```

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure Firebase. Copy `.env.example` to `.env` and fill in your web app config
   (Firebase console → Project settings → Your apps → SDK setup and configuration):

   ```bash
   cp .env.example .env
   ```

   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   VITE_FIREBASE_DATABASE_URL=...
   ```

   > Firebase web config values are not secrets (they ship in the client bundle),
   > but `.env` is git-ignored to keep project-specific values out of the repo.

3. Enable **Cloud Firestore** in the Firebase console (Build → Firestore Database →
   Create database). For local testing you can start in test mode; for production use
   the rules below.

4. **Authentication.** The app signs in anonymously so Firestore writes/reads carry an
   auth token (required by the production rules below). Enable it in the Firebase console:
   Build → Authentication → Sign-in method → **Anonymous** → Enable. Anonymous sign-in is
   best-effort: if it's disabled the app still works against fully-open (`if true`) rules,
   but auth-gated rules will return `permission-denied` until you enable it.

5. **App Check (optional).** If you turn on App Check enforcement for Cloud Firestore,
   all client requests need a valid App Check token. Register the web app in the console
   (App Check → Apps), create a reCAPTCHA v3 site key, and set `VITE_FIREBASE_APPCHECK_SITE_KEY`
   in `.env`. Leave it empty if App Check is not enforced.

   > Troubleshooting `permission-denied`: it means the request reached Firestore and was
   > rejected by the server, not an app bug. Check, in order: (a) App Check enforcement is
   > off OR a site key is configured, (b) the rules below are published on the **(default)**
   > database, (c) Anonymous Authentication is enabled.

## Run

```bash
npm run dev       # dev server at http://localhost:5173
```

- Open `http://localhost:5173/` for the dashboard.
- Open `http://localhost:5173/driver.html` for driver mode (enter an ID, pick GPS or
  Simulate, then Start broadcasting).
- Open `http://localhost:5173/?demo=1` to force the offline simulation.

Build for production:

```bash
npm run build
npm run preview
```

## Firestore security rules (role-based)

The production rules live in [`firestore.rules`](./firestore.rules) and gate `drivers`
access on a per-user **profile document** at `users/{uid}`:

- `signedIn()` — `request.auth != null`
- `isOps()` — signed in **and** `users/{uid}` exists (uses `exists()`, so a missing doc or
  missing `role` field returns `false` instead of crashing the rule)
- `isAdmin()` — signed in and `users/{uid}.role == 'admin'`
- `users/{uid}` — each user can self-create/read/update their own profile (the bootstrap
  that lets `isOps()`/`isAdmin()` evaluate); admins can read any profile
- `drivers/{driverId}` — read/write allowed for `isOps()` users

The app provisions the profile automatically: on first sign-in `src/firebase.js` calls
`ensureUserProfile()`, which creates `users/{uid} = { role: "user", createdAt }` if it
doesn't exist (and backfills `role` if missing) **before** any driver read/write.

Deploy the rules (Firebase CLI):

```bash
firebase deploy --only firestore:rules
```

…or paste `firestore.rules` into the console (Firestore Database → Rules → Publish).

> **Prerequisite:** a sign-in method must be enabled, otherwise there is no `uid` to create
> `users/{uid}` and every request is `permission-denied`. Enable **Authentication →
> Sign-in method → Anonymous** (simplest) or another provider.
>
> For a quick local test without auth you can temporarily publish fully-open rules
> (`allow read, write: if true;` on `drivers/{driverId}`) — do **not** ship these.
