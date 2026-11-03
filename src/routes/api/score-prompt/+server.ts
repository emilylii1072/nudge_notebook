import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { HistoryTurn } from '$lib/shared/history';
import { MissingApiKeyError, scorePrompt } from '$lib/server/prompt-scoring/score-prompt';

function readHistory(value: unknown): HistoryTurn[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((t) =>
		t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string'
			? [{ role: t.role, text: t.text } as HistoryTurn]
			: []
	);
}

/**
 * Score one prompt on the ICAP scale (0 passive to 3 interactive).
 * Body: { prompt, history?, pasted? }, where history is a list of
 * { role: 'user' | 'assistant', text }. Nothing is saved here; the page
 * saves the event with POST /api/prompt-events once it knows what you did.
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: { prompt?: unknown; history?: unknown; pasted?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (!prompt) return json({ error: 'prompt is required' }, { status: 400 });

	try {
		const scored = await scorePrompt({
			prompt,
			history: readHistory(body.history),
			pasted: body.pasted === true
		});
		return json(scored);
	} catch (err) {
		if (err instanceof MissingApiKeyError) {
			return json({ error: 'no_api_key', message: err.message }, { status: 503 });
		}
		console.error('[nudge-notebook] prompt scoring failed:', err);
		return json({ error: 'scoring_failed', message: (err as Error).message }, { status: 502 });
	}
};
