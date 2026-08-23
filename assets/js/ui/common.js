import { el, initials, hueFor } from '../util.js';

export function avatarNode(profile, cls = '') {
  const p = profile || {};
  const name = p.displayName || p.email || 'Unassigned';
  const node = el('span', {
    class: `avatar ${cls}`, title: name,
    style: profile ? `background: hsl(${hueFor(p.uid || name)} 62% 88%); color: hsl(${hueFor(p.uid || name)} 55% 28%)` : '',
  });
  if (p.photoURL) node.append(el('img', { src: p.photoURL, alt: '', referrerpolicy: 'no-referrer' }));
  else node.textContent = profile ? initials(p.displayName, p.email) : '–';
  return node;
}

export function labelChipNode(label) {
  return el('span', {
    class: 'label-chip', text: label.name,
    style: `background: color-mix(in srgb, ${label.color} 18%, transparent); color: ${label.color}`,
  });
}

export function emptyState({ title, message, actionLabel, onAction }) {
  return el('div', { class: 'empty-state' }, [
    el('h2', { text: title }),
    el('p', { text: message }),
    actionLabel ? el('button', { class: 'btn btn--primary', type: 'button', text: actionLabel, onclick: onAction }) : null,
  ]);
}
