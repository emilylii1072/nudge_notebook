import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { workspaceRoot } from '$lib/server/config';
import { createFile, createFolder, deleteEntry, listTree, renameEntry } from '$lib/server/files';
import { stopKernel } from '$lib/server/kernel';
import { safePath } from '$lib/server/config';

/** The files and folders in the open folder. */
export const GET: RequestHandler = async () => {
	return json({ root: workspaceRoot(), ...listTree() });
};

/**
 * Change the file tree. Body: { op, path, to? } where op is one of
 * create-file, create-folder, rename or delete. Delete is permanent, so the
 * page asks you first.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { op?: string; path?: string; to?: string };
	const path = String(body.path ?? '');
	try {
		switch (body.op) {
			case 'create-file':
				return json({ path: createFile(path) });
			case 'create-folder':
				return json({ path: createFolder(path) });
			case 'rename': {
				const from = safePath(path);
				stopKernel(from);
				return json({ path: renameEntry(path, String(body.to ?? '')) });
			}
			case 'delete': {
				stopKernel(safePath(path));
				deleteEntry(path);
				return json({ ok: true });
			}
			default:
				throw new Error('op must be create-file, create-folder, rename or delete.');
		}
	} catch (err) {
		throw error(400, (err as Error).message);
	}
};
