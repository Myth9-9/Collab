// Simple, local "AI-like" helpers (no network / API keys)
export function tidyLayout(shapes, selectedIds) {
  const ids = selectedIds.size ? [...selectedIds] : shapes.map((s) => s.id);
  if (ids.length < 2) return { shapes };
  const nodes = shapes.filter(
    (s) => ids.includes(s.id) && s.type !== "arrow" && s.type !== "stroke"
  );
  if (!nodes.length) return { shapes };
  // Snap to grid & even spacing horizontally by x
  const grid = 10;
  nodes.forEach((n) => {
    n.x = Math.round(n.x / grid) * grid;
    n.y = Math.round(n.y / grid) * grid;
  });
  nodes.sort((a, b) => a.x - b.x);
  let minX = nodes[0].x,
    maxX = nodes[nodes.length - 1].x;
  const totalWidth = nodes.reduce((acc, n) => acc + (n.w || 120), 0);
  const span = Math.max(maxX - minX, grid * (nodes.length - 1));
  const gap = Math.max(
    grid,
    Math.round(
      (span - (totalWidth - nodes.length * grid)) /
        Math.max(1, nodes.length - 1)
    )
  );
  let cursor = nodes[0].x;
  nodes.forEach((n) => {
    n.x = cursor;
    cursor += (n.w || 120) + gap;
  });
  return { shapes };
}

export function flowFromText(input, color = "#2b2b2b") {
  // Accept either lines or A -> B -> C
  const cleaned = input.trim();
  if (!cleaned) return [];
  const parts = cleaned.includes("->")
    ? cleaned
        .split("->")
        .map((s) => s.trim())
        .filter(Boolean)
    : cleaned
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean);
  const nodes = [],
    arrows = [];
  const w = 160,
    h = 60,
    gap = 80;
  let x = 100,
    y = 100;
  for (let i = 0; i < parts.length; i++) {
    const id = `node_${i}_${Date.now()}`;
    nodes.push({
      id,
      type: "rect",
      x,
      y: y + i * (h + gap),
      w,
      h,
      stroke: color,
      text: parts[i],
    });
    if (i > 0) {
      const prev = nodes[i - 1];
      arrows.push({
        id: `arr_${i}_${Date.now()}`,
        type: "arrow",
        from: { x: prev.x + w / 2, y: prev.y + h },
        to: { x: x + w / 2, y: y + i * (h + gap) },
        stroke: color,
      });
    }
  }
  return [...nodes, ...arrows];
}
