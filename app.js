const canvas = document.getElementById("plannerCanvas");
const ctx = canvas.getContext("2d");

const machineSelect = document.getElementById("machineSelect");
const recipeSearch = document.getElementById("recipeSearch");
const addMachineBtn = document.getElementById("addMachineBtn");
const machineCountInput = document.getElementById("machineCountInput");
const plannerViewBtn = document.getElementById("plannerViewBtn");
const summaryViewBtn = document.getElementById("summaryViewBtn");
const selectedInfo = document.getElementById("selectedInfo");
const importFactoryFile = document.getElementById("importFactoryFile");
const importFactoryBtn = document.getElementById("importFactoryBtn");
const summaryViewEl = document.getElementById("summaryView");
const summaryCardsEl = document.getElementById("summaryCards");
const summaryTableBody = document.querySelector("#summaryTable tbody");
const summaryPreviewCanvas = document.getElementById("summaryPreviewCanvas");
const summaryPreviewCtx = summaryPreviewCanvas
  ? summaryPreviewCanvas.getContext("2d")
  : null;
const exportSummaryPdfBtn = document.getElementById("exportSummaryPdfBtn");
const manualFoundationDrawBtn = document.getElementById("manualFoundationDrawBtn");
const rotateFoundationBtn = document.getElementById("rotateFoundationBtn");
const clearManualFoundationsBtn = document.getElementById("clearManualFoundationsBtn");
const foundationAngleValue = document.getElementById("foundationAngleValue");

const FOUNDATION_SIZE = 8;
const SNAP_SIZE = 0.5;
const MACHINE_ROTATION_STEP = 5;
const FOUNDATION_ROTATION_STEP = 5;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 20;

const WORLD_MAP_PATH = "assets/beige-map.jpg";

const worldMap = {
  image: new Image(),
  loaded: false,
  visible: true,
  opacity: 0.75,

  // First real-scale pass.
  x: -3986,
  y: -3400,
  width: 7972,
  height: 6800
};

worldMap.image.onload = () => {
  worldMap.loaded = true;
  console.log("World map loaded:", {
    src: WORLD_MAP_PATH,
    naturalWidth: worldMap.image.naturalWidth,
    naturalHeight: worldMap.image.naturalHeight
  });
  draw();
};

worldMap.image.onerror = () => {
  console.warn(`Could not load world map image: ${WORLD_MAP_PATH}`);
};

worldMap.image.src = WORLD_MAP_PATH;



let machineCatalog = {};

const GAME_DATA_PATH = "data/game_data.json";
const FOUNDATION_TEXTURE_PATH = "assets/foundation_tile.png";

const foundationTexture = new Image();
foundationTexture.src = FOUNDATION_TEXTURE_PATH;
foundationTexture.onload = () => draw();
foundationTexture.onerror = () => {
  console.warn(`Could not load foundation texture: ${FOUNDATION_TEXTURE_PATH}`);
};
let gameData = null;

const MACHINE_FOOTPRINTS = {
  "Constructor": { width: 8, length: 6 },
  "Smelter": { width: 9, length: 6 },
  "Foundry": { width: 10, length: 9 },
  "Assembler": { width: 15, length: 10 },
  "Manufacturer": { width: 18, length: 10 },
  "Refinery": { width: 20, length: 10 },
  "Packager": { width: 8, length: 8 },
  "Blender": { width: 18, length: 16 },
  "Particle Accelerator": { width: 30, length: 30 },
  "Fuel-Powered Generator": { width: 18, length: 16 },
  "Coal-Powered Generator": { width: 18, length: 16 },
  "Water Extractor": { width: 20, length: 14 },
  "Miner": { width: 8, length: 8 },
  "Oil Extractor": { width: 10, length: 10 },
  "Resource Well Extractor": { width: 8, length: 8 },
  "Quantum Encoder": { width: 24, length: 20 },
  "Converter": { width: 16, length: 16 },
  "Space Elevator": { width: 40, length: 40 },
  "Nuclear Power Plant": { width: 36, length: 43 },
};
function logPlannerEvent(eventName, params = {}) {
  console.log("Planner event:", eventName, params);

  if (typeof gtag === "function") {
    gtag("event", eventName, {
      app_name: "satisfactory_floor_planner_v2",
      ...params
    });
  }
}

function logPlannerError(error, context = {}) {
  const message = error?.message || String(error);
  const stack = error?.stack || "";

  console.error("Planner error report:", {
    message,
    stack,
    context
  });

  logPlannerEvent("planner_error", {
    error_message: message.slice(0, 500),
    error_stack: stack.slice(0, 1000),
    error_context: JSON.stringify(context).slice(0, 1000)
  });
}

window.addEventListener("error", event => {
  logPlannerError(event.error || event.message, {
    source: "window_error",
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  });
});

window.addEventListener("unhandledrejection", event => {
  logPlannerError(event.reason, {
    source: "unhandled_promise_rejection"
  });
});

async function loadGameData() {
  if (gameData) return gameData;

  const response = await fetch(GAME_DATA_PATH);
  if (!response.ok) {
    throw new Error(`Could not load ${GAME_DATA_PATH}`);
  }

  gameData = await response.json();
  return gameData;
}

function parseFraction(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return value;

  const str = String(value).trim();

  if (str.includes("/")) {
    const [a, b] = str.split("/").map(Number);
    return a / b;
  }

  return Number(str);
}

function getRecipeMaps(data) {
  const recipeMap = new Map();
  const machineMap = new Map();

  for (const recipe of data.Recipes || []) {
    recipeMap.set(recipe.Name, recipe);
  }

  for (const machine of data.Machines || []) {
    machineMap.set(machine.Name, machine);
  }

  return { recipeMap, machineMap };
}

function getPositivePartsPerMinute(recipe) {
  const batchTime = parseFraction(recipe.BatchTime);
  if (!batchTime) return {};

  const output = {};

  for (const part of recipe.Parts || []) {
    const amount = parseFraction(part.Amount);
    if (amount > 0) {
      output[part.Part] = (output[part.Part] || 0) + (amount / batchTime) * 60;
    }
  }

  return output;
}

function getNegativePartsPerMinute(recipe) {
  const batchTime = parseFraction(recipe.BatchTime);
  if (!batchTime) return {};

  const input = {};

  for (const part of recipe.Parts || []) {
    const amount = parseFraction(part.Amount);
    if (amount < 0) {
      input[part.Part] = (input[part.Part] || 0) + (Math.abs(amount) / batchTime) * 60;
    }
  }

  return input;
}

function getMainMachineName(recipe) {
  return recipe?.Machine || "Unknown";
}

function getParserFootprint(machineName) {
  return MACHINE_FOOTPRINTS[machineName] || { width: 10, length: 10 };
}

function chooseGrid(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { rows, cols };
}

function getBlockEstimate(machineName, roundedCount, gap) {
  const footprint = getParserFootprint(machineName);
  const { rows, cols } = chooseGrid(roundedCount);

  const totalWidth = cols * footprint.width + Math.max(0, cols - 1) * gap;
  const totalLength = rows * footprint.length + Math.max(0, rows - 1) * gap;

  return {
    rows,
    cols,
    width: totalWidth,
    length: totalLength
  };
}

function buildNodeState(sfmd, recipeMap) {
  return sfmd.Data.map((node, index) => {
    const recipe = recipeMap.get(node.Name);

    if (!recipe) {
      return {
        index,
        node,
        recipe: null,
        outputsPerMinute: {},
        inputsPerMinute: {},
        machineCountExact: 0,
        outputDemands: {},
        warnings: [`Recipe "${node.Name}" not found in game_data.json`]
      };
    }

    return {
      index,
      node,
      recipe,
      outputsPerMinute: getPositivePartsPerMinute(recipe),
      inputsPerMinute: getNegativePartsPerMinute(recipe),
      machineCountExact: 0,
      outputDemands: {},
      warnings: []
    };
  });
}
function collectInputRefs(inputValue, refs = []) {
  if (typeof inputValue === "number") {
    refs.push(inputValue);
    return refs;
  }

  if (!Array.isArray(inputValue)) {
    return refs;
  }

  if (typeof inputValue[0] === "number") {
    refs.push(inputValue[0]);
    return refs;
  }

  for (const item of inputValue) {
    collectInputRefs(item, refs);
  }

  return refs;
}

function getNodeSinkDemandPpm(node) {
  const max = parseFraction(node?.Max);
  const capacity = String(node?.Capacity || "").trim();

  const capacityMatch = capacity.match(/([\d.]+)\s*\/\s*min/i);
  const capacityPpm = capacityMatch ? Number(capacityMatch[1]) : 0;

  if (capacityPpm > 0 && max > 0) {
    return capacityPpm * max;
  }

  if (capacityPpm > 0) {
    return capacityPpm;
  }

  if (max > 0) {
    return max;
  }

  return 1;
}

function routeDemandToNode(nodes, nodeIndex, partName, ppm, visiting = new Set()) {
  const nodeState = nodes[nodeIndex];

  if (!nodeState) {
    return;
  }

  const visitKey = `${nodeIndex}|${partName || ""}`;
  if (visiting.has(visitKey)) {
    return;
  }

  visiting.add(visitKey);

  if (nodeState.recipe) {
    let demandedPart = partName;

    if (!demandedPart) {
      const outputParts = Object.keys(nodeState.outputsPerMinute || {});
      demandedPart = outputParts[0] || null;
    }

    if (demandedPart) {
      addDemandToNode(nodes, nodeIndex, demandedPart, ppm);
    }

    visiting.delete(visitKey);
    return;
  }

  const upstreamRefs = getInputRefsForPart(nodeState.node.Inputs);

  if (upstreamRefs.length === 0) {
    visiting.delete(visitKey);
    return;
  }

  const splitDemand = ppm / upstreamRefs.length;

  for (const ref of upstreamRefs) {
    routeDemandToNode(
      nodes,
      ref.index,
      ref.part || partName,
      splitDemand,
      visiting
    );
  }

  visiting.delete(visitKey);
}

function addDemandToNode(nodes, nodeIndex, partName, ppm) {
  const nodeState = nodes[nodeIndex];

  if (!nodeState || !nodeState.recipe) {
    return;
  }

  nodeState.outputDemands[partName] =
    (nodeState.outputDemands[partName] || 0) + ppm;

  const outputRate = nodeState.outputsPerMinute[partName];

  if (!outputRate || outputRate <= 0) {
    nodeState.warnings.push(`No output rate found for part "${partName}"`);
    return;
  }

  const requiredMachineCount = nodeState.outputDemands[partName] / outputRate;
  const previousMachineCount = nodeState.machineCountExact;

  if (requiredMachineCount <= previousMachineCount + 1e-9) {
    return;
  }

  const deltaMachines = requiredMachineCount - previousMachineCount;
  nodeState.machineCountExact = requiredMachineCount;

  for (const [inputPart, inputRatePerMachine] of Object.entries(nodeState.inputsPerMinute)) {
    const totalAdditionalInput = inputRatePerMachine * deltaMachines;
    const upstreamRefs = getInputRefsForPart(nodeState.node.Inputs, inputPart);

    if (upstreamRefs.length === 0) {
      continue;
    }

    const splitDemand = totalAdditionalInput / upstreamRefs.length;

    for (const ref of upstreamRefs) {
      routeDemandToNode(
        nodes,
        ref.index,
        ref.part || inputPart,
        splitDemand
      );
    }
  }
}

function getInputRefsForPart(inputs, partName = null) {
  if (!inputs) return [];

  const rawRefs = [];

  if (Array.isArray(inputs)) {
    rawRefs.push(...inputs);
  } else if (partName && Array.isArray(inputs[partName])) {
    rawRefs.push(...inputs[partName]);
  } else if (!partName && typeof inputs === "object") {
    for (const value of Object.values(inputs)) {
      if (Array.isArray(value)) {
        rawRefs.push(...value);
      }
    }
  }

  return rawRefs
    .map(ref => {
      if (typeof ref === "number") {
        return {
          index: ref,
          part: partName
        };
      }

      if (Array.isArray(ref)) {
        // Satisfactory Modeler sometimes uses [nodeIndex, outputSlot]
        // and sometimes [[nodeIndex, partName]]
        if (typeof ref[0] === "number") {
          return {
            index: ref[0],
            part: partName
          };
        }

        if (Array.isArray(ref[0]) && typeof ref[0][0] === "number") {
          return {
            index: ref[0][0],
            part: typeof ref[0][1] === "string" ? ref[0][1] : partName
          };
        }
      }

      return null;
    })
    .filter(ref => ref && Number.isInteger(ref.index));
}

function solveFactory(sfmd, gameData) {
  const { recipeMap } = getRecipeMaps(gameData);
  const nodes = buildNodeState(sfmd, recipeMap);

  for (const state of nodes) {
    const maxMachines = parseFraction(state.node.Max);

    if (maxMachines > 0 && state.recipe) {
      state.machineCountExact = maxMachines;

      for (const [inputPart, inputRatePerMachine] of Object.entries(state.inputsPerMinute)) {
        const totalInputPpm = inputRatePerMachine * maxMachines;
        const upstreamRefs = getInputRefsForPart(state.node.Inputs, inputPart);

        if (upstreamRefs.length === 0) {
          continue;
        }

        const splitDemand = totalInputPpm / upstreamRefs.length;

        for (const ref of upstreamRefs) {
          routeDemandToNode(
            nodes,
            ref.index,
            ref.part || inputPart,
            splitDemand
          );
        }
      }

      continue;
    }

    // Non-recipe endpoint nodes, like Dimensional Depot.
    // Example: Capacity "60/min" and Max ".5" should demand 30 ppm.
    if (!state.recipe && maxMachines > 0 && state.node.Inputs) {
      const demandPpm = getNodeSinkDemandPpm(state.node);
      const upstreamRefs = getInputRefsForPart(state.node.Inputs);

      if (upstreamRefs.length === 0) {
        continue;
      }

      const splitDemand = demandPpm / upstreamRefs.length;

      for (const ref of upstreamRefs) {
        routeDemandToNode(
          nodes,
          ref.index,
          ref.part || null,
          splitDemand
        );
      }
    }
  }

  return nodes;
}

function computeNodeDepths(nodes) {
  const memo = new Map();
  const visiting = new Set();

  function collectInputRefs(inputValue, refs = []) {
    if (typeof inputValue === "number") {
      refs.push(inputValue);
      return refs;
    }

    if (!Array.isArray(inputValue)) {
      return refs;
    }

    // Handles [4, 0] or [10, "Empty Fluid Tank"]
    if (typeof inputValue[0] === "number") {
      refs.push(inputValue[0]);
      return refs;
    }

    // Handles nested forms like [[[6, "Water"]], [[5, "Water"]]]
    for (const item of inputValue) {
      collectInputRefs(item, refs);
    }

    return refs;
  }

  function getUpstreamNodeIndexes(nodeState) {
    const inputs = nodeState?.node?.Inputs;
    if (!inputs) return [];

    const refs = [];

    if (Array.isArray(inputs)) {
      collectInputRefs(inputs, refs);
    } else {
      for (const value of Object.values(inputs)) {
        collectInputRefs(value, refs);
      }
    }

    return [...new Set(refs)]
      .filter(index => Number.isInteger(index))
      .filter(index => index >= 0 && index < nodes.length);
  }

  function getDepth(nodeIndex) {
    if (memo.has(nodeIndex)) {
      return memo.get(nodeIndex);
    }

    const nodeState = nodes[nodeIndex];
    if (!nodeState) {
      return 0;
    }

    if (visiting.has(nodeIndex)) {
      console.warn("Cycle detected in computeNodeDepths:", nodeIndex, nodeState);
      return 0;
    }

    visiting.add(nodeIndex);

    const upstreamIndexes = getUpstreamNodeIndexes(nodeState);

    const depth = upstreamIndexes.length
      ? 1 + Math.max(...upstreamIndexes.map(getDepth))
      : 0;

    visiting.delete(nodeIndex);
    memo.set(nodeIndex, depth);

    return depth;
  }

  return nodes.map((_, index) => getDepth(index));
}

function buildRecipeSummaryFromSfmd(sfmd, gameData, gap = 1) {
  const solvedNodes = solveFactory(sfmd, gameData);
  const depths = computeNodeDepths(solvedNodes);
  const grouped = new Map();

  const EXCLUDED_MACHINES = [
    "Miner",
    "Water Extractor",
    "Resource Well Extractor",
    "Oil Extractor"
  ];

  for (const nodeState of solvedNodes) {
    if (!nodeState.recipe || nodeState.machineCountExact <= 0) continue;

    const machineName = getMainMachineName(nodeState.recipe);
    if (EXCLUDED_MACHINES.includes(machineName)) {
      continue;
    }

    const recipeName = nodeState.recipe.Name;
    const nodeDepth = depths[nodeState.index] ?? 0;

    if (!grouped.has(recipeName)) {
      grouped.set(recipeName, {
        recipeName,
        machineName,
        exactMachines: 0,
        warnings: [],
        depthTotal: 0,
        depthCount: 0,
        maxDepth: 0
      });
    }

    const group = grouped.get(recipeName);
    group.exactMachines += nodeState.machineCountExact;
    group.warnings.push(...nodeState.warnings);
    group.depthTotal += nodeDepth;
    group.depthCount += 1;
    group.maxDepth = Math.max(group.maxDepth, nodeDepth);
  }

  return Array.from(grouped.values())
    .map(group => {
      const roundedMachines = Math.ceil(group.exactMachines);
      const footprint = getParserFootprint(group.machineName);
      const block = getBlockEstimate(group.machineName, roundedMachines, gap);
      const avgDepth = group.depthCount ? group.depthTotal / group.depthCount : 0;

      return {
        ...group,
        avgDepth,
        roundedMachines,
        footprint,
        block
      };
    })
    .sort((a, b) => {
      if (a.avgDepth !== b.avgDepth) {
        return a.avgDepth - b.avgDepth;
      }

      if (a.roundedMachines !== b.roundedMachines) {
        return b.roundedMachines - a.roundedMachines;
      }

      return a.recipeName.localeCompare(b.recipeName);
    });
}

async function loadMachineCatalog() {
  const data = await loadGameData();

  machineCatalog = {};

  for (const machine of data.Machines || []) {
    const footprint = MACHINE_FOOTPRINTS[machine.Name];

    if (!footprint) continue;

    machineCatalog[machine.Name] = {
      width: footprint.width,
      length: footprint.length,
      color: "#4f9cff"
    };
  }
}

const state = {
  camera: {
    x: 0,
    y: 0,
    zoom: 3
  },
  machines: [],
  selectedMachineIds: [],
  clipboard: [],
  dragMode: null,
  dragStartScreen: { x: 0, y: 0 },
  machineDragOffsets: [],
  marqueeRect: null,
  isDragging: false,
  viewMode: "planner",
  lastImportedRows: null,
  autoFoundations: {
    enabled: true,
    tileSize: FOUNDATION_SIZE,
    opacity: 0.72
  },
  manualFoundations: {
    enabled: true,
    drawingMode: false,
    rotation: 0,
    tiles: [],
    selectedTileIds: [],
    hoverTile: null,
    drawStartWorld: null,
    drawPreviewTiles: [],
    nextId: 1
  }
};

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  state.camera.zoom = Math.max(getEffectiveMinZoom(), state.camera.zoom);
  clampCameraToWorldMap();

  draw();
}

function worldToScreen(wx, wy) {
  return {
    x: wx * state.camera.zoom + state.camera.x,
    y: wy * state.camera.zoom + state.camera.y
  };
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - state.camera.x) / state.camera.zoom,
    y: (sy - state.camera.y) / state.camera.zoom
  };
}

function getEffectiveMinZoom() {
  const rect = canvas.getBoundingClientRect();

  const minZoomToCoverWidth = rect.width / worldMap.width;
  const minZoomToCoverHeight = rect.height / worldMap.height;

  return Math.max(
    MIN_ZOOM,
    minZoomToCoverWidth,
    minZoomToCoverHeight
  );
}

function clampCameraToWorldMap() {
  const rect = canvas.getBoundingClientRect();
  const zoom = state.camera.zoom;

  const mapLeftScreen = worldMap.x * zoom;
  const mapRightScreen = (worldMap.x + worldMap.width) * zoom;
  const mapTopScreen = worldMap.y * zoom;
  const mapBottomScreen = (worldMap.y + worldMap.height) * zoom;

  const minCameraX = rect.width - mapRightScreen;
  const maxCameraX = -mapLeftScreen;

  const minCameraY = rect.height - mapBottomScreen;
  const maxCameraY = -mapTopScreen;

  if (minCameraX > maxCameraX) {
    state.camera.x = (minCameraX + maxCameraX) / 2;
  } else {
    state.camera.x = Math.max(minCameraX, Math.min(maxCameraX, state.camera.x));
  }

  if (minCameraY > maxCameraY) {
    state.camera.y = (minCameraY + maxCameraY) / 2;
  } else {
    state.camera.y = Math.max(minCameraY, Math.min(maxCameraY, state.camera.y));
  }
}

function snap(value) {
  return Math.round(value / SNAP_SIZE) * SNAP_SIZE;
}

function snapPosition(x, y) {
  return {
    x: snap(x),
    y: snap(y)
  };
}

function getMachineDefinition(type) {
  return machineCatalog[type] || null;
}

function getMachineById(id) {
  return state.machines.find(machine => machine.id === id) || null;
}

function getSelectedMachines() {
  return state.selectedMachineIds
    .map(id => getMachineById(id))
    .filter(Boolean);
}

function getPrimarySelectedMachine() {
  const selected = getSelectedMachines();
  return selected.length === 1 ? selected[0] : null;
}

function isMachineSelected(id) {
  return state.selectedMachineIds.includes(id);
}

function clearSelection() {
  state.selectedMachineIds = [];
}

function setSelection(ids) {
  state.selectedMachineIds = [...ids];
}

function addToSelection(id) {
  if (!state.selectedMachineIds.includes(id)) {
    state.selectedMachineIds.push(id);
  }
}

function getMachineFootprint(machine) {
  return {
    width: machine.width,
    length: machine.length
  };
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function rotatePointAround(point, center, degrees) {
  const radians = degreesToRadians(degrees);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}

function getMachineCenter(machine, overrideX = machine.x, overrideY = machine.y) {
  return {
    x: overrideX + machine.width / 2,
    y: overrideY + machine.length / 2
  };
}

function getRotatedRectCorners(
  machine,
  overrideX = machine.x,
  overrideY = machine.y,
  overrideRotation = machine.rotation
) {
  const center = getMachineCenter(machine, overrideX, overrideY);
  const halfWidth = machine.width / 2;
  const halfLength = machine.length / 2;

  const corners = [
    { x: center.x - halfWidth, y: center.y - halfLength },
    { x: center.x + halfWidth, y: center.y - halfLength },
    { x: center.x + halfWidth, y: center.y + halfLength },
    { x: center.x - halfWidth, y: center.y + halfLength }
  ];

  return corners.map(point =>
    rotatePointAround(point, center, normalizeDegrees(overrideRotation))
  );
}

function getAxisAlignedBoundsFromCorners(corners) {
  const xs = corners.map(corner => corner.x);
  const ys = corners.map(corner => corner.y);

  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    length: bottom - top
  };
}

function getMachineBounds(
  machine,
  overrideX = machine.x,
  overrideY = machine.y,
  overrideRotation = machine.rotation
) {
  const corners = getRotatedRectCorners(machine, overrideX, overrideY, overrideRotation);
  return getAxisAlignedBoundsFromCorners(corners);
}

function pointInRotatedMachine(worldPoint, machine) {
  const center = getMachineCenter(machine);

  const unrotatedPoint = rotatePointAround(
    worldPoint,
    center,
    -normalizeDegrees(machine.rotation)
  );

  return (
    unrotatedPoint.x >= machine.x &&
    unrotatedPoint.x <= machine.x + machine.width &&
    unrotatedPoint.y >= machine.y &&
    unrotatedPoint.y <= machine.y + machine.length
  );
}

function projectPolygon(axis, points) {
  let min = Infinity;
  let max = -Infinity;

  for (const point of points) {
    const projection = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }

  return { min, max };
}

function polygonsOverlapSAT(pointsA, pointsB) {
  const polygons = [pointsA, pointsB];

  for (const points of polygons) {
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];

      const edge = {
        x: p2.x - p1.x,
        y: p2.y - p1.y
      };

      const axisRaw = {
        x: -edge.y,
        y: edge.x
      };

      const axisLength = Math.hypot(axisRaw.x, axisRaw.y);
      if (!axisLength) continue;

      const axis = {
        x: axisRaw.x / axisLength,
        y: axisRaw.y / axisLength
      };

      const projectionA = projectPolygon(axis, pointsA);
      const projectionB = projectPolygon(axis, pointsB);

      if (projectionA.max <= projectionB.min || projectionB.max <= projectionA.min) {
        return false;
      }
    }
  }

  return true;
}

function machineBodiesOverlap(machineA, machineB, overrideA = {}, overrideB = {}) {
  const cornersA = getRotatedRectCorners(
    machineA,
    overrideA.x ?? machineA.x,
    overrideA.y ?? machineA.y,
    overrideA.rotation ?? machineA.rotation
  );

  const cornersB = getRotatedRectCorners(
    machineB,
    overrideB.x ?? machineB.x,
    overrideB.y ?? machineB.y,
    overrideB.rotation ?? machineB.rotation
  );

  return polygonsOverlapSAT(cornersA, cornersB);
}

function getMachineBufferRects(
  machine,
  overrideX = machine.x,
  overrideY = machine.y,
  overrideRotation = machine.rotation
) {
  if (machine.isGroup) {
    return {
      input: null,
      output: null
    };
  }

  const bounds = getMachineBounds(machine, overrideX, overrideY, overrideRotation);
  const bufferDepth = 1;
  const rotation = ((overrideRotation % 360) + 360) % 360;

  const topRect = {
    left: bounds.left,
    right: bounds.right,
    top: bounds.top - bufferDepth,
    bottom: bounds.top
  };

  const bottomRect = {
    left: bounds.left,
    right: bounds.right,
    top: bounds.bottom,
    bottom: bounds.bottom + bufferDepth
  };

  const leftRect = {
    left: bounds.left - bufferDepth,
    right: bounds.left,
    top: bounds.top,
    bottom: bounds.bottom
  };

  const rightRect = {
    left: bounds.right,
    right: bounds.right + bufferDepth,
    top: bounds.top,
    bottom: bounds.bottom
  };

  // Base rule:
  // 0°   = input left,   output right
  // 90°  = input top,    output bottom
  // 180° = input right,  output left
  // 270° = input bottom, output top

  if (rotation === 0) {
    return { input: leftRect, output: rightRect };
  }

  if (rotation === 90) {
    return { input: topRect, output: bottomRect };
  }

  if (rotation === 180) {
    return { input: rightRect, output: leftRect };
  }

  if (rotation === 270) {
    return { input: bottomRect, output: topRect };
  }

  return { input: leftRect, output: rightRect };
}

function getMachineOccupiedRects(
  machine,
  overrideX = machine.x,
  overrideY = machine.y,
  overrideRotation = machine.rotation
) {
  const bounds = getMachineBounds(machine, overrideX, overrideY, overrideRotation);

  if (machine.isGroup) {
    return [bounds];
  }

  const buffers = getMachineBufferRects(machine, overrideX, overrideY, overrideRotation);

  return [
    bounds,
    buffers.input,
    buffers.output
  ].filter(Boolean);
}

function getFoundationCellsForRect(rect, tileSize = FOUNDATION_SIZE) {
  if (!rect) return [];

  const cells = [];

  // Option A:
  // Any overlap OR edge-touch counts as occupying that foundation cell.
  const startCol = Math.floor(rect.left / tileSize);
  const endCol = Math.floor(rect.right / tileSize);
  const startRow = Math.floor(rect.top / tileSize);
  const endRow = Math.floor(rect.bottom / tileSize);

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      cells.push({ col, row });
    }
  }

  return cells;
}

function collectAutoFoundationCells() {
  const tileSize = state.autoFoundations.tileSize || FOUNDATION_SIZE;
  const occupied = new Map();

  for (const machine of state.machines) {
    const rects = getMachineOccupiedRects(machine);

    for (const rect of rects) {
      const cells = getFoundationCellsForRect(rect, tileSize);

      for (const cell of cells) {
        const key = `${cell.col},${cell.row}`;

        if (!occupied.has(key)) {
          occupied.set(key, cell);
        }
      }
    }
  }

  return Array.from(occupied.values());
}

function drawFoundationTile(worldX, worldY, tileSize, rotation = 0, alpha = 1) {
  const centerWorld = {
    x: worldX + tileSize / 2,
    y: worldY + tileSize / 2
  };

  const centerScreen = worldToScreen(centerWorld.x, centerWorld.y);
  const sizePx = tileSize * state.camera.zoom;

  const rect = canvas.getBoundingClientRect();
  if (
    centerScreen.x + sizePx < -64 ||
    centerScreen.y + sizePx < -64 ||
    centerScreen.x > rect.width + 64 ||
    centerScreen.y > rect.height + 64
  ) {
    return;
  }

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(centerScreen.x, centerScreen.y);
  ctx.rotate(degreesToRadians(rotation));

  const drawX = -sizePx / 2;
  const drawY = -sizePx / 2;

  if (foundationTexture.complete && foundationTexture.naturalWidth > 0) {
    ctx.drawImage(
      foundationTexture,
      drawX,
      drawY,
      sizePx,
      sizePx
    );

    ctx.restore();
    return;
  }

  ctx.fillStyle = "#6b5a43";
  ctx.fillRect(drawX, drawY, sizePx, sizePx);

  const inset = Math.max(1, sizePx * 0.08);
  ctx.fillStyle = "#7a684e";
  ctx.fillRect(
    drawX + inset,
    drawY + inset,
    sizePx - inset * 2,
    sizePx - inset * 2
  );

  ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
  ctx.fillRect(
    drawX + sizePx * 0.22,
    drawY + sizePx * 0.18,
    sizePx * 0.56,
    sizePx * 0.64
  );

  ctx.strokeStyle = "rgba(230, 210, 170, 0.55)";
  ctx.lineWidth = Math.max(1, state.camera.zoom * 0.035);
  ctx.strokeRect(drawX, drawY, sizePx, sizePx);

  ctx.strokeStyle = "rgba(20, 16, 12, 0.55)";
  ctx.lineWidth = Math.max(1, state.camera.zoom * 0.025);

  ctx.beginPath();
  ctx.moveTo(drawX + sizePx, drawY);
  ctx.lineTo(drawX + sizePx, drawY + sizePx);
  ctx.moveTo(drawX, drawY + sizePx);
  ctx.lineTo(drawX + sizePx, drawY + sizePx);
  ctx.stroke();

  ctx.restore();
}

function drawAutoFoundations() {
  if (!state.autoFoundations.enabled) {
    return;
  }

  if (!state.machines || state.machines.length === 0) {
    return;
  }

  const tileSize = state.autoFoundations.tileSize || FOUNDATION_SIZE;

  ctx.save();
  ctx.globalAlpha = state.autoFoundations.opacity ?? 0.72;

  for (const machine of state.machines) {
    const bodyCols = Math.max(1, Math.ceil(machine.width / tileSize));
    const bodyRows = Math.max(1, Math.ceil(machine.length / tileSize));

    // Add one tile column before and after the machine body for input/output buffers.
    const totalCols = bodyCols + 2;
    const totalRows = bodyRows;

    const machineCenter = getMachineCenter(machine);

    for (let row = 0; row < totalRows; row++) {
      for (let col = 0; col < totalCols; col++) {
        const localX =
          -bodyCols * tileSize / 2 -
          tileSize / 2 +
          col * tileSize;

        const localY =
          -bodyRows * tileSize / 2 +
          tileSize / 2 +
          row * tileSize;

        const tileCenter = rotatePointAround(
          {
            x: machineCenter.x + localX,
            y: machineCenter.y + localY
          },
          machineCenter,
          machine.rotation
        );

        drawFoundationTile(
          tileCenter.x - tileSize / 2,
          tileCenter.y - tileSize / 2,
          tileSize,
          machine.rotation
        );
      }
    }
  }

  ctx.restore();
}

function getFoundationDrawAxes(rotation = state.manualFoundations.rotation) {
  const angleRad = degreesToRadians(rotation);

  const dir = {
    x: Math.cos(angleRad),
    y: Math.sin(angleRad)
  };

  const perp = {
    x: -dir.y,
    y: dir.x
  };

  return { dir, perp };
}

function getSnappedFoundationStart(worldPoint) {
  return {
    x: snap(worldPoint.x),
    y: snap(worldPoint.y)
  };
}

function buildManualFoundationPreview(
  startWorld,
  currentWorld,
  fillArea = false,
  curveMode = false
) {
  if (!startWorld || !currentWorld) return [];

  const delta = {
    x: currentWorld.x - startWorld.x,
    y: currentWorld.y - startWorld.y
  };

  const distance = Math.hypot(delta.x, delta.y);

  if (distance < FOUNDATION_SIZE * 0.35) {
    return [{
      centerX: startWorld.x,
      centerY: startWorld.y,
      rotation: state.manualFoundations.rotation
    }];
  }

  const { dir, perp } = getFoundationDrawAxes();

  // Rectangle mode: fill an oriented rectangle based on the current foundation angle.
  if (fillArea) {
    const primaryDistance = delta.x * dir.x + delta.y * dir.y;
    const secondaryDistance = delta.x * perp.x + delta.y * perp.y;

    const primaryCount = Math.floor(Math.abs(primaryDistance) / FOUNDATION_SIZE) + 1;
    const secondaryCount = Math.floor(Math.abs(secondaryDistance) / FOUNDATION_SIZE) + 1;

    const primarySign = primaryDistance >= 0 ? 1 : -1;
    const secondarySign = secondaryDistance >= 0 ? 1 : -1;

    const tiles = [];

    for (let i = 0; i < primaryCount; i++) {
      for (let j = 0; j < secondaryCount; j++) {
        tiles.push({
          centerX:
            startWorld.x +
            dir.x * FOUNDATION_SIZE * i * primarySign +
            perp.x * FOUNDATION_SIZE * j * secondarySign,
          centerY:
            startWorld.y +
            dir.y * FOUNDATION_SIZE * i * primarySign +
            perp.y * FOUNDATION_SIZE * j * secondarySign,
          rotation: state.manualFoundations.rotation
        });
      }
    }

    return tiles;
  }

  // Curve mode: each new tile rotates 5 degrees and advances slightly less than 8m
  // so the foundations overlap instead of leaving gaps.
  if (curveMode) {
    const baseRotation = state.manualFoundations.rotation;
    const baseAngleRad = degreesToRadians(baseRotation);

    const forward = {
      x: Math.cos(baseAngleRad),
      y: Math.sin(baseAngleRad)
    };

    const cross = forward.x * delta.y - forward.y * delta.x;
    const turnSign = cross >= 0 ? 1 : -1;

    const forwardProjection = delta.x * forward.x + delta.y * forward.y;
    const forwardSign = forwardProjection >= 0 ? 1 : -1;

    const stepSpacing = FOUNDATION_SIZE - SNAP_SIZE;
    const stepCount = Math.max(1, Math.floor(distance / stepSpacing) + 1);

    const tiles = [];

    let currentCenter = {
      x: startWorld.x,
      y: startWorld.y
    };

    let currentRotation = baseRotation;

    tiles.push({
      centerX: currentCenter.x,
      centerY: currentCenter.y,
      rotation: normalizeDegrees(currentRotation)
    });

    for (let i = 1; i < stepCount; i++) {
      const nextRotation = normalizeDegrees(
        currentRotation + FOUNDATION_ROTATION_STEP * turnSign * forwardSign
      );

      const travelAngle =
        currentRotation +
        (FOUNDATION_ROTATION_STEP * turnSign * forwardSign) / 2;

      const travelAngleRad = degreesToRadians(travelAngle);

      currentCenter = {
        x: snap(currentCenter.x + Math.cos(travelAngleRad) * stepSpacing * forwardSign),
        y: snap(currentCenter.y + Math.sin(travelAngleRad) * stepSpacing * forwardSign)
      };

      currentRotation = nextRotation;

      tiles.push({
        centerX: currentCenter.x,
        centerY: currentCenter.y,
        rotation: currentRotation
      });
    }

    return tiles;
  }

  // Normal line mode:
  // Use the current foundation rotation as the line direction.
  // If the drag is closer to the foundation's perpendicular axis, use that instead.
  // This allows proper end-to-end diagonal rows at 5°, 40°, 45°, etc.
  const dirProjection = delta.x * dir.x + delta.y * dir.y;
  const perpProjection = delta.x * perp.x + delta.y * perp.y;

  const usePerpAxis = Math.abs(perpProjection) > Math.abs(dirProjection);

  const lineAxis = usePerpAxis ? perp : dir;
  const lineDistance = usePerpAxis ? perpProjection : dirProjection;
  const lineSign = lineDistance >= 0 ? 1 : -1;

  const tileCount = Math.floor(Math.abs(lineDistance) / FOUNDATION_SIZE) + 1;
  const tiles = [];

  for (let i = 0; i < tileCount; i++) {
    tiles.push({
      centerX: startWorld.x + lineAxis.x * FOUNDATION_SIZE * i * lineSign,
      centerY: startWorld.y + lineAxis.y * FOUNDATION_SIZE * i * lineSign,
      rotation: state.manualFoundations.rotation
    });
  }

  return tiles;
}

function getManualFoundationTileCorners(tile) {
  const half = FOUNDATION_SIZE / 2;
  const center = {
    x: tile.centerX,
    y: tile.centerY
  };

  const corners = [
    { x: center.x - half, y: center.y - half },
    { x: center.x + half, y: center.y - half },
    { x: center.x + half, y: center.y + half },
    { x: center.x - half, y: center.y + half }
  ];

  return corners.map(point =>
    rotatePointAround(point, center, normalizeDegrees(tile.rotation || 0))
  );
}

function getManualFoundationTileBounds(tile) {
  return getAxisAlignedBoundsFromCorners(getManualFoundationTileCorners(tile));
}

function manualFoundationIntersectsWorldRect(tile, worldRect) {
  const bounds = getManualFoundationTileBounds(tile);
  return rectanglesOverlap(bounds, worldRect);
}

function isManualFoundationSelected(tileId) {
  return state.manualFoundations.selectedTileIds.includes(tileId);
}

function clearManualFoundationSelection() {
  state.manualFoundations.selectedTileIds = [];
}

function setManualFoundationSelection(ids) {
  state.manualFoundations.selectedTileIds = [...ids];
}

function drawManualFoundations() {
  if (!state.manualFoundations.enabled) return;

  for (const tile of state.manualFoundations.tiles) {
    drawFoundationTile(
      tile.centerX - FOUNDATION_SIZE / 2,
      tile.centerY - FOUNDATION_SIZE / 2,
      FOUNDATION_SIZE,
      tile.rotation
    );

    if (isManualFoundationSelected(tile.id)) {
      const centerScreen = worldToScreen(tile.centerX, tile.centerY);
      const sizePx = FOUNDATION_SIZE * state.camera.zoom;

      ctx.save();
      ctx.translate(centerScreen.x, centerScreen.y);
      ctx.rotate(degreesToRadians(tile.rotation || 0));

      ctx.strokeStyle = "#ffd866";
      ctx.lineWidth = 3;
      ctx.strokeRect(
        -sizePx / 2,
        -sizePx / 2,
        sizePx,
        sizePx
      );

      ctx.restore();
    }
  }

  if (state.manualFoundations.drawPreviewTiles.length > 0) {
    for (const tile of state.manualFoundations.drawPreviewTiles) {
      drawFoundationTile(
        tile.centerX - FOUNDATION_SIZE / 2,
        tile.centerY - FOUNDATION_SIZE / 2,
        FOUNDATION_SIZE,
        tile.rotation,
        0.55
      );
    }

    return;
  }

  if (state.manualFoundations.drawingMode && state.manualFoundations.hoverTile) {
    const tile = state.manualFoundations.hoverTile;

    drawFoundationTile(
      tile.centerX - FOUNDATION_SIZE / 2,
      tile.centerY - FOUNDATION_SIZE / 2,
      FOUNDATION_SIZE,
      tile.rotation,
      0.55
    );
  }
}

function rectSetsOverlap(rectsA, rectsB) {
  for (const rectA of rectsA) {
    for (const rectB of rectsB) {
      if (rectanglesOverlap(rectA, rectB)) {
        return true;
      }
    }
  }
  return false;
}

function wouldMachineOverlap(
  machine,
  testX = machine.x,
  testY = machine.y,
  testRotation = machine.rotation,
  ignoreIds = []
) {
  for (const other of state.machines) {
    if (other.id === machine.id) continue;
    if (ignoreIds.includes(other.id)) continue;

    if (
      machineBodiesOverlap(
        machine,
        other,
        { x: testX, y: testY, rotation: testRotation }
      )
    ) {
      return true;
    }
  }

  return false;
}

function rectanglesOverlap(a, b) {
  const separated =
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom;

  return !separated;
}

function canPlaceMachine(machine, testX = machine.x, testY = machine.y, testRotation = machine.rotation) {
  return !wouldMachineOverlap(machine, testX, testY, testRotation);
}

function findOpenPlacement(machine, originX, originY, maxRadius = 40) {
  const start = snapPosition(originX, originY);

  if (canPlaceMachine(machine, start.x, start.y, machine.rotation)) {
    return start;
  }

  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const onRing = Math.abs(dx) === radius || Math.abs(dy) === radius;
        if (!onRing) continue;

        const testX = snap(start.x + dx * SNAP_SIZE);
        const testY = snap(start.y + dy * SNAP_SIZE);

        if (canPlaceMachine(machine, testX, testY, machine.rotation)) {
          return { x: testX, y: testY };
        }
      }
    }
  }

  return null;
}

function updateSelectedInfo() {
  const selected = getSelectedMachines();

  if (selected.length === 0) {
    selectedInfo.textContent = "None";
    return;
  }

  if (selected.length > 1) {
    const sameBlockIds = [...new Set(
      selected
        .map(machine => machine.blockId)
        .filter(Boolean)
    )];

    const sameRecipeNames = [...new Set(
      selected
        .map(machine => machine.recipeName)
        .filter(Boolean)
    )];

    let extra = "";

    if (sameBlockIds.length === 1) {
      extra += `<br>Block ID: ${sameBlockIds[0]}`;
    }

    if (sameRecipeNames.length === 1) {
      extra += `<br>Recipe: ${sameRecipeNames[0]}`;
    }

    selectedInfo.innerHTML = `
      <strong>${selected.length} machines selected</strong>
      ${extra}<br>
      Ctrl+C: Copy<br>
      Ctrl+X: Cut<br>
      Ctrl+V: Paste<br>
      Delete: Remove
    `;
    return;
  }

  const machine = selected[0];
  const footprint = getMachineFootprint(machine);

  if (machine.isGroup) {
    selectedInfo.innerHTML = `
      <strong>${machine.recipeName}</strong><br>
      Group Type: ${machine.groupMachineType}<br>
      Count: ${machine.groupCount}<br>
      Layout: ${machine.groupRows} × ${machine.groupCols}<br>
      Width: ${footprint.width} m<br>
      Length: ${footprint.length} m<br>
      X: ${machine.x.toFixed(1)} m<br>
      Y: ${machine.y.toFixed(1)} m<br>
      Rotation: ${machine.rotation}°
    `;
    return;
  }

  if (machine.blockId || machine.recipeName) {
    selectedInfo.innerHTML = `
      <strong>${machine.recipeName || machine.type}</strong><br>
      ${machine.type}<br><br>

      Block Machine Type: ${machine.blockMachineType || machine.type}<br>
      Block ID: ${machine.blockId || "—"}<br>
      Block Index: ${machine.blockIndex ?? "—"}<br>
      Block Count: ${machine.blockCount ?? "—"}<br>
      Layout: ${(machine.blockRows ?? "—")} × ${(machine.blockCols ?? "—")}<br>
      Position In Block: ${
        machine.blockPosition
          ? `${machine.blockPosition.row}, ${machine.blockPosition.col}`
          : "—"
      }<br>
      Width: ${footprint.width} m<br>
      Length: ${footprint.length} m<br>
      X: ${machine.x.toFixed(1)} m<br>
      Y: ${machine.y.toFixed(1)} m<br>
      Rotation: ${machine.rotation}°
    `;
    return;
  }

  selectedInfo.innerHTML = `
    <strong>${machine.type}</strong><br>
    Width: ${footprint.width} m<br>
    Length: ${footprint.length} m<br>
    X: ${machine.x.toFixed(1)} m<br>
    Y: ${machine.y.toFixed(1)} m<br>
    Rotation: ${machine.rotation}°
  `;
}

function createMachine(type, x, y) {
  const def = getMachineDefinition(type);

  if (!def) {
    throw new Error(`Unknown machine type: ${type}`);
  }

  return {
    id: crypto.randomUUID(),
    type,
    x,
    y,
    width: def.width,
    length: def.length,
    rotation: 0,
    color: def.color
  };
}


function placeMachine(type) {
  const rect = canvas.getBoundingClientRect();
  const centerWorld = screenToWorld(rect.width / 2, rect.height / 2);

  const machine = createMachine(type, 0, 0);
  const placement = findOpenPlacement(machine, centerWorld.x, centerWorld.y);

  if (!placement) return;

  machine.x = placement.x;
  machine.y = placement.y;

  state.machines.push(machine);
  setSelection([machine.id]);

  updateSelectedInfo();
  draw();
}

async function renderRecipePalette(filterText = "") {
  const data = await loadGameData();

  machineSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a recipe...";
  placeholder.disabled = true;
  placeholder.selected = true;
  machineSelect.appendChild(placeholder);

  const search = filterText.trim().toLowerCase();

  const recipes = (data.Recipes || [])
    .filter(r => r.Name && r.Machine)
    .filter(r => {
      if (!search) return true;
      return (
        r.Name.toLowerCase().includes(search) ||
        r.Machine.toLowerCase().includes(search)
      );
    })
    .sort((a, b) => a.Name.localeCompare(b.Name));

  for (const recipe of recipes) {
    const option = document.createElement("option");
    option.value = recipe.Name;
    option.textContent = `${recipe.Name} (${recipe.Machine})`;
    machineSelect.appendChild(option);
  }
}

recipeSearch.addEventListener("input", () => {
  renderRecipePalette(recipeSearch.value);
});


addMachineBtn.addEventListener("click", async () => {
  const selectedRecipeName = machineSelect.value;
  if (!selectedRecipeName) return;

  const data = await loadGameData();
  const recipe = data.Recipes.find(r => r.Name === selectedRecipeName);

  if (!recipe) {
    alert("Recipe not found");
    return;
  }

  const machineCount = getRequestedMachineCount();

  logPlannerEvent("manual_recipe_add", {
    recipe_name: recipe.Name,
    machine_type: recipe.Machine,
    machine_count: machineCount
  });

  placeMachineClusterFromRecipe(recipe, machineCount);
});

plannerViewBtn.addEventListener("click", () => {
  state.viewMode = "planner";

  logPlannerEvent("planner_view_open", {
    machine_count: state.machines.length
  });

  updateViewModeUI();
  draw();
});

summaryViewBtn.addEventListener("click", () => {
  state.viewMode = "summary";

  logPlannerEvent("summary_view_open", {
    has_imported_rows: Boolean(state.lastImportedRows && state.lastImportedRows.length > 0),
    recipe_blocks: state.lastImportedRows ? state.lastImportedRows.length : 0,
    machine_count: state.machines.length
  });

  updateViewModeUI();

  if (state.lastImportedRows && state.lastImportedRows.length > 0) {
    renderSummaryView(state.lastImportedRows);
  }
});

async function readJsonFile(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function normalizeImportedRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.rows)) {
    return payload.rows;
  }

  if (Array.isArray(payload.blocks)) {
    return payload.blocks;
  }

  throw new Error("Imported JSON does not contain a rows array.");
}

function getRequestedMachineCount() {
  const rawValue = Number(machineCountInput?.value || 1);

  if (!Number.isFinite(rawValue) || rawValue < 1) {
    return 1;
  }

  return Math.floor(rawValue);
}

function placeMachineFromRecipe(recipe) {
  const machineType = recipe.Machine;

  const def = getMachineDefinition(machineType);
  if (!def) {
    alert(`No machine definition for ${machineType}`);
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const centerWorld = screenToWorld(rect.width / 2, rect.height / 2);

  const machine = {
    id: crypto.randomUUID(),
    type: machineType,
    recipeName: recipe.Name,

    x: 0,
    y: 0,
    width: def.width,
    length: def.length,
    rotation: 0,
    color: def.color
  };

  const placement = findOpenPlacement(machine, centerWorld.x, centerWorld.y);
  if (!placement) return;

  machine.x = placement.x;
  machine.y = placement.y;

  state.machines.push(machine);
  setSelection([machine.id]);

  updateSelectedInfo();
  draw();
}

function placeMachineClusterFromRecipe(recipe, count) {
  const machineType = recipe.Machine;

  const def = getMachineDefinition(machineType);
  if (!def) {
    alert(`No machine definition for ${machineType}`);
    return;
  }

  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  const blockLayout = getBlockEstimate(machineType, safeCount, 2);

  const row = {
    recipeName: recipe.Name,
    machineName: machineType,
    roundedMachines: safeCount,
    exactMachines: safeCount,
    footprint: {
      width: def.width,
      length: def.length
    },
    block: blockLayout
  };

  const rect = canvas.getBoundingClientRect();
  const centerWorld = screenToWorld(rect.width / 2, rect.height / 2);

  const clusterMachines = findOpenClusterPlacement(
    row,
    centerWorld.x,
    centerWorld.y,
    state.machines.length,
    [],
    240
  );

  if (!clusterMachines || clusterMachines.length === 0) {
    alert(`Could not find room to place ${safeCount} ${machineType} machine(s).`);
    return;
  }

  state.machines.push(...clusterMachines);
  setSelection(clusterMachines.map(machine => machine.id));

  updateSelectedInfo();
  draw();
}

function renderSummaryCards(rows) {
  const totalExact = rows.reduce((sum, row) => sum + row.exactMachines, 0);
  const totalRounded = rows.reduce((sum, row) => sum + row.roundedMachines, 0);
  const totalArea = rows.reduce((sum, row) => sum + row.block.width * row.block.length, 0);

  summaryCardsEl.innerHTML = `
    <div class="summary-card">
      <div class="label">Recipe Blocks</div>
      <div class="value">${rows.length}</div>
    </div>
    <div class="summary-card">
      <div class="label">Exact Machines</div>
      <div class="value">${totalExact.toFixed(2)}</div>
    </div>
    <div class="summary-card">
      <div class="label">Rounded Machines</div>
      <div class="value">${totalRounded}</div>
    </div>
    <div class="summary-card">
      <div class="label">Estimated Area</div>
      <div class="value">${totalArea.toFixed(0)} m²</div>
    </div>
  `;
}

function renderSummaryTable(rows) {
  summaryTableBody.innerHTML = "";

  for (const row of rows) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><strong>${escapeHtml(row.recipeName)}</strong></td>
      <td>${escapeHtml(row.machineName)}</td>
      <td>${row.exactMachines.toFixed(2)}</td>
      <td><span class="badge">${row.roundedMachines}</span></td>
      <td>${row.footprint.width}m × ${row.footprint.length}m</td>
      <td>${row.block.rows} rows × ${row.block.cols} cols</td>
      <td>${row.block.width.toFixed(1)}m × ${row.block.length.toFixed(1)}m</td>
    `;

    summaryTableBody.appendChild(tr);
  }
}

function drawSummaryPreview(rows) {
  if (!summaryPreviewCanvas || !summaryPreviewCtx) return;

  if (!rows.length) {
    summaryPreviewCanvas.width = 1400;
    summaryPreviewCanvas.height = 900;

    summaryPreviewCtx.clearRect(0, 0, summaryPreviewCanvas.width, summaryPreviewCanvas.height);
    summaryPreviewCtx.fillStyle = "#0c1117";
    summaryPreviewCtx.fillRect(0, 0, summaryPreviewCanvas.width, summaryPreviewCanvas.height);
    summaryPreviewCtx.fillStyle = "#9fb0c2";
    summaryPreviewCtx.font = "20px Arial";
    summaryPreviewCtx.fillText("No blocks to draw yet.", 30, 50);
    return;
  }

  const padding = 30;
  const blockGapMeters = 4;
  const labelLineHeight = 22;
  const labelBlockGap = 8;
  const labelLines = 4;
  const labelHeight = labelLines * labelLineHeight;
  const minCanvasWidth = 1400;

  const maxBlockWidth = Math.max(...rows.map(r => r.block.width));
  const maxBlockLength = Math.max(...rows.map(r => r.block.length));

  const usableWidth = minCanvasWidth - padding * 2;
  const scaleX = usableWidth / Math.max(maxBlockWidth * 4, 120);
  const scaleY = 900 / Math.max(maxBlockLength * 6, 120);
  const scale = Math.max(6, Math.min(scaleX, scaleY));

  const itemGapPx = blockGapMeters * scale;

  const measuredItems = rows.map(row => {
    const drawWidth = row.block.width * scale;
    const drawHeight = row.block.length * scale;

    const line1 = row.recipeName;
    const line2 = `${row.machineName} × ${row.roundedMachines}`;
    const line3 = `${row.block.rows} × ${row.block.cols}`;
    const line4 = `${row.block.width.toFixed(1)}m × ${row.block.length.toFixed(1)}m`;

    summaryPreviewCtx.font = "bold 16px Arial";
    const line1Width = summaryPreviewCtx.measureText(line1).width;

    summaryPreviewCtx.font = "14px Arial";
    const line2Width = summaryPreviewCtx.measureText(line2).width;
    const line3Width = summaryPreviewCtx.measureText(line3).width;
    const line4Width = summaryPreviewCtx.measureText(line4).width;

    const labelWidth = Math.max(line1Width, line2Width, line3Width, line4Width);
    const itemWidth = Math.max(drawWidth, labelWidth);
    const itemHeight = labelHeight + labelBlockGap + drawHeight;

    return {
      row,
      drawWidth,
      drawHeight,
      line1,
      line2,
      line3,
      line4,
      itemWidth,
      itemHeight
    };
  });

  let x = padding;
  let y = padding;
  let currentRowHeight = 0;

  for (const item of measuredItems) {
    if (x + item.itemWidth > minCanvasWidth - padding) {
      x = padding;
      y += currentRowHeight + itemGapPx;
      currentRowHeight = 0;
    }

    currentRowHeight = Math.max(currentRowHeight, item.itemHeight);
    x += item.itemWidth + itemGapPx;
  }

  const neededHeight = Math.max(900, Math.ceil(y + currentRowHeight + padding));

  summaryPreviewCanvas.width = minCanvasWidth;
  summaryPreviewCanvas.height = neededHeight;

  summaryPreviewCtx.clearRect(0, 0, summaryPreviewCanvas.width, summaryPreviewCanvas.height);
  summaryPreviewCtx.fillStyle = "#0c1117";
  summaryPreviewCtx.fillRect(0, 0, summaryPreviewCanvas.width, summaryPreviewCanvas.height);

  x = padding;
  y = padding;
  currentRowHeight = 0;

  for (const item of measuredItems) {
    if (x + item.itemWidth > summaryPreviewCanvas.width - padding) {
      x = padding;
      y += currentRowHeight + itemGapPx;
      currentRowHeight = 0;
    }

    const labelX = x;
    const labelY = y;
    const rectX = x;
    const rectY = labelY + labelHeight + labelBlockGap;

    summaryPreviewCtx.fillStyle = "#e8eef5";
    summaryPreviewCtx.font = "bold 16px Arial";
    summaryPreviewCtx.fillText(item.line1, labelX, labelY + 18);

    summaryPreviewCtx.fillStyle = "#9fb0c2";
    summaryPreviewCtx.font = "14px Arial";
    summaryPreviewCtx.fillText(item.line2, labelX, labelY + 18 + labelLineHeight);
    summaryPreviewCtx.fillText(item.line3, labelX, labelY + 18 + labelLineHeight * 2);
    summaryPreviewCtx.fillText(item.line4, labelX, labelY + 18 + labelLineHeight * 3);

    summaryPreviewCtx.fillStyle = "#243446";
    summaryPreviewCtx.strokeStyle = "#6fc2ff";
    summaryPreviewCtx.lineWidth = 2;
    summaryPreviewCtx.fillRect(rectX, rectY, item.drawWidth, item.drawHeight);
    summaryPreviewCtx.strokeRect(rectX, rectY, item.drawWidth, item.drawHeight);

    x += item.itemWidth + itemGapPx;
    currentRowHeight = Math.max(currentRowHeight, item.itemHeight);
  }
}

function renderSummaryView(rows) {
  renderSummaryCards(rows);
  renderSummaryTable(rows);
  drawSummaryPreview(rows);
}

function updateViewModeUI() {
  if (state.viewMode === "summary") {
    canvas.style.display = "none";
    summaryViewEl.style.display = "block";
  } else {
    canvas.style.display = "block";
    summaryViewEl.style.display = "none";
  }
}

function exportSummaryPdf() {
  if (!state.lastImportedRows || state.lastImportedRows.length === 0) {
    alert("Import a factory first so there is something to export.");
    return;
  }

  const previousViewMode = state.viewMode;

  state.viewMode = "summary";
  updateViewModeUI();
  renderSummaryView(state.lastImportedRows);

  setTimeout(() => {
    window.print();

    state.viewMode = previousViewMode;
    updateViewModeUI();
    draw();
  }, 100);
}

function getColorForRecipe(recipeName) {
  const name = String(recipeName || "Unknown Recipe");

  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }

  const positiveHash = Math.abs(hash);

  const hue = positiveHash % 360;
  const saturation = 62 + (positiveHash % 18); // 62–79%
  const lightness = 50 + (Math.floor(positiveHash / 360) % 14); // 50–63%

  const backgroundColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

  // Estimate readable text color from HSL lightness.
  // Most generated colors are mid-bright, but this protects darker blues/purples.
  const textColor = lightness >= 56 ? "#0b0f14" : "#ffffff";

  return {
    backgroundColor,
    textColor
  };
}

function createImportedMachine(type, x, y, metadata = {}) {
  const machine = createMachine(type, x, y);

  return {
    ...machine,
    color: metadata.color || machine.color,
    textColor: metadata.textColor || machine.textColor || "#0b0f14",
    recipeName: metadata.recipeName || null,
    blockId: metadata.blockId || null,
    blockIndex: metadata.blockIndex ?? null,
    blockRows: metadata.blockRows ?? null,
    blockCols: metadata.blockCols ?? null,
    blockCount: metadata.blockCount ?? null,
    blockMachineType: metadata.blockMachineType || null,
    exactMachines: metadata.exactMachines ?? null,
    blockPosition: metadata.blockPosition || null
  };
}

function buildClusterMachinesFromRow(row, anchorX, anchorY, blockIndex) {
  if (!row.block || !row.machineName || !row.recipeName) {
    return [];
  }

  const def = getMachineDefinition(row.machineName);
  if (!def) {
    console.warn(`Unknown machine type in import: ${row.machineName}`);
    return [];
  }

  const rows = row.block.rows || 1;
  const cols = row.block.cols || 1;
  const count = row.roundedMachines || rows * cols;

  const blockId = crypto.randomUUID();
  const recipeColors = getColorForRecipe(row.recipeName);
  const machines = [];

  const rowGap = 2;
  const colGap = 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      if (index >= count) break;

      const x = snap(anchorX + c * (def.width + colGap));
      const y = snap(anchorY + r * (def.length + rowGap));

      machines.push(
        createImportedMachine(row.machineName, x, y, {
          recipeName: row.recipeName,
          blockId,
          blockIndex,
          blockRows: rows,
          blockCols: cols,
          blockCount: count,
          blockMachineType: row.machineName,
          exactMachines: row.exactMachines ?? null,
          blockPosition: { row: r, col: c, index },
          color: recipeColors.backgroundColor,
          textColor: recipeColors.textColor
        })
      );
    }
  }

  return machines;
}

function getClusterBounds(machines) {
  if (machines.length === 0) return null;

  const bounds = machines.map(machine => getMachineBounds(machine));

  return {
    left: Math.min(...bounds.map(b => b.left)),
    top: Math.min(...bounds.map(b => b.top)),
    right: Math.max(...bounds.map(b => b.right)),
    bottom: Math.max(...bounds.map(b => b.bottom)),
    width: Math.max(...bounds.map(b => b.right)) - Math.min(...bounds.map(b => b.left)),
    length: Math.max(...bounds.map(b => b.bottom)) - Math.min(...bounds.map(b => b.top))
  };
}

function canPlaceImportedCluster(clusterMachines, extraMachines = []) {
  const blockers = [...state.machines, ...extraMachines];
  const clusterIds = new Set(clusterMachines.map(machine => machine.id));

  for (const machine of clusterMachines) {
    for (const other of blockers) {
      if (!other || clusterIds.has(other.id)) continue;

      if (machineBodiesOverlap(machine, other)) {
        return false;
      }
    }
  }

  return true;
}

function findOpenClusterPlacement(row, originX, originY, blockIndex, extraMachines = [], maxRadius = 240) {
  const start = snapPosition(originX, originY);

  const tryBuildAt = (testX, testY) => {
    const clusterMachines = buildClusterMachinesFromRow(row, testX, testY, blockIndex);
    if (clusterMachines.length === 0) return null;

    if (canPlaceImportedCluster(clusterMachines, extraMachines)) {
      return clusterMachines;
    }

    return null;
  };

  let cluster = tryBuildAt(start.x, start.y);
  if (cluster) return cluster;

  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const onRing = Math.abs(dx) === radius || Math.abs(dy) === radius;
        if (!onRing) continue;

        const testX = snap(start.x + dx * SNAP_SIZE);
        const testY = snap(start.y + dy * SNAP_SIZE);

        cluster = tryBuildAt(testX, testY);
        if (cluster) return cluster;
      }
    }
  }

  return null;
}

function importMachineClusters(rows) {
  const rect = canvas.getBoundingClientRect();
  const centerWorld = screenToWorld(rect.width / 2, rect.height / 2);

  const importedMachines = [];
  state.machines = [];

  let cursorX = snap(centerWorld.x);
  let cursorY = snap(centerWorld.y);
  let currentRowHeight = 0;

  const gap = 8;
  const maxRowWidth = 260;
  const maxRowAttempts = Math.max(rows.length * 8, 100);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.block || !row.machineName || !row.recipeName) continue;

    let placedCluster = null;
    let attempts = 0;

    while (!placedCluster && attempts < maxRowAttempts) {
      const estimatedBlockWidth = row.block.width;
      const estimatedBlockHeight = row.block.length;

      if (cursorX + estimatedBlockWidth > centerWorld.x + maxRowWidth) {
        cursorX = snap(centerWorld.x);
        cursorY = snap(cursorY + currentRowHeight + gap);
        currentRowHeight = 0;
      }

      const candidateCluster = findOpenClusterPlacement(
        row,
        cursorX,
        cursorY,
        i,
        importedMachines,
        240
      );

      if (candidateCluster && candidateCluster.length > 0) {
        placedCluster = candidateCluster;
        break;
      }

      cursorX = snap(centerWorld.x);
      cursorY = snap(cursorY + Math.max(currentRowHeight, estimatedBlockHeight) + gap);
      currentRowHeight = 0;
      attempts += 1;
    }

    if (!placedCluster) {
      console.warn("Failed to place cluster without overlap:", row.recipeName);
      continue;
    }

    const clusterBounds = getClusterBounds(placedCluster);
    if (!clusterBounds) {
      console.warn("Failed to compute cluster bounds:", row.recipeName);
      continue;
    }

    importedMachines.push(...placedCluster);

    cursorX = snap(clusterBounds.right + gap);
    currentRowHeight = Math.max(currentRowHeight, clusterBounds.length);
  }

  if (importedMachines.length === 0) {
    throw new Error("No valid machine clusters were imported.");
  }

  state.machines.push(...importedMachines);

  clearSelection();
  setSelection(importedMachines.map(m => m.id));

  updateSelectedInfo();
  draw();
}
function importMachineClusters(rows) {
  const rect = canvas.getBoundingClientRect();
  const centerWorld = screenToWorld(rect.width / 2, rect.height / 2);

  const importedMachines = [];
  state.machines = [];

  let cursorX = snap(centerWorld.x);
  let cursorY = snap(centerWorld.y);
  let currentRowHeight = 0;

  const gap = 8;
  const maxRowWidth = 200;
  const maxRowAttempts = Math.max(rows.length * 4, 40);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.block || !row.machineName || !row.recipeName) continue;

    let placedCluster = null;
    let attempts = 0;

    while (!placedCluster && attempts < maxRowAttempts) {
      const estimatedBlockWidth = row.block.width;
      const estimatedBlockHeight = row.block.length;

      if (cursorX + estimatedBlockWidth > centerWorld.x + maxRowWidth) {
        cursorX = snap(centerWorld.x);
        cursorY = snap(cursorY + currentRowHeight + gap);
        currentRowHeight = 0;
      }

      const candidateCluster = findOpenClusterPlacement(
        row,
        cursorX,
        cursorY,
        i,
        importedMachines
      );

      if (candidateCluster && candidateCluster.length > 0) {
        placedCluster = candidateCluster;
        break;
      }

      cursorX = snap(centerWorld.x);
      cursorY = snap(cursorY + Math.max(currentRowHeight, estimatedBlockHeight) + gap);
      currentRowHeight = 0;
      attempts += 1;
    }

    if (!placedCluster) {
      console.warn("Failed to place cluster without overlap:", row.recipeName);
      continue;
    }

    const clusterBounds = getClusterBounds(placedCluster);
    if (!clusterBounds) {
      console.warn("Failed to compute cluster bounds:", row.recipeName);
      continue;
    }

    importedMachines.push(...placedCluster);

    cursorX = snap(clusterBounds.right + gap);
    currentRowHeight = Math.max(currentRowHeight, clusterBounds.length);
  }

  if (importedMachines.length === 0) {
    throw new Error("No valid machine clusters were imported.");
  }

  state.machines.push(...importedMachines);

  clearSelection();
  setSelection(importedMachines.map(m => m.id));

  updateSelectedInfo();
  draw();
}

importFactoryBtn.addEventListener("click", async () => {
  let file = null;

  try {
    file = importFactoryFile.files?.[0];

    if (!file) {
      alert("Choose a .sfmd or .json file first.");
      return;
    }

    let rows;
    const fileType = file.name.toLowerCase().endsWith(".sfmd") ? "sfmd" : "json";

    if (fileType === "sfmd") {
      const sfmd = await readJsonFile(file);

      if (!sfmd || !Array.isArray(sfmd.Data)) {
        throw new Error("Uploaded file does not look like a valid .sfmd save.");
      }

      const gd = await loadGameData();
      rows = buildRecipeSummaryFromSfmd(sfmd, gd, 1);
    } else {
      const payload = await readJsonFile(file);
      rows = normalizeImportedRows(payload);
    }

    logPlannerEvent("import_success", {
      file_type: fileType,
      file_name: file.name,
      rows: rows.length
    });

    state.lastImportedRows = rows;
    renderSummaryView(rows);
    importMachineClusters(rows);
  } catch (error) {
    logPlannerError(error, {
      action: "import_file",
      file_name: file ? file.name : null,
      file_type: file
        ? file.name.toLowerCase().endsWith(".sfmd") ? "sfmd" : "json"
        : null
    });

    console.error(error);
    alert(error.message);
  }
});

function drawWorldMap() {
  if (!worldMap.visible || !worldMap.loaded) return;

  const topLeft = worldToScreen(worldMap.x, worldMap.y);
  const bottomRight = worldToScreen(
    worldMap.x + worldMap.width,
    worldMap.y + worldMap.height
  );

  const drawWidth = bottomRight.x - topLeft.x;
  const drawHeight = bottomRight.y - topLeft.y;

  ctx.save();
  ctx.globalAlpha = worldMap.opacity;
  ctx.drawImage(
    worldMap.image,
    topLeft.x,
    topLeft.y,
    drawWidth,
    drawHeight
  );
  ctx.restore();
}

function drawGrid() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(width, height);

  const foundationStep = FOUNDATION_SIZE;
  const regionStep = FOUNDATION_SIZE * 10;

  ctx.lineWidth = 1;

  // Far zoomed out: no grid. Keep the world map readable.
  if (state.camera.zoom < 0.5) {
    return;
  }

  // Medium-far zoom: draw only a coarse 10-foundation grid.
  if (state.camera.zoom < 3) {
    const startXRegion = Math.floor(topLeft.x / regionStep) * regionStep;
    const endXRegion = Math.ceil(bottomRight.x / regionStep) * regionStep;
    const startYRegion = Math.floor(topLeft.y / regionStep) * regionStep;
    const endYRegion = Math.ceil(bottomRight.y / regionStep) * regionStep;

    ctx.strokeStyle = "rgba(58, 74, 87, 0.45)";

    for (let x = startXRegion; x <= endXRegion; x += regionStep) {
      const sx = worldToScreen(x, 0).x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
      ctx.stroke();
    }

    for (let y = startYRegion; y <= endYRegion; y += regionStep) {
      const sy = worldToScreen(0, y).y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
    }

    return;
  }

  // Normal/close zoom: draw only the 8m foundation grid.
  const startXFoundation = Math.floor(topLeft.x / foundationStep) * foundationStep;
  const endXFoundation = Math.ceil(bottomRight.x / foundationStep) * foundationStep;
  const startYFoundation = Math.floor(topLeft.y / foundationStep) * foundationStep;
  const endYFoundation = Math.ceil(bottomRight.y / foundationStep) * foundationStep;

  ctx.strokeStyle = "rgba(58, 74, 87, 0.75)";

  for (let x = startXFoundation; x <= endXFoundation; x += foundationStep) {
    const sx = worldToScreen(x, 0).x;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();
  }

  for (let y = startYFoundation; y <= endYFoundation; y += foundationStep) {
    const sy = worldToScreen(0, y).y;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
    ctx.stroke();
  }
}

function drawOrigin() {
  const origin = worldToScreen(0, 0);

  ctx.strokeStyle = "#ff7b72";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(origin.x - 10, origin.y);
  ctx.lineTo(origin.x + 10, origin.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y - 10);
  ctx.lineTo(origin.x, origin.y + 10);
  ctx.stroke();
}

function drawWrappedMachineLabel(ctx, text, centerX, centerY, maxWidth, maxHeight, fontSize) {
  const lineHeight = fontSize * 1.15;

  const rawLines = String(text).split("\n");
  const finalLines = [];

  for (const rawLine of rawLines) {
    const words = rawLine.split(" ");
    let currentLine = words[0] || "";

    for (let i = 1; i < words.length; i++) {
      const testLine = `${currentLine} ${words[i]}`;
      if (ctx.measureText(testLine).width <= maxWidth) {
        currentLine = testLine;
      } else {
        finalLines.push(currentLine);
        currentLine = words[i];
      }
    }

    if (currentLine) {
      finalLines.push(currentLine);
    }
  }

  if (finalLines.length === 0) {
    return;
  }

  let linesToDraw = finalLines;

  while (linesToDraw.length * lineHeight > maxHeight && linesToDraw.length > 1) {
    linesToDraw = linesToDraw.slice(0, -1);
  }

  const totalHeight = linesToDraw.length * lineHeight;
  let y = centerY - totalHeight / 2 + lineHeight / 2;

  for (const line of linesToDraw) {
    ctx.fillText(line, centerX, y);
    y += lineHeight;
  }
}

function drawGroupLabel(machine, screenPos, widthPx, heightPx) {
  const centerX = screenPos.x + widthPx / 2;
  const centerY = screenPos.y + heightPx / 2;

  const lines = [
    machine.recipeName,
    `${machine.groupMachineType} × ${machine.groupCount}`,
    `${machine.groupRows} × ${machine.groupCols}`,
    `${getMachineFootprint(machine).width.toFixed(1)}m × ${getMachineFootprint(machine).length.toFixed(1)}m`
  ];

  let fontSize = Math.floor(Math.min(widthPx, heightPx) * 0.11);
  fontSize = Math.min(22, fontSize);

  // At far zoom levels, labels should disappear instead of staying oversized.
  if (fontSize < 6 || widthPx < 50 || heightPx < 32) {
    return;
  }

  while (fontSize > 6) {
    ctx.font = `bold ${fontSize}px Arial`;
    const line1Width = ctx.measureText(lines[0]).width;

    ctx.font = `${fontSize - 1}px Arial`;
    const otherWidths = lines.slice(1).map(line => ctx.measureText(line).width);
    const widest = Math.max(line1Width, ...otherWidths);
    const totalHeight = fontSize * 1.35 * 4;

    if (widest <= widthPx - 16 && totalHeight <= heightPx - 16) {
      break;
    }

    fontSize -= 1;
  }

  const titleFont = `bold ${fontSize}px Arial`;
  const bodyFont = `${Math.max(fontSize - 1, 6)}px Arial`;
  const lineHeight = fontSize * 1.35;
  const totalHeight = lineHeight * 4;
  let y = centerY - totalHeight / 2 + lineHeight * 0.8;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#e8eef5";
  ctx.font = titleFont;
  ctx.fillText(lines[0], centerX, y);

  ctx.fillStyle = "#d2dbe5";
  ctx.font = bodyFont;
  ctx.fillText(lines[1], centerX, y + lineHeight);
  ctx.fillText(lines[2], centerX, y + lineHeight * 2);
  ctx.fillText(lines[3], centerX, y + lineHeight * 3);

  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function drawMachines() {
  for (const machine of state.machines) {
    const centerWorld = getMachineCenter(machine);
    const centerScreen = worldToScreen(centerWorld.x, centerWorld.y);

    const widthPx = machine.width * state.camera.zoom;
    const heightPx = machine.length * state.camera.zoom;
    const halfWidthPx = widthPx / 2;
    const halfHeightPx = heightPx / 2;

    ctx.save();
    ctx.translate(centerScreen.x, centerScreen.y);
    ctx.rotate(degreesToRadians(machine.rotation));

    if (machine.isGroup) {
      ctx.fillStyle = machine.color || "#2f4257";
      ctx.globalAlpha = 0.82;
      ctx.fillRect(-halfWidthPx, -halfHeightPx, widthPx, heightPx);
      ctx.globalAlpha = 1;

      ctx.strokeStyle = isMachineSelected(machine.id) ? "#ffd866" : "#6fc2ff";
      ctx.lineWidth = isMachineSelected(machine.id) ? 3 : 2;
      ctx.strokeRect(-halfWidthPx, -halfHeightPx, widthPx, heightPx);

      ctx.restore();

      const labelTopLeft = {
        x: centerScreen.x - halfWidthPx,
        y: centerScreen.y - halfHeightPx
      };
      drawGroupLabel(machine, labelTopLeft, widthPx, heightPx);
      continue;
    }

    ctx.fillStyle = machine.color;
    ctx.fillRect(-halfWidthPx, -halfHeightPx, widthPx, heightPx);

    const bufferDepthPx = state.camera.zoom;
    const bodyLeft = -halfWidthPx;
    const bodyTop = -halfHeightPx;
    const bodyRight = halfWidthPx;

    ctx.fillStyle = "rgba(80, 200, 120, 0.22)";
    ctx.strokeStyle = "rgba(80, 200, 120, 0.55)";
    ctx.lineWidth = 1;
    ctx.fillRect(bodyLeft - bufferDepthPx, bodyTop, bufferDepthPx, heightPx);
    ctx.strokeRect(bodyLeft - bufferDepthPx, bodyTop, bufferDepthPx, heightPx);

    ctx.fillStyle = "rgba(255, 215, 0, 0.18)";
    ctx.strokeStyle = "rgba(255, 215, 0, 0.45)";
    ctx.fillRect(bodyRight, bodyTop, bufferDepthPx, heightPx);
    ctx.strokeRect(bodyRight, bodyTop, bufferDepthPx, heightPx);

    ctx.strokeStyle = isMachineSelected(machine.id) ? "#ffd866" : "#0b0f14";
    ctx.lineWidth = isMachineSelected(machine.id) ? 3 : 1.5;
    ctx.strokeRect(-halfWidthPx, -halfHeightPx, widthPx, heightPx);

    const paddingX = 8;
    const paddingY = 8;
    const maxTextWidth = Math.max(16, widthPx - paddingX * 2);
    const maxTextHeight = Math.max(16, heightPx - paddingY * 2);

    let fontSize = Math.floor(Math.min(widthPx, heightPx) * 0.18);
    fontSize = Math.min(24, fontSize);

    if (fontSize >= 5 && widthPx >= 18 && heightPx >= 14) {
      ctx.fillStyle = machine.textColor || "#0b0f14";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      while (fontSize > 5) {
        ctx.font = `${fontSize}px Arial`;

        const labelPreview = machine.recipeName
          ? `${machine.recipeName} ${machine.type}`
          : machine.type;

        const words = labelPreview.split(" ");
        const lineHeight = fontSize * 1.15;

        let lines = [];
        let currentLine = words[0] || "";

        for (let i = 1; i < words.length; i++) {
          const testLine = `${currentLine} ${words[i]}`;
          if (ctx.measureText(testLine).width <= maxTextWidth) {
            currentLine = testLine;
          } else {
            lines.push(currentLine);
            currentLine = words[i];
          }
        }

        if (currentLine) {
          lines.push(currentLine);
        }

        const widestLine = Math.max(...lines.map(line => ctx.measureText(line).width), 0);
        const totalHeight = lines.length * lineHeight;

        const singleWordTooWide =
          words.length === 1 && ctx.measureText(labelPreview).width > maxTextWidth;

        if (!singleWordTooWide && widestLine <= maxTextWidth && totalHeight <= maxTextHeight) {
          break;
        }

        if (words.length === 1 && ctx.measureText(labelPreview).width <= maxTextWidth) {
          break;
        }

        fontSize -= 1;
      }

      if (fontSize >= 5) {
        ctx.font = `${fontSize}px Arial`;

        let labelText = machine.recipeName || machine.type;

        if (machine.recipeName) {
          labelText = `${machine.recipeName}\n${machine.type}`;
        }

        drawWrappedMachineLabel(
          ctx,
          labelText,
          0,
          0,
          maxTextWidth,
          maxTextHeight,
          fontSize
        );
      }
    }

    if (machine.blockPosition && state.camera.zoom > 12) {
      ctx.fillStyle = "#ffffffcc";
      ctx.font = "10px Arial";
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";

      ctx.fillText(
        `${machine.blockPosition.row},${machine.blockPosition.col}`,
        halfWidthPx - 3,
        halfHeightPx - 3
      );
    }

    ctx.restore();
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }
}

function drawMarquee() {
  if (!state.marqueeRect) return;

  const { x, y, width, height } = state.marqueeRect;

  ctx.save();
  ctx.fillStyle = "rgba(47, 129, 247, 0.18)";
  ctx.strokeStyle = "rgba(47, 129, 247, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
}

function draw() {
  const rect = canvas.getBoundingClientRect();

  ctx.fillStyle = "#2b2b2b";
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (state.viewMode === "summary") {
    drawSummaryView();
    return;
  }

  if (typeof drawWorldMap === "function") {
    drawWorldMap();
  }

  if (typeof drawAutoFoundations === "function") {
    drawAutoFoundations();
  } else if (typeof drawFoundations === "function") {
    drawFoundations();
  } else if (typeof drawFoundationTiles === "function") {
    drawFoundationTiles();
  }

  drawManualFoundations();

  drawGrid();
  drawOrigin();
  drawMachines();
  drawMarquee();
}

function drawSummaryView() {
  if (!state.lastImportedRows || state.lastImportedRows.length === 0) {
    ctx.fillStyle = "#e8eef5";
    ctx.font = "18px Arial";
    ctx.fillText("No imported factory summary yet.", 40, 50);

    ctx.fillStyle = "#9fb0c2";
    ctx.font = "14px Arial";
    ctx.fillText("Import a .sfmd or parser JSON file first.", 40, 80);
    return;
  }

  ctx.fillStyle = "#e8eef5";
  ctx.font = "bold 20px Arial";
  ctx.fillText("Factory Summary", 40, 50);

  ctx.fillStyle = "#9fb0c2";
  ctx.font = "14px Arial";
  ctx.fillText(`${state.lastImportedRows.length} recipe blocks`, 40, 78);

  let x = 40;
  let y = 120;
  const lineHeight = 22;
  const colWidth = 420;
  const bottomMargin = 40;
  const maxHeight = canvas.getBoundingClientRect().height - bottomMargin;

  for (const row of state.lastImportedRows) {
    ctx.fillStyle = "#e8eef5";
    ctx.font = "bold 14px Arial";
    ctx.fillText(row.recipeName, x, y);

    ctx.fillStyle = "#9fb0c2";
    ctx.font = "13px Arial";
    ctx.fillText(
      `${row.machineName} × ${row.roundedMachines} | ${row.block.rows} × ${row.block.cols} | ${row.block.width.toFixed(1)}m × ${row.block.length.toFixed(1)}m`,
      x,
      y + lineHeight
    );

    y += lineHeight * 3;

    if (y > maxHeight) {
      y = 120;
      x += colWidth;
    }
  }
}
function hitTestMachine(screenX, screenY) {
  const world = screenToWorld(screenX, screenY);

  for (let i = state.machines.length - 1; i >= 0; i--) {
    const machine = state.machines[i];

    if (pointInRotatedMachine(world, machine)) {
      return machine;
    }
  }

  return null;
}

function normalizeRect(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1)
  };
}

function screenRectToWorldRect(rect) {
  const topLeft = screenToWorld(rect.x, rect.y);
  const bottomRight = screenToWorld(rect.x + rect.width, rect.y + rect.height);

  return {
    left: Math.min(topLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, bottomRight.y),
    right: Math.max(topLeft.x, bottomRight.x),
    bottom: Math.max(topLeft.y, bottomRight.y)
  };
}

function machineIntersectsWorldRect(machine, worldRect) {
  const bounds = getMachineBounds(machine);
  return rectanglesOverlap(bounds, worldRect);
}

function getSelectionGroupBounds(machines) {
  if (machines.length === 0) return null;

  const boundsList = machines.map(machine => getMachineBounds(machine));

  return {
    left: Math.min(...boundsList.map(b => b.left)),
    top: Math.min(...boundsList.map(b => b.top)),
    right: Math.max(...boundsList.map(b => b.right)),
    bottom: Math.max(...boundsList.map(b => b.bottom))
  };
}

function getBoundsCenter(bounds) {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2
  };
}

function buildGroupRotationProposals(machines, rotationStep = MACHINE_ROTATION_STEP) {
  if (machines.length === 0) return [];

  const groupBounds = getSelectionGroupBounds(machines);
  if (!groupBounds) return [];

  const groupCenter = getBoundsCenter(groupBounds);

  const cleanNumber = value => Math.round(value * 1000000) / 1000000;

  return machines.map(machine => {
    const currentCenter = getMachineCenter(machine);
    const rotatedCenter = rotatePointAround(currentCenter, groupCenter, rotationStep);
    const newRotation = normalizeDegrees(machine.rotation + rotationStep);

    return {
      machine,
      x: cleanNumber(rotatedCenter.x - machine.width / 2),
      y: cleanNumber(rotatedCenter.y - machine.length / 2),
      rotation: newRotation
    };
  });
}

function canApplyMachineProposals(proposals, ignoreIds = []) {
  for (const proposal of proposals) {
    if (
      wouldMachineOverlap(
        proposal.machine,
        proposal.x,
        proposal.y,
        proposal.rotation,
        ignoreIds
      )
    ) {
      return false;
    }
  }

  return true;
}

function copySelectedMachines() {
  const selected = getSelectedMachines();
  if (selected.length === 0) return;

  const groupBounds = getSelectionGroupBounds(selected);
  if (!groupBounds) return;

  state.clipboard = selected.map(machine => ({
    type: machine.type,
    width: machine.width,
    length: machine.length,
    rotation: machine.rotation,
    color: machine.color,
    isGroup: Boolean(machine.isGroup),

    recipeName: machine.recipeName || null,
    blockId: machine.blockId || null,
    blockIndex: machine.blockIndex ?? null,
    blockRows: machine.blockRows ?? null,
    blockCols: machine.blockCols ?? null,
    blockCount: machine.blockCount ?? null,
    blockMachineType: machine.blockMachineType || null,
    exactMachines: machine.exactMachines ?? null,
    blockPosition: machine.blockPosition || null,

    offsetX: machine.x - groupBounds.left,
    offsetY: machine.y - groupBounds.top
  }));
}

function cutSelectedMachines() {
  const selectedIds = [...state.selectedMachineIds];
  if (selectedIds.length === 0) return;

  copySelectedMachines();
  state.machines = state.machines.filter(machine => !selectedIds.includes(machine.id));
  clearSelection();
  updateSelectedInfo();
  draw();
}

function canPasteClipboardAt(anchorX, anchorY) {
  const previewMachines = state.clipboard.map(item => ({
    id: crypto.randomUUID(),
    type: item.type,
    x: snap(anchorX + item.offsetX),
    y: snap(anchorY + item.offsetY),
    width: item.width,
    length: item.length,
    rotation: item.rotation,
    color: item.color,
    isGroup: item.isGroup,

    recipeName: item.recipeName,
    blockId: item.blockId,
    blockIndex: item.blockIndex,
    blockRows: item.blockRows,
    blockCols: item.blockCols,
    blockCount: item.blockCount,
    blockMachineType: item.blockMachineType,
    exactMachines: item.exactMachines,
    blockPosition: item.blockPosition
  }));

  for (const previewMachine of previewMachines) {
    for (const existing of state.machines) {
      if (machineBodiesOverlap(previewMachine, existing)) {
        return false;
      }
    }
  }

  for (let i = 0; i < previewMachines.length; i++) {
    for (let j = i + 1; j < previewMachines.length; j++) {
      if (machineBodiesOverlap(previewMachines[i], previewMachines[j])) {
        return false;
      }
    }
  }

  return true;
}

function findOpenPastePlacement(originX, originY, maxRadius = 40) {
  const start = snapPosition(originX, originY);

  if (canPasteClipboardAt(start.x, start.y)) {
    return start;
  }

  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const onRing = Math.abs(dx) === radius || Math.abs(dy) === radius;
        if (!onRing) continue;

        const testX = snap(start.x + dx * SNAP_SIZE);
        const testY = snap(start.y + dy * SNAP_SIZE);

        if (canPasteClipboardAt(testX, testY)) {
          return { x: testX, y: testY };
        }
      }
    }
  }

  return null;
}

function pasteClipboard() {
  if (state.clipboard.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  const centerWorld = screenToWorld(rect.width / 2, rect.height / 2);
  const anchor = findOpenPastePlacement(centerWorld.x, centerWorld.y);

  if (!anchor) return;

  const newMachines = state.clipboard.map(item => ({
    id: crypto.randomUUID(),
    type: item.type,
    x: snap(anchor.x + item.offsetX),
    y: snap(anchor.y + item.offsetY),
    width: item.width,
    length: item.length,
    rotation: item.rotation,
    color: item.color,
    isGroup: item.isGroup,

    recipeName: item.recipeName,
    blockId: item.blockId,
    blockIndex: item.blockIndex,
    blockRows: item.blockRows,
    blockCols: item.blockCols,
    blockCount: item.blockCount,
    blockMachineType: item.blockMachineType,
    exactMachines: item.exactMachines,
    blockPosition: item.blockPosition
  }));

  state.machines.push(...newMachines);
  setSelection(newMachines.map(machine => machine.id));
  updateSelectedInfo();
  draw();
}
function escapeHtml(str) {
  if (str === null || str === undefined) return "";

  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function deleteSelectedMachines() {
  const selectedMachineIds = [...state.selectedMachineIds];
  const selectedFoundationIds = [...state.manualFoundations.selectedTileIds];

  if (selectedMachineIds.length === 0 && selectedFoundationIds.length === 0) {
    return;
  }

  if (selectedMachineIds.length > 0) {
    const selectedMachines = getSelectedMachines();
    const deletedCount = selectedMachines.length;
    const recipeNames = [...new Set(
      selectedMachines
        .map(machine => machine.recipeName)
        .filter(Boolean)
    )];

    logPlannerEvent("manual_machine_delete", {
      machine_count: deletedCount,
      recipe_count: recipeNames.length,
      recipes: recipeNames.slice(0, 10).join(", ")
    });

    state.machines = state.machines.filter(
      machine => !selectedMachineIds.includes(machine.id)
    );
  }

  if (selectedFoundationIds.length > 0) {
    logPlannerEvent("manual_foundation_delete", {
      foundation_count: selectedFoundationIds.length
    });

    state.manualFoundations.tiles = state.manualFoundations.tiles.filter(
      tile => !selectedFoundationIds.includes(tile.id)
    );
  }

  clearSelection();
  clearManualFoundationSelection();
  updateSelectedInfo();
  draw();
}

canvas.addEventListener("contextmenu", event => {
  event.preventDefault();
  event.stopPropagation();
  return false;
});

window.addEventListener(
  "contextmenu",
  event => {
    const path = event.composedPath ? event.composedPath() : [];

    if (event.target === canvas || path.includes(canvas)) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }

    return true;
  },
  { capture: true }
);

canvas.addEventListener(
  "wheel",
  event => {
    event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const beforeZoom = screenToWorld(mouseX, mouseY);

    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    state.camera.zoom *= zoomFactor;

    const effectiveMinZoom = getEffectiveMinZoom();
    state.camera.zoom = Math.max(
      effectiveMinZoom,
      Math.min(MAX_ZOOM, state.camera.zoom)
    );

    const afterZoom = screenToWorld(mouseX, mouseY);

    state.camera.x += (afterZoom.x - beforeZoom.x) * state.camera.zoom;
    state.camera.y += (afterZoom.y - beforeZoom.y) * state.camera.zoom;

    clampCameraToWorldMap();
    draw();
  },
  { passive: false }
);

canvas.addEventListener("mousedown", event => {
  if (event.button === 1 || event.button === 2) {
    event.preventDefault();
    event.stopPropagation();
  }

  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  state.dragStartScreen = { x: mouseX, y: mouseY };

  const hitMachine = hitTestMachine(mouseX, mouseY);
  const worldPoint = screenToWorld(mouseX, mouseY);

  if (event.button === 1) {
    state.dragMode = "pan";
    state.isDragging = false;
    return;
  }

  // If left-drag foundation drawing is already active, pressing right mouse
  // should upgrade the current draw into fill-area mode instead of starting marquee.
  if (event.button === 2 && state.dragMode === "foundation-draw") {
    const fillArea = Boolean((event.buttons & 1) && (event.buttons & 2));

    state.manualFoundations.drawPreviewTiles = buildManualFoundationPreview(
      state.manualFoundations.drawStartWorld,
      worldPoint,
      fillArea,
      false
    );

    draw();
    return;
  }

  if (event.button === 2) {
    state.dragMode = "marquee";
    state.marqueeRect = {
      x: mouseX,
      y: mouseY,
      width: 0,
      height: 0
    };
    draw();
    return;
  }

  if (event.button === 0 && hitMachine) {
    clearManualFoundationSelection();

    if (!isMachineSelected(hitMachine.id)) {
      setSelection([hitMachine.id]);
    }

    const selectedMachines = getSelectedMachines();
    state.machineDragOffsets = selectedMachines.map(machine => {
      const world = screenToWorld(mouseX, mouseY);
      return {
        id: machine.id,
        offsetX: world.x - machine.x,
        offsetY: world.y - machine.y,
        startX: machine.x,
        startY: machine.y
      };
    });

    state.dragMode = "machine";
    updateSelectedInfo();
    draw();
    return;
  }

  if (event.button === 0 && state.manualFoundations.drawingMode && !hitMachine) {
    clearSelection();
    clearManualFoundationSelection();

    const snappedStart = getSnappedFoundationStart(worldPoint);

    state.dragMode = "foundation-draw";
    state.isDragging = false;
    state.manualFoundations.drawStartWorld = snappedStart;
    state.manualFoundations.hoverTile = {
      centerX: snappedStart.x,
      centerY: snappedStart.y,
      rotation: state.manualFoundations.rotation
    };
    state.manualFoundations.drawPreviewTiles = buildManualFoundationPreview(
      snappedStart,
      worldPoint,
      false
    );

    updateSelectedInfo();
    draw();
    return;
  }

  if (event.button === 0) {
    clearSelection();
    clearManualFoundationSelection();
    updateSelectedInfo();
    state.dragMode = "pan";
    state.isDragging = false;
    draw();
    return;
  }
});

canvas.addEventListener("mousemove", event => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const world = screenToWorld(mouseX, mouseY);

  if (state.manualFoundations.drawingMode && state.dragMode !== "foundation-draw") {
    const snappedHover = getSnappedFoundationStart(world);
    state.manualFoundations.hoverTile = {
      centerX: snappedHover.x,
      centerY: snappedHover.y,
      rotation: state.manualFoundations.rotation
    };
    draw();
  }

  if (state.dragMode === "pan") {
    const dx = mouseX - state.dragStartScreen.x;
    const dy = mouseY - state.dragStartScreen.y;

    if (!state.isDragging && Math.abs(dx) < 2 && Math.abs(dy) < 2) {
      return;
    }

    state.isDragging = true;

    state.camera.x += dx;
    state.camera.y += dy;

    clampCameraToWorldMap();

    state.dragStartScreen = { x: mouseX, y: mouseY };
    draw();
    return;
  }

  if (state.dragMode === "marquee") {
    state.marqueeRect = normalizeRect(
      state.dragStartScreen.x,
      state.dragStartScreen.y,
      mouseX,
      mouseY
    );
    draw();
    return;
  }

  if (state.dragMode === "machine") {
    const selectedMachines = getSelectedMachines();
    if (selectedMachines.length === 0) return;

    const primaryOffset = state.machineDragOffsets[0];
    if (!primaryOffset) return;

    const targetPrimaryX = snap(world.x - primaryOffset.offsetX);
    const targetPrimaryY = snap(world.y - primaryOffset.offsetY);

    const deltaX = targetPrimaryX - primaryOffset.startX;
    const deltaY = targetPrimaryY - primaryOffset.startY;

    const ignoreIds = selectedMachines.map(machine => machine.id);

    function buildProposedPositions(testDeltaX, testDeltaY) {
      const proposals = [];

      for (const machine of selectedMachines) {
        const dragInfo = state.machineDragOffsets.find(item => item.id === machine.id);
        if (!dragInfo) return null;

        const newX = snap(dragInfo.startX + testDeltaX);
        const newY = snap(dragInfo.startY + testDeltaY);

        if (wouldMachineOverlap(machine, newX, newY, machine.rotation, ignoreIds)) {
          return null;
        }

        proposals.push({ machine, x: newX, y: newY });
      }

      for (let i = 0; i < proposals.length; i++) {
        for (let j = i + 1; j < proposals.length; j++) {
          const a = proposals[i];
          const b = proposals[j];

          if (
            machineBodiesOverlap(
              a.machine,
              b.machine,
              { x: a.x, y: a.y, rotation: a.machine.rotation },
              { x: b.x, y: b.y, rotation: b.machine.rotation }
            )
          ) {
            return null;
          }
        }
      }

      return proposals;
    }

    const proposedPositions = buildProposedPositions(deltaX, deltaY);
    if (!proposedPositions) {
      return;
    }

    for (const proposed of proposedPositions) {
      proposed.machine.x = proposed.x;
      proposed.machine.y = proposed.y;
    }

    updateSelectedInfo();
    draw();
    return;
  }

  if (state.dragMode === "foundation-draw") {
    const dx = mouseX - state.dragStartScreen.x;
    const dy = mouseY - state.dragStartScreen.y;

    if (!state.isDragging && (Math.abs(dx) >= 2 || Math.abs(dy) >= 2)) {
      state.isDragging = true;
    }

    const fillArea = Boolean((event.buttons & 1) && (event.buttons & 2));
    const curveMode = !fillArea && event.shiftKey;

    state.manualFoundations.drawPreviewTiles = buildManualFoundationPreview(
      state.manualFoundations.drawStartWorld,
      world,
      fillArea,
      curveMode
    );

    draw();
    return;
  }
});

window.addEventListener("mouseup", () => {
  if (state.dragMode === "foundation-draw") {
    const tilesToCommit =
      state.manualFoundations.drawPreviewTiles.length > 0
        ? state.manualFoundations.drawPreviewTiles
        : state.manualFoundations.hoverTile
          ? [state.manualFoundations.hoverTile]
          : [];

    for (const tile of tilesToCommit) {
      state.manualFoundations.tiles.push({
        id: state.manualFoundations.nextId++,
        centerX: tile.centerX,
        centerY: tile.centerY,
        rotation: tile.rotation
      });
    }

    state.manualFoundations.drawPreviewTiles = [];
    state.manualFoundations.drawStartWorld = null;
    state.dragMode = null;
    state.marqueeRect = null;
    state.machineDragOffsets = [];
    state.isDragging = false;
    draw();
    return;
  }

  if (state.dragMode === "marquee" && state.marqueeRect) {
    const worldRect = screenRectToWorldRect(state.marqueeRect);

    const machineHits = state.machines
      .filter(machine => machineIntersectsWorldRect(machine, worldRect))
      .map(machine => machine.id);

    const foundationHits = state.manualFoundations.tiles
      .filter(tile => manualFoundationIntersectsWorldRect(tile, worldRect))
      .map(tile => tile.id);

    setSelection(machineHits);
    setManualFoundationSelection(foundationHits);

    state.marqueeRect = null;
    updateSelectedInfo();
    draw();

    logPlannerEvent("selection_marquee", {
      selected_count: machineHits.length + foundationHits.length,
      selected_machines: machineHits.length,
      selected_foundations: foundationHits.length
    });

    state.dragMode = null;
    state.isDragging = false;
    return;
  }

  if (state.dragMode === "machine" && state.machineDragOffsets.length > 0) {
    const movedMachines = state.machineDragOffsets
      .map(info => {
        const machine = getMachineById(info.id);
        if (!machine) return null;

        const moved =
          Math.abs(machine.x - info.startX) > 1e-9 ||
          Math.abs(machine.y - info.startY) > 1e-9;

        return moved ? machine : null;
      })
      .filter(Boolean);

    if (movedMachines.length > 0) {
      const recipeNames = [...new Set(
        movedMachines
          .map(machine => machine.recipeName)
          .filter(Boolean)
      )];

      logPlannerEvent("manual_machine_move", {
        machine_count: movedMachines.length,
        recipe_count: recipeNames.length,
        recipes: recipeNames.slice(0, 10).join(", ")
      });
    }
  }

  state.dragMode = null;
  state.marqueeRect = null;
  state.machineDragOffsets = [];
  state.isDragging = false;
});

function showPlannerToast(message, clientX = null, clientY = null) {
  let toast = document.getElementById("plannerToast");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "plannerToast";

    Object.assign(toast.style, {
      position: "fixed",
      zIndex: "1000",
      maxWidth: "280px",
      padding: "10px 12px",
      borderRadius: "8px",
      background: "rgba(15, 20, 26, 0.96)",
      border: "1px solid #ffd866",
      color: "#e6edf3",
      fontSize: "0.88rem",
      lineHeight: "1.35",
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.35)",
      pointerEvents: "none",
      opacity: "0",
      transition: "opacity 0.12s ease"
    });

    document.body.appendChild(toast);
  }

  toast.textContent = message;

  const x = clientX ?? lastPointerClientPosition.x;
  const y = clientY ?? lastPointerClientPosition.y;

  // Place slightly left/up from the pointer so it does not cover the cursor.
  const offsetX = -300;
  const offsetY = -10;

  let left = x + offsetX;
  let top = y + offsetY;

  // Keep it onscreen.
  left = Math.max(12, Math.min(left, window.innerWidth - 300));
  top = Math.max(12, Math.min(top, window.innerHeight - 80));

  toast.style.left = `${left}px`;
  toast.style.top = `${top}px`;
  toast.style.opacity = "1";

  clearTimeout(toast.hideTimer);
  toast.hideTimer = setTimeout(() => {
    toast.style.opacity = "0";
  }, 2600);
}

window.addEventListener("keydown", event => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const modKey = isMac ? event.metaKey : event.ctrlKey;
  const key = event.key.toLowerCase();

  // Let browser/system refresh shortcuts work.
  if (event.key === "F5" || (modKey && key === "r")) {
    return;
  }

  if (modKey && key === "c") {
    event.preventDefault();
    copySelectedMachines();
    return;
  }

  if (modKey && key === "x") {
    event.preventDefault();
    cutSelectedMachines();
    return;
  }

  if (modKey && key === "v") {
    event.preventDefault();
    pasteClipboard();
    return;
  }

  const selectedMachines = getSelectedMachines();
  const selectedFoundationIds = state.manualFoundations?.selectedTileIds || [];
  const hasSelectedMachines = selectedMachines.length > 0;
  const hasSelectedFoundations = selectedFoundationIds.length > 0;

  // Delete should work for machines, foundations, or both.
  // Put this BEFORE the selected-machines early return.
  if (event.key === "Delete" || event.key === "Backspace") {
    if (hasSelectedMachines || hasSelectedFoundations) {
      event.preventDefault();
      deleteSelectedMachines();
    }

    return;
  }

  // When foundation drawing is on, plain R rotates the foundation placement.
  // Ctrl+R / Ctrl+Shift+R already returned above, so browser refresh is safe.
  if (key === "r" && state.manualFoundations.drawingMode) {
    event.preventDefault();

    state.manualFoundations.rotation = normalizeDegrees(
      state.manualFoundations.rotation + FOUNDATION_ROTATION_STEP
    );

    if (state.manualFoundations.hoverTile) {
      state.manualFoundations.hoverTile.rotation = state.manualFoundations.rotation;
    }

    if (state.manualFoundations.drawPreviewTiles.length > 0) {
      state.manualFoundations.drawPreviewTiles =
        state.manualFoundations.drawPreviewTiles.map(tile => ({
          ...tile,
          rotation: state.manualFoundations.rotation
        }));
    }

    updateManualFoundationControls();
    draw();
    return;
  }

  // From here down, we only care about selected machines.
  if (!hasSelectedMachines) {
    return;
  }

  if (key === "r") {
    event.preventDefault();

    const ignoreIds = selectedMachines.map(machine => machine.id);
    const proposals = buildGroupRotationProposals(selectedMachines, MACHINE_ROTATION_STEP);

    if (!canApplyMachineProposals(proposals, ignoreIds)) {
      logPlannerEvent("manual_machine_rotate_blocked", {
        machine_count: selectedMachines.length,
        rotation_step: MACHINE_ROTATION_STEP
      });

      showPlannerToast(
        "Machine block would overlap on rotate. Move this block away from other machines, then try again."
      );

      return;
    }

    for (const proposal of proposals) {
      proposal.machine.x = proposal.x;
      proposal.machine.y = proposal.y;
      proposal.machine.rotation = proposal.rotation;
    }

    const recipeNames = [...new Set(
      selectedMachines
        .map(machine => machine.recipeName)
        .filter(Boolean)
    )];

    logPlannerEvent("manual_machine_rotate", {
      machine_count: selectedMachines.length,
      rotation_step: MACHINE_ROTATION_STEP,
      recipe_count: recipeNames.length,
      recipes: recipeNames.slice(0, 10).join(", ")
    });

    updateSelectedInfo();
    draw();
    return;
  }
});

window.getPlannerState = function () {
  return JSON.parse(JSON.stringify({
    camera: state.camera,
    machines: state.machines,
    selectedMachineIds: state.selectedMachineIds,
    manualFoundations: state.manualFoundations,
    clipboard: state.clipboard,
    viewMode: state.viewMode,
    lastImportedRows: state.lastImportedRows
  }));
};
window.addEventListener("resize", resizeCanvas);

function setupAutoFoundationToggle() {
  if (document.getElementById("autoFoundationToggle")) {
    return;
  }

  const viewControls = plannerViewBtn?.parentElement;
  if (!viewControls) {
    return;
  }

  const label = document.createElement("label");
  label.className = "foundation-toggle";
  label.style.display = "flex";
  label.style.alignItems = "center";
  label.style.gap = "8px";
  label.style.padding = "8px 10px";
  label.style.border = "1px solid #2d333b";
  label.style.borderRadius = "8px";
  label.style.background = "#0f141a";
  label.style.color = "#c3ccd5";
  label.style.fontSize = "0.88rem";
  label.style.cursor = "pointer";

  label.innerHTML = `
    <input
      id="autoFoundationToggle"
      type="checkbox"
      checked
      style="margin: 0;"
    />
    <span>Auto-draw foundations</span>
  `;

  viewControls.appendChild(label);

  const toggle = document.getElementById("autoFoundationToggle");
  toggle.checked = state.autoFoundations.enabled;

  toggle.addEventListener("change", () => {
    state.autoFoundations.enabled = toggle.checked;

    logPlannerEvent("auto_foundations_toggle", {
      enabled: state.autoFoundations.enabled
    });

    draw();
  });
}

function updateManualFoundationControls() {
  if (manualFoundationDrawBtn) {
    manualFoundationDrawBtn.classList.toggle("active", state.manualFoundations.drawingMode);
    manualFoundationDrawBtn.textContent = state.manualFoundations.drawingMode
      ? "Drawing foundations: ON"
      : "Draw foundations";
  }

  if (foundationAngleValue) {
    foundationAngleValue.textContent = `${state.manualFoundations.rotation}°`;
  }
}

function setupManualFoundationControls() {
  if (!manualFoundationDrawBtn || !rotateFoundationBtn || !foundationAngleValue) {
    return;
  }

  manualFoundationDrawBtn.addEventListener("click", () => {
    state.manualFoundations.drawingMode = !state.manualFoundations.drawingMode;
    state.manualFoundations.drawPreviewTiles = [];
    state.manualFoundations.drawStartWorld = null;

    if (state.manualFoundations.drawingMode) {
      clearSelection();
      state.dragMode = null;
      state.marqueeRect = null;
      state.machineDragOffsets = [];
      state.isDragging = false;
      updateSelectedInfo();
    }

    updateManualFoundationControls();
    draw();
  });

  rotateFoundationBtn.addEventListener("click", () => {
    state.manualFoundations.rotation = normalizeDegrees(
      state.manualFoundations.rotation + FOUNDATION_ROTATION_STEP
    );

    if (state.manualFoundations.hoverTile) {
      state.manualFoundations.hoverTile.rotation = state.manualFoundations.rotation;
    }

    updateManualFoundationControls();
    draw();
  });

  if (clearManualFoundationsBtn) {
    clearManualFoundationsBtn.addEventListener("click", () => {
      state.manualFoundations.tiles = [];
      state.manualFoundations.drawPreviewTiles = [];
      state.manualFoundations.drawStartWorld = null;
      draw();
    });
  }

  updateManualFoundationControls();
}

loadMachineCatalog().then(() => {
  setupAutoFoundationToggle();
  setupManualFoundationControls();
  renderRecipePalette();
  resizeCanvas();
  updateSelectedInfo();
  updateViewModeUI();
});

function drawExportFoundationTile(exportCtx, exportWorldToScreen, worldX, worldY, tileSize, scale) {
  const screenPos = exportWorldToScreen(worldX, worldY);
  const sizePx = tileSize * scale;

  if (foundationTexture && foundationTexture.complete && foundationTexture.naturalWidth > 0) {
    exportCtx.drawImage(
      foundationTexture,
      screenPos.x,
      screenPos.y,
      sizePx,
      sizePx
    );

    return;
  }

  // Fallback placeholder if texture is unavailable.
  exportCtx.fillStyle = "#6b5a43";
  exportCtx.fillRect(screenPos.x, screenPos.y, sizePx, sizePx);

  const inset = Math.max(1, sizePx * 0.08);
  exportCtx.fillStyle = "#7a684e";
  exportCtx.fillRect(
    screenPos.x + inset,
    screenPos.y + inset,
    sizePx - inset * 2,
    sizePx - inset * 2
  );

  exportCtx.fillStyle = "rgba(255, 255, 255, 0.055)";
  exportCtx.fillRect(
    screenPos.x + sizePx * 0.22,
    screenPos.y + sizePx * 0.18,
    sizePx * 0.56,
    sizePx * 0.64
  );

  exportCtx.strokeStyle = "rgba(230, 210, 170, 0.55)";
  exportCtx.lineWidth = Math.max(1, scale * 0.035);
  exportCtx.strokeRect(screenPos.x, screenPos.y, sizePx, sizePx);

  exportCtx.strokeStyle = "rgba(20, 16, 12, 0.55)";
  exportCtx.lineWidth = Math.max(1, scale * 0.025);

  exportCtx.beginPath();
  exportCtx.moveTo(screenPos.x + sizePx, screenPos.y);
  exportCtx.lineTo(screenPos.x + sizePx, screenPos.y + sizePx);
  exportCtx.moveTo(screenPos.x, screenPos.y + sizePx);
  exportCtx.lineTo(screenPos.x + sizePx, screenPos.y + sizePx);
  exportCtx.stroke();
}

function drawExportAutoFoundations(exportCtx, exportWorldToScreen, scale) {
  if (!state.autoFoundations?.enabled) {
    return;
  }

  if (!state.machines || state.machines.length === 0) {
    return;
  }

  const tileSize = state.autoFoundations.tileSize || FOUNDATION_SIZE;
  const cells = collectAutoFoundationCells();

  exportCtx.save();
  exportCtx.globalAlpha = state.autoFoundations.opacity ?? 0.72;

  for (const cell of cells) {
    drawExportFoundationTile(
      exportCtx,
      exportWorldToScreen,
      cell.col * tileSize,
      cell.row * tileSize,
      tileSize,
      scale
    );
  }

  exportCtx.restore();
}

function exportLayoutPng() {
  if (!state.machines || state.machines.length === 0) {
    alert("There is no layout to export yet.");
    return;
  }

  const exportCanvas = document.createElement("canvas");
  const exportCtx = exportCanvas.getContext("2d");

  const boundsList = state.machines.map(machine => getMachineBounds(machine));

  const minX = Math.min(...boundsList.map(b => b.left));
  const minY = Math.min(...boundsList.map(b => b.top));
  const maxX = Math.max(...boundsList.map(b => b.right));
  const maxY = Math.max(...boundsList.map(b => b.bottom));

  const padding = FOUNDATION_SIZE;
  const scale = 20;

  const worldLeft = minX - padding;
  const worldTop = minY - padding;
  const worldRight = maxX + padding;
  const worldBottom = maxY + padding;

  const worldWidth = worldRight - worldLeft;
  const worldHeight = worldBottom - worldTop;

  exportCanvas.width = Math.ceil(worldWidth * scale);
  exportCanvas.height = Math.ceil(worldHeight * scale);
  function exportWorldToScreen(wx, wy) {
  return {
    x: (wx - worldLeft) * scale,
    y: (wy - worldTop) * scale
  };
}



  exportCtx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);

  // ===== background =====
  exportCtx.fillStyle = "#2b2b2b";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  // ===== grid =====
  const minorStep = SNAP_SIZE;
  const foundationStep = FOUNDATION_SIZE;

  if (scale >= 12) {
    exportCtx.strokeStyle = "#1f2a33";
    exportCtx.lineWidth = 1;

    const startXMinor = Math.floor(worldLeft / minorStep) * minorStep;
    const endXMinor = Math.ceil(worldRight / minorStep) * minorStep;
    const startYMinor = Math.floor(worldTop / minorStep) * minorStep;
    const endYMinor = Math.ceil(worldBottom / minorStep) * minorStep;

    for (let x = startXMinor; x <= endXMinor; x += minorStep) {
      const sx = exportWorldToScreen(x, 0).x;
      exportCtx.beginPath();
      exportCtx.moveTo(sx, 0);
      exportCtx.lineTo(sx, exportCanvas.height);
      exportCtx.stroke();
    }

    for (let y = startYMinor; y <= endYMinor; y += minorStep) {
      const sy = exportWorldToScreen(0, y).y;
      exportCtx.beginPath();
      exportCtx.moveTo(0, sy);
      exportCtx.lineTo(exportCanvas.width, sy);
      exportCtx.stroke();
    }
  }

  exportCtx.strokeStyle = "#3a4a57";
  exportCtx.lineWidth = 1;

  const startXFoundation = Math.floor(worldLeft / foundationStep) * foundationStep;
  const endXFoundation = Math.ceil(worldRight / foundationStep) * foundationStep;
  const startYFoundation = Math.floor(worldTop / foundationStep) * foundationStep;
  const endYFoundation = Math.ceil(worldBottom / foundationStep) * foundationStep;

  for (let x = startXFoundation; x <= endXFoundation; x += foundationStep) {
    const sx = exportWorldToScreen(x, 0).x;
    exportCtx.beginPath();
    exportCtx.moveTo(sx, 0);
    exportCtx.lineTo(sx, exportCanvas.height);
    exportCtx.stroke();
  }

  for (let y = startYFoundation; y <= endYFoundation; y += foundationStep) {
    const sy = exportWorldToScreen(0, y).y;
    exportCtx.beginPath();
    exportCtx.moveTo(0, sy);
    exportCtx.lineTo(exportCanvas.width, sy);
    exportCtx.stroke();
  }
  // ===== auto foundations =====
  drawExportAutoFoundations(exportCtx, exportWorldToScreen, scale);
  // ===== machines =====
  for (const machine of state.machines) {
    const footprint = getMachineFootprint(machine);
    const screenPos = exportWorldToScreen(machine.x, machine.y);

    const widthPx = footprint.width * scale;
    const heightPx = footprint.length * scale;

    exportCtx.fillStyle = machine.color || "#3a3f47";
    exportCtx.fillRect(screenPos.x, screenPos.y, widthPx, heightPx);

    const buffers = getMachineBufferRects(machine);

    if (buffers.input) {
      const topLeft = exportWorldToScreen(buffers.input.left, buffers.input.top);
      const bufferWidthPx = (buffers.input.right - buffers.input.left) * scale;
      const bufferHeightPx = (buffers.input.bottom - buffers.input.top) * scale;

      exportCtx.fillStyle = "rgba(80, 200, 120, 0.22)";
      exportCtx.strokeStyle = "rgba(80, 200, 120, 0.55)";
      exportCtx.lineWidth = 1;
      exportCtx.fillRect(topLeft.x, topLeft.y, bufferWidthPx, bufferHeightPx);
      exportCtx.strokeRect(topLeft.x, topLeft.y, bufferWidthPx, bufferHeightPx);
    }

    if (buffers.output) {
      const topLeft = exportWorldToScreen(buffers.output.left, buffers.output.top);
      const bufferWidthPx = (buffers.output.right - buffers.output.left) * scale;
      const bufferHeightPx = (buffers.output.bottom - buffers.output.top) * scale;

      exportCtx.fillStyle = "rgba(255, 215, 0, 0.18)";
      exportCtx.strokeStyle = "rgba(255, 215, 0, 0.45)";
      exportCtx.lineWidth = 1;
      exportCtx.fillRect(topLeft.x, topLeft.y, bufferWidthPx, bufferHeightPx);
      exportCtx.strokeRect(topLeft.x, topLeft.y, bufferWidthPx, bufferHeightPx);
    }

    exportCtx.strokeStyle = "#0b0f14";
    exportCtx.lineWidth = 2;
    exportCtx.strokeRect(screenPos.x, screenPos.y, widthPx, heightPx);

    const labelText = machine.recipeName || machine.type || "";
    if (labelText) {
      exportCtx.fillStyle = "#0b0f14";
      exportCtx.font = "14px Arial";
      exportCtx.textAlign = "center";
      exportCtx.textBaseline = "middle";

      drawWrappedMachineLabel(
        exportCtx,
        labelText,
        screenPos.x + widthPx / 2,
        screenPos.y + heightPx / 2,
        Math.max(16, widthPx - 12),
        Math.max(16, heightPx - 12),
        14
      );

      exportCtx.textAlign = "start";
      exportCtx.textBaseline = "alphabetic";
    }

    if (machine.blockPosition) {
      exportCtx.fillStyle = "#ffffffcc";
      exportCtx.font = "10px Arial";
      exportCtx.textAlign = "right";
      exportCtx.textBaseline = "bottom";

      exportCtx.fillText(
        `${machine.blockPosition.row},${machine.blockPosition.col}`,
        screenPos.x + widthPx - 3,
        screenPos.y + heightPx - 3
      );

      exportCtx.textAlign = "start";
      exportCtx.textBaseline = "alphabetic";
    }
  }

  const link = document.createElement("a");
  link.href = exportCanvas.toDataURL("image/png");
  link.download = "planner_layout.png";
  link.click();
}

window.exportLayoutPng = exportLayoutPng;