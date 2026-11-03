import { json, error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { RequestHandler } from './$types';
import { safePath } from '$lib/server/config';
import { imageType, readFileContent, writeTextFile } from '$lib/server/files';

/**
 * GET ?path=<file>          → { kind: 'text', content } or another kind for
 *                             images, binary files and files too large to edit.
 * GET ?path=<file>&raw=1    → the file itself, for showing an image.
 */
export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path') ?? '';
	try {
		if (url.searchParams.get('raw') === '1') {
			const full = safePath(path);
			const type = imageType(full);
			if (!type) throw new Error('Only images can be shown.');
			return new Response(new Uint8Array(readFileSync(full)), { headers: { 'Content-Type': type } });
		}
		return json(readFileContent(path));
	} catch (err) {
		throw error(400, (err as Error).message);
	}
};

/** Save a text file. Body: { path, content } */
export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { path?: string; content?: string };
	if (typeof body.content !== 'string') throw error(400, 'content must be text.');
	try {
		writeTextFile(String(body.path ?? ''), body.content);
		return json({ ok: true });
	} catch (err) {
		throw error(400, (err as Error).message);
	}
};
