/**
 * File operations for the open folder. Every path goes through `safePath`.
 */
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { IGNORED_DIRS, relPath, safePath, workspaceRoot } from './config';

export interface TreeEntry {
	path: string;
	type: 'file' | 'dir';
	size?: number;
}

const MAX_ENTRIES = 5000;
const MAX_DEPTH = 8;
/** Larger text files are not opened in the editor. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml'
};

export function imageType(path: string): string | null {
	return IMAGE_TYPES[extname(path).toLowerCase()] ?? null;
}

/** Every file and folder in the open folder, folders first within each folder. */
export function listTree(): { entries: TreeEntry[]; truncated: boolean } {
	const root = workspaceRoot();
	const entries: TreeEntry[] = [];
	let truncated = false;

	const walk = (dir: string, depth: number) => {
		if (depth > MAX_DEPTH || truncated) return;
		let items;
		try {
			items = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
		for (const item of items) {
			if (entries.length >= MAX_ENTRIES) {
				truncated = true;
				return;
			}
			if (item.isDirectory()) {
				if (IGNORED_DIRS.has(item.name)) continue;
				const full = join(dir, item.name);
				entries.push({ path: relPath(full), type: 'dir' });
				walk(full, depth + 1);
			} else if (item.isFile()) {
				const full = join(dir, item.name);
				let size = 0;
				try {
					size = statSync(full).size;
				} catch {
					// vanished while listing
				}
				entries.push({ path: relPath(full), type: 'file', size });
			}
		}
	};
	walk(root, 0);
	return { entries, truncated };
}

export type FileContent =
	| { kind: 'text'; content: string }
	| { kind: 'image'; type: string }
	| { kind: 'binary' }
	| { kind: 'too-large'; size: number };

/** What a file is and, for text, what it says. */
export function readFileContent(name: string): FileContent {
	const full = safePath(name);
	const stat = statSync(full);
	if (!stat.isFile()) throw new Error('That is not a file.');
	const image = imageType(full);
	if (image) return { kind: 'image', type: image };
	if (stat.size > MAX_TEXT_BYTES) return { kind: 'too-large', size: stat.size };
	const buffer = readFileSync(full);
	if (buffer.subarray(0, 8000).includes(0)) return { kind: 'binary' };
	return { kind: 'text', content: buffer.toString('utf-8').replace(/^﻿/, '') };
}

export function writeTextFile(name: string, content: string): void {
	const full = safePath(name);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content, 'utf-8');
}

function emptyContent(name: string): string {
	if (name.toLowerCase().endsWith('.ipynb')) {
		return (
			JSON.stringify(
				{
					cells: [],
					metadata: {
						kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
						language_info: { name: 'python' }
					},
					nbformat: 4,
					nbformat_minor: 5
				},
				null,
				1
			) + '\n'
		);
	}
	return '';
}

/** A new empty file. A new .ipynb is a valid empty notebook. Never overwrites. */
export function createFile(name: string): string {
	const full = safePath(name);
	if (existsSync(full)) throw new Error(`${basename(full)} already exists.`);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, emptyContent(name), 'utf-8');
	return relPath(full);
}

export function createFolder(name: string): string {
	const full = safePath(name);
	if (existsSync(full)) throw new Error(`${basename(full)} already exists.`);
	mkdirSync(full, { recursive: true });
	return relPath(full);
}

export function renameEntry(from: string, to: string): string {
	const source = safePath(from);
	const target = safePath(to);
	if (!existsSync(source)) throw new Error('That file no longer exists.');
	if (existsSync(target)) throw new Error(`${basename(target)} already exists.`);
	mkdirSync(dirname(target), { recursive: true });
	renameSync(source, target);
	return relPath(target);
}

/** Permanently delete a file or a folder with everything in it. */
export function deleteEntry(name: string): void {
	const full = safePath(name);
	if (!existsSync(full)) return;
	rmSync(full, { recursive: true, force: true });
}

/** Where an uploaded file would go, and whether that spot is taken. */
export function uploadTarget(dir: string, fileName: string): { full: string; exists: boolean; rel: string } {
	// A file name carries no folders; it cannot step out of the chosen one.
	const clean = basename(fileName.replace(/\\/g, '/'));
	if (!clean || clean === '.' || clean === '..') throw new Error('That file has no usable name.');
	const full = safePath(join(dir || '.', clean));
	return { full, exists: existsSync(full), rel: relPath(full) };
}

export function writeBinary(full: string, data: Uint8Array): void {
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, data);
}
