// Stand-in for Firebase used by preview builds (VITE_CLOUD=demo). The
// "account" lives in this browser's localStorage and starts with one plan
// from "another device", so the sign-in merge can be seen end to end.

import { newPlan } from '../../engine/model.js';

const KEY = 'planur-demo-cloud';
const USER = { uid: 'demo-user', name: 'Demo Student', email: 'student@u.rochester.edu', photoURL: '' };
const authListeners = new Set();

function read() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const seed = newPlan('Plan from my laptop');
  seed.majorIds = ['major-csc-bs'];
  seed.semesters[0].courseIds = ['CSC 171', 'MATH 161'];
  seed.lastEdited = Date.now() - 86400000;
  return { signedIn: false, records: { [seed.id]: { id: seed.id, lastEdited: seed.lastEdited, deleted: false, plan: seed } } };
}
function write(state) {
  try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}
const delay = () => new Promise((r) => setTimeout(r, 300));

export const demoCloudAdapter = {
  kind: 'demo',

  onAuthChange(cb) {
    authListeners.add(cb);
    setTimeout(() => cb(read().signedIn ? USER : null), 0);
    return () => authListeners.delete(cb);
  },

  async signIn() {
    await delay();
    const s = read();
    s.signedIn = true;
    write(s);
    authListeners.forEach((f) => f(USER));
    return USER;
  },

  async signOut() {
    const s = read();
    s.signedIn = false;
    write(s);
    authListeners.forEach((f) => f(null));
  },

  async list() {
    await delay();
    return Object.values(read().records);
  },

  async put(uid, plan) {
    const s = read();
    s.records[plan.id] = { id: plan.id, lastEdited: plan.lastEdited || Date.now(), deleted: false, plan };
    write(s);
  },

  async remove(uid, planId) {
    const s = read();
    s.records[planId] = { id: planId, lastEdited: Date.now(), deleted: true, plan: null };
    write(s);
  },

  subscribe() {
    return () => {};
  },
};
