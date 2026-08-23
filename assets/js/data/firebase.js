/* ------------------------------------------------------------------
   Cloud provider — Firebase Auth + Cloud Firestore.

   Data layout (see firestore.rules for the matching access rules):
     users/{uid}                    profile card, readable by signed-in users
     emailIndex/{emailLowercased}   { uid } so a board owner can invite by email
     boards/{boardId}               { name, ownerId, memberIds[], columns[], ... }
     boards/{boardId}/tasks/{id}    one card

   A board is visible to exactly the uids in memberIds. A "private" board is
   simply one whose memberIds is [you].
   ------------------------------------------------------------------ */
import { normalizeBoard, normalizeTask, makeBoard, makeTask } from './model.js';

const SDK = 'https://www.gstatic.com/firebasejs/12.18.0';

export function createFirebaseProvider(config) {
  let fb = null;          // loaded SDK namespaces
  let auth = null;
  let db = null;
  let user = null;
  const authListeners = new Set();

  async function load() {
    const [app, authMod, dbMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    return { app, auth: authMod, db: dbMod };
  }

  const boardRef = (id) => fb.db.doc(db, 'boards', id);
  const tasksRef = (boardId) => fb.db.collection(db, 'boards', boardId, 'tasks');

  function toProfile(u) {
    return {
      uid: u.uid,
      displayName: u.displayName || (u.email ? u.email.split('@')[0] : 'Someone'),
      email: u.email || '',
      photoURL: u.photoURL || '',
    };
  }

  /** Publish our profile + email→uid index so team-mates can find and invite us. */
  async function publishProfile(profile) {
    const { doc, setDoc } = fb.db;
    await setDoc(doc(db, 'users', profile.uid), { ...profile, updatedAt: Date.now() }, { merge: true });
    if (profile.email) {
      await setDoc(doc(db, 'emailIndex', profile.email.toLowerCase()), {
        uid: profile.uid, updatedAt: Date.now(),
      });
    }
  }

  function friendlyError(err) {
    const code = err?.code || '';
    if (code === 'auth/popup-blocked' || code === 'auth/cancelled-popup-request') {
      return new Error('Your browser blocked the sign-in popup. Allow popups and try again.');
    }
    if (code === 'auth/popup-closed-by-user') return new Error('Sign-in was cancelled.');
    if (code === 'auth/unauthorized-domain') {
      return new Error(`Add "${location.hostname}" to Firebase → Authentication → Settings → Authorized domains.`);
    }
    if (code === 'auth/operation-not-allowed') {
      return new Error('That sign-in provider is not enabled in your Firebase project yet.');
    }
    if (code === 'permission-denied') {
      return new Error('Firestore rules rejected that. Deploy the rules from firestore.rules.');
    }
    if (code === 'failed-precondition') {
      return new Error('Firestore is not set up in this project yet — create the database in the Firebase console.');
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  return {
    mode: 'cloud',
    providers: config.authProviders || ['google'],
    get user() { return user; },

    async init() {
      fb = await load();
      const app = fb.app.initializeApp(config.firebase);
      auth = fb.auth.getAuth(app);
      db = fb.db.getFirestore(app);
      await fb.auth.setPersistence(auth, fb.auth.browserLocalPersistence).catch(() => {});
      // Completes a redirect sign-in (used when popups are unavailable).
      await fb.auth.getRedirectResult(auth).catch(() => {});
    },

    onAuth(cb) {
      authListeners.add(cb);
      const unsub = fb.auth.onAuthStateChanged(auth, async (u) => {
        user = u ? toProfile(u) : null;
        if (user) await publishProfile(user).catch((e) => console.warn('[taskboard] profile publish failed', e));
        authListeners.forEach((fn) => fn(user));
      });
      return () => { authListeners.delete(cb); unsub(); };
    },

    async signIn(providerId = 'google') {
      const { GoogleAuthProvider, GithubAuthProvider, signInWithPopup, signInWithRedirect } = fb.auth;
      const provider = providerId === 'github' ? new GithubAuthProvider() : new GoogleAuthProvider();
      provider.setCustomParameters?.({ prompt: 'select_account' });
      try {
        const cred = await signInWithPopup(auth, provider);
        return toProfile(cred.user);
      } catch (err) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err?.code)) {
          await signInWithRedirect(auth, provider);
          return null;
        }
        throw friendlyError(err);
      }
    },

    async signOut() { await fb.auth.signOut(auth); },

    subscribeBoards(cb, onError) {
      const { collection, query, where, onSnapshot } = fb.db;
      const q = query(collection(db, 'boards'), where('memberIds', 'array-contains', user.uid));
      return onSnapshot(q,
        (snap) => cb(snap.docs.map((d) => normalizeBoard({ id: d.id, ...d.data() }))),
        (err) => onError?.(friendlyError(err)));
    },

    subscribeTasks(boardId, cb, onError) {
      const { onSnapshot } = fb.db;
      return onSnapshot(tasksRef(boardId),
        (snap) => cb(snap.docs.map((d) => normalizeTask({ id: d.id, ...d.data() }))),
        (err) => onError?.(friendlyError(err)));
    },

    async createBoard(data) {
      const { addDoc, collection } = fb.db;
      const ref = await addDoc(collection(db, 'boards'), makeBoard({ ...data, ownerId: user.uid }));
      return ref.id;
    },

    async updateBoard(boardId, patch) {
      const { updateDoc } = fb.db;
      await updateDoc(boardRef(boardId), { ...patch, updatedAt: Date.now() }).catch((e) => { throw friendlyError(e); });
    },

    async deleteBoard(boardId) {
      const { getDocs, writeBatch, deleteDoc } = fb.db;
      // Firestore keeps subcollections when a parent is deleted — clear tasks first.
      const snap = await getDocs(tasksRef(boardId));
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(boardRef(boardId));
    },

    /** Look up a uid by email and add them to the board. */
    async addMember(boardId, email) {
      const { doc, getDoc, updateDoc, arrayUnion } = fb.db;
      const key = String(email || '').trim().toLowerCase();
      if (!key) throw new Error('Enter an email address.');
      const idx = await getDoc(doc(db, 'emailIndex', key)).catch((e) => { throw friendlyError(e); });
      if (!idx.exists()) {
        throw new Error(`No Taskboard account for ${key} yet. Ask them to sign in once, then invite them.`);
      }
      const memberId = idx.data().uid;
      await updateDoc(boardRef(boardId), {
        memberIds: arrayUnion(memberId), visibility: 'shared', updatedAt: Date.now(),
      }).catch((e) => { throw friendlyError(e); });
      return memberId;
    },

    async removeMember(boardId, memberId) {
      const { updateDoc, arrayRemove, getDoc } = fb.db;
      const snap = await getDoc(boardRef(boardId));
      const board = snap.data();
      if (board?.ownerId === memberId) throw new Error('The board owner cannot be removed.');
      const left = (board?.memberIds || []).filter((id) => id !== memberId);
      await updateDoc(boardRef(boardId), {
        memberIds: arrayRemove(memberId),
        visibility: left.length > 1 ? 'shared' : 'private',
        updatedAt: Date.now(),
      }).catch((e) => { throw friendlyError(e); });
    },

    async getProfiles(uids) {
      const { doc, getDoc } = fb.db;
      const out = {};
      await Promise.all([...new Set(uids)].filter(Boolean).map(async (id) => {
        try {
          const snap = await getDoc(doc(db, 'users', id));
          if (snap.exists()) out[id] = { uid: id, ...snap.data() };
        } catch { /* a profile we may not read is not worth failing over */ }
      }));
      return out;
    },

    async createTask(boardId, data) {
      const { addDoc } = fb.db;
      const ref = await addDoc(tasksRef(boardId), makeTask({ ...data, createdBy: user.uid }))
        .catch((e) => { throw friendlyError(e); });
      return ref.id;
    },

    async updateTask(boardId, taskId, patch) {
      const { doc, updateDoc } = fb.db;
      await updateDoc(doc(db, 'boards', boardId, 'tasks', taskId), { ...patch, updatedAt: Date.now() })
        .catch((e) => { throw friendlyError(e); });
    },

    async deleteTask(boardId, taskId) {
      const { doc, deleteDoc } = fb.db;
      await deleteDoc(doc(db, 'boards', boardId, 'tasks', taskId)).catch((e) => { throw friendlyError(e); });
    },

    async deleteTasks(boardId, taskIds) {
      const { doc, writeBatch } = fb.db;
      for (let i = 0; i < taskIds.length; i += 400) {
        const batch = writeBatch(db);
        taskIds.slice(i, i + 400).forEach((id) => batch.delete(doc(db, 'boards', boardId, 'tasks', id)));
        await batch.commit();
      }
    },

    async bulkUpdateTasks(boardId, updates) {
      const { doc, writeBatch } = fb.db;
      for (let i = 0; i < updates.length; i += 400) {
        const batch = writeBatch(db);
        updates.slice(i, i + 400).forEach(({ id, patch }) => (
          batch.update(doc(db, 'boards', boardId, 'tasks', id), { ...patch, updatedAt: Date.now() })
        ));
        await batch.commit();
      }
    },
  };
}
