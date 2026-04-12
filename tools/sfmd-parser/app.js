const DATA_PATH = "../../data/game_data.json";

const sfmdFileInput = document.getElementById("sfmdFile");
const machineGapInput = document.getElementById("machineGap");
const blockGapInput = document.getElementById("blockGap");
const runBtn = document.getElementById("runBtn");
const drawBtn = document.getElementById("drawBtn");
const statusEl = document.getElementById("status");
const resultsTableBody = document.querySelector("#resultsTable tbody");
const summaryCardsEl = document.getElementById("summaryCards");
const debugOutputEl = document.getElementById("debugOutput");
const layoutCanvas = document.getElementById("layoutCanvas");
const ctx = layoutCanvas.getContext("2d");

let gameData = null;
let latestRows = [];

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
  "Space Elevator": { width: 40, length: 40 }
};

async function loadGameData() {
  if (gameData) return gameData;

  const response = await fetch(DATA_PATH);
  if (!response.ok) {
    throw new Error(`Could not load ${DATA_PATH}`);
  }

  gameData = await response.json();
  return gameData;
}

function setStatus(message) {
  statusEl.textContent = message;
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

  for (const recipe of data.Recipes) {
    recipeMap.set(recipe.Name, recipe);
  }

  for (const machine of data.Machines) {
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

function getFootprint(machineName) {
  return MACHINE_FOOTPRINTS[machineName] || { width: 10, length: 10 };
}

function chooseGrid(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { rows, cols };
}

function getBlockEstimate(machineName, roundedCount, gap) {
  const footprint = getFootprint(machineName);
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

function addDemandToNode(nodes, nodeIndex, partName, ppm) {
  const state = nodes[nodeIndex];
  if (!state || !state.recipe) return;

  state.outputDemands[partName] = (state.outputDemands[partName] || 0) + ppm;

  const outputRate = state.outputsPerMinute[partName];
  if (!outputRate || outputRate <= 0) {
    state.warnings.push(`No output rate found for part "${partName}"`);
    return;
  }

  const requiredMachineCount = state.outputDemands[partName] / outputRate;
  const previousMachineCount = state.machineCountExact;

  if (requiredMachineCount <= previousMachineCount + 1e-9) {
    return;
  }

  const deltaMachines = requiredMachineCount - previousMachineCount;
  state.machineCountExact = requiredMachineCount;

  for (const [inputPart, inputRatePerMachine] of Object.entries(state.inputsPerMinute)) {
    const totalAdditionalInput = inputRatePerMachine * deltaMachines;
    const upstreamList = state.node.Inputs?.[inputPart] || [];

    if (upstreamList.length === 0) {
      continue;
    }

    const splitDemand = totalAdditionalInput / upstreamList.length;

    for (const upstreamIndex of upstreamList) {
      addDemandToNode(nodes, upstreamIndex, inputPart, splitDemand);
    }
  }
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
        const upstreamList = state.node.Inputs?.[inputPart] || [];

        if (upstreamList.length === 0) continue;

        const splitDemand = totalInputPpm / upstreamList.length;

        for (const upstreamIndex of upstreamList) {
          addDemandToNode(nodes, upstreamIndex, inputPart, splitDemand);
        }
      }
    }
  }

  return nodes;
}

function buildRecipeSummary(nodes, gap) {
  const grouped = new Map();
  const depths = computeNodeDepths(nodes);

  for (const nodeState of nodes) {
    if (!nodeState.recipe || nodeState.machineCountExact <= 0) continue;

    const recipeName = nodeState.recipe.Name;
    const machineName = getMainMachineName(nodeState.recipe);
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

  const rows = Array.from(grouped.values())
    .map((group) => {
      const roundedMachines = Math.ceil(group.exactMachines);
      const footprint = getFootprint(group.machineName);
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

  return rows;
}

function renderSummary(rows) {
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

function renderTable(rows) {
  resultsTableBody.innerHTML = "";

  for (const row of rows) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(row.recipeName)}</strong>
      </td>
      <td>${escapeHtml(row.machineName)}</td>
      <td>${row.avgDepth.toFixed(2)}</td>
      <td>${row.exactMachines.toFixed(2)}</td>
      <td><span class="badge">${row.roundedMachines}</span></td>
      <td>${row.footprint.width}m × ${row.footprint.length}m</td>
      <td>${row.block.rows} rows × ${row.block.cols} cols</td>
      <td>${row.block.width.toFixed(1)}m × ${row.block.length.toFixed(1)}m</td>
    `;

    resultsTableBody.appendChild(tr);
  }
}

function computeNodeDepths(nodes) {
  const depths = new Array(nodes.length).fill(0);

  function getDepth(i) {
    const node = nodes[i];
    if (!node.recipe) return 0;

    let maxDepth = 0;

    for (const inputs of Object.values(node.node.Inputs || {})) {
      for (const upstreamIndex of inputs) {
        maxDepth = Math.max(maxDepth, getDepth(upstreamIndex) + 1);
      }
    }

    depths[i] = maxDepth;
    return maxDepth;
  }

  nodes.forEach((_, i) => getDepth(i));
  return depths;
}

function renderDebug(sfmd, solvedNodes) {
  const compact = solvedNodes.map((node) => ({
    index: node.index,
    recipe: node.recipe?.Name || node.node.Name,
    machine: node.recipe?.Machine || "Unknown",
    max: node.node.Max || null,
    exactMachines: Number(node.machineCountExact.toFixed(4)),
    inputs: node.node.Inputs || {},
    outputDemands: node.outputDemands,
    warnings: node.warnings
  }));

  debugOutputEl.textContent = JSON.stringify(
    {
      sfmdNodeCount: sfmd.Data.length,
      solvedNodes: compact
    },
    null,
    2
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function readUploadedJson(file) {
  const text = await file.text();
  return JSON.parse(text);
}

function drawPreview(rows) {
  const canvasWidth = layoutCanvas.width;
  const canvasHeight = layoutCanvas.height;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = "#0c1117";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  if (!rows.length) {
    ctx.fillStyle = "#9fb0c2";
    ctx.font = "20px Arial";
    ctx.fillText("No blocks to draw yet.", 30, 50);
    return;
  }

  const padding = 30;
  const blockGapMeters = Number(blockGapInput.value || 4);

  const maxBlockWidth = Math.max(...rows.map((r) => r.block.width));
  const maxBlockLength = Math.max(...rows.map((r) => r.block.length));

  const usableWidth = canvasWidth - padding * 2;
  const usableHeight = canvasHeight - padding * 2;

  const scaleX = usableWidth / Math.max(maxBlockWidth * 4, 120);
  const scaleY = usableHeight / Math.max(maxBlockLength * 6, 120);
  const scale = Math.max(6, Math.min(scaleX, scaleY));

  const itemGapPx = blockGapMeters * scale;
  const labelLineHeight = 22;
  const labelBlockGap = 8;
  const labelLines = 4;
  const labelHeight = labelLines * labelLineHeight;

  let x = padding;
  let y = padding;
  let currentRowHeight = 0;

  for (const row of rows) {
    const drawWidth = row.block.width * scale;
    const drawHeight = row.block.length * scale;

    const line1 = row.recipeName;
    const line2 = `${row.machineName} x ${row.roundedMachines}`;
    const line3 = `${row.block.rows} x ${row.block.cols}`;
    const line4 = `${row.block.width.toFixed(1)}m x ${row.block.length.toFixed(1)}m`;

    ctx.font = "bold 16px Arial";
    const line1Width = ctx.measureText(line1).width;

    ctx.font = "14px Arial";
    const line2Width = ctx.measureText(line2).width;
    const line3Width = ctx.measureText(line3).width;
    const line4Width = ctx.measureText(line4).width;

    const labelWidth = Math.max(line1Width, line2Width, line3Width, line4Width);
    const itemWidth = Math.max(drawWidth, labelWidth);
    const itemHeight = labelHeight + labelBlockGap + drawHeight;

    if (x + itemWidth > canvasWidth - padding) {
      x = padding;
      y += currentRowHeight + itemGapPx;
      currentRowHeight = 0;
    }

    const labelX = x;
    const labelY = y;
    const rectX = x;
    const rectY = labelY + labelHeight + labelBlockGap;

    ctx.fillStyle = "#e8eef5";
    ctx.font = "bold 16px Arial";
    ctx.fillText(line1, labelX, labelY + 18);

    ctx.fillStyle = "#9fb0c2";
    ctx.font = "14px Arial";
    ctx.fillText(line2, labelX, labelY + 18 + labelLineHeight);
    ctx.fillText(line3, labelX, labelY + 18 + labelLineHeight * 2);
    ctx.fillText(line4, labelX, labelY + 18 + labelLineHeight * 3);

    ctx.fillStyle = "#243446";
    ctx.strokeStyle = "#6fc2ff";
    ctx.lineWidth = 2;
    ctx.fillRect(rectX, rectY, drawWidth, drawHeight);
    ctx.strokeRect(rectX, rectY, drawWidth, drawHeight);

    x += itemWidth + itemGapPx;
    currentRowHeight = Math.max(currentRowHeight, itemHeight);
  }
}

async function handleBuild() {
  try {
    const file = sfmdFileInput.files?.[0];
    if (!file) {
      setStatus("Choose a .sfmd file first.");
      return;
    }

    setStatus("Loading game data…");
    const gd = await loadGameData();

    setStatus("Reading uploaded file…");
    const sfmd = await readUploadedJson(file);

    if (!sfmd || !Array.isArray(sfmd.Data)) {
      throw new Error("Uploaded file does not look like a valid .sfmd save.");
    }

    setStatus("Solving machine counts…");
    const solvedNodes = solveFactory(sfmd, gd);

    const gap = Number(machineGapInput.value || 1);

    setStatus("Building grouped block estimates…");
    const rows = buildRecipeSummary(solvedNodes, gap);
    latestRows = rows;

    renderSummary(rows);
    renderTable(rows);
    renderDebug(sfmd, solvedNodes);
    drawPreview(rows);

    setStatus(`Done. Built ${rows.length} grouped recipe blocks.`);
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`);
  }
}

function handleDrawOnly() {
  drawPreview(latestRows);
}

runBtn.addEventListener("click", handleBuild);
drawBtn.addEventListener("click", handleDrawOnly);