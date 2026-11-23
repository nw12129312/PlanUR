// Firebase web settings, read from Vite env vars at build time.
// Copy .env.example to .env.local and fill in the values from the Firebase
// console (Project settings > Your apps > Web app). These values identify the
// project; they are not secrets. Access is limited by firestore.rules.
// Leave them empty and the app runs without sign-in, saving to this browser.

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
};

export const firebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
);

