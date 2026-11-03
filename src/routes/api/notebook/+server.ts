/**
 * /api/notebook
 *
 * GET ?path=<name>              → the notebook's cells and its kernel state.
 * PUT { path, cells }           → save the cells' text and order. Outputs are
 *                                 kept as the file has them.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { notebookPath } from '$lib/server/config';
import { readCells, saveCells } from '$lib/server/notebook-file';
import { kernelState } from '$lib/server/kernel';
import type { Cell } from '$lib/shared/notebook';

function pathFrom(name: unknown): string {
	try {
		return notebookPath(String(name ?? ''));
	} catch (err) {
		throw error(400, (err as Error).message);
	}
}

export const GET: RequestHandler = async ({ url }) => {
	const path = pathFrom(url.searchParams.get('path'));
	return json({ cells: readCells(path), kernel: kernelState(path) });
};

export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { path?: string; cells?: Cell[] };
	const path = pathFrom(body.path);
	if (!Array.isArray(body.cells)) throw error(400, 'cells must be a list.');
	saveCells(
		path,
		body.cells.map((c) => ({
			id: String(c.id),
			cell_type: c.cell_type === 'markdown' || c.cell_type === 'raw' ? c.cell_type : 'code',
			source: String(c.source ?? '')
		}))
	);
	return json({ ok: true });
};
