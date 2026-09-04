import { refreshBulwarkAuras } from './armor.mjs';

// Only player-character token changes can alter a Bulwark aura (both the owner
// and the beneficiary are always PCs), so NPC/monster/minion movement is ignored.
const isPlayerCharacterToken = (doc) => doc?.actor?.type === 'character';
Hooks.on('updateToken', (doc, changes) => {
	if (!('x' in changes || 'y' in changes)) return;
	if (!isPlayerCharacterToken(doc)) return;
	refreshBulwarkAuras(doc.parent);
	// Foundry v14 routes position updates through the movement system: inside
	// this hook the document still reports the origin, and the adjacency maths
	// reads document coordinates. Refresh again once the move has settled.
	const settled = doc.object?.movementAnimationPromise;
	if (settled) {
		Promise.resolve(settled)
			.then(() => refreshBulwarkAuras(doc.parent))
			.catch(() => {});
	}
});
Hooks.on('createToken', (doc) => {
	if (isPlayerCharacterToken(doc)) refreshBulwarkAuras(doc.parent);
});
Hooks.on('deleteToken', (doc) => {
	if (isPlayerCharacterToken(doc)) refreshBulwarkAuras(doc.parent);
});
Hooks.on('canvasReady', () => refreshBulwarkAuras(canvas?.scene));
