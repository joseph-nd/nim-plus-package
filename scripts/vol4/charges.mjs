// ── Charge helper for macro items ────────────────────────────────────────────
// The macro path replaces the regular activation flow, so `chargeConsumer`
// rules never fire for macro items — decrement the pool flag directly.
export const CHARGE_POOL_FLAG_PATH = 'flags.nimble.chargePools';

export async function vol4SpendCharge(item, identifier) {
	const pools = foundry.utils.getProperty(item, CHARGE_POOL_FLAG_PATH) ?? {};
	const pool = pools[identifier];
	const rule = (item.system?.rules ?? []).find(
		(r) => r?.type === 'chargePool' && r?.identifier === identifier,
	);
	const max = Number(pool?.max ?? rule?.max ?? 1);
	const current = Number(pool?.current ?? max);
	if (current < 1) {
		ui.notifications?.warn(`${item.name} has no charges remaining.`);
		return false;
	}
	await item.update({
		[`${CHARGE_POOL_FLAG_PATH}.${identifier}`]: {
			...(pool ?? { identifier, scope: 'item', sourceItemId: item.id, max }),
			current: current - 1,
		},
	});
	return true;
}

