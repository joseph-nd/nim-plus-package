/**
 * The Shadowmancer's spell-related documents, as data, in both versions:
 *   system 2.0.3  ../FoundryVTT-Nimble/packs/classFeatures/core/shadowmancer/** + packs/spells/core/necrotic
 *   Nim+ 0.2      pack-sources/classFeatures/shadowmancer/**, pack-sources/spells/core/necrotic/
 *
 * - Master of Darkness' grantSpells predicates follow the ladder;
 * - the subclass school grants (Master of Nightfrost, Draconic Crimson Rite) follow it from L3,
 *   in the system document and in the Nim+ 0.2 copy alike;
 * - every grantSpells rule passes a port of the system's GrantSpellsRule schema
 *   (src/models/rules/grantSpells.ts + src/models/rules/base.ts) — an invalid rule
 *   is dropped by strict validation, and its spells silently never arrive;
 * - Conduit of Shadow's cantrips (2 in 2.0.3, 3 in 0.2) resolve;
 * - 0.2 specifics: Shadow Blast uses DEX, Summon Shadow's limit is INT (+1 per 5 levels),
 *   Command Shadows exists only in 0.2, Vengeful Blast is retired;
 * - what each version's index shows (the supersede layer), including that nothing the
 *   Shadowmancer needs is hidden without a visible replacement.
 *
 * Rules text:
 *   0.2: "Summon Shadow 1 Action / Summon 1 adjacent Shadow (a d12 minion). / High Levels: +1 Shadow every 5 levels."
 *        "Shadow Limit. You can have up to INT Shadows."
 *        "Command Shadows 1 Action / (1/turn) ALL your Shadows move 6 then attack."
 *        "Shadow Blast 1 Action / Range: 8. Damage: 1d12+DEX (1/round). High Levels: +1d12 every 5 levels."
 *        Greater Invocations (0.2): Armor of Shadows, Fiendish Boon, Hungering Shadows, One with Shadows,
 *        Repelling Blast, Shadow Magus, Shadow Spear, Shadow Rush, Shadow Warp, Swarming Shadows — no Vengeful Blast.
 *   2.0.3: "Shadow Blast. (Necrotic cantrip) Action: (1/turn) Range: 8. Damage: 1d12+KEY."
 *          "Summon Shadows. … you can summon a max of INT or LVL minions this way, whichever is lower"
 *          "… may cast Shadow Blast as a reaction (even if you" (Vengeful Blast, Greater Invocations)
 */
import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { findDocs, loadPackData, MODULE_ID, setupWorld, supersedeOracle } from '../harness/index.mjs';
import { SHADOWMANCER_LADDER } from './grant-port.mjs';

const TXT = '/tmp/claude-1000/-home-jnunez-Projects-foundry-vtt-modules-blue-codex-package/9221e053-ac5e-40f6-8b85-ed07b67e312c/scratchpad/core02/txt';
const readText = (f) => (fs.existsSync(`${TXT}/${f}`) ? fs.readFileSync(`${TXT}/${f}`, 'utf8') : null);

const SYS_F = 'Compendium.nimble.nimble-class-features.Item.';
const NIM_F = `Compendium.${MODULE_ID}.nim-plus-class-features.Item.`;
const SYS_S = 'Compendium.nimble.nimble-spells.Item.';
const NIM_S = `Compendium.${MODULE_ID}.nim-plus-spells.Item.`;

const MASTER_OF_DARKNESS = `${SYS_F}wGYBR7ZmNd0V6Ka4`;
const PILFERED_POWER = `${SYS_F}Af4hwQ1ngzl3ukN3`;
const SHADOWMASTERY = `${SYS_F}6nAimxYeKDOthVnI`;
const VENGEFUL_BLAST = `${SYS_F}smUoANfxnZS95YVz`;
const CONDUIT = { sys: `${SYS_F}WXoGNl27TocLhXcK`, nim: `${NIM_F}q3mY4JuKKmJDprY1` };
const NIGHTFROST = { sys: `${SYS_F}3agGXPcnhkxUaEwb`, nim: `${NIM_F}OwWbif70nVu7q1jA` };
const CRIMSON = { sys: `${SYS_F}Xex0SxZfXo5CxeD8`, nim: `${NIM_F}PtVnvw26UbVVuyr5` };
const SHADOW_BLAST = { sys: `${SYS_S}9TNPdOXlCcGgxw6r`, nim: `${NIM_S}GLJKE5D5LdARXT29` };
const SUMMON_SHADOW = { sys: `${SYS_S}ho2KADcmQWWTeYR0`, nim: `${NIM_S}9nxiMH8Ow6mZPiKk` };
const COMMAND_SHADOWS = `${NIM_S}uHirzuVSdqt7jVPU`;

const doc = (uuid) => {
	const d = loadPackData().byUuid.get(uuid);
	if (!d) throw new Error(`no pack doc ${uuid}`);
	return d;
};
const grantRules = (d) => (d.system?.rules ?? []).filter((r) => r.type === 'grantSpells');

/** Expected tier → minimum level for a feature that starts granting at `start`. */
function ladderPredicates(start) {
	const out = { 0: start };
	SHADOWMANCER_LADDER.forEach((level, i) => {
		out[i + 1] = Math.max(start, level);
	});
	return out;
}

function tierPredicates(d) {
	const out = {};
	for (const r of grantRules(d)) {
		expect(r.tiers, `${d.name} ${r.id}`).toHaveLength(1);
		out[r.tiers[0]] = r.predicate?.level?.min;
	}
	return out;
}

/* ── port of GrantSpellsRule's schema (src/models/rules/grantSpells.ts) + NimbleBaseRule (base.ts) ── */
const SCHOOLS = ['fire', 'ice', 'lightning', 'necrotic', 'radiant', 'wind']; // src/config.ts spellSchools
function schemaErrors(rule) {
	const errors = [];
	const isInt = (n) => Number.isInteger(n);
	if (rule.type !== 'grantSpells') errors.push('type');
	if (rule.id !== undefined && typeof rule.id !== 'string') errors.push('id');
	for (const key of ['identifier', 'label']) if (rule[key] !== undefined && typeof rule[key] !== 'string') errors.push(key);
	if (rule.disabled !== undefined && typeof rule.disabled !== 'boolean') errors.push('disabled');
	if (rule.priority !== undefined && typeof rule.priority !== 'number') errors.push('priority');
	if (rule.predicate !== undefined && (typeof rule.predicate !== 'object' || rule.predicate === null || Array.isArray(rule.predicate))) errors.push('predicate');
	if (rule.schools !== undefined) {
		if (!Array.isArray(rule.schools)) errors.push('schools');
		else for (const s of rule.schools) if (![...SCHOOLS, 'known'].includes(s)) errors.push(`schools:${s}`);
	}
	if (rule.tiers !== undefined) {
		if (!Array.isArray(rule.tiers)) errors.push('tiers');
		else for (const t of rule.tiers) if (!isInt(t) || t < 0) errors.push(`tiers:${t}`);
	}
	if (rule.utilityOnly !== undefined && typeof rule.utilityOnly !== 'boolean') errors.push('utilityOnly');
	if (rule.uuids !== undefined) {
		if (!Array.isArray(rule.uuids)) errors.push('uuids');
		else for (const u of rule.uuids) if (typeof u !== 'string' || !u) errors.push(`uuids:${u}`);
	}
	if (!['auto', 'selectSchool', 'selectSpell'].includes(rule.mode ?? 'auto')) errors.push(`mode:${rule.mode}`);
	if (rule.count !== undefined && rule.count !== null && (!isInt(rule.count) || rule.count < 1)) errors.push(`count:${rule.count}`);
	return errors;
}

describe('grantSpells rules — ladder predicates', () => {
	it('Master of Darkness (system, used by both versions): cantrips + tier 1 at L2, then 5/7/10/13/16/19, nothing above 7', () => {
		const d = doc(MASTER_OF_DARKNESS);
		expect(tierPredicates(d)).toEqual(ladderPredicates(2));
		for (const r of grantRules(d)) {
			expect(r.schools).toEqual(['necrotic']);
			expect(r.mode).toBe('auto');
			expect(r.utilityOnly ?? false).toBe(false);
		}
		expect(d.system.gainedAtLevels).toEqual([2, 5, 7, 10, 13, 16, 19]);
		expect(d.system.class).toBe('shadowmancer');
		expect(d.system.group).toBe('shadowmancer-progression');
	});

	it('no Nim+ copy of Master of Darkness, Pilfered Power or Shadowmastery exists, and none of them is superseded or retired', async () => {
		for (const name of ['Master of Darkness', 'Pilfered Power', 'Shadowmastery']) {
			expect(findDocs({ pack: `${MODULE_ID}.nim-plus-class-features`, name }), name).toEqual([]);
		}
		const oracle = await supersedeOracle();
		for (const uuid of [MASTER_OF_DARKNESS, PILFERED_POWER, SHADOWMASTERY]) {
			expect(oracle.hiddenWhen(true).has(uuid), uuid).toBe(false);
			expect(oracle.hiddenWhen(false).has(uuid), uuid).toBe(false);
		}
	});

	it.each([
		['Master of Nightfrost', NIGHTFROST, 'ice', 'pact-of-the-abyssal-depths'],
		['Draconic Crimson Rite', CRIMSON, 'fire', 'pact-of-the-red-dragon'],
	])('%s: school grants from L3 on the Shadowmancer ladder, system and Nim+ copy identical', (name, uuids, school, group) => {
		for (const side of ['sys', 'nim']) {
			const d = doc(uuids[side]);
			expect(d.name).toBe(name);
			expect(tierPredicates(d), side).toEqual(ladderPredicates(3));
			for (const r of grantRules(d)) {
				expect(r.schools).toEqual([school]);
				expect(r.mode).toBe('auto');
			}
			expect(d.system.gainedAtLevels ?? [d.system.gainedAtLevel]).toEqual([3]);
			expect(d.system.subclass).toBe(true);
			expect(d.system.class).toBe('shadowmancer');
			expect(d.system.group).toBe(group);
		}
		expect(doc(uuids.nim).flags[MODULE_ID].supersedes).toEqual([uuids.sys]);
		expect(grantRules(doc(uuids.nim))).toEqual(grantRules(doc(uuids.sys)));
	});

	it('Shadowmastery: selectSpell necrotic utility at exactly L6 and L8, auto all utility at L14', () => {
		const rules = grantRules(doc(SHADOWMASTERY));
		expect(rules.map((r) => [r.mode, r.predicate.level.min, r.count ?? null, r.utilityOnly, r.schools, r.tiers])).toEqual([
			['selectSpell', 6, 1, true, ['necrotic'], [0]],
			['selectSpell', 8, 1, true, ['necrotic'], [0]],
			['auto', 14, null, true, ['necrotic'], [0]],
		]);
	});

	it('Pilfered Power carries no rules — the pool is the class mana formula (DEX)', () => {
		const d = doc(PILFERED_POWER);
		expect(d.system.rules).toEqual([]);
		expect(d.system.gainedAtLevels).toEqual([2]);
		expect(d.system.description).toMatch(/DEX times/);
	});
});

describe('grantSpells rules — strict validation', () => {
	const shadowmancerDocs = () =>
		[...findDocs({ class: 'shadowmancer' }), ...findDocs({ type: 'class', where: (d) => d.system?.identifier === 'shadowmancer' })].filter((e) =>
			grantRules(e.doc).length,
		);

	it('there are grant rules on both sides to check', () => {
		const uuids = shadowmancerDocs().map((e) => e.uuid);
		expect(uuids).toEqual(expect.arrayContaining([MASTER_OF_DARKNESS, SHADOWMASTERY, CONDUIT.sys, CONDUIT.nim, NIGHTFROST.nim, CRIMSON.nim]));
	});

	it('every Shadowmancer grantSpells rule (system + Nim+) passes the GrantSpellsRule schema', () => {
		const bad = [];
		for (const { uuid, doc: d } of shadowmancerDocs()) {
			for (const r of grantRules(d)) {
				const errors = schemaErrors(r);
				if (errors.length) bad.push(`${d.name} (${uuid}) ${r.id}: ${errors.join(', ')}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('rule ids are unique within each feature (selection groups are keyed by rule id)', () => {
		for (const { doc: d } of shadowmancerDocs()) {
			const ids = grantRules(d).map((r) => r.id);
			expect(new Set(ids).size, d.name).toBe(ids.length);
		}
	});

	it('every uuid a Shadowmancer grant names resolves to a spell of the Shadowmancer', () => {
		for (const { doc: d } of shadowmancerDocs()) {
			for (const r of grantRules(d)) {
				for (const u of r.uuids ?? []) {
					const target = loadPackData().byUuid.get(u);
					expect(target, `${d.name} → ${u}`).toBeTruthy();
					expect(target.type).toBe('spell');
					expect(target.system.classes).toEqual(['shadowmancer']);
				}
			}
		}
	});

	it('the Nim+ spell ids Conduit names are the persisted build ids (pack-sources/ids.json)', () => {
		const ids = JSON.parse(fs.readFileSync(new URL('../../pack-sources/ids.json', import.meta.url), 'utf8'));
		const flat = JSON.stringify(ids);
		for (const u of grantRules(doc(CONDUIT.nim))[0].uuids) expect(flat).toContain(`"${u.split('.').pop()}"`);
	});
});

describe('Conduit of Shadow', () => {
	it('2.0.3: Shadow Blast + Summon Shadow (system), no predicate, gained at L1', () => {
		const d = doc(CONDUIT.sys);
		const [rule] = grantRules(d);
		expect(grantRules(d)).toHaveLength(1);
		expect(rule.predicate).toBeUndefined();
		expect(rule.uuids.map((u) => doc(u).name).sort()).toEqual(['Shadow Blast', 'Summon Shadow']);
		expect(d.system.gainedAtLevels).toEqual([1]);
	});

	it('0.2: Summon Shadow, Command Shadows, Shadow Blast (Nim+), supersedes the system Conduit', () => {
		const d = doc(CONDUIT.nim);
		const [rule] = grantRules(d);
		expect(rule.mode).toBe('auto');
		expect(rule.predicate).toBeUndefined();
		expect(rule.uuids).toEqual([SUMMON_SHADOW.nim, COMMAND_SHADOWS, SHADOW_BLAST.nim]);
		expect(d.flags[MODULE_ID].supersedes).toEqual([CONDUIT.sys]);
		expect(d.system).toMatchObject({ class: 'shadowmancer', group: 'shadowmancer-progression', gainedAtLevel: 1, subclass: false });
	});
});

describe('0.2 cantrips', () => {
	it('Shadow Blast uses DEX (2.0.3: KEY), +1d12 per 5 levels, necrotic tier-0 Shadowmancer cantrip', () => {
		const nim = doc(SHADOW_BLAST.nim);
		const sys = doc(SHADOW_BLAST.sys);
		const formula = (d) => d.system.activation.effects.find((e) => e.type === 'damage').formula;
		expect(formula(nim)).toBe('1d12+@dexterity + (floor(@level / 5))d12');
		expect(formula(sys)).toBe('1d12+@key + (floor(@level / 5))d12');
		expect(nim.system.description.baseEffect).toMatch(/1d12\+DEX/);
		expect(nim.system.description.higherLevelEffect).toMatch(/\+1d12 every 5 levels/);
		expect(nim.system).toMatchObject({ school: 'necrotic', tier: 0, classes: ['shadowmancer'] });
		expect(nim.flags[MODULE_ID].supersedes).toEqual([SHADOW_BLAST.sys]);
	});

	it('Summon Shadow: limit INT, +1 Shadow every 5 levels (2.0.3: min(INT, LVL), +1 Reach per 5)', () => {
		const nim = doc(SUMMON_SHADOW.nim);
		expect(nim.system.description.baseEffect).toMatch(/up to INT Shadows/);
		expect(nim.system.description.baseEffect).not.toMatch(/LVL/);
		expect(nim.system.description.higherLevelEffect).toMatch(/\+1 Shadow every 5 levels/);
		expect(nim.system).toMatchObject({ school: 'necrotic', tier: 0, classes: ['shadowmancer'] });
		expect(nim.flags[MODULE_ID].supersedes).toEqual([SUMMON_SHADOW.sys]);
		const sys = doc(SUMMON_SHADOW.sys);
		expect(sys.system.description.baseEffect).toMatch(/INT or LVL minions/);
		expect(sys.system.description.higherLevelEffect).toMatch(/\+1 Reach every 5 levels/);
	});

	it('Command Shadows is a 0.2-only cantrip (no system original)', () => {
		const d = doc(COMMAND_SHADOWS);
		expect(d.flags[MODULE_ID]).toEqual({ playtest02: true });
		expect(d.system).toMatchObject({ school: 'necrotic', tier: 0, classes: ['shadowmancer'] });
		expect(d.system.description.baseEffect).toMatch(/ALL your Shadows move 6 then attack/);
		expect(findDocs({ pack: 'nimble.nimble-spells', name: 'Command Shadows' })).toEqual([]);
	});

	it('Vengeful Blast is retired in 0.2', async () => {
		const oracle = await supersedeOracle();
		expect(oracle.retired.has(VENGEFUL_BLAST)).toBe(true);
		expect(findDocs({ pack: `${MODULE_ID}.nim-plus-class-features`, name: 'Vengeful Blast' })).toEqual([]);
	});

	it('the rule texts agree (skipped when the extracted texts are absent)', () => {
		const t02 = readText('Shadowmancer-0.2.txt');
		const t203 = readText('Heroes-2.0.3-1stPrinting.txt');
		if (!t02 || !t203) return;
		expect(t02).toMatch(/Damage: 1d12\+DEX \(1\/round\)/);
		expect(t02).toMatch(/Shadow Limit\. You can have up to INT Shadows\./);
		expect(t02).toMatch(/High Levels: \+1 Shadow every 5 levels\./);
		expect(t02).toMatch(/Command Shadows[^\n]*1 Action/);
		expect(t02).not.toMatch(/Vengeful/);
		expect(t203).toMatch(/Damage: 1d12\+KEY/);
		expect(t203).not.toMatch(/Command Shadows/);
		expect(t02).toMatch(/LEVEL 2\s+Master of Darkness\. Learn all Necrotic cantrips and tier 1 Necrotic spells\./);
		expect(t02).toMatch(/LEVEL 1\s+Conduit of Shadow\. Learn the Shadowmancer cantrips\./);
		for (const [L, T] of [[5, 2], [7, 3], [10, 4], [13, 5], [16, 6], [19, 7]]) {
			for (const t of [t02, t203]) expect(t).toMatch(new RegExp(`LEVEL ${L}[\\s\\S]{0,400}?Tier ${T} Spells\\. You may now cast tier ${T} spells; all of your spells are cast at this tier\\.`));
		}
	});
});

describe.each([
	['2.0.3', false],
	['0.2', true],
])('what the %s index shows (playtest %s)', (version, playtest) => {
	let env;
	beforeAll(async () => {
		({ env } = await setupWorld({ playtest }));
	});
	const has = async (uuid) => {
		const [, pkg, pack, , id] = uuid.split('.');
		const p = env.game.packs.get(`${pkg}.${pack}`);
		await p.getIndex({ fields: ['system.school'] });
		return p.index.has(id);
	};

	it('Master of Darkness, Pilfered Power and Shadowmastery stay visible', async () => {
		for (const u of [MASTER_OF_DARKNESS, PILFERED_POWER, SHADOWMASTERY]) expect(await has(u), u).toBe(true);
	});

	it('exactly one Conduit of Shadow, Shadow Blast and Summon Shadow; Command Shadows only in 0.2; Vengeful Blast only in 2.0.3', async () => {
		const on = version === '0.2';
		for (const pair of [CONDUIT, SHADOW_BLAST, SUMMON_SHADOW]) {
			expect(await has(pair.sys), pair.sys).toBe(!on);
			expect(await has(pair.nim), pair.nim).toBe(on);
		}
		expect(await has(COMMAND_SHADOWS)).toBe(on);
		expect(await has(VENGEFUL_BLAST)).toBe(!on);
		for (const pair of [NIGHTFROST, CRIMSON]) {
			expect(await has(pair.sys)).toBe(!on);
			expect(await has(pair.nim)).toBe(on);
		}
	});
});
