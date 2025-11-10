// CLEAN APP.JS — realtime collab whiteboard + local AI helpers
// Works with the minimal Node + Socket.IO server.
// If you added auth: switch fetch() to include credentials and Socket.IO to withCredentials:true.

import { tidyLayout, flowFromText } from "./ai.js";

// ---- DOM refs
const $ = (sel) => document.querySelector(sel);
const boardEl = $("#board");
const ctx = boardEl.getContext("2d");
const toolEl = $("#tool");
const strokeEl = $("#stroke");
const thickEl = $("#thickness");
const undoEl = $("#undo");
const redoEl = $("#redo");
const tidyEl = $("#tidy");
const exportEl = $("#export");
const shareEl = $("#share");
const aiInput = $("#ai-input");
const aiGen = $("#ai-generate");

// ---- Board ID from URL
const params = new URLSearchParams(location.search);
const boardId = params.get("board") || "default";
shareEl.href = `${location.origin}/?board=${boardId}`;

// ---- User & presence color
function randHex() {
  return (
    "#" +
    Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, "0")
  );
}
const me = { id: crypto.randomUUID(), name: "User", color: randHex() };

// ---- Socket.IO (no credentials)
const socket = io(); // if auth enabled: const socket = io({ withCredentials: true });
socket.emit("join", { board: boardId, user: me });

// ---- State
let shapes = []; // stroke | rect | ellipse | arrow | text
let selected = new Set();
let history = [];
let future = [];
let camera = { x: 0, y: 0, z: 1 };

let isPanning = false;
let panStart = null;

const cursors = new Map();
const wrapper = document.getElementById("stage-wrapper");

// ---- Presence cursors
function addCursor(id, color, name = "Guest") {
  const d = document.createElement("div");
  d.className = "cursor";
  d.style.border = `1px solid ${color}`;
  d.textContent = name;
  wrapper.appendChild(d);
  cursors.set(id, d);
}
function rmCursor(id) {
  const d = cursors.get(id);
  if (d) d.remove();
  cursors.delete(id);
}

socket.on("presence:join", ({ id, user }) =>
  addCursor(id, user?.color || "#888", user?.name || "Guest")
);
socket.on("presence:leave", ({ id }) => rmCursor(id));

// ---- Helpers
function toCanvasCoords(clientX, clientY) {
  const rect = boardEl.getBoundingClientRect();
  const x = (clientX - rect.left) / camera.z - camera.x;
  const y = (clientY - rect.top) / camera.z - camera.y;
  return { x, y };
}

function drawArrow(s) {
  const { from, to } = s;
  ctx.beginPath();
  ctx.moveTo(from.x + camera.x, from.y + camera.y);
  ctx.lineTo(to.x + camera.x, to.y + camera.y);
  ctx.strokeStyle = s.stroke || "#2b2b2b";
  ctx.lineWidth = s.thickness || 3;
  ctx.stroke();
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 10;
  ctx.beginPath();
  ctx.moveTo(to.x + camera.x, to.y + camera.y);
  ctx.lineTo(
    to.x + camera.x - size * Math.cos(angle - Math.PI / 6),
    to.y + camera.y - size * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    to.x + camera.x - size * Math.cos(angle + Math.PI / 6),
    to.y + camera.y - size * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fillStyle = s.stroke || "#2b2b2b";
  ctx.fill();
}

function drawTextCentered(s) {
  ctx.save();
  ctx.font = "16px system-ui";
  ctx.fillStyle = s.stroke || "#e6e7eb";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    s.text || "",
    s.x + camera.x + s.w / 2,
    s.y + camera.y + s.h / 2
  );
  ctx.restore();
}

function drawAll() {
  const { width, height } = boardEl;
  ctx.setTransform(camera.z, 0, 0, camera.z, 0, 0);
  ctx.clearRect(0, 0, width, height);

  // grid
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.strokeStyle = "#141827";
  ctx.lineWidth = 1;
  for (let gx = -2000; gx < 4000; gx += 20) {
    ctx.beginPath();
    ctx.moveTo(gx, -2000);
    ctx.lineTo(gx, 4000);
    ctx.stroke();
  }
  for (let gy = -2000; gy < 4000; gy += 20) {
    ctx.beginPath();
    ctx.moveTo(-2000, gy);
    ctx.lineTo(4000, gy);
    ctx.stroke();
  }

  // shapes
  for (const s of shapes) {
    ctx.strokeStyle = s.stroke || "#2b2b2b";
    ctx.fillStyle = s.fill || "transparent";
    ctx.lineWidth = s.thickness || 3;

    if (s.type === "stroke") {
      ctx.beginPath();
      for (let i = 0; i < s.points.length; i++) {
        const p = s.points[i];
        if (i === 0) ctx.moveTo(p.x + camera.x, p.y + camera.y);
        else ctx.lineTo(p.x + camera.x, p.y + camera.y);
      }
      ctx.stroke();
    } else if (s.type === "rect") {
      ctx.strokeRect(s.x + camera.x, s.y + camera.y, s.w, s.h);
      if (s.text) drawTextCentered(s);
    } else if (s.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(
        s.x + camera.x + s.w / 2,
        s.y + camera.y + s.h / 2,
        Math.abs(s.w / 2),
        Math.abs(s.h / 2),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      if (s.text) drawTextCentered(s);
    } else if (s.type === "arrow") {
      drawArrow(s);
    } else if (s.type === "text") {
      ctx.font = "16px system-ui";
      ctx.fillStyle = s.stroke || "#e6e7eb";
      ctx.fillText(s.text || "", s.x + camera.x, s.y + camera.y);
    }

    if (selected.has(s.id) && s.type !== "stroke") {
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "#7aa2ff";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        s.x + camera.x - 6,
        s.y + camera.y - 6,
        (s.w || 0) + 12,
        (s.h || 0) + 12
      );
      ctx.restore();
    }
  }
  ctx.restore();
}

function pushHistory() {
  history.push(JSON.stringify(shapes));
  if (history.length > 100) history.shift();
  future.length = 0;
}
function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(shapes));
  shapes = JSON.parse(history.pop());
  drawAll();
  socket.emit("wb:undo", {});
}
function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(shapes));
  shapes = JSON.parse(future.pop());
  drawAll();
  socket.emit("wb:redo", {});
}

// ---- Interaction state
let drawing = null;

// mousedown
boardEl.addEventListener("mousedown", (e) => {
  if (e.button === 2) {
    // right button: pan
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
    return;
  }
  const { x, y } = toCanvasCoords(e.clientX, e.clientY);
  const tool = toolEl.value;

  if (tool === "select") {
    const box = document.createElement("div");
    box.className = "selbox";
    wrapper.appendChild(box);
    drawing = {
      type: "selbox",
      el: box,
      start: { x: e.clientX, y: e.clientY },
    };
  } else if (tool === "pen") {
    const s = {
      type: "stroke",
      id: crypto.randomUUID(),
      points: [{ x, y }],
      stroke: strokeEl.value,
      thickness: +thickEl.value,
    };
    shapes.push(s);
    pushHistory();
    drawAll();
    socket.emit("wb:add", s);
    drawing = s;
  } else if (tool === "rect" || tool === "ellipse") {
    const s = {
      type: tool,
      id: crypto.randomUUID(),
      x,
      y,
      w: 0,
      h: 0,
      stroke: strokeEl.value,
      thickness: +thickEl.value,
      text: "",
    };
    shapes.push(s);
    pushHistory();
    drawAll();
    socket.emit("wb:add", s);
    drawing = s;
  } else if (tool === "arrow") {
    const s = {
      type: "arrow",
      id: crypto.randomUUID(),
      from: { x, y },
      to: { x, y },
      stroke: strokeEl.value,
      thickness: +thickEl.value,
    };
    shapes.push(s);
    pushHistory();
    drawAll();
    socket.emit("wb:add", s);
    drawing = s;
  } else if (tool === "text") {
    const text = prompt("Text:");
    if (!text) return;
    const s = {
      type: "rect",
      id: crypto.randomUUID(),
      x: x - 80,
      y: y - 30,
      w: 160,
      h: 60,
      stroke: strokeEl.value,
      thickness: +thickEl.value,
      text,
    };
    shapes.push(s);
    pushHistory();
    drawAll();
    socket.emit("wb:add", s);
  }
});

// mousemove
boardEl.addEventListener("mousemove", (e) => {
  // presence cursor
  socket.emit("wb:cursor", {
    id: me.id,
    color: me.color,
    x: e.clientX,
    y: e.clientY,
  });
  const mine = cursors.get(socket.id);
  if (mine) {
    mine.style.left = e.clientX + "px";
    mine.style.top = e.clientY + "px";
    mine.style.borderColor = me.color;
    mine.textContent = "You";
  }

  if (isPanning && panStart) {
    camera.x = panStart.cx + (e.clientX - panStart.x) / camera.z;
    camera.y = panStart.cy + (e.clientY - panStart.y) / camera.z;
    drawAll();
    socket.emit("wb:viewport", camera);
    return;
  }

  if (!drawing) return;

  const { x, y } = toCanvasCoords(e.clientX, e.clientY);

  if (drawing.type === "selbox") {
    const r = {
      left: Math.min(drawing.start.x, e.clientX),
      top: Math.min(drawing.start.y, e.clientY),
      width: Math.abs(e.clientX - drawing.start.x),
      height: Math.abs(e.clientY - drawing.start.y),
    };
    Object.assign(drawing.el.style, {
      left: r.left + "px",
      top: r.top + "px",
      width: r.width + "px",
      height: r.height + "px",
    });
    return;
  }

  if (drawing.type === "stroke") {
    drawing.points.push({ x, y });
    drawAll();
    socket.emit("wb:update", drawing);
    return;
  }
  if (drawing.type === "rect" || drawing.type === "ellipse") {
    drawing.w = x - drawing.x;
    drawing.h = y - drawing.y;
    drawAll();
    socket.emit("wb:update", drawing);
    return;
  }
  if (drawing.type === "arrow") {
    drawing.to = { x, y };
    drawAll();
    socket.emit("wb:update", drawing);
    return;
  }
});

// mouseup
boardEl.addEventListener("mouseup", () => {
  if (isPanning) {
    isPanning = false;
    panStart = null;
    return;
  }
  if (!drawing) return;

  if (drawing.type === "selbox") {
    const rect = drawing.el.getBoundingClientRect();
    drawing.el.remove();
    const min = toCanvasCoords(rect.left, rect.top);
    const max = toCanvasCoords(rect.right, rect.bottom);
    selected.clear();
    for (const s of shapes) {
      const sx = s.x ?? Math.min(s.from?.x || 0, s.to?.x || 0);
      const sy = s.y ?? Math.min(s.from?.y || 0, s.to?.y || 0);
      const sw = s.w ?? Math.abs((s.to?.x || 0) - (s.from?.x || 0));
      const sh = s.h ?? Math.abs((s.to?.y || 0) - (s.from?.y || 0));
      if (sx >= min.x && sy >= min.y && sx + sw <= max.x && sy + sh <= max.y)
        selected.add(s.id);
    }
    drawAll();
  }
  drawing = null;
});

// contextmenu block
boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

// wheel zoom
boardEl.addEventListener("wheel", (e) => {
  const factor = Math.sign(e.deltaY) > 0 ? 0.9 : 1.1;
  camera.z = Math.min(4, Math.max(0.25, camera.z * factor));
  drawAll();
  socket.emit("wb:viewport", camera);
});

// click selection
boardEl.addEventListener("click", (e) => {
  if (toolEl.value !== "select") return;
  const { x, y } = toCanvasCoords(e.clientX, e.clientY);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === "stroke") continue;
    const sx = s.x;
    const sy = s.y;
    const sw = s.w;
    const sh = s.h;
    if (x >= sx && y >= sy && x <= sx + sw && y <= sy + sh) {
      if (e.shiftKey) {
        if (selected.has(s.id)) selected.delete(s.id);
        else selected.add(s.id);
      } else {
        selected.clear();
        selected.add(s.id);
      }
      drawAll();
      return;
    }
  }
  selected.clear();
  drawAll();
});

// keyboard
window.addEventListener("keydown", (e) => {
  if (e.key === "Delete") {
    if (!selected.size) return;
    pushHistory();
    shapes = shapes.filter((s) => !selected.has(s.id));
    socket.emit("wb:delete", { ids: [...selected] });
    selected.clear();
    drawAll();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey)
    undo();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && e.shiftKey)
    redo();
});

// buttons
undoEl.onclick = undo;
redoEl.onclick = redo;
tidyEl.onclick = () => {
  pushHistory();
  tidyLayout(shapes, selected);
  drawAll();
  socket.emit("wb:update", { bulk: true, shapes });
};
exportEl.onclick = () => {
  const link = document.createElement("a");
  link.download = `whiteboard-${boardId}.png`;
  link.href = boardEl.toDataURL("image/png");
  link.click();
};
aiGen.onclick = () => {
  const txt = aiInput.value;
  if (!txt.trim()) return;
  const newShapes = flowFromText(txt, strokeEl.value);
  if (!newShapes.length) return;
  pushHistory();
  shapes.push(...newShapes);
  drawAll();
  socket.emit("wb:add", { bulk: true, shapes: newShapes });
};

// socket handlers
const handlers = {
  "wb:add": (s) => {
    if (s.bulk) shapes.push(...s.shapes);
    else shapes.push(s);
    drawAll();
  },
  "wb:update": () => {
    drawAll();
  },
  "wb:delete": ({ ids }) => {
    shapes = shapes.filter((x) => !ids.includes(x.id));
    drawAll();
  },
  "wb:undo": () => {
    drawAll();
  },
  "wb:redo": () => {
    drawAll();
  },
  "wb:cursor": ({ id, color, x, y }) => {
    if (!cursors.has(id)) addCursor(id, color, "Guest");
    const d = cursors.get(id);
    d.style.left = x + "px";
    d.style.top = y + "px";
    d.style.borderColor = color;
  },
  "wb:viewport": () => {},
  "wb:syncState": (state) => {
    shapes = state || [];
    drawAll();
  },
};
[
  "wb:add",
  "wb:update",
  "wb:delete",
  "wb:undo",
  "wb:redo",
  "wb:cursor",
  "wb:viewport",
  "wb:syncState",
].forEach((evt) => socket.on(evt, (p) => handlers[evt]?.(p)));

// init
addCursor(socket.id, me.color, "You");
function sizeCanvas() {
  boardEl.width = wrapper.clientWidth;
  boardEl.height = wrapper.clientHeight;
  drawAll();
}
window.addEventListener("resize", sizeCanvas);
sizeCanvas();
