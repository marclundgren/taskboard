/**
 * Taskboard configuration.
 *
 * Leave `firebase` empty to run in LOCAL mode: everything is stored in this
 * browser's localStorage. Great for trying it out, but boards cannot be shared.
 *
 * Fill in `firebase` to run in CLOUD mode: real sign-in (Google / GitHub),
 * realtime sync across devices, and boards you can share with other people.
 * See README.md ("Cloud mode setup") for the 5-minute walkthrough.
 *
 * These values are NOT secrets — Firebase web config is designed to be public.
 * Access is enforced by the rules in firestore.rules.
 */
export const config = {
  appName: 'Taskboard',

  firebase: {
    apiKey: 'AIzaSyDxDat66PNOxFzq9p6Hr0K6KpamyldTWSo',
    authDomain: 'taskboard-19542.firebaseapp.com',
    projectId: 'taskboard-19542',
    appId: '1:858336270094:web:3fed9d50262025e093e95f',
  },

  /**
   * Google sign-in for LOCAL mode. Create an OAuth client id at
   * https://console.cloud.google.com/apis/credentials (type: Web application)
   * and list your site under "Authorized JavaScript origins", e.g.
   * https://you.github.io and http://localhost:8000
   *
   * Leave blank and local mode falls back to a single "continue on this
   * device" profile. In CLOUD mode this is ignored — Firebase handles it.
   */
  google: {
    clientId: '',
  },

  /** Sign-in buttons to show in cloud mode: 'google' and/or 'github'. */
  authProviders: ['google'],

  /** Columns every new board starts with. */
  defaultColumns: [
    { name: 'Backlog',     wipLimit: 0 },
    { name: 'To do',       wipLimit: 0 },
    { name: 'In progress', wipLimit: 3 },
    { name: 'Blocked',     wipLimit: 0 },
    { name: 'Done',        wipLimit: 0, isDone: true },
  ],
};
