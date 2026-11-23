// Picks the account backend: Firebase when configured, the in-browser demo
// for preview builds, or none (sign-in hidden; plans stay in this browser).
// The checks read import.meta.env directly so the build drops Firebase
// entirely when it isn't configured.

import { firebaseConfigured } from './config.js';
import { firebaseCloud } from './firebase.js';
import { demoCloudAdapter } from './demo.js';

export function getCloud() {
  if (import.meta.env.VITE_CLOUD === 'demo') return demoCloudAdapter;
  if (import.meta.env.VITE_FIREBASE_API_KEY && firebaseConfigured) return firebaseCloud;
  return null;
}
