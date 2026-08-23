/* Inline 20x20 icons (stroke uses currentColor). */
const svg = (body, box = 20) => `<svg viewBox="0 0 ${box} ${box}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  plus:      svg('<path d="M10 4v12M4 10h12"/>'),
  dots:      svg('<circle cx="5" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.3" fill="currentColor" stroke="none"/>'),
  calendar:  svg('<rect x="3.5" y="4.5" width="13" height="12" rx="2"/><path d="M3.5 8.5h13M7 3v3M13 3v3"/>'),
  check:     svg('<path d="M4 10.5 8 14.5l8-9"/>'),
  checklist: svg('<path d="M3.5 6l1.6 1.6L8 4.8M3.5 13l1.6 1.6L8 11.8M11 6.5h5.5M11 13.5h5.5"/>'),
  notes:     svg('<path d="M4.5 5.5h11M4.5 9.5h11M4.5 13.5h6"/>'),
  trash:     svg('<path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.2a1.3 1.3 0 0 0 1.3 1.3h4a1.3 1.3 0 0 0 1.3-1.3L14 6"/>'),
  pencil:    svg('<path d="M13.2 3.9 16 6.7 7.7 15H5v-2.7z"/>'),
  arrowLeft: svg('<path d="M12 5l-5 5 5 5"/>'),
  arrowRight:svg('<path d="M8 5l5 5-5 5"/>'),
  people:    svg('<circle cx="8" cy="7.5" r="2.6"/><path d="M3.5 16c.6-2.5 2.4-3.9 4.5-3.9s3.9 1.4 4.5 3.9"/><path d="M13.5 5.4a2.6 2.6 0 0 1 0 5M15 12.4c1.4.5 2.4 1.8 2.8 3.6"/>'),
  lock:      svg('<rect x="4.5" y="8.5" width="11" height="8" rx="2"/><path d="M7.2 8.5V6.8a2.8 2.8 0 0 1 5.6 0v1.7"/>'),
  flag:      svg('<path d="M5 17V4h9l-1.8 3L14 10H5"/>'),
  tag:       svg('<path d="M4 4h5.2l6.8 6.8-5.2 5.2L4 9.2z"/><circle cx="7.2" cy="7.2" r="1"/>'),
  sun:       svg('<circle cx="10" cy="10" r="3.4"/><path d="M10 2.6v1.8M10 15.6v1.8M17.4 10h-1.8M4.4 10H2.6M15.2 4.8l-1.3 1.3M6.1 13.9l-1.3 1.3M15.2 15.2l-1.3-1.3M6.1 6.1 4.8 4.8"/>'),
  moon:      svg('<path d="M16 11.7A6.6 6.6 0 0 1 8.3 4a6.6 6.6 0 1 0 7.7 7.7z"/>'),
  logout:    svg('<path d="M12 6V4.5a1.5 1.5 0 0 0-1.5-1.5h-5A1.5 1.5 0 0 0 4 4.5v11A1.5 1.5 0 0 0 5.5 17h5A1.5 1.5 0 0 0 12 15.5V14"/><path d="M8.5 10H17m0 0-2.5-2.5M17 10l-2.5 2.5"/>'),
  copy:      svg('<rect x="7" y="7" width="9" height="9" rx="2"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"/>'),
  broom:     svg('<path d="M12.5 3.5 8 8M6 10l4-4 4 4-1 6H7z"/>'),
  keyboard:  svg('<rect x="2.5" y="5.5" width="15" height="9" rx="2"/><path d="M6 8.5h.01M9 8.5h.01M12 8.5h.01M14.5 8.5h.01M6.5 11.5h7"/>'),
};
