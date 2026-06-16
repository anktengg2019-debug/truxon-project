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

## Suggested Firestore security rules

For a quick start (open read, drivers can write their own doc — tighten with Auth in
production):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /drivers/{driverId} {
      allow read: if true;
      allow write: if true; // TODO: restrict with Firebase Auth
    }
  }
}
```
