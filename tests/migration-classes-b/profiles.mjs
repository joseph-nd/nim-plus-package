/**
 * Per-class test characters for the level/direction matrix: what a character
 * of each version owns at each level (subclass, choice picks, spells), which
 * prompt answers the migration gets, and what the target version's fresh
 * character with the corresponding picks owns.
 */
import { SYS_FEATURES } from './helpers.mjs';

const ARMOR_OF_SHADOWS = `${SYS_FEATURES}0ovTUb8axKSScua0`; // Greater invocation, unchanged in 0.2
const MISDIRECTION = `${SYS_FEATURES}uvhLoC3NA38uZF9h`; // Underhanded ability, unchanged in 0.2

const FORMS = {
	'2.0.3': [
		['Fearsome Beast', 2],
		['Beast of the Pack', 3],
		['Beast of Nightmares', 5],
	],
	'0.2': [
		['Fearsome Beast', 1],
		['Beast of the Pack', 2],
		['Beast of Nightmares', 5],
	],
};
const forms = (version, L) => FORMS[version].filter(([, at]) => at <= L).map(([n]) => n);

/**
 * @typedef {object} Side  { subclass?, picks: string[], spells: string[] }
 * @typedef {object} Profile
 *   id, classId,
 *   side(version, L) → Side               a character built on that side
 *   answers(direction, L) → [RegExp, answer][]
 *   picked(direction, L) → string[]       names added by a pick prompt
 *   target(direction, L) → Side           the fresh target equivalent
 *   lost(direction, L) → string[]         names a round trip (direction then back) does not restore
 */
export const PROFILES = [
	{
		id: 'stormshifter/fang-and-claw',
		classId: 'stormshifter',
		side: (v, L) => ({
			subclass: L >= 3 ? 'Circle of Fang & Claw' : undefined,
			picks: [...forms(v, L), ...(L >= 6 ? ['Beast of the Sea', 'Climber'] : [])],
			spells: ['Zap', 'Arc Lightning', 'Razor Wind'],
		}),
		answers: () => [],
		picked: () => [],
		lost: () => [],
	},
	{
		id: 'stormshifter/sky-and-storm',
		classId: 'stormshifter',
		side: (v, L) => ({
			subclass: L >= 3 ? 'Circle of Sky & Storm' : undefined,
			picks: [...forms(v, L), ...(L >= 6 ? ['Leader of the Pack', 'Winged'] : [])],
			spells: ['Fly'],
		}),
		answers: () => [],
		picked: () => [],
		lost: () => [],
	},
	{
		id: 'shadowmancer/reaver',
		classId: 'shadowmancer',
		side: (v, L) => ({
			subclass: 'Reaver',
			picks: [
				...(L >= 3 ? ['Beguiling Influence', 'Abhorrent Speech'] : []),
				...(L >= 4 ? (v === '2.0.3' ? ['Vengeful Blast', 'Hungering Shadows'] : ['Hungering Shadows', ARMOR_OF_SHADOWS]) : []),
			],
			spells: ['Shadow Blast', 'Summon Shadow', ...(v === '0.2' ? ['Command Shadows'] : [])],
		}),
		answers: (d, L) => (d === 'to02' && L >= 4 ? [[/Replace Vengeful Blast/, { action: 'ok', checked: [ARMOR_OF_SHADOWS] }]] : []),
		picked: (d, L) => (d === 'to02' && L >= 4 ? ['Armor of Shadows'] : []),
		lost: (d, L) => (d === 'to02' && L >= 4 ? ['Vengeful Blast'] : []),
	},
	{
		id: 'songweaver/herald-of-courage',
		classId: 'songweaver',
		side: (v, L) => ({
			subclass: L >= 3 ? 'Herald of Courage' : undefined,
			picks: [...(L >= 4 ? ['Heroic Ballad', 'Inspiring Anthem'] : []), ...(L >= 5 ? ['Stompy'] : [])],
			spells: ['Razor Wind', 'Vicious Mockery', ...(v === '2.0.3' || L >= 2 ? ['Flame Dart'] : [])],
		}),
		answers: (d, L) => (d === 'to02' && L === 1 ? [[/Songweaver: additional school/, true]] : []),
		picked: () => [],
		lost: (d, L) => (d === 'to02' && L === 1 ? ['Flame Dart'] : []),
	},
	{
		id: 'the-cheat/scoundrel',
		classId: 'the-cheat',
		side: (v, L) => ({
			subclass: L >= 3 ? 'Tools of the Scoundrel' : undefined,
			picks:
				L >= 6
					? v === '2.0.3'
						? ['Sunder Armor (Medium)', 'Sunder Armor (Heavy)', 'Trickshot']
						: ['Sunder Armor', 'Trickshot', 'Misdirection']
					: L >= 4
						? [v === '2.0.3' ? 'Sunder Armor (Medium)' : 'Sunder Armor']
						: [],
			spells: [],
		}),
		answers: (d, L) => (d === 'to02' && L >= 6 ? [[/Replace Sunder Armor/, { action: 'ok', checked: [MISDIRECTION] }]] : []),
		picked: (d, L) => (d === 'to02' && L >= 6 ? ['Misdirection'] : []),
		lost: (d, L) => (d === 'to02' && L >= 6 ? ['Sunder Armor (Heavy)'] : []),
	},
	{
		id: 'zephyr/way-of-flame',
		classId: 'zephyr',
		side: (v, L) => ({ subclass: L >= 3 ? 'Way of Flame' : undefined, picks: L >= 4 ? ['Airshift'] : [], spells: [] }),
		answers: () => [],
		picked: () => [],
		lost: () => [],
	},
	{
		id: 'hunter/keeper-of-the-shadowpath',
		classId: 'hunter',
		side: (v, L) => ({ subclass: L >= 3 ? 'Keeper of the Shadowpath' : undefined, picks: [], spells: [] }),
		answers: () => [],
		picked: () => [],
		lost: () => [],
	},
];

/** The fresh target character of a profile: the target side, except where a prompt answer decides. */
export function targetSide(profile, direction, L) {
	const v = direction === 'to02' ? '0.2' : '2.0.3';
	const side = profile.side(v, L);
	// Songweaver 0.2 → 2.0.3 at level 1: the additional school is left to the player (reported).
	if (profile.classId === 'songweaver' && direction === 'to203' && L === 1) side.spells = side.spells.filter((s) => s !== 'Flame Dart');
	// Going back, the 0.2 picks that replaced a retired/merged pick are kept (not guessed back).
	if (profile.classId === 'shadowmancer' && direction === 'to203' && L >= 4) {
		side.picks = side.picks.filter((p) => p !== 'Vengeful Blast').concat(ARMOR_OF_SHADOWS);
	}
	if (profile.classId === 'the-cheat' && direction === 'to203' && L >= 6) {
		side.picks = ['Sunder Armor (Medium)', 'Trickshot', MISDIRECTION];
	}
	return side;
}
