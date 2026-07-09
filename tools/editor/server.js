const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const port = process.env.EDITOR_PORT || 4000;
const repoRoot = path.resolve(__dirname, "../..");
const gameDir = path.join(repoRoot, "public", "game");
const staticDir = path.join(__dirname, "public");

app.use(express.json({ limit: "5mb" }));
app.use(express.static(staticDir));

const isValidChapterId = (chapterId) => /^[-\w]+$/.test(chapterId);

const chapterPath = (chapterId) => {
  if (!isValidChapterId(chapterId)) {
    const error = new Error("Invalid chapter id");
    error.status = 400;
    throw error;
  }

  return path.join(gameDir, `${chapterId}.json`);
};

const readJson = async (filePath) =>
  JSON.parse(await fs.readFile(filePath, { encoding: "utf8" }));

const isStringArray = (value) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const validateVisibility = (obj, errors, pathLabel) => {
  [
    "hideAny",
    "hideAll",
    "showAny",
    "showAll",
  ].forEach((field) => {
    if (obj[field] !== undefined && !isStringArray(obj[field])) {
      errors.push(`${pathLabel}.${field} must be an array of strings`);
    }
  });
};

const validateChapter = (chapter) => {
  const errors = [];

  if (!chapter || !Array.isArray(chapter.scenes)) {
    return ["Chapter must have a top-level scenes array"];
  }

  const sceneIds = new Set();
  chapter.scenes.forEach((scene) => {
    if (scene?.id) sceneIds.add(scene.id);
  });

  chapter.scenes.forEach((scene, sceneIndex) => {
    const scenePath = `scenes[${sceneIndex}]`;
    if (!scene || typeof scene !== "object") {
      errors.push(`${scenePath} must be an object`);
      return;
    }

    if (!scene.id) errors.push(`${scenePath}.id is required`);
    if (scene.id && sceneIds.has(scene.id)) {
      const duplicateCount = chapter.scenes.filter((item) => item?.id === scene.id).length;
      if (duplicateCount > 1) errors.push(`Duplicate scene id: ${scene.id}`);
    }
    if (typeof scene.name !== "string") errors.push(`${scenePath}.name is required`);
    if (!Array.isArray(scene.paragraphs)) {
      errors.push(`${scenePath}.paragraphs must be an array`);
    }
    if (!Array.isArray(scene.actions)) {
      errors.push(`${scenePath}.actions must be an array`);
    }

    scene.paragraphs?.forEach((paragraph, paragraphIndex) => {
      const paragraphPath = `${scenePath}.paragraphs[${paragraphIndex}]`;
      if (typeof paragraph === "string") return;
      if (!paragraph || typeof paragraph !== "object") {
        errors.push(`${paragraphPath} must be a string or object`);
        return;
      }
      if (typeof paragraph.text !== "string") {
        errors.push(`${paragraphPath}.text is required`);
      }
      validateVisibility(paragraph, errors, paragraphPath);
    });

    scene.actions?.forEach((action, actionIndex) => {
      const actionPath = `${scenePath}.actions[${actionIndex}]`;
      if (!action || typeof action !== "object") {
        errors.push(`${actionPath} must be an object`);
        return;
      }
      if (typeof action.text !== "string") errors.push(`${actionPath}.text is required`);
      validateVisibility(action, errors, actionPath);
      if (!Array.isArray(action.triggers)) {
        errors.push(`${actionPath}.triggers must be an array`);
        return;
      }

      action.triggers.forEach((trigger, triggerIndex) => {
        const triggerPath = `${actionPath}.triggers[${triggerIndex}]`;
        if (!trigger || typeof trigger !== "object") {
          errors.push(`${triggerPath} must be an object`);
          return;
        }
        if (
          !["movement", "add_flag", "remove_flag", "remove_all_flags"].includes(
            trigger.type
          )
        ) {
          errors.push(`${triggerPath}.type is invalid`);
        }
        if (trigger.type !== "remove_all_flags" && !trigger.target) {
          errors.push(`${triggerPath}.target is required`);
        }
        if (
          trigger.type === "movement" &&
          trigger.chapterId === undefined &&
          trigger.target &&
          !sceneIds.has(trigger.target)
        ) {
          errors.push(`${triggerPath}.target does not match a scene id`);
        }
      });
    });
  });

  return errors;
};

app.get("/api/chapters", async (_req, res, next) => {
  try {
    const files = (await fs.readdir(gameDir)).filter((file) => file.endsWith(".json"));
    const chapters = await Promise.all(
      files.map(async (file) => {
        const chapterId = path.basename(file, ".json");
        const json = await readJson(path.join(gameDir, file));
        return {
          id: chapterId,
          file,
          isStart: chapterId === "-start-",
          hasScenes: Array.isArray(json.scenes),
          sceneCount: Array.isArray(json.scenes) ? json.scenes.length : 0,
        };
      })
    );

    res.json(chapters.sort((a, b) => a.id.localeCompare(b.id)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/chapters/:chapterId", async (req, res, next) => {
  try {
    res.json(await readJson(chapterPath(req.params.chapterId)));
  } catch (error) {
    next(error);
  }
});

app.put("/api/chapters/:chapterId", async (req, res, next) => {
  try {
    const chapterId = req.params.chapterId;
    const filePath = chapterPath(chapterId);
    const errors = validateChapter(req.body);

    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }

    await fs.writeFile(filePath, `${JSON.stringify(req.body, null, 2)}\n`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || "Server error" });
});

app.listen(port, () => {
  console.log(`Chapter editor running at http://localhost:${port}`);
});
