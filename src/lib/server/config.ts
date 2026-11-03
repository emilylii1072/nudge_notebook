/**
 * Where the app works and which Python runs the cells.
 *
 * The workspace is the folder you opened. Everything the app and Claude read
 * or write must stay inside it, and `safePath` is the one place that checks.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Put the lines of a .env file into process.env, without overriding real variables. */
export function loadDotEnv(file = join(process.cwd(), '.env')): void {
	if (!existsSync(file)) return;
	for (const line of readFileSync(file, 'utf-8').split(/\r?\n/)) {
		if (line.trim().startsWith('#')) continue;
		const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (!match) continue;
		const value = match[2].replace(/^(['"])(.*)\1$/, '$2');
		if (process.env[match[1]] === undefined && value !== '') process.env[match[1]] = value;
	}
}

export function pythonCommand(): string {
	const configured = process.env.NUDGE_PYTHON?.trim();
	if (configured) return configured;
	return process.platform === 'win32' ? 'python' : 'python3';
}

/**
 * Hosted mode: the app runs inside one participant's container. The folder is
 * fixed, nobody can open another, and the engagement log goes to the gateway
 * instead of a file the participant's own code could edit.
 */
export const hosted = () => process.env.NUDGE_HOSTED === '1';

/** Where the engagement log and the app's own state are kept. */
export function dataDir(): string {
	const dir = hosted() ? join(tmpdir(), 'nudge-data') : join(process.cwd(), 'data');
	mkdirSync(dir, { recursive: true });
	return dir;
}

// ---- The open folder ----

interface WorkspaceState {
	current?: string;
	recent: string[];
}

const stateFile = () => join(dataDir(), 'workspace.json');

function readState(): WorkspaceState {
	try {
		const parsed = JSON.parse(readFileSync(stateFile(), 'utf-8')) as Partial<WorkspaceState>;
		return { current: parsed.current, recent: Array.isArray(parsed.recent) ? parsed.recent : [] };
	} catch {
		return { recent: [] };
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

let current: string | null = null;

/** The folder that is open: the one you last chose, else NUDGE_WORKSPACE, else the test folder. */
export function workspaceRoot(): string {
	if (hosted()) {
		const fixed = process.env.NUDGE_WORKSPACE?.trim();
		if (!fixed) throw new Error('NUDGE_WORKSPACE must be set in hosted mode.');
		return resolve(fixed);
	}
	if (current && isDirectory(current)) return current;
	const saved = readState().current;
	const candidates = [saved, process.env.NUDGE_WORKSPACE?.trim(), join(process.cwd(), '..', 'nudge-test-workspace')];
	for (const candidate of candidates) {
		if (candidate && isDirectory(resolve(candidate))) {
			current = resolve(candidate);
			return current;
		}
	}
	// Nothing exists yet: make the default so the app has somewhere to work.
	current = resolve(join(process.cwd(), '..', 'nudge-test-workspace'));
	mkdirSync(current, { recursive: true });
	return current;
}

/** Open a different folder. Throws if it is not a folder. */
export function setWorkspace(path: string): string {
	if (hosted()) throw new Error('The folder cannot be changed here.');
	const full = resolve(path);
	if (!isDirectory(full)) throw new Error('That is not a folder.');
	current = full;
	const state = readState();
	state.current = full;
	state.recent = [full, ...state.recent.filter((p) => p !== full)].slice(0, 8);
	writeFileSync(stateFile(), JSON.stringify(state, null, 1), 'utf-8');
	return full;
}

export function recentWorkspaces(): string[] {
	return readState().recent.filter(isDirectory);
}

/** Folders the file list and the watcher leave out. */
export const IGNORED_DIRS = new Set([
	'.git',
	'node_modules',
	'.svelte-kit',
	'__pycache__',
	'.ipynb_checkpoints',
	'.venv',
	'venv'
]);

/** Whether one path (workspace-relative) is inside or on `root`, by real location. */
function inside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * A path from the page or from Claude, checked: it must be inside the open
 * folder, including after symbolic links are followed. Returns the full path.
 */
export function safePath(name: string, options: { allowRoot?: boolean } = {}): string {
	const root = workspaceRoot();
	const full = isAbsolute(name) ? resolve(name) : resolve(root, name);
	const rel = relative(root, full);
	if (rel.split(sep).includes('..') || isAbsolute(rel)) throw new Error('That path is outside the open folder.');
	if (rel === '' && !options.allowRoot) throw new Error('That is the open folder itself.');

	// Follow links on the part that exists, so a link cannot lead out.
	let probe = full;
	while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
	if (existsSync(probe) && !inside(realpathSync(root), realpathSync(probe))) {
		throw new Error('That path leads outside the open folder.');
	}
	return full;
}

/** A notebook path from the page, checked: inside the folder and an .ipynb. */
export function notebookPath(name: string): string {
	const full = safePath(name);
	if (!full.toLowerCase().endsWith('.ipynb')) throw new Error('Only .ipynb files can be opened as notebooks.');
	return full;
}

/** A path as the page shows it: relative to the open folder, with forward slashes. */
export function relPath(full: string): string {
	return relative(workspaceRoot(), full).split(sep).join('/');
}
