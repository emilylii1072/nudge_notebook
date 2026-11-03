/**
 * Reading and writing the .ipynb on disk. The file is the one copy of the
 * notebook: the page, the kernel and the agent all go through it.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	cellsFromNotebook,
	joinText,
	splitLines,
	type Cell,
	type CellOutput
} from '$lib/shared/notebook';

type RawNotebook = {
	cells?: Record<string, unknown>[];
	metadata?: Record<string, unknown>;
	nbformat?: number;
	nbformat_minor?: number;
	[key: string]: unknown;
};

const EMPTY: RawNotebook = {
	cells: [],
	metadata: {
		kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
		language_info: { name: 'python' }
	},
	nbformat: 4,
	nbformat_minor: 5
};

export function readRaw(path: string): RawNotebook {
	if (!existsSync(path)) return structuredClone(EMPTY);
	const text = readFileSync(path, 'utf-8').replace(/^﻿/, '');
	if (!text.trim()) return structuredClone(EMPTY);
	return JSON.parse(text) as RawNotebook;
}

function writeRaw(path: string, nb: RawNotebook): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, JSON.stringify(nb, null, 1) + '\n', 'utf-8');
	renameSync(temp, path);
}

export function readCells(path: string): Cell[] {
	return cellsFromNotebook(readRaw(path));
}

/**
 * Save the cells the page sends. Only id, type and source come from the page;
 * outputs and other cell data stay as the file has them, so a run that
 * finished while you were typing is not lost.
 */
export function saveCells(path: string, cells: Pick<Cell, 'id' | 'cell_type' | 'source'>[]): void {
	const nb = readRaw(path);
	const existing = new Map<string, Record<string, unknown>>();
	for (const c of nb.cells ?? []) if (typeof c.id === 'string') existing.set(c.id, c);

	nb.cells = cells.map((cell) => {
		const old = existing.get(cell.id);
		const keep = old && old.cell_type === cell.cell_type ? old : undefined;
		const base: Record<string, unknown> = {
			id: cell.id,
			cell_type: cell.cell_type,
			metadata: (keep?.metadata as object) ?? {},
			source: splitLines(cell.source)
		};
		if (cell.cell_type === 'code') {
			// Jupyter keeps old outputs when code changes, so they stay here too.
			base.outputs = keep?.outputs ?? [];
			base.execution_count = keep?.execution_count ?? null;
		}
		return base;
	});
	nb.nbformat = Math.max(nb.nbformat ?? 4, 4);
	nb.nbformat_minor = Math.max(nb.nbformat_minor ?? 5, 5);
	writeRaw(path, nb);
}

/** Put a run's outputs into one cell. Returns false when the cell is not in the file. */
export function saveOutputs(
	path: string,
	cellId: string,
	outputs: CellOutput[],
	executionCount: number | null
): boolean {
	const nb = readRaw(path);
	const cell = (nb.cells ?? []).find((c) => c.id === cellId);
	if (!cell || cell.cell_type !== 'code') return false;
	cell.outputs = outputs;
	cell.execution_count = executionCount;
	writeRaw(path, nb);
	return true;
}

export function cellSource(path: string, cellId: string): string | null {
	const cell = (readRaw(path).cells ?? []).find((c) => c.id === cellId);
	return cell ? joinText(cell.source) : null;
}
