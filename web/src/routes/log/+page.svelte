<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { pb } from '#lib/pb.js';
  import { data } from '#lib/data.svelte.js';
  import type { AppEvent } from '#lib/types.js';

  // Newest-first activity: who did what, when. Live while the tab is open.
  let events = $state<AppEvent[]>([]);
  let loading = $state(true);
  let error = $state('');
  let unsubscribe: (() => Promise<void>) | undefined;

  const verbs: Record<AppEvent['type'], string> = {
    added: 'added',
    bought: 'bought',
    not_needed: 'removed (not needed)',
    used_up: 'used up',
    stock_changed: 'set stock of',
    created: 'created',
    edited: 'edited'
  };

  onMount(async () => {
    try {
      const page = await pb.collection('events').getList(1, 100, { sort: '-created' });
      events = page.items;
      unsubscribe = await pb.collection('events').subscribe('*', (e) => {
        if (e.action === 'create') events = [e.record, ...events].slice(0, 200);
      });
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    unsubscribe?.().catch(() => {});
  });

  function when(iso: string): string {
    const d = new Date(iso.replace(' ', 'T'));
    return (
      d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
      ' ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    );
  }

  function who(e: AppEvent): string {
    const u = data.userById.get(e.user);
    return u?.name || u?.email || 'Someone';
  }

  function details(e: AppEvent): string {
    const bits: string[] = [];
    if (e.type === 'stock_changed' || e.type === 'used_up') bits.push(`stock ${e.detail}`);
    else if (e.detail) bits.push(e.detail);
    const product = data.productById.get(e.product);
    if (product) bits.push(product.name);
    if (e.qty && (e.type === 'added' || e.type === 'bought')) bits.push(data.quantity(e));
    const store = data.storeById.get(e.store);
    if (store) bits.push(`at ${store.name}`);
    return bits.join(' · ');
  }
</script>

{#if loading}
  <p class="empty">Loading…</p>
{:else if error}
  <p class="error" role="alert">{error}</p>
{:else}
  <section class="group">
    {#each events as e (e.id)}
      <div class="row" data-testid="event">
        <span class="when">{when(e.created)}</span>
        <div class="rowmain">
          <div>
            <b>{who(e)}</b>
            {verbs[e.type] ?? e.type}
            <b>{e.label || '…'}</b>
            {#if !e.item && e.label && e.type !== 'edited'}<span class="badge plain">one-off</span>{/if}
          </div>
          {#if details(e)}<div class="meta">{details(e)}</div>{/if}
        </div>
      </div>
    {:else}
      <p class="empty">No activity yet.</p>
    {/each}
  </section>
  <p class="foot">Suggestions will use this log. One-off entries are logged but never suggested.</p>
{/if}

<style>
  .when {
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--muted);
    white-space: nowrap;
  }
</style>
