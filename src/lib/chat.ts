import type { Exchange } from '$lib/shared/history';

/** What the chat log holds. */
export type ChatEntry =
	| { kind: 'user'; text: string }
	| { kind: 'text'; text: string }
	| {
			kind: 'tool';
			id: string;
			name: string;
			input: Record<string, unknown>;
			/** For a cell edit: the cell's text when the edit began, so the diff is true. */
			before?: string;
			result?: string;
			isError?: boolean;
			/** Set when Claude is waiting for your approval, then records your answer. */
			permission?: { requestId: string; state: 'pending' | 'allowed' | 'denied' };
	  }
	| { kind: 'note'; text: string; tone?: 'error' };

/** The agent's words since your last message, which is what you are replying to. */
/** The conversation as exchanges: each message you sent, with the agent's words that followed it. */
export function exchangesOf(entries: ChatEntry[]): Exchange[] {
	const exchanges: Exchange[] = [];
	for (const entry of entries) {
		if (entry.kind === 'user') exchanges.push({ user: entry.text, assistant: '' });
		else if (entry.kind === 'text' && entry.text.trim() && exchanges.length > 0) {
			const last = exchanges[exchanges.length - 1];
			last.assistant = last.assistant ? `${last.assistant}\n\n${entry.text.trim()}` : entry.text.trim();
		}
	}
	return exchanges;
}

export function latestAgentText(entries: ChatEntry[]): string {
	const parts: string[] = [];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.kind === 'user') break;
		if (entry.kind === 'text' && entry.text.trim()) parts.unshift(entry.text.trim());
	}
	return parts.join('\n\n');
}

/** How Claude asks before it acts. */
export type Mode = 'ask' | 'acceptEdits' | 'plan';

export type Decision = 'allow' | 'allow-session' | 'deny';
