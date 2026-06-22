# Truxon — Real-time GPS Truck Tracking

Real-time driver/truck tracking built with **Leaflet** maps and **Firebase Firestore**,
behind a production auth system (Google, Email OTP, Email + Password).

## Features

- **Authentication** (`/login.html`, `/signup.html`):
  - **Continue with Google** (one-click)
  - **Email OTP** — a 6-digit code emailed to the user (server-generated, hashed at rest,
    5-minute expiry, max 3 attempts, rate-limited)
  - **Email + Password** — with forgot-password / reset email and email verification
  - Session persistence (auto-login), logout, and route protection on every page
- **Driver mode** (`/driver.html`): publishes live position to Firestore every 5 seconds,
  using either the browser's real GPS (`navigator.geolocation`) or a route simulation.
- **Dashboard** (`/index.html`): subscribes with `onSnapshot` and renders each truck as a
  heading-aware marker that animates smoothly between updates; stale trucks fade out.

## Auth methods

| Method | Where | Notes |
| --- | --- | --- |
| Google | client (`signInWithPopup`) | enable Google provider in Firebase console |
| Email + Password | client | enable Email/Password provider; sends verification + reset emails |
| Email OTP (6-digit) | serverless (`api/auth/*`) | needs Admin SDK + SMTP (see deployment) |

There is **no** anonymous auth, **no** phone auth, **no** reCAPTCHA, and no
`appVerificationDisabledForTesting`.

## Data model

```
users/{uid} = {
  uid, name, email, phone,
  role,              // customer | transporter | vendor | driver | admin
  createdAt, lastLogin,
  isVerified,        // email verified
  profileCompleted   // name + phone present
}

drivers/{driverId} = {
  name, lat, lng, heading, speed, status, updatedAt
}

emailOtps/{hash(email)} = {   // server-only (Admin SDK); clients are denied
  email, hash, salt, expiresAt, attempts, sendCount, windowStart, lastSentAt, createdAt
}
```

## Roles

`customer`, `transporter`, `vendor`, `driver`, `admin`. Signup may self-assign any role
**except `admin`** (admin is granted out-of-band via the Admin SDK / console). Only
`transporter | vendor | driver | admin` may write `drivers` positions; any signed-in user
with a profile may read the fleet.

## Setup (local)

```bash
npm install
cp .env.example .env   # fill in VITE_FIREBASE_* (client) values
npm run dev            # http://localhost:5173
```

In the Firebase console:

1. **Firestore** — Build → Firestore Database → Create database (default).
2. **Auth providers** — Build → Authentication → Sign-in method → enable **Google** and
   **Email/Password**.
3. **Rules** — publish [`firestore.rules`](./firestore.rules) (see below).

Pages:
- `/login.html` — sign in (Google / Email OTP / Email + Password)
- `/signup.html` — create an account (name, email, phone, password, role)
- `/index.html` — dashboard (protected)
- `/driver.html` — driver broadcast (protected)

## Email OTP backend (serverless)

The 6-digit Email OTP requires a small backend (cannot be done safely client-side). It runs
as **Vercel serverless functions** under [`api/auth/`](./api/auth):

- `POST /api/auth/request-otp { email }` — generates a code, stores **only its salted SHA-256
  hash** with a 5-minute expiry, rate-limits (1/min, 5/hour), and emails the code.
- `POST /api/auth/verify-otp { email, code }` — checks expiry + attempt count (max 3),
  provisions/looks up the Firebase user, ensures the `users/{uid}` profile, and returns a
  **custom token** the client exchanges via `signInWithCustomToken`.

Required server env vars (Vercel → Project → Settings → Environment Variables, and a local
`.env` for `vercel dev`):

| Var | Purpose |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | Admin SDK credentials (service account JSON, raw or base64). Firebase console → Project settings → Service accounts → Generate new private key. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP for sending the code (Gmail app password, SendGrid, Mailgun, SES, …). |

> Custom-token sign-in (Email OTP) requires the Firebase project to be on the **Blaze** plan
> only if you also use other paid features; custom tokens themselves work on Spark. SMTP is
> any provider you choose.

## Deployment steps

1. Push to GitHub; import the repo into **Vercel** (framework auto-detected as Vite).
2. Set **client** env vars on Vercel: all `VITE_FIREBASE_*` (so the deployed bundle talks to
   Firebase — `.env` is git-ignored and not deployed).
3. Set **server** env vars on Vercel: `FIREBASE_SERVICE_ACCOUNT` + the `SMTP_*` set.
4. In Firebase console: enable **Google** and **Email/Password** providers; add the Vercel
   domain under Authentication → Settings → **Authorized domains**.
5. Deploy `firestore.rules`:
   ```bash
   firebase deploy --only firestore:rules
   ```
   …or paste [`firestore.rules`](./firestore.rules) into Firestore Database → Rules → Publish
   on the **(default)** database.
6. Verify: visit `/login.html`, sign in with Google, confirm you land on the dashboard and a
   `users/{uid}` doc was created.

## Build

```bash
npm run build
npm run preview
```

## Firestore security rules (role-based)

Defined in [`firestore.rules`](./firestore.rules):

- `signedIn()` — `request.auth != null`
- `isOps()` — signed in **and** `users/{uid}` exists (`exists()` keeps the rule from crashing
  when the doc/role is missing — it returns `false`)
- `hasRole([...])` / `isAdmin()` — role-gated checks reading `users/{uid}.role`
- `users/{uid}` — owner self-creates with a **non-admin** role and can never change their own
  role; admins can read any profile
- `drivers/{driverId}` — read for any `isOps()` user; write for `transporter/vendor/driver/admin`
- `emailOtps/{id}` — `allow read, write: if false` (only the Admin SDK touches it)
