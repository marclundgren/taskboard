/* Shared shapes + factory helpers used by both storage providers. */
import { uid, ORDER_STEP, LABEL_COLORS } from '../util.js';

export function makeColumns(defs) {
  return defs.map((c) => ({
    id: uid('col_'),
    name: c.name,
    wipLimit: c.wipLimit || 0,
    isDone: !!c.isDone,
  }));
}

export function makeBoard({ name, emoji = '📋', visibility = 'private', ownerId, columns }) {
  const now = Date.now();
  return {
    name: name || 'Untitled board',
    emoji,
    visibility,
    ownerId,
    memberIds: [ownerId],
    pendingEmails: [],
    columns,
    labels: [
      { id: uid('lb_'), name: 'Home',    color: LABEL_COLORS.green },
      { id: uid('lb_'), name: 'Errand',  color: LABEL_COLORS.amber },
      { id: uid('lb_'), name: 'Admin',   color: LABEL_COLORS.slate },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function makeTask({ title, columnId, order = ORDER_STEP, createdBy, ...rest }) {
  const now = Date.now();
  return {
    title: (title || '').trim() || 'Untitled task',
    notes: '',
    columnId,
    order,
    priority: 'none',
    labels: [],
    dueDate: '',
    assigneeId: '',
    checklist: [],
    done: false,
    createdBy,
    createdAt: now,
    updatedAt: now,
    ...rest,
  };
}

/** Fill in fields added after a board/task was first written. */
export function normalizeBoard(b) {
  return {
    emoji: '📋',
    visibility: 'private',
    memberIds: [],
    pendingEmails: [],
    columns: [],
    labels: [],
    ...b,
  };
}

export function normalizeTask(t) {
  return {
    notes: '', priority: 'none', labels: [], dueDate: '', assigneeId: '',
    checklist: [], done: false, order: 0,
    ...t,
  };
}
