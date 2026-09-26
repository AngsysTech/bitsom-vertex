/**
 * Where every node of the mind map sits, and the shape of the branch between two.
 *
 * Pure geometry, no DOM: the canvas measures the nodes it rendered and hands the
 * sizes in, so a label that wraps to three lines is given three lines of room.
 *
 * The layout is a left-to-right tidy tree:
 *
 *   - Every depth is a column, as wide as its widest visible node, so siblings
 *     line up and the map reads left to right the way the source does. The gap
 *     after a column widens with how far its branches must travel vertically, so
 *     a parent with far-flung children fans out instead of combing straight down.
 *   - Every node owns a horizontal band as tall as the larger of itself and its
 *     visible subtree. Bands never overlap, so nothing can collide however the
 *     tree is opened.
 *   - A parent sits halfway between its first and last child, so its branches fan
 *     out symmetrically.
 *   - Sibling order is the projection's order. Nothing is re-sorted to pack tighter.
 */

export const LAYOUT = {
  columnGap: 76,
  maxColumnGap: 150,
  // Extra gap per pixel of the longest vertical run a column's branches make.
  reachGap: 0.08,
  siblingGap: 12,
  branchGap: 22,
  rootGap: 48,
  defaultWidth: 180,
  defaultHeight: 36,
};

/**
 * The part of the map that is drawn: the roots, and the children of every expanded
 * node, walked in sibling order. `order` is parent-first, which the canvas relies
 * on — a child's animation is anchored to its parent's position in the same frame.
 */
export function visibleTree(index, expanded) {
  const order = [];
  const ids = new Set();
  const parent = new Map();
  const depth = new Map();
  const children = new Map();

  const walk = (id, level, parentId) => {
    // A projection is a tree, but a node named twice must not be drawn twice.
    if (ids.has(id) || !index.byId.has(id)) return false;
    ids.add(id);
    order.push(id);
    parent.set(id, parentId);
    depth.set(id, level);
    const kids = [];
    children.set(id, kids);
    if (expanded.has(id)) {
      for (const edge of index.childrenOf.get(id) || []) {
        if (walk(edge.to_node_id, level + 1, id)) kids.push(edge.to_node_id);
      }
    }
    return true;
  };

  const roots = [];
  for (const root of index.rootIds) if (walk(root, 0, null)) roots.push(root);
  return { order, ids, parent, depth, children, roots };
}

/**
 * Position every node of a visible tree. `sizes` maps id → { width, height } as
 * rendered; a node that has not been measured yet gets the default size.
 *
 * Returns top-left positions in map coordinates, plus the bounds of the whole.
 */
export function layoutTree(tree, sizes = new Map(), options = {}) {
  const o = { ...LAYOUT, ...options };
  const sizeOf = (id) => sizes.get(id) || { width: o.defaultWidth, height: o.defaultHeight };

  // Two leaves sit close; a gap next to an open branch is wider, so where one
  // subtree ends and the next begins stays legible.
  const gapBetween = (a, b) =>
    tree.children.get(a).length || tree.children.get(b).length ? o.branchGap : o.siblingGap;

  const band = new Map();
  const childSpan = (id) => {
    const kids = tree.children.get(id);
    let span = 0;
    kids.forEach((kid, i) => {
      span += band.get(kid);
      if (i > 0) span += gapBetween(kids[i - 1], kid);
    });
    return span;
  };
  // Children before parents: a band is sized from the bands below it.
  for (let i = tree.order.length - 1; i >= 0; i -= 1) {
    const id = tree.order[i];
    const own = sizeOf(id).height;
    band.set(id, tree.children.get(id).length ? Math.max(own, childSpan(id)) : own);
  }

  // Vertical first: where a node sits in its column does not depend on where the
  // column is.
  const positions = new Map();
  const place = (id, top) => {
    const { width, height } = sizeOf(id);
    const kids = tree.children.get(id);
    const own = band.get(id);
    if (!kids.length) {
      positions.set(id, { x: 0, y: top + (own - height) / 2, width, height });
      return;
    }
    let cursor = top + (own - childSpan(id)) / 2;
    kids.forEach((kid, i) => {
      if (i > 0) cursor += gapBetween(kids[i - 1], kid);
      place(kid, cursor);
      cursor += band.get(kid);
    });
    const first = positions.get(kids[0]);
    const last = positions.get(kids[kids.length - 1]);
    const center = (first.y + first.height / 2 + last.y + last.height / 2) / 2;
    // Centred on its children, but never outside its own band.
    const y = Math.min(Math.max(center - height / 2, top), top + own - height);
    positions.set(id, { x: 0, y, width, height });
  };

  let top = 0;
  tree.roots.forEach((root, i) => {
    if (i > 0) top += o.rootGap;
    place(root, top);
    top += band.get(root);
  });

  const columnWidth = [];
  const reach = [];
  const centre = (id) => positions.get(id).y + positions.get(id).height / 2;
  for (const id of tree.order) {
    const level = tree.depth.get(id);
    columnWidth[level] = Math.max(columnWidth[level] || 0, sizeOf(id).width);
    for (const kid of tree.children.get(id)) {
      reach[level] = Math.max(reach[level] || 0, Math.abs(centre(kid) - centre(id)));
    }
  }
  const columnX = [0];
  for (let level = 1; level < columnWidth.length; level += 1) {
    const gap = Math.min(o.columnGap + (reach[level - 1] || 0) * o.reachGap, o.maxColumnGap);
    columnX[level] = columnX[level - 1] + columnWidth[level - 1] + Math.round(gap);
  }
  for (const [id, position] of positions) position.x = columnX[tree.depth.get(id)];

  return { positions, bounds: boundsOf(positions.values()) };
}

/** The smallest rectangle around a set of { x, y, width, height } boxes. */
export function boundsOf(boxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of boxes) {
    const width = box.width ?? box.w ?? 0;
    const height = box.height ?? box.h ?? 0;
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + width);
    maxY = Math.max(maxY, box.y + height);
  }
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * A branch: a cubic curve that leaves the parent and meets the child
 * horizontally, bending in the gap between the two columns.
 */
export function branchPath(x1, y1, x2, y2) {
  const bend = Math.max(Math.abs(x2 - x1) / 2, 12);
  const r = (value) => Math.round(value * 10) / 10;
  return `M${r(x1)},${r(y1)} C${r(x1 + bend)},${r(y1)} ${r(x2 - bend)},${r(y2)} ${r(x2)},${r(y2)}`;
}

/**
 * Which colour family each node belongs to: every child of a root starts a
 * branch with its own tone, and everything beneath it inherits that tone, so a
 * subtree can be followed by colour. Roots are -1. Assigned over the WHOLE
 * projection, so a branch keeps its colour however the tree is opened.
 */
export function branchTones(index, toneCount = 8) {
  const tones = new Map();
  const paint = (id, tone) => {
    if (tones.has(id)) return;
    tones.set(id, tone);
    for (const edge of index.childrenOf.get(id) || []) paint(edge.to_node_id, tone);
  };
  for (const root of index.rootIds) {
    tones.set(root, -1);
    (index.childrenOf.get(root) || []).forEach((edge, i) => paint(edge.to_node_id, i % toneCount));
  }
  return tones;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/** The zoom and pan that fit `bounds` inside a viewport, centred. */
export function fitTransform(bounds, viewport, { padding = 48, minZoom = 0.2, maxZoom = 1 } = {}) {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const k = clamp(
    Math.min((viewport.width - 2 * padding) / width, (viewport.height - 2 * padding) / height),
    minZoom,
    maxZoom,
  );
  return {
    k,
    x: viewport.width / 2 - (bounds.minX + width / 2) * k,
    y: viewport.height / 2 - (bounds.minY + height / 2) * k,
  };
}

/**
 * An overview that stays readable: fit the whole map if that keeps the zoom at
 * `minZoom` or above; otherwise hold `minZoom` and show the map from its root —
 * left edge in view, centred on the root — rather than a thumbnail of it.
 */
export function overviewTransform(bounds, focus, viewport, { padding = 48, minZoom = 0.2, maxZoom = 1 } = {}) {
  const fit = fitTransform(bounds, viewport, { padding, minZoom, maxZoom });
  const { k } = fit;
  let { x, y } = fit;
  if ((bounds.maxX - bounds.minX) * k > viewport.width - 2 * padding) {
    x = padding - bounds.minX * k;
  }
  if ((bounds.maxY - bounds.minY) * k > viewport.height - 2 * padding && focus) {
    y = viewport.height / 2 - ((focus.minY + focus.maxY) / 2) * k;
  }
  return { k, x, y };
}

// How far to move one axis so [lo, hi] is in view; when it cannot all fit, only
// make sure the focus is.
function nudge(lo, hi, size, margin, focusLo, focusHi) {
  if (hi - lo <= size - 2 * margin) {
    if (lo < margin) return margin - lo;
    if (hi > size - margin) return size - margin - hi;
    return 0;
  }
  if (focusLo < margin) return margin - focusLo;
  if (focusHi > size - margin) return size - margin - focusHi;
  return 0;
}

/**
 * The smallest pan that brings `rect` into view (at the current zoom). If it is
 * bigger than the viewport, the pan only guarantees `focus` is visible. A focus
 * that is entirely off-screen is centred instead, since a far jump that stops at
 * the very edge of the viewport reads as a miss.
 */
export function revealTransform(rect, focus, view, viewport, { margin = 40 } = {}) {
  const { k } = view;
  const screen = (box) => ({
    minX: box.minX * k + view.x,
    maxX: box.maxX * k + view.x,
    minY: box.minY * k + view.y,
    maxY: box.maxY * k + view.y,
  });
  const f = screen(focus || rect);
  const offscreen = f.maxX < 0 || f.minX > viewport.width || f.maxY < 0 || f.minY > viewport.height;
  if (offscreen) {
    return {
      k,
      x: view.x + viewport.width / 2 - (f.minX + f.maxX) / 2,
      y: view.y + viewport.height / 2 - (f.minY + f.maxY) / 2,
    };
  }
  const r = screen(rect);
  return {
    k,
    x: view.x + nudge(r.minX, r.maxX, viewport.width, margin, f.minX, f.maxX),
    y: view.y + nudge(r.minY, r.maxY, viewport.height, margin, f.minY, f.maxY),
  };
}

/**
 * A CSS-style cubic-bezier easing: the same curve a `transition-timing-function`
 * of `cubic-bezier(x1, y1, x2, y2)` describes.
 */
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;

  const solve = (x) => {
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) return t;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40 && hi - lo > 1e-6; i += 1) {
      if (sampleX(t) < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sampleY(solve(x)));
}
