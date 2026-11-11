<script lang="ts">
  import Sheet from './Sheet.svelte';
  import ProductList from './ProductList.svelte';
  import ProductSheet from './ProductSheet.svelte';
  import PlaceSheet from './PlaceSheet.svelte';
  import { data, type ItemDraft } from '#lib/data.svelte.js';
  import { attempt, toast } from '#lib/toast.svelte.js';
  import type { ItemType, Product } from '#lib/types.js';

  // Create or edit an item type: name, category, default quantity, stock
  // tracking and where (not) to buy it. Mirrors the prototype's item sheet.
  let {
    item = null,
    name = '',
    saveLabel = '',
    onclose,
    onsaved
  }: {
    item?: ItemType | null;
    /** prefilled name for a new item */
    name?: string;
    saveLabel?: string;
    onclose: () => void;
    onsaved?: (item: ItemType) => void | Promise<void>;
  } = $props();

  const isNew = !item;
  let draft = $state<ItemDraft>(item ? data.draftFor(item) : data.newDraft(name));
  let busy = $state(false);
  // Product being added (null) or edited, shown in place of this sheet.
  let productEditing = $state<{ product: Product | null } | null>(null);
  let nameInput: HTMLInputElement | undefined = $state();
  // "+ New store" under Where to buy: the store sheet replaces this one (the
  // draft stays), and the new store starts as Buy here.
  let addingStore = $state(false);
  let allStores = $state(false);
  const picker = $derived(
    // Stores set or touched in this sheet stay visible.
    data.topStores(Object.keys(draft.rules), allStores)
  );

  $effect(() => {
    nameInput?.focus();
  });

  function setRule(storeId: string, verdict: '' | 'preferred' | 'avoid') {
    draft.rules[storeId] = { verdict, reason: draft.rules[storeId]?.reason ?? '' };
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      nameInput?.focus();
      return;
    }
    const clash = data.itemByName(draft.name);
    if (clash && clash.id !== item?.id) {
      toast.show(`There's already an item called ${clash.name}`, 4000);
      return;
    }
    busy = true;
    const ok = await attempt(async () => {
      const saved = await data.saveItem(draft, item ?? undefined);
      await onsaved?.(saved);
    });
    busy = false;
    if (ok) onclose();
  }

  // Two taps instead of a browser confirm() dialog.
  let confirmDelete = $state(false);

  async function remove() {
    if (!item) return;
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    if (await attempt(() => data.deleteItem(item))) {
      toast.show(`Deleted ${item.name}`);
      onclose();
    }
  }
</script>

{#if productEditing && item}
  <ProductSheet {item} product={productEditing.product} onclose={() => (productEditing = null)} />
{:else if addingStore}
  <PlaceSheet kind="store" onclose={() => (addingStore = false)} oncreated={(s) => setRule(s.id, 'preferred')} />
{:else}
<Sheet title={isNew ? 'New item' : 'Edit item'} {onclose}>
  <form onsubmit={save}>
    <div class="field">
      <label for="item-name">Name</label>
      <input id="item-name" bind:this={nameInput} bind:value={draft.name} autocomplete="off" />
    </div>

    <div class="field">
      <label for="item-aliases">Other names <span class="hint-text">(comma-separated, for search)</span></label>
      <input id="item-aliases" bind:value={draft.aliases} placeholder="e.g. Waschmittel" autocomplete="off" />
    </div>

    <div class="grid2">
      <div class="field">
        <label for="item-category">Category</label>
        <select id="item-category" bind:value={draft.category}>
          {#each data.sortedCategories as c (c.id)}
            <option value={c.id}>{c.name}</option>
          {/each}
          <option value="">Other</option>
        </select>
      </div>
      <div class="field">
        <label for="item-unit">Usually</label>
        <div class="inline">
          <input
            id="item-qty"
            type="number"
            min="0.1"
            step="any"
            inputmode="decimal"
            aria-label="Default quantity"
            bind:value={draft.default_qty}
          />
          <select id="item-unit" aria-label="Default unit" bind:value={draft.default_unit}>
            <option value="">piece</option>
            {#each data.sortedUnits.filter((u) => u.name !== 'piece') as u (u.id)}
              <option value={u.id}>{u.name}</option>
            {/each}
          </select>
        </div>
      </div>
    </div>

    <label class="toggle">
      <input type="checkbox" bind:checked={draft.track_stock} />
      Keep in stock at home
    </label>

    {#if draft.track_stock}
      <div class="rule">
        <span>Put on the list when it's</span>
        <div class="seg" role="group" aria-label="Put on the list when">
          <button
            type="button"
            class="lo"
            aria-pressed={draft.restock_at === 'low'}
            onclick={() => (draft.restock_at = 'low')}>Low</button
          >
          <button
            type="button"
            class="out"
            aria-pressed={draft.restock_at === 'out'}
            onclick={() => (draft.restock_at = 'out')}>Out</button
          >
        </div>
      </div>
    {/if}

    <section>
      <p class="label">Where to buy</p>
      <div class="rules">
        {#each picker.stores as s (s.id)}
          {@const verdict = draft.rules[s.id]?.verdict ?? ''}
          <div class="rule" data-testid="rule-{s.name}">
            <span>{s.name}</span>
            <div class="seg" role="group" aria-label="Rule for {s.name}">
              <button type="button" class="neutral" aria-pressed={verdict === ''} onclick={() => setRule(s.id, '')}
                >–</button
              >
              <button
                type="button"
                class="ok"
                aria-pressed={verdict === 'preferred'}
                onclick={() => setRule(s.id, 'preferred')}>Buy here</button
              >
              <button
                type="button"
                class="out"
                aria-pressed={verdict === 'avoid'}
                onclick={() => setRule(s.id, 'avoid')}>Not here</button
              >
            </div>
            {#if verdict === 'avoid'}
              <input
                class="why"
                placeholder="Why not here?"
                aria-label="Why not at {s.name}"
                bind:value={draft.rules[s.id].reason}
              />
            {/if}
          </div>
        {/each}
      </div>
      {#if picker.more || allStores}
        <button type="button" class="btn ghost more" onclick={() => (allStores = !allStores)}
          >{allStores ? 'Show fewer stores' : `Show ${picker.more} more ${picker.more === 1 ? 'store' : 'stores'}`}</button
        >
      {/if}
      <button type="button" class="chip add" onclick={() => (addingStore = true)}>+ New store</button>
    </section>

    {#if item}
      <ProductList {item} onedit={(product) => (productEditing = { product })} />
    {:else}
      <p class="meta">Specific products (brands, pack sizes, prices) can be added after saving.</p>
    {/if}

    {#if confirmDelete}
      <p class="meta">Deleting also removes it from the list. The log keeps its history.</p>
    {/if}

    <div class="actions">
      {#if !isNew}
        <button type="button" class="btn danger" onclick={remove}>
          {confirmDelete ? 'Tap again to delete' : 'Delete'}
        </button>
        <span class="spacer"></span>
      {/if}
      <button type="button" class="btn" onclick={onclose}>Cancel</button>
      <button type="submit" class="btn primary" disabled={busy}>
        {saveLabel || (isNew ? 'Save item' : 'Save')}
      </button>
    </div>
  </form>
</Sheet>
{/if}

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .inline {
    display: grid;
    grid-template-columns: 70px 1fr;
    gap: 6px;
  }

  .hint-text {
    font-weight: 400;
  }
</style>
