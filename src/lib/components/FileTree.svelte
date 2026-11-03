<script lang="ts">
	interface Entry {
		path: string;
		type: 'file' | 'dir';
	}

	interface Props {
		rootName: string;
		entries: Entry[];
		truncated: boolean;
		active: string;
		onOpen: (path: string) => void;
		onNewFile: (dir: string) => void;
		onNewFolder: (dir: string) => void;
		onRename: (path: string) => void;
		onDelete: (path: string) => void;
		onImport: (dir: string, files: File[]) => void;
		/** Left out when the folder is fixed, as it is when hosted. */
		onOpenFolder?: () => void;
	}
	let {
		rootName,
		entries,
		truncated,
		active,
		onOpen,
		onNewFile,
		onNewFolder,
		onRename,
		onDelete,
		onImport,
		onOpenFolder
	}: Props = $props();

	let collapsed = $state<Record<string, boolean>>({});
	/** The folder new files and imports go into. '' is the top. */
	let target = $state('');
	let dragging = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);

	const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
	const nameOf = (path: string) => path.split('/').pop() ?? path;

	let rows = $derived(
		entries.filter((entry) => {
			const parts = entry.path.split('/');
			for (let i = 1; i < parts.length; i++) {
				if (collapsed[parts.slice(0, i).join('/')]) return false;
			}
			return true;
		})
	);

	function click(entry: Entry) {
		if (entry.type === 'dir') {
			collapsed[entry.path] = !collapsed[entry.path];
			target = entry.path;
		} else {
			target = parentOf(entry.path);
			onOpen(entry.path);
		}
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const files = [...(e.dataTransfer?.files ?? [])];
		if (files.length > 0) onImport(target, files);
	}

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = '';
		if (files.length > 0) onImport(target, files);
	}
</script>

<aside
	class="tree"
	class:dragging
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={() => (dragging = false)}
	ondrop={onDrop}
>
	<div class="head">
		{#if onOpenFolder}
			<button class="folder" onclick={onOpenFolder} title="Open a different folder">📁 {rootName}</button>
		{:else}
			<div class="folder fixed">📁 {rootName}</div>
		{/if}
	</div>
	<div class="toolbar">
		<button onclick={() => onNewFile(target)} title="New file in {target || 'the top folder'}">+ File</button>
		<button onclick={() => onNewFolder(target)} title="New folder in {target || 'the top folder'}">+ Folder</button>
		<button onclick={() => fileInput?.click()} title="Import files into {target || 'the top folder'}">Import</button>
		<input bind:this={fileInput} type="file" multiple hidden onchange={onPick} />
	</div>
	<p class="where">Adding to: {target || '(top folder)'}</p>

	<ul>
		{#each rows as entry (entry.path)}
			<li class:active={entry.path === active} class:target={entry.type === 'dir' && entry.path === target}>
				<button
					class="name"
					style:padding-left="{8 + (entry.path.split('/').length - 1) * 14}px"
					onclick={() => click(entry)}
				>
					<span class="icon">{entry.type === 'dir' ? (collapsed[entry.path] ? '▸' : '▾') : '·'}</span>
					{nameOf(entry.path)}
				</button>
				<span class="actions">
					<button onclick={() => onRename(entry.path)} title="Rename" aria-label="Rename {nameOf(entry.path)}">✎</button>
					<button onclick={() => onDelete(entry.path)} title="Delete" aria-label="Delete {nameOf(entry.path)}">✕</button>
				</span>
			</li>
		{/each}
	</ul>
	{#if entries.length === 0}
		<p class="empty">This folder is empty. Add a file, or drop files here.</p>
	{/if}
	{#if truncated}<p class="empty">Showing the first files only.</p>{/if}
</aside>

<style>
	.tree {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		border-right: 1px solid var(--line);
		background: var(--panel);
	}
	.tree.dragging {
		outline: 2px dashed var(--accent);
		outline-offset: -4px;
	}
	.head {
		padding: 8px;
		border-bottom: 1px solid var(--line);
	}
	.folder.fixed {
		padding: 4px 10px;
	}
	.folder {
		width: 100%;
		text-align: left;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.toolbar {
		display: flex;
		gap: 4px;
		padding: 8px 8px 0;
	}
	.toolbar button {
		font-size: 12px;
		padding: 2px 6px;
	}
	.where {
		margin: 4px 8px 6px;
		font-size: 11px;
		color: var(--muted);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0 0 12px;
	}
	li {
		display: flex;
		align-items: center;
	}
	li:hover {
		background: var(--out);
	}
	li.active {
		background: color-mix(in srgb, var(--accent) 16%, transparent);
	}
	li.target .name {
		font-weight: 600;
	}
	.name {
		flex: 1;
		min-width: 0;
		text-align: left;
		border: none;
		background: transparent;
		padding: 3px 8px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border-radius: 0;
	}
	.icon {
		display: inline-block;
		width: 12px;
		color: var(--muted);
	}
	.actions {
		display: none;
		padding-right: 4px;
	}
	li:hover .actions {
		display: flex;
	}
	.actions button {
		border: none;
		background: transparent;
		padding: 0 4px;
		color: var(--muted);
	}
	.empty {
		margin: 8px;
		font-size: 13px;
		color: var(--muted);
	}
</style>
