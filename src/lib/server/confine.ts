/**
 * Keeping Claude inside the open folder.
 *
 * `checkTool` looks at one tool call before it runs and returns a reason to
 * refuse it, or null when it may go ahead. It runs as a hook, ahead of any
 * permission rule, so a rule in a project's settings cannot skip it.
 *
 * For the file tools (Read, Edit, Write, NotebookEdit, Glob, Grep) this is a
 * real boundary: the path is resolved, links are followed, and anything
 * outside the folder is refused.
 *
 * For Bash it is NOT a boundary. A shell command can build a path in many
 * ways, and the SDK's own sandbox cannot confine commands on Windows. The
 * check below refuses the obvious ways out (absolute paths elsewhere, `..`,
 * `~`, home-folder variables). It is a guard against mistakes, and the
 * person approving each command is the real gate. That is why shell commands
 * are off unless you turn them on.
 */
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const FILE_KEYS = ['file_path', 'notebook_path', 'path'];

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** True when this path, with links followed, is inside the folder. */
export function pathInside(root: string, name: string): boolean {
	const full = isAbsolute(name) ? resolve(name) : resolve(root, name);
	if (!isInside(root, full)) return false;
	let probe = full;
	while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
	if (!existsSync(probe)) return true;
	try {
		return isInside(realpathSync(root), realpathSync(probe));
	} catch {
		return false;
	}
}

const BASH_REASON =
	'Shell commands must stay inside the open folder. Use paths relative to it, and no "..", "~" or home-folder variables.';

/** The reason a shell command looks like it leaves the folder, or null. */
export function bashProblem(root: string, command: string): string | null {
	// Home folders and the variables that point at them.
	if (/(^|[\s"'=:])~([\\/\s"']|$)/.test(command)) return BASH_REASON;
	if (/\$\{?(HOME|USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP)\b/i.test(command)) return BASH_REASON;
	if (/%(USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|SYSTEMROOT|WINDIR)%/i.test(command)) return BASH_REASON;
	if (/\$env:/i.test(command)) return BASH_REASON;

	// A step up out of the current folder.
	if (/(^|[\\/\s"'=:(])\.\.([\\/\s"')]|$)/.test(command)) return BASH_REASON;

	// Any absolute path must be inside the folder.
	const absolute = command.match(/(?:[A-Za-z]:[\\/]|\\\\|(?<![\w.:\\/-])\/)[^\s"'`;|&<>()]*/g) ?? [];
	for (const raw of absolute) {
		if (raw === '/' || /^\/(dev\/null|dev\/stdout|dev\/stderr)$/.test(raw)) continue;
		// A lone "/x" is a command switch (cmd /c), not a path.
		if (/^\/[A-Za-z?]$/.test(raw)) continue;
		if (!pathInside(root, raw)) return BASH_REASON;
	}
	return null;
}

/** The reason to refuse one tool call, or null when it may go ahead. */
export function checkTool(root: string, toolName: string, input: unknown): string | null {
	const args = (input ?? {}) as Record<string, unknown>;

	for (const key of FILE_KEYS) {
		const value = args[key];
		if (typeof value === 'string' && value && !pathInside(root, value)) {
			return `${value} is outside the open folder. Work only with files inside it.`;
		}
	}

	if (toolName === 'Glob') {
		const pattern = typeof args.pattern === 'string' ? args.pattern : '';
		if (isAbsolute(pattern) || /(^|[\\/])\.\.([\\/]|$)/.test(pattern)) {
			return 'Glob patterns must stay inside the open folder.';
		}
	}

	if (toolName === 'Bash' && typeof args.command === 'string') return bashProblem(root, args.command);
	return null;
}
