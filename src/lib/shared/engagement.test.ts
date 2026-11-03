import { describe, expect, it } from 'vitest';
import {
	SILENCE_MS,
	average,
	parseScoreReply,
	recentAverage,
	shouldNudgeForRecent,
	shouldNudgeForSilence,
	shouldWarnBeforeSend
} from './engagement';

describe('averages', () => {
	it('averages all scores, and returns null for none', () => {
		expect(average([])).toBeNull();
		expect(average([0, 3])).toBe(1.5);
	});

	it('needs two scores for a recent average and uses the latest two', () => {
		expect(recentAverage([3])).toBeNull();
		expect(recentAverage([3, 0, 1])).toBe(0.5);
	});
});

describe('shouldNudgeForRecent', () => {
	it('nudges when the latest two average below 1.5', () => {
		expect(shouldNudgeForRecent([3, 3, 1, 1])).toBe(true);
		expect(shouldNudgeForRecent([0, 2])).toBe(true);
	});

	it('does not nudge at exactly 1.5 or above', () => {
		expect(shouldNudgeForRecent([1, 2])).toBe(false);
		expect(shouldNudgeForRecent([0, 0, 2, 3])).toBe(false);
	});

	it('does not nudge with fewer than two prompts', () => {
		expect(shouldNudgeForRecent([])).toBe(false);
		expect(shouldNudgeForRecent([0])).toBe(false);
	});
});

describe('shouldWarnBeforeSend', () => {
	it('warns about a passive draft when the overall average is below 1.5', () => {
		expect(shouldWarnBeforeSend([1, 1, 2], 0)).toBe(true);
	});

	it('does not warn when the overall average is 1.5 or above', () => {
		expect(shouldWarnBeforeSend([2, 1, 3], 0)).toBe(false);
	});

	it('does not warn about a draft that is not passive', () => {
		expect(shouldWarnBeforeSend([0, 0, 0], 1)).toBe(false);
	});

	it('does not warn when there are no earlier prompts', () => {
		expect(shouldWarnBeforeSend([], 0)).toBe(false);
	});
});

describe('shouldNudgeForSilence', () => {
	it('nudges after five minutes of quiet, once', () => {
		expect(shouldNudgeForSilence(SILENCE_MS - 1, 0, false)).toBe(false);
		expect(shouldNudgeForSilence(SILENCE_MS, 0, false)).toBe(true);
		expect(shouldNudgeForSilence(SILENCE_MS * 2, 0, true)).toBe(false);
	});
});

describe('parseScoreReply', () => {
	it('reads a plain JSON reply', () => {
		expect(parseScoreReply('{"score": 2, "label": "constructive", "rationale": "States a reason."}')).toEqual({
			score: 2,
			rationale: 'States a reason.'
		});
	});

	it('reads JSON inside a code block or extra text', () => {
		expect(parseScoreReply('```json\n{"score": 0, "rationale": "Bare yes."}\n```')?.score).toBe(0);
	});

	it('reads the score from a reply that was cut off before it finished', () => {
		const cut = '{"score": 2, "label": "constructive", "rationale": "The participant raises their own concern by asking to check whe';
		expect(parseScoreReply(cut)).toEqual({ score: 2, rationale: '' });
	});

	it('rejects scores outside 0 to 3 and replies that are not JSON', () => {
		expect(parseScoreReply('{"score": 4}')).toBeNull();
		expect(parseScoreReply('{"score": 1.5}')).toBeNull();
		expect(parseScoreReply('two')).toBeNull();
	});
});
