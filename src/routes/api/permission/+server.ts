import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { answerDecision } from '$lib/server/permissions';

/** Your answer to an approval request. Body: { requestId, decision: 'allow' | 'allow-session' | 'deny' } */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { requestId?: string; decision?: string };
	if (!body.requestId) throw error(400, 'requestId is required.');
	const decision =
		body.decision === 'allow'
			? { allow: true as const, remember: false }
			: body.decision === 'allow-session'
				? { allow: true as const, remember: true }
				: { allow: false as const };
	return json({ ok: answerDecision(body.requestId, decision) });
};
