<script lang="ts">
  import { data } from '#lib/data.svelte.js';
  import { attempt, toast } from '#lib/toast.svelte.js';
  import type { ItemType, StockState } from '#lib/types.js';

  // Tracked items only, grouped by category, each with OK / Low / Out.
  const groups = $derived(data.groupByCategory(data.items.filter((i) => i.track_stock)));

  const states: { value: StockState; label: string; cls: string }[] = [
    { value: 'ok', label: 'OK', cls: 'ok' },
    { value: 'low', label: 'Low', cls: 'lo' },
    { value: 'out', label: 'Out', cls: 'out' }
  ];

  async function set(item: ItemType, state: StockState) {
    let added = false;
    const ok = await attempt(async () => {
      added = await data.setStock(item, state);
    });
    if (ok && added) toast.show(`${item.name} is ${state}, added to the list`);
  }
</script>

<p class="meta">Things you always want at home. Set to <b>Out</b> when you use the last one and it goes on the list.</p>

{#if groups.length === 0}
  <p class="empty">
    Nothing tracked yet. On the <a href="/items">Items</a> tab, open an item and switch on “Keep in stock at home”.
  </p>
{/if}

{#each groups as g (g.id)}
  <section class="group">
    <h3>{g.name}</h3>
    {#each g.items as item (item.id)}
      {@const pref = data.preferredStores(item.id)}
      <div class="row" data-testid="stock-{item.name}">
        <div class="rowmain">
          <div class="name">{item.name}</div>
          <div class="meta">
            <span>{pref.length ? pref.join(' · ') : 'any store'}</span>
            {#if item.restock_at === 'low'}<span class="badge plain">list at low</span>{/if}
          </div>
        </div>
        <div class="seg" role="group" aria-label="Stock of {item.name}">
          {#each states as s (s.value)}
            <button
              class={s.cls}
              aria-pressed={(item.stock_state || 'ok') === s.value}
              onclick={() => set(item, s.value)}>{s.label}</button
            >
          {/each}
        </div>
      </div>
    {/each}
  </section>
{/each}
