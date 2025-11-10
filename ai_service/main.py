import os
from typing import List, Optional, Dict, Any

import jwt
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

# ---- Config ----
JWT_SECRET = os.getenv("JWT_SECRET", "dev_secret")

app = FastAPI(title="AI Whiteboard Service")

# ---- Models ----
class TidyReq(BaseModel):
    shapes: List[Dict[str, Any]]
    selectedIds: Optional[List[str]] = None

class FlowReq(BaseModel):
    text: str
    color: Optional[str] = "#2b2b2b"

# ---- Auth helper (validates Node-issued JWT passed in X-JWT) ----
def verify_user(x_jwt: Optional[str]):
    if not x_jwt:
        raise HTTPException(status_code=401, detail="auth_required")
    try:
        return jwt.decode(x_jwt, JWT_SECRET, algorithms=["HS256"])  # { uid, email, name }
    except Exception:
        raise HTTPException(status_code=401, detail="invalid_token")

# ---- Health ----
@app.get("/health")
def health():
    return {"ok": True}

# ---- Endpoints ----
@app.post("/ai/flow")
def ai_flow(req: FlowReq, x_jwt: Optional[str] = Header(default=None)):
    verify_user(x_jwt)
    text = (req.text or "").strip()
    if not text:
        return {"shapes": []}
    # Accept either lines or A -> B -> C
    parts = (
        [p.strip() for p in text.split("->") if p.strip()]
        if "->" in text
        else [p.strip() for p in text.replace(",", "\n").splitlines() if p.strip()]
    )
    w, h, gap = 160, 60, 80
    x, y = 100, 100
    nodes = []
    arrows = []
    for i, label in enumerate(parts):
        nid = f"py_node_{i}"
        nodes.append({
            "id": nid,
            "type": "rect",
            "x": x,
            "y": y + i * (h + gap),
            "w": w,
            "h": h,
            "stroke": req.color,
            "text": label,
        })
        if i > 0:
            prev_y = y + (i - 1) * (h + gap)
            arrows.append({
                "id": f"py_arr_{i}",
                "type": "arrow",
                "from": {"x": x + w / 2, "y": prev_y + h},
                "to": {"x": x + w / 2, "y": y + i * (h + gap)},
                "stroke": req.color,
            })
    return {"shapes": nodes + arrows}

@app.post("/ai/tidy")
def ai_tidy(req: TidyReq, x_jwt: Optional[str] = Header(default=None)):
    verify_user(x_jwt)
    ids = req.selectedIds or []
    all_shapes = req.shapes or []
    if not all_shapes:
        return {"shapes": all_shapes}
    # pick nodes (skip arrows/strokes)
    selected = [
        s for s in all_shapes
        if (not ids or s.get("id") in ids) and s.get("type") not in ("arrow", "stroke")
    ]
    if len(selected) < 2:
        return {"shapes": all_shapes}
    grid = 10
    # Snap & sort by x
    for n in selected:
        n["x"] = round(n.get("x", 0) / grid) * grid
        n["y"] = round(n.get("y", 0) / grid) * grid
    selected.sort(key=lambda n: n.get("x", 0))
    min_x = selected[0].get("x", 0)
    max_x = selected[-1].get("x", 0)
    total_w = sum(n.get("w", 120) for n in selected)
    span = max(max_x - min_x, grid * (len(selected) - 1))
    gap = max(grid, round((span - (total_w - (len(selected) * grid))) / max(1, len(selected) - 1)))
    cursor = selected[0].get("x", 0)
    for n in selected:
        n["x"] = cursor
        cursor += n.get("w", 120) + gap
    return {"shapes": all_shapes}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
