/* Renders the columns + cards, and owns the card composer, the column
   menus and keyboard card moving. */
import { el, formatDue, dueState, PRIORITIES } from '../util.js';
import { icons } from './icons.js';
import { avatarNode, labelChipNode, emptyState } from './common.js';
import { openMenu } from './menu.js';
import { announce } from './toast.js';

let composerColumnId = null;
let composerDraft = '';
const scrollMemory = new Map();   // columnId -> scrollTop
let grabbedTaskId = null;

export function setComposer(columnId) {
  composerColumnId = columnId;
  composerDraft = '';
}

export function renderBoard(mount, ctx) {
  const { state, actions } = ctx;
  const board = state.board;

  // Remember where each column was scrolled to before we rebuild it.
  mount.querySelectorAll('.column__cards').forEach((list) => {
    scrollMemory.set(list.closest('.column').dataset.columnId, list.scrollTop);
  });

  if (!board) {
    mount.replaceChildren(emptyState({
      title: state.boards.length ? 'Pick a board' : 'No boards yet',
      message: state.boards.length
        ? 'Choose one from the sidebar to get going.'
        : 'Create your first board — keep it private, or share it with someone.',
      actionLabel: state.boards.length ? null : 'New board',
      onAction: actions.newBoard,
    }));
    return;
  }

  if (!board.columns.length) {
    mount.replaceChildren(
      emptyState({
        title: 'This board has no columns',
        message: 'Columns are the stages work moves through: To do → In progress → Done.',
        actionLabel: 'Add a column',
        onAction: actions.addColumn,
      }),
    );
    return;
  }

  const visible = state.visibleTasks;
  const nodes = board.columns.map((col) => renderColumn(col, visible.filter((t) => t.columnId === col.id), ctx));
  nodes.push(el('button', {
    class: 'add-column', type: 'button', onclick: actions.addColumn,
  }, [`+  Add column`]));

  mount.replaceChildren(...nodes);

  // Restore scroll + focus after the rebuild.
  mount.querySelectorAll('.column__cards').forEach((list) => {
    const top = scrollMemory.get(list.closest('.column').dataset.columnId);
    if (top) list.scrollTop = top;
  });
  if (composerColumnId) {
    const ta = mount.querySelector(`.column[data-column-id="${cssEscape(composerColumnId)}"] .composer textarea`);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  if (grabbedTaskId) {
    const card = mount.querySelector(`.card[data-task-id="${cssEscape(grabbedTaskId)}"]`);
    if (card) { card.classList.add('is-grabbed'); card.focus(); }
    else grabbedTaskId = null;
  }
}

const cssEscape = (v) => (window.CSS?.escape ? CSS.escape(v) : String(v).replace(/"/g, '\\"'));

/* ---------------------------------------------------------------
   Column
   --------------------------------------------------------------- */
function renderColumn(col, tasks, ctx) {
  const { actions, state } = ctx;
  const sorted = [...tasks].sort((a, b) => a.order - b.order);
  const total = state.tasks.filter((t) => t.columnId === col.id).length;
  const overLimit = col.wipLimit > 0 && total > col.wipLimit;

  const head = el('div', { class: 'column__head' }, [
    el('span', { class: 'column__dot', style: `background:${col.isDone ? 'var(--ok)' : 'var(--text-3)'}` }),
    el('span', { class: 'column__name', text: col.name }),
    el('span', {
      class: 'column__count',
      text: col.wipLimit > 0 ? `${total}/${col.wipLimit}` : String(total),
      title: col.wipLimit > 0 ? `${total} tasks, WIP limit ${col.wipLimit}` : `${total} tasks`,
    }),
    el('div', { class: 'column__head-actions' }, [
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': `Add task to ${col.name}`,
        html: icons.plus, onclick: () => actions.startComposer(col.id),
      }),
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': `${col.name} column options`, html: icons.dots,
        onclick: (e) => openColumnMenu(e.currentTarget, col, ctx),
      }),
    ]),
  ]);

  const list = el('div', { class: 'column__cards' },
    sorted.length
      ? sorted.map((task) => renderCard(task, ctx))
      : (composerColumnId === col.id ? [] : [el('div', { class: 'column-empty', text: 'Nothing here yet' })]),
  );

  if (composerColumnId === col.id) list.append(renderComposer(col, ctx));

  return el('div', {
    class: `column ${overLimit ? 'is-over-limit' : ''}`,
    dataset: { columnId: col.id },
    'aria-label': col.name,
  }, [
    head,
    overLimit ? el('div', { class: 'column__wip', text: `Over the WIP limit — finish something before starting more.` }) : null,
    list,
    composerColumnId === col.id ? null : el('div', { class: 'column__foot' }, [
      el('button', {
        class: 'btn btn--ghost btn--sm btn--block', type: 'button',
        onclick: () => actions.startComposer(col.id),
      }, ['+  Add task']),
    ]),
  ]);
}

function renderComposer(col, { actions }) {
  const ta = el('textarea', {
    placeholder: 'What needs doing?', rows: '2', 'aria-label': `New task in ${col.name}`,
    oninput: (e) => { composerDraft = e.target.value; },
  });
  ta.value = composerDraft;

  const submit = (keepOpen = true) => {
    const title = ta.value.trim();
    if (!title) { if (!keepOpen) actions.stopComposer(); return; }
    composerDraft = '';
    ta.value = '';
    actions.createTask({ columnId: col.id, title, keepComposerOpen: keepOpen });
  };

  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(true); }
    if (e.key === 'Escape') { e.preventDefault(); actions.stopComposer(); }
  });

  return el('div', { class: 'composer', 'data-no-drag': '' }, [
    ta,
    el('div', { class: 'composer__actions' }, [
      el('button', { class: 'btn btn--primary btn--sm', type: 'button', text: 'Add', onclick: () => submit(true) }),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Done', onclick: () => actions.stopComposer() }),
      el('span', { class: 'composer__hint', text: 'Enter to add' }),
    ]),
  ]);
}

/* ---------------------------------------------------------------
   Card
   --------------------------------------------------------------- */
function renderCard(task, ctx) {
  const { state, actions } = ctx;
  const board = state.board;
  const labels = (task.labels || [])
    .map((id) => board.labels.find((l) => l.id === id))
    .filter(Boolean);
  const doneCount = (task.checklist || []).filter((c) => c.done).length;

  const meta = [];
  if (task.dueDate) {
    meta.push(el('span', { class: `meta meta--due ${dueState(task.dueDate)}` }, [
      el('span', { html: icons.calendar }), formatDue(task.dueDate),
    ]));
  }
  if (task.checklist?.length) {
    meta.push(el('span', { class: 'meta' }, [
      el('span', { html: icons.checklist }), `${doneCount}/${task.checklist.length}`,
    ]));
  }
  if (task.notes) meta.push(el('span', { class: 'meta', html: icons.notes, 'aria-label': 'Has notes' }));
  if (meta.length) meta.push(el('span', { class: 'spacer' }));
  if (task.assigneeId) {
    meta.push(avatarNode(state.profiles[task.assigneeId] || { uid: task.assigneeId, displayName: '?' }, 'avatar--sm'));
  } else if (meta.length) {
    meta.pop();
  }

  const card = el('article', {
    class: `card ${task.done ? 'is-done' : ''}`,
    dataset: { taskId: task.id, priority: task.priority || 'none' },
    tabindex: '0', role: 'button',
    'aria-roledescription': 'Task card, press Space to move it',
    'aria-label': `${task.title}${task.dueDate ? `, due ${formatDue(task.dueDate)}` : ''}`,
  }, [
    el('span', { class: 'card__prio' }),
    el('button', {
      class: 'icon-btn card__menu', type: 'button', 'aria-label': `Options for ${task.title}`,
      html: icons.dots, onclick: (e) => { e.stopPropagation(); openCardMenu(e.currentTarget, task, ctx); },
    }),
    labels.length ? el('div', { class: 'card__labels' }, labels.map(labelChipNode)) : null,
    el('div', { class: 'card__title', text: task.title }),
    meta.length ? el('div', { class: 'card__meta' }, meta) : null,
  ]);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    if (ctx.recentlyDragged()) return;
    actions.openTask(task.id);
  });

  card.addEventListener('keydown', (e) => onCardKey(e, task, ctx));
  return card;
}

/* Keyboard moving: Space starts move mode, arrows move, Space/Enter/Escape end it.
   This is the non-dragging path to everything drag and drop does. */
function onCardKey(e, task, ctx) {
  const { actions } = ctx;
  const grabbed = grabbedTaskId === task.id;

  if (e.key === 'Enter' && !grabbed) { e.preventDefault(); actions.openTask(task.id); return; }

  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    if (grabbed) {
      grabbedTaskId = null;
      e.currentTarget.classList.remove('is-grabbed');
      announce(`${task.title} dropped.`);
    } else {
      grabbedTaskId = task.id;
      e.currentTarget.classList.add('is-grabbed');
      announce(`${task.title} picked up. Use the arrow keys to move it, space to drop.`);
    }
    return;
  }

  if (grabbed && e.key === 'Escape') {
    e.preventDefault();
    grabbedTaskId = null;
    e.currentTarget.classList.remove('is-grabbed');
    announce('Move finished.');
    return;
  }

  if (!grabbed) return;
  const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const dir = dirs[e.key];
  if (!dir) return;
  e.preventDefault();
  actions.moveTaskByKey(task.id, dir);
}

export function clearGrab() { grabbedTaskId = null; }

/* ---------------------------------------------------------------
   Menus
   --------------------------------------------------------------- */
function openCardMenu(anchor, task, ctx) {
  const { state, actions } = ctx;
  const columns = state.board.columns.filter((c) => c.id !== task.columnId);
  openMenu(anchor, [
    { label: 'Open task', icon: icons.pencil, onSelect: () => actions.openTask(task.id) },
    { type: 'sep' },
    { type: 'label', text: 'Move to' },
    ...columns.map((c) => ({
      label: c.name, icon: icons.arrowRight,
      onSelect: () => actions.moveTaskToColumn(task.id, c.id),
    })),
    { type: 'sep' },
    { type: 'label', text: 'Priority' },
    ...PRIORITIES.slice(1).map((p) => ({
      label: p.name, icon: icons.flag, checked: task.priority === p.id,
      onSelect: () => actions.updateTask(task.id, { priority: task.priority === p.id ? 'none' : p.id }),
    })),
    { type: 'sep' },
    { label: 'Delete task', icon: icons.trash, danger: true, onSelect: () => actions.deleteTask(task.id) },
  ]);
}

function openColumnMenu(anchor, col, ctx) {
  const { actions, state } = ctx;
  const index = state.board.columns.findIndex((c) => c.id === col.id);
  const last = state.board.columns.length - 1;
  openMenu(anchor, [
    { label: 'Rename column', icon: icons.pencil, onSelect: () => actions.renameColumn(col.id) },
    { label: col.wipLimit ? `WIP limit (${col.wipLimit})` : 'Set WIP limit', icon: icons.flag, onSelect: () => actions.setWipLimit(col.id) },
    { label: col.isDone ? 'Not a done column' : 'Mark as done column', icon: icons.check, onSelect: () => actions.toggleDoneColumn(col.id) },
    { type: 'sep' },
    index > 0 ? { label: 'Move left', icon: icons.arrowLeft, onSelect: () => actions.moveColumn(col.id, index - 1) } : null,
    index < last ? { label: 'Move right', icon: icons.arrowRight, onSelect: () => actions.moveColumn(col.id, index + 1) } : null,
    { type: 'sep' },
    { label: 'Archive all tasks here', icon: icons.broom, danger: true, onSelect: () => actions.clearColumn(col.id) },
    { label: 'Delete column', icon: icons.trash, danger: true, onSelect: () => actions.deleteColumn(col.id) },
  ].filter(Boolean));
}
