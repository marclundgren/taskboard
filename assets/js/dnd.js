/* ------------------------------------------------------------------
   Pointer-driven drag and drop for cards and columns.

   Works with mouse, pen and touch (touch needs a short press-and-hold so
   the board can still be scrolled with a finger). Keyboard moving lives in
   ui/board.js, which has the data model to hand — WCAG 2.5.7 asks for a
   non-dragging path to every drag action, and both exist here.
   ------------------------------------------------------------------ */
import { clamp } from './util.js';

const MOVE_THRESHOLD = 5;      // px before a mouse press becomes a drag
const TOUCH_HOLD_MS = 200;     // press-and-hold before a touch becomes a drag
const EDGE = 64;               // px from an edge where auto-scroll kicks in
const EDGE_SPEED = 16;         // px per frame at the very edge

export function initDnd(boardEl, handlers = {}) {
  let pending = null;   // candidate drag, waiting on threshold/hold
  let drag = null;      // active drag
  let raf = 0;
  let pointer = { x: 0, y: 0 };

  const isInteractive = (node) => !!node.closest('button, a, input, textarea, select, label, [data-no-drag]');

  /* ---------------- start ---------------- */
  boardEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag || isInteractive(e.target)) return;

    const card = e.target.closest('.card');
    const head = e.target.closest('.column__head');
    if (!card && !head) return;

    pending = {
      type: card ? 'card' : 'column',
      node: card || head.closest('.column'),
      startX: e.clientX, startY: e.clientY,
      pointerId: e.pointerId,
      touch: e.pointerType === 'touch',
      timer: 0,
    };
    if (pending.touch) {
      pending.timer = setTimeout(() => { if (pending) begin(e.clientX, e.clientY); }, TOUCH_HOLD_MS);
    }
  });

  window.addEventListener('pointermove', (e) => {
    pointer = { x: e.clientX, y: e.clientY };

    if (pending && !drag) {
      const far = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
      if (pending.touch) {
        if (far > 10) cancelPending();       // finger is scrolling, not dragging
      } else if (far > MOVE_THRESHOLD) {
        begin(e.clientX, e.clientY);
      }
    }
    if (!drag) return;
    e.preventDefault();
    update(e.clientX, e.clientY);
  }, { passive: false });

  // While a touch drag is live the browser must not claim the gesture for
  // scrolling — a scroll would fire pointercancel and drop the card.
  window.addEventListener('touchmove', (e) => {
    if (drag && e.cancelable) e.preventDefault();
  }, { passive: false });

  window.addEventListener('pointerup', () => { cancelPending(); finish(true); });
  window.addEventListener('pointercancel', () => { cancelPending(); finish(false); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag) { e.preventDefault(); finish(false); }
  });
  // A finger held on a card should drag it, not pop up the OS context menu.
  boardEl.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });

  function cancelPending() {
    if (pending?.timer) clearTimeout(pending.timer);
    pending = null;
  }

  function begin(x, y) {
    const { type, node, pointerId } = pending;
    cancelPending();

    const rect = node.getBoundingClientRect();
    const ghost = node.cloneNode(true);
    ghost.classList.add('card-ghost');
    ghost.style.width = `${rect.width}px`;
    if (type === 'column') {
      ghost.style.maxHeight = `${Math.min(rect.height, window.innerHeight * 0.6)}px`;
      ghost.style.overflow = 'hidden';
    }
    document.body.append(ghost);

    drag = {
      type, node, ghost, pointerId,
      offsetX: x - rect.left, offsetY: y - rect.top,
      width: rect.width, height: rect.height,
      origin: type === 'card'
        ? { columnId: node.closest('.column').dataset.columnId, next: node.nextElementSibling }
        : { index: columns().indexOf(node) },
      placeholder: null,
    };

    if (type === 'card') {
      const ph = document.createElement('div');
      ph.className = 'drop-placeholder';
      ph.style.height = `${rect.height}px`;
      node.after(ph);
      node.style.display = 'none';
      drag.placeholder = ph;
    } else {
      node.classList.add('is-col-dragging');
    }

    boardEl.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    try { boardEl.setPointerCapture(pointerId); } catch { /* capture is best-effort */ }
    moveGhost(x, y);
    raf = requestAnimationFrame(tick);
  }

  const columns = () => [...boardEl.querySelectorAll('.column')];

  function moveGhost(x, y) {
    drag.ghost.style.left = `${x - drag.offsetX}px`;
    drag.ghost.style.top = `${y - drag.offsetY}px`;
  }

  function update(x, y) {
    moveGhost(x, y);
    if (drag.type === 'card') updateCardTarget(x, y);
    else updateColumnTarget(x);
  }

  function nearestColumn(x, y) {
    const cols = columns();
    if (!cols.length) return null;
    let best = null;
    let bestDist = Infinity;
    for (const col of cols) {
      const r = col.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top - 40 && y <= r.bottom + 40) return col;
      const dist = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (dist < bestDist) { bestDist = dist; best = col; }
    }
    return best;
  }

  function updateCardTarget(x, y) {
    const col = nearestColumn(x, y);
    if (!col) return;
    const list = col.querySelector('.column__cards');
    if (!list) return;

    const siblings = [...list.children].filter(
      (n) => n !== drag.placeholder && n !== drag.node && n.classList.contains('card')
    );
    const after = siblings.find((n) => {
      const r = n.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });

    list.querySelector('.column-empty')?.remove();
    if (after) list.insertBefore(drag.placeholder, after);
    else list.append(drag.placeholder);
  }

  function updateColumnTarget(x) {
    const cols = columns().filter((c) => c !== drag.node);
    const after = cols.find((c) => {
      const r = c.getBoundingClientRect();
      return x < r.left + r.width / 2;
    });
    if (after) boardEl.insertBefore(drag.node, after);
    else {
      const addBtn = boardEl.querySelector('.add-column');
      if (addBtn) boardEl.insertBefore(drag.node, addBtn);
      else boardEl.append(drag.node);
    }
  }

  /** Auto-scroll while the pointer sits near an edge. */
  function tick() {
    if (!drag) return;
    const { x, y } = pointer;

    const bRect = boardEl.getBoundingClientRect();
    if (x < bRect.left + EDGE) boardEl.scrollLeft -= speed(bRect.left + EDGE - x);
    else if (x > bRect.right - EDGE) boardEl.scrollLeft += speed(x - (bRect.right - EDGE));

    if (drag.type === 'card') {
      const list = drag.placeholder?.parentElement;
      if (list) {
        const r = list.getBoundingClientRect();
        if (y < r.top + EDGE) list.scrollTop -= speed(r.top + EDGE - y);
        else if (y > r.bottom - EDGE) list.scrollTop += speed(y - (r.bottom - EDGE));
      }
      updateCardTarget(x, y);
    }
    raf = requestAnimationFrame(tick);
  }

  const speed = (over) => clamp(over / EDGE, 0, 1) * EDGE_SPEED;

  function finish(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    cancelAnimationFrame(raf);
    try { boardEl.releasePointerCapture(d.pointerId); } catch { /* already released */ }

    d.ghost.remove();
    boardEl.classList.remove('is-dragging');
    document.body.style.userSelect = '';

    if (d.type === 'card') {
      const list = d.placeholder.parentElement;
      const toColumnId = list?.closest('.column')?.dataset.columnId;
      const prev = d.placeholder.previousElementSibling;
      const next = d.placeholder.nextElementSibling;
      d.placeholder.remove();
      d.node.style.display = '';

      const unchanged = toColumnId === d.origin.columnId && next === d.origin.next;
      if (commit && toColumnId && !unchanged) {
        handlers.onCardDrop?.({
          taskId: d.node.dataset.taskId,
          fromColumnId: d.origin.columnId,
          toColumnId,
          prevTaskId: prev?.dataset.taskId || null,
          nextTaskId: next?.dataset.taskId || null,
        });
        return;
      }
      handlers.onCancel?.();
      return;
    }

    d.node.classList.remove('is-col-dragging');
    const index = columns().indexOf(d.node);
    if (commit && index !== d.origin.index && index >= 0) {
      handlers.onColumnDrop?.({ columnId: d.node.dataset.columnId, toIndex: index });
    } else {
      handlers.onCancel?.();
    }
  }

  return {
    get isDragging() { return !!drag; },
    cancel: () => finish(false),
  };
}
