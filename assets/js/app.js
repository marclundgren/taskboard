/* ------------------------------------------------------------------
   Taskboard — app shell: state, actions, wiring.
   ------------------------------------------------------------------ */
import { createProvider, isCloudConfigured, config } from './data/index.js';
import { makeColumns } from './data/model.js';
import {
  $, el, uid, debounce, daysUntil, orderBetween, needsRebalance, ORDER_STEP, ACCENTS,
} from './util.js';
import { initDnd } from './dnd.js';
import { renderBoard, setComposer, clearGrab } from './ui/board.js';
import { renderSidebar } from './ui/sidebar.js';
import { openTaskModal } from './ui/task-modal.js';
import { newBoardDialog, boardSettingsDialog, shareDialog, filterDialog, shortcutsDialog } from './ui/dialogs.js';
import { openMenu } from './ui/menu.js';
import { confirmModal, promptModal } from './ui/modal.js';
import { toast, errorToast, announce } from './ui/toast.js';
import { avatarNode } from './ui/common.js';
import { renderGoogleButton } from './data/google-identity.js';
import { icons } from './ui/icons.js';

const LAST_BOARD_KEY = 'taskboard:v1:lastBoard';
const THEME_KEY = 'taskboard:v1:theme';
const ACCENT_KEY = 'taskboard:v1:accent';

const state = {
  provider: null,
  user: null,
  boards: [],
  boardId: null,
  board: null,
  tasks: [],
  visibleTasks: [],
  profiles: {},
  taskCounts: {},
  filters: { assignee: '', due: '', priority: '', label: '', hideDone: false, text: '' },
  sync: 'connecting',
  loading: true,
};

let unsubBoards = null;
let unsubTasks = null;
let dnd = null;
let openTask = null;         // { id, modal }
let lastDragEnd = 0;

/* ==================================================================
   Boot
   ================================================================== */
applyTheme(localStorage.getItem(THEME_KEY) || 'system');
applyAccent(localStorage.getItem(ACCENT_KEY) || 'violet');

(async function boot() {
  try {
    state.provider = await createProvider();
  } catch (err) {
    console.error(err);
    showAuth(err);
    return;
  }
  state.provider.onAuth((user) => {
    state.user = user;
    if (user) startSession();
    else endSession();
  });
})();

function showAuth(error) {
  $('#boot').hidden = true;
  $('#app').hidden = true;
  $('#auth-screen').hidden = false;

  const cloud = isCloudConfigured();
  const clientId = config.google?.clientId;

  $('#auth-sub').textContent = cloud
    ? 'Sign in with Google to reach your boards from any device — and share the ones you want to share.'
    : 'Sign in with Google to keep your boards to yourself. In local mode they stay in this browser.';

  const actions = $('#auth-actions');
  actions.replaceChildren();

  const deviceButton = () => el('button', {
    class: cloud || clientId ? 'btn' : 'btn btn--primary', type: 'button',
    text: 'Continue on this device',
    onclick: () => state.provider.signIn(),
  });

  if (cloud && !state.provider) {
    // Firebase never started (offline, blocked script). Say so, and offer a retry.
    actions.append(el('button', {
      class: 'btn btn--primary', type: 'button', text: 'Try again',
      onclick: () => location.reload(),
    }));
  } else if (cloud) {
    for (const p of state.provider.providers) {
      actions.append(el('button', {
        class: 'btn btn--primary', type: 'button',
        text: p === 'github' ? 'Continue with GitHub' : 'Continue with Google',
        onclick: async (e) => {
          // Hold the node: currentTarget is null once the handler resumes.
          const button = e.currentTarget;
          button.disabled = true;
          try { await state.provider.signIn(p); }
          catch (err) { showAuthError(err.message); button.disabled = false; }
        },
      }));
    }
  } else if (clientId) {
    const holder = el('div', { class: 'gsi-button' });
    const hint = el('p', { class: 'meta-note', text: 'Loading Google sign-in…', style: 'text-align:center;margin:0' });
    actions.append(holder, hint);

    // If Google is slow or unreachable, don't leave the screen with no way in.
    let settled = false;
    const offerFallback = () => { if (!actions.contains(fallback)) actions.append(fallback); };
    const fallback = deviceButton();
    const slow = setTimeout(() => { if (!settled) offerFallback(); }, 6000);
    const finish = () => { settled = true; clearTimeout(slow); hint.remove(); };

    renderGoogleButton(holder, {
      clientId,
      onProfile: (profile) => state.provider.signIn(profile),
      onError: (err) => showAuthError(err.message),
    }).then(finish).catch((err) => {
      finish();
      showAuthError(err.message);
      offerFallback();
    });
  } else {
    actions.append(deviceButton());
  }

  $('#auth-note').innerHTML = cloud
    ? 'Your data lives in your own Firebase project. Access is enforced by the rules in <code>firestore.rules</code>.'
    : clientId
      ? 'Signing in keeps your boards apart from anyone else using this computer — but they still live only in this browser. Add your Firebase config to <code>config.js</code> to sync across devices and share boards.'
      : 'Add a Google client id to <code>config.js</code> for real sign-in, and Firebase config to sync across devices — see the README.';

  if (error) showAuthError(error.message || String(error));
}

function showAuthError(message) {
  $('#auth-screen .auth__err')?.remove();
  $('.auth__card').append(el('p', { class: 'auth__err', text: message }));
}

function endSession() {
  unsubBoards?.(); unsubTasks?.();
  unsubBoards = unsubTasks = null;
  Object.assign(state, { boards: [], board: null, boardId: null, tasks: [], profiles: {} });
  showAuth();
}

function startSession() {
  $('#auth-screen').hidden = true;
  $('#boot').hidden = true;
  $('#app').hidden = false;
  setupChrome();

  state.provider.onSyncState?.((next) => {
    state.sync = next;
    if (!$('#app').hidden) renderSyncChip();
  });

  // Boards invited to this address before the account existed become ours now.
  state.provider.claimInvites?.()
    .then((n) => { if (n) toast(`You were added to ${n} shared board${n > 1 ? 's' : ''}.`); })
    .catch((err) => console.warn('[taskboard] could not claim invitations', err));

  unsubBoards?.();
  unsubBoards = state.provider.subscribeBoards((boards) => {
    state.boards = boards;
    const wanted = boardFromHash() || state.boardId || localStorage.getItem(LAST_BOARD_KEY);
    const exists = boards.some((b) => b.id === wanted);
    selectBoard(exists ? wanted : boards[0]?.id || null, { silent: true });
    loadProfiles();
    render();
  }, (err) => errorToast(err));
}

const boardFromHash = () => (location.hash.match(/^#\/b\/(.+)$/) || [])[1] || null;

async function loadProfiles() {
  const ids = new Set(state.boards.flatMap((b) => b.memberIds || []));
  state.tasks.forEach((t) => t.assigneeId && ids.add(t.assigneeId));
  const missing = [...ids].filter((id) => id && !state.profiles[id]);
  if (!missing.length) return;
  const found = await state.provider.getProfiles(missing).catch(() => ({}));
  if (Object.keys(found).length) { Object.assign(state.profiles, found); render(); }
}

function selectBoard(boardId, { silent = false } = {}) {
  if (boardId === state.boardId && state.board) return;
  state.boardId = boardId;
  state.board = state.boards.find((b) => b.id === boardId) || null;
  state.tasks = [];
  clearGrab();
  setComposer(null);

  unsubTasks?.();
  unsubTasks = null;
  if (boardId) {
    localStorage.setItem(LAST_BOARD_KEY, boardId);
    if (boardFromHash() !== boardId) history.replaceState(null, '', `#/b/${boardId}`);
    unsubTasks = state.provider.subscribeTasks(boardId, (tasks) => {
      state.tasks = tasks;
      loadProfiles();
      render();
      refreshOpenTask();
    }, (err) => errorToast(err));
  } else if (location.hash) {
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (!silent) render();
}

window.addEventListener('hashchange', () => {
  const id = boardFromHash();
  if (id && id !== state.boardId) selectBoard(id);
});

/* ==================================================================
   Derived data
   ================================================================== */
function recompute() {
  const b = state.board = state.boards.find((x) => x.id === state.boardId) || null;
  const doneCols = new Set((b?.columns || []).filter((c) => c.isDone).map((c) => c.id));
  const f = state.filters;
  const text = f.text.trim().toLowerCase();

  state.visibleTasks = state.tasks.filter((t) => {
    if (f.hideDone && doneCols.has(t.columnId)) return false;
    if (text && !(`${t.title} ${t.notes || ''}`.toLowerCase().includes(text))) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.label && !(t.labels || []).includes(f.label)) return false;
    if (f.assignee === '@me' && t.assigneeId !== state.user.uid) return false;
    if (f.assignee === '@none' && t.assigneeId) return false;
    if (f.assignee && !['@me', '@none'].includes(f.assignee) && t.assigneeId !== f.assignee) return false;
    if (f.due) {
      const d = daysUntil(t.dueDate);
      if (f.due === 'none' && t.dueDate) return false;
      if (f.due === 'overdue' && !(d != null && d < 0)) return false;
      if (f.due === 'today' && d !== 0) return false;
      if (f.due === 'week' && !(d != null && d >= 0 && d <= 7)) return false;
    }
    return true;
  });

  state.taskCounts = b
    ? { [b.id]: state.tasks.filter((t) => !doneCols.has(t.columnId)).length }
    : {};
}

const activeFilterCount = () => ['assignee', 'due', 'priority', 'label'].filter((k) => state.filters[k]).length
  + (state.filters.hideDone ? 1 : 0);

/* ==================================================================
   Render
   ================================================================== */
let renderQueued = false;
function render() {
  if (dnd?.isDragging) { renderQueued = true; return; }
  recompute();
  renderSidebar($('#board-list'), ctx);
  renderTopbar();
  renderBoard($('#board'), ctx);
  renderSyncChip();
}

const SYNC_LABELS = {
  local:      ['local',   'Saved in this browser'],
  synced:     ['cloud',   'Synced to cloud'],
  pending:    ['pending', 'Saving…'],
  offline:    ['offline', 'Offline — changes queued'],
  connecting: ['cloud',   'Connecting…'],
};

function renderSyncChip() {
  const chip = $('#mode-chip');
  const [mode, label] = SYNC_LABELS[state.provider.mode === 'local' ? 'local' : state.sync]
    || SYNC_LABELS.connecting;
  chip.dataset.mode = mode;
  chip.textContent = label;
  chip.title = state.user?.email
    ? `Signed in as ${state.user.email}`
    : 'Boards are stored in this browser';
}

function renderTopbar() {
  const b = state.board;
  const title = $('#board-title');
  title.replaceChildren();
  if (b) {
    const shared = (b.memberIds || []).length > 1;
    title.append(el('button', {
      class: 'btn btn--ghost', type: 'button', 'aria-haspopup': 'menu',
      onclick: (e) => openBoardMenu(e.currentTarget),
      style: 'font-size:16px;font-weight:650;gap:8px;max-width:44vw;overflow:hidden',
    }, [
      el('span', { text: b.emoji || '📋' }),
      el('span', { text: b.name, style: 'overflow:hidden;text-overflow:ellipsis' }),
      el('span', { class: `pill ${shared ? 'pill--shared' : ''}`, text: shared ? 'Shared' : 'Private' }),
    ]));
  }

  const members = $('#members');
  members.replaceChildren();
  if (b && state.provider.mode === 'cloud') {
    for (const id of (b.memberIds || []).slice(0, 4)) {
      members.append(avatarNode(state.profiles[id] || { uid: id, displayName: 'Member' }));
    }
    members.append(el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Share board', html: icons.people,
      style: 'margin-left:4px', onclick: () => shareDialog(ctx),
    }));
  }

  const count = activeFilterCount();
  const badge = $('#filter-count');
  badge.hidden = !count;
  badge.textContent = String(count);

  const userBtn = $('#user-btn');
  userBtn.replaceChildren(avatarNode(state.user));
}

function refreshOpenTask() {
  if (!openTask) return;
  const task = state.tasks.find((t) => t.id === openTask.id);
  if (!task) { openTask.modal.close(); openTask = null; return; }
  openTask.modal.refresh?.(task);
}

/* ==================================================================
   Actions
   ================================================================== */
const sortedIn = (columnId, tasks = state.tasks) =>
  tasks.filter((t) => t.columnId === columnId).sort((a, b) => a.order - b.order);

/** Renumber a column when midpoints have run out of room. */
async function rebalance(columnId, movedId, movedIndex) {
  const list = sortedIn(columnId).filter((t) => t.id !== movedId);
  const moved = state.tasks.find((t) => t.id === movedId);
  list.splice(movedIndex, 0, moved);
  await state.provider.bulkUpdateTasks(state.boardId, list.map((t, i) => ({
    id: t.id, patch: { order: (i + 1) * ORDER_STEP, columnId },
  })));
}

function donePatchFor(columnId) {
  const col = state.board.columns.find((c) => c.id === columnId);
  return { done: !!col?.isDone };
}

const actions = {
  /* ---- boards ---- */
  selectBoard: (id) => { selectBoard(id); closeSidebar(); },
  newBoard: () => newBoardDialog(ctx),
  createBoard: async ({ name, emoji, visibility }) => {
    const id = await state.provider.createBoard({
      name, emoji, visibility, columns: makeColumns(config.defaultColumns),
    });
    selectBoard(id);
    toast(`Board “${name}” created.`);
    return id;
  },
  updateBoard: (patch) => state.provider.updateBoard(state.boardId, patch),
  deleteBoard: async () => {
    const name = state.board.name;
    await state.provider.deleteBoard(state.boardId);
    selectBoard(state.boards.find((b) => b.id !== state.boardId)?.id || null);
    toast(`Board “${name}” deleted.`);
  },
  addMember: (boardId, email) => state.provider.addMember(boardId, email).then((result) => {
    loadProfiles();
    return result;
  }),
  cancelInvite: (boardId, email) => state.provider.cancelInvite(boardId, email),
  removeMember: (boardId, memberId) => state.provider.removeMember(boardId, memberId),
  deleteLabel: async (labelId) => {
    await state.provider.updateBoard(state.boardId, {
      labels: state.board.labels.filter((l) => l.id !== labelId),
    });
    const affected = state.tasks.filter((t) => (t.labels || []).includes(labelId));
    if (affected.length) {
      await state.provider.bulkUpdateTasks(state.boardId, affected.map((t) => ({
        id: t.id, patch: { labels: t.labels.filter((id) => id !== labelId) },
      })));
    }
  },

  /* ---- columns ---- */
  addColumn: async () => {
    const name = await promptModal({ title: 'Add column', label: 'Column name', confirmLabel: 'Add' });
    if (!name) return;
    await state.provider.updateBoard(state.boardId, {
      columns: [...state.board.columns, { id: uid('col_'), name, wipLimit: 0, isDone: false }],
    }).catch(errorToast);
  },
  renameColumn: async (columnId) => {
    const col = state.board.columns.find((c) => c.id === columnId);
    const name = await promptModal({ title: 'Rename column', label: 'Column name', value: col.name });
    if (!name) return;
    await patchColumn(columnId, { name }).catch(errorToast);
  },
  setWipLimit: async (columnId) => {
    const col = state.board.columns.find((c) => c.id === columnId);
    const value = await promptModal({
      title: 'WIP limit', label: 'Maximum tasks in this column', type: 'number',
      value: String(col.wipLimit || ''), placeholder: '0 for no limit',
      hint: 'A work-in-progress limit is the core kanban rule: when a column is full, finish something before starting anything new.',
    });
    if (value == null) return;
    await patchColumn(columnId, { wipLimit: Math.max(0, Number(value) || 0) }).catch(errorToast);
  },
  toggleDoneColumn: (columnId) => {
    const col = state.board.columns.find((c) => c.id === columnId);
    return patchColumn(columnId, { isDone: !col.isDone }).catch(errorToast);
  },
  moveColumn: (columnId, toIndex) => {
    const columns = [...state.board.columns];
    const from = columns.findIndex((c) => c.id === columnId);
    if (from < 0) return Promise.resolve();
    columns.splice(toIndex, 0, ...columns.splice(from, 1));
    return state.provider.updateBoard(state.boardId, { columns }).catch(errorToast);
  },
  deleteColumn: async (columnId) => {
    const col = state.board.columns.find((c) => c.id === columnId);
    const inColumn = state.tasks.filter((t) => t.columnId === columnId);
    const ok = await confirmModal({
      title: `Delete “${col.name}”?`,
      message: inColumn.length
        ? `${inColumn.length} task${inColumn.length > 1 ? 's' : ''} in this column will be deleted too.`
        : 'This column is empty and will be removed.',
    });
    if (!ok) return;
    if (inColumn.length) await state.provider.deleteTasks(state.boardId, inColumn.map((t) => t.id));
    await state.provider.updateBoard(state.boardId, {
      columns: state.board.columns.filter((c) => c.id !== columnId),
    }).catch(errorToast);
  },
  clearColumn: async (columnId) => {
    const inColumn = state.tasks.filter((t) => t.columnId === columnId);
    if (!inColumn.length) { toast('That column is already empty.'); return; }
    const ok = await confirmModal({
      title: 'Archive all tasks?',
      message: `${inColumn.length} task${inColumn.length > 1 ? 's' : ''} will be deleted from this column.`,
      confirmLabel: 'Delete them',
    });
    if (!ok) return;
    await state.provider.deleteTasks(state.boardId, inColumn.map((t) => t.id)).catch(errorToast);
  },

  /* ---- composer ---- */
  startComposer: (columnId) => { setComposer(columnId); render(); },
  stopComposer: () => { setComposer(null); render(); },

  /* ---- tasks ---- */
  createTask: async ({ columnId, title, keepComposerOpen }) => {
    const last = sortedIn(columnId).at(-1);
    try {
      await state.provider.createTask(state.boardId, {
        title, columnId, order: orderBetween(last?.order ?? null, null), ...donePatchFor(columnId),
      });
      if (!keepComposerOpen) setComposer(null);
    } catch (err) { errorToast(err); }
  },
  updateTask: (taskId, patch) => state.provider.updateTask(state.boardId, taskId, patch),
  deleteTask: async (taskId, { skipConfirm = false } = {}) => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (!skipConfirm) {
      const ok = await confirmModal({ title: 'Delete task?', message: `“${task.title}” will be gone for good.` });
      if (!ok) return;
    }
    await state.provider.deleteTask(state.boardId, taskId).catch(errorToast);
  },
  openTask: (taskId) => {
    openTask?.modal.close();
    const modal = openTaskModal(ctx, taskId);
    openTask = modal ? { id: taskId, modal } : null;
  },

  /** Drop target from drag and drop, or from the keyboard/menu paths. */
  moveTask: async ({ taskId, toColumnId, prevTaskId, nextTaskId }) => {
    const prev = prevTaskId ? state.tasks.find((t) => t.id === prevTaskId) : null;
    const next = nextTaskId ? state.tasks.find((t) => t.id === nextTaskId) : null;
    const patch = { columnId: toColumnId, ...donePatchFor(toColumnId) };
    try {
      if (needsRebalance(prev?.order, next?.order)) {
        const index = sortedIn(toColumnId).filter((t) => t.id !== taskId).findIndex((t) => t.id === nextTaskId);
        await rebalance(toColumnId, taskId, index < 0 ? sortedIn(toColumnId).length : index);
      } else {
        patch.order = orderBetween(prev?.order ?? null, next?.order ?? null);
        await state.provider.updateTask(state.boardId, taskId, patch);
      }
    } catch (err) { errorToast(err); render(); }
  },

  moveTaskToColumn: async (taskId, toColumnId) => {
    const last = sortedIn(toColumnId).filter((t) => t.id !== taskId).at(-1);
    await state.provider.updateTask(state.boardId, taskId, {
      columnId: toColumnId,
      order: orderBetween(last?.order ?? null, null),
      ...donePatchFor(toColumnId),
    }).catch(errorToast);
    const col = state.board.columns.find((c) => c.id === toColumnId);
    announce(`Moved to ${col?.name}.`);
  },

  /** Arrow-key moving for the picked-up card. */
  moveTaskByKey: async (taskId, dir) => {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    const columns = state.board.columns;
    const colIndex = columns.findIndex((c) => c.id === task.columnId);

    if (dir === 'left' || dir === 'right') {
      const target = columns[colIndex + (dir === 'left' ? -1 : 1)];
      if (!target) return;
      await actions.moveTaskToColumn(taskId, target.id);
      return;
    }

    const list = sortedIn(task.columnId).filter((t) => state.visibleTasks.includes(t));
    const i = list.findIndex((t) => t.id === taskId);
    const swapWith = list[i + (dir === 'up' ? -1 : 1)];
    if (!swapWith) return;
    const beyond = list[i + (dir === 'up' ? -2 : 2)];
    const order = dir === 'up'
      ? orderBetween(beyond?.order ?? null, swapWith.order)
      : orderBetween(swapWith.order, beyond?.order ?? null);
    await state.provider.updateTask(state.boardId, taskId, { order }).catch(errorToast);
    announce(`Moved ${dir}, position ${i + (dir === 'up' ? 0 : 2)} of ${list.length}.`);
  },

  setFilters: (patch) => { Object.assign(state.filters, patch); render(); },
};

function patchColumn(columnId, patch) {
  return state.provider.updateBoard(state.boardId, {
    columns: state.board.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)),
  });
}

const ctx = {
  state,
  actions,
  recentlyDragged: () => Date.now() - lastDragEnd < 250,
  onTaskModalClosed: () => { openTask = null; },
};

/* ==================================================================
   Chrome: topbar controls, menus, shortcuts, drag and drop
   ================================================================== */
let chromeReady = false;
function setupChrome() {
  if (chromeReady) return;
  chromeReady = true;

  dnd = initDnd($('#board'), {
    onCardDrop: ({ taskId, toColumnId, prevTaskId, nextTaskId }) => {
      lastDragEnd = Date.now();
      actions.moveTask({ taskId, toColumnId, prevTaskId, nextTaskId }).finally(flushRender);
    },
    onColumnDrop: ({ columnId, toIndex }) => {
      lastDragEnd = Date.now();
      actions.moveColumn(columnId, toIndex).finally(flushRender);
    },
    onCancel: () => { lastDragEnd = Date.now(); flushRender(); },
  });

  $('#new-board-btn').onclick = () => newBoardDialog(ctx);
  $('#add-task-btn').onclick = () => {
    const col = state.board?.columns[0];
    if (!col) { newBoardDialog(ctx); return; }
    actions.startComposer(col.id);
  };
  $('#filter-btn').onclick = () => filterDialog(ctx);
  $('#user-btn').onclick = (e) => openUserMenu(e.currentTarget);
  $('#sidebar-open').onclick = () => $('#app').classList.add('sidebar-open');
  $('#sidebar-close').onclick = closeSidebar;
  $('#sidebar-scrim').onclick = closeSidebar;

  const search = $('#search-input');
  search.addEventListener('input', debounce((e) => actions.setFilters({ text: e.target.value }), 160));
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; actions.setFilters({ text: '' }); search.blur(); } });

  document.addEventListener('keydown', onGlobalKey);
}

function flushRender() {
  if (renderQueued || !dnd?.isDragging) { renderQueued = false; render(); }
}

function closeSidebar() {
  $('#app').classList.remove('sidebar-open');
  $('#sidebar-scrim').hidden = true;
}
new MutationObserver(() => {
  $('#sidebar-scrim').hidden = !$('#app').classList.contains('sidebar-open');
}).observe(document.getElementById('app'), { attributes: true, attributeFilter: ['class'] });

function onGlobalKey(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('.modal-scrim')) return;

  if (e.key === 'Escape' && $('#app').classList.contains('sidebar-open')) { closeSidebar(); return; }
  if (e.key === '/') { e.preventDefault(); $('#search-input').focus(); return; }
  if (e.key === 'n' || e.key === 'N') {
    const col = state.board?.columns[0];
    if (col) { e.preventDefault(); actions.startComposer(col.id); }
    return;
  }
  if (e.key === 'b' || e.key === 'B') { e.preventDefault(); newBoardDialog(ctx); return; }
  if (e.key === '?') { e.preventDefault(); shortcutsDialog(); }
}

function openBoardMenu(anchor) {
  const cloud = state.provider.mode === 'cloud';
  openMenu(anchor, [
    { label: 'Board settings', icon: icons.pencil, onSelect: () => boardSettingsDialog(ctx) },
    { label: 'Add column', icon: icons.plus, onSelect: () => actions.addColumn() },
    cloud ? { label: 'Share board', icon: icons.people, onSelect: () => shareDialog(ctx) } : null,
    { type: 'sep' },
    { label: 'New board', icon: icons.plus, onSelect: () => newBoardDialog(ctx) },
    { label: 'Keyboard shortcuts', icon: icons.keyboard, onSelect: shortcutsDialog },
  ].filter(Boolean), { align: 'start' });
}

function openUserMenu(anchor) {
  const theme = localStorage.getItem(THEME_KEY) || 'system';
  openMenu(anchor, [
    { type: 'label', text: state.user.displayName + (state.user.email ? ` · ${state.user.email}` : '') },
    { type: 'sep' },
    { type: 'label', text: 'Theme' },
    { label: 'System', checked: theme === 'system', onSelect: () => applyTheme('system') },
    { label: 'Light', icon: icons.sun, checked: theme === 'light', onSelect: () => applyTheme('light') },
    { label: 'Dark', icon: icons.moon, checked: theme === 'dark', onSelect: () => applyTheme('dark') },
    { type: 'label', text: 'Accent' },
    accentSwatches(),
    { type: 'sep' },
    { label: 'Keyboard shortcuts', icon: icons.keyboard, onSelect: shortcutsDialog },
    state.provider.updateProfile ? {
      label: 'Change display name', icon: icons.pencil, onSelect: renameSelf,
    } : null,
    { label: 'Sign out', icon: icons.logout, onSelect: () => state.provider.signOut() },
  ].filter(Boolean));
}

async function renameSelf() {
  const name = await promptModal({
    title: 'Display name', label: 'Shown on cards you are assigned',
    value: state.user.displayName || '',
  });
  if (!name) return;
  await state.provider.updateProfile({ displayName: name }).catch(errorToast);
}

/** Row of accent swatches; each shows its own tone for the theme in use. */
function accentSwatches() {
  const current = localStorage.getItem(ACCENT_KEY) || 'violet';
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;

  const row = el('div', { class: 'swatches', role: 'group', 'aria-label': 'Accent colour' });
  row.append(...ACCENTS.map((accent) => el('button', {
    class: 'swatch', type: 'button', title: accent.name, 'aria-label': accent.name,
    'aria-pressed': String(accent.id === current),
    style: `background: ${dark ? accent.dark : accent.light}`,
    onclick: (e) => {
      applyAccent(accent.id);
      [...row.children].forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
    },
  })));
  return row;
}

function applyAccent(accent) {
  const known = ACCENTS.some((a) => a.id === accent) ? accent : 'violet';
  localStorage.setItem(ACCENT_KEY, known);
  document.documentElement.dataset.accent = known;
}

function applyTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}

// Handy in the console, and used by the demo data notes.
window.taskboard = { state, actions };
