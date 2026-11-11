<script lang="ts">
  import { data, formatPrice } from '#lib/data.svelte.js';
  import type { ItemType, Product } from '#lib/types.js';

  // The products of an item with verdicts and per-store prices; the
  // recommended one is marked. Used in the item and entry sheets.
  let {
    item,
    storeId = '',
    onedit
  }: { item: ItemType; storeId?: string; onedit: (product: Product | null) => void } = $props();

  const products = $derived(data.productsFor(item.id));
  const best = $derived(data.recommend(item.id, storeId));
</script>

<section data-testid="products">
  <p class="label">Products{products.length ? ` (${products.length})` : ''}</p>
  {#if products.length === 0}
    <p class="meta">
      No specific products yet. Add the ones you like (or don't) so everyone knows what to grab.
    </p>
  {/if}
  {#each products as p (p.id)}
    {@const offers = data.offersFor(p.id)}
    <button
      type="button"
      class="prodrow"
      class:best={best?.product.id === p.id}
      data-testid="product-{p.name}"
      onclick={() => onedit(p)}
    >
      {#if data.photoUrl(p)}
        <img class="thumb" src={data.photoUrl(p)} alt="" onerror={() => data.refreshFileToken()} />
      {/if}
      <div class="pmain">
        <div class="name">
          {p.name} <span class="x">{data.packSize(p)}</span>
        </div>
        <div class="meta">
          {#if p.verdict === 'preferred'}<span class="badge">preferred</span>{/if}
          {#if p.verdict === 'dont_buy'}<span class="badge warn">don't buy{p.reason ? `: ${p.reason}` : ''}</span>{/if}
          {#if best?.product.id === p.id}<span class="badge plain">recommended</span>{/if}
          {#each offers as o (o.id)}
            {@const s = data.storeById.get(o.store)}
            <span class:not={o.dont_buy_here} class:hl={o.store === storeId}>
              {s?.name}{o.dont_buy_here ? ' (not here)' : o.price ? ` ${formatPrice(o.price)}` : ''}
            </span>
          {:else}
            <span>no stores yet</span>
          {/each}
        </div>
      </div>
      <span class="edit">Edit</span>
    </button>
  {/each}
  <button type="button" class="btn ghost" onclick={() => onedit(null)}>+ Add product</button>
</section>

<style>
  .prodrow {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 100%;
    text-align: left;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 9px 11px;
  }

  .prodrow.best {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .pmain {
    flex: 1;
    min-width: 0;
  }

  .edit {
    font-size: 0.8rem;
    color: var(--muted);
  }

  .not {
    color: var(--out);
  }

  .hl {
    font-weight: 600;
    color: var(--ink);
  }
</style>
