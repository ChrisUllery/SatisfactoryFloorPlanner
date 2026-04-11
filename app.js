const canvas = document.getElementById("plannerCanvas");
const ctx = canvas.getContext("2d");

const addSmelterBtn = document.getElementById("addSmelterBtn");
const selectedInfo = document.getElementById("selectedInfo");

const FOUNDATION_SIZE = 8;      // 8m x 8m
const SNAP_SIZE = 0.5;          // half-meter snap
const MIN_ZOOM = 4;
const MAX_ZOOM = 80;

const machineCatalog = {
  Smelter: {
    name: "Smelter",
    width: 9,
    height: 6,
    color: "#7a8da1"
  }
};

const state = {
  camera: {
    x: 0,
    y: 0,
    zoom: 20 // pixels per meter
  },
  machines: [],
  selectedMachineId: null,
  dragMode: null, // "pan" | "machine" | null
  dragStartScreen: { x: 0, y: 0 },
  dragStartWorld: { x: 0, y: 0 },
  machineDragOffset: { x: 0, y: 0 }
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

function getMachineById(id) {
  return state.machines.find(m => m.id === id) || null;
}

function getSelectedMachine() {
  return getMachineById(state.selectedMachineId);
}

function updateSelectedInfo() {
  const machine = getSelectedMachine();
  if (!machine) {
    selectedInfo.textContent = "None";
    return;
  }

  selectedInfo.innerHTML = `
    <strong>${machine.type}</strong><br>
    X: ${machine.x.toFixed(1)} m<br>
    Y: ${machine.y.toFixed(1)} m<br>
    Rotation: ${machine.rotation}°
  `;
}

function createMachine(type, x, y) {
  const def = machineCatalog[type];
  const id = crypto.randomUUID();

  return {
    id,
    type: def.name,
    x,
    y,
    width: def.width,
    height: def.height,
    rotation: 0,
    color: def.color
  };
}

function getMachineFootprint(machine) {
  const rotated = machine.rotation % 180 !== 0;
  return {
    width: rotated ? machine.height : machine.width,
    height: rotated ? machine.width : machine.height
  };
}

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

  // Minor snap grid
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

  // Foundation grid
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

function drawMachines() {
  for (const machine of state.machines) {
    const footprint = getMachineFootprint(machine);
    const screenPos = worldToScreen(machine.x, machine.y);

    const w = footprint.width * state.camera.zoom;
    const h = footprint.height * state.camera.zoom;

    ctx.fillStyle = machine.color;
    ctx.fillRect(screenPos.x, screenPos.y, w, h);

    ctx.strokeStyle = machine.id === state.selectedMachineId ? "#ffd866" : "#0b0f14";
    ctx.lineWidth = machine.id === state.selectedMachineId ? 3 : 1.5;
    ctx.strokeRect(screenPos.x, screenPos.y, w, h);

    ctx.fillStyle = "#0b0f14";
    ctx.font = "12px Arial";
    ctx.fillText(machine.type, screenPos.x + 8, screenPos.y + 18);
  }
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);

  drawGrid();
  drawOrigin();
  drawMachines();
}

function hitTestMachine(screenX, screenY) {
  const world = screenToWorld(screenX, screenY);

  for (let i = state.machines.length - 1; i >= 0; i--) {
    const machine = state.machines[i];
    const footprint = getMachineFootprint(machine);

    if (
      world.x >= machine.x &&
      world.x <= machine.x + footprint.width &&
      world.y >= machine.y &&
      world.y <= machine.y + footprint.height
    ) {
      return machine;
    }
  }

  return null;
}

addSmelterBtn.addEventListener("click", () => {
  const rect = canvas.getBoundingClientRect();
  const centerWorld = screenToWorld(rect.width / 2, rect.height / 2);
  const snapped = snapPosition(centerWorld.x, centerWorld.y);

  const machine = createMachine("Smelter", snapped.x, snapped.y);
  state.machines.push(machine);
  state.selectedMachineId = machine.id;
  updateSelectedInfo();
  draw();
});

canvas.addEventListener("wheel", (event) => {
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
}, { passive: false });

canvas.addEventListener("mousedown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;

  state.dragStartScreen = { x: mouseX, y: mouseY };

  const hitMachine = hitTestMachine(mouseX, mouseY);

  if (event.button === 1) {
    state.dragMode = "pan";
    return;
  }

  if (event.button === 0 && hitMachine) {
    state.selectedMachineId = hitMachine.id;

    const world = screenToWorld(mouseX, mouseY);
    state.machineDragOffset = {
      x: world.x - hitMachine.x,
      y: world.y - hitMachine.y
    };

    state.dragMode = "machine";
    updateSelectedInfo();
    draw();
    return;
  }

  if (event.button === 0) {
    state.selectedMachineId = null;
    updateSelectedInfo();
    draw();
  }
});

canvas.addEventListener("mousemove", (event) => {
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

  if (state.dragMode === "machine") {
    const machine = getSelectedMachine();
    if (!machine) return;

    const world = screenToWorld(mouseX, mouseY);
    const snapped = snapPosition(
      world.x - state.machineDragOffset.x,
      world.y - state.machineDragOffset.y
    );

    machine.x = snapped.x;
    machine.y = snapped.y;

    updateSelectedInfo();
    draw();
  }
});

window.addEventListener("mouseup", () => {
  state.dragMode = null;
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "r") {
    const machine = getSelectedMachine();
    if (!machine) return;

    machine.rotation = (machine.rotation + 90) % 360;
    updateSelectedInfo();
    draw();
  }
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
updateSelectedInfo();