import { describe, expect, it } from 'vitest';
import { diffLines } from './diff';

describe('diffLines', () => {
	it('marks added, removed and unchanged lines', () => {
		expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
			{ kind: 'same', text: 'a' },
			{ kind: 'del', text: 'b' },
			{ kind: 'add', text: 'x' },
			{ kind: 'same', text: 'c' }
		]);
	});

	it('treats an empty before as all additions', () => {
		expect(diffLines('', 'a\nb')).toEqual([
			{ kind: 'add', text: 'a' },
			{ kind: 'add', text: 'b' }
		]);
	});

	it('treats an empty after as all removals', () => {
		expect(diffLines('a', '')).toEqual([{ kind: 'del', text: 'a' }]);
	});
});
