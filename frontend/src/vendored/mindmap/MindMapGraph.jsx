import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronsDownUp, ChevronsUpDown, Minus, Plus, Scan, Sparkles } from "@/components/LectureMindMapIcons";

import { cn } from "@/lib/utils";
import { nodeCounts, roleBadge } from "./mindMap";
import { branchTones, layoutTree, visibleTree } from "./mindMapLayout";
import { createMindMapCanvas } from "./mindMapCanvas";
import "./mindMap.css";

/**
 * The map canvas: a left-to-right tree of exactly the nodes the expansion state
 * says are visible, in the projection's own sibling order, joined by curved
 * branches and coloured by the top-level branch they belong to.
 *
 * Opening a node grows its children out of it; closing one folds them back in;
 * the node you toggled stays put while the rest of the map makes room. Drag or
 * scroll to move around, pinch or ⌘/Ctrl-scroll to zoom; a click on empty canvas,
 * or Escape, lets go of the selected node. The motion lives in
 * `mindMapCanvas` and the geometry in `lib/mindMapLayout` — this file is what is
 * drawn and what it does when touched.
 *
 * A `VIRTUAL_GROUP` is drawn differently from a `SOURCE_NODE` because it means
 * something different: a group is presentation, it owns no content of its own,
 * and its label may be a source heading, a planner label, or a "<first> - <last>"
 * range. A range label is VALID — it gets no error styling, only a quieter tone.
 *
 * A `SEMANTIC_SECTION` (Mind Map V2) is a section rebuilt from the source's own
 * text where its headings were weak; like a planner label, its name carries the
 * sparkle. A node whose evidence is only practice or only solutions says so with
 * a small pill, because chatting about it opens a scope holding only that.
 */

// One hue per top-level branch, as HSL triplets; everything beneath inherits it.
const TONES = [
  "262 83% 62%", // violet
  "160 75% 36%", // emerald
  "38 92% 50%", // amber
  "199 89% 46%", // sky
  "346 77% 55%", // rose
  "174 72% 36%", // teal
  "234 80% 62%", // indigo
  "22 92% 52%", // orange
];
const ROOT_TONE = "var(--primary)";

function describeNode(node) {
  const counts = nodeCounts(node);
  const parts = [];
  if (node.kind === "VIRTUAL_GROUP") parts.push("group");
  else if (node.kind === "SEMANTIC_SECTION") parts.push("section from the content");
  else if (node.kind === "CONCEPT") parts.push("concept");
  const role = roleBadge(node);
  if (role) parts.push(`${role.toLowerCase()} only`);
  parts.push(`${counts.subtopics} subtopic${counts.subtopics === 1 ? "" : "s"}`);
  parts.push(`${counts.evidence} evidence`);
  return parts.join(", ");
}

/**
 * One node of the map. Exported so the interaction it owns — select, toggle
 * without selecting, keyboard — is testable on its own.
 *
 * The positioned wrapper carries no transform in React's hands: the canvas writes
 * its position straight to the DOM every animation frame.
 */
export const MindMapNode = memo(function MindMapNode({
  node,
  depth = 1,
  tone = TONES[0],
  childCount = 0,
  expanded = false,
  selected = false,
  matched = false,
  dimmed = false,
  exiting = false,
  focusable = false,
  setSize,
  position,
  onSelect,
  onToggle,
  onKeyDown,
}) {
  const id = node.mindmap_node_id;
  const isRoot = depth === 0;
  const provenance = node.label_provenance?.kind;
  const role = roleBadge(node);
  const aboutId = `${id}-about`;

  return (
    <div
      role="treeitem"
      data-node-id={id}
      data-testid={`mindmap-node-${id}`}
      data-kind={node.kind}
      data-role={role || undefined}
      data-dimmed={dimmed || undefined}
      aria-level={depth + 1}
      aria-setsize={setSize}
      aria-posinset={position}
      aria-expanded={childCount > 0 ? expanded : undefined}
      aria-selected={selected}
      aria-label={node.label}
      aria-describedby={aboutId}
      aria-hidden={exiting || undefined}
      tabIndex={focusable ? 0 : -1}
      style={{ "--tone": tone }}
      className={cn("group/node absolute left-0 top-0 w-max origin-left outline-none", exiting && "pointer-events-none")}
      onClick={() => onSelect?.(id)}
      onDoubleClick={() => childCount > 0 && onToggle?.(id)}
      onKeyDown={(event) => onKeyDown?.(event, id)}
    >
      <div
        data-level={Math.min(depth, 2)}
        // Only a label long enough to be clamped needs a tooltip to be read whole.
        title={node.label?.length > 80 ? node.label : undefined}
        className={cn(
          "relative w-max cursor-pointer rounded-xl border",
          "shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-[box-shadow,opacity,transform] duration-200 ease-out",
          "group-hover/node:-translate-y-px group-hover/node:shadow-[0_12px_28px_-14px_rgba(15,23,42,0.5)]",
          // A selected node already wears a ring; focus must not repaint it.
          !selected &&
            "group-focus-visible/node:ring-2 group-focus-visible/node:ring-ring group-focus-visible/node:ring-offset-2 group-focus-visible/node:ring-offset-background",
          isRoot
            ? "gradient-primary max-w-[300px] border-transparent px-4 py-2.5 text-primary-foreground shadow-glow"
            : "mindmap-node max-w-[260px] px-3.5 py-2",
          node.kind === "VIRTUAL_GROUP" && "border-dashed",
          node.kind === "CONCEPT" && "rounded-full px-4",
          selected && "ring-2 ring-[hsl(var(--tone))] ring-offset-2 ring-offset-background",
          matched && !selected && "ring-2 ring-amber-400 ring-offset-2 ring-offset-background",
          dimmed && "opacity-30",
        )}
      >
        <span
          className={cn(
            "line-clamp-3 break-words leading-snug [overflow-wrap:anywhere]",
            isRoot ? "text-[15px] font-semibold" : depth === 1 ? "text-[13px] font-semibold" : "text-[13px] font-medium",
            provenance === "FALLBACK_RANGE" && "font-normal opacity-75",
          )}
        >
          {(provenance === "MODEL_LABEL" || provenance === "SEMANTIC_LABEL") && (
            <Sparkles aria-hidden className="mr-1 inline-block h-3 w-3 -translate-y-px opacity-60" />
          )}
          {node.label}
          {role && (
            <span
              aria-hidden
              className="ml-1.5 inline-block -translate-y-px rounded-full border border-[hsl(var(--tone)/0.45)] px-1.5 text-[10px] font-medium uppercase tracking-wide opacity-80"
            >
              {role}
            </span>
          )}
        </span>
        <span id={aboutId} className="sr-only">
          {describeNode(node)}
        </span>
      </div>
      {childCount > 0 && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? "Collapse" : `Expand ${childCount} subtopic${childCount === 1 ? "" : "s"}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle?.(id);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
          className={cn(
            "mindmap-toggle absolute right-0 top-1/2 z-10 flex h-5 min-w-5 -translate-y-1/2 translate-x-1/2 items-center justify-center",
            "rounded-full border bg-background px-1 text-[10px] font-semibold leading-none tabular-nums",
            "shadow-[0_1px_3px_rgba(15,23,42,0.14)] transition-[transform,opacity] duration-200 hover:scale-110 active:scale-95",
            dimmed && "opacity-30",
          )}
        >
          {expanded ? (
            <ChevronLeft aria-hidden className="h-3 w-3" strokeWidth={2.75} />
          ) : childCount > 99 ? (
            "99+"
          ) : (
            childCount
          )}
        </button>
      )}
    </div>
  );
});

function ControlButton({ label, onClick, testId, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "[&_svg]:h-4 [&_svg]:w-4",
      )}
    >
      {children}
    </button>
  );
}

export default function MindMapGraph({
  index,
  expanded,
  selectedId,
  matchedIds,
  onToggle,
  onSelect,
  onExpandAll,
  onCollapseAll,
  className,
}) {
  const containerRef = useRef(null);
  const worldRef = useRef(null);
  const gridRef = useRef(null);
  const canvasRef = useRef(null);
  if (!canvasRef.current) canvasRef.current = createMindMapCanvas();
  const canvas = canvasRef.current;

  const tree = useMemo(() => visibleTree(index, expanded), [index, expanded]);
  const tones = useMemo(() => branchTones(index, TONES.length), [index]);

  // Document order over the whole projection, so nodes keep one DOM order however
  // the tree is opened and React never has to move an element to reorder it.
  const documentOrder = useMemo(() => {
    const order = new Map();
    const walk = (id) => {
      if (order.has(id)) return;
      order.set(id, order.size);
      for (const edge of index.childrenOf.get(id) || []) walk(edge.to_node_id);
    };
    index.rootIds.forEach(walk);
    return order;
  }, [index]);

  // What just left the visible tree stays drawn — where and as it was — until it
  // has folded into its parent; the canvas says when (`onSettled`).
  const [leaving, setLeaving] = useState(() => ({ tree, nodes: new Map() }));
  let exiting = leaving.nodes;
  if (leaving.tree !== tree) {
    exiting = new Map();
    const keep = (id, was) => {
      if (!tree.ids.has(id) && index.byId.has(id)) exiting.set(id, was);
    };
    for (const [id, was] of leaving.nodes) keep(id, was);
    const before = leaving.tree;
    for (const id of before.order) {
      if (!exiting.has(id)) keep(id, { parent: before.parent.get(id), depth: before.depth.get(id) });
    }
    setLeaving({ tree, nodes: exiting });
  }

  const rendered = useMemo(() => {
    const ids = [...tree.order, ...exiting.keys()];
    return ids.sort((a, b) => (documentOrder.get(a) ?? 0) - (documentOrder.get(b) ?? 0));
  }, [tree, exiting, documentOrder]);

  const links = useMemo(
    () =>
      rendered
        .map((id) => ({ child: id, parent: tree.ids.has(id) ? tree.parent.get(id) : exiting.get(id)?.parent }))
        .filter((link) => link.parent != null),
    [rendered, tree, exiting],
  );

  const matched = useMemo(() => new Set(matchedIds || []), [matchedIds]);
  // While a search has hits, everything that is neither a hit nor on the way to
  // one steps back.
  const lit = useMemo(() => {
    if (!matched.size) return null;
    const on = new Set();
    for (const id of matched) {
      for (let cursor = id; cursor && !on.has(cursor); cursor = index.parentOf.get(cursor)) on.add(cursor);
    }
    return on;
  }, [matched, index]);
  const trail = useMemo(() => {
    const on = new Set();
    for (let cursor = selectedId; cursor; cursor = index.parentOf.get(cursor)) on.add(cursor);
    return on;
  }, [selectedId, index]);

  const toneOf = useCallback(
    (id) => {
      const tone = tones.get(id);
      return tone == null || tone < 0 ? ROOT_TONE : TONES[tone % TONES.length];
    },
    [tones],
  );

  // ── Interaction ─────────────────────────────────────────────────────────────

  const latest = useRef(null);
  latest.current = { tree, index, expanded, selectedId, onToggle, onSelect, onExpandAll, onCollapseAll };
  // Which node to hold still through the next layout, and what the view should do.
  const pinRef = useRef(null);
  const intentRef = useRef(null);

  const select = useCallback((id) => latest.current.onSelect?.(id), []);

  const deselect = useCallback(() => {
    if (latest.current.selectedId) latest.current.onSelect?.(null);
  }, []);

  // A click on nothing — not a node, not a control — lets go of the selection.
  // The click that ends a drag never gets here: the canvas swallows it.
  const onCanvasClick = useCallback(
    (event) => {
      if (event.target.closest?.("[data-node-id], [data-canvas-ignore]")) return;
      deselect();
    },
    [deselect],
  );

  const toggle = useCallback((id) => {
    const { expanded: open, onToggle: handle } = latest.current;
    pinRef.current = id;
    intentRef.current = open.has(id) ? null : { type: "reveal", id };
    handle?.(id);
  }, []);

  const expandAll = useCallback(() => {
    pinRef.current = latest.current.tree.roots[0] ?? null;
    intentRef.current = { type: "fit" };
    latest.current.onExpandAll?.();
  }, []);

  const collapseAll = useCallback(() => {
    pinRef.current = latest.current.tree.roots[0] ?? null;
    intentRef.current = { type: "fit" };
    latest.current.onCollapseAll?.();
  }, []);

  // Arrow keys walk the map the way it is drawn: right goes in (opening a closed
  // node first), left comes back out (closing an open one first), up and down move
  // between siblings.
  const onNodeKeyDown = useCallback(
    (event, id) => {
      const { tree: shown, index: all, expanded: open } = latest.current;
      const kids = shown.children.get(id) || [];
      const canOpen = (all.childrenOf.get(id) || []).length > 0;
      const parent = shown.parent.get(id);
      const siblings = parent != null ? shown.children.get(parent) : shown.roots;
      const at = siblings.indexOf(id);
      let next = null;
      switch (event.key) {
        case "ArrowRight":
          if (canOpen && !open.has(id)) toggle(id);
          else next = kids[0] ?? null;
          break;
        case "ArrowLeft":
          if (kids.length) toggle(id);
          else next = parent ?? null;
          break;
        case "ArrowDown":
          next = siblings[at + 1] ?? null;
          break;
        case "ArrowUp":
          next = siblings[at - 1] ?? null;
          break;
        case "Home":
          next = shown.roots[0] ?? null;
          break;
        case "Enter":
        case " ":
          select(id);
          break;
        default:
          return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (next) select(next);
    },
    [select, toggle],
  );

  const onCanvasKeyDown = useCallback(
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "+" || event.key === "=") canvas.zoomBy(1.25);
      else if (event.key === "-" || event.key === "_") canvas.zoomBy(0.8);
      else if (event.key === "0") canvas.fit();
      else if (event.key === "Escape" && latest.current.selectedId) deselect();
      else return;
      event.preventDefault();
    },
    [canvas, deselect],
  );

  // ── Layout and motion ───────────────────────────────────────────────────────

  useLayoutEffect(() => {
    canvas.attach(containerRef.current, worldRef.current, gridRef.current, {
      onSettled: () => setLeaving((state) => (state.nodes.size ? { ...state, nodes: new Map() } : state)),
    });
    return () => canvas.destroy();
  }, [canvas]);

  const sizesRef = useRef(new Map());
  const [measureTick, setMeasureTick] = useState(0);

  // Measure what React just rendered, lay it out, and hand it to the canvas —
  // before the browser paints, so a new node is never seen in the wrong place.
  useLayoutEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    const nodeEls = new Map();
    const edgeEls = new Map();
    for (const el of world.querySelectorAll("[data-node-id]")) nodeEls.set(el.getAttribute("data-node-id"), el);
    for (const el of world.querySelectorAll("[data-edge-id]")) edgeEls.set(el.getAttribute("data-edge-id"), el);

    const sizes = new Map();
    for (const [id, el] of nodeEls) {
      if (el.offsetWidth && el.offsetHeight) sizes.set(id, { width: el.offsetWidth, height: el.offsetHeight });
    }
    sizesRef.current = sizes;

    const { positions } = layoutTree(tree, sizes);
    const foldsInto = (id) => {
      for (let up = index.parentOf.get(id); up; up = index.parentOf.get(up)) if (tree.ids.has(up)) return up;
      return null;
    };
    canvas.update({
      order: tree.order,
      roots: tree.roots,
      parentOf: tree.parent,
      positions,
      exiting: [...exiting.keys()].map((id) => ({ id, anchor: foldsInto(id) })),
      links,
      nodeEls,
      edgeEls,
      pin: pinRef.current,
    });
    pinRef.current = null;

    const intent = intentRef.current;
    intentRef.current = null;
    if (intent?.type === "fit") canvas.fit({ minZoom: 0.35 });
    else if (intent?.type === "reveal") canvas.reveal([intent.id, ...(tree.children.get(intent.id) || [])], intent.id);
  }, [canvas, tree, exiting, links, index, measureTick]);

  // Labels re-flow when a web font arrives or a label changes; lay out again
  // when any node's size actually changes.
  useEffect(() => {
    const world = worldRef.current;
    if (!world || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver((entries) => {
      const resized = entries.some(({ target }) => {
        const width = target.offsetWidth;
        const height = target.offsetHeight;
        if (!width || !height) return false;
        const known = sizesRef.current.get(target.getAttribute("data-node-id"));
        return !known || known.width !== width || known.height !== height;
      });
      if (resized) setMeasureTick((tick) => tick + 1);
    });
    for (const el of world.querySelectorAll("[data-node-id]")) observer.observe(el);
    return () => observer.disconnect();
  }, [rendered]);

  // A selection made elsewhere — search, the keyboard — is brought into view, and
  // keyboard focus follows it.
  useEffect(() => {
    if (!selectedId) return;
    canvas.ensureVisible(selectedId);
    const world = worldRef.current;
    const el = canvas.nodeElement(selectedId);
    if (el && world?.contains(document.activeElement) && document.activeElement !== el) {
      el.focus({ preventScroll: true });
    }
  }, [canvas, selectedId]);

  const focusableId = selectedId && tree.ids.has(selectedId) ? selectedId : tree.roots[0];

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onCanvasKeyDown}
      onClick={onCanvasClick}
      data-testid="mindmap-graph"
      className={cn(
        "relative h-full w-full cursor-grab touch-none select-none overflow-hidden outline-none",
        "data-[panning=true]:cursor-grabbing",
        className,
      )}
    >
      <div
        ref={gridRef}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: "radial-gradient(hsl(var(--foreground) / 0.13) 1px, transparent 1.3px)" }}
      />

      <div ref={worldRef} role="tree" aria-label="Mind map" className="absolute left-0 top-0 origin-top-left">
        <svg aria-hidden className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
          {links.map(({ child }) => (
            <path
              key={child}
              data-edge-id={child}
              style={{ "--tone": toneOf(child) }}
              strokeLinecap="round"
              className={cn(
                "mindmap-branch fill-none transition-[stroke-width,stroke-opacity] duration-200",
                trail.has(child) ? "[stroke-width:2.6px]" : "[stroke-width:1.75px]",
                lit && !lit.has(child) && "[stroke-opacity:0.2]",
              )}
            />
          ))}
        </svg>

        {rendered.map((id) => {
          const node = index.byId.get(id);
          if (!node) return null;
          const leavingNow = !tree.ids.has(id);
          const parent = tree.parent.get(id);
          const siblings = leavingNow ? [id] : parent != null ? tree.children.get(parent) : tree.roots;
          return (
            <MindMapNode
              key={id}
              node={node}
              depth={leavingNow ? exiting.get(id)?.depth ?? 1 : tree.depth.get(id)}
              tone={toneOf(id)}
              childCount={(index.childrenOf.get(id) || []).length}
              expanded={expanded.has(id)}
              selected={id === selectedId}
              matched={matched.has(id)}
              dimmed={Boolean(lit) && !lit.has(id)}
              exiting={leavingNow}
              focusable={id === focusableId}
              setSize={siblings.length}
              position={siblings.indexOf(id) + 1}
              onSelect={select}
              onToggle={toggle}
              onKeyDown={onNodeKeyDown}
            />
          );
        })}
      </div>

      <div
        data-canvas-ignore
        className={cn(
          "absolute bottom-3 right-3 z-20 flex flex-col items-center gap-0.5 rounded-xl border border-border/70 p-1",
          "bg-background/85 shadow-[0_10px_30px_-12px_rgba(15,23,42,0.35)] backdrop-blur-md",
        )}
      >
        <ControlButton label="Zoom in" onClick={() => canvas.zoomBy(1.25)}>
          <Plus />
        </ControlButton>
        <ControlButton label="Zoom out" onClick={() => canvas.zoomBy(0.8)}>
          <Minus />
        </ControlButton>
        <ControlButton label="Fit to screen" onClick={() => canvas.fit()} testId="mindmap-fit">
          <Scan />
        </ControlButton>
        {(onExpandAll || onCollapseAll) && <span aria-hidden className="my-0.5 h-px w-5 bg-border" />}
        {onExpandAll && (
          <ControlButton label="Expand all" onClick={expandAll} testId="mindmap-expand-all">
            <ChevronsUpDown />
          </ControlButton>
        )}
        {onCollapseAll && (
          <ControlButton label="Collapse all" onClick={collapseAll} testId="mindmap-collapse-all">
            <ChevronsDownUp />
          </ControlButton>
        )}
      </div>
    </div>
  );
}
