/* Picks the storage backend from config.js and exposes one interface. */
import { config } from '../../../config.js';
import { createLocalProvider } from './local.js';
import { createFirebaseProvider } from './firebase.js';

export function isCloudConfigured() {
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
