<script lang="ts">
  import { auth } from '#lib/auth.svelte.js';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

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
            : 'Login failed. Check email and password.';
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <h1>ShopApp</h1>
  <form onsubmit={submit}>
    <label>
      Email
      <input type="email" autocomplete="username" bind:value={email} required />
    </label>
    <label>
      Password
      <input type="password" autocomplete="current-password" bind:value={password} required />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form>
</section>

<style>
  section {
    padding-top: 15vh;
  }

  h1 {
    font-size: 1.8rem;
    margin: 0 0 24px;
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
</style>
