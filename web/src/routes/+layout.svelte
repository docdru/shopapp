<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { auth } from '#lib/auth.svelte.js';
  import { data } from '#lib/data.svelte.js';
  import { toast } from '#lib/toast.svelte.js';
  import AccountSheet from '#lib/components/AccountSheet.svelte';

  let { children } = $props();
  let accountOpen = $state(false);

  onMount(() => {
    auth.refresh();
    // Re-check the session whenever the app comes back to the foreground,
    // so a phone signed out elsewhere (password change) notices quickly.
    const onVisible = () => {
      if (document.visibilityState === 'visible') auth.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  // Simple guard: everything except /login needs a signed-in user.
  // Pages only mount once signed in, so their data loads and realtime
  // subscriptions always run with the user's credentials.
  const onLogin = $derived(page.url.pathname === '/login');

  $effect(() => {
    if (!auth.user && !onLogin) goto('/login', { replace: true });
    if (auth.user && onLogin) goto('/', { replace: true });
  });

  $effect(() => {
    if (!auth.user) accountOpen = false;
  });

  // Household data: load after login, drop on logout.
  $effect(() => {
    if (auth.user) data.start();
    else data.stop();
  });

  const tabs = [
    { href: '/', label: 'List', title: 'Shopping list', icon: 'list' },
    { href: '/stock', label: 'Stock', title: 'Stock at home', icon: 'stock' },
    { href: '/items', label: 'Items', title: 'Items', icon: 'items' },
    { href: '/log', label: 'Log', title: 'Log', icon: 'log' }
  ] as const;

  // Pages outside the tab bar (reached from the Account sheet).
  const extraTitles: Record<string, string> = { '/settings': 'Stores & categories' };
  const current = $derived(tabs.find((t) => t.href === page.url.pathname));
  const title = $derived(current?.title ?? extraTitles[page.url.pathname] ?? tabs[0].title);
</script>

<div class="app">
  {#if auth.user}
    <header>
      <h1>{title}</h1>
      <button class="who" onclick={() => (accountOpen = true)} aria-label="Account">
        {auth.user.name || auth.user.email}
      </button>
    </header>
  {/if}

  <main>
    {#if onLogin}
      {@render children()}
    {:else if auth.user}
      {#if data.error}
        <p class="error" role="alert">{data.error}</p>
        <button class="btn" onclick={() => data.start()}>Try again</button>
      {:else if !data.ready}
        <p class="empty">Loading…</p>
      {:else}
        {@render children()}
      {/if}
    {/if}
  </main>

  {#if auth.user}
    <nav aria-label="Sections">
      <div class="in">
        {#each tabs as t (t.href)}
          <a href={t.href} aria-current={t.href === current?.href ? 'page' : undefined}>
            {#if t.icon === 'list'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                ><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18h2" /></svg
              >
            {:else if t.icon === 'stock'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"
                ><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg
              >
            {:else if t.icon === 'items'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"
                ><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.4" /></svg
              >
            {:else}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                ><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg
              >
            {/if}
            <span>{t.label}</span>
          </a>
        {/each}
      </div>
    </nav>
  {/if}

  {#if accountOpen && auth.user}
    <AccountSheet onclose={() => (accountOpen = false)} />
  {/if}

  {#if toast.message}
    <div class="toast" role="status">{toast.message}</div>
  {/if}
</div>

<style>
  .app {
    max-width: 520px;
    margin: 0 auto;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--bg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: calc(14px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 10px
      max(16px, env(safe-area-inset-left));
  }

  .who {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 999px;
    padding: 5px 11px;
    font-size: 0.8rem;
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  main {
    flex: 1;
    padding: 4px max(16px, env(safe-area-inset-right)) 96px max(16px, env(safe-area-inset-left));
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 5;
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }

  nav .in {
    max-width: 520px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
  }

  nav a {
    font-size: 0.82rem;
    color: var(--muted);
    text-decoration: none;
    padding: 10px 0 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  nav svg {
    width: 22px;
    height: 22px;
  }

  nav a[aria-current='page'] {
    color: var(--accent);
    font-weight: 600;
  }

</style>
