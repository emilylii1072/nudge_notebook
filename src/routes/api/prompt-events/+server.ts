import { error, json } from '@sveltejs/kit';
import { hosted } from '$lib/server/config';
import type { RequestHandler } from './$types';
import {
	insertPromptEvent,
	listPromptEvents,
	promptEventsToCsv,
	type PromptEventInput
} from '$lib/server/prompt-events';

const KINDS = new Set(['prompt', 'warning', 'nudge', 'question']);

/** Download the engagement log. Add ?format=json for JSON instead of CSV. */
export const GET: RequestHandler = async ({ url }) => {
	if (hosted()) throw error(404, 'Not found');
	const rows = listPromptEvents();
	if (url.searchParams.get('format') === 'json') return json(rows);
	return new Response(promptEventsToCsv(rows), {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': 'attachment; filename="prompt_events.csv"'
		}
	});
};

/** Save one engagement event. Body matches PromptEventInput. */
export const POST: RequestHandler = async ({ request }) => {
	let body: Partial<PromptEventInput>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'invalid JSON body' }, { status: 400 });
	}
	if (!body.kind || !KINDS.has(body.kind)) {
		return json({ error: 'kind must be prompt, warning, nudge, or question' }, { status: 400 });
	}
	insertPromptEvent(body as PromptEventInput);
	return json({ ok: true });
};
