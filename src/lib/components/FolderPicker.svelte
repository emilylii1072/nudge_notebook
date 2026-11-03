<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		start: string;
		recent: string[];
		onOpen: (path: string) => void;
		onCancel: () => void;
	}
	let { start, recent, onOpen, onCancel }: Props = $props();

	let path = $state('');
	let parent = $state<string | null>(null);
	let dirs = $state<{ name: string; path: string }[]>([]);
	let typed = $state('');
	let problem = $state('');

	async function go(target: string | null) {
		problem = '';
		const res = await fetch(`/api/fs/dirs?path=${encodeURIComponent(target ?? '')}`);
		if (!res.ok) {
			problem = 'That folder cannot be read.';
			return;
		}
		const data = (await res.json()) as { path: string; parent: string | null; dirs: typeof dirs };
		path = data.path;
		parent = data.parent;
		dirs = data.dirs;
		typed = data.path;
	}

	onMount(() => void go(start));
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onCancel()} />

<div class="backdrop" role="presentation">
	<div class="dialog" role="dialog" aria-modal="true" aria-label="Open folder">
		<h2>Open folder</h2>

		<div class="path">
			<input
				bind:value={typed}
				onkeydown={(e) => e.key === 'Enter' && go(typed)}
				spellcheck="false"
				aria-label="Folder path"
			/>
			<button onclick={() => go(typed)}>Go</button>
		</div>
		{#if problem}<p class="problem">{problem}</p>{/if}

		<div class="list">
			{#if parent !== null}
				<button class="row" onclick={() => go(parent)}>↑ Up</button>
			{/if}
			{#each dirs as dir (dir.path)}
				<button class="row" onclick={() => go(dir.path)}>📁 {dir.name}</button>
			{/each}
			{#if dirs.length === 0 && !problem}<p class="empty">No folders here.</p>{/if}
		</div>

		{#if recent.length > 0}
			<div class="recent">
				<strong>Recent</strong>
				{#each recent as folder (folder)}
					<button class="link" onclick={() => onOpen(folder)} title={folder}>{folder}</button>
				{/each}
			</div>
		{/if}

		<div class="buttons">
			<button onclick={onCancel}>Cancel</button>
			<button class="primary" disabled={!path} onclick={() => onOpen(path)}>Open this folder</button>
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.45);
		display: grid;
		place-items: center;
		z-index: 30;
	}
	.dialog {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 18px 20px;
		width: min(560px, calc(100vw - 32px));
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	h2 {
		margin: 0;
		font-size: 16px;
	}
	.path {
		display: flex;
		gap: 6px;
	}
	.path input {
		flex: 1;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--panel);
		color: var(--text);
		font: inherit;
	}
	.list {
		flex: 1;
		min-height: 160px;
		overflow-y: auto;
		border: 1px solid var(--line);
		border-radius: 6px;
	}
	.row {
		display: block;
		width: 100%;
		text-align: left;
		border: none;
		border-radius: 0;
		border-bottom: 1px solid var(--line);
		background: transparent;
	}
	.row:hover {
		background: var(--out);
	}
	.empty,
	.problem {
		margin: 8px 10px;
		color: var(--muted);
	}
	.problem {
		color: var(--bad);
		margin: 0;
	}
	.recent {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 13px;
	}
	.link {
		text-align: left;
		border: none;
		background: none;
		color: var(--accent);
		padding: 2px 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.buttons {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}
</style>
