/**
 * /api/chat: send one message to Claude and stream back what it does.
 *
 * Claude runs through the Agent SDK in the open folder, like Claude Code in
 * a terminal: it reads, searches, edits, and (if you turn shell commands on)
 * runs commands. Its tools are the same ones Claude Code has, plus
 * `run_cell`, which runs a notebook cell in the notebook's live kernel.
 *
 * Three things keep it in check:
 *  - A hook refuses any tool call that reaches outside the open folder
 *    (see `confine.ts`). It runs ahead of every permission rule.
 *  - Anything that changes files, runs code, or reaches the web needs your
 *    approval, asked in the chat, unless the mode is "auto-accept edits"
 *    (which covers file edits only).
 *  - Shell commands are off unless the request turns them on.
 *
 * Body: { message, activeFile?, sessionId?, conversation, mode, bash }
 * Stream: lines of `data: <json>`, each one of
 *   { type: 'text', text }
 *   { type: 'tool', id, name, input }
 *   { type: 'permission', requestId, toolUseId, name }
 *   { type: 'tool_result', id, text, isError }
 *   { type: 'done', sessionId }
 *   { type: 'error', message }
 */
import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { hosted, notebookPath, safePath, workspaceRoot } from '$lib/server/config';
import { checkTool } from '$lib/server/confine';
import { cellSource, readCells, saveOutputs } from '$lib/server/notebook-file';
import { runCode } from '$lib/server/kernel';
import { awaitDecision, EDIT_TOOLS, isRemembered, remember } from '$lib/server/permissions';
import { outputText } from '$lib/shared/notebook';

const MAX_RESULT_CHARS = 6000;
const MODEL = process.env.NUDGE_AGENT_MODEL || undefined;

type Mode = 'ask' | 'acceptEdits' | 'plan';

function systemAppend(activeFile: string, bash: boolean): string {
	return `
You are working inside a notebook editor, in the folder the person opened. Everything you read or write must be inside that folder.

- The person sees the notebook and files beside this chat, and sees your edits appear as you make them. They may be asked to approve each change.
- Edit notebooks with NotebookEdit (use the cell ids you get from Read). Run code cells with the run_cell tool to check your work and read the outputs.
${bash ? '- You may run shell commands, but only with paths inside the folder.' : '- Shell commands are not available in this session.'}
${activeFile ? `- The person currently has ${activeFile} open.` : ''}
- When you finish, report back briefly in plain words: which files or cells you changed or added, what you changed, and what running them showed. Do not paste whole files back into the chat.
`;
}

function clip(text: string): string {
	return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n... (truncated)` : text;
}

function runCellServer(activeFile: string) {
	return createSdkMcpServer({
		name: 'nb',
		version: '1.0.0',
		tools: [
			tool(
				'run_cell',
				'Run one code cell of a notebook in its live kernel and return its outputs. The outputs are also saved into the notebook, so the person sees them. The notebook defaults to the one the person has open.',
				{
					cell_id: z.string().describe('The id of the code cell to run.'),
					notebook: z.string().optional().describe('Path of the notebook, relative to the open folder.')
				},
				async ({ cell_id, notebook }) => {
					const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });
					const name = notebook || (activeFile.toLowerCase().endsWith('.ipynb') ? activeFile : '');
					if (!name) return fail('Say which notebook, with the notebook argument.');
					let path: string;
					try {
						path = notebookPath(name);
					} catch (err) {
						return fail((err as Error).message);
					}
					const source = cellSource(path, cell_id);
					if (source === null) {
						const ids = readCells(path).map((c) => c.id).join(', ');
						return fail(`No cell has id ${cell_id}. Cells: ${ids}`);
					}
					const result = await runCode(path, source);
					if (!result.ok) return fail(`The kernel failed: ${result.error}`);
					saveOutputs(path, cell_id, result.outputs ?? [], result.execution_count ?? null);
					const text = (result.outputs ?? []).map(outputText).join('\n').trim() || '(no output)';
					return { content: [{ type: 'text' as const, text: clip(text) }], isError: result.status === 'error' };
				}
			)
		]
	});
}

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		message?: string;
		activeFile?: string;
		sessionId?: string;
		conversation?: string;
		mode?: Mode;
		bash?: boolean;
	};
	const message = (body.message ?? '').trim();
	if (!message) throw error(400, 'message is required.');
	const mode: Mode = body.mode === 'acceptEdits' || body.mode === 'plan' ? body.mode : 'ask';
	// Hosted, participants never get a shell, whatever the page sends.
	const bash = body.bash === true && !hosted();
	const conversation = body.conversation || 'default';

	let activeFile = '';
	if (body.activeFile) {
		try {
			safePath(body.activeFile);
			activeFile = body.activeFile;
		} catch {
			// not a file in the folder; ignore it
		}
	}

	const root = workspaceRoot();
	const encoder = new TextEncoder();
	const abort = new AbortController();
	request.signal.addEventListener('abort', () => abort.abort());

	// Runs before any permission rule, so no setting can skip it.
	const guard: HookCallback = async (input) => {
		if (input.hook_event_name !== 'PreToolUse') return {};
		const reason = checkTool(root, input.tool_name, input.tool_input);
		if (!reason) return {};
		return {
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: reason
			}
		};
	};

	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: Record<string, unknown>) => {
				try {
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
				} catch {
					// the page went away
				}
			};
			let sessionId = body.sessionId ?? '';
			try {
				const run = query({
					prompt: message,
					options: {
						cwd: root,
						abortController: abort,
						model: MODEL,
						systemPrompt: { type: 'preset', preset: 'claude_code', append: systemAppend(activeFile, bash) },
						// Reading and searching never ask. Everything else is asked about below.
						allowedTools: ['Read', 'Glob', 'Grep'],
						disallowedTools: [
							'AskUserQuestion',
							...(bash ? [] : ['Bash', 'BashOutput', 'KillShell']),
							...(hosted() ? ['WebFetch', 'WebSearch'] : [])
						],
						permissionMode: mode === 'plan' ? 'plan' : 'default',
						mcpServers: { nb: runCellServer(activeFile) },
						hooks: { PreToolUse: [{ hooks: [guard] }] },
						// CLAUDE.md and commands from this folder, not the person's own global setup.
						settingSources: ['project', 'local'],
						canUseTool: async (toolName, input, options) => {
							if (mode === 'acceptEdits' && EDIT_TOOLS.has(toolName)) {
								return { behavior: 'allow', updatedInput: input };
							}
							if (isRemembered(conversation, toolName)) return { behavior: 'allow', updatedInput: input };

							const requestId = randomUUID();
							send({ type: 'permission', requestId, toolUseId: options.toolUseID, name: toolName });
							const decision = await awaitDecision(requestId, options.signal);
							if (!decision.allow) {
								return { behavior: 'deny', message: 'The person declined this.' };
							}
							if (decision.remember) remember(conversation, toolName);
							return { behavior: 'allow', updatedInput: input };
						},
						...(sessionId ? { resume: sessionId } : {})
					}
				});

				for await (const msg of run) {
					if ('session_id' in msg && typeof msg.session_id === 'string') sessionId = msg.session_id;
					if (msg.type === 'assistant') {
						for (const block of msg.message.content) {
							if (block.type === 'text' && block.text.trim()) send({ type: 'text', text: block.text });
							else if (block.type === 'tool_use') {
								send({ type: 'tool', id: block.id, name: block.name, input: block.input });
							}
						}
					} else if (msg.type === 'user' && Array.isArray(msg.message.content)) {
						for (const block of msg.message.content) {
							if (typeof block === 'object' && block.type === 'tool_result') {
								const raw = block.content;
								const text = Array.isArray(raw)
									? raw.map((part) => (part.type === 'text' ? part.text : '')).join('')
									: String(raw ?? '');
								send({ type: 'tool_result', id: block.tool_use_id, text: clip(text), isError: block.is_error === true });
							}
						}
					} else if (msg.type === 'result' && msg.subtype !== 'success') {
						send({ type: 'error', message: `The agent stopped: ${msg.subtype}` });
					}
				}
				send({ type: 'done', sessionId });
			} catch (err) {
				if (!abort.signal.aborted) send({ type: 'error', message: (err as Error).message });
			} finally {
				try {
					controller.close();
				} catch {
					// already closed
				}
			}
		},
		cancel() {
			abort.abort();
		}
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
	});
};
