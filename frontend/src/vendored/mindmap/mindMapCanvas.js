import {
  boundsOf,
  branchPath,
  cubicBezier,
  overviewTransform,
  revealTransform,
} from "@/lib/mindMapLayout";

/**
 * The mind map's motion: the pan/zoom viewport, and the animation that carries
 * every node from where it is drawn to where the layout wants it.
 *
 * It writes straight to the DOM — a transform per node, a `d` per branch, one
 * transform on the world — once per animation frame, so a few hundred nodes move
 * without React rendering anything while they do. React decides WHAT is drawn;
 * this decides WHERE.
 *
 * How things move:
 *   - a node that stays glides from where it is to its new place;
 *   - a node that appears grows out of its parent's toggle, riding along with the
 *     parent if that is moving too, each new generation a beat after the last;
 *   - a node that disappears folds back into the nearest ancestor that stays, and
 *     only then is it removed (`onSettled`);
 *   - one node — the one just toggled, else the root — is held still and the rest
 *     of the map rearranges around it, so what is under the pointer stays there.
 */

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
/** Half the toggle's height: branches leave from the toggle's far side. */
export const TOGGLE_RADIUS = 10;

const MOVE_MS = 560;
const EXIT_MS = 380;
const STAGGER_MS = 55;
const VIEW_MS = 480;
const ENTER_SCALE = 0.55;
const DRAG_THRESHOLD = 4;
const GRID = 22;

const easeMove = cubicBezier(0.2, 0.8, 0.2, 1);
const easeView = cubicBezier(0.4, 0, 0.2, 1);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (a, b, t) => a + (b - a) * t;
const round = (value, places = 2) => {
  const f = 10 ** places;
  return Math.round(value * f) / f;
};

const mixState = (from, to, t) => ({
  x: mix(from.x, to.x, t),
  y: mix(from.y, to.y, t),
  s: mix(from.s, to.s, t),
  o: mix(from.o, to.o, t),
});

const settledAt = (a, b) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.s - b.s) < 0.001 && Math.abs(a.o - b.o) < 0.001;

function sameTargets(a, b) {
  if (a.size !== b.size) return false;
  for (const [id, t] of a) {
    const u = b.get(id);
    if (!u || u.x !== t.x || u.y !== t.y || u.w !== t.w || u.h !== t.h) return false;
  }
  return true;
}

// Where a child of `parent` is born and where it folds back to: its left edge on
// the parent's toggle, vertically centred on the parent, shrunk and transparent.
function socket(parent, height) {
  if (!parent) return null;
  return {
    x: parent.x + parent.w * parent.s,
    y: parent.y + (parent.h - height) / 2,
    s: ENTER_SCALE,
    o: 0,
  };
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const requestFrame = (callback) =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : setTimeout(() => callback(now()), 16);
const cancelFrame = (handle) =>
  typeof cancelAnimationFrame === "function" ? cancelAnimationFrame(handle) : clearTimeout(handle);
const prefersReducedMotion = () =>
  typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

export function createMindMapCanvas() {
  let container = null;
  let world = null;
  let grid = null;
  let onSettled = null;

  let nodeEls = new Map();
  let edgeEls = new Map();
  let links = [];
  let roots = [];

  let current = new Map(); // id → { x, y, s, o, w, h } as last drawn
  let targets = new Map(); // id → { x, y, w, h } where the layout wants it
  let plan = [];
  let planStart = 0;
  let planExits = "";

  let view = { x: 0, y: 0, k: 1 };
  let viewAnim = null;
  let viewport = { width: 0, height: 0 };
  let placed = false;
  let frame = 0;

  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let gestureZoom = null;
  let suppressClick = false;
  let resizeObserver = null;
  let unlisten = () => {};

  // ── Drawing ──────────────────────────────────────────────────────────────────

  function paint() {
    for (const [id, s] of current) {
      const el = nodeEls.get(id);
      if (!el) continue;
      el.style.transform =
        s.s === 1
          ? `translate3d(${round(s.x)}px, ${round(s.y)}px, 0)`
          : `translate3d(${round(s.x)}px, ${round(s.y)}px, 0) scale(${round(s.s, 3)})`;
      el.style.opacity = s.o >= 0.999 ? "" : String(round(s.o, 3));
    }
    for (const link of links) {
      const el = edgeEls.get(link.child);
      const child = current.get(link.child);
      const parent = current.get(link.parent);
      if (!el || !child || !parent) continue;
      el.setAttribute(
        "d",
        branchPath(
          parent.x + (parent.w + TOGGLE_RADIUS) * parent.s,
          parent.y + parent.h / 2,
          child.x,
          child.y + child.h / 2,
        ),
      );
      const o = Math.min(child.o, parent.o);
      el.style.opacity = o >= 0.999 ? "" : String(round(o, 3));
    }
  }

  function applyView() {
    if (world) world.style.transform = `translate(${round(view.x)}px, ${round(view.y)}px) scale(${round(view.k, 4)})`;
    if (grid) {
      const size = GRID * view.k;
      grid.style.backgroundSize = `${round(size)}px ${round(size)}px`;
      grid.style.backgroundPosition = `${round(view.x)}px ${round(view.y)}px`;
      // Zoomed far out the dots crowd into a haze; let them go.
      grid.style.opacity = view.k < 0.5 ? String(round(clamp01((view.k - 0.3) / 0.2), 3)) : "";
    }
  }

  function schedule() {
    if (!frame) frame = requestFrame(tick);
  }

  function tick(time) {
    frame = 0;
    const t = typeof time === "number" ? time : now();
    let busy = false;
    if (plan.length) busy = stepNodes(t) || busy;
    if (viewAnim) busy = stepView(t) || busy;
    if (busy) schedule();
  }

  // ── Node motion ──────────────────────────────────────────────────────────────

  function stepNodes(time) {
    const elapsed = time - planStart;
    const next = new Map();
    let running = false;
    // `plan` is parent-first, so an anchor's position for THIS frame is already
    // known when its children need it.
    for (const entry of plan) {
      const span = entry.kind === "exit" ? EXIT_MS : MOVE_MS;
      const p = clamp01((elapsed - entry.delay) / span);
      if (p < 1) running = true;
      const e = easeMove(p);
      let state;
      if (entry.kind === "move") {
        state = mixState(entry.from, entry.to, e);
      } else if (entry.kind === "enter") {
        const from = socket(next.get(entry.anchor), entry.h) || { ...entry.to, s: ENTER_SCALE, o: 0 };
        state = mixState(from, entry.to, e);
        state.o = easeMove(clamp01(p / 0.55));
      } else {
        const to = socket(next.get(entry.anchor), entry.h) || { ...entry.from, s: ENTER_SCALE, o: 0 };
        state = mixState(entry.from, to, e);
        state.o = entry.from.o * (1 - clamp01(p / 0.7));
      }
      state.w = entry.w;
      state.h = entry.h;
      next.set(entry.id, state);
    }
    current = next;
    paint();
    if (!running) settle();
    return running;
  }

  function settle() {
    const exited = plan.filter((entry) => entry.kind === "exit");
    for (const entry of exited) current.delete(entry.id);
    plan = [];
    planExits = "";
    if (exited.length) onSettled?.();
  }

  /**
   * Lay the map out anew. `scene.positions` is the fresh layout (top-left corners,
   * map coordinates); `scene.order` is parent-first; `scene.exiting` names what
   * just left, with the ancestor each should fold into.
   */
  function update(scene) {
    nodeEls = scene.nodeEls;
    edgeEls = scene.edgeEls;
    links = scene.links;
    roots = scene.roots;
    measureViewport();

    // Hold one node still, measured against where it was GOING rather than where
    // it is mid-flight, so an interrupted animation keeps its destination.
    const reference = (id) => targets.get(id) || current.get(id);
    const pin = [scene.pin, ...scene.roots].find(
      (id) => id != null && scene.positions.has(id) && reference(id),
    );
    let dx = 0;
    let dy = 0;
    if (pin) {
      const held = reference(pin);
      const fresh = scene.positions.get(pin);
      dx = held.x - fresh.x;
      dy = held.y - fresh.y;
    }
    const nextTargets = new Map();
    for (const [id, p] of scene.positions) {
      nextTargets.set(id, { x: Math.round(p.x + dx), y: Math.round(p.y + dy), w: p.width, h: p.height });
    }

    const exits = scene.exiting.filter(({ id }) => current.has(id));
    const exitKey = exits.map(({ id }) => id).join("|");
    // A pass that moves nothing — a re-render, a re-measure — must not restart an
    // animation already under way.
    if (sameTargets(nextTargets, targets) && exitKey === planExits && current.size) {
      if (!plan.length) paint();
      place();
      return;
    }

    const isNew = (id) => !current.has(id);
    const nextPlan = [];
    for (const id of scene.order) {
      const t = nextTargets.get(id);
      const to = { x: t.x, y: t.y, s: 1, o: 1 };
      const was = current.get(id);
      if (was) {
        nextPlan.push({ id, kind: "move", from: { x: was.x, y: was.y, s: was.s, o: was.o }, to, w: t.w, h: t.h, delay: 0 });
        continue;
      }
      const parent = scene.parentOf.get(id);
      if (parent == null) {
        nextPlan.push({ id, kind: "move", from: { ...to, s: 0.9, o: 0 }, to, w: t.w, h: t.h, delay: 0 });
        continue;
      }
      let generation = 0;
      for (let up = parent; up != null && isNew(up); up = scene.parentOf.get(up)) generation += 1;
      nextPlan.push({
        id,
        kind: "enter",
        anchor: parent,
        to,
        w: t.w,
        h: t.h,
        delay: Math.min(generation, 6) * STAGGER_MS,
      });
    }
    for (const { id, anchor } of exits) {
      const was = current.get(id);
      nextPlan.push({
        id,
        kind: "exit",
        from: { x: was.x, y: was.y, s: was.s, o: was.o },
        anchor,
        w: was.w,
        h: was.h,
        delay: 0,
      });
    }

    targets = nextTargets;
    plan = nextPlan;
    planExits = exitKey;

    const still = plan.every((entry) => entry.kind === "move" && settledAt(entry.from, entry.to));
    if (still || prefersReducedMotion()) {
      planStart = -Infinity;
      stepNodes(now());
    } else {
      planStart = now();
      stepNodes(planStart);
      schedule();
    }
    place();
  }

  // ── Viewport ─────────────────────────────────────────────────────────────────

  function measureViewport() {
    if (!container) return;
    viewport = { width: container.clientWidth, height: container.clientHeight };
  }

  function setView(next, duration = VIEW_MS) {
    const to = { x: next.x, y: next.y, k: clamp(next.k, MIN_ZOOM, MAX_ZOOM) };
    if (!duration || prefersReducedMotion() || !viewport.width) {
      viewAnim = null;
      view = to;
      applyView();
      return;
    }
    viewAnim = { from: { ...view }, to, start: now(), duration };
    schedule();
  }

  function stepView(time) {
    const { from, to, start, duration } = viewAnim;
    const p = clamp01((time - start) / duration);
    const e = easeView(p);
    // Zoom geometrically and move the centre in a straight line: a pan and a zoom
    // together read as one motion, not two.
    const k = Math.exp(mix(Math.log(from.k), Math.log(to.k), e));
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    const centre = {
      x: mix((cx - from.x) / from.k, (cx - to.x) / to.k, e),
      y: mix((cy - from.y) / from.k, (cy - to.y) / to.k, e),
    };
    view = { k, x: cx - centre.x * k, y: cy - centre.y * k };
    if (p >= 1) {
      view = { ...to };
      viewAnim = null;
    }
    applyView();
    return viewAnim !== null;
  }

  const viewGoal = () => (viewAnim ? viewAnim.to : view);

  const boxOf = (id) => {
    const t = targets.get(id);
    return t ? { minX: t.x, minY: t.y, maxX: t.x + t.w + TOGGLE_RADIUS * 2, maxY: t.y + t.h } : null;
  };

  /** Fit the map in view — or, where that would shrink it past legibility, show it from its root. */
  function fit({ duration = VIEW_MS, minZoom = MIN_ZOOM, maxZoom = 1 } = {}) {
    measureViewport();
    if (!targets.size || !viewport.width || !viewport.height) return;
    const bounds = boundsOf(targets.values());
    bounds.maxX += TOGGLE_RADIUS * 2;
    setView(overviewTransform(bounds, boxOf(roots[0]), viewport, { minZoom, maxZoom }), duration);
  }

  // The first view of a map: whole if it is small enough to read, else from the root.
  function place() {
    if (placed || !targets.size || !viewport.width || !viewport.height) return;
    placed = true;
    fit({ duration: 0, minZoom: 0.75 });
  }

  /** The smallest pan that shows `ids`, keeping `focusId` in view if they cannot all fit. */
  function reveal(ids, focusId) {
    measureViewport();
    const boxes = ids.map(boxOf).filter(Boolean);
    if (!boxes.length || !viewport.width || !viewport.height) return;
    const rect = {
      minX: Math.min(...boxes.map((b) => b.minX)),
      minY: Math.min(...boxes.map((b) => b.minY)),
      maxX: Math.max(...boxes.map((b) => b.maxX)),
      maxY: Math.max(...boxes.map((b) => b.maxY)),
    };
    const goal = viewGoal();
    const next = revealTransform(rect, boxOf(focusId) || rect, goal, viewport);
    if (Math.abs(next.x - goal.x) > 1 || Math.abs(next.y - goal.y) > 1) setView(next);
  }

  function zoomBy(factor) {
    measureViewport();
    const goal = viewGoal();
    const k = clamp(goal.k * factor, MIN_ZOOM, MAX_ZOOM);
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    setView({ k, x: cx - ((cx - goal.x) / goal.k) * k, y: cy - ((cy - goal.y) / goal.k) * k }, 260);
  }

  function panBy(dx, dy) {
    viewAnim = null;
    view = { ...view, x: view.x + dx, y: view.y + dy };
    applyView();
  }

  function zoomAt(px, py, factor) {
    viewAnim = null;
    const k = clamp(view.k * factor, MIN_ZOOM, MAX_ZOOM);
    view = { k, x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k };
    applyView();
  }

  // ── Input ────────────────────────────────────────────────────────────────────

  const local = (event) => {
    const rect = container.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (event.target?.closest?.("[data-canvas-ignore]")) return;
    if (event.pointerType === "mouse") {
      // There is only one mouse: a press released outside the canvas left nothing
      // behind that should turn this press into a pinch.
      pointers.clear();
      pinch = null;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewAnim = null;
    if (pointers.size === 1) {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const rect = container.getBoundingClientRect();
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top },
        view: { ...view },
      };
      if (drag) drag.moved = true;
    }
  }

  function onPointerMove(event) {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;

    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const rect = container.getBoundingClientRect();
      const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
      const k = clamp(pinch.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance), MIN_ZOOM, MAX_ZOOM);
      // The map point first under the fingers stays under them.
      const wx = (pinch.mid.x - pinch.view.x) / pinch.view.k;
      const wy = (pinch.mid.y - pinch.view.y) / pinch.view.k;
      view = { k, x: mid.x - wx * k, y: mid.y - wy * k };
      applyView();
      return;
    }

    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return;
      drag.moved = true;
      try {
        container.setPointerCapture?.(event.pointerId);
      } catch {
        // A pointer that is already gone cannot be captured; the pan still works.
      }
      container.setAttribute("data-panning", "true");
    }
    panBy(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
  }

  function onPointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      if (drag?.moved) {
        // The click that ends a drag is not a click on whatever was under it.
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
      drag = null;
      container.removeAttribute("data-panning");
    } else if (pointers.size === 1) {
      // Lifting one finger of a pinch carries on as a pan with the other.
      const [[id, point]] = [...pointers];
      drag = { id, x: point.x, y: point.y, moved: true };
    }
  }

  function onClickCapture(event) {
    if (!suppressClick) return;
    suppressClick = false;
    event.stopPropagation();
    event.preventDefault();
  }

  function onWheel(event) {
    event.preventDefault();
    const at = local(event);
    if (event.ctrlKey || event.metaKey) {
      // A trackpad pinch arrives as ctrl+wheel with small deltas; a mouse wheel
      // with a modifier as large ones. Clamp so a single notch is a single step.
      const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
      const delta = clamp(-event.deltaY * unit * (event.ctrlKey ? 10 : 1), -0.3, 0.3);
      zoomAt(at.x, at.y, 2 ** delta);
      return;
    }
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height || 400 : 1;
    let dx = event.deltaX * unit;
    let dy = event.deltaY * unit;
    if (event.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    panBy(-dx, -dy);
  }

  // Safari reports a trackpad pinch as gesture events rather than ctrl+wheel.
  function onGestureStart(event) {
    event.preventDefault();
    gestureZoom = view.k;
  }

  function onGestureChange(event) {
    event.preventDefault();
    if (gestureZoom == null) return;
    const at = local(event);
    zoomAt(at.x, at.y, clamp(gestureZoom * event.scale, MIN_ZOOM, MAX_ZOOM) / view.k);
  }

  function onGestureEnd() {
    gestureZoom = null;
  }

  // Focusing a node can scroll an overflow-hidden box; the canvas never scrolls.
  function onScroll() {
    if (container.scrollLeft || container.scrollTop) {
      container.scrollLeft = 0;
      container.scrollTop = 0;
    }
  }

  function attach(nextContainer, nextWorld, nextGrid, callbacks = {}) {
    unlisten();
    container = nextContainer;
    world = nextWorld;
    grid = nextGrid;
    onSettled = callbacks.onSettled || null;
    if (!container) return;

    const listeners = [
      ["pointerdown", onPointerDown],
      ["pointermove", onPointerMove],
      ["pointerup", onPointerUp],
      ["pointercancel", onPointerUp],
      ["click", onClickCapture, true],
      ["wheel", onWheel, { passive: false }],
      ["gesturestart", onGestureStart, { passive: false }],
      ["gesturechange", onGestureChange, { passive: false }],
      ["gestureend", onGestureEnd],
      ["scroll", onScroll],
    ];
    for (const [type, handler, options] of listeners) container.addEventListener(type, handler, options);
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => {
        measureViewport();
        place();
      });
      resizeObserver.observe(container);
    }
    unlisten = () => {
      for (const [type, handler, options] of listeners) container?.removeEventListener(type, handler, options);
      resizeObserver?.disconnect();
      resizeObserver = null;
      unlisten = () => {};
    };
    measureViewport();
    applyView();
    // Re-attaching (a remount of the same canvas) resumes whatever was in flight.
    if (plan.length || viewAnim) schedule();
  }

  function destroy() {
    unlisten();
    if (frame) cancelFrame(frame);
    frame = 0;
    onSettled = null;
    pointers.clear();
    drag = null;
    pinch = null;
  }

  return {
    attach,
    destroy,
    update,
    fit,
    reveal,
    ensureVisible: (id) => reveal([id], id),
    zoomBy,
    nodeElement: (id) => nodeEls.get(id) || null,
    getView: () => ({ ...view }),
  };
}

export default createMindMapCanvas;
