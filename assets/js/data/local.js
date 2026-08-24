/* ------------------------------------------------------------------
   Local provider — everything in localStorage, no server.

   Boards are stored per signed-in account, so two people sharing one
   computer keep separate boards. That separation is organisational, not
   security: local data is plainly readable by anyone with dev tools on
   that machine. For a real boundary — and for boards that follow you to
   another device — use cloud mode.
   ------------------------------------------------------------------ */
import { uid, ORDER_STEP } from '../util.js';
import { makeBoard, makeColumns, makeTask, normalizeBoard, normalizeTask } from './model.js';
import { forgetGoogleSession } from './google-identity.js';

const NS = 'taskboard:v1';
const K_USER = `${NS}:user`;
const K_BOARDS = (owner) => `${NS}:u:${owner}:boards`;
const K_TASKS = (owner, boardId) => `${NS}:u:${owner}:tasks:${boardId}`;
const K_PROFILE = (owner) => `${NS}:u:${owner}:profile`;

// Keys written before boards were stored per account.
const LEGACY_BOARDS = `${NS}:boards`;
const LEGACY_TASKS = (boardId) => `${NS}:tasks:${boardId}`;

export const DEVICE_UID = 'local-user';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('[taskboard] localStorage write failed', err);
    throw new Error('This browser is out of storage space for Taskboard.');
  }
}

export function createLocalProvider(config) {
  const listeners = { auth: new Set(), boards: new Set(), tasks: new Map() };
  let user = read(K_USER, null);

  const owner = () => user?.uid || DEVICE_UID;
  const boards = () => read(K_BOARDS(owner()), []);
  const tasksOf = (boardId) => read(K_TASKS(owner(), boardId), []);

  const emitBoards = () => {
    const list = boards().map(normalizeBoard);
    listeners.boards.forEach((cb) => cb(list));
  };
  const emitTasks = (boardId) => {
    const set = listeners.tasks.get(boardId);
    if (!set) return;
    const list = tasksOf(boardId).map(normalizeTask);
    set.forEach((cb) => cb(list));
  };
  const saveBoards = (list) => { write(K_BOARDS(owner()), list); emitBoards(); };
  const saveTasks = (boardId, list) => { write(K_TASKS(owner(), boardId), list); emitTasks(boardId); };

  // Keep multiple tabs of the same browser in sync.
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(NS)) return;
    if (e.key === K_USER) {
      user = read(K_USER, null);
      listeners.auth.forEach((cb) => cb(user));
      return;
    }
    const mine = `${NS}:u:${owner()}:`;
    if (!e.key.startsWith(mine)) return;
    if (e.key === K_BOARDS(owner())) emitBoards();
    else if (e.key.startsWith(`${mine}tasks:`)) emitTasks(e.key.slice(`${mine}tasks:`.length));
  });

  /** Boards made before accounts existed belong to whoever signs in first. */
  function adoptLegacyBoards(ownerId) {
    const legacy = read(LEGACY_BOARDS, null);
    if (!legacy || read(K_BOARDS(ownerId), null)) return;
    write(K_BOARDS(ownerId), legacy);
    for (const board of legacy) {
      const tasks = read(LEGACY_TASKS(board.id), null);
      if (tasks) write(K_TASKS(ownerId, board.id), tasks);
      localStorage.removeItem(LEGACY_TASKS(board.id));
    }
    localStorage.removeItem(LEGACY_BOARDS);
  }

  function seed(ownerId) {
    if (read(K_BOARDS(ownerId), null)) return;
    const columns = () => makeColumns(config.defaultColumns);
    const personal = { id: uid('bd_'), ...makeBoard({ name: 'Personal', emoji: '🌱', visibility: 'private', ownerId, columns: columns() }) };
    const shared = { id: uid('bd_'), ...makeBoard({ name: 'Household', emoji: '🏡', visibility: 'shared', ownerId, columns: columns() }) };
    write(K_BOARDS(ownerId), [personal, shared]);

    const [backlog, todo, doing] = personal.columns;
    write(K_TASKS(ownerId, personal.id), [
      { id: uid('tk_'), ...makeTask({ title: 'Drag me to another column', columnId: todo.id, order: ORDER_STEP, createdBy: ownerId, priority: 'medium', notes: 'Grab a card with the mouse, or focus it and press Space to move it with the arrow keys.' }) },
      { id: uid('tk_'), ...makeTask({ title: 'Open me to add notes, a due date and a checklist', columnId: todo.id, order: ORDER_STEP * 2, createdBy: ownerId }) },
      { id: uid('tk_'), ...makeTask({ title: 'Set up cloud sync so my boards follow me to my phone', columnId: backlog.id, order: ORDER_STEP, createdBy: ownerId, priority: 'high', notes: 'See README.md → Cloud mode setup.' }) },
      { id: uid('tk_'), ...makeTask({ title: 'Try the WIP limit on In progress', columnId: doing.id, order: ORDER_STEP, createdBy: ownerId, priority: 'low' }) },
    ]);
    write(K_TASKS(ownerId, shared.id), [
      { id: uid('tk_'), ...makeTask({ title: 'Groceries', columnId: shared.columns[1].id, order: ORDER_STEP, createdBy: ownerId, labels: [shared.labels[1].id] }) },
    ]);
  }

  return {
    mode: 'local',
    get user() { return user; },

    async init() {},

    onAuth(cb) {
      listeners.auth.add(cb);
      queueMicrotask(() => cb(user));
      return () => listeners.auth.delete(cb);
    },

    /** `profile` comes from Google, or is omitted for the device-only profile. */
    async signIn(profile) {
      const saved = read(K_PROFILE(profile?.uid || DEVICE_UID), null);
      const next = profile?.uid
        ? { photoURL: '', email: '', ...profile }
        : { uid: DEVICE_UID, displayName: 'You', email: '', photoURL: '', ...(saved || {}) };
      // Google is the source of truth for the name, unless it was renamed here.
      if (saved?.nameOverridden) {
        next.displayName = saved.displayName;
        next.nameOverridden = true;
      }
      write(K_PROFILE(next.uid), next);
      adoptLegacyBoards(next.uid);
      seed(next.uid);
      user = next;
      write(K_USER, user);
      listeners.auth.forEach((cb) => cb(user));
      return user;
    },

    async signOut() {
      // Sign-out forgets who is here; the boards stay on this device.
      forgetGoogleSession();
      localStorage.removeItem(K_USER);
      user = null;
      listeners.auth.forEach((cb) => cb(null));
    },

    async updateProfile(patch) {
      if (!user) return null;
      user = { ...user, ...patch };
      if (patch.displayName) user.nameOverridden = true;
      write(K_PROFILE(user.uid), user);
      write(K_USER, user);
      listeners.auth.forEach((cb) => cb(user));
      return user;
    },

    subscribeBoards(cb) {
      listeners.boards.add(cb);
      queueMicrotask(emitBoards);
      return () => listeners.boards.delete(cb);
    },

    subscribeTasks(boardId, cb) {
      if (!listeners.tasks.has(boardId)) listeners.tasks.set(boardId, new Set());
      listeners.tasks.get(boardId).add(cb);
      queueMicrotask(() => emitTasks(boardId));
      return () => {
        const set = listeners.tasks.get(boardId);
        if (!set) return;
        set.delete(cb);
        if (!set.size) listeners.tasks.delete(boardId);
      };
    },

    async createBoard(data) {
      const board = { id: uid('bd_'), ...makeBoard({ ...data, ownerId: owner() }) };
      saveBoards([...boards(), board]);
      saveTasks(board.id, []);
      return board.id;
    },

    async updateBoard(boardId, patch) {
      saveBoards(boards().map((b) => (b.id === boardId ? { ...b, ...patch, updatedAt: Date.now() } : b)));
    },

    async deleteBoard(boardId) {
      saveBoards(boards().filter((b) => b.id !== boardId));
      localStorage.removeItem(K_TASKS(owner(), boardId));
    },

    async addMember() {
      throw new Error('Sharing needs cloud mode — add your Firebase config to config.js.');
    },
    async removeMember() {
      throw new Error('Sharing needs cloud mode — add your Firebase config to config.js.');
    },
    async getProfiles(uids) {
      const map = {};
      if (user && uids.includes(user.uid)) map[user.uid] = user;
      return map;
    },

    async createTask(boardId, data) {
      const task = { id: uid('tk_'), ...makeTask({ ...data, createdBy: owner() }) };
      saveTasks(boardId, [...tasksOf(boardId), task]);
      return task.id;
    },

    async updateTask(boardId, taskId, patch) {
      saveTasks(boardId, tasksOf(boardId).map((t) => (
        t.id === taskId ? { ...t, ...patch, updatedAt: Date.now() } : t
      )));
    },

    async deleteTask(boardId, taskId) {
      saveTasks(boardId, tasksOf(boardId).filter((t) => t.id !== taskId));
    },

    async deleteTasks(boardId, taskIds) {
      const gone = new Set(taskIds);
      saveTasks(boardId, tasksOf(boardId).filter((t) => !gone.has(t.id)));
    },

    async bulkUpdateTasks(boardId, updates) {
      const patches = new Map(updates.map((u) => [u.id, u.patch]));
      saveTasks(boardId, tasksOf(boardId).map((t) => (
        patches.has(t.id) ? { ...t, ...patches.get(t.id), updatedAt: Date.now() } : t
      )));
    },
  };
}
