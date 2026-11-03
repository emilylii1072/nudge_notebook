/**
 * The notebook as the page works with it. The file on disk is an ordinary
 * .ipynb; these types are the part of it the editor shows and changes.
 */

export type CellType = 'code' | 'markdown' | 'raw';

/** An output as nbformat stores it. */
export type CellOutput = Record<string, unknown>;

export interface Cell {
	id: string;
	cell_type: CellType;
	/** The cell's text as one string. The file stores a list of lines. */
	source: string;
	outputs: CellOutput[];
	execution_count: number | null;
}

/** nbformat stores text as a string or a list of strings. */
export function joinText(value: unknown): string {
	if (Array.isArray(value)) return value.map(String).join('');
	return typeof value === 'string' ? value : '';
}

/** Split text into the list of lines nbformat stores. */
export function splitLines(text: string): string[] {
	return text.split(/(?<=\n)/);
}

export function newCellId(): string {
	return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

export function emptyCell(cell_type: CellType = 'code'): Cell {
	return { id: newCellId(), cell_type, source: '', outputs: [], execution_count: null };
}

/** Read the cells out of a parsed .ipynb. Cells without an id get one. */
export function cellsFromNotebook(nb: { cells?: unknown }): Cell[] {
	const raw = Array.isArray(nb.cells) ? (nb.cells as Record<string, unknown>[]) : [];
	return raw.map((c) => {
		const type: CellType = c.cell_type === 'markdown' || c.cell_type === 'raw' ? c.cell_type : 'code';
		return {
			id: typeof c.id === 'string' && c.id ? c.id : newCellId(),
			cell_type: type,
			source: joinText(c.source),
			outputs: type === 'code' && Array.isArray(c.outputs) ? (c.outputs as CellOutput[]) : [],
			execution_count: type === 'code' && typeof c.execution_count === 'number' ? c.execution_count : null
		};
	});
}

/** The text of one output, for showing in the page or telling the agent. */
export function outputText(out: CellOutput): string {
	const kind = out.output_type;
	if (kind === 'stream') return joinText(out.text);
	if (kind === 'error') {
		const trace = Array.isArray(out.traceback) ? out.traceback.map(String).join('\n') : '';
		// Strip terminal colour codes; the page shows plain text.
		return (trace || `${out.ename}: ${out.evalue}`).replace(/\u001b\[[0-9;]*m/g, '');
	}
	const data = (out.data ?? {}) as Record<string, unknown>;
	return joinText(data['text/plain']);
}
