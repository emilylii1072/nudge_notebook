import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { notebookPath } from '$lib/server/config';
import { interruptKernel, restartKernel } from '$lib/server/kernel';

/** Interrupt the running cell, or restart the kernel. Body: { path, action } */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { path?: string; action?: string };
	let path: string;
	try {
		path = notebookPath(String(body.path ?? ''));
	} catch (err) {
		throw error(400, (err as Error).message);
	}
	if (body.action === 'interrupt') return json(await interruptKernel(path));
	if (body.action === 'restart') return json(await restartKernel(path));
	throw error(400, 'action must be interrupt or restart.');
};
