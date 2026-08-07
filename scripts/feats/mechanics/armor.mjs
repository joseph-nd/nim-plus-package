import { MODULE_ID } from '../../core/constants.mjs';
import { featsEnabled } from '../settings.mjs';
import { actorOwnsFeat, hasDexMeleeWeapon, isDualWielding } from './helpers.mjs';

// ── Armor feats: Defensive Duelist, Dual Wielder, Bulwark aura ───────────────

function sceneGridSize(scene) {
	return scene?.grid?.size ?? scene?.dimensions?.size ?? 100;
}

/**
 * True when token docs `a` and `b` occupy directly-adjacent (incl. diagonal)
 * cells. Each token's cell box is derived from its top-left position and width/
 * height; `a`'s box is expanded by one cell and tested for overlap with `b`'s.
 * Handles multi-cell tokens and treats overlapping tokens as adjacent.
 */
function tokenDocsAdjacent(a, b, size) {
	const ax = Math.floor(a.x / size);
	const ay = Math.floor(a.y / size);
	const bx = Math.floor(b.x / size);
	const by = Math.floor(b.y / size);
	const aw = Math.max(1, Math.round(a.width ?? 1));
	const ah = Math.max(1, Math.round(a.height ?? 1));
	const bw = Math.max(1, Math.round(b.width ?? 1));
	const bh = Math.max(1, Math.round(b.height ?? 1));
	const aMinX = ax - 1;
	const aMaxX = ax + aw;
	const aMinY = ay - 1;
	const aMaxY = ay + ah;
	const bMinX = bx;
	const bMaxX = bx + bw - 1;
	const bMinY = by;
	const bMaxY = by + bh - 1;
	return aMinX <= bMaxX && bMinX <= aMaxX && aMinY <= bMaxY && bMinY <= aMaxY;
}

/**
 * +2 Armor for each allied Bulwark owner whose token is adjacent to one of this
 * actor's tokens on the active scene. Allies are tokens sharing this actor's
 * disposition. Requires a ready canvas; returns 0 during load (the aura is
 * recomputed on canvasReady and on any token move — see the hooks below).
 */
function bulwarkAuraBonus(actor) {
	if (!canvas?.ready) return 0;
	const scene = canvas.scene;
	if (!scene) return 0;
	const all = scene.tokens?.contents ?? Array.from(scene.tokens ?? []);
	const mine = all.filter((t) => t.actorId === actor.id);
	if (!mine.length) return 0;
	const size = sceneGridSize(scene);
	let total = 0;
	for (const other of all) {
		const oa = other.actor;
		if (!oa || oa.id === actor.id) continue;
		if (oa.type !== 'character') continue; // PC-owned Bulwark only — never NPCs/monsters/minions
		if (!actorOwnsFeat(oa, 'bulwark')) continue;
		if (other.disposition !== mine[0].disposition) continue; // allies share disposition
		if (mine.some((m) => tokenDocsAdjacent(other, m, size))) total += 2;
	}
	return total;
}

/**
 * Apply conditional feat Armor bonuses to the already-computed AC. Called from
 * the patched character `prepareDerivedData` (see the `setup` hook), so it runs
 * after the system has finished its own AC math. Derived-only: re-evaluated each
 * prepare, so a bonus is applied exactly once and self-clears with its condition.
 */
export function applyFeatArmorAdjustments(actor) {
	if (actor?.type !== 'character') return;
	if (!featsEnabled()) return;
	const armor = actor.system?.attributes?.armor;
	if (!armor || typeof armor.value !== 'number') return;

	let bonus = 0;
	const parts = [];
	if (actorOwnsFeat(actor, 'defensive-duelist') && hasDexMeleeWeapon(actor)) {
		bonus += 2;
		parts.push('Defensive Duelist');
	}
	if (actorOwnsFeat(actor, 'dual-wielder') && isDualWielding(actor)) {
		bonus += 1;
		parts.push('Dual Wielder');
	}
	const aura = bulwarkAuraBonus(actor);
	if (aura > 0) {
		bonus += aura;
		parts.push(aura > 2 ? `Bulwark ×${aura / 2}` : 'Bulwark');
	}

	if (bonus !== 0) {
		armor.value += bonus;
		armor.hint = `${armor.hint ?? ''} + ${parts.join(' + ')}`.trim();
	}
}

/**
 * Re-prepare every character with a token on `scene` so Bulwark auras refresh
 * after movement / token changes. No-op unless the Feats setting is on and at
 * least one token on the scene owns Bulwark, keeping the common case cheap.
 */
export function refreshBulwarkAuras(scene) {
	if (!featsEnabled() || !canvas?.ready) return;
	const sc = scene ?? canvas.scene;
	if (!sc) return;
	const tokens = sc.tokens?.contents ?? Array.from(sc.tokens ?? []);
	if (!tokens.some((t) => t.actor && actorOwnsFeat(t.actor, 'bulwark'))) return;
	const seen = new Set();
	for (const t of tokens) {
		const a = t.actor;
		if (!a || a.type !== 'character' || seen.has(a.id)) continue;
		seen.add(a.id);
		try {
			a.prepareData();
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to re-prepare actor for Bulwark aura`, error);
		}
		for (const app of Object.values(a.apps ?? {})) app?.render?.(false);
	}
}

// The canvas hooks that drive this live in `./bulwark-hooks.mjs`, so that
// importing the AC maths never drags a hook registration along with it.
