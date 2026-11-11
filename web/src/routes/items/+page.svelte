<script lang="ts">
  import { data } from '#lib/data.svelte.js';
  import ItemSheet from '#lib/components/ItemSheet.svelte';
  import type { ItemType } from '#lib/types.js';

  // All saved item types (never one-offs), grouped by category.
  let editing = $state<ItemType | null>(null);
  let creating = $state(false);
  let filter = $state('');

  const shown = $derived(filter.trim() ? data.search(filter, 1000) : data.items);
  const groups = $derived(data.groupByCategory(shown));
  // Look the item up live, so the sheet closes if someone else deletes it.
  const editingLive = $derived(editing ? data.itemById.get(editing.id) : undefined);
</script>

<div class="top">
  <button class="btn primary" onclick={() => (creating = true)}>+ New item</button>
  <input type="search" placeholder="Filter" aria-label="Filter items" bind:value={filter} />
</div>
<p class="meta">Only saved items appear here. One-off entries disappear once bought or removed.</p>

{#if groups.length === 0}
  <p class="empty">{filter ? 'No matching items.' : 'No items yet.'}</p>
{/if}

{#each groups as g (g.id)}
  <section class="group" data-testid="group-{g.name}">
    <h3>{g.name}</h3>
    {#each g.items as item (item.id)}
      {@const pref = data.preferredStores(item.id)}
      <div class="row" data-testid="item-{item.name}">
        <button class="rowmain" onclick={() => (editing = item)}>
          <div class="name">{item.name}</div>
          <div class="meta">
            <span>{pref.length ? `Buy at ${pref.join(', ')}` : 'any store'}</span>
            {#each data.avoidedStores(item.id) as a (a.store)}<span class="badge warn">not {a.store}</span>{/each}
            {#if data.productsFor(item.id).length}
              {@const n = data.productsFor(item.id).length}
              <span class="badge plain">{n} product{n === 1 ? '' : 's'}</span>
            {/if}
            {#if item.track_stock}
              <span class="badge {item.stock_state === 'ok' || !item.stock_state ? '' : 'low'}"
                >stock {item.stock_state || 'ok'}</span
              >
            {/if}
          </div>
        </button>
        <span class="meta">Edit</span>
      </div>
    {/each}
  </section>
{/each}

{#if creating}
  <ItemSheet onclose={() => (creating = false)} />
{/if}

{#if editingLive}
  <ItemSheet item={editingLive} onclose={() => (editing = null)} />
{/if}

<style>
  .top {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
  }

  .top input {
    background: var(--surface);
  }
</style>
