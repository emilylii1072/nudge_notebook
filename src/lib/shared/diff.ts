/** A line diff for showing what the agent changed in a cell. */

export interface DiffLine {
	kind: 'same' | 'add' | 'del';
	text: string;
}

/** Cells are short, but a huge one must not freeze the page. */
const MAX_LINES = 600;

export function diffLines(before: string, after: string): DiffLine[] {
	const a = before === '' ? [] : before.split('\n');
	const b = after === '' ? [] : after.split('\n');
	if (a.length > MAX_LINES || b.length > MAX_LINES) {
		return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))];
	}

	// Longest common subsequence of lines.
	const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
		}
	}

	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			out.push({ kind: 'same', text: a[i] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
			out.push({ kind: 'del', text: a[i++] });
		} else {
			out.push({ kind: 'add', text: b[j++] });
		}
	}
	while (i < a.length) out.push({ kind: 'del', text: a[i++] });
	while (j < b.length) out.push({ kind: 'add', text: b[j++] });
	return out;
}
