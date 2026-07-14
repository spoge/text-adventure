# Sboge - Text Adventure

The goal of this project is to create a simple text adventure in React, where the entire adventure is stored in json. These files are static and immutable.

The save game is comprised of three things:

- Current Chapter
- Current Scene
- Flags (stored globally and can be accessed from any chapter or scene)

## Controls & Shortcuts

The game can be controlled by the arrow keys and enter, or by clicking an action directly.

### Debug commands:

- `Shift + H` - List of available debug commands
- `Shift + D` - List of current flags
- `Shift + C` - Clear all flags
- `Shift + N` - Respawn at beginning

## About

The game is loaded from json-files. Each json-file is a `chapter`.

### First spawn

The first time the game starts up it will load `-start.json-`. The contents of the file will determine which chapter, scene and which flags it should initialize with:

```
{
  "chapterId": "chapter",
  "sceneId": "scene_1",
  "flags": []
}

```

### Structure of a `chapter.json`

```
{
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
            "text": "What is that?",
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

## Flags

The most important uses for flags is to show or hide paragraphs or actions.
There are four different flag fields you can use.

#### `hideAny` hide paragraph/action if any flag in this field matches an obtained flag

#### `showAny` show paragraph/action if any flag in this field matches an obtained flag

#### `showAll` show paragraph/action if all flags in this field matches obtained flags

#### `hideAll` hide paragraph/action if all flags in this field matches obtained flags

## Triggers

Triggers are stuff that happenes when an action is performed by the player.

### Type of triggers:

#### `movement`

```
{
    "type": "movement",
    "target": "target_scene",
    "chapter": "optional_target_chapter"
}
```

#### `add_flag`

```
{
    "type": "add_flag",
    "target": "flag_to_add",
}
```

#### `remove_flag`

```
{
    "type": "remove_flag",
    "target": "flag_to_remove",
}
```

#### `remove_all_flags`

```
{
    "type": "remove_all_flags"
}
```

#### `remove_all_flags_except`

Removes all current flags except the comma-separated flags in `target`.

```
{
    "type": "remove_all_flags_except",
    "target": "flag_to_keep, another_flag_to_keep"
}
```

## Scripts

### Install dependencies

`npm install`

### Run on localhost:3000

`npm start`

### Deploy application with gh-pages

`npm run deploy`
