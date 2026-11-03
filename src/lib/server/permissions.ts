/**
 * Asking you before Claude acts, the way Claude Code does in a terminal.
 *
 * When a tool call needs your approval the chat route streams a request to
 * the page and waits here for your answer, which arrives through
 * POST /api/permission. A request that is never answered (the page closed,
 * or you pressed Stop) is refused.
 */

export type Decision = { allow: true; remember: boolean } | { allow: false };

const pending = new Map<string, (decision: Decision) => void>();

/** Wait for your answer to one request. Resolves to a refusal if aborted. */
export function awaitDecision(requestId: string, signal: AbortSignal): Promise<Decision> {
	return new Promise<Decision>((resolve) => {
		const finish = (decision: Decision) => {
			pending.delete(requestId);
			signal.removeEventListener('abort', onAbort);
			resolve(decision);
		};
		const onAbort = () => finish({ allow: false });
		if (signal.aborted) return finish({ allow: false });
		signal.addEventListener('abort', onAbort);
		pending.set(requestId, finish);
	});
}

/** Deliver your answer. Returns false when no request is waiting under that id. */
export function answerDecision(requestId: string, decision: Decision): boolean {
	const waiting = pending.get(requestId);
	if (!waiting) return false;
	waiting(decision);
	return true;
}

/** Tools you allowed "for this conversation", by conversation. */
const remembered = new Map<string, Set<string>>();

export function isRemembered(conversation: string, tool: string): boolean {
	return remembered.get(conversation)?.has(tool) ?? false;
}

export function remember(conversation: string, tool: string): void {
	if (!remembered.has(conversation)) remembered.set(conversation, new Set());
	remembered.get(conversation)!.add(tool);
}

/** Tools that change files. "Auto-accept edits" covers these and nothing else. */
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
