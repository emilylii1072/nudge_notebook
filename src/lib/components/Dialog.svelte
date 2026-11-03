<script lang="ts">
	import { tick } from 'svelte';

	interface Props {
		title: string;
		message?: string;
		/** When set, the dialog asks for text and starts with this value. */
		input?: string | null;
		confirmLabel?: string;
		danger?: boolean;
		onSubmit: (value: string) => void;
		onCancel: () => void;
	}
	let { title, message = '', input = null, confirmLabel = 'OK', danger = false, onSubmit, onCancel }: Props = $props();

	// The starting text is read once, when the dialog opens.
	// svelte-ignore state_referenced_locally
	let value = $state('');
	value = input ?? '';
	let inputEl: HTMLInputElement | null = $state(null);

	$effect(() => {
		if (input !== null) void tick().then(() => inputEl?.select());
	});

	function submit() {
		if (input !== null && !value.trim()) return;
		onSubmit(value.trim());
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') onCancel();
		if (e.key === 'Enter' && input === null) submit();
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="backdrop" role="presentation">
	<div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
		<h2>{title}</h2>
		{#if message}<p>{message}</p>{/if}
		{#if input !== null}
			<input
				bind:this={inputEl}
				bind:value
				onkeydown={(e) => e.key === 'Enter' && submit()}
				spellcheck="false"
			/>
		{/if}
		<div class="buttons">
			<button onclick={onCancel}>Cancel</button>
			<button class:danger class:primary={!danger} onclick={submit}>{confirmLabel}</button>
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
		width: min(420px, calc(100vw - 32px));
	}
	h2 {
		margin: 0 0 8px;
		font-size: 16px;
	}
	p {
		margin: 0 0 12px;
		line-height: 1.5;
		white-space: pre-wrap;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		margin-bottom: 14px;
		padding: 6px 8px;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--panel);
		color: var(--text);
		font: inherit;
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
	.danger {
		background: var(--bad);
		border-color: var(--bad);
		color: white;
	}
</style>
