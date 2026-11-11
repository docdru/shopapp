import PocketBase from 'pocketbase';
import type { TypedPocketBase } from './types';

// The app is always served from the same origin as PocketBase
// (in dev via the Vite proxy, in production PocketBase serves the app).
export const pb = new PocketBase('/') as TypedPocketBase;

// The SDK keeps the session in localStorage, so it survives app restarts.
// Don't let the SDK cancel parallel requests to the same endpoint.
pb.autoCancellation(false);

// A 401 means the session is no longer valid, e.g. the password was changed
// on another device. Sign out, so the app shows the login page instead of
// failing on every action.
pb.afterSend = (response, data) => {
  if (response.status === 401 && pb.authStore.isValid) pb.authStore.clear();
  return data;
};
