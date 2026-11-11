<script lang="ts">
  import Sheet from './Sheet.svelte';
  import ItemSheet from './ItemSheet.svelte';
  import ProductList from './ProductList.svelte';
  import ProductSheet from './ProductSheet.svelte';
  import PlaceSheet from './PlaceSheet.svelte';
  import { data } from '#lib/data.svelte.js';
  import { attempt, toast } from '#lib/toast.svelte.js';
  import type { ListEntry, Product } from '#lib/types.js';

  // Details of one list entry: quantity (number + unit), note, and the two
  // ways it leaves the list: Bought or Not needed.
  // storeId: the store the list is filtered to ('' = All).
  let { entry, storeId = '', onclose }: { entry: ListEntry; storeId?: string; onclose: () => void } = $props();
  let productEditing = $state<{ product: Product | null } | null>(null);

  let qty = $state(entry.qty || 1);
  let unit = $state(entry.unit);
  let note = $state(entry.note);
  let converting = $state(false);

  const item = $derived(data.itemById.get(entry.item));
  const avoided = $derived(item ? data.avoidedStores(item.id) : []);
  const preferred = $derived(item ? data.preferredStores(item.id) : []);
  const pinned = $derived(data.entryProduct(entry));
  // Generic entries: what to get (at the selected store, or anywhere).
  const hint = $derived(item && !pinned ? data.hint(item.id, storeId) : '');
  // Photo of what to grab: the specific product, else the recommended one.
  const photoProduct = $derived(pinned ?? (item ? data.recommend(item.id, storeId)?.product : undefined));
  const photo = $derived(data.photoUrl(photoProduct, 'large'));
  // "Which one?": any, or one of the item's products (don't-buy ones only
  // if it's the current choice).
  const choices = $derived(
    item ? data.productsFor(item.id).filter((p) => p.verdict !== 'dont_buy' || p.id === entry.product) : []
  );

  const ownStore = $derived(data.entryStore(entry));
  // "+ New store" in Buy at: the store sheet replaces this one, then comes back.
  let addingStore = $state(false);
  let allStores = $state(false);
  const picker = $derived(data.topStores(ownStore ? [ownStore] : [], allStores));
  async function setStore(storeId: string) {
    await attempt(() => data.setEntryStore(entry, storeId));
  }

  async function choose(productId: string) {
    await attempt(() => data.setEntryProduct(entry, productId));
  }
  const changed = $derived(qty !== entry.qty || unit !== entry.unit || note !== entry.note);

  // Whole numbers step by 1; quantity never goes below 1 (removing an entry
  // is always "Not needed").
  function step(delta: number) {
    qty = Math.max(1, Math.round((qty + delta) * 100) / 100);
  }

  async function saveChanges() {
    if (changed) await data.updateEntry(entry, { qty, unit, note: note.trim() });
  }

  async function done() {
    if (await attempt(saveChanges)) onclose();
  }

  async function bought() {
    if (await attempt(async () => {
      await saveChanges();
      await data.bought(entry, storeId);
    })) onclose();
  }

  async function notNeeded() {
    if (await attempt(() => data.notNeeded(entry))) {
      toast.show(`Removed ${data.entryName(entry)}`);
      onclose();
    }
  }
</script>

{#if productEditing && item}
  <ProductSheet {item} product={productEditing.product} {storeId} onclose={() => (productEditing = null)} />
{:else if addingStore}
  <PlaceSheet kind="store" onclose={() => (addingStore = false)} oncreated={(s) => data.setEntryStore(entry, s.id)} />
{:else if converting}
  <ItemSheet
    name={entry.label}
    saveLabel="Save item"
    onclose={() => (converting = false)}
    onsaved={async (saved) => {
      await data.convertEntry(entry, saved);
      toast.show(`Saved ${saved.name} as an item`);
      onclose();
    }}
  />
{:else}
  <Sheet title={data.entryName(entry)} {onclose}>
    {#if pinned && item}
      <p class="meta">Exactly this product of <b>{item.name}</b>{data.packSize(pinned) ? ` · ${data.packSize(pinned)}` : ''}</p>
    {/if}
    {#if choices.length}
      <section>
        <p class="label">Which one?</p>
        <div class="chips" role="group" aria-label="Which one">
          <button type="button" class="chip" aria-pressed={!entry.product} onclick={() => choose('')}>Any</button>
          {#each choices as p (p.id)}
            <button type="button" class="chip" aria-pressed={entry.product === p.id} onclick={() => choose(p.id)}
              >{p.name}</button
            >
          {/each}
        </div>
      </section>
    {/if}
    {#if hint}
      <p class="hint" data-testid="hint">{hint}</p>
    {/if}
    {#if photo}
      <img class="photo" src={photo} alt={photoProduct?.name ?? ''} data-testid="entry-sheet-photo"
        onerror={() => data.refreshFileToken()} />
    {/if}
    {#if !item}
      <p class="meta"><span class="badge plain">one-off</span> Not saved as an item.</p>
      <section>
          <p class="label">Buy at</p>
          <div class="chips" role="group" aria-label="Buy at">
            <button type="button" class="chip" aria-pressed={!ownStore} onclick={() => setStore('')}>Any</button>
            {#each picker.stores as s (s.id)}
              <button type="button" class="chip" aria-pressed={ownStore === s.id} onclick={() => setStore(s.id)}
                >{s.name}</button
              >
            {/each}
            {#if picker.more || allStores}
              <button type="button" class="chip" onclick={() => (allStores = !allStores)}
                >{allStores ? 'Fewer' : 'More…'}</button
              >
            {/if}
            <button type="button" class="chip add" onclick={() => (addingStore = true)}>+ New store</button>
          </div>
          <p class="meta">
            {ownStore
              ? `Only shown at ${data.storeById.get(ownStore)?.name}.`
              : 'No store: under Other, and at every store.'}
          </p>
        </section>
    {:else if preferred.length || avoided.length}
      <div class="meta">
        {#if preferred.length}<span>Buy at {preferred.join(', ')}</span>{/if}
        {#each avoided as a (a.store)}
          <span class="badge warn">not {a.store}{a.reason ? `: ${a.reason}` : ''}</span>
        {/each}
      </div>
    {/if}

    <section>
      <p class="label">Quantity</p>
      <div class="qty">
        <button type="button" aria-label="Less" onclick={() => step(-1)} disabled={qty <= 1}>−</button>
        <span data-testid="qty">{qty}</span>
        <button type="button" aria-label="More" onclick={() => step(1)}>+</button>
      </div>
      <div class="chips" role="group" aria-label="Unit">
        <button type="button" class="chip" aria-pressed={unit === ''} onclick={() => (unit = '')}>piece</button>
        {#each data.sortedUnits.filter((u) => u.name !== 'piece') as u (u.id)}
          <button type="button" class="chip" aria-pressed={unit === u.id} onclick={() => (unit = u.id)}
            >{u.name}</button
          >
        {/each}
      </div>
    </section>

    <div class="field">
      <label for="entry-note">Note</label>
      <input id="entry-note" bind:value={note} placeholder="e.g. the big one" autocomplete="off" />
    </div>

    {#if item}
      <ProductList {item} {storeId} onedit={(product) => (productEditing = { product })} />
    {:else}
      <button type="button" class="ghost" onclick={() => (converting = true)}>Save as an item for the future</button>
    {/if}

    <div class="actions">
      <button type="button" class="btn danger" onclick={notNeeded}>Not needed</button>
      <span class="spacer"></span>
      {#if changed}
        <button type="button" class="btn" onclick={done}>Save</button>
      {/if}
      <button type="button" class="btn primary" onclick={bought}>Bought</button>
    </div>
  </Sheet>
{/if}

<style>
  .photo {
    align-self: flex-start;
    max-width: 100%;
    max-height: 180px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--bg);
  }
</style>
