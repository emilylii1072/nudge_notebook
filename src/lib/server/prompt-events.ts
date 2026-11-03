/**
 * Engagement events: every scored prompt, every warning shown before a
 * passive prompt, and every nudge. They are appended to data/prompt_events.jsonl
 * so a session can be analyzed later, and can be downloaded as a CSV.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, hosted } from './config';

export interface PromptEventInput {
	kind: 'prompt' | 'warning' | 'nudge' | 'question';
	action?: string;
	text?: string;
	score?: number | null;
	rationale?: string;
	model?: string;
	meanAll?: number | null;
	meanRecent?: number | null;
	pasted?: boolean;
}

export interface PromptEventRow {
	id: number;
	created: string;
	kind: string;
	action: string;
	text: string;
	score: number | null;
	rationale: string;
	model: string;
	pasted: boolean;
	mean_all: number | null;
	mean_recent: number | null;
}

const logFile = () => join(dataDir(), 'prompt_events.jsonl');

export function listPromptEvents(): PromptEventRow[] {
	// Hosted, the log lives with the gateway, out of the participant's reach.
	if (hosted() || !existsSync(logFile())) return [];
	return readFileSync(logFile(), 'utf-8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as PromptEventRow);
}

/** Hosted: hand the event to the gateway, which keeps the log and knows who is sending. */
function sendToGateway(event: PromptEventInput): void {
	const url = process.env.NUDGE_LOG_URL;
	if (!url) return;
	void fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.ANTHROPIC_API_KEY ?? ''}` },
		body: JSON.stringify(event),
		signal: AbortSignal.timeout(5000)
	}).catch((err) => console.error('[nudge-notebook] log event not delivered:', (err as Error).message));
}

export function insertPromptEvent(event: PromptEventInput): void {
	if (hosted()) return sendToGateway(event);
	try {
		const row: PromptEventRow = {
			id: listPromptEvents().length + 1,
			created: new Date().toISOString(),
			kind: event.kind,
			action: event.action ?? '',
			text: event.text ?? '',
			score: event.score ?? null,
			rationale: event.rationale ?? '',
			model: event.model ?? '',
			pasted: event.pasted === true,
			mean_all: event.meanAll ?? null,
			mean_recent: event.meanRecent ?? null
		};
		appendFileSync(logFile(), JSON.stringify(row) + '\n', 'utf-8');
	} catch (err) {
		// A logging failure must never block the prompt it describes.
		console.error('[nudge-notebook] prompt event write failed:', err);
	}
}

const CSV_COLUMNS: (keyof PromptEventRow)[] = [
	'id', 'created', 'kind', 'action', 'text', 'score', 'rationale', 'model', 'pasted', 'mean_all', 'mean_recent'
];

function csvCell(value: unknown): string {
	if (value === null || value === undefined) return '';
	const text = String(value);
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function promptEventsToCsv(rows: PromptEventRow[]): string {
	const lines = [CSV_COLUMNS.join(',')];
	for (const row of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(','));
	return lines.join('\n') + '\n';
}
