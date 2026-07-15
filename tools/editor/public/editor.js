const visibilityFields = [
  "hideAny",
  "hideAll",
  "showAny",
  "showAll",
];

const historyLimit = 10;
const graphMinZoom = 0.35;
const graphMaxZoom = 2;
const graphPanPadding = 300;
const graphLayoutPadding = 90;
const graphDirectedNodeSep = 70;
const graphDirectedRankSep = 150;
const graphDirectedEdgeSep = 50;
const graphNodeWidth = 150;
const graphOrganicNodeRepulsion = 14000;
const graphOrganicIdealEdgeLength = 280;
const graphOrganicNodeOverlap = 70;
const startChapterId = "-start-";
const panelLayoutStorageKey = "textAdventureEditorPanelLayout";
const editorSelectionStorageKey = "textAdventureEditorSelection";
const graphLayoutStorageKey = "textAdventureEditorGraphLayout";

const state = {
  chapterId: "",
  chapter: null,
  chapters: [],
  selectedSceneId: "",
  dirty: false,
  graph: null,
  graphDagreRegistered: false,
  graphLayoutMode: "auto",
  graphRenderedLayoutKey: "",
  graphLayoutSaveTimer: null,
  isRestoringGraphLayout: false,
  isClampingGraphPan: false,
  savedSnapshot: "",
  undoStack: [],
  redoStack: [],
  previewFlags: [],
  pendingPreviewMovement: null,
  pendingGraphNavigation: null,
  chapterReferences: { references: [] },
  safeDeletion: true,
  sceneClipboard: null,
  contextMenu: null,
  autocompleteMenu: null,
  autocompleteInput: null,
  pendingScrollRowKey: "",
  deploying: false,
  editorView: {
    singleLine: true,
    singleLineFullText: true,
    collapsedGroups: {},
    expandedRows: {},
  },
  panelLayout: {
    mode: "beside",
    graphSplit: 55,
    splits: {
      beside: 50,
      below: 58,
    },
  },
  graphCrossChapterMode: "scene",
  panelResize: null,
};

const layoutEl = document.querySelector(".layout");
const chapterSelect = document.getElementById("chapterSelect");
const fileMenuButton = document.getElementById("fileMenuButton");
const editMenuButton = document.getElementById("editMenuButton");
const chapterMenuButton = document.getElementById("chapterMenuButton");
const sceneMenuButton = document.getElementById("sceneMenuButton");
const viewMenuButton = document.getElementById("viewMenuButton");
const layoutMenuButton = document.getElementById("layoutMenuButton");
const toolsMenuButton = document.getElementById("toolsMenuButton");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const saveButton = document.getElementById("saveButton");
const statusEl = document.getElementById("status");
const validationPanel = document.getElementById("validationPanel");
const editorEl = document.getElementById("editor");
const previewEl = document.getElementById("preview");
const graphWorkspaceSplitter = document.getElementById("graphWorkspaceSplitter");
const editorPreviewSplitter = document.getElementById("editorPreviewSplitter");
const sceneIdsEl = document.getElementById("sceneIds");
const startSceneIdsEl = document.getElementById("startSceneIds");
const chapterIdsEl = document.getElementById("chapterIds");

const setStatus = (message, className = "") => {
  statusEl.textContent = message;
  statusEl.className = `status ${className}`.trim();
};

const chapterSnapshot = () => (state.chapter ? JSON.stringify(state.chapter) : "");

const updateHistoryButtons = () => {
  undoButton.disabled = state.undoStack.length === 0;
  redoButton.disabled = state.redoStack.length === 0;
};

const updateDirtyStatus = () => {
  const dirty = Boolean(state.chapter) && chapterSnapshot() !== state.savedSnapshot;
  state.dirty = dirty;
  setStatus(dirty ? "Unsaved changes" : "Saved", dirty ? "dirty" : "saved");
  updateHistoryButtons();
};

const markDirty = () => {
  state.pendingPreviewMovement = null;
  updateDirtyStatus();
  renderPreview();
};

const pushHistorySnapshot = (snapshot) => {
  if (!snapshot) return;
  if (state.undoStack[state.undoStack.length - 1] === snapshot) return;
  state.undoStack.push(snapshot);
  if (state.undoStack.length > historyLimit) state.undoStack.shift();
};

const recordHistory = () => {
  pushHistorySnapshot(chapterSnapshot());
  state.redoStack = [];
  updateHistoryButtons();
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

const formatReference = (reference) => {
  if (typeof reference === "string") return reference;
  if (reference.source === "start" || reference.fromChapterId === startChapterId) {
    return `${startChapterId} starts at ${reference.toChapterId}/${reference.toSceneId}`;
  }
  const action = reference.actionText ? `, action "${reference.actionText}"` : `, action ${reference.actionIndex + 1}`;
  return `${reference.fromChapterId}/${reference.fromSceneId}${action}, trigger ${reference.triggerIndex + 1}`;
};

const referenceDetails = (deletedLabel, references) => {
  if (references.length === 0) return "";
  return [
    `${deletedLabel} is referenced by:`,
    ...references.map((reference) => `- ${formatReference(reference)}`),
  ].join("\n");
};

const confirmDeletion = (deletedLabel, references, extra = "") => {
  const details = referenceDetails(deletedLabel, references);
  if (state.safeDeletion && references.length > 0) {
    alert(`Cannot delete while Safe deletion is enabled.\n\n${details}`);
    return false;
  }
  const warning = details ? `\n\n${details}` : "";
  return confirm(`Delete ${deletedLabel}?${warning}${extra}`);
};

const addFlagReferences = (references, label, obj, flags) => {
  visibilityFields.forEach((fieldName) => {
    (obj?.[fieldName] || []).forEach((flag) => {
      if (flags.has(flag)) references.push(`${label} uses flag "${flag}" in ${fieldName}`);
    });
  });
};

const flagReferences = (flags, ignoredObject) => {
  const flagSet = new Set(flags.filter(Boolean));
  if (flagSet.size === 0) return [];
  const references = [];
  (state.chapter?.scenes || []).forEach((scene) => {
    (scene.paragraphs || []).forEach((paragraph, paragraphIndex) => {
      if (paragraph === ignoredObject || typeof paragraph !== "object" || paragraph === null) return;
      addFlagReferences(references, `${scene.id} paragraph ${paragraphIndex + 1}`, paragraph, flagSet);
    });
    (scene.actions || []).forEach((action, actionIndex) => {
      if (action === ignoredObject) return;
      addFlagReferences(references, `${scene.id} action ${actionIndex + 1}`, action, flagSet);
      (action.triggers || []).forEach((trigger, triggerIndex) => {
        if (trigger === ignoredObject) return;
        if (["add_flag", "remove_flag"].includes(trigger.type) && flagSet.has(trigger.target)) {
          references.push(`${scene.id} action ${actionIndex + 1} trigger ${triggerIndex + 1} ${trigger.type} "${trigger.target}"`);
        }
        if (trigger.type === "remove_all_flags_except") {
          splitFlags(trigger.target || "").forEach((flag) => {
            if (flagSet.has(flag)) {
              references.push(`${scene.id} action ${actionIndex + 1} trigger ${triggerIndex + 1} keeps flag "${flag}"`);
            }
          });
        }
      });
    });
  });
  return references;
};

const flagsChangedByTriggers = (triggers = []) =>
  triggers
    .flatMap((trigger) => {
      if (["add_flag", "remove_flag"].includes(trigger.type) && trigger.target) return [trigger.target];
      if (trigger.type === "remove_all_flags_except") return splitFlags(trigger.target || "");
      return [];
    });

const splitFlags = (value) =>
  value
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean);

const formatFlags = (value) => (Array.isArray(value) ? value.join(", ") : "");

const sceneById = (sceneId) =>
  state.chapter?.scenes?.find((scene) => scene.id === sceneId);

const deepClone = (value) => JSON.parse(JSON.stringify(value));

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

const renderChapterIdDatalist = () => {
  chapterIdsEl.innerHTML = "";
  state.chapters
    .filter((chapter) => chapter.hasScenes)
    .forEach((chapter) => {
      const option = document.createElement("option");
      option.value = chapter.id;
      chapterIdsEl.appendChild(option);
    });
};

const chapterMetaById = (chapterId) =>
  state.chapters.find((chapter) => chapter.id === chapterId);

const chapterDisplayName = (chapter) =>
  chapter?.name?.trim() || chapter?.id || "Untitled chapter";

const chapterOptionText = (chapter) => {
  if (chapter.isStart) return `${chapter.id} (start)`;
  const sceneLabel = chapter.sceneCount === 1 ? "scene" : "scenes";
  return `${chapterDisplayName(chapter)} (${chapter.id}, ${chapter.sceneCount} ${sceneLabel})`;
};

const movementTargetScenes = (trigger) => {
  const chapterId = trigger.chapterId?.trim();
  if (!chapterId || chapterId === state.chapterId) return state.chapter?.scenes || [];
  return chapterMetaById(chapterId)?.scenes || [];
};

const movementTargetDatalistId = (scene, actionIndex, triggerIndex) =>
  `movementTargets-${scene.id}-${actionIndex}-${triggerIndex}`.replace(/[^-\w]/g, "_");

const fillMovementTargetDatalist = (datalist, trigger) => {
  datalist.innerHTML = "";
  movementTargetScenes(trigger).forEach((scene) => {
    const option = document.createElement("option");
    option.value = scene.id;
    option.label = scene.name ? `${scene.id} - ${scene.name}` : scene.id;
    datalist.appendChild(option);
  });
};

const movementTargetDatalist = (id, trigger) => {
  const datalist = document.createElement("datalist");
  datalist.id = id;
  fillMovementTargetDatalist(datalist, trigger);
  return datalist;
};

const hideAutocompleteMenu = () => {
  state.autocompleteMenu?.remove();
  state.autocompleteMenu = null;
  state.autocompleteInput = null;
};

const positionAutocompleteMenu = (input, menu) => {
  const bounds = input.getBoundingClientRect();
  menu.style.left = `${bounds.left}px`;
  menu.style.top = `${bounds.bottom + 4}px`;
  menu.style.width = `${Math.max(bounds.width, 224)}px`;
};

const showAutocompleteMenu = (input, items, query, onSelect, emptyText = "No matches") => {
  hideAutocompleteMenu();
  const menu = document.createElement("div");
  menu.className = "autocomplete-menu";
  const search = String(query || "").trim().toLowerCase();
  const matches = items.filter((item) => {
    if (!search) return true;
    return [item.value, item.detail].filter(Boolean).some((value) => value.toLowerCase().includes(search));
  });

  if (matches.length === 0) {
    const empty = document.createElement("div");
    empty.className = "autocomplete-empty";
    empty.textContent = emptyText;
    menu.appendChild(empty);
  } else {
    matches.forEach((item) => {
      const option = button("", () => onSelect(item.value));
      const title = document.createElement("span");
      title.className = "autocomplete-title";
      title.textContent = item.value;
      const detail = document.createElement("span");
      detail.className = "autocomplete-detail";
      detail.textContent = item.detail || "";
      option.append(title, detail);
      menu.appendChild(option);
    });
  }

  document.body.appendChild(menu);
  positionAutocompleteMenu(input, menu);
  state.autocompleteMenu = menu;
  state.autocompleteInput = input;
};

const sceneAutocompleteItems = (chapterId) => {
  const chapter = chapterId && chapterId !== state.chapterId
    ? chapterMetaById(chapterId)
    : null;
  const scenes = chapter?.scenes || state.chapter?.scenes || [];
  return scenes.map((scene) => ({
    value: scene.id,
    detail: scene.name || "Untitled scene",
  }));
};

const chapterAutocompleteItems = () =>
  state.chapters
    .filter((chapter) => chapter.hasScenes)
    .map((chapter) => ({
      value: chapter.id,
      detail: `${chapterDisplayName(chapter)}; ${chapter.sceneCount ?? chapter.scenes?.length ?? 0} scenes`,
    }));

const renderStartSceneIdDatalist = () => {
  startSceneIdsEl.innerHTML = "";
  const chapter = chapterMetaById(state.chapter?.chapterId);
  (chapter?.scenes || []).forEach((scene) => {
    const option = document.createElement("option");
    option.value = scene.id;
    option.label = scene.name ? `${scene.id} - ${scene.name}` : scene.id;
    startSceneIdsEl.appendChild(option);
  });
};

const isStartConfig = () => state.chapterId === startChapterId;

const movementTriggers = (scene) =>
  scene.actions.flatMap((action, actionIndex) =>
    (action.triggers || [])
      .map((trigger, triggerIndex) => ({ action, actionIndex, trigger, triggerIndex }))
      .filter(({ trigger }) => trigger.type === "movement" && trigger.target)
  );

const graphTextPreview = (value, maxLength = 48) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
};

const externalNodeId = (chapterId, sceneId) => `external:${chapterId}:${sceneId}`;
const externalChapterNodeId = (chapterId) => `external-chapter:${chapterId}`;

const updateExternalNodeLabel = (node) => {
  if (node.start === "yes") {
    node.label = "Start";
  } else if (node.grouped === "yes") {
    const chapterName = chapterDisplayName(chapterMetaById(node.chapterId));
    node.label = `Enter from ${chapterName}\n${node.linkCount} ${node.linkCount === 1 ? "link" : "links"}`;
  } else if (node.enter === "yes" && node.external === "yes") {
    node.both = "yes";
    node.label = `${node.chapterId}\n${node.sceneId}`;
  } else if (node.enter === "yes") {
    node.label = `Enter from ${node.chapterId}\n${node.sceneId}`;
  } else if (node.external === "yes") {
    node.label = `Exit to ${node.chapterId}\n${node.sceneId}`;
  }
};

const addOrUpdateExternalNode = (nodesById, id, data) => {
  const existing = nodesById.get(id) || { id };
  Object.assign(existing, data);
  updateExternalNodeLabel(existing);
  nodesById.set(id, existing);
};

const startGraphElements = () => {
  if (!state.chapter || state.chapterId !== startChapterId) return [];
  const startNodeId = "start-node";
  const targetNodeId = externalNodeId(state.chapter.chapterId || "missing", state.chapter.sceneId || "missing");
  return [
    {
      data: {
        id: startNodeId,
        label: "Start",
        start: "yes",
        chapterId: startChapterId,
        sceneId: "",
        navigationKind: "start",
      },
    },
    {
      data: {
        id: targetNodeId,
        label: `Exit to ${state.chapter.chapterId || "missing"}\n${state.chapter.sceneId || "missing"}`,
        external: "yes",
        chapterId: state.chapter.chapterId,
        sceneId: state.chapter.sceneId,
        navigationKind: "exit",
      },
    },
    {
      data: {
        id: "start-edge",
        source: startNodeId,
        target: targetNodeId,
        label: "starts at",
        crossChapter: "yes",
      },
    },
  ];
};

const graphElements = () => {
  if (state.chapterId === startChapterId) return startGraphElements();
  if (!state.chapter?.scenes) return [];
  const localSceneIds = new Set(state.chapter.scenes.map((scene) => scene.id));
  const nodes = state.chapter.scenes.map((scene) => ({
    data: {
      id: scene.id,
      label: `${scene.name || "Untitled"}\n${scene.id}`,
    },
  }));

  const externalNodesById = new Map();

  const edges = state.chapter.scenes.flatMap((scene) =>
    movementTriggers(scene).map(({ action, actionIndex, trigger, triggerIndex }) => {
      const isCrossChapter = trigger.chapterId && trigger.chapterId !== state.chapterId;
      const isMissingLocal = !isCrossChapter && !localSceneIds.has(trigger.target);
      const targetId = isCrossChapter
        ? externalNodeId(trigger.chapterId, trigger.target)
        : isMissingLocal
          ? `missing:${trigger.target}`
        : trigger.target;

      if (isCrossChapter) {
        addOrUpdateExternalNode(externalNodesById, targetId, {
          external: "yes",
          chapterId: trigger.chapterId,
          sceneId: trigger.target,
          navigationKind: "exit",
        });
      } else if (isMissingLocal) {
        addOrUpdateExternalNode(externalNodesById, targetId, {
          label: `Missing target\n${trigger.target}`,
          missing: "yes",
        });
      }

      return {
        data: {
          id: `edge:${scene.id}:${actionIndex}:${triggerIndex}`,
          source: scene.id,
          target: targetId,
          label: graphTextPreview(
            isCrossChapter ? `${action.text} (${trigger.chapterId})` : action.text
          ),
          crossChapter: isCrossChapter ? "yes" : "no",
          missing: isMissingLocal ? "yes" : "no",
        },
      };
    })
  );

  const inboundReferences = (state.chapterReferences.references || []).filter(
    (reference) =>
      reference.toChapterId === state.chapterId &&
      localSceneIds.has(reference.toSceneId) &&
      reference.fromChapterId !== state.chapterId
  );

  const inboundEdges = state.graphCrossChapterMode === "grouped"
    ? (() => {
      const groups = new Map();
      const nodeCounts = new Map();
      inboundReferences.forEach((reference) => {
        const isStart = reference.fromChapterId === startChapterId;
        if (isStart) {
          const key = `${reference.fromChapterId}:${reference.fromSceneId}:${reference.toSceneId}`;
          groups.set(key, { references: [reference], nodeId: "start-node", isStart });
          return;
        }

        const key = `${reference.fromChapterId}:${reference.toSceneId}`;
        if (!groups.has(key)) {
          groups.set(key, {
            references: [],
            nodeId: externalChapterNodeId(reference.fromChapterId),
            isStart: false,
          });
        }
        groups.get(key).references.push(reference);
        nodeCounts.set(reference.fromChapterId, (nodeCounts.get(reference.fromChapterId) || 0) + 1);
      });

      return [...groups.values()].map((group, index) => {
        const firstReference = group.references[0];
        if (group.isStart) {
          addOrUpdateExternalNode(externalNodesById, group.nodeId, {
            enter: "yes",
            start: "yes",
            chapterId: firstReference.fromChapterId,
            sceneId: "",
            navigationKind: "start",
          });
        } else {
          addOrUpdateExternalNode(externalNodesById, group.nodeId, {
            enter: "yes",
            grouped: "yes",
            chapterId: firstReference.fromChapterId,
            sceneId: firstReference.fromSceneId,
            linkCount: nodeCounts.get(firstReference.fromChapterId) || group.references.length,
            navigationKind: "enter",
          });
        }

        return {
          data: {
            id: `enter-group-edge:${firstReference.fromChapterId}:${firstReference.toSceneId}:${index}`,
            source: group.nodeId,
            target: firstReference.toSceneId,
            label: group.isStart
              ? graphTextPreview(firstReference.actionText || "entry")
              : `${group.references.length} ${group.references.length === 1 ? "link" : "links"}`,
            crossChapter: "yes",
            grouped: group.isStart ? "no" : "yes",
          },
        };
      });
    })()
    : inboundReferences.map((reference, index) => {
      const isStart = reference.fromChapterId === startChapterId;
      const nodeId = isStart ? "start-node" : externalNodeId(reference.fromChapterId, reference.fromSceneId);
      addOrUpdateExternalNode(externalNodesById, nodeId, {
        enter: "yes",
        start: isStart ? "yes" : undefined,
        chapterId: reference.fromChapterId,
        sceneId: isStart ? "" : reference.fromSceneId,
        navigationKind: isStart ? "start" : "enter",
      });
      return {
        data: {
          id: `enter-edge:${reference.fromChapterId}:${reference.fromSceneId}:${index}`,
          source: nodeId,
          target: reference.toSceneId,
          label: graphTextPreview(reference.actionText || "entry"),
          crossChapter: "yes",
        },
      };
    });

  const externalNodes = [...externalNodesById.values()].map((data) => ({ data }));
  return [...nodes, ...externalNodes, ...edges, ...inboundEdges];
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

const graphLayoutKey = () =>
  state.chapterId ? `${state.chapterId}|${state.graphCrossChapterMode}` : "";

const validPoint = (value) =>
  value &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y);

const sanitizeGraphLayout = (layout) => {
  if (!layout || typeof layout !== "object") return null;
  const positions = {};
  Object.entries(layout.positions || {}).forEach(([id, position]) => {
    if (typeof id === "string" && validPoint(position)) {
      positions[id] = { x: position.x, y: position.y };
    }
  });
  const zoom = Number(layout.zoom);
  return {
    positions,
    pan: validPoint(layout.pan) ? { x: layout.pan.x, y: layout.pan.y } : null,
    zoom: Number.isFinite(zoom) ? clamp(zoom, graphMinZoom, graphMaxZoom) : null,
  };
};

const emptyGraphLayoutStore = () => ({
  prefs: {},
  layouts: {},
});

const loadGraphLayoutStore = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(graphLayoutStorageKey) || "null");
    if (!saved || typeof saved !== "object") return emptyGraphLayoutStore();
    return {
      prefs: saved.prefs && typeof saved.prefs === "object" ? saved.prefs : {},
      layouts: saved.layouts && typeof saved.layouts === "object" ? saved.layouts : {},
    };
  } catch (error) {
    console.warn("Could not load editor graph layout", error);
    return emptyGraphLayoutStore();
  }
};

const saveGraphLayoutStore = (store) => {
  try {
    localStorage.setItem(graphLayoutStorageKey, JSON.stringify(store));
  } catch (error) {
    console.warn("Could not save editor graph layout", error);
  }
};

const loadGraphPreferences = () => {
  const { prefs } = loadGraphLayoutStore();
  if (["auto", "directed", "organic", "grid"].includes(prefs.graphLayoutMode)) {
    state.graphLayoutMode = prefs.graphLayoutMode;
  }
  if (["scene", "grouped"].includes(prefs.graphCrossChapterMode)) {
    state.graphCrossChapterMode = prefs.graphCrossChapterMode;
  }
};

const saveGraphPreferences = () => {
  const store = loadGraphLayoutStore();
  store.prefs = {
    graphLayoutMode: state.graphLayoutMode,
    graphCrossChapterMode: state.graphCrossChapterMode,
  };
  saveGraphLayoutStore(store);
};

const loadGraphLayout = (key = graphLayoutKey()) => {
  if (!key) return null;
  const store = loadGraphLayoutStore();
  return sanitizeGraphLayout(store.layouts[key]);
};

const saveGraphLayout = (key = state.graphRenderedLayoutKey || graphLayoutKey()) => {
  if (!state.graph || !key || state.isRestoringGraphLayout) return;
  const store = loadGraphLayoutStore();
  store.layouts[key] = {
    positions: nodePositions(),
    pan: state.graph.pan(),
    zoom: state.graph.zoom(),
  };
  store.prefs = {
    graphLayoutMode: state.graphLayoutMode,
    graphCrossChapterMode: state.graphCrossChapterMode,
  };
  saveGraphLayoutStore(store);
};

const scheduleSaveGraphLayout = () => {
  if (state.isRestoringGraphLayout) return;
  window.clearTimeout(state.graphLayoutSaveTimer);
  state.graphLayoutSaveTimer = window.setTimeout(saveGraphLayout, 150);
};

const applySavedGraphLayout = (layout) => {
  if (!state.graph || !layout) return;
  state.isRestoringGraphLayout = true;
  restoreNodePositions(layout.positions);
  if (layout.zoom !== null) state.graph.zoom(layout.zoom);
  if (layout.pan) state.graph.pan(layout.pan);
  state.isRestoringGraphLayout = false;
};

const applySavedPositionsToElements = (elements, layout) => {
  if (!layout) return elements;
  return elements.map((element) => {
    const id = element.data?.id;
    if (!id || !layout.positions[id]) return element;
    return { ...element, position: layout.positions[id] };
  });
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const clampGraphPan = () => {
  if (!state.graph || state.isClampingGraphPan || state.graph.nodes().length === 0) return;
  const container = state.graph.container();
  if (!container) return;

  const bounds = state.graph.nodes().boundingBox();
  const zoom = state.graph.zoom();
  const pan = state.graph.pan();
  const width = container.clientWidth;
  const height = container.clientHeight;

  const minX = width - bounds.x2 * zoom - graphPanPadding;
  const maxX = -bounds.x1 * zoom + graphPanPadding;
  const minY = height - bounds.y2 * zoom - graphPanPadding;
  const maxY = -bounds.y1 * zoom + graphPanPadding;
  const nextPan = {
    x: clamp(pan.x, Math.min(minX, maxX), Math.max(minX, maxX)),
    y: clamp(pan.y, Math.min(minY, maxY), Math.max(minY, maxY)),
  };

  if (nextPan.x === pan.x && nextPan.y === pan.y) return;
  state.isClampingGraphPan = true;
  state.graph.pan(nextPan);
  state.isClampingGraphPan = false;
};

const resizeGraph = () => {
  if (!state.graph) return;
  requestAnimationFrame(() => {
    if (!state.graph) return;
    state.graph.resize();
    clampGraphPan();
  });
};

const savePanelLayout = () => {
  try {
    localStorage.setItem(panelLayoutStorageKey, JSON.stringify(state.panelLayout));
  } catch (error) {
    console.warn("Could not save editor panel layout", error);
  }
};

const loadPanelLayout = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(panelLayoutStorageKey) || "null");
    if (!saved || !["beside", "below"].includes(saved.mode)) return;
    state.panelLayout.mode = saved.mode;
    state.panelLayout.graphSplit = clamp(Number(saved.graphSplit) || 55, 20, 80);
    state.panelLayout.splits.beside = clamp(Number(saved.splits?.beside) || 50, 20, 80);
    state.panelLayout.splits.below = clamp(Number(saved.splits?.below) || 58, 20, 80);
  } catch (error) {
    console.warn("Could not load editor panel layout", error);
  }
};

const graphWorkspaceSplitBounds = (rect) => {
  const isCompact = window.innerWidth <= 1300;
  const minGraph = isCompact ? 288 : 352;
  const minWorkspace = state.panelLayout.mode === "beside" ? 544 : isCompact ? 416 : 480;
  if (rect.width <= minGraph + minWorkspace) return { min: 50, max: 50 };
  return {
    min: (minGraph / rect.width) * 100,
    max: ((rect.width - minWorkspace) / rect.width) * 100,
  };
};

const editorPreviewSplitBounds = (mode, rect) => {
  const size = mode === "beside" ? rect.width : rect.height;
  const minEditor = mode === "beside" ? 256 : 224;
  const minPreview = mode === "beside" ? 224 : 160;
  if (size <= minEditor + minPreview) return { min: 50, max: 50 };
  return {
    min: (minEditor / size) * 100,
    max: ((size - minPreview) / size) * 100,
  };
};

const applyPanelLayout = ({ persist = false } = {}) => {
  const mode = state.panelLayout.mode;
  layoutEl.classList.toggle("preview-beside", mode === "beside");
  layoutEl.classList.toggle("preview-below", mode === "below");
  const graphBounds = graphWorkspaceSplitBounds(layoutEl.getBoundingClientRect());
  const graphSplit = clamp(state.panelLayout.graphSplit, graphBounds.min, graphBounds.max);
  layoutEl.style.setProperty("--graph-workspace-split", `${graphSplit}%`);
  const rect = editorPreviewSplitter.parentElement.getBoundingClientRect();
  const bounds = editorPreviewSplitBounds(mode, rect);
  const split = clamp(state.panelLayout.splits[mode], bounds.min, bounds.max);
  layoutEl.style.setProperty("--editor-preview-split", `${split}%`);
  editorPreviewSplitter.setAttribute("aria-orientation", mode === "beside" ? "vertical" : "horizontal");
  if (persist) savePanelLayout();
  resizeGraph();
};

const resetPanelLayout = () => {
  state.panelLayout = {
    mode: "beside",
    graphSplit: 55,
    splits: {
      beside: 50,
      below: 58,
    },
  };
  applyPanelLayout({ persist: true });
};

const saveEditorSelection = () => {
  if (!state.chapterId) return;
  try {
    localStorage.setItem(editorSelectionStorageKey, JSON.stringify({
      chapterId: state.chapterId,
      sceneId: state.selectedSceneId || "",
    }));
  } catch (error) {
    console.warn("Could not save editor selection", error);
  }
};

const loadEditorSelection = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(editorSelectionStorageKey) || "null");
    if (!saved || typeof saved.chapterId !== "string") return null;
    return {
      chapterId: saved.chapterId,
      sceneId: typeof saved.sceneId === "string" ? saved.sceneId : "",
    };
  } catch (error) {
    console.warn("Could not load editor selection", error);
    return null;
  }
};

const updatePanelSplit = (event) => {
  if (!state.panelResize) return;
  const { kind, mode, rect } = state.panelResize;
  const rawSplit = kind === "graphWorkspace" || mode === "beside"
    ? ((event.clientX - rect.left) / rect.width) * 100
    : ((event.clientY - rect.top) / rect.height) * 100;
  const bounds = kind === "graphWorkspace"
    ? graphWorkspaceSplitBounds(rect)
    : editorPreviewSplitBounds(mode, rect);
  const split = clamp(rawSplit, bounds.min, bounds.max);
  if (kind === "graphWorkspace") {
    state.panelLayout.graphSplit = Math.round(split * 10) / 10;
  } else {
    state.panelLayout.splits[mode] = Math.round(split * 10) / 10;
  }
  applyPanelLayout();
};

const stopPanelResize = () => {
  if (!state.panelResize) return;
  const { splitter, pointerId } = state.panelResize;
  try {
    splitter.releasePointerCapture?.(pointerId);
  } catch (error) {
    console.warn("Could not release panel resize pointer capture", error);
  }
  state.panelResize = null;
  splitter.classList.remove("dragging");
  document.body.classList.remove("panel-resizing", "preview-below-resizing");
  savePanelLayout();
  resizeGraph();
};

const startPanelResize = (kind, event) => {
  if (event.button !== 0) return;
  const splitter = kind === "graphWorkspace" ? graphWorkspaceSplitter : editorPreviewSplitter;
  const resizeTarget = kind === "graphWorkspace" ? layoutEl : editorPreviewSplitter.parentElement;
  const rect = resizeTarget.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  event.preventDefault();
  state.panelResize = {
    kind,
    mode: state.panelLayout.mode,
    pointerId: event.pointerId,
    rect,
    splitter,
  };
  splitter.setPointerCapture?.(event.pointerId);
  splitter.classList.add("dragging");
  document.body.classList.add("panel-resizing");
  document.body.classList.toggle("preview-below-resizing", kind === "editorPreview" && state.panelLayout.mode === "below");
  updatePanelSplit(event);
};

const fitGraphAfterLayout = () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(fitGraph);
  });
};

const fitGraph = () => {
  if (!state.graph) return;
  state.graph.resize();
  state.graph.fit(undefined, 60);
  clampGraphPan();
};

const graphComplexity = () => {
  const scenes = state.chapter?.scenes || [];
  const localSceneIds = new Set(scenes.map((scene) => scene.id));
  const localEdges = scenes.flatMap((scene) =>
    movementTriggers(scene)
      .filter(({ trigger }) => !trigger.chapterId && localSceneIds.has(trigger.target))
      .map(({ trigger }) => ({ source: scene.id, target: trigger.target }))
  );
  const incoming = new Map();
  const outgoing = new Map();
  localEdges.forEach((edge) => {
    outgoing.set(edge.source, (outgoing.get(edge.source) || 0) + 1);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  });
  const branchyNodeCount = scenes.filter(
    (scene) => (incoming.get(scene.id) || 0) > 1 || (outgoing.get(scene.id) || 0) > 1
  ).length;
  const nodeCount = scenes.length;
  const edgeCount = state.chapter?.scenes?.flatMap(movementTriggers).length || 0;
  const localEdgeCount = localEdges.length;
  const chainLike =
    nodeCount >= 5 &&
    localEdgeCount >= nodeCount - 2 &&
    localEdgeCount <= nodeCount + 1 &&
    branchyNodeCount <= Math.max(1, Math.floor(nodeCount * 0.2));
  return {
    nodeCount,
    edgeCount,
    localEdgeCount,
    chainLike,
    density: nodeCount === 0 ? 0 : edgeCount / nodeCount,
  };
};

const graphContainerSize = () => {
  const container = state.graph?.container() || document.getElementById("graph");
  return {
    width: container?.clientWidth || 0,
    height: container?.clientHeight || 0,
  };
};

const resolvedGraphLayoutMode = () => {
  if (state.graphLayoutMode !== "auto") return { type: state.graphLayoutMode };
  const { nodeCount, density, chainLike } = graphComplexity();
  if (nodeCount > 0 && density > 1.25 && !chainLike) return { type: "organic" };

  const { width } = graphContainerSize();
  const estimatedHorizontalWidth = nodeCount * graphNodeWidth + Math.max(0, nodeCount - 1) * graphDirectedRankSep;
  if (chainLike && width > 0 && estimatedHorizontalWidth > width * 1.15) {
    return { type: "directed", rankDir: "TB", compact: true };
  }
  return { type: "directed", rankDir: "LR", compact: chainLike };
};

const ensureGraphLayoutExtensions = () => {
  if (state.graphDagreRegistered || typeof cytoscapeDagre === "undefined") return;
  cytoscape.use(cytoscapeDagre);
  state.graphDagreRegistered = true;
};

const graphLayoutOptions = () => {
  const mode = resolvedGraphLayoutMode();
  return ({
    directed: {
      name: "dagre",
      animate: false,
      directed: true,
      edgeSep: graphDirectedEdgeSep,
      fit: false,
      nodeSep: mode.compact ? 45 : graphDirectedNodeSep,
      padding: graphLayoutPadding,
      rankDir: mode.rankDir || "LR",
      rankSep: mode.compact ? 105 : graphDirectedRankSep,
      spacingFactor: mode.compact ? 1.08 : 1.25,
    },
    organic: {
      name: "cose",
      animate: false,
      componentSpacing: 130,
      edgeElasticity: 80,
      idealEdgeLength: graphOrganicIdealEdgeLength,
      nodeOverlap: graphOrganicNodeOverlap,
      nodeRepulsion: graphOrganicNodeRepulsion,
      padding: graphLayoutPadding,
      spacingFactor: 1.25,
    },
    grid: {
      name: "grid",
      animate: false,
      avoidOverlap: true,
      avoidOverlapPadding: 45,
      padding: graphLayoutPadding,
    },
  }[mode.type]);
};

const localEdgeParts = (edgeId) => {
  const match = /^edge:(.*):(\d+):(\d+)$/.exec(edgeId);
  if (!match) return null;
  return {
    sceneId: match[1],
    actionIndex: Number(match[2]),
    triggerIndex: Number(match[3]),
  };
};

const selectSceneInEditor = (sceneId) => {
  if (!sceneById(sceneId)) return;
  state.selectedSceneId = sceneId;
  state.pendingPreviewMovement = null;
  clearExpandedRows();
  renderEditor();
  renderGraph();
};

const openEdgeTrigger = (edgeId) => {
  const parts = localEdgeParts(edgeId);
  if (!parts) return;
  state.selectedSceneId = parts.sceneId;
  clearExpandedRows();
  expandNewRow(sceneById(parts.sceneId), "action", parts.actionIndex);
  expandNewRow(sceneById(parts.sceneId), "trigger", parts.actionIndex, parts.triggerIndex);
  state.pendingScrollRowKey = rowKey(sceneById(parts.sceneId), "trigger", parts.actionIndex, parts.triggerIndex);
  renderEditor();
  renderGraph();
};

const deleteEdgeTrigger = (edgeId) => {
  const parts = localEdgeParts(edgeId);
  if (!parts) return;
  const scene = sceneById(parts.sceneId);
  const action = scene?.actions?.[parts.actionIndex];
  const trigger = action?.triggers?.[parts.triggerIndex];
  if (!scene || !action || !trigger) return;
  const extra = `\n\nThis removes movement to ${trigger.chapterId ? `${trigger.chapterId}/` : ""}${trigger.target || "missing target"}.`;
  if (!confirmDeletion(`trigger ${parts.triggerIndex + 1} in action ${parts.actionIndex + 1}`, [], extra)) return;
  recordHistory();
  action.triggers.splice(parts.triggerIndex, 1);
  markDirty();
  renderEditor();
  renderGraph();
};

const openEdgeTarget = async (edge) => {
  const parts = localEdgeParts(edge.id());
  if (!parts) return;
  const scene = sceneById(parts.sceneId);
  const trigger = scene?.actions?.[parts.actionIndex]?.triggers?.[parts.triggerIndex];
  if (!trigger) return;
  if (trigger.chapterId && trigger.chapterId !== state.chapterId) {
    if (state.dirty) {
      setStatus(`Save before opening ${trigger.chapterId} / ${trigger.target}.`, "error");
      return;
    }
    await loadChapter(trigger.chapterId, trigger.target);
    chapterSelect.value = trigger.chapterId;
    return;
  }
  selectSceneInEditor(trigger.target);
};

const showNodeContextMenu = (event) => {
  const data = event.target.data();
  const scene = sceneById(event.target.id());
  if (!scene) {
    showContextMenu(event, [
      { label: "Open Target", disabled: !data.navigationKind, onClick: () => openGraphNavigation(data) },
      { label: "Fit Graph", onClick: fitGraph },
      { label: "Relayout Graph", onClick: () => renderGraph({ relayout: true }) },
    ]);
    return;
  }

  showContextMenu(event, [
    { label: "Open Scene", onClick: () => selectSceneInEditor(scene.id) },
    { label: "Copy Scene", onClick: () => copyScene(scene) },
    { label: "Move Scene...", onClick: () => moveScene(scene) },
    { label: "Paste Scene", disabled: !state.sceneClipboard, onClick: pasteScene },
    { label: "Delete Scene", danger: true, onClick: () => deleteScene(scene) },
  ]);
};

const showEdgeContextMenu = (event) => {
  const isLocalMovement = Boolean(localEdgeParts(event.target.id()));
  showContextMenu(event, [
    { label: "Edit Trigger", disabled: !isLocalMovement, onClick: () => openEdgeTrigger(event.target.id()) },
    { label: "Open Target", disabled: !isLocalMovement, onClick: () => openEdgeTarget(event.target) },
    { label: "Delete Trigger", disabled: !isLocalMovement, danger: true, onClick: () => deleteEdgeTrigger(event.target.id()) },
  ]);
};

const showGraphContextMenu = (event) => {
  showContextMenu(event, [
    { label: "Add Scene", disabled: !state.chapter?.scenes, onClick: addScene },
    { label: "Paste Scene", disabled: !state.chapter?.scenes || !state.sceneClipboard, onClick: pasteScene },
    { label: "Fit Graph", onClick: fitGraph },
    { label: "Relayout Graph", onClick: () => renderGraph({ relayout: true }) },
  ]);
};

const sameGraphNavigation = (data) =>
  state.pendingGraphNavigation?.chapterId === data.chapterId &&
  state.pendingGraphNavigation?.sceneId === data.sceneId &&
  state.pendingGraphNavigation?.navigationKind === data.navigationKind;

const openGraphNavigation = async (data) => {
  if (data.navigationKind === "start" && state.chapterId === startChapterId) return;
  if (!sameGraphNavigation(data)) {
    state.pendingGraphNavigation = {
      chapterId: data.chapterId,
      sceneId: data.sceneId,
      navigationKind: data.navigationKind,
    };
    setStatus(`Opens ${data.chapterId} / ${data.sceneId}. Click again.`, "dirty");
    return;
  }
  if (state.dirty) {
    setStatus(`Save before opening ${data.chapterId} / ${data.sceneId}.`, "error");
    return;
  }
  state.pendingGraphNavigation = null;
  if (data.navigationKind === "start") {
    await loadChapter(startChapterId);
    chapterSelect.value = startChapterId;
    return;
  }
  await loadChapter(data.chapterId, data.sceneId);
  chapterSelect.value = data.chapterId;
};

const renderGraph = ({ relayout = false } = {}) => {
  if (!state.chapter || (!state.chapter.scenes && state.chapterId !== startChapterId)) return;

  ensureGraphLayoutExtensions();
  const layoutKey = graphLayoutKey();
  const savedLayout = relayout ? null : loadGraphLayout(layoutKey);
  const elements = applySavedPositionsToElements(graphElements(), savedLayout);
  let ranLayout = false;
  if (!state.graph) {
    ranLayout = !savedLayout;
    state.graph = cytoscape({
      container: document.getElementById("graph"),
      elements,
      minZoom: graphMinZoom,
      maxZoom: graphMaxZoom,
      wheelSensitivity: 0.15,
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
          selector: 'node[enter = "yes"]',
          style: {
            "background-color": "#233242",
            color: "#f2f5f8",
            "border-color": "#66d9ff",
            "border-style": "dashed",
            "border-width": 2,
          },
        },
        {
          selector: 'node[both = "yes"]',
          style: {
            "background-color": "#293447",
            color: "#f2f5f8",
            "border-color": "#d7e86f",
            "border-style": "double",
            "border-width": 4,
          },
        },
        {
          selector: 'node[start = "yes"]',
          style: {
            "background-color": "#173324",
            color: "#f2f5f8",
            "border-color": "#5bf870",
            "border-style": "dashed",
            "border-width": 3,
          },
        },
        {
          selector: 'node[missing = "yes"]',
          style: {
            "background-color": "#3a2026",
            color: "#f2f5f8",
            "border-color": "#ff6b6b",
            "border-style": "dashed",
            "border-width": 2,
          },
        },
        {
          selector: "node:selected",
          style: {
            "background-color": "#1d3b2a",
            "border-color": "#5bf870",
            "border-width": 5,
            "shadow-blur": 18,
            "shadow-color": "#5bf870",
            "shadow-opacity": 0.55,
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
            "font-size": 10,
            "text-background-color": "#141820",
            "text-background-opacity": 0.85,
            "text-background-padding": 5,
            "text-max-width": 120,
            "text-wrap": "wrap",
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
        {
          selector: 'edge[missing = "yes"]',
          style: {
            "line-color": "#ff6b6b",
            "target-arrow-color": "#ff6b6b",
          },
        },
      ],
      layout: savedLayout ? { name: "preset", fit: false } : graphLayoutOptions(),
    });
    state.graphRenderedLayoutKey = layoutKey;

    state.graph.on("tap", "node", (event) => {
      hideContextMenu();
      const data = event.target.data();
      if (data.navigationKind) {
        openGraphNavigation(data);
        return;
      }
      state.pendingGraphNavigation = null;
      state.pendingPreviewMovement = null;
      state.selectedSceneId = event.target.id();
      renderEditor();
    });
    state.graph.on("tap", hideContextMenu);
    state.graph.on("cxttap", "node", (event) => {
      event.originalEvent?.preventDefault();
      showNodeContextMenu(event);
    });
    state.graph.on("cxttap", "edge", (event) => {
      event.originalEvent?.preventDefault();
      showEdgeContextMenu(event);
    });
    state.graph.on("cxttap", (event) => {
      if (event.target !== state.graph) return;
      event.originalEvent?.preventDefault();
      showGraphContextMenu(event);
    });
    state.graph.on("pan zoom", () => {
      clampGraphPan();
      scheduleSaveGraphLayout();
    });
    state.graph.on("dragfree layoutstop", scheduleSaveGraphLayout);
  } else {
    const previousLayoutKey = state.graphRenderedLayoutKey;
    const positions = previousLayoutKey === layoutKey ? nodePositions() : savedLayout?.positions || {};
    const shouldRelayout = relayout || (previousLayoutKey !== layoutKey && !savedLayout);
    state.graph.elements().remove();
    state.graph.add(elements);
    restoreNodePositions(positions);
    state.graphRenderedLayoutKey = layoutKey;
    if (shouldRelayout) {
      ranLayout = true;
      state.graph.layout(graphLayoutOptions()).run();
    }
    else applySavedGraphLayout(savedLayout);
  }

  if (savedLayout) applySavedGraphLayout(savedLayout);
  resizeGraph();
  clampGraphPan();
  if (ranLayout) fitGraphAfterLayout();
  else scheduleSaveGraphLayout();

  if (state.selectedSceneId) {
    const selected = state.graph.getElementById(state.selectedSceneId);
    if (selected.length) selected.select();
  }
};

const sceneSignature = () =>
  state.chapter?.scenes?.map((scene) => scene.id).join("|") || "";

const ensureSelectedScene = () => {
  if (sceneById(state.selectedSceneId)) return;
  state.selectedSceneId = state.chapter?.scenes?.[0]?.id || "";
};

const restoreChapterSnapshot = (snapshot, redoTarget) => {
  if (!snapshot) return;
  const previousSceneSignature = sceneSignature();
  redoTarget.push(chapterSnapshot());
  if (redoTarget.length > historyLimit) redoTarget.shift();
  state.chapter = JSON.parse(snapshot);
  state.pendingPreviewMovement = null;
  ensureSelectedScene();
  clearExpandedRows();
  renderEditor();
  renderGraph({ relayout: previousSceneSignature !== sceneSignature() });
  updateDirtyStatus();
  updateHistoryButtons();
};

const deleteChapterForHistory = async (entry) => {
  const references = (await api(`/api/chapters/${entry.chapterId}/references`)).references || [];
  if (references.length > 0 && state.safeDeletion) {
    alert(`Cannot delete chapter while Safe deletion is enabled.\n\n${referenceDetails(`Chapter ${entry.chapterId}`, references)}`);
    return false;
  }
  if (references.length > 0 && !confirmDeletion(`chapter ${entry.chapterId}`, references)) {
    return false;
  }
  await api(`/api/chapters/${entry.chapterId}`, { method: "DELETE" });
  return true;
};

const restoreDeletedChapter = async (entry) => {
  await api(`/api/chapters/${entry.chapterId}/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chapter: entry.chapter, affectedEntries: entry.affectedEntries || [] }),
  });
};

const restoreEntries = async (entries) => {
  await api("/api/entries/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
};

const applyHistoryOperation = async (entry, targetStack, direction) => {
  if (!entry || typeof entry === "string") {
    restoreChapterSnapshot(entry, targetStack);
    return;
  }

  if (entry.type === "create_chapter") {
    if (direction === "redo") {
      await restoreDeletedChapter(entry);
      await loadChapters();
      chapterSelect.value = entry.chapterId;
      await loadChapter(entry.chapterId);
      targetStack.push(entry);
      setStatus(`Redid create chapter ${entry.chapterId}`, "saved");
      return;
    }

    const ok = await deleteChapterForHistory(entry);
    if (!ok) return false;
    await loadChapters();
    targetStack.push(entry);
    setStatus(`Undid create chapter ${entry.chapterId}`, "saved");
    return;
  }

  if (entry.type === "delete_chapter") {
    if (direction === "redo") {
      const ok = await deleteChapterForHistory(entry);
      if (!ok) return false;
      await loadChapters();
      targetStack.push(entry);
      setStatus(`Redid delete chapter ${entry.chapterId}`, "saved");
      return;
    }

    await restoreDeletedChapter(entry);
    await loadChapters();
    chapterSelect.value = entry.chapterId;
    await loadChapter(entry.chapterId);
    targetStack.push(entry);
    setStatus(`Restored chapter ${entry.chapterId}`, "saved");
    return;
  }

  if (entry.type === "move_scene") {
    await restoreEntries(direction === "undo" ? entry.affectedEntries : entry.updatedEntries);
    await loadChapters();
    const chapterId = direction === "undo" ? entry.fromChapterId : entry.toChapterId;
    const sceneId = direction === "undo" ? entry.sceneId : entry.newSceneId;
    chapterSelect.value = chapterId;
    await loadChapter(chapterId, sceneId);
    targetStack.push(entry);
    setStatus(`${direction === "undo" ? "Undid" : "Redid"} move scene ${entry.sceneId}`, "saved");
  }
};

const undo = async () => {
  const entry = state.undoStack.pop();
  try {
    const ok = await applyHistoryOperation(entry, state.redoStack, "undo");
    if (ok === false && entry) state.undoStack.push(entry);
  } catch (error) {
    if (entry) state.undoStack.push(entry);
    setStatus(error.message, "error");
    alert(error.message);
  }
  updateHistoryButtons();
};

const redo = async () => {
  const entry = state.redoStack.pop();
  try {
    const ok = await applyHistoryOperation(entry, state.undoStack, "redo");
    if (ok === false && entry) state.redoStack.push(entry);
  } catch (error) {
    if (entry) state.redoStack.push(entry);
    setStatus(error.message, "error");
    alert(error.message);
  }
  updateHistoryButtons();
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

const scrollPendingRowIntoView = () => {
  if (!state.pendingScrollRowKey) return;
  requestAnimationFrame(() => {
    const row = editorEl.querySelector(`[data-row-key="${CSS.escape(state.pendingScrollRowKey)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => {
      row.classList.remove("highlight-row");
      if (state.pendingScrollRowKey === row.dataset.rowKey) state.pendingScrollRowKey = "";
    }, 1600);
  });
};

const previewText = (value, fallback = "Untitled") => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
};

const compactText = (value, fallback = "Untitled") => {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return state.editorView.singleLineFullText ? text : previewText(text, fallback);
};

const visibilitySummary = (obj) =>
  visibilityFields
    .filter((visibilityField) => Array.isArray(obj?.[visibilityField]) && obj[visibilityField].length > 0)
    .map((visibilityField) => `${visibilityField}: ${obj[visibilityField].join(", ")}`);

const hideAny = (flags, obj) =>
  flags.some((flag) => obj.hideAny.includes(flag));

const hideAll = (flags, obj) =>
  obj.hideAll.every((flag) => flags.includes(flag));

const showAny = (flags, obj) =>
  flags.some((flag) => obj.showAny.includes(flag));

const showAll = (flags, obj) =>
  obj.showAll.every((flag) => flags.includes(flag));

const previewIsVisible = (flags, obj) => {
  if (typeof obj === "string") return true;
  if (obj.hideAny !== undefined && hideAny(flags, obj)) return false;
  if (obj.hideAll !== undefined && hideAll(flags, obj)) return false;
  if (obj.showAny !== undefined) return showAny(flags, obj);
  if (obj.showAll !== undefined) return showAll(flags, obj);
  return true;
};

const previewHasShowFlags = (obj) =>
  obj && typeof obj === "object" && (obj.showAny !== undefined || obj.showAll !== undefined);

const activeShowFlagIndex = (flags, obj) => {
  if (obj.showAny !== undefined) {
    const index = flags.findIndex((flag) => obj.showAny.includes(flag));
    return index === -1 ? flags.length : index;
  }
  if (obj.showAll !== undefined) {
    const lastFlag = [...flags].reverse().find((flag) => obj.showAll.includes(flag));
    const index = flags.findIndex((flag) => flag === lastFlag);
    return index === -1 ? flags.length : index;
  }
  return flags.length;
};

const sortPreviewParagraphs = (flags, a, b) => {
  if (
    typeof a === "object" &&
    typeof b === "object" &&
    !a.ignoreSortByFlag &&
    !b.ignoreSortByFlag &&
    previewHasShowFlags(a) &&
    previewHasShowFlags(b)
  ) {
    return activeShowFlagIndex(flags, a) - activeShowFlagIndex(flags, b);
  }
  return 0;
};

const addVisibilityFlags = (flagSet, obj) => {
  visibilityFields.forEach((fieldName) => {
    if (Array.isArray(obj?.[fieldName])) {
      obj[fieldName].forEach((flag) => flagSet.add(flag));
    }
  });
};

const collectSceneFlags = (scene) => {
  const flags = new Set();
  scene?.paragraphs?.forEach((paragraph) => {
    if (typeof paragraph === "object" && paragraph !== null) addVisibilityFlags(flags, paragraph);
  });
  scene?.actions?.forEach((action) => {
    addVisibilityFlags(flags, action);
    (action.triggers || []).forEach((trigger) => {
      if (["add_flag", "remove_flag"].includes(trigger.type) && trigger.target) {
        flags.add(trigger.target);
      }
      if (trigger.type === "remove_all_flags_except") {
        splitFlags(trigger.target || "").forEach((flag) => flags.add(flag));
      }
    });
  });
  return [...flags].sort((a, b) => a.localeCompare(b));
};

const syncPreviewFlags = (scene) => {
  const availableFlags = collectSceneFlags(scene);
  return [...new Set([...availableFlags, ...state.previewFlags])].sort((a, b) =>
    a.localeCompare(b)
  );
};

const togglePreviewFlag = (flag) => {
  state.pendingPreviewMovement = null;
  if (state.previewFlags.includes(flag)) {
    state.previewFlags = state.previewFlags.filter((item) => item !== flag);
  } else {
    state.previewFlags = [...state.previewFlags, flag];
  }
  renderPreview();
};

const movementTriggersForAction = (action) =>
  (action.triggers || []).filter((trigger) => trigger.type === "movement" && trigger.target);

const samePendingMovement = (actionIndex, movement) =>
  state.pendingPreviewMovement?.actionIndex === actionIndex &&
  state.pendingPreviewMovement?.target === movement.target &&
  state.pendingPreviewMovement?.chapterId === movement.chapterId;

const previewMovementNotice = (movement) => {
  if (!movement) return "";
  if (movement.chapterId && movement.chapterId !== state.chapterId) {
    return state.dirty
      ? `Save before opening chapter "${movement.chapterId}".`
      : `Opens chapter "${movement.chapterId}". Click again.`;
  }
  return `Opens scene "${movement.target}". Click again.`;
};

const openPreviewMovement = async (movement) => {
  if (movement.chapterId && movement.chapterId !== state.chapterId) {
    if (state.dirty) return;
    await loadChapter(movement.chapterId, movement.target);
    chapterSelect.value = movement.chapterId;
    return;
  }
  if (!sceneById(movement.target)) return;
  state.selectedSceneId = movement.target;
  state.pendingPreviewMovement = null;
  clearExpandedRows();
  renderEditor();
  renderGraph();
};

const applyPreviewFlagTriggers = (action) => {
  action.triggers?.forEach((trigger) => {
    if (trigger.type === "add_flag" && trigger.target) {
      if (!state.previewFlags.includes(trigger.target)) {
        state.previewFlags = [...state.previewFlags, trigger.target];
      }
    } else if (trigger.type === "remove_flag" && trigger.target) {
      state.previewFlags = state.previewFlags.filter((flag) => flag !== trigger.target);
    } else if (trigger.type === "remove_all_flags") {
      state.previewFlags = [];
    } else if (trigger.type === "remove_all_flags_except") {
      const keptFlags = splitFlags(trigger.target || "");
      if (keptFlags.length === 0) return;
      state.previewFlags = state.previewFlags.filter((flag) => keptFlags.includes(flag));
    }
  });
};

const applyPreviewAction = async (action, actionIndex) => {
  const movements = movementTriggersForAction(action);
  const movement = movements[0];

  if (!movement) {
    applyPreviewFlagTriggers(action);
    state.pendingPreviewMovement = null;
    renderPreview();
    return;
  }

  if (movement.chapterId && movement.chapterId !== state.chapterId) {
    if (samePendingMovement(actionIndex, movement) && !state.dirty) {
      applyPreviewFlagTriggers(action);
      await openPreviewMovement(movement);
      return;
    }
    state.pendingPreviewMovement = { actionIndex, target: movement.target, chapterId: movement.chapterId };
    renderPreview();
    return;
  }

  if (samePendingMovement(actionIndex, movement)) {
    applyPreviewFlagTriggers(action);
    await openPreviewMovement(movement);
    return;
  }

  state.pendingPreviewMovement = { actionIndex, target: movement.target, chapterId: movement.chapterId };
  renderPreview();
};

const movementSummaries = (action) =>
  movementTriggersForAction(action)
    .map((trigger) =>
      trigger.chapterId
        ? `moves to chapter "${trigger.chapterId}", scene "${trigger.target}"`
        : `moves to scene "${trigger.target}"`
    );

const renderPreview = () => {
  previewEl.innerHTML = "";
  const scene = sceneById(state.selectedSceneId);
  if (!scene) {
    previewEl.innerHTML = '<div class="empty-state">Select a scene node to preview it.</div>';
    return;
  }

  const availableFlags = syncPreviewFlags(scene);
  const header = document.createElement("div");
  header.className = "section-header";
  const title = document.createElement("h2");
  title.textContent = "Preview";
  header.append(
    title,
    button("Clear flags", () => {
      state.previewFlags = [];
      renderPreview();
    }, "small"),
    button("All flags", () => {
      state.previewFlags = [...availableFlags];
      renderPreview();
    }, "small")
  );
  previewEl.appendChild(header);

  const flagsSection = document.createElement("div");
  flagsSection.className = "preview-flags";
  if (availableFlags.length === 0) {
    const emptyFlags = document.createElement("div");
    emptyFlags.className = "preview-muted";
    emptyFlags.textContent = "No scene flags found.";
    flagsSection.appendChild(emptyFlags);
  } else {
    availableFlags.forEach((flag) => {
      const flagButton = button(flag, () => togglePreviewFlag(flag), "flag-chip");
      if (state.previewFlags.includes(flag)) flagButton.classList.add("active");
      flagsSection.appendChild(flagButton);
    });
  }
  previewEl.appendChild(flagsSection);

  if (state.pendingPreviewMovement) {
    const notice = document.createElement("div");
    notice.className = "preview-notice";
    notice.textContent = previewMovementNotice(state.pendingPreviewMovement);
    previewEl.appendChild(notice);
  }

  const terminal = document.createElement("div");
  terminal.className = "preview-terminal";
  const sceneTitle = document.createElement("h3");
  sceneTitle.textContent = scene.name || "Untitled";
  terminal.appendChild(sceneTitle);
  terminal.appendChild(document.createElement("hr"));

  const paragraphs = document.createElement("div");
  paragraphs.className = "preview-paragraphs";
  [...(scene.paragraphs || [])]
    .filter((paragraph) => previewIsVisible(state.previewFlags, paragraph))
    .sort((a, b) => sortPreviewParagraphs(state.previewFlags, a, b))
    .map((paragraph) => (typeof paragraph === "string" ? paragraph : paragraph.text))
    .forEach((paragraph) => {
      if (paragraph === "---") {
        paragraphs.appendChild(document.createElement("hr"));
        return;
      }
      const paragraphEl = document.createElement("div");
      paragraphEl.className = "preview-paragraph";
      paragraphEl.textContent = paragraph;
      paragraphs.appendChild(paragraphEl);
    });
  terminal.appendChild(paragraphs);
  terminal.appendChild(document.createElement("hr"));

  if ((scene.actions || []).length > 0) {
    const actionTitle = document.createElement("div");
    actionTitle.className = "preview-actions-title";
    actionTitle.textContent = "Actions:";
    terminal.appendChild(actionTitle);
    const actions = document.createElement("div");
    actions.className = "preview-actions";
    scene.actions
      .filter((action) => previewIsVisible(state.previewFlags, action))
      .forEach((action, actionIndex) => {
        const movementTriggers = movementTriggersForAction(action);
        const movements = movementSummaries(action);
        const actionEl = button("", () => applyPreviewAction(action, actionIndex), "preview-action");
        if (movements.length > 0) actionEl.classList.add("has-movement");
        if (movementTriggers.some((movement) => samePendingMovement(actionIndex, movement))) {
          actionEl.classList.add("pending-movement");
        }

        const text = document.createElement("span");
        text.textContent = `> ${action.text}`;
        actionEl.appendChild(text);

        if (movements.length > 0) {
          const movement = document.createElement("span");
          movement.className = "preview-movement";
          movement.textContent = ` (${movements.join("; ")})`;
          actionEl.appendChild(movement);
        }
        actions.appendChild(actionEl);
      });
    terminal.appendChild(actions);
  }
  previewEl.appendChild(terminal);
};

const triggerSummary = (trigger) => {
  if (trigger.type === "remove_all_flags") return "remove_all_flags";
  if (trigger.type === "remove_all_flags_except") {
    return `remove_all_flags_except -> ${trigger.target || "missing target"}`;
  }
  const target = trigger.target || "missing target";
  if (trigger.type === "movement" && trigger.chapterId) {
    return `movement -> ${trigger.chapterId}:${target}`;
  }
  return `${trigger.type || "movement"} -> ${target}`;
};

const shortTriggerSummary = (trigger) => {
  const target = trigger.target || "missing target";
  if (trigger.type === "add_flag") return `add: ${target}`;
  if (trigger.type === "remove_flag") return `remove: ${target}`;
  if (trigger.type === "remove_all_flags") return "remove all";
  if (trigger.type === "remove_all_flags_except") return `remove all except: ${target}`;
  if (trigger.type === "movement" && trigger.chapterId) {
    return `move: chapter ${trigger.chapterId} scene ${target}`;
  }
  return `move: scene ${target}`;
};

const actionTriggerSummaries = (action) => {
  const triggers = action.triggers || [];
  return triggers.length > 0 ? triggers.map(shortTriggerSummary) : ["no triggers"];
};

const compactRow = (title, details, onClick, onContextMenu) => {
  const row = document.createElement("button");
  row.type = "button";
  row.className = state.editorView.singleLineFullText
    ? "compact-row full-text"
    : "compact-row";
  row.addEventListener("click", onClick);
  if (onContextMenu) {
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      onContextMenu(event);
    });
  }

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

const cardHeader = (title, onCollapse, onContextMenu) => {
  const header = document.createElement("div");
  header.className = onCollapse ? "card-header collapsible" : "card-header";
  if (onCollapse) {
    header.title = "Click to collapse";
    header.addEventListener("click", onCollapse);
  }
  if (onContextMenu) {
    header.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      onContextMenu(event);
    });
  }

  const titleEl = document.createElement("span");
  titleEl.className = "card-header-title";
  titleEl.textContent = title;
  const hint = document.createElement("span");
  hint.className = "card-header-hint";
  hint.textContent = onCollapse ? "Click to collapse" : "";
  header.append(titleEl, hint);
  return header;
};

const collapseSceneGroups = (scene) => {
  state.editorView.singleLine = true;
  delete state.editorView.collapsedGroups[groupKey(scene, "paragraphs")];
  delete state.editorView.collapsedGroups[groupKey(scene, "actions")];
  scene.actions.forEach((_action, index) => {
    delete state.editorView.collapsedGroups[groupKey(scene, `action:${index}:triggers`)];
  });
  clearExpandedRows();
  renderEditor();
};

const expandSceneGroups = (scene) => {
  state.editorView.singleLine = true;
  delete state.editorView.collapsedGroups[groupKey(scene, "paragraphs")];
  delete state.editorView.collapsedGroups[groupKey(scene, "actions")];
  clearExpandedRows();
  scene.paragraphs.forEach((_paragraph, index) => {
    expandNewRow(scene, "paragraph", index);
  });
  scene.actions.forEach((action, index) => {
    delete state.editorView.collapsedGroups[groupKey(scene, `action:${index}:triggers`)];
    expandNewRow(scene, "action", index);
    (action.triggers || []).forEach((_trigger, triggerIndex) => {
      expandNewRow(scene, "trigger", index, triggerIndex);
    });
  });
  renderEditor();
};

const field = (labelText, value, onInput, options = {}) => {
  const wrapper = document.createElement("div");
  const label = document.createElement("label");
  const input = document.createElement(options.multiline ? "textarea" : "input");
  let editSnapshot = "";
  let hasRecordedEdit = false;
  label.textContent = labelText;
  input.value = value || "";
  if (options.list) input.setAttribute("list", options.list);
  input.addEventListener("focus", () => {
    editSnapshot = chapterSnapshot();
    hasRecordedEdit = false;
    options.onFocus?.(input);
  });
  input.addEventListener("input", () => {
    if (options.history !== false && !hasRecordedEdit) {
      pushHistorySnapshot(editSnapshot || chapterSnapshot());
      state.redoStack = [];
      hasRecordedEdit = true;
      updateHistoryButtons();
    }
    onInput(input.value);
    options.onInput?.(input);
  });
  input.addEventListener("blur", () => {
    editSnapshot = "";
    hasRecordedEdit = false;
  });
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

const hideContextMenu = () => {
  state.contextMenu?.remove();
  state.contextMenu = null;
  document.querySelectorAll(".toolbar-menu-bar button.open").forEach((button) => {
    button.classList.remove("open");
  });
};

const showContextMenu = (event, items) => {
  hideContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  items.forEach((item) => {
    if (item.separator) {
      const separator = document.createElement("div");
      separator.className = "context-menu-separator";
      menu.appendChild(separator);
      return;
    }
    const menuButton = button(item.label, async () => {
      hideContextMenu();
      await item.onClick?.();
    }, [item.danger ? "danger" : "", item.active ? "active" : ""].filter(Boolean).join(" "));
    if (item.active) menuButton.textContent = `✓ ${item.label}`;
    menuButton.disabled = Boolean(item.disabled);
    menu.appendChild(menuButton);
  });
  document.body.appendChild(menu);
  const sourceEvent = event.originalEvent || event;
  const x = sourceEvent.clientX || 0;
  const y = sourceEvent.clientY || 0;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - bounds.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - bounds.height - 8)}px`;
  state.contextMenu = menu;
};

const showToolbarMenu = (anchor, items) => {
  const bounds = anchor.getBoundingClientRect();
  showContextMenu({ clientX: bounds.left, clientY: bounds.bottom + 4 }, items);
  anchor.classList.add("open");
};

const duplicateArrayItem = (array, index) => {
  recordHistory();
  const item = typeof array[index] === "object" && array[index] !== null
    ? deepClone(array[index])
    : array[index];
  array.splice(index + 1, 0, item);
};

const duplicateParagraph = (scene, index) => {
  duplicateArrayItem(scene.paragraphs, index);
  expandNewRow(scene, "paragraph", index + 1);
  markDirty();
  renderEditor();
};

const duplicateAction = (scene, index) => {
  duplicateArrayItem(scene.actions, index);
  expandNewRow(scene, "action", index + 1);
  markDirty();
  renderEditor();
  renderGraph();
};

const isMovementTrigger = (trigger) => (trigger?.type || "movement") === "movement";

const hasMovementTrigger = (action, ignoredIndex) =>
  (action.triggers || []).some((trigger, index) => index !== ignoredIndex && isMovementTrigger(trigger));

const duplicateTrigger = (scene, action, actionIndex, index) => {
  action.triggers = action.triggers || [];
  if (isMovementTrigger(action.triggers[index]) && hasMovementTrigger(action, index)) {
    alert("This action already has a movement trigger. Only the first movement trigger is used by the game.");
    return;
  }
  if (isMovementTrigger(action.triggers[index])) {
    alert("Movement triggers cannot be duplicated within the same action. Only one movement trigger is allowed per action.");
    return;
  }
  duplicateArrayItem(action.triggers, index);
  expandNewRow(scene, "trigger", actionIndex, index + 1);
  markDirty();
  renderEditor();
  renderGraph();
};

const removeParagraph = (scene, paragraph, index) => {
  const paragraphObject = typeof paragraph === "object" && paragraph !== null ? paragraph : { text: paragraph };
  const visibility = visibilitySummary(paragraphObject);
  const extra = visibility.length > 0
    ? `\n\nThis paragraph has visibility rules: ${visibility.join("; ")}.`
    : "";
  if (!confirmDeletion(`paragraph ${index + 1} in ${scene.id}`, [], extra)) return;
  recordHistory();
  scene.paragraphs.splice(index, 1);
  markDirty();
  renderEditor();
};

const removeTrigger = (action, actionIndex, trigger, index) => {
  const referencedFlags = trigger.type === "remove_all_flags_except"
    ? splitFlags(trigger.target || "")
    : ["add_flag", "remove_flag"].includes(trigger.type)
      ? [trigger.target]
      : [];
  const references = referencedFlags.length > 0 ? flagReferences(referencedFlags, trigger) : [];
  const extra = trigger.type === "movement"
    ? `\n\nThis removes movement to ${trigger.chapterId ? `${trigger.chapterId}/` : ""}${trigger.target || "missing target"}.`
    : "";
  if (!confirmDeletion(`trigger ${index + 1} in action ${actionIndex + 1}`, references, extra)) return;
  recordHistory();
  action.triggers.splice(index, 1);
  markDirty();
  renderEditor();
  renderGraph();
};

const removeAction = (scene, action, index) => {
  const references = flagReferences(flagsChangedByTriggers(action.triggers), action);
  const triggerDetails = (action.triggers || []).map(shortTriggerSummary).join("; ");
  const extra = triggerDetails ? `\n\nThis action contains: ${triggerDetails}.` : "";
  if (!confirmDeletion(`action ${index + 1} in ${scene.id}`, references, extra)) return;
  recordHistory();
  scene.actions.splice(index, 1);
  markDirty();
  renderEditor();
  renderGraph();
};

const addTrigger = (scene, action, actionIndex) => {
  recordHistory();
  action.triggers = action.triggers || [];
  const type = hasMovementTrigger(action) ? "add_flag" : "movement";
  action.triggers.push({ type, target: "" });
  if (type !== "movement") setStatus("Added flag trigger because this action already has a movement trigger", "saved");
  expandNewRow(scene, "trigger", actionIndex, action.triggers.length - 1);
  markDirty();
  renderEditor();
  renderGraph();
};

const editorItemContextMenu = (event, items) => {
  showContextMenu(event, items.filter(Boolean));
};

const copyScene = (scene) => {
  state.sceneClipboard = {
    chapterId: state.chapterId,
    sceneId: scene.id,
    scene: deepClone(scene),
  };
  setStatus(`Copied scene ${scene.id}`, "saved");
};

const uniquePastedSceneId = (baseId) => {
  if (!sceneById(baseId)) return baseId;
  let index = 2;
  let sceneId = `${baseId}_copy`;
  while (sceneById(sceneId)) {
    sceneId = `${baseId}_copy_${index}`;
    index += 1;
  }
  return sceneId;
};

const uniqueSceneIdInChapterMeta = (chapter, baseId) => {
  const sceneIds = new Set((chapter?.scenes || []).map((scene) => scene.id));
  if (!sceneIds.has(baseId)) return baseId;
  let index = 2;
  let sceneId = `${baseId}_copy`;
  while (sceneIds.has(sceneId)) {
    sceneId = `${baseId}_copy_${index}`;
    index += 1;
  }
  return sceneId;
};

const adjustPastedSceneReferences = (scene, sourceChapterId, originalSceneId) => {
  if (!sourceChapterId || sourceChapterId === state.chapterId) return;
  (scene.actions || []).forEach((action) => {
    (action.triggers || []).forEach((trigger) => {
      if (trigger.type !== "movement" || !trigger.target || trigger.chapterId) return;
      if (trigger.target === originalSceneId) {
        trigger.target = scene.id;
        return;
      }
      if (!sceneById(trigger.target)) trigger.chapterId = sourceChapterId;
    });
  });
};

const pasteScene = () => {
  if (!state.chapter?.scenes || !state.sceneClipboard) return;
  const scene = deepClone(state.sceneClipboard.scene);
  const originalSceneId = scene.id;
  const nextId = uniquePastedSceneId(scene.id);
  if (nextId !== scene.id) {
    const customId = prompt("Scene id already exists. New scene id", nextId);
    if (!customId) return;
    scene.id = customId.trim();
  }
  if (sceneById(scene.id)) {
    alert(`Scene id already exists: ${scene.id}`);
    return;
  }
  adjustPastedSceneReferences(scene, state.sceneClipboard.chapterId, originalSceneId);
  recordHistory();
  state.chapter.scenes.push(scene);
  state.selectedSceneId = scene.id;
  markDirty();
  renderEditor();
  renderGraph({ relayout: true });
};

const addScene = () => {
  if (!state.chapter?.scenes) return;
  recordHistory();
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
};

const deleteScene = async (scene) => {
  try {
    const result = await api(`/api/chapters/${state.chapterId}/scenes/${scene.id}/references`);
    const references = result.references || [];
    if (!confirmDeletion(`scene ${state.chapterId}/${scene.id}`, references)) return;
    recordHistory();
    state.chapter.scenes.forEach((item) => {
      (item.actions || []).forEach((action) => {
        action.triggers = (action.triggers || []).filter(
          (trigger) =>
            !(trigger.type === "movement" && trigger.chapterId === undefined && trigger.target === scene.id)
        );
      });
    });
    state.chapter.scenes = state.chapter.scenes.filter((item) => item !== scene);
    state.selectedSceneId = state.chapter.scenes[0]?.id || "";
    markDirty();
    renderEditor();
    renderGraph({ relayout: true });
  } catch (error) {
    setStatus(error.message, "error");
    alert(error.message);
  }
};

const moveScene = async (scene) => {
  if (state.dirty && !confirm("Discard unsaved changes before moving this scene?")) return;
  const chapterChoices = state.chapters
    .filter((chapter) => chapter.hasScenes && chapter.id !== state.chapterId)
    .map((chapter) => chapter.id)
    .join(", ");
  const toChapterId = prompt(`Move scene to chapter id${chapterChoices ? ` (${chapterChoices})` : ""}`, "");
  if (!toChapterId) return;
  const targetChapter = chapterMetaById(toChapterId.trim());
  if (!targetChapter?.hasScenes) {
    alert(`Chapter not found: ${toChapterId.trim()}`);
    return;
  }

  let newSceneId = scene.id;
  if ((targetChapter.scenes || []).some((item) => item.id === newSceneId)) {
    newSceneId = uniqueSceneIdInChapterMeta(targetChapter, scene.id);
    const customId = prompt("Destination scene id", newSceneId);
    if (!customId) return;
    newSceneId = customId.trim();
  }
  if (!newSceneId) return;

  try {
    const result = await api("/api/scenes/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromChapterId: state.chapterId,
        sceneId: scene.id,
        toChapterId: toChapterId.trim(),
        newSceneId,
      }),
    });
    state.undoStack.push({
      type: "move_scene",
      fromChapterId: result.fromChapterId,
      toChapterId: result.toChapterId,
      sceneId: result.sceneId,
      newSceneId: result.newSceneId,
      affectedEntries: result.affectedEntries || [],
      updatedEntries: result.updatedEntries || [],
    });
    state.redoStack = [];
    await loadChapters();
    chapterSelect.value = result.toChapterId;
    await loadChapter(result.toChapterId, result.newSceneId);
    updateHistoryButtons();
    setStatus(`Moved scene ${scene.id} to ${result.toChapterId}/${result.newSceneId}`, "saved");
  } catch (error) {
    setStatus(error.message, "error");
    alert(error.message);
  }
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
  recordHistory();
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
      `${index + 1}. ${compactText(paragraphObject.text, "Empty paragraph")}`,
      [isObject ? "object" : "string", ...visibilitySummary(paragraphObject)],
      () => setRowExpanded(scene, "paragraph", index, undefined, true),
      (event) => editorItemContextMenu(event, [
        { label: "Expand", onClick: () => setRowExpanded(scene, "paragraph", index, undefined, true) },
        { label: "Duplicate", onClick: () => duplicateParagraph(scene, index) },
        { label: "Move Up", onClick: () => moveArrayItem(scene.paragraphs, index, -1), disabled: index === 0 },
        { label: "Move Down", onClick: () => moveArrayItem(scene.paragraphs, index, 1), disabled: index === scene.paragraphs.length - 1 },
        { label: "Remove", onClick: () => removeParagraph(scene, paragraph, index), danger: true },
      ])
    );
  }

  const card = document.createElement("div");
  card.className = "card";
  card.appendChild(cardHeader(
    `Paragraph ${index + 1}`,
    state.editorView.singleLine ? () => setRowExpanded(scene, "paragraph", index, undefined, false) : null,
    (event) => editorItemContextMenu(event, [
      state.editorView.singleLine && { label: "Collapse", onClick: () => setRowExpanded(scene, "paragraph", index, undefined, false) },
      { label: "Duplicate", onClick: () => duplicateParagraph(scene, index) },
      { label: "Move Up", onClick: () => moveArrayItem(scene.paragraphs, index, -1), disabled: index === 0 },
      { label: "Move Down", onClick: () => moveArrayItem(scene.paragraphs, index, 1), disabled: index === scene.paragraphs.length - 1 },
      { label: "Remove", onClick: () => removeParagraph(scene, paragraph, index), danger: true },
    ])
  ));

  const typeSelect = document.createElement("select");
  typeSelect.innerHTML = '<option value="string">String</option><option value="object">Object</option>';
  typeSelect.value = isObject ? "object" : "string";
  typeSelect.addEventListener("change", () => {
    recordHistory();
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
      recordHistory();
      if (checkbox.checked) paragraph.ignoreSortByFlag = true;
      else delete paragraph.ignoreSortByFlag;
      markDirty();
    });
    checkboxRow.append(checkbox, "Ignore sort by flag");
    card.appendChild(checkboxRow);
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    button("Duplicate", () => duplicateParagraph(scene, index)),
    button("Up", () => moveArrayItem(scene.paragraphs, index, -1)),
    button("Down", () => moveArrayItem(scene.paragraphs, index, 1)),
    button("Remove", () => removeParagraph(scene, paragraph, index), "danger")
  );
  card.appendChild(actions);
  return card;
};

const renderTrigger = (scene, action, actionIndex, trigger, index) => {
  const triggerRowKey = rowKey(scene, "trigger", actionIndex, index);
  if (state.editorView.singleLine && !isRowExpanded(scene, "trigger", actionIndex, index)) {
    const row = compactRow(
      `${index + 1}. ${triggerSummary(trigger)}`,
      [],
      () => setRowExpanded(scene, "trigger", actionIndex, index, true),
      (event) => editorItemContextMenu(event, [
        { label: "Expand", onClick: () => setRowExpanded(scene, "trigger", actionIndex, index, true) },
        !isMovementTrigger(trigger) && { label: "Duplicate", onClick: () => duplicateTrigger(scene, action, actionIndex, index) },
        { label: "Move Up", onClick: () => moveArrayItem(action.triggers, index, -1), disabled: index === 0 },
        { label: "Move Down", onClick: () => moveArrayItem(action.triggers, index, 1), disabled: index === (action.triggers || []).length - 1 },
        { label: "Remove", onClick: () => removeTrigger(action, actionIndex, trigger, index), danger: true },
      ])
    );
    row.dataset.rowKey = triggerRowKey;
    if (state.pendingScrollRowKey === triggerRowKey) row.classList.add("highlight-row");
    return row;
  }

  const card = document.createElement("div");
  card.className = "card";
  card.dataset.rowKey = triggerRowKey;
  if (state.pendingScrollRowKey === triggerRowKey) card.classList.add("highlight-row");
  card.appendChild(cardHeader(
    `Trigger ${index + 1}: ${triggerSummary(trigger)}`,
    state.editorView.singleLine ? () => setRowExpanded(scene, "trigger", actionIndex, index, false) : null,
    (event) => editorItemContextMenu(event, [
      state.editorView.singleLine && { label: "Collapse", onClick: () => setRowExpanded(scene, "trigger", actionIndex, index, false) },
      !isMovementTrigger(trigger) && { label: "Duplicate", onClick: () => duplicateTrigger(scene, action, actionIndex, index) },
      { label: "Move Up", onClick: () => moveArrayItem(action.triggers, index, -1), disabled: index === 0 },
      { label: "Move Down", onClick: () => moveArrayItem(action.triggers, index, 1), disabled: index === (action.triggers || []).length - 1 },
      { label: "Remove", onClick: () => removeTrigger(action, actionIndex, trigger, index), danger: true },
    ])
  ));
  const typeSelect = document.createElement("select");
  const movementUnavailable = !isMovementTrigger(trigger) && hasMovementTrigger(action, index);
  ["movement", "add_flag", "remove_flag", "remove_all_flags", "remove_all_flags_except"].forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = type === "movement" && movementUnavailable
      ? "movement (already exists)"
      : type;
    option.disabled = type === "movement" && movementUnavailable;
    typeSelect.appendChild(option);
  });
  typeSelect.value = trigger.type || "movement";
  typeSelect.addEventListener("change", () => {
    if (typeSelect.value === "movement" && hasMovementTrigger(action, index)) {
      alert("This action already has a movement trigger. Only one movement trigger is allowed per action.");
      typeSelect.value = trigger.type || "movement";
      return;
    }
    recordHistory();
    trigger.type = typeSelect.value;
    if (trigger.type === "remove_all_flags") {
      delete trigger.target;
      delete trigger.chapterId;
    } else if (trigger.type !== "movement") {
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
    const selectMovementTarget = (input, sceneId) => {
      recordHistory();
      input.value = sceneId;
      trigger.target = sceneId;
      hideAutocompleteMenu();
      markDirty();
      renderGraph();
    };
    card.appendChild(
      field(trigger.type === "remove_all_flags_except" ? "Flags to keep" : "Target", trigger.target, (value) => {
        trigger.target = value;
        markDirty();
        renderGraph();
      }, trigger.type === "movement" ? {
        onFocus: (input) => {
          showAutocompleteMenu(input, sceneAutocompleteItems(trigger.chapterId?.trim()), "", (sceneId) => selectMovementTarget(input, sceneId), "No matching scenes");
        },
        onInput: (input) => {
          showAutocompleteMenu(input, sceneAutocompleteItems(trigger.chapterId?.trim()), input.value, (sceneId) => selectMovementTarget(input, sceneId), "No matching scenes");
        },
      } : {})
    );
  }

  if (trigger.type === "movement") {
    const selectMovementChapter = (input, chapterId) => {
      recordHistory();
      input.value = chapterId;
      trigger.chapterId = chapterId;
      hideAutocompleteMenu();
      markDirty();
      renderGraph();
    };
    card.appendChild(
      field("chapterId", trigger.chapterId, (value) => {
        if (value.trim()) trigger.chapterId = value.trim();
        else delete trigger.chapterId;
        markDirty();
        hideAutocompleteMenu();
        renderGraph();
      }, {
        onFocus: (input) => {
          showAutocompleteMenu(input, chapterAutocompleteItems(), "", (chapterId) => selectMovementChapter(input, chapterId), "No matching chapters");
        },
        onInput: (input) => {
          showAutocompleteMenu(input, chapterAutocompleteItems(), input.value, (chapterId) => selectMovementChapter(input, chapterId), "No matching chapters");
        },
      })
    );
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (!isMovementTrigger(trigger)) {
    actions.appendChild(button("Duplicate", () => duplicateTrigger(scene, action, actionIndex, index)));
  }
  actions.append(
    button("Up", () => moveArrayItem(action.triggers, index, -1)),
    button("Down", () => moveArrayItem(action.triggers, index, 1)),
    button("Remove", () => removeTrigger(action, actionIndex, trigger, index), "danger")
  );
  card.appendChild(actions);
  return card;
};

const renderAction = (scene, action, index) => {
  if (state.editorView.singleLine && !isRowExpanded(scene, "action", index)) {
    return compactRow(
      `${index + 1}. ${compactText(action.text, "Empty action")}`,
      [...actionTriggerSummaries(action), ...visibilitySummary(action)],
      () => setRowExpanded(scene, "action", index, undefined, true),
      (event) => editorItemContextMenu(event, [
        { label: "Expand", onClick: () => setRowExpanded(scene, "action", index, undefined, true) },
        { label: "Duplicate", onClick: () => duplicateAction(scene, index) },
        { label: "Add Trigger", onClick: () => addTrigger(scene, action, index) },
        { label: "Move Up", onClick: () => moveArrayItem(scene.actions, index, -1), disabled: index === 0 },
        { label: "Move Down", onClick: () => moveArrayItem(scene.actions, index, 1), disabled: index === scene.actions.length - 1 },
        { label: "Remove", onClick: () => removeAction(scene, action, index), danger: true },
      ])
    );
  }

  const card = document.createElement("div");
  card.className = "card";
  card.appendChild(cardHeader(
    `Action ${index + 1}`,
    state.editorView.singleLine ? () => setRowExpanded(scene, "action", index, undefined, false) : null,
    (event) => editorItemContextMenu(event, [
      state.editorView.singleLine && { label: "Collapse", onClick: () => setRowExpanded(scene, "action", index, undefined, false) },
      { label: "Duplicate", onClick: () => duplicateAction(scene, index) },
      { label: "Add Trigger", onClick: () => addTrigger(scene, action, index) },
      { label: "Move Up", onClick: () => moveArrayItem(scene.actions, index, -1), disabled: index === 0 },
      { label: "Move Down", onClick: () => moveArrayItem(scene.actions, index, 1), disabled: index === scene.actions.length - 1 },
      { label: "Remove", onClick: () => removeAction(scene, action, index), danger: true },
    ])
  ));
  card.appendChild(
    field("Action text", action.text, (value) => {
      action.text = value;
      markDirty();
      renderGraph();
    })
  );
  renderVisibilityFields(card, action);

  const triggerHeader = document.createElement("div");
  triggerHeader.className = "section-header nested-section-header";
  const triggerTitle = document.createElement("h3");
  triggerTitle.textContent = "Triggers";
  triggerHeader.append(
    triggerTitle,
    button("Add Trigger", () => addTrigger(scene, action, index))
  );
  card.appendChild(triggerHeader);

  if (isGroupCollapsed(scene, `action:${index}:triggers`)) {
    const summary = document.createElement("div");
    summary.className = "collapsed-summary";
    summary.textContent = `${(action.triggers || []).length} triggers hidden. Click to show.`;
    summary.addEventListener("click", () => setGroupCollapsed(scene, `action:${index}:triggers`, false));
    card.appendChild(summary);
  } else {
    (action.triggers || []).forEach((trigger, triggerIndex) => {
      card.appendChild(renderTrigger(scene, action, index, trigger, triggerIndex));
    });
  }

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    button("Duplicate", () => duplicateAction(scene, index)),
    button("Up", () => moveArrayItem(scene.actions, index, -1)),
    button("Down", () => moveArrayItem(scene.actions, index, 1)),
    button("Remove", () => removeAction(scene, action, index), "danger")
  );
  card.appendChild(actions);
  return card;
};

const renderChapterSettings = () => {
  const section = document.createElement("section");
  section.className = "section";

  const header = document.createElement("div");
  header.className = "section-header";
  const title = document.createElement("h2");
  title.textContent = "Chapter";
  header.appendChild(title);
  section.appendChild(header);

  const fields = document.createElement("div");
  fields.className = "field-row";
  fields.appendChild(
    field("Chapter name", state.chapter.name, (value) => {
      state.chapter.name = value;
      markDirty();
    })
  );

  const idWrapper = document.createElement("div");
  const idLabel = document.createElement("label");
  const idInput = document.createElement("input");
  idLabel.textContent = "Chapter id / filename";
  idInput.value = state.chapterId;
  idWrapper.append(idLabel, idInput);
  fields.appendChild(idWrapper);
  section.appendChild(fields);

  const help = document.createElement("div");
  help.className = "chapter-settings-help";
  help.textContent = "Chapter ids become JSON filenames and may only use letters, numbers, underscores, and hyphens.";
  section.appendChild(help);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.appendChild(button("Apply Chapter Settings", () => renameCurrentChapter(idInput.value)));
  section.appendChild(actions);

  editorEl.appendChild(section);
};

const renderStartEditor = () => {
  renderSceneIdDatalist();
  renderStartSceneIdDatalist();
  editorEl.innerHTML = "";
  previewEl.innerHTML = '<div class="empty-state">Start config has no scene preview.</div>';
  saveEditorSelection();

  const header = document.createElement("div");
  header.className = "section-header";
  const title = document.createElement("h2");
  title.textContent = "Start Config";
  header.appendChild(title);
  editorEl.appendChild(header);

  const fields = document.createElement("div");
  fields.className = "field-row";
  const selectStartChapter = (input, chapterId) => {
    recordHistory();
    input.value = chapterId;
    state.chapter.chapterId = chapterId;
    hideAutocompleteMenu();
    markDirty();
    renderStartSceneIdDatalist();
    renderGraph({ relayout: true });
  };
  const selectStartScene = (input, sceneId) => {
    recordHistory();
    input.value = sceneId;
    state.chapter.sceneId = sceneId;
    hideAutocompleteMenu();
    markDirty();
    renderGraph({ relayout: true });
  };
  fields.append(
    field("Starting chapter", state.chapter.chapterId, (value) => {
      state.chapter.chapterId = value.trim();
      markDirty();
      renderStartSceneIdDatalist();
      renderGraph({ relayout: true });
    }, {
      onFocus: (input) => {
        showAutocompleteMenu(input, chapterAutocompleteItems(), "", (chapterId) => selectStartChapter(input, chapterId), "No matching chapters");
      },
      onInput: (input) => {
        showAutocompleteMenu(input, chapterAutocompleteItems(), input.value, (chapterId) => selectStartChapter(input, chapterId), "No matching chapters");
      },
    }),
    field("Starting scene", state.chapter.sceneId, (value) => {
      state.chapter.sceneId = value.trim();
      markDirty();
      renderGraph({ relayout: true });
    }, {
      onFocus: (input) => {
        showAutocompleteMenu(input, sceneAutocompleteItems(state.chapter.chapterId), "", (sceneId) => selectStartScene(input, sceneId), "No matching scenes");
      },
      onInput: (input) => {
        showAutocompleteMenu(input, sceneAutocompleteItems(state.chapter.chapterId), input.value, (sceneId) => selectStartScene(input, sceneId), "No matching scenes");
      },
    })
  );
  editorEl.appendChild(fields);

  const flagsSection = document.createElement("section");
  flagsSection.className = "section";
  flagsSection.appendChild(
    field("Starting flags", formatFlags(state.chapter.flags), (value) => {
      const flags = splitFlags(value);
      state.chapter.flags = flags;
      markDirty();
    })
  );
  editorEl.appendChild(flagsSection);
};

const renderEditor = () => {
  renderSceneIdDatalist();
  editorEl.innerHTML = "";
  if (isStartConfig()) {
    renderStartEditor();
    return;
  }
  if (state.chapter?.scenes) renderChapterSettings();
  const scene = sceneById(state.selectedSceneId);
  if (!scene) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    emptyState.textContent = "Select a scene node to edit it.";
    editorEl.appendChild(emptyState);
    renderPreview();
    return;
  }
  saveEditorSelection();

  const title = document.createElement("div");
  title.className = "section-header";
  const h2 = document.createElement("h2");
  h2.textContent = `Editing: ${scene.name || "Untitled"} / ${scene.id}`;
  title.appendChild(h2);
  editorEl.appendChild(title);

  const fields = document.createElement("div");
  fields.className = "field-row";
  fields.append(
    field("Scene id", scene.id, (value) => {
      const previousId = scene.id;
      scene.id = value.trim();
      state.selectedSceneId = scene.id;
      saveEditorSelection();
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
    button("Add Paragraph", () => {
      recordHistory();
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
    summary.textContent = `${scene.paragraphs.length} paragraphs hidden. Click to show.`;
    summary.addEventListener("click", () => setGroupCollapsed(scene, "paragraphs", false));
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
    button("Add Action", () => {
      recordHistory();
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
    summary.textContent = `${scene.actions.length} actions hidden. Click to show.`;
    summary.addEventListener("click", () => setGroupCollapsed(scene, "actions", false));
    actions.appendChild(summary);
  } else {
    scene.actions.forEach((action, index) => {
      actions.appendChild(renderAction(scene, action, index));
    });
  }
  editorEl.appendChild(actions);
  renderPreview();
  scrollPendingRowIntoView();
};

const loadChapter = async (chapterId, selectedSceneId) => {
  saveGraphLayout();
  state.chapterId = chapterId;
  state.chapter = null;
  state.selectedSceneId = "";
  state.dirty = false;
  state.pendingGraphNavigation = null;
  state.chapterReferences = { references: [] };
  setStatus("Loading chapter...");
  const chapter = await api(`/api/chapters/${chapterId}`);
  state.chapter = chapter;
  if (chapter.scenes) {
    state.chapterReferences = await api(`/api/chapters/${chapterId}/references`);
  }
  state.selectedSceneId = chapter.scenes?.some((scene) => scene.id === selectedSceneId)
    ? selectedSceneId
    : chapter.scenes?.[0]?.id || "";
  state.pendingPreviewMovement = null;
  state.savedSnapshot = chapterSnapshot();
  state.undoStack = [];
  state.redoStack = [];
  state.editorView.collapsedGroups = {};
  clearExpandedRows();
  updateDirtyStatus();
  if (selectedSceneId && state.selectedSceneId !== selectedSceneId) {
    setStatus(`Target scene ${selectedSceneId} not found`, "error");
  }
  renderEditor();
  if (chapter.scenes || chapterId === startChapterId) {
    renderGraph();
  } else if (state.graph) {
    state.graph.elements().remove();
    state.graphRenderedLayoutKey = "";
  }
};

const loadChapters = async ({ loadInitial = true } = {}) => {
  state.chapters = await api("/api/chapters");
  const chapters = state.chapters.filter((chapter) => chapter.hasScenes || chapter.isStart);
  chapterSelect.innerHTML = "";
  chapters.forEach((chapter) => {
    const option = document.createElement("option");
    option.value = chapter.id;
    option.textContent = chapterOptionText(chapter);
    chapterSelect.appendChild(option);
  });
  renderChapterIdDatalist();

  if (!loadInitial) return;

  if (chapters.length > 0) {
    const savedSelection = loadEditorSelection();
    const initialChapter = chapters.find((chapter) => chapter.id === savedSelection?.chapterId) || chapters[0];
    chapterSelect.value = initialChapter.id;
    await loadChapter(initialChapter.id, savedSelection?.sceneId);
  } else {
    setStatus("No chapters found", "error");
  }
};

chapterSelect.addEventListener("change", async () => {
  if (state.dirty && !confirm("Discard unsaved changes?")) {
    chapterSelect.value = state.chapterId;
    return;
  }
  await loadChapter(chapterSelect.value);
});

graphWorkspaceSplitter.addEventListener("pointerdown", (event) => startPanelResize("graphWorkspace", event));
graphWorkspaceSplitter.addEventListener("pointermove", updatePanelSplit);
graphWorkspaceSplitter.addEventListener("pointerup", stopPanelResize);
graphWorkspaceSplitter.addEventListener("pointercancel", stopPanelResize);

editorPreviewSplitter.addEventListener("pointerdown", (event) => startPanelResize("editorPreview", event));
editorPreviewSplitter.addEventListener("pointermove", updatePanelSplit);
editorPreviewSplitter.addEventListener("pointerup", stopPanelResize);
editorPreviewSplitter.addEventListener("pointercancel", stopPanelResize);

undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);

const renderValidationResults = (items) => {
  validationPanel.innerHTML = "";
  validationPanel.hidden = false;
  const heading = document.createElement("div");
  heading.className = "validation-heading";
  const errorCount = items.filter((item) => item.level === "error").length;
  const warningCount = items.filter((item) => item.level === "warning").length;
  const infoCount = items.filter((item) => item.level === "info").length;
  heading.textContent = `Verification: ${errorCount} errors, ${warningCount} warnings, ${infoCount} info`;
  validationPanel.appendChild(heading);

  if (items.length === 0) {
    const item = document.createElement("div");
    item.className = "validation-item";
    item.textContent = "No issues found.";
    validationPanel.appendChild(item);
    return;
  }

  items.forEach((result) => {
    const item = document.createElement("div");
    item.className = `validation-item ${result.level}`;
    const location = [result.chapterId, result.sceneId].filter(Boolean).join(" / ");
    item.textContent = location ? `${result.level}: ${location}: ${result.message}` : `${result.level}: ${result.message}`;
    validationPanel.appendChild(item);
  });
  resizeGraph();
};

const verifyGame = async () => {
  try {
    setStatus("Verifying...");
    const result = await api("/api/validation");
    renderValidationResults(result.items || []);
    setStatus("Verification complete", "saved");
  } catch (error) {
    setStatus(error.message, "error");
  }
};

const addChapter = async () => {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  const chapterId = prompt("New chapter id");
  if (!chapterId) return;
  try {
    await api("/api/chapters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterId: chapterId.trim() }),
    });
    await loadChapters();
    chapterSelect.value = chapterId.trim();
    await loadChapter(chapterId.trim());
    state.undoStack.push({
      type: "create_chapter",
      chapterId: chapterId.trim(),
      chapter: JSON.parse(chapterSnapshot()),
      affectedEntries: [],
    });
    state.redoStack = [];
    updateHistoryButtons();
  } catch (error) {
    setStatus(error.message, "error");
    alert(error.message);
  }
};

const deleteCurrentChapter = async () => {
  if (!state.chapterId || state.chapterId === startChapterId) {
    alert("The start config cannot be deleted.");
    return;
  }
  if (state.dirty && !confirm("Discard unsaved changes before deleting this chapter?")) return;
  try {
    const result = await api(`/api/chapters/${state.chapterId}/references`);
    const references = result.references || [];
    if (!confirmDeletion(`chapter ${state.chapterId}`, references, "\n\nMovement triggers pointing to this chapter will be removed automatically; start config will be repointed if needed.")) return;
    const chapterId = state.chapterId;
    const deleteResult = await api(`/api/chapters/${chapterId}`, { method: "DELETE" });
    await loadChapters();
    state.undoStack.push({
      type: "delete_chapter",
      chapterId,
      chapter: deleteResult.deletedChapter,
      affectedEntries: deleteResult.affectedEntries || [],
    });
    state.redoStack = [];
    updateHistoryButtons();
  } catch (error) {
    setStatus(error.message, "error");
    alert(error.message);
  }
};

const saveChapter = async () => {
  if (!state.chapter || !state.chapterId) return false;
  try {
    setStatus("Saving...");
    await api(`/api/chapters/${state.chapterId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.chapter),
    });
    state.savedSnapshot = chapterSnapshot();
    updateDirtyStatus();
    await loadChapters({ loadInitial: false });
    chapterSelect.value = state.chapterId;
    return true;
  } catch (error) {
    setStatus(error.message, "error");
    alert(error.message);
    return false;
  }
};

const renameCurrentChapter = async (newChapterId) => {
  if (!state.chapter || !state.chapterId || state.chapterId === startChapterId) return;
  const chapterId = String(newChapterId || "").trim();
  if (!chapterId) {
    alert("Chapter id is required.");
    return;
  }

  if (chapterId === state.chapterId) {
    await saveChapter();
    return;
  }

  if (!confirm(`Renaming the chapter id will also rename ${state.chapterId}.json to ${chapterId}.json and update references. Continue?`)) {
    return;
  }

  if (state.dirty) {
    if (!confirm("Save current chapter changes before renaming the file?")) return;
    const saved = await saveChapter();
    if (!saved) return;
  }

  const selectedSceneId = state.selectedSceneId;
  try {
    setStatus("Renaming chapter...");
    const result = await api(`/api/chapters/${state.chapterId}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chapterId,
        name: state.chapter.name || "",
      }),
    });
    await loadChapters({ loadInitial: false });
    chapterSelect.value = result.chapterId;
    await loadChapter(result.chapterId, selectedSceneId);
    setStatus(`Renamed chapter to ${result.chapterId}`, "saved");
  } catch (error) {
    setStatus(error.message, "error");
    alert(error.message);
  }
};

const deployGame = async () => {
  if (state.deploying) return;
  if (state.dirty && !confirm("You have unsaved changes. Deploy the saved files on disk anyway?")) return;
  if (!confirm("Deploy the game to the website now?")) return;

  state.deploying = true;
  try {
    setStatus("Deploying...");
    const result = await api("/api/deploy", { method: "POST" });
    setStatus("Deploy complete", "saved");
    if (result.output) console.log(result.output);
  } catch (error) {
    setStatus(error.message, "error");
    alert(error.message);
  } finally {
    state.deploying = false;
  }
};

const setGraphLayout = (mode) => {
  state.graphLayoutMode = mode;
  saveGraphPreferences();
  renderGraph({ relayout: true });
};

const setCrossChapterMode = (mode) => {
  saveGraphLayout();
  state.graphCrossChapterMode = mode;
  saveGraphPreferences();
  renderGraph();
};

const setPreviewLayout = (mode) => {
  state.panelLayout.mode = mode;
  applyPanelLayout({ persist: true });
};

const currentScene = () => sceneById(state.selectedSceneId);

const toggleSingleLineCards = () => {
  state.editorView.singleLine = !state.editorView.singleLine;
  clearExpandedRows();
  renderEditor();
};

const toggleFullTextRows = () => {
  state.editorView.singleLineFullText = !state.editorView.singleLineFullText;
  renderEditor();
};

const menuSceneAction = (action) => {
  const scene = currentScene();
  if (!scene) return;
  action(scene);
};

const graphLayoutItems = () => ["auto", "directed", "organic", "grid"].map((mode) => ({
  label: `Graph: ${mode[0].toUpperCase()}${mode.slice(1)}`,
  active: state.graphLayoutMode === mode,
  onClick: () => setGraphLayout(mode),
}));

const crossChapterModeItems = () => [
  {
    label: "Cross-Chapter: Scene Links",
    active: state.graphCrossChapterMode === "scene",
    onClick: () => setCrossChapterMode("scene"),
  },
  {
    label: "Cross-Chapter: Grouped Chapters",
    active: state.graphCrossChapterMode === "grouped",
    onClick: () => setCrossChapterMode("grouped"),
  },
];

const toolbarMenus = [
  {
    button: fileMenuButton,
    items: () => [
      { label: "Save", onClick: saveChapter, disabled: !state.chapter || !state.chapterId },
      { label: "Deploy", onClick: deployGame, disabled: state.deploying },
    ],
  },
  {
    button: editMenuButton,
    items: () => [
      { label: "Undo", onClick: undo, disabled: state.undoStack.length === 0 },
      { label: "Redo", onClick: redo, disabled: state.redoStack.length === 0 },
    ],
  },
  {
    button: chapterMenuButton,
    items: () => [
      { label: "Add Chapter", onClick: addChapter },
      { label: "Delete Chapter", onClick: deleteCurrentChapter, disabled: !state.chapterId || state.chapterId === startChapterId, danger: true },
      { separator: true },
      {
        label: `${state.safeDeletion ? "Disable" : "Enable"} Safe Deletion`,
        active: state.safeDeletion,
        onClick: () => {
          state.safeDeletion = !state.safeDeletion;
        },
      },
    ],
  },
  {
    button: sceneMenuButton,
    items: () => [
      { label: "Add Scene", onClick: addScene, disabled: !state.chapter?.scenes },
      { label: "Delete Scene", onClick: () => menuSceneAction(deleteScene), disabled: !currentScene(), danger: true },
      { separator: true },
      { label: "Collapse All Cards", onClick: () => menuSceneAction(collapseSceneGroups), disabled: !currentScene() },
      { label: "Expand All Cards", onClick: () => menuSceneAction(expandSceneGroups), disabled: !currentScene() },
    ],
  },
  {
    button: viewMenuButton,
    items: () => [
      { label: "Compact Cards", onClick: toggleSingleLineCards, active: state.editorView.singleLine },
      { label: "Wrap Compact Card Text", onClick: toggleFullTextRows, disabled: !state.editorView.singleLine, active: state.editorView.singleLine && state.editorView.singleLineFullText },
    ],
  },
  {
    button: layoutMenuButton,
    items: () => [
      ...graphLayoutItems(),
      { separator: true },
      ...crossChapterModeItems(),
      { separator: true },
      { label: "Preview: Beside Editor", active: state.panelLayout.mode === "beside", onClick: () => setPreviewLayout("beside") },
      { label: "Preview: Below Editor", active: state.panelLayout.mode === "below", onClick: () => setPreviewLayout("below") },
      { separator: true },
      { label: "Fit Graph", onClick: fitGraph, disabled: !state.chapter?.scenes && state.chapterId !== startChapterId },
      { label: "Reset Panel Layout", onClick: resetPanelLayout },
    ],
  },
  {
    button: toolsMenuButton,
    items: () => [
      { label: "Verify", onClick: verifyGame },
    ],
  },
];

toolbarMenus.forEach(({ button: menuButton, items }) => {
  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showToolbarMenu(menuButton, items());
  });
});

saveButton.addEventListener("click", saveChapter);

loadGraphPreferences();
loadPanelLayout();
applyPanelLayout();

loadChapters().catch((error) => {
  setStatus(error.message, "error");
});

window.addEventListener("resize", resizeGraph);
window.addEventListener("mousedown", (event) => {
  if (!state.autocompleteMenu) return;
  if (event.target === state.autocompleteInput || state.autocompleteMenu.contains(event.target)) return;
  hideAutocompleteMenu();
});
window.addEventListener("beforeunload", (event) => {
  saveGraphLayout();
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});
window.addEventListener("click", hideContextMenu);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideContextMenu();
    hideAutocompleteMenu();
  }
});
