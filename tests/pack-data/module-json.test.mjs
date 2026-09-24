/**
 * module.json pack wiring: every pack maps to an existing pack-sources dir, every sourceDir is used,
 * and packFolders list only existing packs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkModuleJson } from './checks-02.mjs';
import { readModuleJson, REPO_ROOT } from './lib.mjs';

describe('pack-data: module.json', () => {
	const mj = readModuleJson();

	it('packs map to existing sourceDirs, paths are packs/<name>, packFolders list only existing packs, every pack is foldered', () => {
		expect(checkModuleJson()).toEqual([]);
	});

	it.each(mj.packs.map((p) => [p.name, p]))('%s: sourceDir holds JSON documents', (_name, p) => {
		const dir = path.join(REPO_ROOT, 'pack-sources', p.flags.sourceDir);
		const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.json') ? [e.name] : []));
		expect(walk(dir).length).toBeGreaterThan(0);
	});

	it('package.json and module.json agree on the version', () => {
		const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
		expect(pkg.version).toBe(mj.version);
	});

	it('the download URL points at the current version tag', () => {
		expect(mj.download).toContain(`/v${mj.version}/`);
	});

	it('every esmodule exists', () => {
		for (const f of mj.esmodules ?? []) expect(fs.existsSync(path.join(REPO_ROOT, f))).toBe(true);
	});
});
