import { auth } from './auth.svelte';

// A single short message at the bottom of the screen ("Added Milk").
class Toast {
  message = $state('');
  #timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string, ms = 2600) {
    this.message = message;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => (this.message = ''), ms);
  }
}

export const toast = new Toast();

/** Run an action; show its error as a toast instead of failing silently. */
export async function attempt(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    toast.show((err as Error).message || 'Something went wrong', 5000);
    // PocketBase treats a revoked session (password changed elsewhere) as a
    // guest, so requests fail with 403/404 rather than 401. Re-check the
    // session; if it's gone, this signs out and shows the login page.
    void auth.refresh();
    return false;
  }
}
