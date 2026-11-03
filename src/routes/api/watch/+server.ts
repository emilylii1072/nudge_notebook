import { watch } from 'node:fs';
import { relative, sep } from 'node:path';
import type { RequestHandler } from './$types';
import { IGNORED_DIRS, workspaceRoot } from '$lib/server/config';

/**
 * A stream that says when something in the open folder changes on disk,
 * whether Claude, a cell run, an import or another program did it. The page
 * then refreshes the file list and any file it has open.
 *
 * Each message is { type: 'changed', paths: [...] } with the changed files
 * as paths relative to the folder, batched over a short moment.
 */
export const GET: RequestHandler = async ({ request }) => {
	const root = workspaceRoot();
	const encoder = new TextEncoder();

	let cleanup = () => {};
	const stream = new ReadableStream({
		start(controller) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const changed = new Set<string>();

			const watcher = watch(root, { recursive: true }, (_event, name) => {
				if (!name) return;
				const rel = relative(root, `${root}${sep}${name}`);
				const parts = rel.split(sep);
				if (parts.some((part) => IGNORED_DIRS.has(part))) return;
				// Our own temp files are written then renamed; the rename is the change.
				if (rel.endsWith('.tmp')) return;
				changed.add(parts.join('/'));
				clearTimeout(timer);
				timer = setTimeout(() => {
					const paths = [...changed];
					changed.clear();
					try {
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'changed', paths })}\n\n`));
					} catch {
						cleanup();
					}
				}, 200);
			});
			watcher.on('error', () => cleanup());

			const ping = setInterval(() => {
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					cleanup();
				}
			}, 20_000);

			cleanup = () => {
				clearTimeout(timer);
				clearInterval(ping);
				watcher.close();
			};
			request.signal.addEventListener('abort', () => {
				cleanup();
				try {
					controller.close();
				} catch {
					// already closed
				}
			});
			controller.enqueue(encoder.encode('data: {"type":"ready"}\n\n'));
		},
		cancel() {
			cleanup();
		}
	});
	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' }
	});
};
