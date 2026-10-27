# Language integration

The interface supports German and English. Language selection follows this order:

1. A valid `?lang=de` or `?lang=en` query.
2. The saved `arcdrake-tools-language` preference in localStorage.
3. German when the browser language begins with `de`; otherwise English.

Language changes update the query with `history.replaceState` without reloading
the page. The app preserves the current image/PDF, page, masks, settings and result. It does not
translate filenames, image pixels or feedback drafts. The language preference
and a separate yes/no optional usage-count preference can be stored; feedback
messages are never saved in browser storage.

A script running in the same page, such as site navigation, can dispatch or listen
for the `arcdrake-language-change` event on `window`. This event does not cross iframe boundaries. Its detail is
`{ language: 'de' }` or `{ language: 'en' }`. The interface text and event handling
are implemented in `dist/i18n.js` with the pure translation table and patterns in
`dist/i18n-messages.js`; include both when self-hosting. `npm test` checks static
copy, image/PDF errors and PDF counters/progress without launching a browser.

Run `npm run test:i18n` after following the development setup in
[CONTRIBUTING.md](../CONTRIBUTING.md). It checks translated copy and errors, language
preferences, event handling, state preservation and real downloads. It manages
its own local server and browser.

The app keeps one `#language-control select#language`, reusing an existing control
when present. The shared Tools wrapper recognizes a usable EN/DE selector and
hides its fallback language links. Keep the selector IDs and language event above
when integrating the package. No page reload or feedback form replacement is
needed to change language; privacy/contact links follow the same language.
