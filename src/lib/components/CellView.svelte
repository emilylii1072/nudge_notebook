<script lang="ts">
	import type { Cell, CellOutput, CellType } from '$lib/shared/notebook';
	import { joinText, outputText } from '$lib/shared/notebook';

	export interface UiCell extends Cell {
		running?: boolean;
		/** Set when the agent changed this cell since you last looked. */
		flag?: 'edited' | 'new';
	}

	interface Props {
		cell: UiCell;
		index: number;
		/** True while the agent is working, so you and it do not edit the same cell. */
		locked?: boolean;
		onChange: (source: string) => void;
		onRun: () => void;
		onRunAndNext: () => void;
		onDelete: () => void;
		onAdd: (type: CellType) => void;
		onType: (type: CellType) => void;
		onMove: (direction: -1 | 1) => void;
		onDismissFlag: () => void;
	}
	let { cell, index, locked = false, onChange, onRun, onRunAndNext, onDelete, onAdd, onType, onMove, onDismissFlag }: Props = $props();

	/** Grow the box to fit its text. */
	function autosize(node: HTMLTextAreaElement, _value: string) {
		const fit = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight}px`;
		};
		fit();
		return { update: fit };
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && e.shiftKey) {
			e.preventDefault();
			onRunAndNext();
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			onRun();
		}
	}

	function imageOf(out: CellOutput): string | null {
		const data = (out.data ?? {}) as Record<string, unknown>;
		const png = joinText(data['image/png']).replace(/\s/g, '');
		if (png) return `data:image/png;base64,${png}`;
		const jpeg = joinText(data['image/jpeg']).replace(/\s/g, '');
		return jpeg ? `data:image/jpeg;base64,${jpeg}` : null;
	}
</script>

<section class="cell" class:flagged={!!cell.flag} class:running={cell.running}>
	<div class="gutter">
		{#if cell.cell_type === 'code'}
			<button class="run" title="Run (Ctrl+Enter)" onclick={onRun} disabled={cell.running || locked}>
				{cell.running ? '…' : '▶'}
			</button>
			<span class="count">[{cell.running ? '*' : (cell.execution_count ?? ' ')}]</span>
		{:else}
			<span class="count">{cell.cell_type === 'markdown' ? 'md' : 'raw'}</span>
		{/if}
	</div>

	<div class="body">
		{#if cell.flag}
			<div class="badge">
				Claude {cell.flag === 'new' ? 'added this cell' : 'edited this cell'}
				<button onclick={onDismissFlag}>Got it</button>
			</div>
		{/if}

		<textarea
			class:code={cell.cell_type === 'code'}
			value={cell.source}
			readonly={locked}
			use:autosize={cell.source}
			oninput={(e) => onChange(e.currentTarget.value)}
			onkeydown={onKeyDown}
			spellcheck={cell.cell_type !== 'code'}
			rows="1"
			placeholder={cell.cell_type === 'code' ? 'Code' : 'Text'}
		></textarea>

		{#each cell.outputs as out, i (i)}
			{@const image = imageOf(out)}
			<div class="output" class:error={out.output_type === 'error'}>
				{#if image}
					<img src={image} alt="cell output" />
				{:else}
					<pre>{outputText(out)}</pre>
				{/if}
			</div>
		{/each}

		<div class="tools">
			<select disabled={locked} value={cell.cell_type} onchange={(e) => onType(e.currentTarget.value as CellType)} aria-label="Cell type">
				<option value="code">Code</option>
				<option value="markdown">Markdown</option>
			</select>
			<button disabled={locked} onclick={() => onAdd('code')}>+ Code</button>
			<button disabled={locked} onclick={() => onAdd('markdown')}>+ Text</button>
			<button onclick={() => onMove(-1)} disabled={locked || index === 0} aria-label="Move up">↑</button>
			<button disabled={locked} onclick={() => onMove(1)} aria-label="Move down">↓</button>
			<button class="danger" disabled={locked} onclick={onDelete}>Delete</button>
		</div>
	</div>
</section>

<style>
	.cell {
		display: flex;
		gap: 8px;
		padding: 8px 0 8px 8px;
		border-left: 3px solid transparent;
		border-radius: 4px;
	}
	.cell:hover .tools,
	.cell:focus-within .tools {
		opacity: 1;
	}
	.cell.flagged {
		border-left-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 7%, transparent);
	}
	.cell.running {
		border-left-color: var(--warn);
	}
	.gutter {
		width: 48px;
		flex: none;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--muted);
	}
	.run {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		padding: 0;
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.badge {
		font-size: 12px;
		color: var(--accent);
		margin-bottom: 4px;
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.badge button {
		font-size: 12px;
		padding: 0 6px;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		resize: none;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 8px 10px;
		background: var(--panel);
		color: var(--text);
		font: inherit;
		line-height: 1.45;
	}
	textarea.code {
		font-family: var(--mono);
		font-size: 13px;
	}
	textarea:focus {
		outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
		border-color: var(--accent);
	}
	.output {
		margin-top: 6px;
		padding: 6px 10px;
		border-radius: 6px;
		background: var(--out);
		overflow-x: auto;
	}
	.output.error {
		background: color-mix(in srgb, var(--bad) 10%, var(--out));
		color: var(--bad);
	}
	.output pre {
		margin: 0;
		font-family: var(--mono);
		font-size: 12.5px;
		white-space: pre-wrap;
		word-break: break-word;
	}
	.output img {
		max-width: 100%;
	}
	.tools {
		display: flex;
		gap: 6px;
		margin-top: 6px;
		opacity: 0;
		transition: opacity 0.1s;
	}
	.tools button,
	.tools select {
		font-size: 12px;
		padding: 2px 8px;
	}
	.danger {
		margin-left: auto;
		color: var(--bad);
	}
</style>
