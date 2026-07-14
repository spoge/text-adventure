const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const port = process.env.EDITOR_PORT || 4000;
const repoRoot = path.resolve(__dirname, "../..");
const gameDir = path.join(repoRoot, "public", "game");
const staticDir = path.join(__dirname, "public");
let deployInProgress = false;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(staticDir));

const isValidChapterId = (chapterId) => /^[-\w]+$/.test(chapterId);
const startChapterId = "-start-";

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

const writeJson = async (filePath, value) =>
  fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
};

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

const validateStart = (start, chaptersById = new Map()) => {
  const errors = [];
  if (!start || typeof start !== "object" || Array.isArray(start)) {
    return ["Start config must be an object"];
  }
  if (typeof start.chapterId !== "string" || !start.chapterId.trim()) {
    errors.push("chapterId is required");
  }
  if (typeof start.sceneId !== "string" || !start.sceneId.trim()) {
    errors.push("sceneId is required");
  }
  if (start.flags !== undefined && !isStringArray(start.flags)) {
    errors.push("flags must be an array of strings");
  }

  if (chaptersById.size > 0 && start.chapterId) {
    const chapter = chaptersById.get(start.chapterId);
    if (!chapter) {
      errors.push(`chapterId does not match a chapter: ${start.chapterId}`);
    } else if (start.sceneId && !chapter.scenes?.some((scene) => scene.id === start.sceneId)) {
      errors.push(`sceneId does not match a scene in ${start.chapterId}: ${start.sceneId}`);
    }
  }

  return errors;
};

const listGameFiles = async () =>
  (await fs.readdir(gameDir)).filter((file) => file.endsWith(".json"));

const readGameFiles = async () => {
  const files = await listGameFiles();
  const entries = await Promise.all(
    files.map(async (file) => {
      const id = path.basename(file, ".json");
      const json = await readJson(path.join(gameDir, file));
      return { id, file, json };
    })
  );
  return entries.sort((a, b) => a.id.localeCompare(b.id));
};

const analyzeGame = async () => {
  const entries = await readGameFiles();
  const chapters = entries.filter((entry) => Array.isArray(entry.json.scenes));
  const start = entries.find((entry) => entry.id === startChapterId);
  const chaptersById = new Map(chapters.map((entry) => [entry.id, entry.json]));
  const sceneIdsByChapter = new Map(
    chapters.map((entry) => [entry.id, new Set(entry.json.scenes.map((scene) => scene.id).filter(Boolean))])
  );
  const references = [];
  const inbound = new Map();
  const items = [];

  const addInbound = (chapterId, sceneId, reference) => {
    const key = `${chapterId}:${sceneId}`;
    if (!inbound.has(key)) inbound.set(key, []);
    inbound.get(key).push(reference);
  };

  if (start?.json?.chapterId && start?.json?.sceneId) {
    const startReference = {
      fromChapterId: startChapterId,
      fromSceneId: "start",
      actionIndex: null,
      triggerIndex: null,
      toChapterId: start.json.chapterId,
      toSceneId: start.json.sceneId,
      source: "start",
    };
    references.push(startReference);
    addInbound(start.json.chapterId, start.json.sceneId, startReference);
  }

  chapters.forEach((entry) => {
    const errors = validateChapter(entry.json);
    errors.forEach((message) => items.push({ level: "error", chapterId: entry.id, message }));

    entry.json.scenes.forEach((scene) => {
      (scene.actions || []).forEach((action, actionIndex) => {
        (action.triggers || []).forEach((trigger, triggerIndex) => {
          if (trigger?.type !== "movement") return;
          const toChapterId = trigger.chapterId || entry.id;
          const toSceneId = trigger.target;
          const reference = {
            fromChapterId: entry.id,
            fromSceneId: scene.id,
            actionIndex,
            triggerIndex,
            actionText: action.text || "",
            toChapterId,
            toSceneId,
          };
          references.push(reference);
          if (toSceneId) addInbound(toChapterId, toSceneId, reference);

          if (!toSceneId) {
            items.push({
              level: "error",
              chapterId: entry.id,
              sceneId: scene.id,
              message: `Movement trigger is missing a target in action ${actionIndex + 1}`,
            });
          } else if (!chaptersById.has(toChapterId)) {
            items.push({
              level: "error",
              chapterId: entry.id,
              sceneId: scene.id,
              message: `Movement target chapter does not exist: ${toChapterId}`,
            });
          } else if (!sceneIdsByChapter.get(toChapterId)?.has(toSceneId)) {
            items.push({
              level: "error",
              chapterId: entry.id,
              sceneId: scene.id,
              message: `Movement target scene does not exist: ${toChapterId}:${toSceneId}`,
            });
          }
        });
      });
    });
  });

  if (start) {
    validateStart(start.json, chaptersById).forEach((message) => {
      items.push({ level: "error", chapterId: startChapterId, message });
    });
  }

  chapters.forEach((entry) => {
    const chapterInboundCount = entry.json.scenes.reduce(
      (count, scene) => count + (inbound.get(`${entry.id}:${scene.id}`)?.length || 0),
      0
    );
    if (chapterInboundCount === 0) {
      items.push({ level: "warning", chapterId: entry.id, message: "Chapter has no inbound references" });
    }
    entry.json.scenes.forEach((scene) => {
      if (!inbound.has(`${entry.id}:${scene.id}`)) {
        items.push({
          level: "info",
          chapterId: entry.id,
          sceneId: scene.id,
          message: "Scene has no inbound references",
        });
      }
    });
  });

  return { entries, chapters, chaptersById, references, inbound, items };
};

const referencesForChapter = async (chapterId) => {
  const analysis = await analyzeGame();
  return analysis.references.filter(
    (reference) => reference.toChapterId === chapterId && reference.fromChapterId !== chapterId
  );
};

const referencesForScene = async (chapterId, sceneId) => {
  const analysis = await analyzeGame();
  return analysis.references.filter(
    (reference) => reference.toChapterId === chapterId && reference.toSceneId === sceneId
  );
};

app.get("/api/chapters", async (_req, res, next) => {
  try {
    const files = await listGameFiles();
    const chapters = await Promise.all(
      files.map(async (file) => {
        const chapterId = path.basename(file, ".json");
        const json = await readJson(path.join(gameDir, file));
        return {
          id: chapterId,
          file,
          isStart: chapterId === startChapterId,
          hasScenes: Array.isArray(json.scenes),
          sceneCount: Array.isArray(json.scenes) ? json.scenes.length : 0,
          scenes: Array.isArray(json.scenes)
            ? json.scenes.map((scene) => ({ id: scene.id, name: scene.name || "" }))
            : [],
        };
      })
    );

    res.json(chapters.sort((a, b) => a.id.localeCompare(b.id)));
  } catch (error) {
    next(error);
  }
});

app.post("/api/chapters", async (req, res, next) => {
  try {
    const chapterId = String(req.body?.chapterId || "").trim();
    if (!isValidChapterId(chapterId) || chapterId === startChapterId) {
      res.status(400).json({ error: "Invalid chapter id" });
      return;
    }
    const filePath = chapterPath(chapterId);
    if (await fileExists(filePath)) {
      res.status(409).json({ error: "Chapter already exists" });
      return;
    }
    await writeJson(filePath, {
      scenes: [
        {
          id: "scene_1",
          name: "New Scene",
          paragraphs: [""],
          actions: [],
        },
      ],
    });
    res.status(201).json({ ok: true, chapterId });
  } catch (error) {
    next(error);
  }
});

app.get("/api/chapters/:chapterId/references", async (req, res, next) => {
  try {
    res.json({ references: await referencesForChapter(req.params.chapterId) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/chapters/:chapterId/scenes/:sceneId/references", async (req, res, next) => {
  try {
    res.json({ references: await referencesForScene(req.params.chapterId, req.params.sceneId) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/chapters/:chapterId/restore", async (req, res, next) => {
  try {
    const chapterId = req.params.chapterId;
    if (chapterId === startChapterId) {
      res.status(400).json({ error: "Cannot restore over start config" });
      return;
    }
    const chapter = req.body?.chapter;
    const affectedEntries = Array.isArray(req.body?.affectedEntries) ? req.body.affectedEntries : [];
    const errors = validateChapter(chapter);
    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }

    await Promise.all(
      affectedEntries.map(async (entry) => {
        if (!isValidChapterId(entry?.id) || !entry?.json) return;
        await writeJson(chapterPath(entry.id), entry.json);
      })
    );
    await writeJson(chapterPath(chapterId), chapter);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/scenes/move", async (req, res, next) => {
  try {
    const fromChapterId = String(req.body?.fromChapterId || "").trim();
    const toChapterId = String(req.body?.toChapterId || "").trim();
    const sceneId = String(req.body?.sceneId || "").trim();
    const newSceneId = String(req.body?.newSceneId || sceneId).trim();

    if (!isValidChapterId(fromChapterId) || !isValidChapterId(toChapterId) || !sceneId || !newSceneId) {
      res.status(400).json({ error: "Invalid scene move request" });
      return;
    }
    if (fromChapterId === startChapterId || toChapterId === startChapterId) {
      res.status(400).json({ error: "Cannot move scenes to or from start config" });
      return;
    }

    const analysis = await analyzeGame();
    const entriesById = new Map(analysis.entries.map((entry) => [entry.id, { ...entry, json: cloneJson(entry.json) }]));
    const fromEntry = entriesById.get(fromChapterId);
    const toEntry = entriesById.get(toChapterId);
    if (!fromEntry?.json?.scenes || !toEntry?.json?.scenes) {
      res.status(404).json({ error: "Source or destination chapter not found" });
      return;
    }

    const sourceSceneIndex = fromEntry.json.scenes.findIndex((scene) => scene.id === sceneId);
    if (sourceSceneIndex === -1) {
      res.status(404).json({ error: "Source scene not found" });
      return;
    }
    if (toEntry.json.scenes.some((scene) => scene.id === newSceneId)) {
      res.status(409).json({ error: `Destination scene already exists: ${newSceneId}` });
      return;
    }

    const originals = new Map();
    const rememberOriginal = (entryId) => {
      if (originals.has(entryId)) return;
      const original = analysis.entries.find((entry) => entry.id === entryId);
      if (original) originals.set(entryId, { id: entryId, json: cloneJson(original.json) });
    };

    rememberOriginal(fromChapterId);
    rememberOriginal(toChapterId);
    const movedScene = fromEntry.json.scenes.splice(sourceSceneIndex, 1)[0];
    movedScene.id = newSceneId;

    const targetHasScene = (targetChapterId, targetSceneId) =>
      entriesById.get(targetChapterId)?.json?.scenes?.some((scene) => scene.id === targetSceneId);

    const normalizeMovedSceneOutgoing = () => {
      (movedScene.actions || []).forEach((action) => {
        (action.triggers || []).forEach((trigger) => {
          if (trigger?.type !== "movement" || !trigger.target) return;
          if (!trigger.chapterId && trigger.target === sceneId) {
            trigger.target = newSceneId;
            return;
          }
          if (!trigger.chapterId) {
            if (targetHasScene(toChapterId, trigger.target)) return;
            trigger.chapterId = fromChapterId;
          } else if (trigger.chapterId === toChapterId && targetHasScene(toChapterId, trigger.target)) {
            delete trigger.chapterId;
          }
        });
      });
    };

    normalizeMovedSceneOutgoing();
    toEntry.json.scenes.push(movedScene);

    const changedReferences = [];
    entriesById.forEach((entry) => {
      if (!entry.json?.scenes) return;
      entry.json.scenes.forEach((scene) => {
        (scene.actions || []).forEach((action, actionIndex) => {
          (action.triggers || []).forEach((trigger, triggerIndex) => {
            if (trigger?.type !== "movement" || trigger.target !== sceneId) return;
            const targetChapterId = trigger.chapterId || entry.id;
            if (targetChapterId !== fromChapterId) return;

            rememberOriginal(entry.id);
            changedReferences.push({
              fromChapterId: entry.id,
              fromSceneId: scene.id,
              actionIndex,
              triggerIndex,
              actionText: action.text || "",
              toChapterId,
              toSceneId: newSceneId,
            });
            trigger.target = newSceneId;
            if (entry.id === toChapterId) delete trigger.chapterId;
            else trigger.chapterId = toChapterId;
          });
        });
      });
    });

    const start = entriesById.get(startChapterId);
    if (start?.json?.chapterId === fromChapterId && start.json.sceneId === sceneId) {
      rememberOriginal(startChapterId);
      start.json.chapterId = toChapterId;
      start.json.sceneId = newSceneId;
      changedReferences.push({
        fromChapterId: startChapterId,
        fromSceneId: "start",
        actionIndex: null,
        triggerIndex: null,
        toChapterId,
        toSceneId: newSceneId,
        source: "start",
      });
    }

    const affectedEntries = [...originals.values()];
    await Promise.all(
      affectedEntries.map(async (entry) => {
        await writeJson(chapterPath(entry.id), entriesById.get(entry.id).json);
      })
    );

    const updatedEntries = affectedEntries.map((entry) => ({
      id: entry.id,
      json: cloneJson(entriesById.get(entry.id).json),
    }));

    res.json({
      ok: true,
      affectedEntries,
      updatedEntries,
      changedReferences,
      movedScene: cloneJson(movedScene),
      fromChapterId,
      toChapterId,
      sceneId,
      newSceneId,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/entries/restore", async (req, res, next) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (entries.length === 0) {
      res.status(400).json({ error: "No entries to restore" });
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (!isValidChapterId(entry?.id) || !entry?.json) return;
        const errors = entry.id === startChapterId
          ? validateStart(entry.json)
          : validateChapter(entry.json);
        if (errors.length > 0) {
          const error = new Error(`Invalid restore entry ${entry.id}: ${errors.join(", ")}`);
          error.status = 400;
          throw error;
        }
        await writeJson(chapterPath(entry.id), entry.json);
      })
    );
    res.json({ ok: true });
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
    const analysis = await analyzeGame();
    const errors = chapterId === startChapterId
      ? validateStart(req.body, analysis.chaptersById)
      : validateChapter(req.body);

    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }

    await writeJson(filePath, req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/chapters/:chapterId", async (req, res, next) => {
  try {
    const chapterId = req.params.chapterId;
    if (chapterId === startChapterId) {
      res.status(400).json({ error: "Cannot delete start config" });
      return;
    }
    const filePath = chapterPath(chapterId);
    if (!(await fileExists(filePath))) {
      res.status(404).json({ error: "Chapter not found" });
      return;
    }

    const analysis = await analyzeGame();
    const deletedChapter = await readJson(filePath);
    const affectedEntries = [];
    let removedTriggers = 0;
    await Promise.all(
      analysis.chapters
        .filter((entry) => entry.id !== chapterId)
        .map(async (entry) => {
          let changed = false;
          entry.json.scenes.forEach((scene) => {
            (scene.actions || []).forEach((action) => {
              const before = action.triggers?.length || 0;
              action.triggers = (action.triggers || []).filter(
                (trigger) => !(trigger.type === "movement" && trigger.chapterId === chapterId)
              );
              removedTriggers += before - action.triggers.length;
              if (before !== action.triggers.length) changed = true;
            });
          });
          if (changed) {
            affectedEntries.push({ id: entry.id, json: await readJson(path.join(gameDir, entry.file)) });
            await writeJson(path.join(gameDir, entry.file), entry.json);
          }
        })
    );

    const start = analysis.entries.find((entry) => entry.id === startChapterId);
    if (start?.json?.chapterId === chapterId) {
      affectedEntries.push({ id: start.id, json: await readJson(path.join(gameDir, start.file)) });
      const fallbackChapter = analysis.chapters.find((entry) => entry.id !== chapterId);
      if (fallbackChapter) {
        start.json.chapterId = fallbackChapter.id;
        start.json.sceneId = fallbackChapter.json.scenes[0]?.id || "";
      } else {
        start.json.chapterId = "";
        start.json.sceneId = "";
      }
      await writeJson(path.join(gameDir, start.file), start.json);
    }

    await fs.unlink(filePath);
    res.json({ ok: true, removedTriggers, deletedChapter, affectedEntries });
  } catch (error) {
    next(error);
  }
});

app.get("/api/validation", async (_req, res, next) => {
  try {
    const analysis = await analyzeGame();
    res.json({ items: analysis.items });
  } catch (error) {
    next(error);
  }
});

app.post("/api/deploy", async (_req, res, next) => {
  if (deployInProgress) {
    res.status(409).json({ error: "Deploy already in progress" });
    return;
  }

  deployInProgress = true;
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn("npm run deploy", {
        cwd: repoRoot,
        shell: true,
      });
      const chunks = [];
      const appendOutput = (chunk) => chunks.push(chunk.toString());

      child.stdout.on("data", appendOutput);
      child.stderr.on("data", appendOutput);
      child.on("error", reject);
      child.on("close", (code) => {
        const combinedOutput = chunks.join("").trim();
        if (code === 0) {
          resolve(combinedOutput);
          return;
        }

        const error = new Error(combinedOutput || `Deploy failed with exit code ${code}`);
        error.status = 500;
        reject(error);
      });
    });

    res.json({ ok: true, output });
  } catch (error) {
    next(error);
  } finally {
    deployInProgress = false;
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || "Server error" });
});

app.listen(port, () => {
  console.log(`Chapter editor running at http://localhost:${port}`);
});
