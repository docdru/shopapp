<script lang="ts">
  import { data } from '#lib/data.svelte.js';
  import { attempt, toast } from '#lib/toast.svelte.js';
  import EntrySheet from '#lib/components/EntrySheet.svelte';
  import ItemSheet from '#lib/components/ItemSheet.svelte';
  import type { ItemType, ListEntry, Product } from '#lib/types.js';

  let text = $state('');
  let focused = $state(false);
  let openEntryId = $state<string | null>(null);
  let newItemName = $state<string | null>(null);

  const query = $derived(text.trim());
  const matches = $derived(query ? data.search(query) : []);
  const exact = $derived(data.itemByName(query));
  const productMatches = $derived(query ? data.searchProducts(query, matches) : []);
  const exactProduct = $derived(
    productMatches.find((p) => p.name.trim().toLocaleLowerCase() === query.toLocaleLowerCase())
  );
  const showSuggestions = $derived(focused && query.length > 0);
  // Look the entry up live, so the sheet closes if someone else removes it.
  const openEntry = $derived(data.entries.find((e) => e.id === openEntryId));

  // "Shopping at" filter. Remembered per device; '' = All, OTHER = entries
  // without a clear store.
  const STORE_KEY = 'shopapp.store';
  const OLD_STORE_KEY = 'familyshopping.store'; // before the rename to ShopApp
  const OTHER = 'other';
  function loadStore(): string {
    try {
      return localStorage.getItem(STORE_KEY) ?? localStorage.getItem(OLD_STORE_KEY) ?? '';
    } catch {
      return '';
    }
  }
  let storeChoice = $state(loadStore());
  // Falls back to All if the remembered store was deleted.
  const choice = $derived(storeChoice === OTHER || data.storeById.has(storeChoice) ? storeChoice : '');
  const other = $derived(choice === OTHER);
  /** The selected real store ('' for All and Other). */
  const store = $derived(other ? '' : choice);
  const hasClearStore = (e: ListEntry) => data.clearStores(e).size > 0;
  // Chips only for stores with something on the list (and the selected one).
  const chipStores = $derived.by(() => {
    const busy = data.storesWithEntries();
    return data.sortedStores.filter((s) => busy.has(s.id) || s.id === choice);
  });
  const otherCount = $derived(data.open.filter((e) => !hasClearStore(e)).length);
  const storeName = $derived(data.storeById.get(store)?.name ?? '');

  function chooseStore(id: string) {
    storeChoice = id;
    try {
      localStorage.setItem(STORE_KEY, id);
    } catch {
      /* private mode etc.: just not remembered */
    }
  }

  // Suggestions: one tap adds; × hides one until tomorrow (per device).
  const DISMISS_KEY = 'shopapp.dismissed';
  const today = () => new Date().toDateString();
  function loadDismissed(): string[] {
    try {
      const saved = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? 'null');
      return saved?.day === today() && Array.isArray(saved.ids) ? saved.ids : [];
    } catch {
      return [];
    }
  }
  let dismissed = $state(loadDismissed());
  const suggestions = $derived.by(() => {
    const s = data.suggestions(store);
    const keep = (id: string) => !dismissed.includes(id);
    return { usual: s.usual.filter((u) => keep(u.item.id)), low: s.low.filter((i) => keep(i.id)) };
  });

  function dismiss(item: ItemType) {
    dismissed = [...loadDismissed(), item.id];
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify({ day: today(), ids: dismissed }));
    } catch {
      /* not remembered */
    }
  }

  const every = (days: number) => (days === 1 ? 'every day' : `every ${Math.round(days)} days`);

  /**
   * Split open entries for the selected filter (spec: store filter rules).
   * At a store, entries without a clear store go to `maybe` ("Other · no
   * clear store", below the store's own entries).
   */
  const filtered = $derived.by(() => {
    const avoid: { entry: ListEntry; why: string }[] = [];
    if (other) {
      const here = data.open.filter((e) => !hasClearStore(e));
      return { here, maybe: [] as ListEntry[], avoid, elsewhere: data.open.length - here.length };
    }
    if (!store) return { here: data.open, maybe: [] as ListEntry[], avoid, elsewhere: 0 };
    const here: ListEntry[] = [];
    const maybe: ListEntry[] = [];
    let elsewhere = 0;
    for (const e of data.open) {
      const v = data.verdictAt(e, store);
      if (v.k === 'here') (hasClearStore(e) ? here : maybe).push(e);
      else if (v.k === 'avoid') avoid.push({ entry: e, why: v.why ?? '' });
      else elsewhere++;
    }
    maybe.sort((a, b) => data.entryName(a).localeCompare(data.entryName(b)));
    return { here, maybe, avoid, elsewhere };
  });

  /** Entries to buy here, grouped by category, in category order; one-offs last. */
  const groups = $derived.by(() => {
    const map = new Map<string, { name: string; sort: number; entries: ListEntry[] }>();
    for (const e of filtered.here) {
      const cat = data.categoryById.get(data.itemById.get(e.item)?.category ?? '');
      const key = cat?.id ?? '_other';
      if (!map.has(key)) map.set(key, { name: cat?.name ?? 'Other', sort: cat?.sort ?? 999, entries: [] });
      map.get(key)!.entries.push(e);
    }
    return [...map.values()]
      .sort((a, b) => a.sort - b.sort)
      .map((g) => ({
        ...g,
        entries: g.entries.sort((a, b) => data.entryName(a).localeCompare(data.entryName(b)))
      }));
  });

  function reset() {
    text = '';
  }

  async function addKnown(item: ItemType) {
    reset();
    const had = data.openEntryFor(item.id);
    if (await attempt(() => data.addItem(item))) {
      toast.show(had ? `${item.name}: more on the list` : `Added ${item.name}`);
    }
  }

  async function addSpecific(product: Product) {
    reset();
    const had = data.openEntryFor(product.item, product.id);
    if (await attempt(() => data.addProduct(product))) {
      toast.show(had ? `${product.name}: more on the list` : `Added ${product.name}`);
    }
  }

  async function addOnce() {
    const label = query;
    reset();
    if (await attempt(() => data.addOnce(label))) {
      toast.show(`Added “${label}” once, not saved as an item`);
    }
  }

  function onsubmit(event: SubmitEvent) {
    event.preventDefault();
    if (!query) return;
    if (exact) addKnown(exact);
    else if (exactProduct) addSpecific(exactProduct);
    else addOnce();
  }

  function saveAsItem() {
    newItemName = query;
    reset();
  }


</script>

<!-- Suggestions stay open while focus is anywhere inside the form (the field
     or a suggestion button), and close when it leaves. -->
<form
  class="search"
  {onsubmit}
  role="search"
  onfocusin={() => (focused = true)}
  onfocusout={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused = false;
  }}
>
  <input
    placeholder="Add item, e.g. milk"
    aria-label="Add item"
    bind:value={text}
    autocomplete="off"
    enterkeyhint="done"
  />
  {#if showSuggestions}
    <!-- mousedown default would move focus away from the field first (and
         Safari doesn't focus buttons), so keep focus where it is. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="sugg" role="listbox" aria-label="Suggestions" tabindex="-1" onmousedown={(e) => e.preventDefault()}>
      {#each matches as item (item.id)}
        {@const onList = data.openEntryFor(item.id)}
        <button type="button" role="option" aria-selected="false" onclick={() => addKnown(item)}>
          <span>{item.name}</span>
          <small
            >{onList
              ? `on the list · ${data.quantity(onList)}`
              : (data.categoryById.get(item.category)?.name ?? '')}</small
          >
        </button>
      {/each}
      {#each productMatches as p (p.id)}
        {@const onList = data.openEntryFor(p.item, p.id)}
        <button type="button" role="option" aria-selected="false" class="product-option" onclick={() => addSpecific(p)}>
          <span><span class="tag">{data.itemById.get(p.item)?.name}</span>{p.name}</span>
          <small>{onList ? `on the list · ${data.quantity(onList)}` : data.packSize(p)}</small>
        </button>
      {/each}
      {#if !exact && !exactProduct}
        <button type="button" role="option" aria-selected="false" class="new" onclick={addOnce}>
          Add “{query}” just this once
        </button>
        <button type="button" role="option" aria-selected="false" class="new" onclick={saveAsItem}>
          Save “{query}” as an item…
        </button>
      {/if}
    </div>
  {/if}
</form>

{#snippet entryRow(entry: ListEntry, why: string)}
  {@const product = data.entryProduct(entry)}
  <!-- photo: the specific product, or at a store the one to get there -->
  {@const photo = data.photoUrl(
    product ?? (store && !why && entry.item ? data.recommend(entry.item, store)?.product : undefined)
  )}
  <div class="row" class:pinned={!!product} data-testid="entry">
    <button class="rowmain" class:has-thumb={!!photo} onclick={() => (openEntryId = entry.id)}>
      {#if photo}
        <img class="thumb" src={photo} alt="" data-testid="entry-photo" onerror={() => data.refreshFileToken()} />
      {/if}
      <div class="rowtext">
        <div class="name">
          {data.entryName(entry)}
          {#if product && data.packSize(product)}<span class="x">{data.packSize(product)}</span>{/if}
          <span class="x">{data.quantity(entry)}</span>
        </div>
        {#if store && !why && !product}
          <!-- at a store: every preferred product sold here, with price -->
          {#each data.linesAt(entry, store) as line, i (i)}<div class="hint">{line}</div>{/each}
        {/if}
        <div class="meta">
          {#if product}<span class="tag" data-testid="item-tag">{data.itemById.get(entry.item)?.name}</span>{/if}
          {#if why}<span class="badge warn">Not here: {why}</span>{/if}
          {#if !entry.item}<span class="badge plain">one-off</span>{/if}
          {#if entry.from_stock}<span class="badge low">from stock</span>{/if}
          {#if store}
            {#if product}
              {#each data.linesAt(entry, store) as price, i (i)}<span>{price}</span>{/each}
            {/if}
          {:else}
            {#each data.avoidedStores(entry.item) as a (a.store)}<span class="badge warn">not {a.store}</span>{/each}
            {#if data.storesFor(entry).length}
              <span data-testid="stores">
                {#each data.storesFor(entry) as s, i (s.name)}{#if i}{' · '}{/if}<span class:pref={s.preferred}
                    >{s.name}</span
                  >{/each}
              </span>
            {/if}
          {/if}
          {#if entry.note}<span>{entry.note}</span>{/if}
        </div>
      </div>
    </button>
    <button class="buy" onclick={() => attempt(() => data.bought(entry, store))}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"
        ><path d="M5 12.5l4.5 4.5L19 7.5" /></svg
      >
      Bought
    </button>
  </div>
{/snippet}

{#if data.stores.length}
  <div>
    <p class="label">Shopping at</p>
    <div class="chips store-chips" role="group" aria-label="Shopping at">
      <button class="chip" aria-pressed={choice === ''} onclick={() => chooseStore('')}>All</button>
      {#each chipStores as s (s.id)}
        <button class="chip" aria-pressed={choice === s.id} onclick={() => chooseStore(s.id)}>{s.name}</button>
      {/each}
      {#if otherCount || other}
        <button class="chip" aria-pressed={other} onclick={() => chooseStore(OTHER)}>Other</button>
      {/if}
    </div>
  </div>
{/if}

{#if suggestions.usual.length || suggestions.low.length}
  <section data-testid="suggestions" aria-label="Suggestions">
    <p class="label">Suggestions{storeName ? ` for ${storeName}` : ''}</p>
    <div class="strip">
      {#each suggestions.usual as u (u.item.id)}
        <span class="pill" data-testid="suggestion-{u.item.name}">
          <button class="add" onclick={() => addKnown(u.item)}>
            + {u.item.name} <small>· usually {every(u.rhythm.every)}</small>
          </button>
          <button class="dismiss" aria-label="Not today: {u.item.name}" onclick={() => dismiss(u.item)}>×</button>
        </span>
      {/each}
      {#each suggestions.low as item (item.id)}
        <span class="pill low" data-testid="suggestion-{item.name}">
          <button class="add" onclick={() => addKnown(item)}>
            + {item.name} <small>· {item.stock_state} at home</small>
          </button>
          <button class="dismiss" aria-label="Not today: {item.name}" onclick={() => dismiss(item)}>×</button>
        </span>
      {/each}
    </div>
  </section>
{/if}

{#if groups.length === 0 && filtered.maybe.length === 0}
  <p class="empty">
    {#if store}Nothing to buy at {storeName}.{:else if other && data.open.length}Every entry has a store.{:else if data.open.length === 0}The list is empty.{/if}
  </p>
{:else}
  {#each groups as group (group.name)}
    <section class="group">
      <h3>{group.name}</h3>
      {#each group.entries as entry (entry.id)}
        {@render entryRow(entry, '')}
      {/each}
    </section>
  {/each}
{/if}

{#if filtered.maybe.length}
  <section class="group maybe" data-testid="no-clear-store">
    <h3>Other · no clear store</h3>
    {#each filtered.maybe as entry (entry.id)}
      {@render entryRow(entry, '')}
    {/each}
  </section>
{/if}

{#if filtered.avoid.length}
  <section class="group warn" data-testid="better-elsewhere">
    <h3>Better elsewhere</h3>
    {#each filtered.avoid as a (a.entry.id)}
      {@render entryRow(a.entry, a.why)}
    {/each}
  </section>
{/if}

{#if filtered.elsewhere}
  <button class="btn ghost" onclick={() => chooseStore('')}>
    {filtered.elsewhere}
    {filtered.elsewhere === 1 ? 'more item is' : 'more items are'} for other stores. Show all
  </button>
{/if}

{#if data.cart.length > 0}
  <section class="group cart">
    <h3>In the cart · {data.cart.length}</h3>
    {#each data.cart as entry (entry.id)}
      <div class="row" data-testid="cart-entry">
        <div class="rowmain">
          <div class="name">{data.entryName(entry)} <span class="x">{data.quantity(entry)}</span></div>
        </div>
        <button class="undo" onclick={() => attempt(() => data.undoBought(entry))}>Undo</button>
      </div>
    {/each}
    <div class="row">
      <button class="btn ghost" onclick={() => attempt(() => data.clearCart())}>Clear cart</button>
    </div>
  </section>
{/if}

{#if openEntry}
  <EntrySheet entry={openEntry} storeId={store} onclose={() => (openEntryId = null)} />
{/if}

{#if newItemName !== null}
  <ItemSheet
    name={newItemName}
    saveLabel="Save and add to list"
    onclose={() => (newItemName = null)}
    onsaved={async (item) => {
      await data.addItem(item);
      toast.show(`Saved ${item.name} and added it`);
    }}
  />
{/if}

<style>
  .search {
    position: sticky;
    top: calc(58px + env(safe-area-inset-top));
    z-index: 4;
    background: var(--bg);
    padding-bottom: 4px;
  }

  .search input {
    font-size: 1rem;
    padding: 13px 14px;
    border-radius: 12px;
    border: 1.5px solid var(--line);
    background: var(--surface);
  }

  .search input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .sugg {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + 2px);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
    overflow: hidden;
  }

  .sugg button {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    border-bottom: 1px solid var(--line);
    padding: 12px 14px;
  }

  .sugg button:last-child {
    border-bottom: 0;
  }

  .sugg button:hover,
  .sugg button:focus-visible {
    background: var(--accent-soft);
    outline: none;
  }

  .sugg small {
    color: var(--muted);
  }

  .sugg .new {
    color: var(--accent);
    font-weight: 600;
  }

  .strip {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .pill {
    display: inline-flex;
    align-items: stretch;
    border: 1px dashed var(--accent);
    border-radius: 999px;
    color: var(--accent);
    overflow: hidden;
  }

  .pill.low {
    border-color: var(--low);
    color: var(--low);
  }

  .pill button {
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    font-size: 0.88rem;
    min-height: 40px;
  }

  .pill .add {
    padding: 6px 4px 6px 13px;
  }

  .pill .dismiss {
    padding: 6px 12px 6px 8px;
    opacity: 0.7;
  }

  .pill small {
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .store-chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    padding-bottom: 2px;
  }

  .group.maybe h3 {
    color: var(--muted);
  }

  .group.warn h3 {
    color: var(--out);
  }

  /* a specific product: product is the title, the item a small tag */
  .row.pinned {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .tag {
    font-size: 0.72rem;
    font-weight: 600;
    border-radius: 5px;
    padding: 0 6px;
    background: var(--surface);
    color: var(--accent);
    border: 1px solid var(--accent);
    margin-right: 6px;
  }

  .pref {
    color: var(--accent);
    font-weight: 700;
  }

  .cart .name {
    text-decoration: line-through;
    color: var(--muted);
  }
</style>
