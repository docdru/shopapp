import { pb } from './pb';
import type { User } from './types';

/** How the server lets users sign in (from the users auth-methods endpoint). */
export interface SignInMethods {
  password: boolean;
  /** The single sign-on provider's button label, or null when it's off. */
  provider: string | null;
}

/** Why a single sign-on came back without a session (login page messages). */
export type SignOnError = 'cancelled' | 'no-account' | 'provider' | 'state' | 'offline';

// The one configured OIDC provider (see pb/pb_hooks/lib/auth-config.js).
const PROVIDER = 'oidc';
// The redirect flow leaves the app, so the state and PKCE verifier have to
// survive until the provider sends the browser back. localStorage, not
// sessionStorage: on Android the installed app may be killed while the user
// is in their authenticator app. The auth token lives there too, so this adds
// nothing an XSS couldn't read already. One pending sign-in, 10 minutes.
const PENDING_KEY = 'signon.pending';
const PENDING_TTL = 10 * 60 * 1000;

interface Pending {
  state: string;
  codeVerifier: string;
  redirectURL: string;
  at: number;
}

export function callbackURL(): string {
  return `${location.origin}/login/callback`;
}

function readPending(): Pending | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    localStorage.removeItem(PENDING_KEY); // single use
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    return p && Date.now() - p.at < PENDING_TTL ? p : null;
  } catch {
    return null;
  }
}

// Reactive view of the PocketBase auth store.
class Auth {
  user = $state<User | null>(pb.authStore.isValid ? (pb.authStore.record as User) : null);
  /** null until loaded (or when the server couldn't be asked). */
  methods = $state<SignInMethods | null>(null);

  /** Ask the server which ways of signing in are switched on. */
  async loadMethods(): Promise<SignInMethods> {
    const list = await pb.collection('users').listAuthMethods();
    const provider = list.oauth2.enabled ? list.oauth2.providers.find((p) => p.name === PROVIDER) : undefined;
    const methods = { password: list.password.enabled, provider: provider ? provider.displayName : null };
    this.methods = methods;
    return methods;
  }

  /**
   * Start single sign-on: leave the app for the provider's page (full-page
   * redirect, works in the installed app). It comes back to /login/callback.
   */
  async startSignOn() {
    // Fresh state and PKCE verifier for every attempt.
    const list = await pb.collection('users').listAuthMethods();
    const provider = list.oauth2.providers.find((p) => p.name === PROVIDER);
    if (!list.oauth2.enabled || !provider) throw new Error('Single sign-on is not switched on.');
    const redirectURL = callbackURL();
    const pending: Pending = {
      state: provider.state,
      codeVerifier: provider.codeVerifier,
      redirectURL,
      at: Date.now()
    };
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    location.assign(provider.authURL + encodeURIComponent(redirectURL));
  }

  /**
   * Finish single sign-on on /login/callback: check the state, then let the
   * server exchange the code. Returns null when signed in, else the reason.
   */
  async finishSignOn(params: URLSearchParams): Promise<SignOnError | null> {
    const pending = readPending();
    const state = params.get('state');
    if (!pending || !state || state !== pending.state) return 'state';
    const error = params.get('error');
    if (error) return error === 'access_denied' ? 'cancelled' : 'provider';
    const code = params.get('code');
    if (!code) return 'provider';
    pb.authStore.clear(); // never link the provider account to some other session
    try {
      await pb.collection('users').authWithOAuth2Code(PROVIDER, code, pending.codeVerifier, pending.redirectURL);
      return null;
    } catch (err) {
      const status = (err as { status?: number }).status;
      // 403: no account with that (verified) email, and sign-up is closed.
      if (status === 403) return 'no-account';
      if (status === 0) return 'offline';
      return 'provider'; // e.g. 400: the token exchange with the provider failed
    }
  }

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
