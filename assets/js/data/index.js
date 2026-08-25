/* Picks the storage backend from config.js and exposes one interface. */
import { config } from '../../../config.js';
import { createLocalProvider } from './local.js';
import { createFirebaseProvider } from './firebase.js';

export function isCloudConfigured() {
  // ?mode=local forces the localStorage backend, so testing local mode never
  // means editing config.js — editing it once cost a deploy.
  if (new URLSearchParams(location.search).get('mode') === 'local') return false;
  const f = config.firebase || {};
  return Boolean(f.apiKey && f.projectId && f.appId);
}

export async function createProvider() {
  const provider = isCloudConfigured()
    ? createFirebaseProvider(config)
    : createLocalProvider(config);
  await provider.init();
  return provider;
}

export { config };
