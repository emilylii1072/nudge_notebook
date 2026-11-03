<script lang="ts">
	import { onMount } from 'svelte';
	import CellView, { type UiCell } from '$lib/components/CellView.svelte';
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import FileTree from '$lib/components/FileTree.svelte';
	import FolderPicker from '$lib/components/FolderPicker.svelte';
	import TextEditor from '$lib/components/TextEditor.svelte';
	import { exchangesOf, type ChatEntry, type Decision, type Mode } from '$lib/chat';
	import { createNudger, TASK_QUESTION, TASK_QUESTION_SKIP } from '$lib/nudger';
	import { emptyCell, type Cell, type CellType } from '$lib/shared/notebook';

	// ---- The open folder, its files and the open tabs. ----
	let workspace = $state({ root: '', name: '', recent: [] as string[], hosted: false });
	let entries = $state<{ path: string; type: 'file' | 'dir' }[]>([]);
	let truncated = $state(false);
	let tabs = $state<string[]>([]);
	let active = $state('');
	let textReload = $state(0);
	let problem = $state('');
	let pickingFolder = $state(false);

	const isNotebook = (path: string) => path.toLowerCase().endsWith('.ipynb');
	let notebook = $derived(isNotebook(active) ? active : '');
	const baseName = (path: string) => path.split('/').pop() ?? path;
	const parentOf = (path: string) => path.split('/').slice(0, -1).join('/');
	const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

	// ---- The notebook that is open. ----
	let cells = $state<UiCell[]>([]);
	let kernel = $state({ running: false, busy: false });
	let loaded = false;

	// ---- Talking to Claude. ----
	let chat = $state<ChatEntry[]>([]);
	let busy = $state(false);
	let mode = $state<Mode>('ask');
	let bash = $state(false);
	let sessionId = '';
	let conversation = crypto.randomUUID();
	let abort: AbortController | null = null;
	const hiddenTools = new Set<string>();
	/** Approval requests that arrived before the tool call they belong to. */
	const earlyPermissions = new Map<string, string>();

	let average = $state<number | null>(null);
	let toasts = $state<{ id: number; title: string; body: string }[]>([]);
	/** The warning before a passive message is sent, with the sentence starter it offers. */
	let confirm = $state<{ starter: string; resolve: (sendAsItIs: boolean) => void } | null>(null);
	/** The question asked while the agent works. */
	let taskQuestion = $state<{ resolve: (answer: string | null) => void } | null>(null);
	let taskAnswer = $state('');
	/** What is in the message box. */
	let draft = $state('');
	let toastId = 0;
	/** How long a nudge stays up, as in the terminal plugin. */
	const TOAST_MS = 12_000;

	const enc = encodeURIComponent;

	/** Ask the server and read its reply, turning a refusal into a message. */
	async function api(url: string, init?: RequestInit): Promise<{ ok: boolean; data: any; message: string }> {
		try {
			const res = await fetch(url, init);
			const data = await res.json().catch(() => ({}));
			return { ok: res.ok, data, message: data?.message ?? (res.ok ? '' : `Something went wrong (${res.status}).`) };
		} catch (err) {
			return { ok: false, data: {}, message: (err as Error).message };
		}
	}

	const post = (url: string, body: unknown) =>
		api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

	// ---- The nudger sits between the message box and the agent. ----
	const nudger = createNudger({
		exchanges: () => exchangesOf(chat),
		agentBusy: () => busy,
		confirmSend: (starter) => new Promise<boolean>((resolve) => (confirm = { starter, resolve })),
		fillInput: (text) => (draft = text),
		askQuestion: () =>
			new Promise<string | null>((resolve) => {
				taskAnswer = '';
				taskQuestion = { resolve };
			}),
		nudge: (title, body) => {
			const id = ++toastId;
			toasts = [...toasts, { id, title, body }];
			setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), TOAST_MS);
		},
		clearNudges: () => (toasts = []),
		notice: (text) => chat.push({ kind: 'note', text }),
		scoresChanged: () => (average = nudger.currentAverage())
	});

	function answerConfirm(sendAsItIs: boolean) {
		confirm?.resolve(sendAsItIs);
		confirm = null;
	}

	function answerTaskQuestion(answer: string | null) {
		taskQuestion?.resolve(answer);
		taskQuestion = null;
	}

	// ---- Small dialogs for names and confirmations. ----
	let dialog = $state<{
		title: string;
		message?: string;
		input: string | null;
		confirmLabel: string;
		danger: boolean;
		resolve: (value: string | null) => void;
	} | null>(null);

	function ask(options: { title: string; message?: string; input?: string | null; confirmLabel?: string; danger?: boolean }) {
		return new Promise<string | null>((resolve) => {
			dialog = {
				title: options.title,
				message: options.message,
				input: options.input ?? null,
				confirmLabel: options.confirmLabel ?? 'OK',
				danger: options.danger ?? false,
				resolve
			};
		});
	}

	function closeDialog(value: string | null) {
		dialog?.resolve(value);
		dialog = null;
	}

	// ---- The file list. ----
	let treeTimer: ReturnType<typeof setTimeout> | null = null;

	async function refreshTree() {
		const { ok, data } = await api('/api/files');
		if (!ok) return;
		entries = data.entries;
		truncated = data.truncated;
		// A file that was deleted or moved on disk leaves its tab.
		const files = new Set(entries.filter((e) => e.type === 'file').map((e) => e.path));
		const kept = tabs.filter((t) => files.has(t));
		if (kept.length !== tabs.length) {
			tabs = kept;
			if (!files.has(active)) await showTab(kept.at(-1) ?? '');
		}
	}

	function scheduleTreeRefresh() {
		if (treeTimer) clearTimeout(treeTimer);
		treeTimer = setTimeout(() => void refreshTree(), 250);
	}

	// ---- Loading and saving the open notebook. ----
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let inflight = 0;
	let chain: Promise<void> = Promise.resolve();
	let reloadAfterSave = false;

	const savePending = () => saveTimer !== null || inflight > 0;

	function merge(remote: Cell[]) {
		const local = new Map(cells.map((c) => [c.id, c]));
		cells = remote.map((r) => {
			const l = local.get(r.id);
			let flag = l?.flag;
			// After the first load, a cell that is new or whose text differs from
			// what this page last had is the agent's doing: this page's own saves
			// leave the file equal to the page.
			if (loaded) {
				if (!l) flag = 'new';
				else if (l.source !== r.source) flag = 'edited';
			}
			return { ...r, running: l?.running, flag };
		});
		loaded = true;
	}

	async function load() {
		if (!notebook) return;
		const { ok, data } = await api(`/api/notebook?path=${enc(notebook)}`);
		if (!ok) return;
		merge(data.cells);
		kernel = data.kernel;
	}

	function doSave(): Promise<void> {
		if (!notebook) return Promise.resolve();
		inflight++;
		return fetch('/api/notebook', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				path: notebook,
				cells: cells.map((c) => ({ id: c.id, cell_type: c.cell_type, source: c.source }))
			})
		})
			.then(() => {})
			.catch(() => {})
			.finally(async () => {
				inflight--;
				if (reloadAfterSave && !savePending()) {
					reloadAfterSave = false;
					await load();
				}
			});
	}

	/** Save now, after any save already under way. */
	function flush(): Promise<void> {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = null;
		chain = chain.then(doSave);
		return chain;
	}

	function scheduleSave() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void flush(), 500);
	}

	// ---- Watching the folder, so edits from Claude or anything else appear. ----
	let events: EventSource | null = null;

	function connectWatch() {
		events?.close();
		events = new EventSource('/api/watch');
		events.onmessage = (e) => {
			const message = JSON.parse(e.data) as { type: string; paths?: string[] };
			if (message.type !== 'changed') return;
			const paths = message.paths ?? [];
			scheduleTreeRefresh();
			if (notebook && paths.includes(notebook)) {
				if (savePending()) reloadAfterSave = true;
				else void load();
			} else if (active && paths.includes(active)) {
				textReload++;
			}
		};
	}

	// ---- Tabs. ----
	async function showTab(path: string) {
		if (path === active) return;
		await flush();
		active = path;
		loaded = false;
		cells = [];
		if (isNotebook(path)) await load();
	}

	async function openFile(path: string) {
		if (!tabs.includes(path)) tabs = [...tabs, path];
		await showTab(path);
	}

	async function closeTab(path: string) {
		const index = tabs.indexOf(path);
		tabs = tabs.filter((t) => t !== path);
		if (path === active) await showTab(tabs[Math.min(index, tabs.length - 1)] ?? '');
	}

	// ---- File management. ----
	async function newFile(dir: string) {
		const name = await ask({ title: 'New file', message: `In ${dir || 'the top folder'}. A name ending in .ipynb makes a notebook.`, input: '', confirmLabel: 'Create' });
		if (!name) return;
		const result = await post('/api/files', { op: 'create-file', path: join(dir, name) });
		if (!result.ok) return void (problem = result.message);
		await refreshTree();
		await openFile(result.data.path);
	}

	async function newFolder(dir: string) {
		const name = await ask({ title: 'New folder', message: `In ${dir || 'the top folder'}.`, input: '', confirmLabel: 'Create' });
		if (!name) return;
		const result = await post('/api/files', { op: 'create-folder', path: join(dir, name) });
		if (!result.ok) return void (problem = result.message);
		await refreshTree();
	}

	async function renameEntry(path: string) {
		const name = await ask({ title: 'Rename', input: baseName(path), confirmLabel: 'Rename' });
		if (!name || name === baseName(path)) return;
		await flush();
		const to = join(parentOf(path), name);
		const result = await post('/api/files', { op: 'rename', path, to });
		if (!result.ok) return void (problem = result.message);
		const moved = (p: string) => (p === path ? to : p.startsWith(`${path}/`) ? to + p.slice(path.length) : p);
		tabs = tabs.map(moved);
		if (moved(active) !== active) {
			active = moved(active);
			loaded = false;
			if (isNotebook(active)) await load();
		}
		await refreshTree();
	}

	async function deleteEntry(path: string) {
		const isDir = entries.find((e) => e.path === path)?.type === 'dir';
		const yes = await ask({
			title: `Delete ${baseName(path)}?`,
			message: `${isDir ? 'This folder and everything in it' : 'This file'} will be deleted permanently. This cannot be undone.`,
			confirmLabel: 'Delete',
			danger: true
		});
		if (yes === null) return;
		await flush();
		const result = await post('/api/files', { op: 'delete', path });
		if (!result.ok) return void (problem = result.message);
		for (const tab of tabs.filter((t) => t === path || t.startsWith(`${path}/`))) await closeTab(tab);
		await refreshTree();
	}

	async function importFiles(dir: string, files: File[]) {
		const send = async (overwrite: boolean) => {
			const form = new FormData();
			form.set('dir', dir);
			form.set('overwrite', String(overwrite));
			for (const file of files) form.append('files', file);
			const res = await fetch('/api/files/upload', { method: 'POST', body: form });
			return { res, data: await res.json().catch(() => ({})) };
		};
		let { res, data } = await send(false);
		if (res.status === 409) {
			const yes = await ask({
				title: 'Replace existing files?',
				message: `These already exist and would be replaced:\n${data.conflicts.join('\n')}`,
				confirmLabel: 'Replace',
				danger: true
			});
			if (yes === null) return;
			({ res, data } = await send(true));
		}
		if (!res.ok) return void (problem = data?.message ?? 'The import failed.');
		await refreshTree();
	}

	// ---- Opening another folder. ----
	async function openFolder(path: string) {
		pickingFolder = false;
		await flush();
		const result = await post('/api/workspace', { path });
		if (!result.ok) return void (problem = result.message);
		workspace = result.data;
		tabs = [];
		active = '';
		cells = [];
		loaded = false;
		clearChat();
		await refreshTree();
		connectWatch();
	}

	// ---- Editing cells. ----
	const byId = (id: string) => cells.find((c) => c.id === id);

	function change(id: string, source: string) {
		const cell = byId(id);
		if (!cell) return;
		cell.source = source;
		cell.flag = undefined;
		scheduleSave();
	}

	function add(afterIndex: number, type: CellType) {
		const cell: UiCell = emptyCell(type);
		cells.splice(afterIndex + 1, 0, cell);
		scheduleSave();
	}

	function remove(id: string) {
		cells = cells.filter((c) => c.id !== id);
		scheduleSave();
	}

	function setType(id: string, type: CellType) {
		const cell = byId(id);
		if (!cell) return;
		cell.cell_type = type;
		if (type !== 'code') cell.outputs = [];
		scheduleSave();
	}

	function move(index: number, direction: -1 | 1) {
		const to = index + direction;
		if (to < 0 || to >= cells.length) return;
		const [cell] = cells.splice(index, 1);
		cells.splice(to, 0, cell);
		scheduleSave();
	}

	// ---- Running cells. ----
	async function runCell(id: string): Promise<boolean> {
		const cell = byId(id);
		if (!cell || cell.cell_type !== 'code' || !notebook) return true;
		await flush();
		cell.running = true;
		try {
			const { data } = await post('/api/run', { path: notebook, cellId: id, code: cell.source });
			const target = byId(id);
			if (!target) return false;
			if (data.ok) {
				target.outputs = data.outputs ?? [];
				target.execution_count = data.execution_count ?? null;
				return data.status !== 'error';
			}
			const why = String(data.error ?? data.message ?? 'The kernel failed.');
			target.outputs = [{ output_type: 'error', ename: 'Kernel', evalue: why, traceback: [why] }];
			return false;
		} finally {
			const target = byId(id);
			if (target) target.running = false;
			kernel.running = true;
		}
	}

	async function runAndNext(index: number) {
		await runCell(cells[index].id);
		if (index === cells.length - 1) add(index, 'code');
	}

	async function runAll() {
		for (const cell of [...cells]) {
			if (cell.cell_type !== 'code') continue;
			if (!(await runCell(cell.id))) break;
		}
	}

	async function kernelAction(action: 'interrupt' | 'restart') {
		await post('/api/kernel', { path: notebook, action });
		if (action === 'restart') kernel.running = false;
	}

	// ---- Talking to Claude. ----
	async function handleSend(message: string): Promise<boolean> {
		if (message === '/clear') {
			clearChat();
			return true;
		}
		// Every message is scored first; a passive one may be held for you to edit.
		if (!(await nudger.beforeSend(message))) return false;
		void nudger.afterSend(message);

		chat.push({ kind: 'user', text: message });
		await flush();
		void runAgent(message);
		return true;
	}

	function clearChat() {
		chat = [];
		sessionId = '';
		conversation = crypto.randomUUID();
	}

	async function decide(entry: Extract<ChatEntry, { kind: 'tool' }>, decision: Decision) {
		if (!entry.permission) return;
		await post('/api/permission', { requestId: entry.permission.requestId, decision });
		entry.permission.state = decision === 'deny' ? 'denied' : 'allowed';
	}

	async function runAgent(message: string) {
		busy = true;
		abort = new AbortController();
		try {
			const res = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ message, activeFile: active, sessionId, conversation, mode, bash }),
				signal: abort.signal
			});
			if (!res.ok || !res.body) {
				chat.push({ kind: 'note', tone: 'error', text: `The agent could not start (${res.status}).` });
				return;
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let split = buffer.indexOf('\n\n');
				while (split !== -1) {
					const frame = buffer.slice(0, split);
					buffer = buffer.slice(split + 2);
					split = buffer.indexOf('\n\n');
					if (frame.startsWith('data: ')) handleAgentEvent(JSON.parse(frame.slice(6)));
				}
			}
		} catch (err) {
			if (!(err instanceof DOMException && err.name === 'AbortError')) {
				chat.push({ kind: 'note', tone: 'error', text: `Lost the connection to the agent: ${(err as Error).message}` });
			} else {
				chat.push({ kind: 'note', text: 'Stopped.' });
			}
		} finally {
			busy = false;
			abort = null;
			// An approval card nobody answered is no longer waiting.
			for (const entry of chat) {
				if (entry.kind === 'tool' && entry.permission?.state === 'pending') entry.permission.state = 'denied';
			}
			await load();
			const changed = cells.filter((c) => c.flag).length;
			if (changed > 0) {
				chat.push({
					kind: 'note',
					text: `Claude changed ${changed} cell${changed === 1 ? '' : 's'}. They are marked in the notebook.`
				});
			}
		}
	}

	function handleAgentEvent(event: Record<string, any>) {
		if (event.type === 'text') chat.push({ kind: 'text', text: event.text });
		else if (event.type === 'tool') {
			// The agent's own lookup of its tools is not something to report.
			if (event.name === 'ToolSearch') {
				hiddenTools.add(event.id);
				return;
			}
			const id = String(event.input?.cell_id ?? '');
			const early = earlyPermissions.get(event.id);
			earlyPermissions.delete(event.id);
			chat.push({
				kind: 'tool',
				id: event.id,
				name: event.name,
				input: event.input ?? {},
				before: (event.name === 'NotebookEdit' || event.name === 'mcp__nb__run_cell') && id ? byId(id)?.source : undefined,
				permission: early ? { requestId: early, state: 'pending' } : undefined
			});
		} else if (event.type === 'permission') {
			const entry = chat.find((e) => e.kind === 'tool' && e.id === event.toolUseId);
			if (entry && entry.kind === 'tool') entry.permission = { requestId: event.requestId, state: 'pending' };
			else earlyPermissions.set(event.toolUseId, event.requestId);
		} else if (event.type === 'tool_result') {
			if (hiddenTools.has(event.id)) return;
			const entry = chat.find((e) => e.kind === 'tool' && e.id === event.id);
			if (entry && entry.kind === 'tool') {
				entry.result = event.text;
				entry.isError = event.isError;
				if (entry.permission?.state === 'pending') entry.permission.state = 'allowed';
			}
		} else if (event.type === 'error') {
			chat.push({ kind: 'note', tone: 'error', text: event.message });
		} else if (event.type === 'done') {
			sessionId = event.sessionId || sessionId;
		}
	}

	onMount(() => {
		const stopTimer = nudger.start();
		void (async () => {
			const result = await api('/api/workspace');
			if (result.ok) workspace = result.data;
			await refreshTree();
			connectWatch();
			const first = entries.find((e) => e.type === 'file' && isNotebook(e.path));
			if (first) await openFile(first.path);
		})();
		return () => {
			stopTimer();
			events?.close();
		};
	});
</script>

<div class="app">
	<FileTree
		rootName={workspace.name}
		{entries}
		{truncated}
		{active}
		onOpen={openFile}
		onNewFile={newFile}
		onNewFolder={newFolder}
		onRename={renameEntry}
		onDelete={deleteEntry}
		onImport={importFiles}
		onOpenFolder={workspace.hosted ? undefined : () => (pickingFolder = true)}
	/>

	<main>
		{#if problem}
			<div class="problem" role="alert">
				{problem}
				<button onclick={() => (problem = '')}>Dismiss</button>
			</div>
		{/if}

		<div class="tabs" role="tablist">
			{#each tabs as tab (tab)}
				<div class="tab" class:on={tab === active} role="presentation">
					<button role="tab" aria-selected={tab === active} onclick={() => showTab(tab)} title={tab}>{baseName(tab)}</button>
					<button class="close" aria-label="Close {baseName(tab)}" onclick={() => closeTab(tab)}>×</button>
				</div>
			{/each}
			<span class="spacer"></span>
			<span class="status" title="Average ICAP score of your messages, out of 3">
				Engagement: {average === null ? '–' : average.toFixed(1)}
			</span>
			{#if !workspace.hosted}<a href="/api/prompt-events" download>Download log</a>{/if}
		</div>

		{#if notebook}
			<div class="bar">
				<button onclick={runAll} disabled={busy}>Run all</button>
				<button onclick={() => kernelAction('interrupt')}>Interrupt</button>
				<button onclick={() => kernelAction('restart')} disabled={busy}>Restart kernel</button>
				<span class="status">Kernel: {kernel.running ? 'running' : 'not started'}</span>
			</div>
			<div class="cells">
				{#each cells as cell, i (cell.id)}
					<CellView
						{cell}
						index={i}
						locked={busy}
						onChange={(source) => change(cell.id, source)}
						onRun={() => runCell(cell.id)}
						onRunAndNext={() => runAndNext(i)}
						onDelete={() => remove(cell.id)}
						onAdd={(type) => add(i, type)}
						onType={(type) => setType(cell.id, type)}
						onMove={(d) => move(i, d)}
						onDismissFlag={() => (cell.flag = undefined)}
					/>
				{/each}
				{#if cells.length === 0}
					<p class="empty">This notebook is empty.</p>
				{/if}
				<div class="add-row">
					<button onclick={() => add(cells.length - 1, 'code')} disabled={busy}>+ Code</button>
					<button onclick={() => add(cells.length - 1, 'markdown')} disabled={busy}>+ Text</button>
				</div>
			</div>
		{:else if active}
			<TextEditor path={active} reloadKey={textReload} locked={busy} />
		{:else}
			<p class="empty center">Open a file from the list, add one, or ask Claude to.</p>
		{/if}
	</main>

	<ChatPanel
		entries={chat}
		{busy}
		bind:mode
		bind:bash
		bind:message={draft}
		allowShell={!workspace.hosted}
		onSend={handleSend}
		onStop={() => abort?.abort()}
		onClear={clearChat}
		onDecide={decide}
	/>
</div>

{#if pickingFolder}
	<FolderPicker start={workspace.root} recent={workspace.recent} onOpen={openFolder} onCancel={() => (pickingFolder = false)} />
{/if}

{#if dialog}
	<Dialog
		title={dialog.title}
		message={dialog.message}
		input={dialog.input}
		confirmLabel={dialog.confirmLabel}
		danger={dialog.danger}
		onSubmit={(value) => closeDialog(value)}
		onCancel={() => closeDialog(null)}
	/>
{/if}

{#if toasts.length > 0}
	<div class="toasts" role="status">
		{#each toasts as toast (toast.id)}
			<div class="toast">
				<strong>{toast.title}</strong>
				<p>{toast.body}</p>
				<button onclick={() => (toasts = toasts.filter((t) => t.id !== toast.id))}>Dismiss</button>
			</div>
		{/each}
	</div>
{/if}

{#if confirm}
	<div class="backdrop">
		<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="nudge-title">
			<h2 id="nudge-title">Nudge</h2>
			<p>
				This message looks like a simple acceptance, and your messages so far average
				{(average ?? 0).toFixed(1)} out of 3 for engagement. Send it as it is, or write your own. A sentence
				starter will be put in your prompt box: {confirm.starter}
			</p>
			<div class="buttons">
				<button onclick={() => answerConfirm(true)}>Send as it is</button>
				<button class="primary" onclick={() => answerConfirm(false)}>Write my own</button>
			</div>
		</div>
	</div>
{/if}

{#if taskQuestion}
	<div class="backdrop">
		<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="question-title">
			<h2 id="question-title">Question</h2>
			<p>{TASK_QUESTION}</p>
			<textarea rows="3" bind:value={taskAnswer} placeholder="Type your answer"></textarea>
			<div class="buttons">
				<button onclick={() => answerTaskQuestion(TASK_QUESTION_SKIP)}>{TASK_QUESTION_SKIP}</button>
				<button onclick={() => answerTaskQuestion('Not sure yet')}>Not sure yet</button>
				<button class="primary" disabled={!taskAnswer.trim()} onclick={() => answerTaskQuestion(taskAnswer.trim())}>
					Answer
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.app {
		display: grid;
		grid-template-columns: 240px minmax(0, 1fr) 420px;
		height: 100vh;
	}
	main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.problem {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		background: color-mix(in srgb, var(--bad) 14%, var(--bg));
		color: var(--bad);
	}
	.tabs {
		display: flex;
		align-items: stretch;
		gap: 2px;
		padding: 6px 12px 0;
		border-bottom: 1px solid var(--line);
		overflow-x: auto;
	}
	.tab {
		display: flex;
		align-items: center;
		border: 1px solid var(--line);
		border-bottom: none;
		border-radius: 6px 6px 0 0;
		background: var(--panel);
	}
	.tab.on {
		background: var(--bg);
		border-color: var(--accent);
	}
	.tab button {
		border: none;
		background: transparent;
		border-radius: 0;
	}
	.tab .close {
		padding: 0 6px;
		color: var(--muted);
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 8px 16px;
		border-bottom: 1px solid var(--line);
	}
	.spacer {
		flex: 1;
	}
	.status {
		color: var(--muted);
		font-size: 13px;
		align-self: center;
		white-space: nowrap;
	}
	.tabs a {
		font-size: 13px;
		color: var(--accent);
		align-self: center;
		margin: 0 6px;
		white-space: nowrap;
	}
	.cells {
		flex: 1;
		overflow-y: auto;
		padding: 12px 16px 80px;
	}
	.empty {
		color: var(--muted);
	}
	.center {
		margin: auto;
		padding: 24px;
		text-align: center;
	}
	.add-row {
		display: flex;
		gap: 8px;
		padding: 12px 0 0 56px;
	}
	.toasts {
		position: fixed;
		left: 16px;
		bottom: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 360px;
		z-index: 10;
	}
	.toast {
		background: var(--panel);
		border: 1px solid var(--accent);
		border-radius: 8px;
		padding: 10px 12px;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
	}
	.toast p {
		margin: 4px 0 8px;
		line-height: 1.45;
		white-space: pre-line;
	}
	.dialog textarea {
		width: 100%;
		box-sizing: border-box;
		margin: 0 0 12px;
		font: inherit;
		resize: vertical;
	}
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 0.45);
		display: grid;
		place-items: center;
		z-index: 20;
	}
	.dialog {
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 18px 20px;
		max-width: 460px;
		margin: 16px;
	}
	.dialog h2 {
		margin: 0 0 8px;
		font-size: 17px;
	}
	.dialog p {
		line-height: 1.5;
		margin: 0 0 10px;
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
	@media (max-width: 1100px) {
		.app {
			grid-template-columns: 200px minmax(0, 1fr);
			grid-template-rows: 1fr 50vh;
			height: auto;
		}
	}
</style>
