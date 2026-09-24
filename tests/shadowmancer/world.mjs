/**
 * Worlds for the Shadowmancer battery.
 *
 * `casterWorld` adds, before the module scripts load, a port of the system's
 * character preparation for the two fields the tier override touches
 * (../FoundryVTT-Nimble/src/documents/actor/character.ts, `prepareDerivedData`
 * l. 264-270, `_prepareMaxMana` l. 506, `_prepareHighestUnlockedSpellTier`
 * l. 524):
 *
 *   mana.max = level 1 ? baseMax : baseMax + Σ class mana formula      (Pilfered Power: max(@dexterity, 0))
 *   highestUnlockedSpellTier ??= no class → 0 · mana.max > 0 → getHighestSpellTier · else null
 *
 * so `scripts/classes/shadowmancer/spell-tiers.mjs` wraps something that
 * behaves like the real method, and "setting off" shows the system's value.
 */
import { CORE_SCRIPTS, importScripts, installFoundry, installPacks, MODULE_ID, setupWorld } from '../harness/index.mjs';
import { getHighestSpellTier } from './grant-port.mjs';

export const SPELL_TIERS = 'scripts/classes/shadowmancer/spell-tiers.mjs';

/** Resolve a Nimble mana formula such as "(max(@dexterity, 0))" against ability mods. */
export function evalManaFormula(formula, abilities) {
	const expr = String(formula ?? '0').replace(/@(\w+)/g, (_, key) => String(Number(abilities?.[key]?.mod ?? 0)));
	if (!/^[\d\s+\-*/().,maxin]*$/.test(expr)) throw new Error(`unsupported mana formula ${formula}`);
	return Number(new Function('max', 'min', `return ${expr};`)(Math.max, Math.min)) || 0;
}

function installSystemPreparation(env) {
	const proto = env.classes.Actor.prototype;
	const base = proto.prepareDerivedData;
	proto.prepareDerivedData = function systemCharacterPrep(...args) {
		base.apply(this, args);
		if (this.type !== 'character') return;
		const system = (this.system ??= {});
		const resources = (system.resources ??= {});
		const mana = (resources.mana ??= {});
		const classes = (this.items ?? []).filter((i) => i.type === 'class');
		const baseMax = Number(mana.baseMax ?? 0);
		if (!classes.length || this.levels.character === 1) mana.max = baseMax;
		else mana.max = classes.reduce((sum, cls) => sum + evalManaFormula(cls.system?.mana?.formula, system.abilities), baseMax);
		resources.highestUnlockedSpellTier ??= !classes.length ? 0 : mana.max > 0 ? getHighestSpellTier(this) : null;
	};
}

/**
 * @param {object} o
 * @param {boolean} [o.playtest=true]    nim-plus-package.playtestCoreClasses
 * @param {boolean} [o.automation=true]  nim-plus-package.enableClassAutomation (gates the tier override)
 */
export async function casterWorld({ playtest = true, automation = true } = {}) {
	const env = installFoundry({
		settings: {
			[`${MODULE_ID}.playtestCoreClasses`]: playtest,
			[`${MODULE_ID}.enableClassAutomation`]: automation,
		},
	});
	await installPacks(env);
	installSystemPreparation(env);
	const mods = await importScripts([...CORE_SCRIPTS, 'scripts/classes/shared/settings.mjs', SPELL_TIERS]);
	await env.boot({ until: 'setup' });
	return { env, mods, tiers: mods.at(-1) };
}

/** Give an actor abilities / stored resources in its source and re-prepare. */
export function arrange(actor, { dex = 3, baseMax, stored } = {}) {
	const sys = actor._source.system;
	sys.abilities = { dexterity: { mod: dex }, intelligence: { mod: 2 }, strength: { mod: 0 }, will: { mod: 0 } };
	sys.resources = { mana: { current: 0, ...(baseMax !== undefined ? { baseMax } : {}) } };
	if (stored !== undefined) sys.resources.highestUnlockedSpellTier = stored;
	actor.prepareData();
	return actor;
}

/** The plain core-scripts world (supersede + migration), setting = version. */
export async function versionWorld(version, opts = {}) {
	return setupWorld({ playtest: version === '0.2', ...opts });
}
