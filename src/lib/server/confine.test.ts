import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bashProblem, checkTool, pathInside } from './confine';

// A real folder, because paths are checked with links followed.
const base = mkdtempSync(join(tmpdir(), 'confine-'));
const root = join(realpathSync(base), 'workspace');
const outside = resolve(root, '..', 'elsewhere', 'secret.txt');
mkdirSync(root, { recursive: true });
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('pathInside', () => {
	it('accepts the folder and paths inside it', () => {
		expect(pathInside(root, 'a.py')).toBe(true);
		expect(pathInside(root, 'sub/dir/a.py')).toBe(true);
		expect(pathInside(root, join(root, 'a.py'))).toBe(true);
	});

	it('refuses paths that climb out or sit elsewhere', () => {
		expect(pathInside(root, '../a.py')).toBe(false);
		expect(pathInside(root, 'sub/../../a.py')).toBe(false);
		expect(pathInside(root, outside)).toBe(false);
	});

	it('does not mistake a sibling with the same prefix for the folder', () => {
		expect(pathInside(root, `${root}-other/a.py`)).toBe(false);
	});
});

describe('checkTool: file tools', () => {
	it('lets file tools work inside the folder', () => {
		expect(checkTool(root, 'Edit', { file_path: join(root, 'a.py') })).toBeNull();
		expect(checkTool(root, 'NotebookEdit', { notebook_path: 'nb.ipynb' })).toBeNull();
		expect(checkTool(root, 'Grep', { pattern: 'x' })).toBeNull();
	});

	it('refuses file tools pointed outside', () => {
		expect(checkTool(root, 'Read', { file_path: outside })).toMatch(/outside/);
		expect(checkTool(root, 'Write', { file_path: '../x.txt' })).toMatch(/outside/);
		expect(checkTool(root, 'Grep', { pattern: 'x', path: outside })).toMatch(/outside/);
	});

	it('refuses glob patterns that leave the folder', () => {
		expect(checkTool(root, 'Glob', { pattern: '../**/*.py' })).toMatch(/Glob/);
		expect(checkTool(root, 'Glob', { pattern: '**/*.py' })).toBeNull();
	});
});

describe('bashProblem', () => {
	it('lets ordinary commands through', () => {
		expect(bashProblem(root, 'python script.py --n 3')).toBeNull();
		expect(bashProblem(root, 'ls -la sub && cat data.csv | head')).toBeNull();
		expect(bashProblem(root, 'echo hi > /dev/null')).toBeNull();
		expect(bashProblem(root, 'git status')).toBeNull();
		expect(bashProblem(root, `cat ${join(root, 'a.txt')}`)).toBeNull();
	});

	it('refuses ways out of the folder', () => {
		expect(bashProblem(root, 'cat ../secret.txt')).not.toBeNull();
		expect(bashProblem(root, 'cd .. && ls')).not.toBeNull();
		expect(bashProblem(root, 'cat ~/.ssh/id_rsa')).not.toBeNull();
		expect(bashProblem(root, 'cat $HOME/x')).not.toBeNull();
		expect(bashProblem(root, 'type %USERPROFILE%\\x')).not.toBeNull();
		expect(bashProblem(root, 'cat /etc/passwd')).not.toBeNull();
		expect(bashProblem(root, 'type C:\\Windows\\win.ini')).not.toBeNull();
		expect(bashProblem(root, `cat ${outside}`)).not.toBeNull();
	});

	it('is applied to the Bash tool only', () => {
		expect(checkTool(root, 'Bash', { command: 'cat ../x' })).not.toBeNull();
		expect(checkTool(root, 'Other', { command: 'cat ../x' })).toBeNull();
	});
});
