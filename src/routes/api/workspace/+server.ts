import { json, error } from '@sveltejs/kit';
import { basename } from 'node:path';
import type { RequestHandler } from './$types';
import { hosted, recentWorkspaces, setWorkspace, workspaceRoot } from '$lib/server/config';
import { stopAllKernels } from '$lib/server/kernel';

/** The open folder, and the folders opened before. */
export const GET: RequestHandler = async () => {
	const root = workspaceRoot();
	return json({ root, name: basename(root) || root, recent: hosted() ? [] : recentWorkspaces(), hosted: hosted() });
};

/** Open a different folder. Body: { path }. Running kernels belong to the old folder, so they stop. */
export const POST: RequestHandler = async ({ request }) => {
	if (hosted()) throw error(403, 'The folder cannot be changed here.');
	const body = (await request.json()) as { path?: string };
	try {
		const before = workspaceRoot();
		const root = setWorkspace(String(body.path ?? ''));
		if (root !== before) stopAllKernels();
		return json({ root, name: basename(root) || root, recent: recentWorkspaces() });
	} catch (err) {
		throw error(400, (err as Error).message);
	}
};
