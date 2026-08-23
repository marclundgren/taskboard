/* Board creation, board settings, sharing, filters and the shortcut sheet. */
import { el, PRIORITIES } from '../util.js';
import { openModal, confirmModal } from './modal.js';
import { avatarNode } from './common.js';
import { errorToast, toast } from './toast.js';

const EMOJI = ['📋', '🌱', '🏡', '💼', '🎯', '🧾', '🛠️', '🎨', '🧳', '💡', '🐣', '🔥'];

export function newBoardDialog(ctx) {
  const { actions, state } = ctx;
  let emoji = '📋';
  const name = el('input', { class: 'input', placeholder: 'e.g. Household, Work, Trip to Lisbon', 'data-autofocus': '' });
  const emojiRow = el('div', { class: 'chips' });
  const renderEmoji = () => emojiRow.replaceChildren(...EMOJI.map((e) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(e === emoji), text: e,
    onclick: () => { emoji = e; renderEmoji(); },
  })));
  renderEmoji();

  const visibility = el('div', { class: 'chips' });
  let vis = 'private';
  const renderVis = () => visibility.replaceChildren(
    ...[
      { id: 'private', label: '🔒 Private — only me' },
      { id: 'shared', label: '👥 Shared — invite people' },
    ].map((o) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(vis === o.id), text: o.label,
      onclick: () => { vis = o.id; renderVis(); },
    })),
  );
  renderVis();

  const create = async () => {
    const value = name.value.trim();
    if (!value) { name.focus(); return; }
    m.close();
    try {
      const id = await actions.createBoard({ name: value, emoji, visibility: vis });
      if (vis === 'shared' && state.provider.mode === 'cloud') shareDialog(ctx, id);
    } catch (err) { errorToast(err); }
  };

  const m = openModal({
    title: 'New board',
    size: 'sm',
    body: [
      el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
      el('div', { class: 'field' }, [el('label', { text: 'Icon' }), emojiRow]),
      el('div', { class: 'field' }, [el('label', { text: 'Visibility' }), visibility]),
      state.provider.mode === 'local'
        ? el('p', { class: 'meta-note', text: 'Local mode: boards live in this browser only. Add Firebase config to share them.' })
        : null,
    ],
    footer: [
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => m.close() }),
      el('button', { class: 'btn btn--primary', type: 'button', text: 'Create board', onclick: create }),
    ],
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
}

export function boardSettingsDialog(ctx) {
  const { state, actions } = ctx;
  const board = state.board;
  let emoji = board.emoji || '📋';
  const name = el('input', { class: 'input', value: board.name, 'data-autofocus': '' });
  const emojiRow = el('div', { class: 'chips' });
  const renderEmoji = () => emojiRow.replaceChildren(...EMOJI.map((e) => el('button', {
    class: 'chip', type: 'button', 'aria-pressed': String(e === emoji), text: e,
    onclick: () => { emoji = e; renderEmoji(); },
  })));
  renderEmoji();

  const m = openModal({
    title: 'Board settings',
    size: 'sm',
    body: [
      el('div', { class: 'field' }, [el('label', { text: 'Name' }), name]),
      el('div', { class: 'field' }, [el('label', { text: 'Icon' }), emojiRow]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Labels' }),
        el('div', { class: 'chips' }, board.labels.length
          ? board.labels.map((l) => el('span', { class: 'chip' }, [
              el('span', { class: 'chip__swatch', style: `background:${l.color}` }),
              l.name,
              el('button', {
                class: 'chip__x', type: 'button', 'aria-label': `Delete label ${l.name}`, text: '×',
                onclick: async () => { await actions.deleteLabel(l.id).catch(errorToast); m.close(); },
              }),
            ]))
          : [el('span', { class: 'meta-note', text: 'No labels yet — add one from any task.' })]),
      ]),
    ],
    footer: [
      el('button', {
        class: 'btn btn--danger', type: 'button', text: 'Delete board',
        onclick: async () => {
          const ok = await confirmModal({
            title: 'Delete board?',
            message: `“${board.name}” and all of its tasks will be permanently deleted.`,
          });
          if (!ok) return;
          m.close();
          actions.deleteBoard().catch(errorToast);
        },
      }),
      el('span', { class: 'grow' }),
      el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => m.close() }),
      el('button', {
        class: 'btn btn--primary', type: 'button', text: 'Save',
        onclick: () => {
          actions.updateBoard({ name: name.value.trim() || board.name, emoji }).catch(errorToast);
          m.close();
        },
      }),
    ],
  });
}

export function shareDialog(ctx, boardId = null) {
  const { state, actions } = ctx;
  const board = boardId ? state.boards.find((b) => b.id === boardId) : state.board;
  if (!board) return;

  if (state.provider.mode === 'local') {
    openModal({
      title: 'Sharing needs cloud mode',
      size: 'sm',
      body: el('p', { style: 'margin:0;color:var(--text-2);line-height:1.6' }, [
        'Right now Taskboard is running in local mode — boards are stored in this browser only. ',
        'Add your Firebase config to ', el('code', { text: 'config.js' }),
        ' to turn on accounts, realtime sync and shared boards. The README walks through it in about five minutes.',
      ]),
      footer: [el('span', { class: 'grow' }), el('button', { class: 'btn btn--primary', type: 'button', text: 'Got it', onclick: (e) => e.target.closest('.modal-scrim').remove() })],
    });
    return;
  }

  const list = el('div');
  const email = el('input', { class: 'input', type: 'email', placeholder: 'partner@example.com', 'data-autofocus': '' });

  const renderMembers = () => {
    const current = state.boards.find((b) => b.id === board.id) || board;
    list.replaceChildren(...(current.memberIds || []).map((id) => {
      const p = state.profiles[id] || { uid: id, displayName: id === state.user.uid ? 'You' : 'Member' };
      const isOwner = id === current.ownerId;
      return el('div', { class: 'member-row' }, [
        avatarNode(p),
        el('div', { class: 'who' }, [
          el('b', { text: p.displayName + (id === state.user.uid ? ' (you)' : '') }),
          el('span', { text: isOwner ? 'Owner' : (p.email || 'Member') }),
        ]),
        isOwner ? null : el('button', {
          class: 'btn btn--sm btn--danger', type: 'button', text: 'Remove',
          onclick: async () => {
            await actions.removeMember(current.id, id).catch(errorToast);
            renderMembers();
          },
        }),
      ]);
    }));
  };
  renderMembers();

  const invite = async () => {
    const value = email.value.trim();
    if (!value) return;
    try {
      await actions.addMember(board.id, value);
      email.value = '';
      toast(`${value} can now see this board.`);
      renderMembers();
    } catch (err) { errorToast(err); }
  };

  const m = openModal({
    title: `Share “${board.name}”`,
    size: 'sm',
    body: [
      el('div', { class: 'field' }, [
        el('label', { text: 'Invite by email' }),
        el('div', { class: 'row row--tight' }, [
          email,
          el('button', { class: 'btn btn--primary', type: 'button', text: 'Add', onclick: invite }),
        ]),
        el('p', { class: 'meta-note', text: 'They need to sign in to this Taskboard once first — then their email becomes invitable.' }),
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'People with access' }), list]),
    ],
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn btn--primary', type: 'button', text: 'Done', onclick: () => m.close() })],
  });
  email.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); invite(); } });
}

export function filterDialog(ctx) {
  const { state, actions } = ctx;
  const f = { ...state.filters };
  const board = state.board;

  const chipRow = (options, key) => {
    const row = el('div', { class: 'chips' });
    const render = () => row.replaceChildren(...options.map((o) => el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(f[key] === o.id), text: o.label,
      onclick: () => { f[key] = f[key] === o.id ? '' : o.id; render(); },
    })));
    render();
    return row;
  };

  const assignee = el('select', { class: 'select' }, [
    el('option', { value: '', selected: !f.assignee, text: 'Anyone' }),
    el('option', { value: '@me', selected: f.assignee === '@me', text: 'Me' }),
    el('option', { value: '@none', selected: f.assignee === '@none', text: 'Unassigned' }),
    ...(board?.memberIds || []).filter((id) => id !== state.user.uid).map((id) => el('option', {
      value: id, selected: f.assignee === id, text: state.profiles[id]?.displayName || 'Member',
    })),
  ]);

  const hideDone = el('input', { type: 'checkbox', checked: f.hideDone });

  const m = openModal({
    title: 'Filter tasks',
    size: 'sm',
    body: [
      el('div', { class: 'field' }, [el('label', { text: 'Assignee' }), assignee]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Due' }),
        chipRow([
          { id: 'overdue', label: 'Overdue' },
          { id: 'today', label: 'Today' },
          { id: 'week', label: 'Next 7 days' },
          { id: 'none', label: 'No date' },
        ], 'due'),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'Priority' }),
        chipRow(PRIORITIES.slice(1).map((p) => ({ id: p.id, label: p.name })), 'priority'),
      ]),
      board?.labels?.length ? el('div', { class: 'field' }, [
        el('label', { text: 'Label' }),
        chipRow(board.labels.map((l) => ({ id: l.id, label: l.name })), 'label'),
      ]) : null,
      el('label', { class: 'row', style: 'align-items:center;gap:8px;cursor:pointer' }, [
        hideDone, el('span', { text: 'Hide tasks in done columns' }),
      ]),
    ],
    footer: [
      el('button', {
        class: 'btn', type: 'button', text: 'Clear all',
        onclick: () => { actions.setFilters({ assignee: '', due: '', priority: '', label: '', hideDone: false }); m.close(); },
      }),
      el('span', { class: 'grow' }),
      el('button', {
        class: 'btn btn--primary', type: 'button', text: 'Apply',
        onclick: () => {
          actions.setFilters({ ...f, assignee: assignee.value, hideDone: hideDone.checked });
          m.close();
        },
      }),
    ],
  });
}

export function shortcutsDialog() {
  const rows = [
    ['N', 'New task in the first column'],
    ['/', 'Search tasks'],
    ['B', 'New board'],
    ['Tab', 'Move focus between cards'],
    ['Space', 'Pick up / drop the focused card'],
    ['← → ↑ ↓', 'Move a picked-up card'],
    ['Enter', 'Open the focused card'],
    ['Esc', 'Close a dialog or cancel a move'],
  ];
  const m = openModal({
    title: 'Keyboard shortcuts',
    size: 'sm',
    body: el('div', { style: 'display:grid;gap:8px' }, rows.map(([key, what]) => el('div', {
      style: 'display:flex;gap:12px;align-items:center',
    }, [
      el('kbd', { text: key, style: 'flex:none;min-width:74px;padding:3px 7px;border:1px solid var(--border);border-bottom-width:2px;border-radius:6px;background:var(--surface-2);font:inherit;font-size:12px;text-align:center' }),
      el('span', { text: what, style: 'color:var(--text-2)' }),
    ]))),
    footer: [el('span', { class: 'grow' }), el('button', { class: 'btn btn--primary', type: 'button', text: 'Close', onclick: () => m.close() })],
  });
}
