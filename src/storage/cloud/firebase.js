// Firebase adapter: Google sign-in (Firebase Auth) and plan storage
// (Cloud Firestore). Firebase is loaded on first use, so it never runs for
// people who don't sign in.
//
// Layout: users/{uid}/plans/{planId} = { data, name, lastEdited, deleted }
// where data is the plan as a JSON string (Firestore can't store the nested
// arrays a plan may contain). firestore.rules limits each user to their own
// documents.

import { firebaseConfig } from './config.js';

let loaded = null;
function sdk() {
  if (!loaded) {
    loaded = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ]).then(([app, auth, fs]) => {
      const fbApp = app.initializeApp(firebaseConfig);
      return { auth, fs, authInst: auth.getAuth(fbApp), db: fs.getFirestore(fbApp) };
    });
  }
  return loaded;
}

const toUser = (u) => u && { uid: u.uid, name: u.displayName || u.email || 'Google account', email: u.email || '', photoURL: u.photoURL || '' };

function toRecord(id, d) {
  let plan = null;
  if (!d.deleted && typeof d.data === 'string') {
    try { plan = JSON.parse(d.data); } catch { plan = null; }
  }
  return { id, lastEdited: d.lastEdited || 0, deleted: Boolean(d.deleted), plan };
}

export const firebaseCloud = {
  kind: 'firebase',

  onAuthChange(cb) {
    let unsub = () => {};
    let cancelled = false;
    sdk().then(({ auth, authInst }) => {
      if (!cancelled) unsub = auth.onAuthStateChanged(authInst, (u) => cb(toUser(u)));
    }).catch(() => cb(null));
    return () => { cancelled = true; unsub(); };
  },

  async signIn() {
    const { auth, authInst } = await sdk();
    const provider = new auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const res = await auth.signInWithPopup(authInst, provider);
    return toUser(res.user);
  },

  async signOut() {
    const { auth, authInst } = await sdk();
    await auth.signOut(authInst);
  },

  async list(uid) {
    const { fs, db } = await sdk();
    const snap = await fs.getDocs(fs.collection(db, 'users', uid, 'plans'));
    return snap.docs.map((d) => toRecord(d.id, d.data()));
  },

  async put(uid, plan) {
    const { fs, db } = await sdk();
    await fs.setDoc(fs.doc(db, 'users', uid, 'plans', plan.id), {
      data: JSON.stringify(plan),
      name: plan.name || '',
      lastEdited: plan.lastEdited || Date.now(),
      deleted: false,
    });
  },

  async remove(uid, planId) {
    const { fs, db } = await sdk();
    await fs.setDoc(fs.doc(db, 'users', uid, 'plans', planId), {
      data: null, name: '', lastEdited: Date.now(), deleted: true,
    });
  },

  // Calls cb(records) with changes made on other devices.
  subscribe(uid, cb) {
    let unsub = () => {};
    let cancelled = false;
    sdk().then(({ fs, db }) => {
      if (cancelled) return;
      unsub = fs.onSnapshot(fs.collection(db, 'users', uid, 'plans'), (snap) => {
        if (snap.metadata.hasPendingWrites) return; // our own write echoing back
        const changed = snap.docChanges()
          .filter((c) => c.type !== 'removed')
          .map((c) => toRecord(c.doc.id, c.doc.data()));
        if (changed.length) cb(changed);
      }, () => {});
    });
    return () => { cancelled = true; unsub(); };
  },
};
