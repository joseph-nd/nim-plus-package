import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import moduleJSON from '../../module.json' with { type: 'json' };
import LevelDatabase from './LevelDB.mjs';

const MINOR_BOON_TYPE = 'minor';
const MAJOR_BOON_TYPE = 'major';
const EPIC_BOON_TYPE = 'epic';
const LODGING_BOON_TYPE = 'lodging';

const CONFIGURED_BOON_TYPES = [MINOR_BOON_TYPE, MAJOR_BOON_TYPE, EPIC_BOON_TYPE, LODGING_BOON_TYPE];

const MODULE_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

export default class Pack {
	static #PACK_DEST = path.resolve(MODULE_ROOT, 'packs');

	static #packsMetadata = moduleJSON.packs;

	// New classes shipped by this module — sort priority for class-feature folders.
	static #CLASS_FEATURE_CLASS_SORT_ORDER = new Map([
		['hexbinder', 0],
		['artificer', 1],
	]);

	constructor(dirName, data) {
		const sourceDir = path.basename(dirName);
		const metadata = Pack.#packsMetadata.find(
			(p) => p?.flags?.sourceDir === sourceDir,
		);

		if (!metadata) throw Error(`[ERROR] - Pack source dir "${sourceDir}" isn't setup in module.json.`);

		/** @type {string} */
		this.systemId = metadata.system;
		/** @type {string} */
		this.packId = metadata.name;
		/** @type {string} */
		this.documentType = metadata.type;
		/** @type {string} */
		this.outDirName = path.basename(metadata.path);

		/** @type {string} */
		this.dirPath = dirName;
		/** @type {string} */
		this.dirName = sourceDir;
		/** @type {Map<string, any>} */
		this.data = data;
		/** @type {any[]} */
		this.folderDocuments = [];
	}

	cleanAndValidate() {
		const folderAssignments = this.#prepareFolderAssignments();

		[...this.data.entries()].map(([file, source]) => {
			this.#cleanDocument(source);

			const folderId = source?._id ? folderAssignments.get(source._id) : null;
			if (folderId) source.folder = folderId;

			fs.writeFileSync(file, JSON.stringify(source, null, '\t'), { encoding: 'utf-8' });

			return source;
		});
	}

	#prepareFolderAssignments() {
		this.folderDocuments = [];

		const folderAssignmentHandlers = [
			{
				matches: this.dirName === 'monsters' && this.documentType === 'Actor',
				prepare: () => this.#prepareMonsterFolderAssignments(),
			},
			{
				matches: this.dirName === 'boons' && this.documentType === 'Item',
				prepare: () => this.#prepareBoonFolderAssignments(),
			},
			{
				matches: this.dirName === 'subclasses',
				prepare: () => this.#prepareSubclassFolderAssignments(),
			},
			{
				matches: this.dirName === 'classFeatures',
				prepare: () => this.#prepareClassFeatureFolderAssignments(),
			},
			{
				matches: this.dirName === 'spells',
				prepare: () => this.#prepareSpellFolderAssignments(),
			},
		];

		const matchedHandler = folderAssignmentHandlers.find((handler) => handler.matches);
		return matchedHandler ? matchedHandler.prepare() : new Map();
	}

	#prepareSubclassFolderAssignments() {
		const subclasses = [...this.data.values()].filter(
			(source) => source?.type === 'subclass' && typeof source?.system?.parentClass === 'string',
		);
		if (subclasses.length === 0) return new Map();

		const statsTemplate = this.#getFolderStatsTemplate(subclasses);
		const classIds = [
			...new Set(
				subclasses.map((source) => source.system.parentClass.trim().toLowerCase()).filter(Boolean),
			),
		].sort((a, b) => this.#toDisplayClassName(a).localeCompare(this.#toDisplayClassName(b)));

		const foldersByClass = classIds.reduce((acc, classId, index) => {
			const folder = {
				_id: this.#getStableFolderId(classId),
				_stats: { ...statsTemplate },
				color: null,
				description: '',
				flags: {},
				folder: null,
				name: this.#toDisplayClassName(classId),
				sort: index * 10,
				sorting: 'a',
				type: this.documentType,
			};

			acc.set(classId, folder);
			return acc;
		}, new Map());

		this.folderDocuments = [...foldersByClass.values()];

		return subclasses.reduce((acc, source) => {
			const classId = source.system.parentClass.trim().toLowerCase();
			const folder = foldersByClass.get(classId);
			if (folder && source._id) acc.set(source._id, folder._id);
			return acc;
		}, new Map());
	}

	#prepareMonsterFolderAssignments() {
		const monsters = [...this.data.entries()].filter(
			([, source]) => typeof source?._id === 'string',
		);
		if (monsters.length === 0) return new Map();

		const folderLabelByKey = new Map();
		const folderKeyByActorId = new Map();

		for (const [file, source] of monsters) {
			const folderKey = this.#getMonsterFolderKey(file);
			if (!folderKey) continue;

			folderKeyByActorId.set(source._id, folderKey);
			if (!folderLabelByKey.has(folderKey)) {
				folderLabelByKey.set(folderKey, this.#toDisplayMonsterFolderName(folderKey));
			}
		}

		if (folderLabelByKey.size === 0) return new Map();

		const statsTemplate = this.#getFolderStatsTemplate(monsters.map(([, source]) => source));
		const foldersByKey = [...folderLabelByKey.entries()]
			.sort((a, b) => a[1].localeCompare(b[1]))
			.reduce((acc, [folderKey, folderName], index) => {
				const folder = {
					_id: this.#getMonsterFolderId(folderKey),
					_stats: { ...statsTemplate },
					color: null,
					description: '',
					flags: {},
					folder: null,
					name: folderName,
					sort: index * 10,
					sorting: 'a',
					type: this.documentType,
				};

				acc.set(folderKey, folder);
				return acc;
			}, new Map());

		this.folderDocuments = [...foldersByKey.values()];

		return [...folderKeyByActorId.entries()].reduce((acc, [actorId, folderKey]) => {
			const folder = foldersByKey.get(folderKey);
			if (folder) acc.set(actorId, folder._id);
			return acc;
		}, new Map());
	}

	#prepareBoonFolderAssignments() {
		const boons = [...this.data.values()].filter(
			(source) => typeof source?._id === 'string' && typeof source?.system?.boonType === 'string',
		);
		if (boons.length === 0) return new Map();

		const statsTemplate = this.#getFolderStatsTemplate(boons);
		const boonTypes = [
			...new Set(
				boons.map((source) => source.system.boonType.trim().toLowerCase()).filter(Boolean),
			),
		].sort((a, b) => {
			const aIndex = CONFIGURED_BOON_TYPES.indexOf(a);
			const bIndex = CONFIGURED_BOON_TYPES.indexOf(b);
			if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
			if (aIndex !== -1) return -1;
			if (bIndex !== -1) return 1;
			return this.#toDisplayBoonFolderName(a).localeCompare(this.#toDisplayBoonFolderName(b));
		});

		const foldersByType = boonTypes.reduce((acc, boonType, index) => {
			const folder = {
				_id: this.#getBoonFolderId(boonType),
				_stats: { ...statsTemplate },
				color: null,
				description: '',
				flags: {},
				folder: null,
				name: this.#toDisplayBoonFolderName(boonType),
				sort: index * 10,
				sorting: 'a',
				type: this.documentType,
			};

			acc.set(boonType, folder);
			return acc;
		}, new Map());

		this.folderDocuments = [...foldersByType.values()];

		return boons.reduce((acc, source) => {
			const boonType = source.system.boonType.trim().toLowerCase();
			const folder = foldersByType.get(boonType);
			if (folder) acc.set(source._id, folder._id);
			return acc;
		}, new Map());
	}

	#prepareSpellFolderAssignments() {
		const spells = [...this.data.values()].filter(
			(source) =>
				typeof source?._id === 'string' &&
				typeof source?.system?.school === 'string' &&
				source.system.school.trim().length > 0,
		);
		if (spells.length === 0) return new Map();

		const statsTemplate = this.#getFolderStatsTemplate(spells);
		const schools = [
			...new Set(spells.map((source) => source.system.school.trim().toLowerCase()).filter(Boolean)),
		].sort((a, b) => this.#toDisplaySpellSchoolName(a).localeCompare(this.#toDisplaySpellSchoolName(b)));

		const foldersBySchool = schools.reduce((acc, school, index) => {
			const folder = {
				_id: this.#getSpellSchoolFolderId(school),
				_stats: { ...statsTemplate },
				color: null,
				description: '',
				flags: {},
				folder: null,
				name: this.#toDisplaySpellSchoolName(school),
				sort: index * 10,
				sorting: 'a',
				type: this.documentType,
			};

			acc.set(school, folder);
			return acc;
		}, new Map());

		this.folderDocuments = [...foldersBySchool.values()];

		return spells.reduce((acc, source) => {
			const school = source.system.school.trim().toLowerCase();
			const folder = foldersBySchool.get(school);
			if (folder) acc.set(source._id, folder._id);
			return acc;
		}, new Map());
	}

	#prepareClassFeatureFolderAssignments() {
		const features = [...this.data.entries()].filter(
			([, source]) => typeof source?._id === 'string',
		);
		if (features.length === 0) return new Map();

		const statsTemplate = this.#getFolderStatsTemplate(features.map(([, source]) => source));
		const classFolderData = new Map();

		for (const [file, source] of features) {
			const classId = this.#getClassId(file, source);
			if (!classId) continue;

			const className = this.#toDisplayClassName(classId);
			let classData = classFolderData.get(classId);
			if (!classData) {
				classData = {
					name: className,
					progressionName: `${className} Progression`,
					subclasses: new Map(),
				};
				classFolderData.set(classId, classData);
			}

			const subclassId = this.#getSubclassId(file, source);
			if (!subclassId) continue;

			const subclassName = this.#getSubclassFolderName(file, source, subclassId);
			if (!classData.subclasses.has(subclassId)) classData.subclasses.set(subclassId, subclassName);
		}

		const folders = [];
		const classFolderLookup = new Map();
		const sortedClasses = [...classFolderData.entries()].sort(
			([aClassId, aData], [bClassId, bData]) => {
				const aOrder =
					Pack.#CLASS_FEATURE_CLASS_SORT_ORDER.get(aClassId) ?? Number.MAX_SAFE_INTEGER;
				const bOrder =
					Pack.#CLASS_FEATURE_CLASS_SORT_ORDER.get(bClassId) ?? Number.MAX_SAFE_INTEGER;
				if (aOrder !== bOrder) return aOrder - bOrder;

				return aData.name.localeCompare(bData.name, undefined, { sensitivity: 'base' });
			},
		);

		sortedClasses.forEach(([classId, classData], classIndex) => {
			const classFolderId = Pack.#folderIdForClassId(classId);
			const progressionFolderId = Pack.#folderIdForProgressionId(classId);

			folders.push({
				_id: classFolderId,
				_stats: { ...statsTemplate },
				color: null,
				description: '',
				flags: {},
				folder: null,
				name: classData.name,
				sort: classIndex * 10,
				sorting: 'm',
				type: this.documentType,
			});

			folders.push({
				_id: progressionFolderId,
				_stats: { ...statsTemplate },
				color: null,
				description: '',
				flags: {},
				folder: classFolderId,
				name: classData.progressionName,
				sort: 0,
				sorting: 'm',
				type: this.documentType,
			});

			const subclassFolderLookup = new Map();
			const sortedSubclasses = [...classData.subclasses.entries()].sort(([, aName], [, bName]) =>
				aName.localeCompare(bName, undefined, { sensitivity: 'base' }),
			);

			sortedSubclasses.forEach(([subclassId, subclassName], subclassIndex) => {
				const subclassFolderId = Pack.#folderIdForSubclassId(classId, subclassId);
				subclassFolderLookup.set(subclassId, subclassFolderId);

				folders.push({
					_id: subclassFolderId,
					_stats: { ...statsTemplate },
					color: null,
					description: '',
					flags: {},
					folder: classFolderId,
					name: subclassName,
					sort: (subclassIndex + 1) * 10,
					sorting: 'm',
					type: this.documentType,
				});
			});

			classFolderLookup.set(classId, {
				classFolderId,
				progressionFolderId,
				subclassFolderLookup,
			});
		});

		this.folderDocuments = folders;

		const folderAssignments = new Map();
		for (const [file, source] of features) {
			const classId = this.#getClassId(file, source);
			if (!classId || !source._id) continue;

			const classFolders = classFolderLookup.get(classId);
			if (!classFolders) continue;

			const subclassId = this.#getSubclassId(file, source);
			if (subclassId && classFolders.subclassFolderLookup.has(subclassId)) {
				folderAssignments.set(source._id, classFolders.subclassFolderLookup.get(subclassId));
				continue;
			}

			folderAssignments.set(
				source._id,
				classFolders.progressionFolderId ?? classFolders.classFolderId,
			);
		}

		return folderAssignments;
	}

	#getFolderStatsTemplate(sources) {
		const sourceStats = sources.find((source) => source?._stats)?._stats;
		const now = Date.now();

		return {
			coreVersion:
				sourceStats?.coreVersion ??
				String(moduleJSON.compatibility.verified ?? moduleJSON.compatibility.minimum),
			systemId: sourceStats?.systemId ?? 'nimble',
			systemVersion:
				sourceStats?.systemVersion ??
				moduleJSON.relationships?.systems?.[0]?.compatibility?.minimum ??
				'0.8.4',
			createdTime: sourceStats?.createdTime ?? now,
			modifiedTime: sourceStats?.modifiedTime ?? now,
			lastModifiedBy: sourceStats?.lastModifiedBy ?? null,
		};
	}

	#toDisplayClassName(classId) {
		if (classId === 'the-cheat') return 'The Cheat';

		return classId
			.replace(/[-_]+/g, ' ')
			.split(' ')
			.filter(Boolean)
			.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
			.join(' ');
	}

	#getStableFolderId(classId) {
		return crypto
			.createHash('sha1')
			.update(`nim-plus-subclasses-folder:${classId}`)
			.digest('hex')
			.slice(0, 16);
	}

	#getMonsterFolderKey(filePath) {
		const relativePath = path.relative(this.dirPath, filePath);
		const directory = path.dirname(relativePath);
		if (!directory || directory === '.') return null;

		const segments = directory.split(path.sep).filter(Boolean);
		if (!segments.length) return null;

		if (segments[0] === 'core' || segments[0] === 'nim-plus') return segments[1] ?? null;
		return segments[0];
	}

	#toDisplayMonsterFolderName(folderKey) {
		return folderKey
			.split(/[-_]+/g)
			.filter(Boolean)
			.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
			.join(' ');
	}

	#getMonsterFolderId(folderKey) {
		return crypto
			.createHash('sha1')
			.update(`${this.packId}-folder:${folderKey}`)
			.digest('hex')
			.slice(0, 16);
	}

	#toDisplayBoonFolderName(boonType) {
		switch (boonType) {
			case MINOR_BOON_TYPE:
				return 'Minor Boons';
			case MAJOR_BOON_TYPE:
				return 'Major Boons';
			case EPIC_BOON_TYPE:
				return 'Epic Boons';
			default:
				return `${boonType
					.replace(/[-_]+/g, ' ')
					.split(' ')
					.filter(Boolean)
					.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
					.join(' ')} Boons`;
		}
	}

	#getBoonFolderId(boonType) {
		return crypto
			.createHash('sha1')
			.update(`${this.packId}-boon-folder:${boonType}`)
			.digest('hex')
			.slice(0, 16);
	}

	#toDisplaySpellSchoolName(school) {
		return school
			.split(/[-_]+/g)
			.filter(Boolean)
			.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
			.join(' ');
	}

	#getSpellSchoolFolderId(school) {
		return crypto
			.createHash('sha1')
			.update(`${this.packId}-spell-school-folder:${school}`)
			.digest('hex')
			.slice(0, 16);
	}

	#cleanDocument(source) {
		if (!source.flags) source.flags = {};
		delete source.flags?.exportSource;
		delete source.flags?.importSource;

		Object.entries(source.flags).forEach(([flagId, flag]) => {
			if (!['core', 'nimble', 'nim-plus-package'].includes(flagId)) delete source.flags[flagId];

			if (flag && Object.keys(flag).length === 0) delete source.flags[flagId];
		});

		source.folder = null;

		if (source.ownership) delete source.ownership;

		if (Array.isArray(source?.effects)) {
			for (const e of source.effects) this.#cleanDocument(e);
		}
		if (Array.isArray(source?.items)) {
			for (const i of source.items) this.#cleanDocument(i);
		}
	}

	async saveAsPack() {
		if (!fs.lstatSync(Pack.#PACK_DEST, { throwIfNoEntry: false })?.isDirectory()) {
			fs.mkdirSync(Pack.#PACK_DEST, { recursive: true });
		}

		const outDir = path.join(Pack.#PACK_DEST, this.outDirName);
		if (fs.lstatSync(outDir, { throwIfNoEntry: false })?.isDirectory()) {
			fs.rmSync(outDir, { recursive: true });
		}

		this.cleanAndValidate();

		const db = new LevelDatabase(outDir, { packName: this.packId });
		await db.createPack([...this.data.values()], { folders: this.folderDocuments });
		const count = this.data.size;

		console.log(`[INFO] - Pack "${this.packId}" with ${count} documents built successfully.`);

		return count;
	}

	static loadJSONFiles(dirPath) {
		const filenames = globSync(`${dirPath}/**/*.json`);
		const files = new Map();

		for (const file of filenames) {
			let jsonData;

			try {
				jsonData = JSON.parse(fs.readFileSync(file, { encoding: 'utf-8' }).toString());
			} catch (err) {
				console.error(err);
				console.warn(`[ERROR] - ${file} failed to parse.`);
				continue;
			}

			if (!jsonData) continue;

			files.set(file, jsonData);
		}

		return new Pack(dirPath, files);
	}

	#getClassId(filePath, source) {
		const relativePath = path.relative(this.dirPath, filePath);
		const pathParts = relativePath.split(path.sep).filter(Boolean);
		// Layout under classFeatures/: <class>/<group>/<feature>.json
		const pathClass = pathParts.length >= 2 ? Pack.#normalizeClassId(pathParts[0]) : null;
		if (pathClass) return pathClass;

		return Pack.#normalizeClassId(source?.system?.class);
	}

	#getSubclassId(filePath, source) {
		const sourceSubclass = Pack.#normalizeSubclassId(source?.system?.subclass);
		if (sourceSubclass) return sourceSubclass;

		const relativePath = path.relative(this.dirPath, filePath);
		const pathParts = relativePath.split(path.sep).filter(Boolean);
		const subclassMarkerIndex = pathParts.findIndex((part) => part.endsWith('-subclasses'));
		const pathSubclass = subclassMarkerIndex >= 0 ? pathParts[subclassMarkerIndex + 1] : null;

		return Pack.#normalizeSubclassId(pathSubclass);
	}

	#getSubclassFolderName(filePath, source, subclassId) {
		if (typeof source?.system?.subclass === 'string') {
			const subclassName = source.system.subclass.trim();
			if (subclassName) return subclassName;
		}

		const relativePath = path.relative(this.dirPath, filePath);
		const pathParts = relativePath.split(path.sep).filter(Boolean);
		const subclassMarkerIndex = pathParts.findIndex((part) => part.endsWith('-subclasses'));
		const pathSubclass = subclassMarkerIndex >= 0 ? pathParts[subclassMarkerIndex + 1] : null;
		if (pathSubclass) {
			const normalizedPathSubclass = Pack.#normalizeClassId(pathSubclass);
			if (normalizedPathSubclass) return this.#toDisplayClassName(normalizedPathSubclass);
		}

		return this.#toDisplayClassName(subclassId);
	}

	static #normalizeClassId(classId) {
		if (typeof classId !== 'string') return null;
		const normalized = classId.trim().toLowerCase().replaceAll('_', '-').replace(/\s+/g, '-');
		return normalized || null;
	}

	static #normalizeSubclassId(subclassId) {
		if (typeof subclassId !== 'string') return null;
		const normalized = subclassId
			.trim()
			.toLowerCase()
			.replace(/[’']/g, '')
			.replaceAll('&', 'and')
			.replaceAll('_', '-')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');

		return normalized || null;
	}

	static #folderIdForDocument(documentId) {
		return crypto.createHash('sha256').update(documentId).digest('hex').slice(0, 16);
	}

	static #folderIdForClassId(classId) {
		return Pack.#folderIdForDocument(`nim-plus-class-features-${classId}`);
	}

	static #folderIdForSubclassId(classId, subclassId) {
		return Pack.#folderIdForDocument(`nim-plus-class-features-${classId}-${subclassId}`);
	}

	static #folderIdForProgressionId(classId) {
		return Pack.#folderIdForDocument(`nim-plus-class-features-${classId}-progression`);
	}
}
