<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { onDestroy } from 'svelte';
  import { data, type ProductDraft } from '#lib/data.svelte.js';
  import { attempt, toast } from '#lib/toast.svelte.js';
  import { shrinkPhoto } from '#lib/photo.js';
  import type { ItemType, Product } from '#lib/types.js';

  // Add or edit a specific product of an item: name and pack size, whether
  // it's preferred / OK / don't buy, and per store: sold here (price
  // optional) or not here. Opened from the item sheet or, while shopping,
  // from a list entry with the current store pre-selected.
  let {
    item,
    product = null,
    storeId = '',
    onclose
  }: { item: ItemType; product?: Product | null; storeId?: string; onclose: () => void } = $props();

  const isNew = !product;
  let draft = $state<ProductDraft>(data.productDraft(product ?? undefined, storeId));
  let busy = $state(false);
  let confirmDelete = $state(false);
  let nameInput: HTMLInputElement | undefined = $state();

  // Photo: the saved one, or a new one picked here (shown from a local
  // object URL until saved). draft.photo: File = upload, null = remove.
  let localPreview = $state('');
  let shrinking = $state(false);
  const preview = $derived(
    draft.photo === null ? '' : localPreview || (product ? data.photoUrl(product, 'large') : '')
  );

  async function pickPhoto(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    shrinking = true;
    const out: { file?: File } = {};
    await attempt(async () => {
      out.file = await shrinkPhoto(file);
    });
    shrinking = false;
    const small = out.file;
    if (!small) return;
    if (localPreview) URL.revokeObjectURL(localPreview);
    localPreview = URL.createObjectURL(small);
    draft.photo = small;
  }

  function removePhoto() {
    if (localPreview) URL.revokeObjectURL(localPreview);
    localPreview = '';
    draft.photo = product?.photo ? null : undefined;
  }

  onDestroy(() => {
    if (localPreview) URL.revokeObjectURL(localPreview);
  });

  $effect(() => {
    if (isNew) nameInput?.focus();
  });

  // The store we're shopping at first, then the others.
  // Most used stores first (the store you're at on top); the rest behind
  // "Show N more".
  let allStores = $state(false);
  const picker = $derived(
    // Stores set or touched in this sheet stay visible.
    data.topStores(Object.keys(draft.offers), allStores, storeId)
  );
  const stores = $derived(picker.stores);

  function setOffer(id: string, state: '' | 'here' | 'not') {
    const cur = draft.offers[id] ?? { state: '', price: '', reason: '' };
    draft.offers[id] = { ...cur, state };
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) {
      nameInput?.focus();
      return;
    }
    const clash = data.productsFor(item.id).find(
      (p) => p.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase() && p.id !== product?.id
    );
    if (clash) {
      toast.show(`${item.name} already has a product called ${clash.name}`, 4000);
      return;
    }
    busy = true;
    const ok = await attempt(() => data.saveProduct(item.id, draft, product ?? undefined));
    busy = false;
    if (ok) {
      toast.show(isNew ? `Added ${name} to ${item.name}` : 'Saved');
      onclose();
    }
  }

  async function remove() {
    if (!product) return;
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    if (await attempt(() => data.deleteProduct(product))) {
      toast.show(`Deleted ${product.name}`);
      onclose();
    }
  }
</script>

<Sheet title={isNew ? 'New product' : 'Edit product'} {onclose}>
  <p class="meta">Counts as <b>{item.name}</b></p>
  <form onsubmit={save}>
    <div class="field">
      <label for="product-name">Brand and name</label>
      <input
        id="product-name"
        bind:this={nameInput}
        bind:value={draft.name}
        placeholder="e.g. Lavazza Crema e Aroma"
        autocomplete="off"
      />
    </div>

    <div class="field">
      <label for="product-qty">Pack size <span class="optional">(for comparing prices)</span></label>
      <div class="inline">
        <input
          id="product-qty"
          type="number"
          min="0"
          step="any"
          inputmode="decimal"
          placeholder="e.g. 1"
          bind:value={draft.pack_qty}
        />
        <select aria-label="Pack unit" bind:value={draft.pack_unit}>
          <option value="">piece</option>
          {#each data.sortedUnits.filter((u) => u.name !== 'piece') as u (u.id)}
            <option value={u.id}>{u.name}</option>
          {/each}
        </select>
      </div>
    </div>

    <section data-testid="photo">
      <p class="label">Photo <span class="optional">(so everyone grabs the right pack)</span></p>
      <div class="photo-row">
        {#if preview}
          <img class="photo" src={preview} alt={draft.name.trim() || item.name} onerror={() => data.refreshFileToken()} />
        {:else}
          <div class="photo none">No photo</div>
        {/if}
        <div class="photo-actions">
          <label class="btn">
            {shrinking ? 'Reading…' : preview ? 'Change photo' : 'Add photo'}
            <input type="file" accept="image/*" aria-label="Product photo" onchange={pickPhoto} hidden />
          </label>
          {#if preview}
            <button type="button" class="btn danger" onclick={removePhoto}>Remove photo</button>
          {/if}
        </div>
      </div>
    </section>

    <section>
      <p class="label">Verdict</p>
      <div class="seg verdict" role="group" aria-label="Verdict">
        <button
          type="button"
          class="ok"
          aria-pressed={draft.verdict === 'preferred'}
          onclick={() => (draft.verdict = 'preferred')}>Preferred</button
        >
        <button type="button" class="neutral" aria-pressed={draft.verdict === 'ok'} onclick={() => (draft.verdict = 'ok')}
          >OK</button
        >
        <button
          type="button"
          class="out"
          aria-pressed={draft.verdict === 'dont_buy'}
          onclick={() => (draft.verdict = 'dont_buy')}>Don't buy</button
        >
      </div>
      {#if draft.verdict === 'dont_buy'}
        <input aria-label="Why not" placeholder="Why not? e.g. tastes stale" bind:value={draft.reason} />
      {/if}
    </section>

    <section>
      <p class="label">Where you get it</p>
      <div class="rules">
        {#each stores as s (s.id)}
          {@const offer = draft.offers[s.id] ?? { state: '', price: '', reason: '' }}
          <div class="rule" data-testid="offer-{s.name}">
            <span>{s.name}{#if s.id === storeId}<span class="badge plain here">you're here</span>{/if}</span>
            <div class="seg" role="group" aria-label="{s.name}">
              <button type="button" class="neutral" aria-pressed={offer.state === ''} onclick={() => setOffer(s.id, '')}
                >–</button
              >
              <button type="button" class="ok" aria-pressed={offer.state === 'here'} onclick={() => setOffer(s.id, 'here')}
                >Sold here</button
              >
              <button type="button" class="out" aria-pressed={offer.state === 'not'} onclick={() => setOffer(s.id, 'not')}
                >Not here</button
              >
            </div>
            {#if offer.state === 'here'}
              <input
                class="why"
                inputmode="decimal"
                placeholder="Price in € (optional)"
                aria-label="Price at {s.name}"
                bind:value={draft.offers[s.id].price}
              />
            {:else if offer.state === 'not'}
              <input
                class="why"
                placeholder="Why not here? e.g. too pricey"
                aria-label="Why not at {s.name}"
                bind:value={draft.offers[s.id].reason}
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
    </section>

    {#if confirmDelete}
      <p class="meta" role="alert">Deletes this product and its prices.</p>
    {/if}

    <div class="actions">
      {#if !isNew}
        <button type="button" class="btn danger" onclick={remove}>
          {confirmDelete ? 'Tap again to delete' : 'Delete'}
        </button>
        <span class="spacer"></span>
      {/if}
      <button type="button" class="btn" onclick={onclose}>Cancel</button>
      <button type="submit" class="btn primary" disabled={busy || shrinking}>{isNew ? 'Add product' : 'Save'}</button>
    </div>
  </form>
</Sheet>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .inline {
    display: grid;
    grid-template-columns: 90px 1fr;
    gap: 6px;
  }

  .optional {
    font-weight: 400;
  }

  .verdict {
    align-self: flex-start;
  }

  .here {
    margin-left: 6px;
  }

  .photo-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .photo {
    width: 96px;
    height: 96px;
    flex: none;
    border-radius: 12px;
    object-fit: cover;
    border: 1px solid var(--line);
    background: var(--bg);
  }

  .photo.none {
    display: grid;
    place-items: center;
    font-size: 0.8rem;
    color: var(--muted);
    border-style: dashed;
  }

  .photo-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }

  .photo-actions label {
    cursor: pointer;
  }
</style>
