import { el } from '../util.js';

const root = () => document.getElementById('toast-root');

export function toast(message, { type = '', actionLabel, onAction, duration = 4000 } = {}) {
  const node = el('div', { class: `toast ${type ? `toast--${type}` : ''}` }, [
    el('span', { text: message }),
    actionLabel ? el('button', { type: 'button', text: actionLabel, onclick: () => { close(); onAction?.(); } }) : null,
  ]);
  const timer = setTimeout(close, duration);
  function close() { clearTimeout(timer); node.remove(); }
  root().append(node);
  return close;
}

export const errorToast = (err) => toast(err?.message || String(err), { type: 'error', duration: 6500 });

/** Screen-reader announcement for actions with no visible focus change. */
export function announce(message) {
  const live = document.getElementById('sr-live');
  if (live) live.textContent = message;
}
