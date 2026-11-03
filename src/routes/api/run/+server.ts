import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { notebookPath } from '$lib/server/config';
import { saveOutputs } from '$lib/server/notebook-file';
import { runCode } from '$lib/server/kernel';

/**
 * Run one cell. The code comes from the page, because what is on screen is
 * what you mean to run. The outputs go into the file, where a notebook keeps them.
 * Body: { path, cellId, code }
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { path?: string; cellId?: string; code?: string };
	let path: string;
	try {
		path = notebookPath(String(body.path ?? ''));
	} catch (err) {
		throw error(400, (err as Error).message);
	}
	if (!body.cellId || typeof body.code !== 'string') throw error(400, 'cellId and code are required.');

	const result = await runCode(path, body.code);
	if (!result.ok) return json(result);
	const saved = saveOutputs(path, body.cellId, result.outputs ?? [], result.execution_count ?? null);
	return json({ ...result, saved });
};
