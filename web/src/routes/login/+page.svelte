<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { auth, type SignOnError } from '#lib/auth.svelte.js';

  // Shows what the server has switched on (spec "Sign-in"): a "Sign in with
  // <provider>" button, the email + password form, or both.

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  let loadFailed = $state(false);

  const methods = $derived(auth.methods);
  const providerName = $derived(methods?.provider ?? 'the provider');

  function signOnMessage(code: SignOnError): string {
    switch (code) {
      case 'cancelled':
        return 'Sign-in was cancelled.';
      case 'no-account':
        return `There is no ShopApp account for your ${providerName} email address. Ask whoever runs ShopApp to create one with the same address.`;
      case 'state':
        return 'That sign-in had expired or didn’t start here. Please try again.';
      case 'offline':
        return 'No connection to the server.';
      default:
        return `Signing in with ${providerName} didn’t work: it couldn’t be reached or refused. Try again in a moment.`;
    }
  }

  async function load() {
    loadFailed = false;
    try {
      await auth.loadMethods();
    } catch {
      loadFailed = true;
    }
  }

  onMount(() => {
    load().then(() => {
      // Coming back from /login/callback with a failed single sign-on.
      const code = page.url.searchParams.get('signon') as SignOnError | null;
      if (code) {
        error = signOnMessage(code);
        history.replaceState(history.state, '', '/login');
      }
    });
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await auth.login(email, password);
    } catch (err) {
      const status = (err as { status?: number }).status;
      error =
        status === 429
          ? 'Too many attempts. Wait a few seconds and try again.'
          : status === 0
            ? 'No connection to the server.'
            : status === 403
              ? 'Password sign-in is switched off. Use the button above.'
              : 'Login failed. Check email and password.';
    } finally {
      busy = false;
    }
  }

  async function signOn() {
    busy = true;
    error = '';
    try {
      await auth.startSignOn(); // leaves the page
    } catch (err) {
      const status = (err as { status?: number }).status;
      error = status === 0 ? 'No connection to the server.' : signOnMessage('provider');
      busy = false;
    }
  }
</script>

<section>
  <h1>ShopApp</h1>
  {#if loadFailed}
    <p class="error" role="alert">No connection to the server.</p>
    <button class="btn" type="button" onclick={load}>Try again</button>
  {:else if !methods}
    <p class="empty">Loading…</p>
  {:else}
    {#if methods.provider}
      <button class="btn primary sso" type="button" onclick={signOn} disabled={busy}>
        Sign in with {methods.provider}
      </button>
    {/if}
    {#if methods.provider && methods.password}
      <p class="or"><span>or with your password</span></p>
    {/if}
    {#if methods.password}
      <form onsubmit={submit}>
        <label>
          Email
          <input type="email" autocomplete="username" bind:value={email} required />
        </label>
        <label>
          Password
          <input type="password" autocomplete="current-password" bind:value={password} required />
        </label>
        <button class="btn" class:primary={!methods.provider} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    {/if}
    {#if !methods.provider && !methods.password}
      <p class="error" role="alert">No way of signing in is switched on. Check the server configuration.</p>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</section>

<style>
  section {
    padding-top: 15vh;
    display: grid;
    gap: 14px;
  }

  h1 {
    font-size: 1.8rem;
    margin: 0 0 10px;
  }

  form {
    display: grid;
    gap: 14px;
  }

  label {
    display: grid;
    gap: 6px;
    color: var(--muted);
    font-size: 0.9rem;
  }

  .sso {
    min-height: 48px;
  }

  .or {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 6px 0 0;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .or::before,
  .or::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--line);
  }
</style>
