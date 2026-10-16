# Language integration

The interface supports German and English. Language selection follows this order:

1. A valid `?lang=de` or `?lang=en` query.
2. The saved `arcdrake-tools-language` preference in localStorage.
3. German when the browser language begins with `de`; otherwise English.

Language changes update the query with `history.replaceState` without reloading
the page. The app preserves the current image, settings and result. It does not
translate filenames or image pixels. Only the language preference is stored.

A script running in the same page, such as site navigation, can dispatch or listen
for the `arcdrake-language-change` event on `window`. This event does not cross iframe boundaries. Its detail is
`{ language: 'de' }` or `{ language: 'en' }`. The interface text and event handling
are implemented in `dist/i18n.js`, which must be included when self-hosting.

Run `npm run test:i18n` after following the development setup in
[CONTRIBUTING.md](../CONTRIBUTING.md). It checks translated copy and errors, language
preferences, event handling, state preservation and real downloads. It manages
its own local server and browser.
