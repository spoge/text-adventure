# Sboge - Text Adventure

A React + Vite text adventure where the story lives in static JSON files. The app fetches chapter files from `public/game/` at runtime and stores the current save in `localStorage`.

## Repository Shape

- `src/index.jsx` renders the React app.
- `src/components/App.jsx` is the main app component.
- `src/hooks/useGameLogic.jsx` contains the core game flow.
- `src/utils/DispatchTrigger.js` handles action trigger dispatch.
- `src/utils/CheckFlag.js` handles flag-based visibility rules.
- `public/game/*.json` contains the playable game content.
- `public/game/-start-.json` defines the first chapter, scene, and flags for a new save.
- `tools/editor/` contains the local chapter editor.

## Getting Started

Install dependencies:

```sh
npm install
```

Run the game locally:

```sh
npm start
```

Build for production:

```sh
npm run build
```

Preview the production build:

```sh
npm run preview
```

Deploy to GitHub Pages:

```sh
npm run deploy
```

## Chapter Editor

The repository includes a local editor for working with the JSON files in `public/game/`.

Start it with:

```sh
npm run editor
```

By default it serves `tools/editor/public/` at `http://localhost:4000` and opens the browser automatically. Set `EDITOR_PORT` to use another port, or `EDITOR_OPEN=false` to prevent auto-opening the browser.

The editor runs through `tools/editor/server.js` and can read and write `public/game/*.json`. It supports creating, renaming, deleting, and editing chapters; editing scenes, paragraphs, actions, triggers, and start config; moving scenes between chapters; validating references; and local commit/push or deploy actions.

The editor is local tooling only. It is not part of the Vite app and is not deployed as part of the `build/` output.

## Saves And Startup

The save game is stored in `localStorage` under the `save` key and contains:

- Current chapter id
- Current scene id
- Global flags

Existing saves override the start config. To force a fresh start, clear `localStorage.save`, use the debug respawn shortcut, or visit `/text-adventure/reset` in the deployed route. The reset route clears `localStorage.save`, returns to `/text-adventure/`, and respawns from `public/game/-start-.json`.

The start config looks like this:

```json
{
  "chapterId": "chapter_1_shipwreck",
  "sceneId": "shipwreck_1",
  "flags": []
}
```

## Controls

The game can be controlled by keyboard or mouse.

- `Enter` or `Space` activates the selected action.
- `ArrowUp` / `ArrowDown` changes the selected action.
- `W` / `S` also changes the selected action.
- Clicking an action activates it directly.

Debug shortcuts use shift-modified letters:

- `Shift + H` lists available debug commands.
- `Shift + D` lists current flags.
- `Shift + C` clears all flags.
- `Shift + N` respawns from `-start-`.

## Game JSON

Each playable chapter is a JSON file in `public/game/`. Chapter files must expose a top-level `scenes` array.

Example chapter:

```json
{
  "name": "Example Chapter",
  "scenes": [
    {
      "id": "scene_1",
      "name": "Bench",
      "paragraphs": [
        "You wake up on the bench.",
        "What happened last night?"
      ],
      "actions": [
        {
          "text": "Stand up",
          "triggers": [
            {
              "type": "movement",
              "target": "scene_2"
            }
          ]
        }
      ]
    },
    {
      "id": "scene_2",
      "name": "In front of the bench",
      "paragraphs": [
        "You rise up slowly and look around.",
        {
          "text": "There is a coin on the ground.",
          "hideAny": ["coin_taken"]
        },
        {
          "text": "You look at the coin. It's beautiful!",
          "showAny": ["coin_taken", "coin_stolen"]
        }
      ],
      "actions": [
        {
          "text": "Take coin",
          "hideAny": ["coin_taken", "coin_stolen"],
          "triggers": [
            {
              "type": "add_flag",
              "target": "coin_taken"
            }
          ]
        }
      ]
    }
  ]
}
```

Paragraphs can be strings or objects with `text` and optional visibility fields. A paragraph string containing only `---` renders as a horizontal rule.

Actions contain `text`, optional visibility fields, and a `triggers` array.

## Flags

Flags are global and can be used by any chapter or scene. They are mainly used to show or hide paragraphs and actions.

Supported visibility fields:

- `hideAny`: hide if any listed flag has been acquired.
- `hideAll`: hide if all listed flags have been acquired.
- `showAny`: show if any listed flag has been acquired.
- `showAll`: show if all listed flags have been acquired.

Paragraph objects with `showAny` or `showAll` are sorted by the order the matching flags were acquired unless `ignoreSortByFlag` is set.

## Triggers

Triggers run when the player activates an action.

### `movement`

Move to another scene. Omit `chapterId` to move within the current chapter.

```json
{
  "type": "movement",
  "target": "target_scene",
  "chapterId": "optional_target_chapter"
}
```

### `add_flag`

```json
{
  "type": "add_flag",
  "target": "flag_to_add"
}
```

### `remove_flag`

```json
{
  "type": "remove_flag",
  "target": "flag_to_remove"
}
```

### `remove_all_flags`

```json
{
  "type": "remove_all_flags"
}
```

### `remove_all_flags_except`

Removes all current flags except the comma-separated flags in `target`.

```json
{
  "type": "remove_all_flags_except",
  "target": "flag_to_keep, another_flag_to_keep"
}
```
