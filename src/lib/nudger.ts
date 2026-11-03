/**
 * The nudger: it sits between the message box and the agent.
 *
 * It does exactly what the nudge plugin does (nudge-hook/hooks/register.ts),
 * so the notebook and the terminal give the same interventions.
 *
 * Each message you type is scored on the ICAP scale (0 passive to 3
 * interactive) by the server (`/api/score-prompt`) before it is sent. The
 * scorer sees the message and your last five exchanges with the agent. From
 * the scores it does four things:
 *
 *  - Before a passive message is sent while your average is low, it holds the
 *    message back and offers a random sentence starter (`beforeSend`). The
 *    starter goes into the message box if you choose to write your own.
 *  - After a message is sent, it nudges you with three sentence starters if
 *    your latest two messages average below 1.5 (`afterSend`).
 *  - If five minutes pass with no new message, it nudges you to tell the agent
 *    what should happen next (`start`).
 *  - If the agent has been working for a minute, it asks what task you are
 *    doing, so you are not just waiting (`start`).
 *
 * The rules themselves are in `$lib/shared/engagement.ts`, and the sentence
 * starters in `$lib/shared/fillers.ts`. Scoring never blocks sending: if the
 * score cannot be had, the message goes through.
 */
import {
	average,
	globalAverage,
	recentAverage,
	shouldNudgeForRecent,
	shouldNudgeForSilence,
	shouldWarnBeforeSend,
	SILENCE_MS
} from '$lib/shared/engagement';
import { pickFillers, randomFiller } from '$lib/shared/fillers';
import { echoesRecent, historyOf, type Exchange, type HistoryTurn } from '$lib/shared/history';

/** What the nudger needs from the page. */
export interface NudgerHost {
	/** The conversation so far, one exchange per message you sent. */
	exchanges(): Exchange[];
	/** True while the agent is working; that time does not count as silence. */
	agentBusy(): boolean;
	/** Show the warning with a sentence starter. Resolves true for "send as it is", false for "write my own". */
	confirmSend(starter: string): Promise<boolean>;
	/** Put text in the message box, replacing what is there. */
	fillInput(text: string): void;
	/** Ask a question while the agent works. Resolves to the answer, or null if it was dismissed. */
	askQuestion(question: string): Promise<string | null>;
	/** Show a nudge that does not need an answer. */
	nudge(title: string, body: string): void;
	/** Remove nudges that are still showing. */
	clearNudges(): void;
	/** Tell the person something about the nudger itself, such as a missing key. */
	notice(text: string): void;
	/** Called whenever the scores change, for showing them. */
	scoresChanged?(scores: number[]): void;
}

interface Scored {
	score: number;
	rationale: string;
	model: string;
}

/** How long a draft may wait for a score before it is sent unscored. */
const DRAFT_SCORE_TIMEOUT_MS = 10_000;
/** How often the clock is checked, as in the plugin. */
const TIMER_INTERVAL_MS = 30_000;
/** How long the agent works before the task question is asked. */
const WORKING_QUESTION_MS = 60_000;

export const TASK_QUESTION = 'While Claude works: what is the task you are doing?';
export const TASK_QUESTION_SKIP = 'Skip';

const bullets = (starters: string[]) => starters.map((f) => `• ${f}`).join('\n');

export function createNudger(host: NudgerHost) {
	const sessionStart = Date.now();
	const scores: number[] = [];
	let lastPromptAt: number | null = null;
	let lastAgentEndAt: number | null = null;
	let wasBusy = false;
	let silenceShown = false;
	let warnedKeyMissing = false;
	/** The score for the draft checked before sending, so it is not scored twice. */
	let draftCache: { text: string; scored: Scored; pasted: boolean } | null = null;
	let sentAfterWarning = false;
	/** When the agent started on the latest message; 0 when it is not working. */
	let workingSince = 0;
	/** The `workingSince` the task question was already asked for, so it is asked once per turn. */
	let askedFor = -1;
	let asking = false;

	const means = () => ({ meanAll: globalAverage(scores), meanRecent: recentAverage(scores) });

	function logEvent(event: Record<string, unknown>): void {
		void fetch('/api/prompt-events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(event)
		}).catch(() => {});
	}

	/** What the scorer is given for a new message: the recent history, and whether it echoes the agent. */
	function scorerInput(text: string): { history: HistoryTurn[]; pasted: boolean } {
		const exchanges = host.exchanges();
		return { history: historyOf(exchanges), pasted: echoesRecent(text, exchanges) };
	}

	async function requestScore(text: string, history: HistoryTurn[], pasted: boolean): Promise<Scored | null> {
		try {
			const res = await fetch('/api/score-prompt', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt: text, history, pasted })
			});
			if (!res.ok) {
				if (res.status === 503 && !warnedKeyMissing) {
					warnedKeyMissing = true;
					host.notice(
						'The nudger is off because no Anthropic API key is set. Add ANTHROPIC_API_KEY to the .env file and restart the app.'
					);
				}
				return null;
			}
			return (await res.json()) as Scored;
		} catch {
			return null;
		}
	}

	function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
		return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
	}

	/** A nudge reads "Nudge" and then the text, as the plugin's popup does. */
	function showNudge(text: string, action: string): void {
		host.nudge('Nudge', text);
		logEvent({ kind: 'nudge', action, text, ...means() });
	}

	async function askTaskQuestion(): Promise<void> {
		asking = true;
		askedFor = workingSince;
		try {
			const answer = await host.askQuestion(TASK_QUESTION);
			if (answer && answer !== TASK_QUESTION_SKIP) {
				logEvent({ kind: 'question', action: 'what_is_the_task', text: answer, ...means() });
			}
		} catch {
			// dismissed
		} finally {
			asking = false;
		}
	}

	return {
		/**
		 * Call before a message is sent. Resolves to true to send it, or false
		 * when you chose to write your own, in which case a sentence starter has
		 * been put in the message box. Every message is scored first; it is only
		 * held up while your average is below 1.5 and it scores as passive.
		 */
		async beforeSend(text: string): Promise<boolean> {
			sentAfterWarning = false;
			draftCache = null;
			// The person is active either way, so the silence clock restarts.
			lastPromptAt = Date.now();
			const { history, pasted } = scorerInput(text);
			const scored = await withTimeout(requestScore(text, history, pasted), DRAFT_SCORE_TIMEOUT_MS);
			if (!scored) return true;
			draftCache = { text, scored, pasted };
			if (!shouldWarnBeforeSend(scores, scored.score)) return true;

			logEvent({
				kind: 'warning',
				action: 'shown',
				text,
				score: scored.score,
				rationale: scored.rationale,
				model: scored.model,
				pasted,
				...means()
			});
			// A random starter, put in the message box when the message is held back.
			const starter = randomFiller();
			const sendAsItIs = await host.confirmSend(starter);
			if (!sendAsItIs) {
				logEvent({ kind: 'warning', action: 'edited_after_warning', text, score: scored.score, pasted, ...means() });
				draftCache = null;
				host.fillInput(starter);
				return false;
			}
			sentAfterWarning = true;
			return true;
		},

		/**
		 * Call when a message has been sent. Records its score (reusing the one
		 * from `beforeSend`) and nudges you if your latest two messages average
		 * below 1.5. Does not wait: call it without await.
		 */
		async afterSend(text: string): Promise<void> {
			// The history must be read now, before this message joins the conversation.
			const { history, pasted } = scorerInput(text);
			const afterWarning = sentAfterWarning;
			const cached = draftCache && draftCache.text === text ? draftCache : null;
			sentAfterWarning = false;
			draftCache = null;

			lastPromptAt = Date.now();
			workingSince = lastPromptAt;
			silenceShown = false;
			host.clearNudges();

			const scored = cached?.scored ?? (await requestScore(text, history, pasted));
			if (!scored) return;
			scores.push(scored.score);
			host.scoresChanged?.([...scores]);
			logEvent({
				kind: 'prompt',
				action: afterWarning ? 'sent_after_warning' : 'sent',
				text,
				score: scored.score,
				rationale: scored.rationale,
				model: scored.model,
				pasted,
				...means()
			});

			if (shouldNudgeForRecent(scores)) {
				const recent = (recentAverage(scores) ?? 0).toFixed(1);
				const starters = pickFillers(['counterfactual', 'problem', 'steering'], 3, scores.length);
				showNudge(
					`Take a more active part: your last two messages average ${recent} out of 3. Try starting your next message with:\n${bullets(starters)}`,
					'low_recent_average'
				);
			}
		},

		/**
		 * Start the clock. Every 30 seconds it asks the task question if the
		 * agent has worked for a minute, or else nudges you after five minutes of
		 * silence. Time while the agent is working does not count as silence.
		 * Returns a function that stops it.
		 */
		start(): () => void {
			const timer = setInterval(async () => {
				try {
					const busy = host.agentBusy();
					if (wasBusy && !busy) {
						lastAgentEndAt = Date.now();
						workingSince = 0;
					}
					wasBusy = busy;

					// While the agent works on a longer task, ask a question instead of leaving you to wait.
					if (busy) {
						if (!asking && workingSince && askedFor !== workingSince && Date.now() - workingSince >= WORKING_QUESTION_MS) {
							await askTaskQuestion();
						}
						return;
					}

					const quietSince = Math.max(sessionStart, lastPromptAt ?? 0, lastAgentEndAt ?? 0);
					if (!shouldNudgeForSilence(Date.now(), quietSince, silenceShown)) return;
					silenceShown = true;
					const starters = pickFillers(['steering', 'counterfactual', 'comprehension'], 3, scores.length);
					showNudge(
						`No message in ${Math.round(SILENCE_MS / 60_000)} minutes. Tell Claude what you think should happen next. You could start with:\n${bullets(starters)}`,
						'no_prompt_silence'
					);
				} catch {
					// a timer that fails should say nothing
				}
			}, TIMER_INTERVAL_MS);
			return () => clearInterval(timer);
		},

		/** The overall average, for showing in the interface. */
		currentAverage: (): number | null => average(scores)
	};
}

export type Nudger = ReturnType<typeof createNudger>;
