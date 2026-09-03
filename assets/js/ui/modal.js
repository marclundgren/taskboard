import { el } from '../util.js';

let openCount = 0;

/**
 * openModal({ title, body, footer, size, onClose }) -> { close, root }
 * `body`/`footer` are nodes (or functions receiving the api).
 */
export function openModal({ title, body, footer, size = '', onClose, labelledBy } = {}) {
  const api = {};
  const bodyNode = el('div', { class: 'modal__body' });
  const footNode = el('div', { class: 'modal__foot' });

  const modal = el('div', {
    class: `modal ${size ? `modal--${size}` : ''}`,
    role: 'dialog', 'aria-modal': 'true',
    ...(labelledBy ? { 'aria-labelledby': labelledBy } : { 'aria-label': title || 'Dialog' }),
  }, [
    title === null ? null : el('div', { class: 'modal__head' }, [
      el('h2', { text: title || '' }),
      el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', html: '&times;', onclick: () => api.close() }),
    ]),
    bodyNode,
    footNode,
  ]);

  const scrim = el('div', {
    class: 'modal-scrim',
    onpointerdown: (e) => { if (e.target === scrim) api.close(); },
  }, [modal]);

  const lastFocus = document.activeElement;
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); api.close(); return; }
    if (e.key !== 'Tab') return;
    const focusables = [...modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter((n) => n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  api.close = () => {
    if (!scrim.isConnected) return;
    scrim.remove();
    document.removeEventListener('keydown', onKey, true);
    if (--openCount === 0) document.body.style.overflow = '';
    onClose?.();
    lastFocus?.focus?.();
  };
  api.setBody = (node) => { bodyNode.replaceChildren(...[].concat(node).filter(Boolean)); };
  api.setFooter = (node) => {
    const nodes = [].concat(node).filter(Boolean);
    footNode.replaceChildren(...nodes);
    footNode.hidden = !nodes.length;
  };
  api.root = modal;

  api.setBody(typeof body === 'function' ? body(api) : body);
  api.setFooter(typeof footer === 'function' ? footer(api) : footer);

  document.getElementById('modal-root').append(scrim);
  document.addEventListener('keydown', onKey, true);
  if (openCount++ === 0) document.body.style.overflow = 'hidden';

  (modal.querySelector('[data-autofocus]') || modal.querySelector('input, textarea, button'))?.focus();
  return api;
}

export function confirmModal({ title, message, confirmLabel = 'Delete', danger = true }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = openModal({
      title,
      size: 'sm',
      body: el('p', { text: message, style: 'margin:0;color:var(--text-2)' }),
      footer: [
        el('span', { class: 'grow' }),
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => m.close() }),
        el('button', {
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', text: confirmLabel,
          'data-autofocus': '', onclick: () => { done(true); m.close(); },
        }),
      ],
      onClose: () => done(false),
    });
  });
}

/** Single-field prompt dialog. Resolves to the trimmed string, or null. */
export function promptModal({ title, label, value = '', placeholder = '', confirmLabel = 'Save', type = 'text', hint }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const input = el('input', { class: 'input', type, value, placeholder, 'data-autofocus': '' });
    const submit = () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      done(v); m.close();
    };
    const m = openModal({
      title, size: 'sm',
      body: [
        el('div', { class: 'field' }, [label ? el('label', { text: label }) : null, input]),
        hint ? el('p', { class: 'meta-note', text: hint, style: 'margin:0' }) : null,
      ],
      footer: [
        el('span', { class: 'grow' }),
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => m.close() }),
        el('button', { class: 'btn btn--primary', type: 'button', text: confirmLabel, onclick: submit }),
      ],
      onClose: () => done(null),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    input.select();
  });
}

/** WIP limit dialog: a number input plus an "Unlimited" toggle. Resolves to the limit (0 = unlimited), or null if cancelled. */
export function wipLimitModal({ value = 0, hint } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const unlimited = !value;
    const input = el('input', {
      class: 'input', type: 'number', min: '1', value: value || '', placeholder: 'e.g. 3',
      disabled: unlimited, 'data-autofocus': unlimited ? false : '',
    });
    const checkbox = el('input', {
      type: 'checkbox', checked: unlimited, 'data-autofocus': unlimited ? '' : false,
    });
    checkbox.addEventListener('change', () => {
      input.disabled = checkbox.checked;
      if (!checkbox.checked) { input.focus(); input.select(); }
    });
    const submit = () => {
      if (checkbox.checked) { done(0); m.close(); return; }
      const n = Math.max(0, Number(input.value) || 0);
      if (!n) { input.focus(); return; }
      done(n); m.close();
    };
    const m = openModal({
      title: 'WIP limit', size: 'sm',
      body: [
        el('div', { class: 'field' }, [el('label', { text: 'Maximum tasks in this column' }), input]),
        el('label', { class: 'row', style: 'align-items:center;gap:8px;cursor:pointer' }, [
          checkbox, el('span', { text: 'Unlimited (no WIP limit)' }),
        ]),
        hint ? el('p', { class: 'meta-note', text: hint, style: 'margin:0' }) : null,
      ],
      footer: [
        el('span', { class: 'grow' }),
        el('button', { class: 'btn', type: 'button', text: 'Cancel', onclick: () => m.close() }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'Save', onclick: submit }),
      ],
      onClose: () => done(null),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    if (!unlimited) input.select();
  });
}
