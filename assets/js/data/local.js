/* ------------------------------------------------------------------
   Local provider — everything in localStorage, no network, no account.
   Boards live only in this browser, but every feature works offline.
   ------------------------------------------------------------------ */
import { uid, ORDER_STEP } from '../util.js';
import { makeBoard, makeColumns, makeTask, normalizeBoard, normalizeTask } from './model.js';

const NS = 'taskboard:v1';
const K_USER   = `${NS}:user`;
const K_BOARDS = `${NS}:boards`;
const K_TASKS  = (boardId) => `${NS}:tasks:${boardId}`;
const LOCAL_UID = 'local-user';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error('[taskboard] localStorage write failed', err);
    throw new Error('This browser is out of storage space for Taskboard.');
  }
}

export function createLocalProvider(config) {
  const listeners = { auth: new Set(), boards: new Set(), tasks: new Map() };
  let user = read(K_USER, null);

  const emitBoards = () => {
    const boards = read(K_BOARDS, []).map(normalizeBoard);
    listeners.boards.forEach((cb) => cb(boards));
  };
  const emitTasks = (boardId) => {
    const set = listeners.tasks.get(boardId);
    if (!set) return;
    const tasks = read(K_TASKS(boardId), []).map(normalizeTask);
    set.forEach((cb) => cb(tasks));
  };

  // Keep multiple tabs of the same browser in sync.
  window.addEventListener('storage', (e) => {
    if (!e.key || !e.key.startsWith(NS)) return;
    if (e.key === K_BOARDS) emitBoards();
    else if (e.key.startsWith(`${NS}:tasks:`)) emitTasks(e.key.split(':').pop());
    else if (e.key === K_USER) {
      user = read(K_USER, null);
      listeners.auth.forEach((cb) => cb(user));
    }
  });

  function seed() {
    if (read(K_BOARDS, null)) return;
    const personal = { id: uid('bd_'), ...makeBoard({ name: 'Personal', emoji: '🌱', visibility: 'private', ownerId: LOCAL_UID, columns: makeColumns(config.defaultColumns) }) };
    const shared   = { id: uid('bd_'), ...makeBoard({ name: 'Household', emoji: '🏡', visibility: 'shared',  ownerId: LOCAL_UID, columns: makeColumns(config.defaultColumns) }) };
    write(K_BOARDS, [personal, shared]);

    const [backlog, todo, doing] = personal.columns;
    write(K_TASKS(personal.id), [
      { id: uid('tk_'), ...makeTask({ title: 'Drag me to another column', columnId: todo.id, order: ORDER_STEP, createdBy: LOCAL_UID, priority: 'medium', notes: 'Grab a card with the mouse, or focus it and press Space to move it with the arrow keys.' }) },
      { id: uid('tk_'), ...makeTask({ title: 'Open me to add notes, a due date and a checklist', columnId: todo.id, order: ORDER_STEP * 2, createdBy: LOCAL_UID }) },
      { id: uid('tk_'), ...makeTask({ title: 'Set up cloud sync so my partner can sign in too', columnId: backlog.id, order: ORDER_STEP, createdBy: LOCAL_UID, priority: 'high', notes: 'See README.md → Cloud mode setup.' }) },
      { id: uid('tk_'), ...makeTask({ title: 'Try the WIP limit on In progress', columnId: doing.id, order: ORDER_STEP, createdBy: LOCAL_UID, priority: 'low' }) },
    ]);
    write(K_TASKS(shared.id), [
      { id: uid('tk_'), ...makeTask({ title: 'Groceries', columnId: shared.columns[1].id, order: ORDER_STEP, createdBy: LOCAL_UID, labels: [shared.labels[1].id] }) },
    ]);
  }

  const boards = () => read(K_BOARDS, []);
  const saveBoards = (list) => { write(K_BOARDS, list); emitBoards(); };
  const tasksOf = (boardId) => read(K_TASKS(boardId), []);
  const saveTasks = (boardId, list) => { write(K_TASKS(boardId), list); emitTasks(boardId); };

  return {
    mode: 'local',
    providers: [],
    get user() { return user; },

    async init() {},

    onAuth(cb) {
      listeners.auth.add(cb);
      queueMicrotask(() => cb(user));
      return () => listeners.auth.delete(cb);
    },

    async signIn({ displayName } = {}) {
      user = {
        uid: LOCAL_UID,
        displayName: (displayName || '').trim() || 'You',
        email: '',
        photoURL: '',
      };
      write(K_USER, user);
      seed();
      listeners.auth.forEach((cb) => cb(user));
      return user;
    },

    async signOut() {
      // Sign-out only forgets the profile — boards stay in this browser.
      localStorage.removeItem(K_USER);
      user = null;
      listeners.auth.forEach((cb) => cb(null));
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
      const board = { id: uid('bd_'), ...makeBoard({ ...data, ownerId: user.uid }) };
      saveBoards([...boards(), board]);
      saveTasks(board.id, []);
      return board.id;
    },

    async updateBoard(boardId, patch) {
      saveBoards(boards().map((b) => (b.id === boardId ? { ...b, ...patch, updatedAt: Date.now() } : b)));
    },

    async deleteBoard(boardId) {
      saveBoards(boards().filter((b) => b.id !== boardId));
      localStorage.removeItem(K_TASKS(boardId));
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
      const task = { id: uid('tk_'), ...makeTask({ ...data, createdBy: user.uid }) };
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
