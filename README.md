# Sboge - Text Adventure

The goal of this project is to create a simple text adventure in React, where the entire adventure is stored in json. The files are static and loaded from `public/game/` when the game runs.

## About

- `src/index.jsx` starts the React app.
- `src/components/App.jsx` is the main app component.
- `src/hooks/useGameLogic.jsx` contains most of the game logic.
- `src/utils/DispatchTrigger.js` handles what happens when an action is performed.
- `src/utils/CheckFlag.js` handles show/hide rules for flags.
- `public/game/*.json` contains the game content.
- `public/game/-start-.json` decides where a new game starts.
- `tools/editor/` contains the local editor.

## Getting Started

Install dependencies:

```sh
npm install
```

Run the game:

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

Deploy with gh-pages:

```sh
npm run deploy
```

## Chapter Editor

There is a local editor for working with the json files in `public/game/`.

Start it with:

```sh
npm run editor
```

By default it serves `tools/editor/public/` at `http://localhost:4000` and opens the browser. Use `EDITOR_PORT` to choose another port, or `EDITOR_OPEN=false` if you do not want it to open the browser automatically.

The editor runs through `tools/editor/server.js`. It reads and writes `public/game/*.json`, so changes made in the editor are changes to the actual game files. It can create, rename, delete, and edit chapters; edit scenes, paragraphs, actions and triggers; edit the start config; move scenes between chapters; validate references; and run commit/push or deploy actions locally.

The editor is only local tooling. It is not part of the Vite app and is not included in the `build/` output.

## Save Game

The save game is stored in `localStorage` under the `save` key. It is made up of three things:

- Current chapter id
- Current scene id
- Global flags

Existing saves override the start config. To force a fresh start, clear `localStorage.save`, use the debug respawn shortcut, or visit `/text-adventure/reset` in the deployed route. The reset route clears the save, returns to `/text-adventure/`, and starts again from `public/game/-start-.json`.

The first time the game starts up it will load `public/game/-start-.json`. The contents of the file decide which chapter, scene and flags it should initialize with:

```json
{
  "chapterId": "chapter_1_shipwreck",
  "sceneId": "shipwreck_1",
  "flags": []
}
```

## Controls & Shortcuts

The game can be controlled by the keyboard, or by clicking an action directly.

- `Enter` or `Space` activates the selected action.
- `ArrowUp` / `ArrowDown` changes the selected action.
- `W` / `S` also changes the selected action.
- Clicking an action activates it directly.

Debug commands:

- `Shift + H` - List of available debug commands
- `Shift + D` - List of current flags
- `Shift + C` - Clear all flags
- `Shift + N` - Respawn at beginning

## Game JSON

The game is loaded from json files. Each playable json file is a `chapter`, and must expose a top-level `scenes` array.

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

Paragraphs can be strings, or objects with `text` and optional visibility fields. A paragraph string containing only `---` renders as a horizontal rule.

Actions contain `text`, optional visibility fields, and a `triggers` array.

## Flags

Flags are stored globally and can be accessed from any chapter or scene. The most important use for flags is to show or hide paragraphs or actions.

There are four different flag fields you can use:

- `hideAny` hides a paragraph/action if any flag in this field matches an obtained flag.
- `hideAll` hides a paragraph/action if all flags in this field match obtained flags.
- `showAny` shows a paragraph/action if any flag in this field matches an obtained flag.
- `showAll` shows a paragraph/action if all flags in this field match obtained flags.

Paragraph objects with `showAny` or `showAll` are sorted by the order the matching flags were acquired unless `ignoreSortByFlag` is set.

## Triggers

Triggers are stuff that happens when an action is performed by the player.

### `movement`

Move to another scene. `chapterId` is optional, and is only needed when moving to another chapter.

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
