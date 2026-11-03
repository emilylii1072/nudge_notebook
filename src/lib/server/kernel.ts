/**
 * One live Jupyter kernel per notebook, run by `scripts/kernel-sidecar.py`.
 * The sidecar speaks JSON lines on stdin and stdout; see that file.
 * A variable made in one cell is still there for the next, as in Jupyter.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { pythonCommand, workspaceRoot } from './config';
import type { CellOutput } from '$lib/shared/notebook';

export interface RunResult {
	ok: boolean;
	status?: 'ok' | 'error';
	execution_count?: number | null;
	outputs?: CellOutput[];
	error?: string;
}

interface Pending {
	resolve: (value: RunResult) => void;
	reject: (reason: Error) => void;
}

interface Kernel {
	child: ChildProcessWithoutNullStreams;
	pending: Map<string, Pending>;
	buffer: string;
	ready: Promise<void>;
	stderr: string;
	busy: boolean;
}

const kernels = new Map<string, Kernel>();
let nextRequest = 1;

function sidecarPath(): string {
	return join(process.cwd(), 'scripts', 'kernel-sidecar.py');
}

function receive(kernel: Kernel, chunk: string, ready: Pending): void {
	kernel.buffer += chunk;
	let newline = kernel.buffer.indexOf('\n');
	while (newline !== -1) {
		const line = kernel.buffer.slice(0, newline).trim();
		kernel.buffer = kernel.buffer.slice(newline + 1);
		newline = kernel.buffer.indexOf('\n');
		if (!line) continue;
		let message: RunResult & { id?: string };
		try {
			message = JSON.parse(line);
		} catch {
			continue; // the kernel's own warnings are not replies
		}
		if (message.id === 'startup') {
			if (message.ok) ready.resolve(message);
			else ready.reject(new Error(message.error || 'the kernel would not start'));
			continue;
		}
		const waiting = message.id ? kernel.pending.get(message.id) : undefined;
		if (!waiting || !message.id) continue;
		kernel.pending.delete(message.id);
		waiting.resolve(message);
	}
}

function kernelFor(notebook: string): Kernel {
	const running = kernels.get(notebook);
	if (running && !running.child.killed) return running;

	const cwd = existsSync(dirname(notebook)) ? dirname(notebook) : workspaceRoot();
	const child = spawn(pythonCommand(), [sidecarPath()], {
		cwd,
		stdio: ['pipe', 'pipe', 'pipe']
	}) as ChildProcessWithoutNullStreams;

	let readyHandle!: Pending;
	const ready = new Promise<void>((resolve, reject) => {
		readyHandle = { resolve: () => resolve(), reject };
	});
	const readyTimer = setTimeout(
		() => readyHandle.reject(new Error('the kernel did not answer within 120 seconds')),
		120_000
	);
	void ready.then(
		() => clearTimeout(readyTimer),
		() => clearTimeout(readyTimer)
	);

	const kernel: Kernel = { child, pending: new Map(), buffer: '', ready, stderr: '', busy: false };
	child.stdout.setEncoding('utf-8');
	child.stdout.on('data', (chunk: string) => receive(kernel, chunk, readyHandle));
	child.stderr.setEncoding('utf-8');
	child.stderr.on('data', (chunk: string) => {
		kernel.stderr = `${kernel.stderr}${chunk}`.slice(-4000);
	});
	child.on('error', (err) => {
		readyHandle.reject(new Error(`${pythonCommand()} could not be run: ${err.message}`));
	});
	child.on('exit', (code) => {
		const why = kernel.stderr.trim() || `the kernel stopped (exit ${code})`;
		readyHandle.reject(new Error(why));
		for (const [, waiting] of kernel.pending) waiting.resolve({ ok: false, error: why });
		kernel.pending.clear();
		if (kernels.get(notebook) === kernel) kernels.delete(notebook);
	});

	kernels.set(notebook, kernel);
	return kernel;
}

async function ask(notebook: string, request: Record<string, unknown>, timeoutMs: number): Promise<RunResult> {
	if (!existsSync(sidecarPath())) return { ok: false, error: 'scripts/kernel-sidecar.py is missing' };
	const kernel = kernelFor(notebook);
	try {
		await kernel.ready;
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
	const id = String(nextRequest++);
	return new Promise<RunResult>((resolve) => {
		const timer = setTimeout(() => {
			kernel.pending.delete(id);
			resolve({ ok: false, error: 'the kernel did not answer' });
		}, timeoutMs);
		kernel.pending.set(id, {
			resolve: (value) => {
				clearTimeout(timer);
				resolve(value);
			},
			reject: (err) => {
				clearTimeout(timer);
				resolve({ ok: false, error: err.message });
			}
		});
		kernel.child.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
	});
}

export async function runCode(notebook: string, code: string, seconds = 120): Promise<RunResult> {
	const kernel = kernelFor(notebook);
	kernel.busy = true;
	try {
		return await ask(notebook, { action: 'execute', code, timeout: seconds }, (seconds + 15) * 1000);
	} finally {
		kernel.busy = false;
	}
}

export function interruptKernel(notebook: string): Promise<RunResult> {
	if (!kernels.has(notebook)) return Promise.resolve({ ok: true });
	return ask(notebook, { action: 'interrupt' }, 30_000);
}

export function restartKernel(notebook: string): Promise<RunResult> {
	if (!kernels.has(notebook)) return Promise.resolve({ ok: true });
	return ask(notebook, { action: 'restart' }, 150_000);
}

export function kernelState(notebook: string): { running: boolean; busy: boolean } {
	const kernel = kernels.get(notebook);
	return { running: !!kernel && !kernel.child.killed, busy: !!kernel?.busy };
}

/** Stop one notebook's kernel, for when its file is renamed or deleted. */
export function stopKernel(notebook: string): void {
	const kernel = kernels.get(notebook);
	if (!kernel) return;
	kernels.delete(notebook);
	try {
		kernel.child.stdin.write(`${JSON.stringify({ id: 'bye', action: 'shutdown' })}
`);
	} catch {
		// already gone
	}
	setTimeout(() => kernel.child.kill(), 3000).unref?.();
}

export function stopAllKernels(): void {
	for (const [notebook, kernel] of kernels) {
		kernels.delete(notebook);
		try {
			kernel.child.stdin.write(`${JSON.stringify({ id: 'bye', action: 'shutdown' })}\n`);
		} catch {
			// already gone
		}
		setTimeout(() => kernel.child.kill(), 3000).unref?.();
	}
}
