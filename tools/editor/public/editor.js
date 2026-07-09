const visibilityFields = [
  "hideIfAnyFlagMatches",
  "hideIfAllFlagsMatches",
  "showIfAnyFlagMatches",
  "showIfAllFlagsMatches",
];

const state = {
  chapterId: "",
  chapter: null,
  chapters: [],
  selectedSceneId: "",
  dirty: false,
  graph: null,
  editorView: {
    singleLine: false,
    collapsedGroups: {},
    expandedRows: {},
  },
};

const chapterSelect = document.getElementById("chapterSelect");
const addSceneButton = document.getElementById("addSceneButton");
const saveButton = document.getElementById("saveButton");
const statusEl = document.getElementById("status");
const editorEl = document.getElementById("editor");
const sceneIdsEl = document.getElementById("sceneIds");

const setStatus = (message, className = "") => {
  statusEl.textContent = message;
  statusEl.className = `status ${className}`.trim();
};

const markDirty = () => {
  state.dirty = true;
  setStatus("Unsaved changes", "dirty");
};

const api = async (url, options) => {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.errors?.join("\n") || body.error || response.statusText;
    throw new Error(message);
  }
  return body;
};

const splitFlags = (value) =>
  value
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean);

const formatFlags = (value) => (Array.isArray(value) ? value.join(", ") : "");

const sceneById = (sceneId) =>
  state.chapter?.scenes?.find((scene) => scene.id === sceneId);

const uniqueSceneId = () => {
  let index = state.chapter.scenes.length + 1;
  let sceneId = `scene_${index}`;
  while (sceneById(sceneId)) {
    index += 1;
    sceneId = `scene_${index}`;
  }
  return sceneId;
};

const renderSceneIdDatalist = () => {
  sceneIdsEl.innerHTML = "";
  state.chapter?.scenes?.forEach((scene) => {
    const option = document.createElement("option");
    option.value = scene.id;
    sceneIdsEl.appendChild(option);
  });
};

const movementTriggers = (scene) =>
  scene.actions.flatMap((action, actionIndex) =>
    (action.triggers || [])
      .map((trigger, triggerIndex) => ({ action, actionIndex, trigger, triggerIndex }))
      .filter(({ trigger }) => trigger.type === "movement" && trigger.target)
  );

const graphElements = () => {
  const nodes = state.chapter.scenes.map((scene) => ({
    data: {
      id: scene.id,
      label: `${scene.name || "Untitled"}\n${scene.id}`,
    },
  }));

  const externalNodes = [];
  const externalNodeIds = new Set();

  const edges = state.chapter.scenes.flatMap((scene) =>
    movementTriggers(scene).map(({ action, actionIndex, trigger, triggerIndex }) => {
      const isCrossChapter = trigger.chapterId && trigger.chapterId !== state.chapterId;
      const targetId = isCrossChapter
        ? `${trigger.chapterId}:${trigger.target}`
        : trigger.target;

      if (isCrossChapter && !externalNodeIds.has(targetId)) {
        externalNodeIds.add(targetId);
        externalNodes.push({
          data: {
            id: targetId,
            label: `${trigger.chapterId}\n${trigger.target}`,
            external: "yes",
          },
        });
      }

      return {
        data: {
          id: `edge:${scene.id}:${actionIndex}:${triggerIndex}`,
          source: scene.id,
          target: targetId,
          label: isCrossChapter ? `${action.text} (${trigger.chapterId})` : action.text,
          crossChapter: isCrossChapter ? "yes" : "no",
        },
      };
    })
  );

  return [...nodes, ...externalNodes, ...edges];
};

const nodePositions = () => {
  const positions = {};
  state.graph?.nodes().forEach((node) => {
    positions[node.id()] = { ...node.position() };
  });
  return positions;
};

const restoreNodePositions = (positions) => {
  state.graph.nodes().forEach((node) => {
    if (positions[node.id()]) node.position(positions[node.id()]);
  });
};

const renderGraph = ({ relayout = false } = {}) => {
  if (!state.chapter) return;

  const elements = graphElements();
  if (!state.graph) {
    state.graph = cytoscape({
      container: document.getElementById("graph"),
      elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#263244",
            "border-color": "#5bf870",
            "border-width": 2,
            color: "#f2f5f8",
            label: "data(label)",
            "text-halign": "center",
            "text-valign": "center",
            "text-wrap": "wrap",
            "font-size": 11,
            height: 58,
            shape: "round-rectangle",
            width: 150,
          },
        },
        {
          selector: 'node[external = "yes"]',
          style: {
            "background-color": "#3b3423",
            color: "#f2f5f8",
            "border-color": "#7b5c00",
            "border-style": "dashed",
            "border-width": 2,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-color": "#ffffff",
            "border-width": 3,
          },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "line-color": "#7b8798",
            "target-arrow-color": "#7b8798",
            color: "#c4ccd7",
            label: "data(label)",
            "font-size": 9,
            "text-background-color": "#141820",
            "text-background-opacity": 0.85,
            "text-background-padding": 3,
            width: 2,
          },
        },
        {
          selector: 'edge[crossChapter = "yes"]',
          style: {
            "line-style": "dashed",
            "line-color": "#ffd166",
            "target-arrow-color": "#ffd166",
          },
        },
      ],
      layout: { name: "cose", animate: false },
    });

    state.graph.on("tap", "node", (event) => {
      state.selectedSceneId = event.target.id();
      renderEditor();
    });
  } else {
    const positions = nodePositions();
    state.graph.elements().remove();
    state.graph.add(elements);
    restoreNodePositions(positions);
    if (relayout) state.graph.layout({ name: "cose", animate: false }).run();
  }

  if (state.selectedSceneId) {
    const selected = state.graph.getElementById(state.selectedSceneId);
    if (selected.length) selected.select();
  }
};

const groupKey = (scene, name) => `${scene.id}:group:${name}`;
const rowKey = (scene, type, index, childIndex) =>
  [scene.id, "row", type, index, childIndex].filter((part) => part !== undefined).join(":");

const isGroupCollapsed = (scene, name) =>
  Boolean(state.editorView.collapsedGroups[groupKey(scene, name)]);

const setGroupCollapsed = (scene, name, collapsed) => {
  const key = groupKey(scene, name);
  if (collapsed) state.editorView.collapsedGroups[key] = true;
  else delete state.editorView.collapsedGroups[key];
  renderEditor();
};

const isRowExpanded = (scene, type, index, childIndex) =>
  Boolean(state.editorView.expandedRows[rowKey(scene, type, index, childIndex)]);

const setRowExpanded = (scene, type, index, childIndex, expanded) => {
  const key = rowKey(scene, type, index, childIndex);
  if (expanded) state.editorView.expandedRows[key] = true;
  else delete state.editorView.expandedRows[key];
  renderEditor();
};

const clearExpandedRows = () => {
  state.editorView.expandedRows = {};
};

const expandNewRow = (scene, type, index, childIndex) => {
  state.editorView.expandedRows[rowKey(scene, type, index, childIndex)] = true;
};

const previewText = (value, fallback = "Untitled") => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
};

const visibilitySummary = (obj) =>
  visibilityFields
    .filter((visibilityField) => Array.isArray(obj?.[visibilityField]) && obj[visibilityField].length > 0)
    .map((visibilityField) => `${visibilityField}: ${obj[visibilityField].join(", ")}`);

const triggerSummary = (trigger) => {
  if (trigger.type === "remove_all_flags") return "remove_all_flags";
  const target = trigger.target || "missing target";
  if (trigger.type === "movement" && trigger.chapterId) {
    return `movement -> ${trigger.chapterId}:${target}`;
  }
  return `${trigger.type || "movement"} -> ${target}`;
};

const compactRow = (title, details, onClick) => {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "compact-row";
  row.addEventListener("click", onClick);

  const titleEl = document.createElement("span");
  titleEl.className = "compact-title";
  titleEl.textContent = title;
  row.appendChild(titleEl);

  details.forEach((detail) => {
    if (!detail) return;
    const chip = document.createElement("span");
    chip.className = "compact-chip";
    chip.textContent = detail;
    row.appendChild(chip);
  });

  return row;
};

const groupToggle = (scene, name, label) =>
  button(isGroupCollapsed(scene, name) ? `Show ${label}` : `Hide ${label}`, () => {
    setGroupCollapsed(scene, name, !isGroupCollapsed(scene, name));
  }, "small");

const collapseSceneGroups = (scene) => {
  state.editorView.collapsedGroups[groupKey(scene, "paragraphs")] = true;
  state.editorView.collapsedGroups[groupKey(scene, "actions")] = true;
  scene.actions.forEach((_action, index) => {
    state.editorView.collapsedGroups[groupKey(scene, `action:${index}:triggers`)] = true;
  });
  clearExpandedRows();
  renderEditor();
};

const expandSceneGroups = (scene) => {
  delete state.editorView.collapsedGroups[groupKey(scene, "paragraphs")];
  delete state.editorView.collapsedGroups[groupKey(scene, "actions")];
  scene.actions.forEach((_action, index) => {
    delete state.editorView.collapsedGroups[groupKey(scene, `action:${index}:triggers`)];
  });
  clearExpandedRows();
  renderEditor();
};

const field = (labelText, value, onInput, options = {}) => {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  const input = document.createElement(options.multiline ? "textarea" : "input");
  label.textContent = labelText;
  input.value = value || "";
  if (options.list) input.setAttribute("list", options.list);
  input.addEventListener("input", () => onInput(input.value));
  wrapper.append(label, input);
  return wrapper;
};

const button = (label, onClick, className = "") => {
  const el = document.createElement("button");
  el.type = "button";
  el.textContent = label;
  el.className = className;
  el.addEventListener("click", onClick);
  return el;
};

const renderVisibilityFields = (container, obj) => {
  const grid = document.createElement("div");
  grid.className = "visibility-grid";
  visibilityFields.forEach((visibilityField) => {
    grid.appendChild(
      field(visibilityField, formatFlags(obj[visibilityField]), (value) => {
        const flags = splitFlags(value);
        if (flags.length > 0) obj[visibilityField] = flags;
        else delete obj[visibilityField];
        markDirty();
        renderGraph();
      })
    );
  });
  container.appendChild(grid);
};

const moveArrayItem = (array, index, direction) => {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= array.length) return;
  const item = array[index];
  array.splice(index, 1);
  array.splice(nextIndex, 0, item);
  markDirty();
  renderEditor();
  renderGraph();
};

const renderParagraph = (scene, paragraph, index) => {
  const isObject = typeof paragraph === "object" && paragraph !== null;
  const paragraphObject = isObject ? paragraph : { text: paragraph };
  if (state.editorView.singleLine && !isRowExpanded(scene, "paragraph", index)) {
    return compactRow(
      `${index + 1}. ${previewText(paragraphObject.text, "Empty paragraph")}`,
      [isObject ? "object" : "string", ...visibilitySummary(paragraphObject)],
      () => setRowExpanded(scene, "paragraph", index, undefined, true)
    );
  }

  const card = document.createElement("div");
  card.className = "card";

  const typeSelect = document.createElement("select");
  typeSelect.innerHTML = '<option value="string">String</option><option value="object">Object</option>';
  typeSelect.value = isObject ? "object" : "string";
  typeSelect.addEventListener("change", () => {
    scene.paragraphs[index] =
      typeSelect.value === "object" ? { text: paragraphObject.text || "" } : paragraphObject.text || "";
    markDirty();
    renderEditor();
  });

  const typeWrapper = document.createElement("div");
  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Paragraph type";
  typeWrapper.append(typeLabel, typeSelect);

  card.append(
    typeWrapper,
    field("Text", paragraphObject.text, (value) => {
      if (isObject) paragraph.text = value;
      else scene.paragraphs[index] = value;
      markDirty();
    }, { multiline: true })
  );

  if (isObject) {
    renderVisibilityFields(card, paragraph);
    const checkboxRow = document.createElement("label");
    checkboxRow.className = "checkbox-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(paragraph.ignoreSortByFlag);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) paragraph.ignoreSortByFlag = true;
      else delete paragraph.ignoreSortByFlag;
      markDirty();
    });
    checkboxRow.append(checkbox, "Ignore sort by flag");
    card.appendChild(checkboxRow);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (state.editorView.singleLine) {
    actions.appendChild(button("Collapse", () => setRowExpanded(scene, "paragraph", index, undefined, false)));
  }
  actions.append(
    button("Up", () => moveArrayItem(scene.paragraphs, index, -1)),
    button("Down", () => moveArrayItem(scene.paragraphs, index, 1)),
    button("Remove", () => {
      scene.paragraphs.splice(index, 1);
      markDirty();
      renderEditor();
    }, "danger")
  );
  card.appendChild(actions);
  return card;
};

const renderTrigger = (scene, action, actionIndex, trigger, index) => {
  if (state.editorView.singleLine && !isRowExpanded(scene, "trigger", actionIndex, index)) {
    return compactRow(
      `${index + 1}. ${triggerSummary(trigger)}`,
      [],
      () => setRowExpanded(scene, "trigger", actionIndex, index, true)
    );
  }

  const card = document.createElement("div");
  card.className = "card";

  const typeSelect = document.createElement("select");
  typeSelect.innerHTML = ["movement", "add_flag", "remove_flag", "remove_all_flags"]
    .map((type) => `<option value="${type}">${type}</option>`)
    .join("");
  typeSelect.value = trigger.type || "movement";
  typeSelect.addEventListener("change", () => {
    trigger.type = typeSelect.value;
    if (trigger.type === "remove_all_flags") {
      delete trigger.target;
      delete trigger.chapterId;
    }
    markDirty();
    renderEditor();
    renderGraph();
  });

  const typeWrapper = document.createElement("div");
  const typeLabel = document.createElement("label");
  typeLabel.textContent = "Trigger type";
  typeWrapper.append(typeLabel, typeSelect);
  card.appendChild(typeWrapper);

  if (trigger.type !== "remove_all_flags") {
    card.appendChild(
      field("Target", trigger.target, (value) => {
        trigger.target = value;
        markDirty();
        renderGraph();
      }, trigger.type === "movement" ? { list: "sceneIds" } : {})
    );
  }

  if (trigger.type === "movement") {
    card.appendChild(
      field("chapterId", trigger.chapterId, (value) => {
        if (value.trim()) trigger.chapterId = value.trim();
        else delete trigger.chapterId;
        markDirty();
        renderGraph();
      })
    );
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (state.editorView.singleLine) {
    actions.appendChild(button("Collapse", () => setRowExpanded(scene, "trigger", actionIndex, index, false)));
  }
  actions.append(
    button("Up", () => moveArrayItem(action.triggers, index, -1)),
    button("Down", () => moveArrayItem(action.triggers, index, 1)),
    button("Remove", () => {
      action.triggers.splice(index, 1);
      markDirty();
      renderEditor();
      renderGraph();
    }, "danger")
  );
  card.appendChild(actions);
  return card;
};

const renderAction = (scene, action, index) => {
  if (state.editorView.singleLine && !isRowExpanded(scene, "action", index)) {
    return compactRow(
      `${index + 1}. ${previewText(action.text, "Empty action")}`,
      [`${(action.triggers || []).length} triggers`, ...visibilitySummary(action)],
      () => setRowExpanded(scene, "action", index, undefined, true)
    );
  }

  const card = document.createElement("div");
  card.className = "card";
  card.appendChild(
    field("Action text", action.text, (value) => {
      action.text = value;
      markDirty();
      renderGraph();
    })
  );
  renderVisibilityFields(card, action);

  const triggerHeader = document.createElement("div");
  triggerHeader.className = "section-header";
  const triggerTitle = document.createElement("h3");
  triggerTitle.textContent = "Triggers";
  triggerHeader.append(
    triggerTitle,
    groupToggle(scene, `action:${index}:triggers`, "Triggers"),
    button("Add Trigger", () => {
      action.triggers = action.triggers || [];
      action.triggers.push({ type: "movement", target: "" });
      expandNewRow(scene, "trigger", index, action.triggers.length - 1);
      markDirty();
      renderEditor();
      renderGraph();
    })
  );
  card.appendChild(triggerHeader);

  if (isGroupCollapsed(scene, `action:${index}:triggers`)) {
    const summary = document.createElement("div");
    summary.className = "collapsed-summary";
    summary.textContent = `${(action.triggers || []).length} triggers hidden`;
    card.appendChild(summary);
  } else {
    (action.triggers || []).forEach((trigger, triggerIndex) => {
      card.appendChild(renderTrigger(scene, action, index, trigger, triggerIndex));
    });
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (state.editorView.singleLine) {
    actions.appendChild(button("Collapse", () => setRowExpanded(scene, "action", index, undefined, false)));
  }
  actions.append(
    button("Up", () => moveArrayItem(scene.actions, index, -1)),
    button("Down", () => moveArrayItem(scene.actions, index, 1)),
    button("Remove", () => {
      scene.actions.splice(index, 1);
      markDirty();
      renderEditor();
      renderGraph();
    }, "danger")
  );
  card.appendChild(actions);
  return card;
};

const renderEditor = () => {
  renderSceneIdDatalist();
  editorEl.innerHTML = "";
  const scene = sceneById(state.selectedSceneId);
  if (!scene) {
    editorEl.innerHTML = '<div class="empty-state">Select a scene node to edit it.</div>';
    return;
  }

  const title = document.createElement("div");
  title.className = "section-header";
  const h2 = document.createElement("h2");
  h2.textContent = "Scene";
  title.append(
    h2,
    button(state.editorView.singleLine ? "Full cards" : "Single-line", () => {
      state.editorView.singleLine = !state.editorView.singleLine;
      clearExpandedRows();
      renderEditor();
    }, state.editorView.singleLine ? "small active" : "small"),
    button("Collapse all", () => collapseSceneGroups(scene), "small"),
    button("Expand all", () => expandSceneGroups(scene), "small"),
    button("Delete Scene", () => {
      if (!confirm(`Delete scene ${scene.id}?`)) return;
      state.chapter.scenes = state.chapter.scenes.filter((item) => item !== scene);
      state.selectedSceneId = state.chapter.scenes[0]?.id || "";
      markDirty();
      renderEditor();
      renderGraph({ relayout: true });
    }, "danger")
  );
  editorEl.appendChild(title);

  const fields = document.createElement("div");
  fields.className = "field-row";
  fields.append(
    field("Scene id", scene.id, (value) => {
      const previousId = scene.id;
      scene.id = value.trim();
      state.selectedSceneId = scene.id;
      state.chapter.scenes.forEach((item) => {
        item.actions.forEach((action) => {
          (action.triggers || []).forEach((trigger) => {
            if (
              trigger.type === "movement" &&
              trigger.chapterId === undefined &&
              trigger.target === previousId
            ) {
              trigger.target = scene.id;
            }
          });
        });
      });
      markDirty();
      renderSceneIdDatalist();
      renderGraph();
    }),
    field("Name", scene.name, (value) => {
      scene.name = value;
      markDirty();
      renderGraph();
    })
  );
  editorEl.appendChild(fields);

  const paragraphs = document.createElement("section");
  paragraphs.className = "section";
  const paragraphsHeader = document.createElement("div");
  paragraphsHeader.className = "section-header";
  const paragraphsTitle = document.createElement("h2");
  paragraphsTitle.textContent = "Paragraphs";
  paragraphsHeader.append(
    paragraphsTitle,
    groupToggle(scene, "paragraphs", "Paragraphs"),
    button("Add Paragraph", () => {
      scene.paragraphs.push("");
      expandNewRow(scene, "paragraph", scene.paragraphs.length - 1);
      markDirty();
      renderEditor();
    })
  );
  paragraphs.appendChild(paragraphsHeader);
  if (isGroupCollapsed(scene, "paragraphs")) {
    const summary = document.createElement("div");
    summary.className = "collapsed-summary";
    summary.textContent = `${scene.paragraphs.length} paragraphs hidden`;
    paragraphs.appendChild(summary);
  } else {
    scene.paragraphs.forEach((paragraph, index) => {
      paragraphs.appendChild(renderParagraph(scene, paragraph, index));
    });
  }
  editorEl.appendChild(paragraphs);

  const actions = document.createElement("section");
  actions.className = "section";
  const actionsHeader = document.createElement("div");
  actionsHeader.className = "section-header";
  const actionsTitle = document.createElement("h2");
  actionsTitle.textContent = "Actions";
  actionsHeader.append(
    actionsTitle,
    groupToggle(scene, "actions", "Actions"),
    button("Add Action", () => {
      scene.actions.push({ text: "", triggers: [] });
      expandNewRow(scene, "action", scene.actions.length - 1);
      markDirty();
      renderEditor();
      renderGraph();
    })
  );
  actions.appendChild(actionsHeader);
  if (isGroupCollapsed(scene, "actions")) {
    const summary = document.createElement("div");
    summary.className = "collapsed-summary";
    summary.textContent = `${scene.actions.length} actions hidden`;
    actions.appendChild(summary);
  } else {
    scene.actions.forEach((action, index) => {
      actions.appendChild(renderAction(scene, action, index));
    });
  }
  editorEl.appendChild(actions);
};

const loadChapter = async (chapterId) => {
  state.chapterId = chapterId;
  state.chapter = null;
  state.selectedSceneId = "";
  state.dirty = false;
  setStatus("Loading chapter...");
  const chapter = await api(`/api/chapters/${chapterId}`);
  state.chapter = chapter;
  state.selectedSceneId = chapter.scenes?.[0]?.id || "";
  state.editorView.collapsedGroups = {};
  clearExpandedRows();
  setStatus("Loaded", "saved");
  renderEditor();
  renderGraph({ relayout: true });
};

const loadChapters = async () => {
  state.chapters = await api("/api/chapters");
  const editableChapters = state.chapters.filter((chapter) => chapter.hasScenes);
  chapterSelect.innerHTML = "";
  editableChapters.forEach((chapter) => {
    const option = document.createElement("option");
    option.value = chapter.id;
    option.textContent = `${chapter.id} (${chapter.sceneCount})`;
    chapterSelect.appendChild(option);
  });

  if (editableChapters.length > 0) {
    await loadChapter(editableChapters[0].id);
  } else {
    setStatus("No editable chapters found", "error");
  }
};

chapterSelect.addEventListener("change", async () => {
  if (state.dirty && !confirm("Discard unsaved changes?")) {
    chapterSelect.value = state.chapterId;
    return;
  }
  await loadChapter(chapterSelect.value);
});

addSceneButton.addEventListener("click", () => {
  if (!state.chapter) return;
  const scene = {
    id: uniqueSceneId(),
    name: "New Scene",
    paragraphs: [""],
    actions: [],
  };
  state.chapter.scenes.push(scene);
  state.selectedSceneId = scene.id;
  markDirty();
  renderEditor();
  renderGraph({ relayout: true });
});

saveButton.addEventListener("click", async () => {
  if (!state.chapter || !state.chapterId) return;
  try {
    setStatus("Saving...");
    await api(`/api/chapters/${state.chapterId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.chapter),
    });
    state.dirty = false;
    setStatus("Saved", "saved");
  } catch (error) {
    setStatus(error.message, "error");
    alert(error.message);
  }
});

loadChapters().catch((error) => {
  setStatus(error.message, "error");
});
