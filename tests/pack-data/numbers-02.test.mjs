/**
 * Spot-checks of 0.2 numbers in the Nim+ copies against the 0.2 rules text
 * (scratchpad/core02/txt/<Class>-0.2.txt). Each case asserts the data AND that the rules text says so,
 * so a wrong expectation here fails loudly instead of silently blessing wrong data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDoc, findDocs as findDocsRaw } from '../harness/index.mjs';
import { TXT_DIR, txt } from './lib.mjs';

const NIM_FEATURES = 'nim-plus-package.nim-plus-class-features';
const NIM_SPELLS = 'nim-plus-package.nim-plus-spells';

const feature = (name, cls) => findDoc({ pack: NIM_FEATURES, name, class: cls }).doc;
const spell = (name) => findDoc({ pack: NIM_SPELLS, name }).doc;
const rules = (doc, type) => (doc.system.rules ?? []).filter((r) => r.type === type);
const levels = (doc) => doc.system.gainedAtLevels ?? [doc.system.gainedAtLevel];

/** Collapse the two-column layout's runs of spaces so phrases can be matched. */
const flat = (name) => txt(name).replace(/[’‘]/g, "'").replace(/\s+/g, ' ');

const hasTexts = fs.existsSync(path.join(TXT_DIR, 'Commander-0.2.txt'));

describe.skipIf(!hasTexts)('pack-data: 0.2 numbers vs the rules text', () => {
	it('Berserker — Boundless Rage: level 20, Fury Dice floor 5', () => {
		expect(flat('Berserker-0.2.txt')).toMatch(/LEVEL 20 BOUNDLESS RAGE\. \+1 to any 2 of your stats\. Anytime you roll less/);
		expect(flat('Berserker-0.2.txt')).toMatch(/than 5 on a Fury Die, change it to 5 instead/);
		const doc = feature('Boundless Rage', 'berserker');
		expect(levels(doc)).toEqual([20]);
		const [floor] = rules(doc, 'modifyPool');
		expect(floor).toMatchObject({ poolType: 'dice', poolIdentifier: 'fury', minFace: 5 });
	});

	it('Commander — Coordinated Strike! is a level 1 progression feature, 1/encounter', () => {
		expect(flat('Commander-0.2.txt')).toMatch(/LEVEL 1 Coordinated Strike! \(1\/encounter\)/);
		const doc = feature('Coordinated Strike!', 'commander');
		expect(levels(doc)).toEqual([1]);
		expect(doc.system.group).toBe('commander-progression');
		const enc = rules(doc, 'chargePool').find((r) => r.identifier === 'coordinated-strike-encounter');
		expect(enc).toMatchObject({ max: '1' });
		expect(enc.recoveries.map((r) => r.trigger)).toEqual(expect.arrayContaining(['encounterStart']));
	});

	it('Commander — Master Commander: INT uses per Safe Rest from level 5, +1 at 9, 13 and 17', () => {
		const t = flat('Commander-0.2.txt');
		expect(t).toMatch(/LEVEL 5 Master Commander\. Your Combat Dice are now d8s\. You gain an additional pool of INT/);
		for (const [lvl, n] of [[9, 2], [13, 3], [17, 4]]) {
			expect(t).toMatch(new RegExp(`LEVEL ${lvl} Master Commander \\(${n}\\)\\.[^.]*\\.\\s*\\+1 use of Coordinated Strike`));
		}
		const uses = rules(feature('Coordinated Strike!', 'commander'), 'chargePool').find((r) => r.identifier === 'coordinated-strike-uses');
		expect(uses.max).toBe('max(@intelligence, 0)');
		expect(uses.predicate).toEqual({ level: { min: 5 } });
		expect(uses.recoveries.map((r) => r.trigger)).toEqual(['safeRest']);
		const mc = feature('Master Commander', 'commander');
		expect(levels(mc)).toEqual([5, 9, 13, 17]);
		const bumps = rules(mc, 'modifyPool').filter((r) => r.poolIdentifier === 'coordinated-strike-uses');
		expect(bumps.map((r) => [r.predicate.level.min, r.maxDelta])).toEqual([[9, '1'], [13, '1'], [17, '1']]);
	});

	it('Commander — Fit for Any Battlefield at 2, then 6/8/10/12/16', () => {
		const t = flat('Commander-0.2.txt');
		expect(t).toMatch(/LEVEL 2 Fit for Any Battlefield\. Choose a Combat Tactic/);
		for (const [lvl, n] of [[6, 2], [8, 3], [10, 4], [12, 5], [16, 6]]) expect(t).toMatch(new RegExp(`LEVEL ${lvl} Fit for Any Battlefield \\(${n}\\)`));
		expect(levels(feature('Fit for Any Battlefield', 'commander'))).toEqual([2, 6, 8, 10, 12, 16]);
	});

	it("Commander — Commander's Orders at level 4, choose 2", () => {
		expect(flat('Commander-0.2.txt')).toMatch(/LEVEL 4 Commander's Orders\. Choose 2 Commander's Orders\./);
		expect(levels(feature("Commander's Orders", 'commander'))).toEqual([4]);
		const orders = [...new Set(['Commanding Presence', 'Face Me!', 'Hold the Line!', 'Reposition', 'Move It, Move It!', 'I Can Do This All Day!'])];
		const docs = orders.map((n) => findDoc({ pack: NIM_FEATURES, class: 'commander', group: 'commanders-orders', where: (d) => d.name.toLowerCase().replace(/[^a-z]/g, '') === n.toLowerCase().replace(/[^a-z]/g, '') }).doc);
		for (const d of docs) {
			expect(d.system.gainedAtLevels[0]).toBe(4);
			expect(d.system.selectionCountByLevel['4']).toBe(2);
		}
	});

	it('Shepherd — Sacred Graces at 4, 9 and 13 (one each)', () => {
		const t = flat('Shepherd-0.2.txt');
		expect(t).toMatch(/LEVEL 4 Sacred Grace\. Choose 1 Sacred Grace\./);
		expect(t).toMatch(/LEVEL 9 Sacred Grace \(2\)\. Choose a 2nd Sacred Grace\./);
		expect(t).toMatch(/LEVEL 13 Sacred Grace \(3\)\. Choose a 3rd Sacred Grace\./);
		expect(levels(feature('Sacred Graces', 'shepherd'))).toEqual([4, 9, 13]);
		const graces = findDocs02({ class: 'shepherd', group: 'sacred-grace' });
		expect(graces.length).toBeGreaterThanOrEqual(4);
		for (const g of graces) {
			expect(g.system.gainedAtLevels).toEqual([4, 9, 13]);
			expect(g.system.selectionCountByLevel).toEqual({ 4: 1, 9: 1, 13: 1 });
		}
	});

	it('Stormshifter — Direbeast Form at 1, 2 and 5; Chimeric Boons 6 (choose 2), 9, 12, 17', () => {
		const t = flat('Stormshifter-0.2.txt');
		expect(t).toMatch(/LEVEL 5 Direbeast Form \(3\)/);
		expect(t).toMatch(/Direbeast Form \(2\)\. You can Beastshift into a Beast of the Pack/);
		expect(t).toMatch(/LEVEL 6 Chimeric Boon\. Choose 2 Chimeric Boons/);
		expect(t).toMatch(/LEVEL 17 Chimeric Boon \(4\)/);
		expect(levels(feature('Direbeast Form', 'stormshifter'))).toEqual([1, 2, 5]);
		const boons = findDocs02({ class: 'stormshifter', group: 'chimeric-boon' });
		expect(boons.length).toBeGreaterThan(0);
		for (const b of boons) {
			expect(b.system.gainedAtLevels).toEqual([6, 9, 12, 17]);
			expect(b.system.selectionCountByLevel['6']).toBe(2);
		}
	});

	it('Oathsworn — Unstoppable Protector: +2 Speed', () => {
		expect(flat('Oathsworn-0.2.txt')).toMatch(/Gain \+2 Speed\. Nothing can stop you from Interposing/);
		const [speed] = rules(feature('Unstoppable Protector', 'oathsworn'), 'speedBonus');
		expect(String(speed.value)).toBe('2');
	});

	it('Shadowmancer — Shadow Blast: Range 8, 1d12+DEX, +1d12 every 5 levels', () => {
		expect(flat('Shadowmancer-0.2.txt')).toMatch(/Shadow Blast\. 1 Action, Range: 8\. Damage: 1d12\+DEX \(1\/round\)/);
		const doc = spell('Shadow Blast');
		const [dmg] = doc.system.activation.effects.filter((e) => e.type === 'damage');
		expect(dmg.formula.replace(/\s/g, '')).toMatch(/^1d12\+@dexterity\+\(floor\(@level\/5\)\)d12$/);
		expect(doc.system.description.baseEffect).toMatch(/Range<\/strong>: 8/);
	});

	it('Zap: 2d8, +4 damage every 5 levels', () => {
		const doc = spell('Zap');
		const [dmg] = doc.system.activation.effects.filter((e) => e.type === 'damage');
		expect(dmg.formula.replace(/\s/g, '')).toBe('2d8+floor(@level/5)*4');
		expect(doc.system.description.higherLevelEffect).toMatch(/\+4 damage every 5 levels/);
	});

	it('Oathsworn — Radiant Judgment starts at level 1 with 2d6 Judgment Dice', () => {
		expect(flat('Oathsworn-0.2.txt')).toMatch(/LEVEL 1 Radiant Judgment\. Whenever an enemy attacks you, roll and set aside 2d6 Judgment/);
		const doc = findDoc({ pack: NIM_FEATURES, class: 'oathsworn', where: (d) => /^Radiant Judge?ment$/.test(d.name) }).doc;
		expect(levels(doc)[0]).toBe(1);
	});
});

function findDocs02(q) {
	return findDocsRaw({ pack: NIM_FEATURES, ...q }).map((h) => h.doc);
}

