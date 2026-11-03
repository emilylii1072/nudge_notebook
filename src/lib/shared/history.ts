/**
 * What the scorer is shown besides the new message: the last few exchanges.
 * This is the same as the nudge plugin (nudge-hook/hooks/register.ts), so the
 * two score a message from the same input.
 */

export interface Exchange {
	user: string;
	/** The agent's words after this message. Empty while it is still working, or when it said nothing. */
	assistant: string;
}

export interface HistoryTurn {
	role: 'user' | 'assistant';
	text: string;
}

/** How many exchanges the scorer sees. */
export const WINDOW = 5;
/** The latest reply is cut to its last 4000 characters; older ones to 1500. */
export const MAX_REPLY_CHARS = 4000;
export const OLD_REPLY_CHARS = 1500;

/** The last WINDOW exchanges as the scorer reads them: the latest reply in full, older ones cut. */
export function historyOf(exchanges: readonly Exchange[]): HistoryTurn[] {
	const recent = exchanges.slice(-WINDOW);
	return recent.flatMap((x, i) => {
		const cap = i === recent.length - 1 ? MAX_REPLY_CHARS : OLD_REPLY_CHARS;
		const turns: HistoryTurn[] = [{ role: 'user', text: x.user }];
		if (x.assistant) turns.push({ role: 'assistant', text: x.assistant.slice(-cap) });
		return turns;
	});
}

function fiveWordRuns(text: string): string[] {
	const words = text
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.split(/\s+/)
		.filter(Boolean);
	const runs: string[] = [];
	for (let i = 0; i + 5 <= words.length; i++) runs.push(words.slice(i, i + 5).join(' '));
	return runs;
}

/** True when most of the prompt is text the agent just said (a pasted-back answer). */
export function echoesReply(prompt: string, reply: string): boolean {
	const promptRuns = fiveWordRuns(prompt);
	if (promptRuns.length < 4 || reply.trim() === '') return false;
	const replyRuns = new Set(fiveWordRuns(reply));
	const found = promptRuns.filter((run) => replyRuns.has(run)).length;
	return found / promptRuns.length >= 0.8;
}

/** Whether the prompt echoes the replies in the last WINDOW exchanges. */
export function echoesRecent(prompt: string, exchanges: readonly Exchange[]): boolean {
	return echoesReply(
		prompt,
		exchanges
			.slice(-WINDOW)
			.map((x) => x.assistant)
			.join('\n\n')
	);
}
