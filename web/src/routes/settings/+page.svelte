<script lang="ts">
  import { data } from '#lib/data.svelte.js';
  import { attempt } from '#lib/toast.svelte.js';
  import PlaceSheet from '#lib/components/PlaceSheet.svelte';
  import type { Category, Store } from '#lib/types.js';

  // Stores and categories: add, rename, reorder, delete. Store order is the
  // order everywhere stores are listed; category order is the group order on
  // the list (match it to your route through the shop).
  type Editing =
    | { kind: 'store'; record: Store | null }
    | { kind: 'category'; record: Category | null }
    | null;
  let editing = $state<Editing>(null);
  let busy = $state(false);

  // Look the record up live, so the sheet closes if someone else deletes it.
  const live = $derived.by(() => {
    if (!editing?.record) return editing;
    const rec =
      editing.kind === 'store'
        ? data.storeById.get(editing.record.id)
        : data.categoryById.get(editing.record.id);
    return rec ? editing : null;
  });

  async function move(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    await attempt(fn);
    busy = false;
  }
</script>

<p class="meta"><a href="/">← Back to the list</a></p>

<section class="group" data-testid="stores">
  <h3>Stores</h3>
  {#each data.sortedStores as s, i (s.id)}
    <div class="row" data-testid="store-{s.name}">
      <button class="rowmain" onclick={() => (editing = { kind: 'store', record: s })}>
        <div class="name">{s.name}</div>
        <div class="meta">
          {#if s.type}<span>{s.type}</span>{/if}
          {#if data.rulesAtStore(s.id)}
            {@const n = data.rulesAtStore(s.id)}
            <span>{n} item rule{n === 1 ? '' : 's'}</span>
          {/if}
        </div>
      </button>
      <div class="seg" role="group" aria-label="Move {s.name}">
        <button aria-label="Move {s.name} up" disabled={i === 0 || busy} onclick={() => move(() => data.moveStore(s, -1))}
          >↑</button
        >
        <button
          aria-label="Move {s.name} down"
          disabled={i === data.sortedStores.length - 1 || busy}
          onclick={() => move(() => data.moveStore(s, 1))}>↓</button
        >
      </div>
    </div>
  {:else}
    <p class="empty">No stores yet.</p>
  {/each}
  <div class="row">
    <button class="btn ghost" onclick={() => (editing = { kind: 'store', record: null })}>+ Add store</button>
  </div>
</section>

<section class="group" data-testid="categories">
  <h3>Categories</h3>
  {#each data.sortedCategories as c, i (c.id)}
    <div class="row" data-testid="category-{c.name}">
      <button class="rowmain" onclick={() => (editing = { kind: 'category', record: c })}>
        <div class="name">{c.name}</div>
        <div class="meta">
          {#if data.itemsInCategory(c.id)}
            {@const n = data.itemsInCategory(c.id)}
            <span>{n} item{n === 1 ? '' : 's'}</span>
          {/if}
        </div>
      </button>
      <div class="seg" role="group" aria-label="Move {c.name}">
        <button aria-label="Move {c.name} up" disabled={i === 0 || busy} onclick={() => move(() => data.moveCategory(c, -1))}
          >↑</button
        >
        <button
          aria-label="Move {c.name} down"
          disabled={i === data.sortedCategories.length - 1 || busy}
          onclick={() => move(() => data.moveCategory(c, 1))}>↓</button
        >
      </div>
    </div>
  {:else}
    <p class="empty">No categories yet.</p>
  {/each}
  <div class="row">
    <button class="btn ghost" onclick={() => (editing = { kind: 'category', record: null })}>+ Add category</button>
  </div>
</section>

<p class="foot">Category order is the order of the groups on your shopping list. Items without a category show under “Other”.</p>

{#if live?.kind === 'store'}
  <PlaceSheet kind="store" record={live.record} onclose={() => (editing = null)} />
{:else if live?.kind === 'category'}
  <PlaceSheet kind="category" record={live.record} onclose={() => (editing = null)} />
{/if}

<style>
  .seg button {
    min-width: 40px;
    font-size: 1rem;
  }
</style>
