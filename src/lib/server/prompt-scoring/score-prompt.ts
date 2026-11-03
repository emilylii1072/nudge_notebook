/**
 * Score a participant's prompt on the ICAP scale with Claude Opus.
 *
 * The rubric the model reads is `icap-rubric.md` in this folder, the same file
 * the nudge plugin uses. The request has the same shape as the plugin's:
 * { history, prompt, pasted }. The reply is read by `parseScoreReply` in
 * `$lib/shared/engagement.ts`.
 */
import Anthropic from '@anthropic-ai/sdk';
import rubric from './icap-rubric.md?raw';
import { parseScoreReply, type ScoredPrompt } from '$lib/shared/engagement';
import type { HistoryTurn } from '$lib/shared/history';

/** The model that scores prompts. Set NUDGE_SCORER_MODEL to use another. */
export const SCORER_MODEL = process.env.NUDGE_SCORER_MODEL || 'claude-opus-5-5';

/** Thrown when no Anthropic API key is set, so the route can say so plainly. */
export class MissingApiKeyError extends Error {
	constructor() {
		super('No Anthropic API key is set. Add ANTHROPIC_API_KEY to the .env file.');
	}
}

export interface ScoreRequest {
	prompt: string;
	/** The last few exchanges, oldest first, already cut to size by `historyOf`. Context only. */
	history?: HistoryTurn[];
	/** True when most of the prompt repeats the agent's replies. */
	pasted?: boolean;
}

export async function scorePrompt(request: ScoreRequest): Promise<ScoredPrompt & { model: string }> {
	if (!process.env.ANTHROPIC_API_KEY) throw new MissingApiKeyError();
	const client = new Anthropic();
	const message = await client.messages.create({
		model: SCORER_MODEL,
		max_tokens: 800,
		system: rubric,
		messages: [
			{
				role: 'user',
				content: JSON.stringify({
					history: request.history ?? [],
					prompt: request.prompt,
					pasted: request.pasted === true
				})
			}
		]
	});
	const text = message.content
		.map((block) => (block.type === 'text' ? block.text : ''))
		.join('');
	const scored = parseScoreReply(text);
	if (!scored) throw new Error(`Could not read a score from the model reply: ${text.slice(0, 200)}`);
	return { ...scored, model: SCORER_MODEL };
}
