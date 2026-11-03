import { json, error } from '@sveltejs/kit';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { RequestHandler } from './$types';
import { hosted, workspaceRoot } from '$lib/server/config';

/**
 * The folders inside one folder, for the "Open folder" picker. This is the
 * one place that looks outside the open folder, and it lists folder names
 * only: no file is read. With no path it starts at the open folder, and
 * `path=` with nothing after it on Windows lists the drives.
 */
export const GET: RequestHandler = async ({ url }) => {
	if (hosted()) throw error(403, 'Browsing folders is not available here.');
	const requested = url.searchParams.get('path');

	if (requested === '' && process.platform === 'win32') {
		const drives = [];
		for (let code = 65; code <= 90; code++) {
			const letter = `${String.fromCharCode(code)}:\\`;
			if (existsSync(letter)) drives.push({ name: letter, path: letter });
		}
		return json({ path: '', parent: null, dirs: drives });
	}

	const path = resolve(requested || workspaceRoot());
	let items;
	try {
		items = readdirSync(path, { withFileTypes: true });
	} catch {
		throw error(400, 'That folder cannot be read.');
	}
	const dirs = items
		.filter((item) => item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules')
		.map((item) => ({ name: item.name, path: join(path, item.name) }))
		.sort((a, b) => a.name.localeCompare(b.name));
	const parent = dirname(path);
	return json({ path, parent: parent === path ? (process.platform === 'win32' ? '' : null) : parent, dirs });
};
