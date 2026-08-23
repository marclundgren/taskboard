import { el } from '../util.js';
import { icons } from './icons.js';

export function renderSidebar(mount, ctx) {
  const { state, actions } = ctx;
  const groups = [
    { key: 'private', title: 'Private', icon: icons.lock, boards: [] },
    { key: 'shared',  title: 'Shared',  icon: icons.people, boards: [] },
  ];
  for (const b of [...state.boards].sort((a, z) => a.name.localeCompare(z.name))) {
    const shared = b.visibility === 'shared' || (b.memberIds || []).length > 1;
    groups[shared ? 1 : 0].boards.push(b);
  }

  mount.replaceChildren(...groups.map((g) => el('div', { class: 'nav-group' }, [
    el('div', { class: 'nav-group__title' }, [el('span', { html: g.icon, style: 'display:flex' }), g.title]),
    ...(g.boards.length
      ? g.boards.map((b) => {
          const open = state.taskCounts[b.id];
          return el('button', {
            class: 'nav-item', type: 'button',
            'aria-current': String(b.id === state.boardId),
            onclick: () => actions.selectBoard(b.id),
          }, [
            el('span', { class: 'nav-item__emoji', text: b.emoji || '📋' }),
            el('span', { class: 'nav-item__name', text: b.name }),
            open ? el('span', { class: 'nav-item__count', text: String(open) }) : null,
          ]);
        })
      : [el('div', { class: 'nav-empty', text: g.key === 'shared' ? 'Nothing shared yet' : 'No private boards' })]),
  ])));
}
