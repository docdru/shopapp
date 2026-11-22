<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth } from '#lib/auth.svelte.js';

  // The provider sends the browser back here (?code&state, or ?error&state).
  // Signed in → the layout moves on to the list; otherwise back to /login
  // with the reason. Both replace this history entry, so the code isn't kept.
  onMount(async () => {
    const failed = await auth.finishSignOn(new URLSearchParams(location.search));
    if (failed) goto(`/login?signon=${failed}`, { replace: true });
    else goto('/', { replace: true });
  });
</script>

<section>
  <p class="empty">Signing in…</p>
</section>

<style>
  section {
    padding-top: 15vh;
  }
</style>
