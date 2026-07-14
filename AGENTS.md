# Repository Instructions

## Commands

- Use `npm install` to install dependencies; this repo uses `package-lock.json`, not pnpm/yarn/bun lockfiles.
- Start the Vite dev server with `npm start`.
- Start the local chapter editor with `npm run editor`; it serves `tools/editor/public/` and writes `public/game/*.json` through `tools/editor/server.js`.
- Verify production builds with `npm run build`; `vite.config.js` disables production sourcemaps.
- Deploy only when explicitly requested: `npm run deploy` runs `npm run build && gh-pages -d build` and publishes the `build/` output.
- There is no `test` script in `package.json`; do not claim `npm test` is available unless you add it.

## App Shape

- This is a React + Vite project; the entrypoint is `src/index.jsx`, which renders `src/components/App.jsx`.
- Game content is static JSON under `public/game/`; it is fetched at runtime with `${import.meta.env.BASE_URL}game/${chapterId}.json`.
- The editor is local tooling only and is not part of the Vite app or deployed `build/` output.
- The first spawn is `public/game/-start-.json`; local saves are stored in `localStorage` under the `save` key and override startup until reset.
- Visiting `/text-adventure/reset` clears `localStorage.save`, returns the URL to `/text-adventure/`, and respawns from `public/game/-start-.json`.
- Core game flow is in `src/hooks/useGameLogic.jsx`, trigger dispatch is in `src/utils/DispatchTrigger.js`, and flag visibility rules are in `src/utils/CheckFlag.js`.

## Game JSON Gotchas

- Chapter JSON files must expose a top-level `scenes` array. Scenes use `id`, `name`, `paragraphs`, and `actions`.
- Movement triggers use `target` for the scene and optional `chapterId` for cross-chapter moves. The README's `chapter` field example is stale; code reads `trigger.chapterId`.
- Supported trigger types are `movement`, `add_flag`, `remove_flag`, `remove_all_flags`, and `remove_all_flags_except`.
- Paragraphs can be strings or objects with `text` plus flag visibility fields. The string `"---"` renders as a horizontal rule.
- Flag fields supported by code are `hideAny`, `hideAll`, `showAny`, and `showAll`.
- Paragraph objects with show flags are sorted by the order the matching flags were acquired unless `ignoreSortByFlag` is set.

## Manual Checks

- Keyboard controls: Enter/space activate, Up/Down or W/S change selected action.
- Debug shortcuts are Shift-modified letters in practice: `H` toggles help, `D` toggles flag display, `C` clears flags, `N` respawns via `-start-`.
- When validating story changes, clear `localStorage.save` or use `Shift+N` so old saves do not hide the new starting state.

## Utilities

- `src/utils/WordCount.js` is a standalone Node script, not wired into `package.json`; run it manually with `node src/utils/WordCount.js` from the repo root if needed.
