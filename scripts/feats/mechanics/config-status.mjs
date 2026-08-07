import { MODULE_ID } from '../../core/constants.mjs';

// Feats owned but not yet configured — surfaced as buttons in the sheet panel.
export function featsNeedingConfig(actor) {
	const out = [];
	const academic = actor?.items?.find?.((i) => i.system?.identifier === 'academic');
	if (academic && academic.getFlag(MODULE_ID, 'academicAllocated') !== true) {
		out.push({ kind: 'academic', label: 'Allocate Academic points' });
	}
	const elemental = actor?.items?.find?.((i) => i.system?.identifier === 'elemental-specialist');
	if (elemental && !elemental.getFlag(MODULE_ID, 'elementalChosen')) {
		out.push({ kind: 'elemental', label: 'Choose Elemental school' });
	}
	return out;
}
