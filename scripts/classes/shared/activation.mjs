/**
 * The item activation currently in flight, as a stack (an activation can open a
 * dialog and await it, so in principle another can start on top). The DamageRoll
 * patch reads the top of the stack to learn which actor/item it is rolling for —
 * `DamageRoll` itself carries no back-reference to either.
 *
 * The stack is pushed and popped by the activation lifecycle patch in
 * `../activation-lifecycle.mjs`; every other consumer only reads the top entry
 * and may annotate it (`entry.sneak`, `entry.tactic`) for the lifecycle to pick
 * up once the activation resolves.
 */
export const activationStack = [];

export function currentActivation() {
	return activationStack.at(-1) ?? null;
}
