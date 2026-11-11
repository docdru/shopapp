import { pb } from './pb';
import type { User } from './types';

// Reactive view of the PocketBase auth store.
class Auth {
  user = $state<User | null>(pb.authStore.isValid ? (pb.authStore.record as User) : null);

  constructor() {
    pb.authStore.onChange(() => {
      this.user = pb.authStore.isValid ? (pb.authStore.record as User) : null;
    });
  }

  async login(email: string, password: string) {
    await pb.collection('users').authWithPassword(email, password);
  }

  logout() {
    pb.authStore.clear();
  }

  /**
   * Change the signed-in user's password. PocketBase checks the current one
   * and then invalidates every existing session (other phones are signed out),
   * so this device signs in again right away with the new password.
   * Throws an Error with a user-facing message.
   */
  async changePassword(current: string, next: string) {
    const user = this.user;
    if (!user) throw new Error('Not signed in.');
    try {
      await pb.collection('users').update(user.id, {
        oldPassword: current,
        password: next,
        passwordConfirm: next
      });
    } catch (err) {
      const data = (err as { response?: { data?: Record<string, { message?: string }> } }).response?.data;
      if (data?.oldPassword) throw new Error('The current password is wrong.');
      if (data?.password?.message) throw new Error(`New password: ${data.password.message}`);
      throw new Error('Changing the password failed. Please try again.');
    }
    await pb.collection('users').authWithPassword(user.email, next);
  }

  /** Refresh the token on app start; logs out if the account is gone. */
  async refresh() {
    if (!pb.authStore.isValid) return;
    try {
      await pb.collection('users').authRefresh();
    } catch (err: unknown) {
      // Offline: keep the cached session. Rejected: log out.
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404) pb.authStore.clear();
    }
  }
}

export const auth = new Auth();
