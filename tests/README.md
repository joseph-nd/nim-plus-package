# Tests

Vitest runs the module's real `scripts/` under Node against mocked Foundry v14 + Nimble globals and the **real** pack data
(`../FoundryVTT-Nimble/packs/**` and `pack-sources/**`).

```bash
pnpm test                                # run once (vitest run)
pnpm test:watch                          # watch mode
npx vitest run tests/examples            # one directory
npx vitest run -t "supersede"            # tests whose name matches
```

The sibling checkout `../FoundryVTT-Nimble` must exist (the system packs are read from it).

## Layout

```
tests/
  harness/          the mock Foundry world — import from harness/index.mjs
    foundry.mjs       installFoundry(), importScripts(), Hooks/settings/dialogs/uuid mocks
    foundry-utils.mjs ported foundry.utils (mergeObject, expandObject, deepClone…), operators, Collection
    documents.mjs     mock Item/Actor documents (prepared data, updates, embedded CRUD + call log)
    compendium.mjs    CompendiumCollection + database mirroring v14 index semantics
    packs.mjs         loadPackData(), installPacks(), findDoc(s), supersedeOracle()
    actors.mjs        makeCharacter(), buildCharacterAtLevel(), inspection helpers
    scenario.mjs      setupWorld() — the common one-liner
  examples/         small tests showing each piece of the harness
  <area>/           your tests (e.g. tests/class-migration/, tests/supersede/, tests/pack-data/)
```

Test files must be named `*.test.mjs`.

## Writing a test

```js
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, setupWorld, itemNames, sourceOf, findDoc } from '../harness/index.mjs';

describe('shepherd to02', () => {
	let env, migration;
	beforeEach(async () => {
		// installFoundry + installPacks + import core scripts (fresh) + run init/setup hooks
		({ env, mods: [, , , migration] } = await setupWorld({ playtest: true }));
	});

	it('keeps pool values', async () => {
		const actor = await buildCharacterAtLevel(env, 'shepherd', 5, { version: '2.0.3', picks: ['…'] });
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		await migration.applyCoreClassMigration([plan], 'to02');
		expect(actor.callsOf('update')).toHaveLength(1);
	});
});
```

`setupWorld()` imports `CORE_SCRIPTS` = `playtest-settings`, `supersede`, `subclass-sync`, `class-migration/index` and
returns their namespaces in that order as `mods`. For anything else, pass `scripts: [...]` (repo-relative paths, **all in
one call** — every `importScripts` call starts a fresh module registry, so two calls give two separate copies of
`supersede.mjs` with separate caches). By default it boots through `setup` only, so the `ready` startup prompts (migration
preview, subclass sync) do not fire; pass `boot: 'ready'` to test them.

Lower-level equivalent:

```js
const env = installFoundry({ isGM: true, settings: { 'nim-plus-package.playtestCoreClasses': false } });
await installPacks(env, { system: ['classes', 'classFeatures', 'subclasses', 'spells'], module: true });
const [supersede, migration] = await importScripts(['scripts/core/supersede.mjs', 'scripts/core/class-migration/index.mjs']);
await env.boot({ until: 'setup' });
```

Call `installFoundry()` (or `setupWorld()`) in `beforeEach`: it replaces every global and creates fresh document and
`CompendiumCollection` classes, so prototype patches made by scripts never leak between tests.

## Harness API

### Environment — `installFoundry(options) → env`
Options: `isGM=true`, `settings` (presets, keyed `"namespace.key"`), `systemId='nimble'` (try `'nimble-dev'`),
`dialogFallback='close'|'throw'`.

Globals installed: `game`, `Hooks`, `CONFIG`, `ui`, `canvas`, `CONST`, `foundry` (`utils`, `data.operators`,
`abstract.Document`, `documents.collections.CompendiumCollection`, `applications.api.DialogV2`), `Actor`, `Item`,
`Roll`, `ChatMessage`, `Dialog`, `fromUuid`, `fromUuidSync`, `_replace`, `_del`, `String.prototype.slugify`.

| `env.…` | what |
|---|---|
| `Hooks` / `hooks` | real registry. `Hooks.log` (every on/once/call/callAll with args), `Hooks.errors` (handlers that threw), `Hooks.count(name)`, `Hooks.names()`, `await Hooks.callAllAsync(name, ...args)` |
| `boot({until})` | fires `init` → `i18nInit` → `setup` → `ready`, awaiting async handlers |
| `flush()` | let pending promises settle (for un-awaited hook work) |
| `notifications` | `info/warn/error/notify` are `vi.fn` spies; `notifications.messages(level?)` |
| `dialogs` | scripted answers + `dialogs.log` (see below) |
| `settings` | `game.settings`; `settings.registered`, `settings.values`, `settings.preset(key, v)`. `get` of an unregistered key throws, like Foundry |
| `setUser({isGM})` | switch between the GM (`env.users.gm`) and a player (`env.users.player`) |
| `database.log` | every compendium database request (index reads and document queries) |
| `log` | world-level writes (non-embedded updates/deletes, `settings.set`) |
| `classes` | `{Document, Item, Actor}` for this env; `CompendiumCollection` |
| `ChatMessage.created` | data passed to `ChatMessage.create` |

`importScripts(paths, {reset=true})` — import repo-relative script paths with a fresh module registry; returns the module
namespace(s).

### Packs — `packs.mjs`
- `loadPackData() → {packs: Map<collection, {collection, pkg, name, type, docs, files}>, byUuid, warnings}` — parsed once
  per test file, deep-frozen. Ids follow the build (pack `ids.json` wins, then the file's `_id`, else a hash id + warning).
  `doc.__file` (non-enumerable) is the source path.
- `installPacks(env, {system, module, transform, extra})` — mock compendia in `game.packs`: `nimble.nimble-classes`,
  `nimble.nimble-class-features`, `nimble.nimble-subclasses`, `nimble.nimble-spells` (+ `'items'` on request) and every
  Nim+ pack from `module.json`. `transform(clone, pack)` lets a test edit or drop (return `null`) documents; `extra` adds
  packs. `addPack(env, {collection, type, docs})` adds one.
- `findDocs({pack, name, type, class, group, subclass, where}) → [{uuid, doc, collection}]`, `findDoc(q)` (exactly one or
  throws), `rawDoc(uuid)`, `uuidOf(collection, doc)`.
- `supersedeOracle() → {supersededBy, supersedes, playtestOnly, retired, hiddenWhen(enabled)}` — computed straight from the
  JSON, independent of `scripts/core/supersede.mjs`.

Pack behaviour mirrors Foundry v14: the constructor seeds `pack.index` with the core index fields only; `getIndex({fields})`
returns the cached index when the fields are covered and otherwise re-reads the whole pack and re-`set`s every entry
(resurrecting deleted ones); `getDocument(s)` → `set()` → `indexDocument()`; `delete(id)` also removes the index entry.
Every call is in `pack.calls`; `pack.treeInitializations` counts `initializeTree()`.

### Characters — `actors.mjs`
- `makeCharacter(env, {name, classId|classUuid, level, version, subclass, features, spells, items, pools, flags,
  classState, followGrants, startingGear, legacySourceId, world, ownedByPlayer, progression, picks}) → Actor` — exactly
  the listed documents (refs are UUIDs or names).
- `buildCharacterAtLevel(env, classId, level, {version:'2.0.3'|'0.2', subclass, picks, spells, pools, …}) → Actor` — walks
  the progression like the level-up window: the class, every auto-grant feature (`<class>-progression` group or ungrouped,
  bound by `system.class` or the class's `groupIdentifiers`, including option "header" features such as Fit for Any
  Battlefield) gained at or below `level`, following `grantItem` rules to pack features/spells (sets
  `system.grantedById`), the subclass + its features (group = subclass identifier or name slug), then `picks` (choice-group
  features) and `spells`.
  - `version: '2.0.3'` = what the index shows with the playtest setting **off**; `'0.2'` = setting **on** (Nim+ 0.2 copies
    first, then un-superseded system docs). A name that is ambiguous within the best tier throws — pass a UUID.
  - Owned items look like `fromCompendium` output: no `folder/sort/ownership`, fresh `_id`,
    `_stats.compendiumSource` = canonical uuid (`legacySourceId: true` → `flags.core.sourceId` instead).
  - The class item gets `classLevel`, a deterministic `hpData` (length = level) and `abilityScoreData` for levels ≤ level;
    override with `classState`.
  - `pools: {'<item name>': {chargePools: {id: {current, max, recoveries: []}}, dicePools: {…}}, '@actor': {…}}` writes
    `flags.<systemId>.<kind>`.
- Helpers: `resolveDoc(ref, {version, type, classId})`, `visibleDocs(version)`, `progressionEntries(...)`,
  `subclassEntries(...)`, `ownedSource(uuid, doc)`, `sourceOf(item)`, `itemSummary(actor)`, `itemNames(actor, type?)`,
  `itemsNamed(actor, name)`, `snapshotItems(actor)`, `setPool(env, item, kind, key, value)`.

Mock documents (`documents.mjs`):
- `_source` is persisted data; `name/img/system/flags/_stats` are a **prepared copy** rebuilt after every write.
- Prepared `system.identifier` is always `name.slugify({strict:true})` (as `NimbleBaseItem#prepareBaseData` does) — the
  stored identifier is only visible in `_source`, `toObject()` and index entries.
- `actor.levels` is derived from `system.classData.levels` (as Nimble does).
- Updates use Foundry's `mergeObject` with operators: dotted keys, object merge, `-=key`, `==key`, `_replace(...)`,
  `_del`.
- `create/update/deleteEmbeddedDocuments('Item', …)` fire `preCreateItem`/`createItem`, `preUpdateItem`/`updateItem`,
  `preDeleteItem`/`deleteItem` (a `pre*` handler returning `false` cancels) and are recorded in `actor.calls`
  (`actor.callsOf('create'|'update'|'delete')`). Updating/deleting an id the actor does not own **throws**, as Foundry's
  strict lookup does. `keepId` is honoured on create.
- `item.update/delete/getFlag/setFlag/unsetFlag`, `item.sourceId`, `item.grantedBy`, `actor.isOwner` (GM, or the
  harness player when `ownedByPlayer`).

## Scripting dialogs

Every `DialogV2.wait/confirm/prompt/input` (and legacy `Dialog.confirm/prompt/wait`) consumes the first queued answer whose
matcher accepts it; everything is recorded in `env.dialogs.log` (`{kind, title, content, config, answer, result}`).

```js
env.dialogs
	.answer('apply')                                          // next dialog, whatever it is: press button "apply"
	.answerWhen(/Migrate classes/, 'apply')                   // matcher: substring / RegExp / fn(config) on title+content
	.answerWhen('Remove', true)                               // confirm: yes (false = no)
	.answerWhen(/Sacred Graces/, { action: 'ok', checked: [itemId1, itemId2] })   // promptChoice picks
	.answerWhen(/Later/, null)                                // close the dialog (returns null)
	.answerWhen(/x/, (config, call) => 'anything');           // full control: return the dialog's result
```

- `{action, checked}` runs that button's `callback(event, button)`; `button.form.querySelectorAll(...)` yields
  `checked` as `{value}` inputs (default: the inputs marked `checked` in the dialog content).
- A string answer presses that button. As in Foundry v14 (`DialogV2#_onSubmit`), the result is its callback's return
  value, or the action string itself when the callback returns `null`/`undefined` (so a plain Cancel resolves
  `'cancel'`, not `null`). Module code reads dialogs through `scripts/core/dialog.mjs` (`waitDialog`, `getDialogForm`,
  `readField`…), which turns that back into `null`. In a callback, `button.form` is DialogV2's own `<form>` — a
  `<form>` inside `content` does not exist in the real DOM.
- Unscripted dialogs return `null` (a closed `rejectClose: false` dialog). `installFoundry({dialogFallback: 'throw'})`
  (or `env.dialogs.fallback = 'throw'`) makes them fail the test instead.
- `env.dialogs.pending()` — answers not consumed (assert `0` to prove a prompt was shown).

## Bug-reporting convention (MANDATORY)

1. **Tests MUST NOT modify anything under `scripts/` or `pack-sources/`.** Not even to "fix" an obvious bug. Only
   `tests/**` is yours.
2. When a test reveals a real bug, write the test for the **correct** behaviour and mark it:

   ```js
   it.fails('BUG-migration-3: to203 removes Coordinated Strike! granted by a kept feature', async () => { … });
   ```

   so the suite stays green and documents the bug. `<area>` is a short slug (`migration`, `supersede`, `subclass-sync`,
   `commander`, `shepherd`, `pack-data`, …); `<n>` counts per area. Once someone fixes the bug the `it.fails` test
   starts failing — that is the signal to turn it into a plain `it`.
3. Append an entry to
   `/tmp/claude-1000/-home-jnunez-Projects-foundry-vtt-modules-blue-codex-package/9221e053-ac5e-40f6-8b85-ed07b67e312c/scratchpad/core02/bugs/<area>.md`:

   ```md
   ## BUG-<area>-<n>: <what is wrong>
   - **Where:** scripts/core/…/file.mjs:<line> (function name — line numbers drift, name the function)
   - **Repro:** tests/<dir>/<file>.test.mjs › "<full test name>"
   - **Expected:** …
   - **Actual:** …
   - **Severity:** high | medium | low — <one-line why (data loss? wrong rules? cosmetic?)>
   ```

   Check the file first so ids don't collide with another agent's entries.
4. If the harness (not the script) is wrong or can't simulate something, don't write an `it.fails` — note it under
   "Gaps" below or fix the harness in `tests/harness/`, keeping the existing API backwards compatible.

## Gaps — what the harness does NOT simulate

- **No DataModel schemas.** Updates are not cleaned/validated: unknown `system` keys survive, types are not coerced,
  defaults are not filled. A write that Foundry would strip or reject can pass here.
- **No Nimble rules engine.** `chargePool`/`dicePool` state is only what the test puts in the flags; `max`, recoveries,
  `modifyPool`, `poolMaxBonus` and predicates are never evaluated. `grantItem` rules are followed only by the character
  builders (not on `createEmbeddedDocuments`), and only for pack targets with an empty or `level` predicate.
- **No level-up / character-creator UI.** `buildCharacterAtLevel` reproduces the auto-grant walk; choice groups,
  `selectionCountByLevel`, option sub-picks and spell-school grants come only from `picks`/`spells`.
- **No ActiveEffects, tokens, canvas, combat, chat rendering, sheets or rendered HTML.** Embedded CRUD is `Item` only
  (other embedded names throw). `Roll` does not roll (total 0). `ChatMessage.create` just records its data.
- Dialogs never render; `render*`/`close*` hooks for dialogs are not fired.
- `Hooks.callAll` does not await async handlers (as in Foundry) — use `env.flush()` or `Hooks.callAllAsync`.
- No sockets, no permissions beyond GM / one player, no world `Item` directory entries unless a test adds them to
  `game.items`, no `game.documentIndex` search trie.
- Pack JSON is served as authored: the build's `_id` rewriting of UUID references (`IdBuilder.updateUuidReferences`) is
  not replayed, so run `pnpm build` first if ids were just migrated.
- `debounce` is a no-op; the compendium document-cache flush never happens.
