import { setupFeatsTabObserver } from './sheet-section.mjs';
import { maybeAutoPromptFeats } from './auto-prompt.mjs';

Hooks.on('renderPlayerCharacterSheet', (app, _html) => {
	setupFeatsTabObserver(app);
	maybeAutoPromptFeats(app);
});

Hooks.on('closePlayerCharacterSheet', (app) => {
	try {
		app.__nimPlusFeatsObserver?.disconnect();
	} catch (_error) {
		/* nothing to disconnect */
	}
});
