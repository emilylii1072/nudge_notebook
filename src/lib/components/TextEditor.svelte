<script lang="ts">
	/**
	 * A plain editor for one file that is not a notebook. Text files are edited
	 * and saved; images are shown; other files say why they cannot be opened.
	 */
	interface Props {
		path: string;
		/** Goes up when the file changed on disk, so a clean editor reloads it. */
		reloadKey: number;
		/** True while Claude is working, so you and it do not edit at once. */
		locked?: boolean;
	}
	let { path, reloadKey, locked = false }: Props = $props();

	type Loaded =
		| { kind: 'text'; content: string }
		| { kind: 'image'; type: string }
		| { kind: 'binary' }
		| { kind: 'too-large'; size: number };

	let file = $state<Loaded | null>(null);
	let text = $state('');
	let dirty = false;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saveState = $state<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
	let loadedPath = '';

	async function load() {
		const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
		if (!res.ok) {
			file = null;
			return;
		}
		const data = (await res.json()) as Loaded;
		file = data;
		if (data.kind === 'text') text = data.content;
		dirty = false;
		saveState = 'saved';
		loadedPath = path;
	}

	async function save() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = null;
		if (!dirty) return;
		saveState = 'saving';
		const res = await fetch('/api/file', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ path: loadedPath, content: text })
		});
		if (res.ok) {
			dirty = saveTimer !== null;
			saveState = dirty ? 'unsaved' : 'saved';
		} else saveState = 'error';
	}

	function onInput(value: string) {
		text = value;
		dirty = true;
		saveState = 'unsaved';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), 600);
	}

	// Open a new file, or reload when it changed on disk and there is nothing unsaved.
	$effect(() => {
		path;
		reloadKey;
		if (path !== loadedPath) {
			void save().then(load);
		} else if (!dirty) {
			void load();
		}
	});
</script>

<div class="editor">
	{#if file?.kind === 'text'}
		<textarea
			value={text}
			readonly={locked}
			oninput={(e) => onInput(e.currentTarget.value)}
			onblur={() => void save()}
			spellcheck="false"
			aria-label={path}
		></textarea>
		<div class="state">{saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Could not save' : 'Unsaved'}</div>
	{:else if file?.kind === 'image'}
		<div class="center"><img src={`/api/file?path=${encodeURIComponent(path)}&raw=1&v=${reloadKey}`} alt={path} /></div>
	{:else if file?.kind === 'too-large'}
		<p class="center">This file is too large to edit here ({Math.round(file.size / 1024 / 1024)} MB).</p>
	{:else if file?.kind === 'binary'}
		<p class="center">This is not a text file, so it cannot be shown here.</p>
	{:else}
		<p class="center">Loading…</p>
	{/if}
</div>

<style>
	.editor {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	textarea {
		flex: 1;
		resize: none;
		border: none;
		outline: none;
		padding: 14px 16px;
		background: var(--bg);
		color: var(--text);
		font-family: var(--mono);
		font-size: 13px;
		line-height: 1.5;
		tab-size: 4;
	}
	.state {
		position: absolute;
		right: 12px;
		bottom: 8px;
		font-size: 12px;
		color: var(--muted);
	}
	.center {
		margin: auto;
		color: var(--muted);
		text-align: center;
		padding: 24px;
	}
	img {
		max-width: 100%;
		max-height: 100%;
	}
</style>
