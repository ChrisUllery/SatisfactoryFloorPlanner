const canvas = document.getElementById("plannerCanvas");
const ctx = canvas.getContext("2d");

const machineSelect = document.getElementById("machineSelect");
const addMachineBtn = document.getElementById("addMachineBtn");
const selectedInfo = document.getElementById("selectedInfo");

const FOUNDATION_SIZE = 8;
const SNAP_SIZE = 0.5;
const MIN_ZOOM = 4;
const MAX_ZOOM = 80;

let machineCatalog = {};

async function loadMachineCatalog() {
  const response = await fetch("data/machines.json");
  machineCatalog = await response.json();
}


const state = {
  camera: {
    x: 0,
    y: 0,
    zoom: 20
  },
  machines: [],
  selectedMachineIds: [],
  clipboard: [],
  dragMode: null, // "pan" | "machine" | "marquee" | null
  dragStartScreen: { x: 0, y: 0 },
  machineDragOffsets: [],
  marqueeRect: null
};

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
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
  const rotated = machine.rotation % 180 !== 0;
  return {
    width: rotated ? machine.length : machine.width,
    length: rotated ? machine.width : machine.length
  };
}

function getMachineBounds(
  machine,
  overrideX = machine.x,
  overrideY = machine.y,
  overrideRotation = machine.rotation
) {
  const rotated = overrideRotation % 180 !== 0;
  const width = rotated ? machine.length : machine.width;
  const length = rotated ? machine.width : machine.length;

  return {
    left: overrideX,
    top: overrideY,
    right: overrideX + width,
    bottom: overrideY + length,
    width,
    length
  };
}

function getMachineBufferRects(
  machine,
  overrideX = machine.x,
  overrideY = machine.y,
  overrideRotation = machine.rotation
) {
  const bounds = getMachineBounds(machine, overrideX, overrideY, overrideRotation);
  const bufferDepth = 1;

  // Short sides get the buffer tabs.
  // If width is shorter/equal, short faces are top/bottom.
  if (bounds.width <= bounds.length) {
    return [
      {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top - bufferDepth,
        bottom: bounds.top
      },
      {
        left: bounds.left,
        right: bounds.right,
        top: bounds.bottom,
        bottom: bounds.bottom + bufferDepth
      }
    ];
  }

  // Otherwise short faces are left/right.
  return [
    {
      left: bounds.left - bufferDepth,
      right: bounds.left,
      top: bounds.top,
      bottom: bounds.bottom
    },
    {
      left: bounds.right,
      right: bounds.right + bufferDepth,
      top: bounds.top,
      bottom: bounds.bottom
    }
  ];
}

function getMachineOccupiedRects(
  machine,
  overrideX = machine.x,
  overrideY = machine.y,
  overrideRotation = machine.rotation
) {
  return [
    getMachineBounds(machine, overrideX, overrideY, overrideRotation),
    ...getMachineBufferRects(machine, overrideX, overrideY, overrideRotation)
  ];
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
  const testRects = getMachineOccupiedRects(machine, testX, testY, testRotation);

  for (const other of state.machines) {
    if (other.id === machine.id) continue;
    if (ignoreIds.includes(other.id)) continue;

    const otherRects = getMachineOccupiedRects(other);

    if (rectSetsOverlap(testRects, otherRects)) {
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
    selectedInfo.innerHTML = `
      <strong>${selected.length} machines selected</strong><br>
      Ctrl+C: Copy<br>
      Ctrl+X: Cut<br>
      Ctrl+V: Paste<br>
      Delete: Remove
    `;
    return;
  }

  const machine = selected[0];
  const footprint = getMachineFootprint(machine);

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

  if (!placement) {
    return;
  }

  machine.x = placement.x;
  machine.y = placement.y;

  state.machines.push(machine);
  setSelection([machine.id]);

  updateSelectedInfo();
  draw();
}

function renderMachinePalette() {
  machineSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a machine...";
  placeholder.disabled = true;
  placeholder.selected = true;
  machineSelect.appendChild(placeholder);

  const machineNames = Object.keys(machineCatalog).sort((a, b) => a.localeCompare(b));

  for (const name of machineNames) {
    const machine = machineCatalog[name];
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${name} (${machine.width}m × ${machine.length}m)`;
    machineSelect.appendChild(option);
  }
}

addMachineBtn.addEventListener("click", () => {
  const selectedType = machineSelect.value;
  if (!selectedType) return;
  placeMachine(selectedType);
});


function drawGrid() {
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  const topLeft = screenToWorld(0, 0);
  const bottomRight = screenToWorld(width, height);

  const minorStep = SNAP_SIZE;
  const foundationStep = FOUNDATION_SIZE;

  const startXMinor = Math.floor(topLeft.x / minorStep) * minorStep;
  const endXMinor = Math.ceil(bottomRight.x / minorStep) * minorStep;
  const startYMinor = Math.floor(topLeft.y / minorStep) * minorStep;
  const endYMinor = Math.ceil(bottomRight.y / minorStep) * minorStep;

  ctx.lineWidth = 1;

  if (state.camera.zoom >= 12) {
    ctx.strokeStyle = "#16202a";

    for (let x = startXMinor; x <= endXMinor; x += minorStep) {
      const sx = worldToScreen(x, 0).x;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
      ctx.stroke();
    }

    for (let y = startYMinor; y <= endYMinor; y += minorStep) {
      const sy = worldToScreen(0, y).y;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
      ctx.stroke();
    }
  }

  const startXFoundation = Math.floor(topLeft.x / foundationStep) * foundationStep;
  const endXFoundation = Math.ceil(bottomRight.x / foundationStep) * foundationStep;
  const startYFoundation = Math.floor(topLeft.y / foundationStep) * foundationStep;
  const endYFoundation = Math.ceil(bottomRight.y / foundationStep) * foundationStep;

  ctx.strokeStyle = "#2a3947";

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
  const lines = [];

  // If it's a single long word, just keep shrinking elsewhere rather than chopping it up
  const words = text.split(" ");

  let currentLine = words[0] || "";

  for (let i = 1; i < words.length; i++) {
    const testLine = `${currentLine} ${words[i]}`;
    if (ctx.measureText(testLine).width <= maxWidth) {
      currentLine = testLine;
    } else {
      lines.push(currentLine);
      currentLine = words[i];
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  // If wrapped text is too tall, fall back to one line
  const totalHeight = lines.length * lineHeight;
  const finalLines = totalHeight <= maxHeight ? lines : [text];

  const finalHeight = finalLines.length * lineHeight;
  let y = centerY - finalHeight / 2 + lineHeight / 2;

  for (const line of finalLines) {
    ctx.fillText(line, centerX, y);
    y += lineHeight;
  }
}


function drawMachines() {
  for (const machine of state.machines) {
    const footprint = getMachineFootprint(machine);
    const screenPos = worldToScreen(machine.x, machine.y);

    const widthPx = footprint.width * state.camera.zoom;
    const heightPx = footprint.length * state.camera.zoom;

    ctx.fillStyle = machine.color;
    ctx.fillRect(screenPos.x, screenPos.y, widthPx, heightPx);

    ctx.strokeStyle = isMachineSelected(machine.id) ? "#ffd866" : "#0b0f14";
    ctx.lineWidth = isMachineSelected(machine.id) ? 3 : 1.5;
    ctx.strokeRect(screenPos.x, screenPos.y, widthPx, heightPx);

    // ---- label drawing ----
    const paddingX = 8;
    const paddingY = 8;
    const maxTextWidth = Math.max(16, widthPx - paddingX * 2);
    const maxTextHeight = Math.max(16, heightPx - paddingY * 2);

    // Base font size on on-screen machine size
    let fontSize = Math.floor(Math.min(widthPx, heightPx) * 0.18);
    fontSize = Math.max(8, Math.min(24, fontSize));

    ctx.fillStyle = "#0b0f14";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Shrink font until the label fits as either one line or wrapped lines
    while (fontSize > 8) {
      ctx.font = `${fontSize}px Arial`;

      const words = machine.type.split(" ");
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
        words.length === 1 && ctx.measureText(machine.type).width > maxTextWidth;

      if (!singleWordTooWide && widestLine <= maxTextWidth && totalHeight <= maxTextHeight) {
        break;
      }

      if (words.length === 1 && ctx.measureText(machine.type).width <= maxTextWidth) {
        break;
      }

      fontSize -= 1;
    }

    ctx.font = `${fontSize}px Arial`;

    drawWrappedMachineLabel(
      ctx,
      machine.type,
      screenPos.x + widthPx / 2,
      screenPos.y + heightPx / 2,
      maxTextWidth,
      maxTextHeight,
      fontSize
    );

    // reset defaults
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
  ctx.clearRect(0, 0, rect.width, rect.height);

  drawGrid();
  drawOrigin();
  drawMachines();
  drawMarquee();
}

function hitTestMachine(screenX, screenY) {
  const world = screenToWorld(screenX, screenY);

  for (let i = state.machines.length - 1; i >= 0; i--) {
    const machine = state.machines[i];
    const footprint = getMachineFootprint(machine);

    const inside =
      world.x >= machine.x &&
      world.x <= machine.x + footprint.width &&
      world.y >= machine.y &&
      world.y <= machine.y + footprint.length;

    if (inside) {
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

function rotatePointClockwiseAround(x, y, centerX, centerY) {
  const dx = x - centerX;
  const dy = y - centerY;

  return {
    x: centerX - dy,
    y: centerY + dx
  };
}

function buildGroupRotationProposals(machines, rotationStep = 90) {
  if (machines.length === 0) return [];

  const groupBounds = getSelectionGroupBounds(machines);
  if (!groupBounds) return [];

  const groupCenter = getBoundsCenter(groupBounds);

  return machines.map(machine => {
    const currentBounds = getMachineBounds(machine);
    const currentCenter = {
      x: currentBounds.left + currentBounds.width / 2,
      y: currentBounds.top + currentBounds.length / 2
    };

    const rotatedCenter = rotatePointClockwiseAround(
      currentCenter.x,
      currentCenter.y,
      groupCenter.x,
      groupCenter.y
    );

    const newRotation = (machine.rotation + rotationStep) % 360;
    const rotated = newRotation % 180 !== 0;
    const newWidth = rotated ? machine.length : machine.width;
    const newLength = rotated ? machine.width : machine.length;

    return {
      machine,
      x: snap(rotatedCenter.x - newWidth / 2),
      y: snap(rotatedCenter.y - newLength / 2),
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

  for (let i = 0; i < proposals.length; i++) {
    for (let j = i + 1; j < proposals.length; j++) {
      const a = proposals[i];
      const b = proposals[j];

      const aRects  = getMachineOccupiedRects(a.machine, a.x, a.y, a.rotation);
      const bRects  = getMachineOccupiedRects(b.machine, b.x, b.y, b.rotation);

      if (rectanglesOverlap(aRects, bRects)) {
        return false;
      }
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
    color: item.color
  }));

  for (const previewMachine of previewMachines) {
    for (const existing of state.machines) {
      if (rectSetsOverlap(getMachineOccupiedRects(previewMachine), getMachineOccupiedRects(existing))) {
        return false;
      }
    }
  }

  for (let i = 0; i < previewMachines.length; i++) {
    for (let j = i + 1; j < previewMachines.length; j++) {
      if (rectSetsOverlap(getMachineOccupiedRects(previewMachines[i]), getMachineOccupiedRects(previewMachines[j]))) {
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
    color: item.color
  }));

  state.machines.push(...newMachines);
  setSelection(newMachines.map(machine => machine.id));
  updateSelectedInfo();
  draw();
}

function deleteSelectedMachines() {
  if (state.selectedMachineIds.length === 0) return;

  state.machines = state.machines.filter(
    machine => !state.selectedMachineIds.includes(machine.id)
  );
  clearSelection();
  updateSelectedInfo();
  draw();
}

canvas.addEventListener("contextmenu", event => {
  event.preventDefault();
});

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
    state.camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.camera.zoom));

    const afterZoom = screenToWorld(mouseX, mouseY);

    state.camera.x += (afterZoom.x - beforeZoom.x) * state.camera.zoom;
    state.camera.y += (afterZoom.y - beforeZoom.y) * state.camera.zoom;

    draw();
  },
  { passive: false }
);

canvas.addEventListener("mousedown", event => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  state.dragStartScreen = { x: mouseX, y: mouseY };

  const hitMachine = hitTestMachine(mouseX, mouseY);

  if (event.button === 1) {
    state.dragMode = "pan";
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

  if (event.button === 0) {
    clearSelection();
    updateSelectedInfo();
    draw();
  }
});

canvas.addEventListener("mousemove", event => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  if (state.dragMode === "pan") {
    const dx = mouseX - state.dragStartScreen.x;
    const dy = mouseY - state.dragStartScreen.y;

    state.camera.x += dx;
    state.camera.y += dy;

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

    const world = screenToWorld(mouseX, mouseY);
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

          const aRects = getMachineOccupiedRects(a.machine, a.x, a.y, a.machine.rotation);
          const bRects = getMachineOccupiedRects(b.machine, b.x, b.y, b.machine.rotation);

          if (rectanglesOverlap(aRects, bRects)) {
            return null;
          }
        }
      }

      return proposals;
    }

    const proposedPositions = buildProposedPositions(deltaX, deltaY);
    if (!proposedPositions) {
      return; // just don't move if invalid
    }

    for (const proposed of proposedPositions) {
      proposed.machine.x = proposed.x;
      proposed.machine.y = proposed.y;
    }

    updateSelectedInfo();
    draw();
  }
});

window.addEventListener("mouseup", () => {
  if (state.dragMode === "marquee" && state.marqueeRect) {
    const worldRect = screenRectToWorldRect(state.marqueeRect);
    const hits = state.machines
      .filter(machine => machineIntersectsWorldRect(machine, worldRect))
      .map(machine => machine.id);

    setSelection(hits);
    state.marqueeRect = null;
    updateSelectedInfo();
    draw();
    state.dragMode = null;
    return;
  }

  state.dragMode = null;
  state.marqueeRect = null;
});

window.addEventListener("keydown", event => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const modKey = isMac ? event.metaKey : event.ctrlKey;

  if (modKey && event.key.toLowerCase() === "c") {
    event.preventDefault();
    copySelectedMachines();
    return;
  }

  if (modKey && event.key.toLowerCase() === "x") {
    event.preventDefault();
    cutSelectedMachines();
    return;
  }

  if (modKey && event.key.toLowerCase() === "v") {
    event.preventDefault();
    pasteClipboard();
    return;
  }

  const selected = getSelectedMachines();

  if (selected.length === 0) return;

  if (event.key.toLowerCase() === "r") {
    event.preventDefault();

    const ignoreIds = selected.map(machine => machine.id);
    const proposals = buildGroupRotationProposals(selected, 90);

    if (!canApplyMachineProposals(proposals, ignoreIds)) {
      return;
    }

    for (const proposal of proposals) {
      proposal.machine.x = proposal.x;
      proposal.machine.y = proposal.y;
      proposal.machine.rotation = proposal.rotation;
    }

    updateSelectedInfo();
    draw();
    return;
  }


  if (event.key === "Delete" || event.key === "Backspace") {
    deleteSelectedMachines();
  }
});

window.addEventListener("resize", resizeCanvas);

loadMachineCatalog().then(() => {
  renderMachinePalette();
  resizeCanvas();
  updateSelectedInfo();
});