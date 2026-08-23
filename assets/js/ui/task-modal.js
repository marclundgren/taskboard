/* The task detail dialog. Everything auto-saves — there is no Save button. */
import { el, debounce, uid, PRIORITIES, LABEL_COLORS, formatWhen, todayISO } from '../util.js';
import { openModal, confirmModal } from './modal.js';
import { icons } from './icons.js';
import { errorToast } from './toast.js';

export function openTaskModal(ctx, taskId) {
  const { state, actions } = ctx;
  const board = state.board;
  let task = state.tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const save = (patch) => actions.updateTask(taskId, patch).catch(errorToast);
  const saveText = debounce(save, 500);

  const titleInput = el('input', {
    class: 'title-input', value: task.title, 'aria-label': 'Task title', 'data-autofocus': '',
    oninput: (e) => saveText({ title: e.target.value.trim() || 'Untitled task' }),
  });
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });

  const columnSelect = el('select', {
    class: 'select', 'aria-label': 'Column',
    onchange: (e) => actions.moveTaskToColumn(taskId, e.target.value).catch(errorToast),
  }, board.columns.map((c) => el('option', { value: c.id, selected: c.id === task.columnId, text: c.name })));

  const prioritySelect = el('select', {
    class: 'select', 'aria-label': 'Priority',
    onchange: (e) => save({ priority: e.target.value }),
  }, PRIORITIES.map((p) => el('option', { value: p.id, selected: p.id === (task.priority || 'none'), text: p.name })));

  const assigneeSelect = el('select', {
    class: 'select', 'aria-label': 'Assignee',
    onchange: (e) => save({ assigneeId: e.target.value }),
  }, [
    el('option', { value: '', selected: !task.assigneeId, text: 'Unassigned' }),
    ...(board.memberIds || []).map((id) => el('option', {
      value: id, selected: id === task.assigneeId,
      text: state.profiles[id]?.displayName || (id === state.user.uid ? 'Me' : id.slice(0, 6)),
    })),
  ]);

  const dueInput = el('input', {
    class: 'input', type: 'date', value: task.dueDate || '', 'aria-label': 'Due date',
    onchange: (e) => save({ dueDate: e.target.value }),
  });

  const notesArea = el('textarea', {
    class: 'textarea', placeholder: 'Add notes, links, context…', 'aria-label': 'Notes',
    oninput: (e) => saveText({ notes: e.target.value }),
  });
  notesArea.value = task.notes || '';

  /* ---- labels ---- */
  const labelsWrap = el('div', { class: 'chips' });
  function renderLabels() {
    const selected = new Set(task.labels || []);
    labelsWrap.replaceChildren(
      ...board.labels.map((l) => el('button', {
        class: 'chip', type: 'button', 'aria-pressed': String(selected.has(l.id)),
        onclick: () => {
          const next = selected.has(l.id)
            ? (task.labels || []).filter((id) => id !== l.id)
            : [...(task.labels || []), l.id];
          task = { ...task, labels: next };
          save({ labels: next });
          renderLabels();
        },
      }, [el('span', { class: 'chip__swatch', style: `background:${l.color}` }), l.name])),
      el('button', {
        class: 'chip', type: 'button', text: '+ New label',
        onclick: async () => {
          const label = await promptNewLabel(board);
          if (!label) return;
          const labels = [...board.labels, label];
          await actions.updateBoard({ labels }).catch(errorToast);
          const next = [...(task.labels || []), label.id];
          task = { ...task, labels: next };
          await save({ labels: next });
          renderLabels();
        },
      }),
    );
  }
  renderLabels();

  /* ---- checklist ---- */
  const checklistWrap = el('div', { class: 'checklist' });
  const progress = el('div', { class: 'progress' }, [el('i')]);

  function commitChecklist(items) {
    task = { ...task, checklist: items };
    save({ checklist: items });
    renderChecklist();
  }
  function renderChecklist() {
    const items = task.checklist || [];
    const done = items.filter((i) => i.done).length;
    progress.hidden = !items.length;
    progress.firstChild.style.width = items.length ? `${(done / items.length) * 100}%` : '0%';

    checklistWrap.replaceChildren(
      ...items.map((item, i) => el('div', { class: `check-row ${item.done ? 'is-done' : ''}` }, [
        el('input', {
          type: 'checkbox', checked: item.done, 'aria-label': item.text || 'Checklist item',
          onchange: (e) => commitChecklist(items.map((it, j) => (j === i ? { ...it, done: e.target.checked } : it))),
        }),
        el('input', {
          class: 'check-text', value: item.text, 'aria-label': 'Checklist item text',
          onchange: (e) => commitChecklist(items.map((it, j) => (j === i ? { ...it, text: e.target.value } : it))),
        }),
        el('button', {
          class: 'icon-btn', type: 'button', 'aria-label': 'Remove item', html: icons.trash,
          onclick: () => commitChecklist(items.filter((_, j) => j !== i)),
        }),
      ])),
      el('button', {
        class: 'btn btn--ghost btn--sm', type: 'button', text: '+ Add item',
        onclick: () => {
          commitChecklist([...items, { id: uid('ck_'), text: '', done: false }]);
          checklistWrap.querySelectorAll('.check-text')[items.length]?.focus();
        },
      }),
    );
  }
  renderChecklist();

  /* ---- assemble ---- */
  const doneColumn = board.columns.find((c) => c.isDone);
  const modal = openModal({
    title: null,
    body: [
      el('div', { style: 'display:flex;align-items:flex-start;gap:8px' }, [
        titleInput,
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', html: '&times;', onclick: () => modal.close() }),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'field grow' }, [el('label', { text: 'Column' }), columnSelect]),
        el('div', { class: 'field grow' }, [el('label', { text: 'Priority' }), prioritySelect]),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'field grow' }, [el('label', { text: 'Assignee' }), assigneeSelect]),
        el('div', { class: 'field grow' }, [
          el('label', { text: 'Due date' }),
          el('div', { class: 'row row--tight' }, [
            dueInput,
            el('button', {
              class: 'btn btn--sm', type: 'button', text: 'Today',
              onclick: () => { dueInput.value = todayISO(); save({ dueDate: dueInput.value }); },
            }),
          ]),
        ]),
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'Labels' }), labelsWrap]),
      el('div', { class: 'field' }, [el('label', { text: 'Notes' }), notesArea]),
      el('div', { class: 'field' }, [el('label', { text: 'Checklist' }), progress, checklistWrap]),
      el('p', { class: 'meta-note' }, [
        `Created ${formatWhen(task.createdAt)}`,
        task.updatedAt && task.updatedAt !== task.createdAt ? ` · updated ${formatWhen(task.updatedAt)}` : '',
        state.profiles[task.createdBy] ? ` · by ${state.profiles[task.createdBy].displayName}` : '',
      ]),
    ],
    footer: [
      doneColumn ? el('button', {
        class: 'btn', type: 'button',
        text: task.columnId === doneColumn.id ? 'Reopen' : 'Mark done',
        onclick: () => {
          const target = task.columnId === doneColumn.id
            ? (board.columns.find((c) => !c.isDone)?.id || doneColumn.id)
            : doneColumn.id;
          actions.moveTaskToColumn(taskId, target).catch(errorToast);
          modal.close();
        },
      }) : null,
      el('span', { class: 'grow' }),
      el('button', {
        class: 'btn btn--danger', type: 'button', text: 'Delete',
        onclick: async () => {
          if (!(await confirmModal({ title: 'Delete task?', message: `“${task.title}” will be gone for good.` }))) return;
          await actions.deleteTask(taskId, { skipConfirm: true }).catch(errorToast);
          modal.close();
        },
      }),
      el('button', { class: 'btn btn--primary', type: 'button', text: 'Done', onclick: () => modal.close() }),
    ],
    onClose: () => {
      // Flush anything the debounce is still holding.
      const patch = {};
      const title = titleInput.value.trim() || 'Untitled task';
      if (title !== task.title) patch.title = title;
      if (notesArea.value !== (task.notes || '')) patch.notes = notesArea.value;
      if (Object.keys(patch).length) save(patch);
      ctx.onTaskModalClosed?.();
    },
  });

  modal.refresh = (nextTask) => {
    task = nextTask;
    if (document.activeElement !== titleInput) titleInput.value = task.title;
    if (document.activeElement !== notesArea) notesArea.value = task.notes || '';
    columnSelect.value = task.columnId;
    prioritySelect.value = task.priority || 'none';
    assigneeSelect.value = task.assigneeId || '';
    if (document.activeElement !== dueInput) dueInput.value = task.dueDate || '';
    renderLabels();
    renderChecklist();
  };
  return modal;
}

async function promptNewLabel(board) {
  const { promptModal } = await import('./modal.js');
  const name = await promptModal({ title: 'New label', label: 'Label name', confirmLabel: 'Create' });
  if (!name) return null;
  const palette = Object.values(LABEL_COLORS);
  const used = new Set(board.labels.map((l) => l.color));
  const color = palette.find((c) => !used.has(c)) || palette[board.labels.length % palette.length];
  return { id: uid('lb_'), name, color };
}
