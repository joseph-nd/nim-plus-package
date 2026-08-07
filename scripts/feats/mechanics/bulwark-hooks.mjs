import { refreshBulwarkAuras } from './armor.mjs';

// Only player-character token changes can alter a Bulwark aura (both the owner
// and the beneficiary are always PCs), so NPC/monster/minion movement is ignored.
const isPlayerCharacterToken = (doc) => doc?.actor?.type === 'character';
Hooks.on('updateToken', (doc, changes) => {
	if (!('x' in changes || 'y' in changes)) return;
	if (!isPlayerCharacterToken(doc)) return;
	refreshBulwarkAuras(doc.parent);
});
Hooks.on('createToken', (doc) => {
	if (isPlayerCharacterToken(doc)) refreshBulwarkAuras(doc.parent);
});
Hooks.on('deleteToken', (doc) => {
	if (isPlayerCharacterToken(doc)) refreshBulwarkAuras(doc.parent);
});
Hooks.on('canvasReady', () => refreshBulwarkAuras(canvas?.scene));
