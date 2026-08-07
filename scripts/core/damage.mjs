/** Depth-first search for the first `type:'damage'` node carrying a formula. */
export function findFirstDamageNode(effects) {
	if (!Array.isArray(effects)) return null;
	for (const node of effects) {
		if (!node || typeof node !== 'object') continue;
		if (node.type === 'damage' && typeof node.formula === 'string' && node.formula.trim()) return node;
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				const found = findFirstDamageNode(value);
				if (found) return found;
			} else if (value && typeof value === 'object') {
				const found = findFirstDamageNode([value]);
				if (found) return found;
			}
		}
	}
	return null;
}
