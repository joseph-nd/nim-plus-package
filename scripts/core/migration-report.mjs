/**
 * Nim+ Package — how the migrations report what they did.
 *
 * The class migration and the subclass sync apply without a confirmation
 * popup. What they changed goes to three places: a short toast
 * (`ui.notifications`), a chat card whispered to the GMs (and to the player who
 * ran it, when that is not a GM) with the full per-character lines, and the
 * console (`console.info`, plain text). The chat card is the audit trail.
 *
 * Nothing here registers a hook.
 */
import { MODULE_ID } from './constants.mjs';

/** `n thing` / `n things`. */
export function plural(n, word, many = `${word}s`) {
	return `${n} ${n === 1 ? word : many}`;
}

/** HTML → one line of plain text for the console. */
export function plainText(html) {
	return String(html ?? '')
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The GMs, plus the current user when they are not one. */
function recipients() {
	const ids = new Set((game.users?.filter?.((u) => u.isGM) ?? []).map((u) => u.id));
	if (game.user && !game.user.isGM) ids.add(game.user.id);
	return [...ids];
}

/**
 * Whisper a report card.
 * @param {object} report
 * @param {string} report.title     card heading (plain text)
 * @param {string} report.intro     HTML paragraph under the heading
 * @param {{heading: string, lines: string[]}[]} report.sections   one per character (HTML)
 * @param {string} [report.footer]  HTML paragraph at the end
 * @returns {Promise<object|null>} the created message (or null if it could not be posted)
 */
export async function whisperReport({ title, intro = '', sections = [], footer = '' }) {
	const body = sections
		.map(
			({ heading, lines }) =>
				`<h4 style="margin:.5em 0 .2em">${heading}</h4>` +
				`<ul style="margin:0 0 .4em 1.2em">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`,
		)
		.join('');
	const content =
		`<div class="nim-plus-migration-report"><h3>${title}</h3>` +
		(intro ? `<p>${intro}</p>` : '') +
		body +
		(footer ? `<p>${footer}</p>` : '') +
		'</div>';

	for (const { heading, lines } of sections) {
		console.info(`${MODULE_ID} | ${plainText(title)} — ${plainText(heading)}:\n  ${lines.map(plainText).join('\n  ')}`);
	}
	try {
		return await ChatMessage.create({
			content,
			whisper: recipients(),
			speaker: { alias: 'Nim+' },
		});
	} catch (error) {
		console.error(`${MODULE_ID} | could not post the migration report`, error);
		return null;
	}
}
