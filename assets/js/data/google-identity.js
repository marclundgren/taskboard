/* ------------------------------------------------------------------
   Google Identity Services — the "Continue with Google" button used in
   local mode (cloud mode gets the same identity through Firebase Auth).

   The ID token is decoded here for the name, email and picture. It is NOT
   verified — that needs a server, and local mode has none. Identity in
   local mode is how we keep two people's boards apart on a shared
   computer, not a security boundary: anything in localStorage is readable
   by anyone who can open dev tools on that machine.
   ------------------------------------------------------------------ */

const SRC = 'https://accounts.google.com/gsi/client';
let loader = null;

function loadScript() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => (window.google?.accounts?.id
      ? resolve(window.google)
      : reject(new Error('Google sign-in loaded but did not start.')));
    script.onerror = () => {
      loader = null;
      reject(new Error("Couldn't reach Google's sign-in service. Check your connection, or continue on this device."));
    };
    document.head.append(script);
  });
  return loader;
}

/** Read the claims out of a Google ID token (no signature check — see above). */
export function decodeIdToken(token) {
  const payload = String(token).split('.')[1];
  if (!payload) throw new Error('That sign-in response was not readable.');
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const utf8 = decodeURIComponent(
    json.split('').map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
  );
  return JSON.parse(utf8);
}

export function profileFromIdToken(token) {
  const claims = decodeIdToken(token);
  if (!claims.sub) throw new Error('That sign-in response had no account id.');
  return {
    // Namespaced so a Google account and the device profile can never collide.
    uid: `g_${claims.sub}`,
    displayName: claims.name || claims.given_name || (claims.email || '').split('@')[0] || 'You',
    email: claims.email || '',
    photoURL: claims.picture || '',
  };
}

const buttonTheme = () => {
  const explicit = document.documentElement.dataset.theme;
  const dark = explicit
    ? explicit === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  return dark ? 'filled_black' : 'outline';
};

/**
 * Render Google's own sign-in button into `container`.
 * Resolves once the button is on screen; `onProfile` fires when someone signs in.
 */
export async function renderGoogleButton(container, { clientId, onProfile, onError }) {
  const google = await loadScript();
  google.accounts.id.initialize({
    client_id: clientId,
    auto_select: false,
    cancel_on_tap_outside: true,
    callback: (response) => {
      try { onProfile(profileFromIdToken(response.credential)); }
      catch (err) { onError?.(err); }
    },
  });
  google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: buttonTheme(),
    size: 'large',
    text: 'continue_with',
    shape: 'pill',
    logo_alignment: 'center',
    width: 320,
  });
}

/** Stop Google from silently signing the same account back in next visit. */
export function forgetGoogleSession() {
  try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch { /* never worth failing a sign-out over */ }
}
