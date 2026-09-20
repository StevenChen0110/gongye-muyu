<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<svelte:head>
	<title>淨心木魚 — 敲一下，靜一下</title>
</svelte:head>

{@render children()}
