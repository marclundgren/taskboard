/* Small shared helpers. */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Sortable, collision-resistant id (time prefix + randomness). */
export function uid(prefix = '') {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}${t}${r}`;
}

export function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

/* ---------------------------------------------------------------
   Ordering: cards carry a numeric `order`. Inserting between two
   neighbours takes the midpoint, so a move writes exactly one card.
   --------------------------------------------------------------- */
export const ORDER_STEP = 1024;
export const MIN_GAP = 0.0005;

export function orderBetween(prev, next) {
  if (prev == null && next == null) return ORDER_STEP;
  if (prev == null) return next - ORDER_STEP;
  if (next == null) return prev + ORDER_STEP;
  return (prev + next) / 2;
}

/** True when midpoints have run out of precision and the column needs renumbering. */
export function needsRebalance(prev, next) {
  return prev != null && next != null && Math.abs(next - prev) < MIN_GAP;
}

/* ---------------------------------------------------------------
   Dates
   --------------------------------------------------------------- */
export function todayISO(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from today to an ISO date (negative = overdue). */
export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((then - start) / 86400000);
}

export function formatDue(iso) {
  const n = daysUntil(iso);
  if (n == null) return '';
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function dueState(iso) {
  const n = daysUntil(iso);
  if (n == null) return '';
  if (n < 0) return 'is-over';
  if (n <= 2) return 'is-soon';
  return '';
}

export function formatWhen(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---------------------------------------------------------------
   People + labels
   --------------------------------------------------------------- */
export function initials(name = '', email = '') {
  const source = (name || email || '?').trim();
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

const AVATAR_HUES = [259, 209, 340, 152, 26, 288, 190, 45];
export function hueFor(key = '') {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

export const LABEL_COLORS = {
  violet: '#6d5efc', blue: '#2f80ed', teal: '#0e9f9f', green: '#16a34a',
  amber:  '#d9820a', red:  '#e5484d', pink: '#db2777', slate: '#64748b',
};

/** Accent palettes offered by the picker; each has a light and a dark tone. */
export const ACCENTS = [
  { id: 'violet', name: 'Violet', light: '#6d5efc', dark: '#8478ff' },
  { id: 'blue',   name: 'Blue',   light: '#2563eb', dark: '#6fa5ff' },
  { id: 'teal',   name: 'Teal',   light: '#0f766e', dark: '#2dd4bf' },
  { id: 'green',  name: 'Green',  light: '#15803d', dark: '#4ade80' },
  { id: 'amber',  name: 'Amber',  light: '#b45309', dark: '#fbbf24' },
  { id: 'rose',   name: 'Rose',   light: '#dc2626', dark: '#fb7185' },
  { id: 'slate',  name: 'Slate',  light: '#475569', dark: '#a3b1c6' },
];

export const PRIORITIES = [
  { id: 'none',   name: 'No priority' },
  { id: 'low',    name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high',   name: 'High' },
  { id: 'urgent', name: 'Urgent' },
];

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
