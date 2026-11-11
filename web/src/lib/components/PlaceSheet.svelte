<script lang="ts">
  import Sheet from './Sheet.svelte';
  import { data } from '#lib/data.svelte.js';
  import { attempt, toast } from '#lib/toast.svelte.js';
  import type { Category, Store } from '#lib/types.js';

  // Add, rename or delete a store or a category. `oncreated` gets a newly
  // added store (used by the entry and item sheets to pick it right away).
  type Props =
    | { kind: 'store'; record?: Store | null; onclose: () => void; oncreated?: (store: Store) => void | Promise<void> }
    | { kind: 'category'; record?: Category | null; onclose: () => void; oncreated?: never };
  let { kind, record = null, onclose, oncreated }: Props = $props();

  const isNew = !record;
  const noun = kind === 'store' ? 'store' : 'category';
  let name = $state(record?.name ?? '');
  let type = $state(kind === 'store' ? ((record as Store | null)?.type ?? '') : '');
  let busy = $state(false);
  let confirmDelete = $state(false);
  let nameInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    nameInput?.focus();
  });

  // What a deletion takes with it, for the warning.
  const impact = $derived.by(() => {
    if (!record) return '';
    if (kind === 'store') {
      const n = data.rulesAtStore(record.id);
      const o = data.offersAtStore(record.id);
      const parts = [];
      if (n) parts.push(`its “Buy here / Not here” rules on ${n} item${n === 1 ? '' : 's'}`);
      if (o) parts.push(`${o} product price${o === 1 ? '' : 's'} or “not here” mark${o === 1 ? '' : 's'}`);
      return parts.length ? `${parts.join(' and ')} go with it.`.replace(/^./, (c) => c.toUpperCase()) : 'Nothing uses it yet.';
    }
    const n = data.itemsInCategory(record.id);
    return n ? `Its ${n} item${n === 1 ? '' : 's'} move to “Other”.` : 'No items use it.';
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      nameInput?.focus();
      return;
    }
    const clash = kind === 'store' ? data.storeByName(trimmed) : data.categoryByName(trimmed);
    if (clash && clash.id !== record?.id) {
      toast.show(`There's already a ${noun} called ${clash.name}`, 4000);
      return;
    }
    busy = true;
    const ok = await attempt(async () => {
      if (kind === 'store') {
        if (record) await data.updateStore(record as Store, { name: trimmed, type });
        else {
          // Not `oncreated?.(await …)`: an optional call skips its arguments.
          const added = await data.addStore(trimmed, type);
          await oncreated?.(added);
        }
      } else {
        if (record) await data.renameCategory(record as Category, trimmed);
        else await data.addCategory(trimmed);
      }
    });
    busy = false;
    if (ok) onclose();
  }

  async function remove() {
    if (!record) return;
    if (!confirmDelete) {
      confirmDelete = true;
      return;
    }
    const ok = await attempt(() =>
      kind === 'store' ? data.deleteStore(record as Store) : data.deleteCategory(record as Category)
    );
    if (ok) {
      toast.show(`Deleted ${record.name}`);
      onclose();
    }
  }
</script>

<Sheet title={isNew ? `New ${noun}` : `Edit ${noun}`} {onclose}>
  <form onsubmit={save}>
    <div class="field">
      <label for="place-name">Name</label>
      <input id="place-name" bind:this={nameInput} bind:value={name} autocomplete="off" />
    </div>
    {#if kind === 'store'}
      <div class="field">
        <label for="place-type">Type <span class="optional">(optional)</span></label>
        <input id="place-type" bind:value={type} placeholder="e.g. supermarket, drugstore, market" autocomplete="off" />
      </div>
    {/if}

    {#if confirmDelete}
      <p class="meta" role="alert">{impact}</p>
    {/if}

    <div class="actions">
      {#if !isNew}
        <button type="button" class="btn danger" onclick={remove}>
          {confirmDelete ? 'Tap again to delete' : 'Delete'}
        </button>
        <span class="spacer"></span>
      {/if}
      <button type="button" class="btn" onclick={onclose}>Cancel</button>
      <button type="submit" class="btn primary" disabled={busy}>{isNew ? `Add ${noun}` : 'Save'}</button>
    </div>
  </form>
</Sheet>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .optional {
    font-weight: 400;
  }
</style>
