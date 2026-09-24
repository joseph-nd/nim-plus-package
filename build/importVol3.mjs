/* eslint-disable no-console */
/**
 * Import Nim+ Volume 3 subclass sheets into pack-sources.
 *
 *   node build/importVol3.mjs berserker the-cheat commander [--dry] [--vol3=<dir>]
 *
 * For every Vol 3 subclass of the given classes it
 *   - rewrites the subclass JSON's `name` and `system.description`
 *     (`<p><em>flavor</em></p><p>LEVEL N</p><p><strong>Feature.</strong> text</p>…`),
 *   - updates each surviving feature JSON (name, identifier, description, gainedAtLevels),
 *     keeping its `_id`, img, rules, macro, flags and activation,
 *   - creates JSON for features new in Vol 3 (no `_id`; the build assigns one),
 *   - deletes features Vol 3 dropped (JSON + icon + ids.json entry),
 *   - renames files/icons/ids.json keys for renamed features.
 *
 * Subclass renames (Path of the Titans → Path of the Titan, …) must be done
 * before running this: the script finds the repo subclass by the slug of the
 * Vol 3 name (see SUBCLASS_IDENTIFIERS for the exceptions).
 *
 * Extra paragraphs that the current description carries between the flavor
 * line and the first LEVEL heading (e.g. a collaboration note) are preserved.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOURCES = path.join(ROOT, 'pack-sources');
const ASSETS = path.join(ROOT, 'assets');
const MODULE_ID = 'nim-plus-package';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const vol3Arg = args.find((a) => a.startsWith('--vol3='));
const VOL3 = vol3Arg
	? path.resolve(vol3Arg.slice('--vol3='.length))
	: path.join(os.homedir(), 'Documents', 'Nim+ Vol 3', 'Markdown');
const classSlugs = args.filter((a) => !a.startsWith('--'));

/** Vol 3 class directory → repo class slug. */
const CLASS_DIRS = {
	Berserker: 'berserker',
	'Cheat, The': 'the-cheat',
	Commander: 'commander',
	Hunter: 'hunter',
	Mage: 'mage',
	Oathsworn: 'oathsworn',
	Shadowmancer: 'shadowmancer',
	Shepherd: 'shepherd',
	Songweaver: 'songweaver',
	Stormshifter: 'stormshifter',
	Zephyr: 'zephyr',
};

/** Vol 3 subclass name → repo identifier, where the slug of the name is not it. */
const SUBCLASS_IDENTIFIERS = {
	'Circle of Sun & Moon': 'circle-of-sun-and-moon',
	'Circle of Blaze & Bloom': 'circle-of-blaze-and-bloom',
};

/** Vol 3 feature name → current repo feature name, for renamed features. */
const FEATURE_RENAMES = {
	'Blood of the Titan': 'Blood of the Titans',
	'Studied Strike': 'Studied Strikes',
};

const slug = (s) =>
	s
		.toLowerCase()
		.replace(/&/g, 'and')
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

const escapeHtml = (s) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline markdown → HTML: **bold**, *italic*, tabs, curly quotes normalised. */
function inline(md) {
	let t = escapeHtml(md.replace(/\t+/g, ' ').replace(/ {2,}/g, ' ').trim());
	t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	t = t.replace(/(^|[\s(])\*([^*]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
	return t;
}

/**
 * Feature markdown → { html: full description, lead: first paragraph html,
 * rest: html of the remaining blocks, levels: {level: html} for split sheets }.
 */
function featureHtml(md) {
	const lines = md.replace(/\r/g, '').split('\n');
	const blocks = [];
	let para = [];
	let list = null;
	let callout = null; // Obsidian `> [!tip]- Title` block → <blockquote>
	const flush = () => {
		if (callout) {
			const title = callout.title ? `<p><strong>${inline(callout.title)}</strong></p>` : '';
			blocks.push(`<blockquote>${title}<p>${inline(callout.lines.join(' '))}</p></blockquote>`);
			callout = null;
		}
		if (list) {
			blocks.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`);
			list = null;
		}
		if (para.length) {
			blocks.push(`<p>${inline(para.join(' '))}</p>`);
			para = [];
		}
	};
	const levels = {};
	let currentLevel = null;
	const levelBlocks = {};
	for (const raw of lines) {
		const line = raw.trim();
		if (!line || line === '---') {
			flush();
			continue;
		}
		const lv = line.match(/^\*\*Level (\d+)\*\*$/);
		if (lv) {
			flush();
			currentLevel = Number(lv[1]);
			levelBlocks[currentLevel] = blocks.length;
			continue;
		}
		const quote = line.match(/^>\s?(.*)$/);
		if (quote) {
			if (!callout) {
				flush();
				const head = quote[1].match(/^\[!\w+\][-+]?\s*(.*)$/);
				callout = { title: head ? head[1] : '', lines: head ? [] : [quote[1]] };
			} else callout.lines.push(quote[1]);
			continue;
		}
		if (callout) flush();
		const li = line.match(/^[-*•]\s+(.*)$/);
		if (li) {
			if (para.length) flush();
			(list ??= []).push(li[1]);
			continue;
		}
		if (list) flush();
		para.push(line);
	}
	flush();
	const levelKeys = Object.keys(levelBlocks).map(Number);
	if (levelKeys.length) {
		for (let i = 0; i < levelKeys.length; i += 1) {
			const start = levelBlocks[levelKeys[i]];
			const end = i + 1 < levelKeys.length ? levelBlocks[levelKeys[i + 1]] : blocks.length;
			levels[levelKeys[i]] = blocks.slice(start, end).join('');
		}
	}
	const lead = blocks[0] ?? '<p></p>';
	return { html: blocks.join(''), lead, rest: blocks.slice(1).join(''), levels };
}

/** Best-effort activation cost from the rules text (only used for NEW features). */
function inferCost(text) {
	let details = '';
	let body = text.trim();
	const paren = body.match(/^\(([^)]{1,40})\)\s*/);
	if (paren) {
		details = paren[1];
		body = body.slice(paren[0].length);
	}
	let type = 'none';
	let quantity = 1;
	let isReaction = false;
	const m = body.match(/^(?:(\d)\s*actions?|action|free action|reaction|action\/reaction)\b\s*(?:\(([^)]*)\))?\s*:/i);
	if (m) {
		const head = m[0].toLowerCase();
		if (head.includes('reaction')) {
			type = 'reaction';
			isReaction = true;
		} else if (head.startsWith('free')) type = 'free';
		else type = 'action';
		if (m[1]) quantity = Number(m[1]);
		if (m[2]) details = details ? `${details} — ${m[2]}` : m[2];
	} else if (/^\(?\d\/(encounter|round|turn|safe rest)\)?\s*reaction/i.test(text) || /\bReaction\b/.test(body.slice(0, 40))) {
		type = 'reaction';
		isReaction = true;
	}
	return { details, quantity, type, isReaction };
}

function defaultActivation(cost) {
	return {
		acquireTargetsFromTemplate: false,
		cost,
		duration: { details: '', quantity: 1, type: 'none' },
		effects: [],
		showDescription: true,
		targets: { count: 1, restrictions: '' },
		template: { length: 1, radius: 1, shape: '', width: 1 },
	};
}

function newFeature({ name, cls, ident, html, levels, img }) {
	return {
		name,
		type: 'feature',
		img,
		system: {
			macro: '',
			identifier: slug(name),
			rules: [],
			activation: defaultActivation(inferCost(html.replace(/<[^>]+>/g, ''))),
			description: html,
			featureType: 'class',
			class: cls,
			group: ident,
			gainedAtLevels: levels,
			selectionCountByLevel: {},
			subclass: true,
		},
		effects: [],
		flags: {},
		_stats: {
			coreVersion: '14',
			systemId: 'nimble',
			systemVersion: '0.9.0',
			createdTime: null,
			modifiedTime: null,
			lastModifiedBy: null,
		},
	};
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf-8'));
const writeJson = (p, d) => {
	if (DRY) return;
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, `${JSON.stringify(d, null, '\t')}\n`.replace(/\n$/, ''), 'utf-8');
};
const rename = (from, to) => {
	if (!fs.existsSync(from)) return false;
	if (!DRY) {
		fs.mkdirSync(path.dirname(to), { recursive: true });
		fs.renameSync(from, to);
	}
	return true;
};
const remove = (p) => {
	if (!fs.existsSync(p)) return false;
	if (!DRY) fs.rmSync(p);
	return true;
};

/* ── ids.json bookkeeping ────────────────────────────────────────────────── */
const IDS_PATH = path.join(SOURCES, 'ids.json');
const ids = readJson(IDS_PATH);
let idsDirty = false;
const idKey = (file) => path.relative(SOURCES, file).replace(/\.json$/, '').split(path.sep);
function idsGetParent(parts, create) {
	let node = ids;
	for (const p of parts.slice(0, -1)) {
		if (!(p in node)) {
			if (!create) return null;
			node[p] = {};
		}
		node = node[p];
	}
	return node;
}
function idsMove(fromFile, toFile) {
	const from = idKey(fromFile);
	const to = idKey(toFile);
	const fromParent = idsGetParent(from, false);
	const value = fromParent?.[from.at(-1)];
	if (!value) return;
	delete fromParent[from.at(-1)];
	idsGetParent(to, true)[to.at(-1)] = value;
	idsDirty = true;
}
function idsDelete(file) {
	const key = idKey(file);
	const parent = idsGetParent(key, false);
	if (parent && key.at(-1) in parent) {
		delete parent[key.at(-1)];
		idsDirty = true;
	}
}
function sortKeys(value) {
	if (Array.isArray(value) || !(value instanceof Object)) return value;
	return Object.keys(value)
		.sort()
		.reduce((acc, k) => {
			acc[k] = sortKeys(value[k]);
			return acc;
		}, {});
}

/* ── Vol 3 parsing ───────────────────────────────────────────────────────── */
function parseSubclassSheet(file) {
	const txt = fs.readFileSync(file, 'utf-8').replace(/\r/g, '');
	const [head] = txt.split(/^---$/m);
	const flavor = [];
	let author = '';
	for (const raw of head.split('\n')) {
		const line = raw.trim();
		if (!line) continue;
		const by = line.match(/^\*\(by (.+)\)\*$/);
		if (by) author = by[1];
		else flavor.push(line.replace(/^\*|\*$/g, '').trim());
	}
	const levels = [];
	let current = null;
	for (const raw of txt.split('\n')) {
		const line = raw.trim();
		const lv = line.match(/^\*\*Level (\d+)\*\*$/);
		if (lv) {
			current = { level: Number(lv[1]), features: [] };
			levels.push(current);
			continue;
		}
		if (!current) continue;
		for (const m of line.matchAll(/\[\[([^\]|]+)/g)) current.features.push(m[1].trim());
	}
	return { name: path.basename(file, '.md'), flavor, author, levels };
}

function loadFeatureSheets(classDir) {
	const map = new Map();
	const featsDir = path.join(classDir, 'Subclass Feats');
	if (!fs.existsSync(featsDir)) return map;
	for (const sub of fs.readdirSync(featsDir)) {
		const dir = path.join(featsDir, sub);
		if (!fs.statSync(dir).isDirectory()) continue;
		for (const f of fs.readdirSync(dir)) {
			if (f.endsWith('.md')) map.set(path.basename(f, '.md'), fs.readFileSync(path.join(dir, f), 'utf-8'));
		}
	}
	return map;
}

/* ── main ────────────────────────────────────────────────────────────────── */
const report = { newFeatures: [], renamed: [], deleted: [], costWarnings: [], subclasses: [] };

for (const [dirName, cls] of Object.entries(CLASS_DIRS)) {
	if (classSlugs.length && !classSlugs.includes(cls)) continue;
	const classDir = path.join(VOL3, dirName);
	if (!fs.existsSync(classDir)) {
		console.warn(`[WARN] Vol 3 has no directory for ${dirName}`);
		continue;
	}
	const sheets = loadFeatureSheets(classDir);
	const subclassFiles = fs
		.readdirSync(classDir)
		.filter((f) => f.endsWith('.md'))
		.map((f) => path.join(classDir, f));

	for (const sheetFile of subclassFiles) {
		const sheet = parseSubclassSheet(sheetFile);
		const ident = SUBCLASS_IDENTIFIERS[sheet.name] ?? slug(sheet.name);
		const subclassPath = path.join(SOURCES, 'subclasses', cls, `${ident}.json`);
		if (!fs.existsSync(subclassPath)) {
			console.error(`[ERROR] ${cls}/${sheet.name}: no repo subclass ${path.relative(ROOT, subclassPath)} (rename first?)`);
			process.exitCode = 1;
			continue;
		}
		const featureDir = path.join(SOURCES, 'classFeatures', cls, `${cls}-subclasses`, ident);
		const iconDir = path.join(ASSETS, 'features', cls, ident);
		fs.mkdirSync(featureDir, { recursive: true });

		// Existing features by name.
		const existing = new Map();
		for (const f of fs.readdirSync(featureDir)) {
			if (!f.endsWith('.json')) continue;
			const file = path.join(featureDir, f);
			existing.set(readJson(file).name, file);
		}

		// Vol 3 features: name → { levels, md }
		const vol = new Map();
		for (const { level, features } of sheet.levels) {
			for (const name of features) {
				if (!vol.has(name)) vol.set(name, { levels: [], md: sheets.get(name) });
				vol.get(name).levels.push(level);
			}
		}

		const descParts = [];
		const flavor = sheet.flavor.join(' ');
		descParts.push(`<p><em>${inline(flavor)}</em></p>`);
		// Preserve extra intro paragraphs the current description carries before LEVEL.
		const currentSubclass = readJson(subclassPath);
		const currentDesc = String(currentSubclass.system?.description ?? '');
		const introMatch = currentDesc.match(/^<p><em>.*?<\/em><\/p>((?:(?!<p>LEVEL).)*?)<p>LEVEL/s);
		if (introMatch?.[1]) descParts.push(introMatch[1]);

		const handled = new Set();
		for (const { level, features } of sheet.levels) {
			descParts.push(`<p>LEVEL ${level}</p>`);
			for (const name of features) {
				const entry = vol.get(name);
				if (!entry.md) {
					console.error(`[ERROR] ${cls}/${sheet.name}: no feature sheet for "${name}"`);
					process.exitCode = 1;
					continue;
				}
				const conv = featureHtml(entry.md);
				const levelHtml = conv.levels[level];
				const lead = (levelHtml ?? conv.lead).replace(/^<p>/, `<p><strong>${escapeHtml(name)}${/[.!?]$/.test(name) ? '' : '.'}</strong> `);
				descParts.push(levelHtml ? lead : `${lead}${conv.rest}`);
				if (handled.has(name)) continue;
				handled.add(name);

				const wantedSlug = slug(name);
				const wantedFile = path.join(featureDir, `${wantedSlug}.json`);
				const wantedImg = `modules/${MODULE_ID}/assets/features/${cls}/${ident}/${wantedSlug}.webp`;
				const oldName = FEATURE_RENAMES[name] && existing.has(FEATURE_RENAMES[name]) ? FEATURE_RENAMES[name] : name;
				const file = existing.get(oldName);

				if (file) {
					existing.delete(oldName);
					const doc = readJson(file);
					const oldSlug = path.basename(file, '.json');
					if (oldSlug !== wantedSlug) {
						rename(file, wantedFile);
						rename(path.join(iconDir, `${oldSlug}.webp`), path.join(iconDir, `${wantedSlug}.webp`));
						idsMove(file, wantedFile);
						report.renamed.push(`${cls}/${ident}: ${oldName} → ${name}`);
					}
					doc.name = name;
					if (doc.img?.includes(`/assets/features/${cls}/${ident}/`)) doc.img = wantedImg;
					if (doc.system.identifier === oldSlug || !doc.system.identifier) doc.system.identifier = wantedSlug;
					doc.system.description = conv.html;
					doc.system.gainedAtLevels = entry.levels;
					doc.system.group = ident;
					const inferred = inferCost(conv.html.replace(/<[^>]+>/g, ''));
					const cur = doc.system.activation?.cost ?? {};
					if (inferred.type !== (cur.type ?? 'none')) {
						report.costWarnings.push(
							`${cls}/${ident}/${wantedSlug}: text suggests cost ${inferred.type} (${inferred.details || '-'}) but file has ${cur.type} (${cur.details || '-'})`,
						);
					}
					writeJson(wantedFile, doc);
				} else {
					const doc = newFeature({ name, cls, ident, html: conv.html, levels: entry.levels, img: wantedImg });
					writeJson(wantedFile, doc);
					report.newFeatures.push(`${cls}/${ident}/${wantedSlug}.webp  (${name}, L${entry.levels.join('/')})`);
				}
			}
		}

		// Dropped features.
		for (const [name, file] of existing) {
			const s = path.basename(file, '.json');
			remove(file);
			remove(path.join(iconDir, `${s}.webp`));
			idsDelete(file);
			report.deleted.push(`${cls}/${ident}: ${name} (${s})`);
		}

		currentSubclass.name = sheet.name;
		currentSubclass.system.description = descParts.join('');
		writeJson(subclassPath, currentSubclass);
		report.subclasses.push(`${cls}/${ident}: ${sheet.name} (${vol.size} features, by ${sheet.author || '?'})`);
	}
}

if (idsDirty && !DRY) fs.writeFileSync(IDS_PATH, JSON.stringify(sortKeys(ids), null, '\t'), 'utf-8');

const section = (title, items) => {
	if (!items.length) return;
	console.log(`\n${title} (${items.length})`);
	for (const i of items) console.log(`  ${i}`);
};
console.log(DRY ? '[DRY RUN] nothing written' : '[INFO] pack-sources updated');
section('Subclasses rewritten', report.subclasses);
section('Features renamed', report.renamed);
section('Features deleted', report.deleted);
section('NEW features — icons needed', report.newFeatures);
section('Cost mismatches to check by hand', report.costWarnings);
