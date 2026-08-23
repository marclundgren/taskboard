import { el, clamp } from '../util.js';

let current = null;

export function closeMenu() {
  if (!current) return;
  const { node, cleanup } = current;
  current = null;
  cleanup();
  node.remove();
}

/**
 * Popover menu anchored to an element.
 * items: {label, icon, onSelect, danger, checked} | {type:'sep'} | {type:'label', text} | HTMLElement
 */
export function openMenu(anchor, items, { align = 'end' } = {}) {
  closeMenu();
  const node = el('div', { class: 'menu', role: 'menu' });

  for (const item of items) {
    if (!item) continue;
    if (item.nodeType) { node.append(item); continue; }
    if (item.type === 'sep') { node.append(el('div', { class: 'menu__sep' })); continue; }
    if (item.type === 'label') { node.append(el('div', { class: 'menu__label', text: item.text })); continue; }
    node.append(el('button', {
      type: 'button',
      role: item.checked == null ? 'menuitem' : 'menuitemradio',
      class: `menu__item ${item.danger ? 'menu__item--danger' : ''}`,
      'aria-checked': item.checked == null ? null : String(!!item.checked),
      onclick: (e) => { e.stopPropagation(); closeMenu(); item.onSelect?.(); },
    }, [
      item.icon ? el('span', { html: item.icon, 'aria-hidden': 'true' }) : null,
      el('span', { text: item.label }),
    ]));
  }

  document.getElementById('menu-root').append(node);

  const rect = anchor.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const left = align === 'start' ? rect.left : rect.right - box.width;
  node.style.left = `${clamp(left, 8, window.innerWidth - box.width - 8)}px`;
  const below = rect.bottom + 6;
  node.style.top = `${below + box.height > window.innerHeight - 8
    ? Math.max(8, rect.top - box.height - 6)
    : below}px`;

  const onDocDown = (e) => { if (!node.contains(e.target)) closeMenu(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus?.(); } };
  const cleanup = () => {
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', closeMenu);
    window.removeEventListener('scroll', closeMenu, true);
  };
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);

  current = { node, cleanup };
  node.querySelector('.menu__item')?.focus();
  return closeMenu;
}
