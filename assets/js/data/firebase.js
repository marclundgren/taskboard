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

  // Live sync state, straight from Firestore snapshot metadata, so the UI can
  // say whether a change is actually on the server rather than just assuming.
  const syncListeners = new Set();
  let syncState = 'connecting';
  function setSync(next) {
    if (next === syncState) return;
    syncState = next;
    syncListeners.forEach((cb) => cb(next));
  }
  const reportMeta = (meta) => setSync(
    meta.hasPendingWrites ? 'pending' : meta.fromCache ? 'offline' : 'synced',
  );

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
      return new Error('Firestore rejected that write. In the Firebase console, open Firestore Database \u2192 Rules, paste the contents of firestore.rules over what is there, and press Publish.');
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
      fb = await load().catch(() => {
        throw new Error("Couldn't load Firebase. Check your connection — a content blocker or offline network can stop gstatic.com from loading.");
      });
      const app = fb.app.initializeApp(config.firebase);
      auth = fb.auth.getAuth(app);
      // Persist the cache (and any writes still queued) in IndexedDB rather
      // than memory, so a refresh mid-write doesn't lose work. Falls back to
      // the default memory cache if the browser refuses IndexedDB.
      try {
        const { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } = fb.db;
        db = initializeFirestore(app, {
          localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        });
      } catch (err) {
        console.warn('[taskboard] persistent cache unavailable, using memory cache', err);
        db = fb.db.getFirestore(app);
      }
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

    onSyncState(cb) {
      syncListeners.add(cb);
      queueMicrotask(() => cb(syncState));
      return () => syncListeners.delete(cb);
    },

    subscribeBoards(cb, onError) {
      const { collection, query, where, onSnapshot } = fb.db;
      const q = query(collection(db, 'boards'), where('memberIds', 'array-contains', user.uid));
      return onSnapshot(q, { includeMetadataChanges: true },
        (snap) => {
          reportMeta(snap.metadata);
          cb(snap.docs.map((d) => normalizeBoard({ id: d.id, ...d.data() })));
        },
        (err) => onError?.(friendlyError(err)));
    },

    /**
     * Cards for one board.
     *
     * The boards listener hands us a board the moment it is written locally,
     * which can be before the server has it. The rules for this subcollection
     * read the parent board, so a listen opened in that window is denied — and
     * a denied listen stays dead. Retry briefly before treating it as a real
     * permission problem.
     */
    subscribeTasks(boardId, cb, onError) {
      const { onSnapshot } = fb.db;
      let stopped = false;
      let unsub = null;
      let attempt = 0;

      const attach = () => {
        if (stopped) return;
        unsub = onSnapshot(tasksRef(boardId), { includeMetadataChanges: true },
          (snap) => {
            attempt = 0;
            reportMeta(snap.metadata);
            cb(snap.docs.map((d) => normalizeTask({ id: d.id, ...d.data() })));
          },
          (err) => {
            if (err?.code === 'permission-denied' && attempt < 5 && !stopped) {
              setTimeout(attach, 300 * 2 ** attempt++);
              return;
            }
            onError?.(friendlyError(err));
          });
      };

      attach();
      return () => { stopped = true; unsub?.(); };
    },

    async createBoard(data) {
      const { addDoc, collection } = fb.db;
      const ref = await addDoc(collection(db, 'boards'), makeBoard({ ...data, ownerId: user.uid }))
        .catch((e) => { throw friendlyError(e); });
      return ref.id;
    },

    async updateBoard(boardId, patch) {
      const { updateDoc } = fb.db;
      await updateDoc(boardRef(boardId), { ...patch, updatedAt: Date.now() }).catch((e) => { throw friendlyError(e); });
    },

    async deleteBoard(boardId) {
      const { getDocs, writeBatch, deleteDoc } = fb.db;
      // Firestore keeps subcollections when a parent is deleted — clear tasks first.
      const snap = await getDocs(tasksRef(boardId)).catch((e) => { throw friendlyError(e); });
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(boardRef(boardId));
    },

    /**
     * Invite by email. If they already have an account they join immediately;
     * if not, the address is parked on the board and they pick it up the first
     * time they sign in (see claimInvites).
     */
    async addMember(boardId, email) {
      const { doc, getDoc, updateDoc, arrayUnion } = fb.db;
      const key = String(email || '').trim().toLowerCase();
      if (!key || !key.includes('@')) throw new Error('Enter an email address.');

      const idx = await getDoc(doc(db, 'emailIndex', key)).catch((e) => { throw friendlyError(e); });
      if (idx.exists()) {
        await updateDoc(boardRef(boardId), {
          memberIds: arrayUnion(idx.data().uid), visibility: 'shared', updatedAt: Date.now(),
        }).catch((e) => { throw friendlyError(e); });
        return { status: 'joined', email: key, uid: idx.data().uid };
      }

      await updateDoc(boardRef(boardId), {
        pendingEmails: arrayUnion(key), visibility: 'shared', updatedAt: Date.now(),
      }).catch((e) => { throw friendlyError(e); });
      return { status: 'invited', email: key };
    },

    /** Withdraw an invitation that hasn't been taken up yet. */
    async cancelInvite(boardId, email) {
      const { updateDoc, arrayRemove } = fb.db;
      await updateDoc(boardRef(boardId), {
        pendingEmails: arrayRemove(String(email).toLowerCase()), updatedAt: Date.now(),
      }).catch((e) => { throw friendlyError(e); });
    },

    /**
     * Turn invitations addressed to this account into memberships. Runs once
     * per sign-in; boards invited before the account existed appear here.
     */
    async claimInvites() {
      const { collection, query, where, getDocs, updateDoc } = fb.db;
      const email = (user?.email || '').toLowerCase();
      if (!email) return 0;

      const q = query(collection(db, 'boards'), where('pendingEmails', 'array-contains', email));
      const snap = await getDocs(q);
      let claimed = 0;
      for (const docSnap of snap.docs) {
        const data = docSnap.data();
        // Written as explicit arrays rather than arrayUnion/arrayRemove so the
        // security rule can see exactly what the document becomes.
        await updateDoc(docSnap.ref, {
          memberIds: [...new Set([...(data.memberIds || []), user.uid])],
          pendingEmails: (data.pendingEmails || []).filter((e) => e !== email),
          visibility: 'shared',
          updatedAt: Date.now(),
        });
        claimed += 1;
      }
      return claimed;
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
