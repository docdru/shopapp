<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { auth } from '#lib/auth.svelte.js';
  import { data } from '#lib/data.svelte.js';
  import { goto } from '$app/navigation';
  import { toast } from '#lib/toast.svelte.js';

  // The signed-in user's account: change password, log out.
  let { onclose }: { onclose: () => void } = $props();

  const MIN = 10;

  let current = $state('');
  let next = $state('');
  let repeat = $state('');
  let error = $state('');
  let busy = $state(false);

  async function change(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    if (next.length < MIN) {
      error = `The new password needs at least ${MIN} characters.`;
      return;
    }
    if (next !== repeat) {
      error = "The new passwords don't match.";
      return;
    }
    if (next === current) {
      error = 'The new password is the same as the current one.';
      return;
    }
    busy = true;
    try {
      await auth.changePassword(current, next);
      await data.restart();
      toast.show('Password changed. Your other devices are signed out.', 4000);
      onclose();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<Sheet title="Account" {onclose}>
  <p class="meta">
    Signed in as <b>{auth.user?.name || auth.user?.email}</b>
    {#if auth.user?.name}<span>({auth.user.email})</span>{/if}
  </p>

  <button
    type="button"
    class="btn"
    onclick={() => {
      onclose();
      goto('/settings');
    }}>Stores & categories</button
  >

  <form onsubmit={change}>
    <p class="label">Change password</p>
    <!-- lets password managers link the new password to the account -->
    <input type="email" autocomplete="username" value={auth.user?.email ?? ''} hidden readonly />
    <div class="field">
      <label for="pw-current">Current password</label>
      <input id="pw-current" type="password" autocomplete="current-password" bind:value={current} required />
    </div>
    <div class="field">
      <label for="pw-new">New password</label>
      <input id="pw-new" type="password" autocomplete="new-password" bind:value={next} required />
    </div>
    <div class="field">
      <label for="pw-repeat">Repeat new password</label>
      <input id="pw-repeat" type="password" autocomplete="new-password" bind:value={repeat} required />
    </div>
    <p class="meta">At least {MIN} characters. Changing it signs you out on your other devices.</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="submit" class="btn primary" disabled={busy}>
        {busy ? 'Changing…' : 'Change password'}
      </button>
    </div>
  </form>

  <div class="logout">
    <button type="button" class="btn danger" onclick={() => auth.logout()}>Log out</button>
  </div>
</Sheet>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-top: 1px solid var(--line);
    padding-top: 14px;
  }

  .logout {
    border-top: 1px solid var(--line);
    padding-top: 14px;
  }
</style>
