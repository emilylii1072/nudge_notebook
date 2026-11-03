import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uploadTarget, writeBinary } from '$lib/server/files';

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Import files into a folder. Form fields: dir (a folder in the open folder,
 * empty for the top), overwrite ("true" to replace files that exist), and
 * one or more `files`. If any file would replace another and overwrite is
 * not set, nothing is written and the reply lists the clashes, so the page
 * can ask first.
 */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const dir = String(form.get('dir') ?? '');
	const overwrite = form.get('overwrite') === 'true';
	const files = form.getAll('files').filter((f): f is File => f instanceof File);
	if (files.length === 0) throw error(400, 'No files were sent.');

	try {
		const targets = files.map((file) => ({ file, ...uploadTarget(dir, file.name) }));
		const clashes = targets.filter((t) => t.exists).map((t) => t.rel);
		if (clashes.length > 0 && !overwrite) return json({ ok: false, conflicts: clashes }, { status: 409 });
		const total = targets.reduce((sum, t) => sum + t.file.size, 0);
		if (total > MAX_UPLOAD_BYTES) throw new Error('That is more than 100 MB at once.');
		for (const t of targets) writeBinary(t.full, new Uint8Array(await t.file.arrayBuffer()));
		return json({ ok: true, paths: targets.map((t) => t.rel) });
	} catch (err) {
		throw error(400, (err as Error).message);
	}
};
