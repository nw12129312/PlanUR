# Saving plans and Google sign-in

Plans save automatically, a moment after each change.

- **Signed out (the default):** plans are kept in this browser's
  localStorage. No account is needed. Clearing site data removes them.
- **Signed in with Google (optional):** plans are saved to the student's
  account in Cloud Firestore and stay in sync on every device they sign in on.
  Changes made on another device show up without a reload.

When someone signs in, the plans already saved in this browser are added to
their account, and the account's plans are downloaded. If the same plan exists
in both places, the most recently edited copy wins. Plans deleted on one device
are deleted on the others.

When someone signs out, their account's plans are removed from this browser
(they stay in the account), so the next person on a shared computer doesn't
see them. Anything that hadn't reached the account yet is sent first; if the
account can't be reached, the copy stays on the device and syncs at the next
sign-in.

Sign-in is hidden until Firebase is configured, so the app works as before
until the steps below are done.

## Setting up Firebase (about 10 minutes, free tier is enough)

1. Go to https://console.firebase.google.com and click **Create a project**.
   Google Analytics is not needed.
2. **Build > Authentication > Get started > Sign-in method > Google**, turn it
   on, pick a support email and save.
3. **Authentication > Settings > Authorized domains**: add the domain the app
   is hosted on (localhost is already there).
4. **Build > Firestore Database > Create database**. Pick a location near
   Rochester (e.g. `nam5` or `us-east4`) and start in **production mode**.
5. In Firestore, open the **Rules** tab, paste the contents of
   [`firestore.rules`](../firestore.rules) and click **Publish**.
6. **Project settings** (gear icon) **> General > Your apps > Web (`</>`)**.
   Register an app (no Hosting needed) and copy the `apiKey`, `authDomain`,
   `projectId` and `appId` values.
7. Copy `.env.example` to `.env.local` and paste those values in. For a hosted
   build, set the same `VITE_FIREBASE_*` variables in the host's build
   settings.
8. `npm run dev`, click **Sign in with Google**, and check that the plan shows
   up under Firestore > Data > `users`.

These web settings identify the project; they are not secrets. Access is
controlled by the Firestore rules, which let each user read and write only
their own plans.

## Trying it without Firebase

`VITE_CLOUD=demo npm run dev` swaps Firebase for a stand-in account kept in
the browser. It starts with one plan "from another device" so the sign-in
merge can be seen. Never use it for a real deployment.

## Code map

- `src/storage/dataStore.js`: the only module that touches browser storage
  (the artifact runtime's `window.storage` if present, otherwise
  localStorage).
- `src/storage/sync.js`: pure merge rules (newest copy wins, deletions are
  kept as tombstones).
- `src/storage/account.js`: sign-in merge, saving to the account, applying
  changes from other devices, sign-out cleanup.
- `src/storage/cloud/`: the Firebase adapter (loaded only on first use), the
  demo adapter, and config from `VITE_FIREBASE_*`.
- `src/ui/AccountMenu.jsx`: the save status and sign-in / account menu.

Firestore layout: `users/{uid}/plans/{planId}` holding
`{ data, name, lastEdited, deleted }`, where `data` is the plan as a JSON
string.
