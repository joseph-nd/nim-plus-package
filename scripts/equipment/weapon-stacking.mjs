import { MODULE_ID } from '../core/constants.mjs';

/**
 * Split a quantity>1 weapon document (e.g. a kit or class grant of "2 Hand
 * Axes" arrives as one stack) into individual documents so each weapon can be
 * equipped independently. Runs only on the creating user's client. The created
 * copies have quantity 1, so the hook never recurses.
 */
Hooks.on('createItem', (item, _options, userId) => {
	if (userId !== game.user?.id) return;
	if (!item?.isEmbedded || item.type !== 'object') return;
	if (item.system?.objectType !== 'weapon') return;
	const quantity = Number(item.system?.quantity ?? 1);
	if (!Number.isFinite(quantity) || quantity <= 1) return;
	const actor = item.actor;
	const source = item.toObject();
	delete source._id;
	source.system.quantity = 1;
	const copies = Array.from({ length: quantity - 1 }, () => foundry.utils.deepClone(source));
	item
		.update({ 'system.quantity': 1 })
		.then(() => actor.createEmbeddedDocuments('Item', copies))
		.catch((error) => console.error(`[${MODULE_ID}] Failed to split weapon stack`, error));
});
