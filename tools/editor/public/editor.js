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
const graphDirectedNodeSep = 90;
const graphDirectedRankSep = 190;
const graphDirectedEdgeSep = 50;
const graphNodeWidth = 150;
const graphOrganicNodeRepulsion = 14000;
const graphOrganicIdealEdgeLength = 230;
const graphOrganicNodeOverlap = 30;
const startChapterId = "-start-";

const state = {
  chapterId: "",
  chapter: null,
  chapters: [],
  selectedSceneId: "",
  dirty: false,
  graph: null,
  graphDagreRegistered: false,
  graphLayoutMode: "auto",
  isClampingGraphPan: false,
  savedSnapshot: "",
  undoStack: [],
  redoStack: [],
  previewFlags: [],
  pendingPreviewMovement: null,
  pendingGraphNavigation: null,
  chapterReferences: { references: [] },
  safeDeletion: true,
  editorView: {
    singleLine: false,
    singleLineFullText: false,
    collapsedGroups: {},
    expandedRows: {},
  },
};

const chapterSelect = document.getElementById("chapterSelect");
const addChapterButton = document.getElementById("addChapterButton");
const deleteChapterButton = document.getElementById("deleteChapterButton");
const safeDeletionCheckbox = document.getElementById("safeDeletionCheckbox");
const addSceneButton = document.getElementById("addSceneButton");
const graphLayoutSelect = document.getElementById("graphLayoutSelect");
const fitGraphButton = document.getElementById("fitGraphButton");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const verifyButton = document.getElementById("verifyButton");
const saveButton = document.getElementById("saveButton");
const statusEl = document.getElementById("status");
const validationPanel = document.getElementById("validationPanel");
const editorEl = document.getElementById("editor");
const previewEl = document.getElementById("preview");
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
      });
    });
  });
  return references;
};

const flagsChangedByTriggers = (triggers = []) =>
  triggers
    .filter((trigger) => ["add_flag", "remove_flag"].includes(trigger.type) && trigger.target)
    .map((trigger) => trigger.target);

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

const updateExternalNodeLabel = (node) => {
  if (node.start === "yes") {
    node.label = "Start";
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

  const inboundEdges = (state.chapterReferences.references || [])
    .filter(
      (reference) =>
        reference.toChapterId === state.chapterId &&
        localSceneIds.has(reference.toSceneId) &&
        reference.fromChapterId !== state.chapterId
    )
    .map((reference, index) => {
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
    return { type: "directed", rankDir: "TB" };
  }
  return { type: "directed", rankDir: "LR" };
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
      nodeSep: graphDirectedNodeSep,
      padding: graphLayoutPadding,
      rankDir: mode.rankDir || "LR",
      rankSep: graphDirectedRankSep,
      spacingFactor: 1.35,
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
  const elements = graphElements();
  if (!state.graph) {
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
      layout: graphLayoutOptions(),
    });

    state.graph.on("tap", "node", (event) => {
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
    state.graph.on("pan zoom", clampGraphPan);
  } else {
    const positions = nodePositions();
    state.graph.elements().remove();
    state.graph.add(elements);
    restoreNodePositions(positions);
    if (relayout) state.graph.layout(graphLayoutOptions()).run();
  }

  resizeGraph();
  clampGraphPan();
  if (relayout) fitGraphAfterLayout();

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
  if (trigger.type === "movement" && trigger.chapterId) {
    return `move: chapter ${trigger.chapterId} scene ${target}`;
  }
  return `move: scene ${target}`;
};

const actionTriggerSummaries = (action) => {
  const triggers = action.triggers || [];
  return triggers.length > 0 ? triggers.map(shortTriggerSummary) : ["no triggers"];
};

const compactRow = (title, details, onClick) => {
  const row = document.createElement("button");
  row.type = "button";
  row.className = state.editorView.singleLineFullText
    ? "compact-row full-text"
    : "compact-row";
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
  let editSnapshot = "";
  let hasRecordedEdit = false;
  label.textContent = labelText;
  input.value = value || "";
  if (options.list) input.setAttribute("list", options.list);
  input.addEventListener("focus", () => {
    editSnapshot = chapterSnapshot();
    hasRecordedEdit = false;
  });
  input.addEventListener("input", () => {
    if (options.history !== false && !hasRecordedEdit) {
      pushHistorySnapshot(editSnapshot || chapterSnapshot());
      state.redoStack = [];
      hasRecordedEdit = true;
      updateHistoryButtons();
    }
    onInput(input.value);
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
      () => setRowExpanded(scene, "paragraph", index, undefined, true)
    );
  }

  const card = document.createElement("div");
  card.className = "card";

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
  if (state.editorView.singleLine) {
    actions.appendChild(button("Collapse", () => setRowExpanded(scene, "paragraph", index, undefined, false)));
  }
  actions.append(
    button("Up", () => moveArrayItem(scene.paragraphs, index, -1)),
    button("Down", () => moveArrayItem(scene.paragraphs, index, 1)),
    button("Remove", () => {
      const visibility = visibilitySummary(paragraphObject);
      const extra = visibility.length > 0
        ? `\n\nThis paragraph has visibility rules: ${visibility.join("; ")}.`
        : "";
      if (!confirmDeletion(`paragraph ${index + 1} in ${scene.id}`, [], extra)) return;
      recordHistory();
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
    recordHistory();
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
      const references = ["add_flag", "remove_flag"].includes(trigger.type)
        ? flagReferences([trigger.target], trigger)
        : [];
      const extra = trigger.type === "movement"
        ? `\n\nThis removes movement to ${trigger.chapterId ? `${trigger.chapterId}/` : ""}${trigger.target || "missing target"}.`
        : "";
      if (!confirmDeletion(`trigger ${index + 1} in action ${actionIndex + 1}`, references, extra)) return;
      recordHistory();
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
      `${index + 1}. ${compactText(action.text, "Empty action")}`,
      [...actionTriggerSummaries(action), ...visibilitySummary(action)],
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
      recordHistory();
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
      const references = flagReferences(flagsChangedByTriggers(action.triggers), action);
      const triggerDetails = (action.triggers || []).map(shortTriggerSummary).join("; ");
      const extra = triggerDetails ? `\n\nThis action contains: ${triggerDetails}.` : "";
      if (!confirmDeletion(`action ${index + 1} in ${scene.id}`, references, extra)) return;
      recordHistory();
      scene.actions.splice(index, 1);
      markDirty();
      renderEditor();
      renderGraph();
    }, "danger")
  );
  card.appendChild(actions);
  return card;
};

const renderStartEditor = () => {
  renderSceneIdDatalist();
  renderStartSceneIdDatalist();
  editorEl.innerHTML = "";
  previewEl.innerHTML = '<div class="empty-state">Start config has no scene preview.</div>';

  const header = document.createElement("div");
  header.className = "section-header";
  const title = document.createElement("h2");
  title.textContent = "Start Config";
  header.appendChild(title);
  editorEl.appendChild(header);

  const fields = document.createElement("div");
  fields.className = "field-row";
  fields.append(
    field("Starting chapter", state.chapter.chapterId, (value) => {
      state.chapter.chapterId = value.trim();
      markDirty();
      renderStartSceneIdDatalist();
      renderGraph({ relayout: true });
    }, { list: "chapterIds" }),
    field("Starting scene", state.chapter.sceneId, (value) => {
      state.chapter.sceneId = value.trim();
      markDirty();
      renderGraph({ relayout: true });
    }, { list: "startSceneIds" })
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
  const scene = sceneById(state.selectedSceneId);
  if (!scene) {
    editorEl.innerHTML = '<div class="empty-state">Select a scene node to edit it.</div>';
    renderPreview();
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
    }, state.editorView.singleLine ? "small active" : "small")
  );
  if (state.editorView.singleLine) {
    title.appendChild(
      button(state.editorView.singleLineFullText ? "Short text" : "Wrap full text", () => {
        state.editorView.singleLineFullText = !state.editorView.singleLineFullText;
        renderEditor();
      }, state.editorView.singleLineFullText ? "small active" : "small")
    );
  }
  title.append(
    button("Collapse all", () => collapseSceneGroups(scene), "small"),
    button("Expand all", () => expandSceneGroups(scene), "small"),
    button("Delete Scene", async () => {
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
    summary.textContent = `${scene.actions.length} actions hidden`;
    actions.appendChild(summary);
  } else {
    scene.actions.forEach((action, index) => {
      actions.appendChild(renderAction(scene, action, index));
    });
  }
  editorEl.appendChild(actions);
  renderPreview();
};

const loadChapter = async (chapterId, selectedSceneId) => {
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
  addSceneButton.disabled = !chapter.scenes;
  fitGraphButton.disabled = !chapter.scenes && chapterId !== startChapterId;
  deleteChapterButton.disabled = chapterId === startChapterId;
  clearExpandedRows();
  updateDirtyStatus();
  if (selectedSceneId && state.selectedSceneId !== selectedSceneId) {
    setStatus(`Target scene ${selectedSceneId} not found`, "error");
  }
  renderEditor();
  if (chapter.scenes || chapterId === startChapterId) {
    renderGraph({ relayout: true });
  } else if (state.graph) {
    state.graph.elements().remove();
  }
};

const loadChapters = async () => {
  state.chapters = await api("/api/chapters");
  const chapters = state.chapters.filter((chapter) => chapter.hasScenes || chapter.isStart);
  chapterSelect.innerHTML = "";
  chapters.forEach((chapter) => {
    const option = document.createElement("option");
    option.value = chapter.id;
    option.textContent = chapter.isStart ? `${chapter.id} (start)` : `${chapter.id} (${chapter.sceneCount})`;
    chapterSelect.appendChild(option);
  });
  renderChapterIdDatalist();

  if (chapters.length > 0) {
    await loadChapter(chapters[0].id);
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

graphLayoutSelect.addEventListener("change", () => {
  state.graphLayoutMode = graphLayoutSelect.value;
  renderGraph({ relayout: true });
});

safeDeletionCheckbox.addEventListener("change", () => {
  state.safeDeletion = safeDeletionCheckbox.checked;
});

fitGraphButton.addEventListener("click", fitGraph);
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

verifyButton.addEventListener("click", async () => {
  try {
    setStatus("Verifying...");
    const result = await api("/api/validation");
    renderValidationResults(result.items || []);
    setStatus("Verification complete", "saved");
  } catch (error) {
    setStatus(error.message, "error");
  }
});

addChapterButton.addEventListener("click", async () => {
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
});

deleteChapterButton.addEventListener("click", async () => {
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
});

addSceneButton.addEventListener("click", () => {
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
    state.savedSnapshot = chapterSnapshot();
    updateDirtyStatus();
  } catch (error) {
    setStatus(error.message, "error");
    alert(error.message);
  }
});

loadChapters().catch((error) => {
  setStatus(error.message, "error");
});

window.addEventListener("resize", resizeGraph);
