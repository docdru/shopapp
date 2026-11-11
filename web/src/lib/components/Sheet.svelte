<script lang="ts">
  import type { Snippet } from 'svelte';

  // A bottom sheet for details and editing (prototype: .scrim + .sheet).
  let {
    title,
    onclose,
    children
  }: { title: string; onclose: () => void; children: Snippet } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="scrim"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
>
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
    <h2 id="sheet-title">{title}</h2>
    {@render children()}
  </div>
</div>
