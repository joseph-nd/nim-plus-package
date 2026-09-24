/**
 * Example: the supersede index filter (scripts/core/supersede.mjs) against the
 * real packs and the Foundry v14 CompendiumCollection index semantics.
 */
import { describe, expect, it } from 'vitest';
import { setupWorld, supersedeOracle } from '../harness/index.mjs';

const SYSTEM_FEATURES = 'nimble.nimble-class-features';
const NIM_FEATURES = 'nim-plus-package.nim-plus-class-features';

function idOf(uuid) {
	return uuid.split('.').pop();
}

describe('harness: supersede filter', () => {
	it('builds the same relationships as the pack-data oracle', async () => {
		const { mods } = await setupWorld({ playtest: true });
		const [, supersede] = mods;
		const data = await supersede.supersedeData();
		const oracle = await supersedeOracle();
		expect(new Map(data.supersededBy)).toEqual(oracle.supersededBy);
		expect(data.playtestOnly).toEqual(oracle.playtestOnly);
		expect(data.retired).toEqual(oracle.retired);
		expect(data.enabled).toBe(true);
	});

	it('playtest on: hides superseded + retired system entries, even after a re-index', async () => {
		const { env, mods } = await setupWorld({ playtest: true });
		const [, supersede] = mods;
		const oracle = await supersedeOracle();
		const pack = env.game.packs.get(SYSTEM_FEATURES);
		const hiddenIds = [...oracle.hiddenWhen(true)]
			.filter((u) => u.startsWith(`Compendium.${SYSTEM_FEATURES}.`))
			.map(idOf);
		expect(hiddenIds.length).toBeGreaterThan(0);

		// The setup-time purge already ran.
		for (const id of hiddenIds) expect(pack.index.has(id)).toBe(false);
		expect(pack.treeInitializations).toBeGreaterThan(0);

		// A getIndex with a new field re-reads the whole pack (Foundry v14) — the wrapper purges again.
		await pack.getIndex({ fields: ['system.description'] });
		for (const id of hiddenIds) expect(pack.index.has(id)).toBe(false);

		// Loading a hidden document re-indexes it; the indexDocument wrapper removes it again,
		// but the document itself still resolves (existing characters need their sources).
		const doc = await fromUuid(`Compendium.${SYSTEM_FEATURES}.Item.${hiddenIds[0]}`);
		expect(doc?.id).toBe(hiddenIds[0]);
		expect(pack.index.has(hiddenIds[0])).toBe(false);
		expect(supersede.isHiddenUuid(doc.uuid)).toBe(true);

		// The Nim+ 0.2 copies stay visible.
		const nim = env.game.packs.get(NIM_FEATURES);
		const some02 = [...oracle.supersedes.keys()].find((u) => u.startsWith(`Compendium.${NIM_FEATURES}.`));
		expect(nim.index.has(idOf(some02))).toBe(true);
	});

	it('playtest off: hides the Nim+ 0.2 copies instead', async () => {
		const { env } = await setupWorld({ playtest: false });
		const oracle = await supersedeOracle();
		const nim = env.game.packs.get(NIM_FEATURES);
		await nim.getIndex({ fields: ['system.group'] });
		for (const uuid of oracle.hiddenWhen(false)) {
			if (!uuid.startsWith(`Compendium.${NIM_FEATURES}.`)) continue;
			expect(nim.index.has(idOf(uuid))).toBe(false);
		}
		const sys = env.game.packs.get(SYSTEM_FEATURES);
		for (const uuid of oracle.supersededBy.keys()) {
			if (uuid.startsWith(`Compendium.${SYSTEM_FEATURES}.`)) expect(sys.index.has(idOf(uuid))).toBe(true);
		}
	});

	it('readUnfilteredIndex sees hidden entries without touching pack.index', async () => {
		const { env, mods } = await setupWorld({ playtest: true });
		const [, supersede] = mods;
		const pack = env.game.packs.get(SYSTEM_FEATURES);
		const before = pack.index.size;
		const all = await supersede.readUnfilteredIndex(pack, ['system.class']);
		expect(all.length).toBeGreaterThan(before);
		expect(pack.index.size).toBe(before);
		expect(all[0].uuid).toMatch(/^Compendium\.nimble\.nimble-class-features\.Item\./);
	});
});
