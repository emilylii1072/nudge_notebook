<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<title>Nudge Notebook</title>
</svelte:head>

{@render children()}

<style>
	:global(:root) {
		--bg: #ffffff;
		--panel: #fafafa;
		--out: #f3f4f6;
		--text: #1f2328;
		--muted: #6b7280;
		--line: #d8dce2;
		--accent: #2f6fed;
		--good: #1a8a4a;
		--bad: #c0362c;
		--warn: #c98a00;
		--mono: ui-monospace, 'Cascadia Code', Consolas, Menlo, monospace;
	}
	@media (prefers-color-scheme: dark) {
		:global(:root) {
			--bg: #14161a;
			--panel: #1b1e23;
			--out: #22262c;
			--text: #e6e8eb;
			--muted: #9aa1ab;
			--line: #353a42;
			--accent: #5b8cff;
			--good: #4cc27f;
			--bad: #ff7b72;
			--warn: #e3b341;
		}
	}
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
		font-size: 14px;
	}
	:global(button),
	:global(select) {
		font: inherit;
		color: var(--text);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 4px 10px;
		cursor: pointer;
	}
	:global(button:hover:not(:disabled)) {
		border-color: var(--accent);
	}
	:global(button:disabled) {
		opacity: 0.45;
		cursor: default;
	}
</style>
