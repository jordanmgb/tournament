# Maccabi GB Tournament Hub — Setup Guide

Everything below can be done from a web browser. No software installs required.

## Step 1 — Create a Firebase project

1. Go to https://firebase.google.com and sign in with any Google account.
2. Click **Go to console** → **Create a project**.
3. Give it a name (e.g. `maccabi-tournament`) and click through the
   defaults (you can disable Google Analytics, it isn't needed).
4. Once the project is created, click the **web icon (`</>`)** on the
   project overview page to register a new web app. Give it a nickname
   (e.g. "Tournament Hub") and click **Register app**.
5. Firebase will show you a `firebaseConfig` object with values like
   `apiKey`, `authDomain`, `projectId`, etc. Copy all of it.
6. Open `src/firebase.js` in this project and paste your values in,
   replacing the placeholder `"YOUR_API_KEY"` etc.

## Step 2 — Turn on Firestore (the database)

1. In the Firebase console, left-hand menu → **Build** → **Firestore Database**.
2. Click **Create database**. Choose a location close to your users
   (e.g. `europe-west2` for London) and start in **test mode** for now.
3. **Important:** test mode allows anyone to read and write for 30 days,
   then locks everything. Before that expires, go to the **Rules** tab
   and replace the rules with something like:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /tournaments/{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```

   This keeps the tournament document open to read/write from any
   device (needed for the spectator + organiser live sync to work) —
   it does **not** add a password of its own. The app's own login
   screen is still the only thing gating the organiser controls, and
   as noted below that check currently lives in the browser code, not
   on the server. Locking Firestore down further (e.g. requiring
   Firebase Auth to write) is a reasonable next step once you're ready
   to move the organiser password server-side too.

## Step 3 — Put the code on GitHub

1. Go to https://github.com and create a free account if you don't
   have one.
2. Click **New repository**, name it (e.g. `tournament-hub`), keep it
   **Public** or **Private** (either works with Vercel's free tier),
   and click **Create repository**.
3. On the empty repo page, click **uploading an existing file**.
4. Drag every file and folder from this project (`index.html`,
   `package.json`, `vite.config.js`, `.gitignore`, and the whole `src`
   folder) into the upload box, then click **Commit changes**.

## Step 4 — Deploy with Vercel

1. Go to https://vercel.com and sign up using your GitHub account
   (this lets Vercel see your repos without a separate password).
2. Click **Add New** → **Project**, then find and **Import** the
   `tournament-hub` repo you just created.
3. Vercel will auto-detect it as a Vite project — leave the default
   settings and click **Deploy**.
4. After a minute or two you'll get a live URL like
   `tournament-hub-yourname.vercel.app`. That's the real, working app —
   put this URL on your QR code / posters.
5. Every time you (or I) update the code on GitHub, Vercel
   automatically redeploys the live site within a minute or so.

## Known limitation to revisit

The organiser password (`MaccabiGB`) is currently checked in the
browser's JavaScript, which means it's technically visible to anyone
who views the page source — fine for a low-stakes internal tool, not
fine if this ever guards anything sensitive. Moving it to Firebase
Auth (so the check happens server-side) is the natural next step once
the rest of this is live and tested.
