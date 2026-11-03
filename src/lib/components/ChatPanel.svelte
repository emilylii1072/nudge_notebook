<script lang="ts">
	import { tick } from 'svelte';
	import type { ChatEntry, Decision, Mode } from '$lib/chat';
	import { diffLines } from '$lib/shared/diff';

	interface Props {
		entries: ChatEntry[];
		busy: boolean;
		/** Resolves false to keep the draft in the box, for example when you chose to edit it. */
		onSend: (message: string, pasted: boolean) => Promise<boolean>;
		onStop: () => void;
		onClear: () => void;
		onDecide: (entry: Extract<ChatEntry, { kind: 'tool' }>, decision: Decision) => void;
		mode: Mode;
		bash: boolean;
		/** What is in the message box. Bound, so the nudger can put a sentence starter in it. */
		message?: string;
		/** False when hosted: participants get no shell. */
		allowShell?: boolean;
	}
	let { entries, busy, onSend, onStop, onClear, onDecide, mode = $bindable(), bash = $bindable(), message = $bindable(''), allowShell = true }: Props = $props();

	let logEl: HTMLDivElement | null = $state(null);
	let sending = false;

	/** How many characters of the box came from pasting, so a message that is
	 * mostly pasted text can be scored as pasted. */
	let pastedChars = 0;

	$effect(() => {
		if (message === '') pastedChars = 0;
	});

	function onPaste(e: ClipboardEvent) {
		pastedChars += e.clipboardData?.getData('text/plain').length ?? 0;
	}

	async function send() {
		const trimmed = message.trim();
		if (!trimmed || busy || sending) return;
		sending = true;
		try {
			// Mostly pasted text counts as pasted; a pasted line in a typed message does not.
			const pasted = pastedChars >= trimmed.length * 0.8;
			const ok = await onSend(trimmed, pasted);
			if (!ok) return;
			message = '';
		} finally {
			sending = false;
		}
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}

	// Keep the newest step in view.
	$effect(() => {
		entries.length;
		entries.at(-1);
		void tick().then(() => logEl?.scrollTo({ top: logEl.scrollHeight }));
	});

	const cellId = (input: Record<string, unknown>) => String(input.cell_id ?? '');
	const str = (value: unknown) => (typeof value === 'string' ? value : '');
	const baseName = (path: unknown) => str(path).split(/[\\/]/).pop() || str(path);
	const READ_ONLY = new Set(['Read', 'Glob', 'Grep', 'BashOutput']);
	type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>;
	const todos = (entry: ToolEntry) =>
		(Array.isArray(entry.input.todos) ? entry.input.todos : []) as { content?: string; status?: string }[];
	/** What an approval is being asked for, when there is no diff to show. */
	const detail = (entry: ToolEntry) =>
		entry.name === 'Bash'
			? str(entry.input.command)
			: entry.name === 'mcp__nb__run_cell'
				? (entry.before ?? '')
				: entry.name === 'ExitPlanMode'
					? str(entry.input.plan)
					: '';

	function lines(entry: ToolEntry) {
		const input = entry.input;
		if (entry.name === 'NotebookEdit') {
			const mode = str(input.edit_mode) || 'replace';
			if (mode === 'delete') return diffLines(entry.before ?? '', '');
			return diffLines(mode === 'insert' ? '' : (entry.before ?? ''), str(input.new_source));
		}
		if (entry.name === 'Edit') return diffLines(str(input.old_string), str(input.new_string));
		if (entry.name === 'Write') return diffLines('', str(input.content));
		return [];
	}

	function title(entry: ToolEntry): string {
		const input = entry.input;
		switch (entry.name) {
			case 'NotebookEdit': {
				const mode = str(input.edit_mode) || 'replace';
				const where = cellId(input) ? `cell ${cellId(input)}` : 'the end of the notebook';
				if (mode === 'insert') return `Added a ${str(input.cell_type) || 'code'} cell after ${where}`;
				if (mode === 'delete') return `Deleted ${where}`;
				return `Edited ${where}`;
			}
			case 'Edit':
				return `Edited ${baseName(input.file_path)}`;
			case 'Write':
				return `Wrote ${baseName(input.file_path)}`;
			case 'Read':
				return `Read ${baseName(input.file_path)}`;
			case 'Glob':
				return `Looked for files: ${str(input.pattern)}`;
			case 'Grep':
				return `Searched for ${str(input.pattern)}`;
			case 'mcp__nb__run_cell':
				return `Run cell ${cellId(input)}`;
			case 'Bash':
				return `Run: ${str(input.command)}`;
			case 'WebFetch':
				return `Fetch ${str(input.url)}`;
			case 'WebSearch':
				return `Search the web: ${str(input.query)}`;
			case 'TodoWrite':
				return 'Plan';
			case 'ExitPlanMode':
				return 'Proposed plan';
			case 'Task':
			case 'Agent':
				return `Subagent: ${str(input.description)}`;
			default:
				return entry.name;
		}
	}
</script>

<aside class="chat">
	<header>
		<strong>Claude</strong>
		<button onclick={onClear} disabled={busy} title="Start a new conversation">New chat</button>
	</header>
	<div class="controls">
		<label title="How Claude asks before it acts">
			Mode
			<select bind:value={mode} disabled={busy}>
				<option value="ask">Ask before edits</option>
				<option value="acceptEdits">Auto-accept edits</option>
				<option value="plan">Plan first</option>
			</select>
		</label>
		{#if allowShell}
		<label
			class="shell"
			title="Shell commands cannot be fully confined to the folder on Windows. Each one still needs your approval, and obvious paths outside the folder are refused."
		>
			<input type="checkbox" bind:checked={bash} disabled={busy} /> Allow shell commands
		</label>
		{/if}
	</div>

	<div class="log" bind:this={logEl}>
		{#if entries.length === 0}
			<p class="empty">
				Ask Claude to work on the notebook. It edits the cells directly, runs them, and reports what it changed.
			</p>
		{/if}

		{#each entries as entry, i (i)}
			{#if entry.kind === 'user'}
				<div class="user">{entry.text}</div>
			{:else if entry.kind === 'text'}
				<div class="assistant">{entry.text}</div>
			{:else if entry.kind === 'note'}
				<div class="note" class:error={entry.tone === 'error'}>{entry.text}</div>
			{:else if READ_ONLY.has(entry.name)}
				<div class="quiet">{title(entry)}</div>
			{:else}
				<details class="tool" class:failed={entry.isError} open={entry.permission?.state === 'pending' || (entry.name !== 'mcp__nb__run_cell' && entry.name !== 'Bash' && entry.name !== 'TodoWrite')}>
					<summary>{entry.isError ? 'Failed: ' : ''}{title(entry)}</summary>
					{#if entry.name === 'TodoWrite'}
						<ul class="todos">
							{#each todos(entry) as todo, k (k)}
								<li class={todo.status}>{todo.status === 'completed' ? '☑' : '☐'} {todo.content}</li>
							{/each}
						</ul>
					{:else if detail(entry)}
						<pre class="result">{detail(entry)}</pre>
					{:else}
						<pre class="diff">{#each lines(entry) as line, j (j)}<span class={line.kind}>{line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  '}{line.text}
</span>{/each}</pre>
					{/if}
					{#if entry.result && (entry.isError || entry.name === 'mcp__nb__run_cell' || entry.name === 'Bash')}
						<pre class="result">{entry.result}</pre>
					{/if}
					{#if entry.permission?.state === 'pending'}
						<div class="approve">
							<span>Allow Claude to do this?</span>
							<button class="yes" onclick={() => onDecide(entry, 'allow')}>Allow</button>
							<button onclick={() => onDecide(entry, 'allow-session')} title="Do not ask again for this kind of action in this conversation">Allow for this chat</button>
							<button class="no" onclick={() => onDecide(entry, 'deny')}>Deny</button>
						</div>
					{:else if entry.permission?.state === 'denied'}
						<div class="approve done">You denied this.</div>
					{/if}
				</details>
			{/if}
		{/each}

		{#if busy}<div class="quiet working">Claude is working…</div>{/if}
	</div>

	<footer>
		<textarea
			bind:value={message}
			onkeydown={onKeyDown}
			onpaste={onPaste}
			placeholder="Message Claude (Enter to send, Shift+Enter for a new line)"
			rows="3"
		></textarea>
		<div class="actions">
			{#if busy}
				<button class="stop" onclick={onStop}>Stop</button>
			{:else}
				<button class="send" onclick={send} disabled={!message.trim()}>Send</button>
			{/if}
		</div>
	</footer>
</aside>

<style>
	.chat {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		border-left: 1px solid var(--line);
		background: var(--panel);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 14px;
		border-bottom: 1px solid var(--line);
	}
	.log {
		flex: 1;
		overflow-y: auto;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.empty,
	.quiet {
		color: var(--muted);
		font-size: 13px;
		margin: 0;
	}
	.working {
		font-style: italic;
	}
	.user {
		align-self: flex-end;
		max-width: 90%;
		background: var(--accent);
		color: white;
		padding: 8px 12px;
		border-radius: 12px 12px 2px 12px;
		white-space: pre-wrap;
	}
	.assistant {
		white-space: pre-wrap;
		line-height: 1.5;
	}
	.note {
		font-size: 13px;
		color: var(--muted);
		white-space: pre-wrap;
	}
	.note.error {
		color: var(--bad);
	}
	.tool {
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--bg);
		font-size: 13px;
	}
	.tool.failed {
		border-color: var(--bad);
	}
	summary {
		cursor: pointer;
		padding: 6px 10px;
	}
	pre {
		margin: 0;
		padding: 6px 10px 8px;
		overflow-x: auto;
		font-family: var(--mono);
		font-size: 12px;
		line-height: 1.4;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
		padding: 6px 14px;
		border-bottom: 1px solid var(--line);
		font-size: 12px;
		color: var(--muted);
	}
	.controls select {
		font-size: 12px;
		padding: 1px 6px;
	}
	.shell {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.todos {
		margin: 0;
		padding: 6px 12px 8px;
		list-style: none;
	}
	.todos .completed {
		color: var(--muted);
		text-decoration: line-through;
	}
	.approve {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		padding: 8px 10px;
		border-top: 1px solid var(--line);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	.approve span {
		flex: 1 1 100%;
		font-size: 12px;
	}
	.approve button {
		font-size: 12px;
		padding: 2px 8px;
	}
	.approve .yes {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}
	.approve .no {
		color: var(--bad);
	}
	.approve.done {
		background: transparent;
		color: var(--muted);
		font-size: 12px;
	}
	.diff span {
		display: block;
		white-space: pre-wrap;
	}
	.diff .add {
		background: color-mix(in srgb, var(--good) 18%, transparent);
	}
	.diff .del {
		background: color-mix(in srgb, var(--bad) 16%, transparent);
		text-decoration: line-through;
		text-decoration-color: color-mix(in srgb, var(--bad) 50%, transparent);
	}
	.result {
		white-space: pre-wrap;
		border-top: 1px solid var(--line);
	}
	footer {
		padding: 10px 14px 12px;
		border-top: 1px solid var(--line);
	}
	footer textarea {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 8px 10px;
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 6px;
	}
	.send {
		background: var(--accent);
		color: white;
		border-color: var(--accent);
	}
	.stop {
		color: var(--bad);
		border-color: var(--bad);
	}
</style>
