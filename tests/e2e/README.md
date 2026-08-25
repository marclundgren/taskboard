# End-to-end test

Proves the thing that matters and is hardest to eyeball: **a task created in one
browser is stored on the server and shows up in a different browser signed in to
the same account.**

It runs the real app — the same `assets/js` the site serves — against the Firebase
emulators, in two isolated browser profiles.

## What it checks

1. The browser that creates a task shows it
2. The sidebar indicator says "Synced to cloud"
3. The board document actually exists on the server (read back over the REST API, bypassing the client)
4. The task document actually exists on the server
5. A second browser, separate storage, same account, sees the board
6. …and sees the task
7. A task added afterwards appears in the other browser live, without a refresh
8. A write made while offline is flagged as unsaved
9. …and lands on the server once the connection returns
10. Neither browser logged a JavaScript error

## Running it

Needs Node 20+, Java 11+ (for the Firestore emulator) and Playwright's Chromium.

```bash
cd tests/e2e
npm install
npm run setup     # bundles the SDK locally and points a copy of the app at the emulators
npm test
```

`setup.mjs` copies the app to `.tmp/` and changes exactly two things: where the
Firebase SDK is loaded from, and swapping the Google sign-in popup for the
emulator's fake-credential sign-in. Everything below auth — every read, write,
query and security rule — is the code that ships. If the app source moves out
from under those patches, setup fails loudly rather than testing the wrong thing.
