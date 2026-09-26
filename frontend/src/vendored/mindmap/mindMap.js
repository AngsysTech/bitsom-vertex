/**
 * MindMapProjectionV1 / V2 in the browser: index it, walk it, search it.
 *
 * The projection is a FLAT graph — `nodes` plus `edges` — because a node's id is
 * derived from what it represents and therefore survives a rebuild. Everything
 * the renderer needs is derived here, once, so the components stay about layout
 * and interaction.
 *
 * Two rules the UI must not break, and that these helpers keep for it:
 *
 *   - UI state (expanded nodes, selection) is keyed by `mindmap_node_id`, never
 *     by position. A rebuild that did not change a grouping keeps every id, so
 *     the user's view survives it.
 *   - Sibling order is the projection's `ordinal`, which is the SOURCE's own
 *     reading order. Nothing here re-sorts children by label, size or score.
 */

export const SERVING_STATES = ["CURRENT", "STALE", "BUILDING", "UNAVAILABLE"];

export const NODE_KINDS = {
  SCOPE_ROOT: "SCOPE_ROOT",
  SOURCE_NODE: "SOURCE_NODE",
  VIRTUAL_GROUP: "VIRTUAL_GROUP",
  SEMANTIC_SECTION: "SEMANTIC_SECTION",
  CONCEPT: "CONCEPT",
};

/** A group whose label is "<first> - <last>" is valid and gets no error styling. */
export const LABEL_PROVENANCE_LABELS = {
  SOURCE_TITLE: "From the source",
  SOURCE_HEADING: "From a source heading",
  MODEL_LABEL: "Grouped topic",
  FALLBACK_RANGE: "Range of sections",
  SEMANTIC_LABEL: "Named from its content",
  DERIVED_LABEL: "Named by what it holds",
};

export const KIND_LABELS = {
  SCOPE_ROOT: "Source",
  SOURCE_NODE: "Section",
  VIRTUAL_GROUP: "Grouped topic",
  SEMANTIC_SECTION: "Section from the content",
  CONCEPT: "Concept",
};

/**
 * Where a node's summary came from. A semantic summary was written from the
 * section's own text by the map builder — the panel says so rather than passing
 * it off as the source's words.
 */
export const SUMMARY_PROVENANCE_LABELS = {
  SOURCE_NODE_SUMMARY: null,
  MEMBER_TITLES: null,
  SEMANTIC_SUMMARY: "Summarised from this section's text",
};

const ROLE_WORDS = {
  CONTENT: "Content",
  PRACTICE: "Practice",
  SOLUTION: "Solutions",
  NAVIGATION: "Navigation",
  AUXILIARY: "Supporting material",
};

/** The roles a node's evidence admits, e.g. ["PRACTICE"]; an empty list means every role. */
export function evidenceRoles(node) {
  const policy = String(node?.evidence_role_policy || "ALL");
  return policy === "ALL" ? [] : policy.split("+").filter(Boolean);
}

/**
 * A short badge for a role-restricted node, or null. Content-only is the norm for
 * a rebuilt section and gets no badge; practice and solutions are named, because
 * chatting about them opens a scope that holds only that material.
 */
export function roleBadge(node) {
  const roles = evidenceRoles(node);
  if (roles.length === 0 || (roles.length === 1 && roles[0] === "CONTENT")) return null;
  return roles.map((role) => ROLE_WORDS[role] || role).join(" + ");
}

/** True when the node's selector is a revision-pinned range of chunks, not source nodes. */
export function isSemanticSpan(node) {
  return node?.evidence_selector?.mode === "SEMANTIC_SPAN";
}

const OUTCOME_NOTES = {
  HYBRID: "Parts of this map were organised from the source's content where its headings were weak.",
  SEMANTIC_RECONSTRUCTED: "This map was organised from the source's content because its headings were weak.",
};

/** One line for the map header about how the map was built, or null for a structure-first map. */
export function buildOutcomeNote(outcome) {
  return OUTCOME_NOTES[outcome] || null;
}

/**
 * Index a projection: node lookup, ordered children, parents, depth and roots.
 * Returns a stable, plain object so React can memoize on the projection id.
 */
export function indexProjection(projection) {
  const byId = new Map();
  const childrenOf = new Map();
  const parentOf = new Map();

  for (const node of projection?.nodes || []) {
    byId.set(node.mindmap_node_id, node);
  }
  const edges = [...(projection?.edges || [])].sort((a, b) => a.ordinal - b.ordinal);
  for (const edge of edges) {
    if (!byId.has(edge.from_node_id) || !byId.has(edge.to_node_id)) continue;
    if (!childrenOf.has(edge.from_node_id)) childrenOf.set(edge.from_node_id, []);
    childrenOf.get(edge.from_node_id).push(edge);
    parentOf.set(edge.to_node_id, edge.from_node_id);
  }

  const rootIds = (projection?.root_node_ids || []).filter((id) => byId.has(id));
  return {
    projectionId: projection?.projection_id || null,
    byId,
    childrenOf,
    parentOf,
    rootIds,
    rootId: rootIds[0] || null,
    nodeCount: byId.size,
  };
}

/** The ordered child nodes of one map node. Source order, always. */
export function childrenOfNode(index, nodeId) {
  return (index.childrenOf.get(nodeId) || []).map((edge) => index.byId.get(edge.to_node_id));
}

export function hasChildren(index, nodeId) {
  return (index.childrenOf.get(nodeId) || []).length > 0;
}

/** Every ancestor id of a node, nearest first. */
export function ancestorsOf(index, nodeId) {
  const out = [];
  let current = index.parentOf.get(nodeId);
  while (current) {
    out.push(current);
    current = index.parentOf.get(current);
  }
  return out;
}

/**
 * The nodes that are actually drawn: the roots, and the descendants of every
 * expanded node. Progressive expansion is what keeps a 321-node source readable.
 */
export function visibleNodeIds(index, expanded) {
  const out = [];
  const walk = (id) => {
    out.push(id);
    if (!expanded.has(id)) return;
    for (const edge of index.childrenOf.get(id) || []) walk(edge.to_node_id);
  };
  for (const root of index.rootIds) walk(root);
  return out;
}

/** The set of ids to expand so that `nodeId` is visible. */
export function expandedForPath(index, nodeId, expanded = new Set()) {
  const next = new Set(expanded);
  for (const ancestor of ancestorsOf(index, nodeId)) next.add(ancestor);
  return next;
}

/**
 * The initial view: `depth` levels of nodes are OPEN, so `depth + 1` levels are
 * drawn. The design's "initial visible depth: approximately 2-3" is depth 2.
 */
export function initialExpanded(index, depth = 2) {
  const expanded = new Set();
  const walk = (id, level) => {
    if (level >= depth) return;
    expanded.add(id);
    for (const edge of index.childrenOf.get(id) || []) walk(edge.to_node_id, level + 1);
  };
  for (const root of index.rootIds) walk(root, 0);
  return expanded;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Local search across labels, source headings, concept terms and aliases.
 * Deliberately local: the projection already carries every term, so finding a
 * topic on the map needs no request and no second retrieval subsystem.
 */
export function searchNodes(index, query) {
  const needle = normalize(query);
  if (!needle) return [];
  const matches = [];
  for (const [id, node] of index.byId) {
    const haystack = [
      node.label,
      node.summary_short,
      ...(node.search_terms || []),
      ...(node.breadcrumb || []),
    ];
    if (haystack.some((value) => normalize(value).includes(needle))) matches.push(id);
  }
  // Document order, so results read the way the source does.
  const order = new Map(visibleNodeIdsAll(index).map((id, position) => [id, position]));
  return matches.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

function visibleNodeIdsAll(index) {
  const out = [];
  const walk = (id) => {
    out.push(id);
    for (const edge of index.childrenOf.get(id) || []) walk(edge.to_node_id);
  };
  for (const root of index.rootIds) walk(root);
  return out;
}

/** The breadcrumb a concept panel shows: ancestor labels, outermost first. */
export function breadcrumbOf(index, nodeId) {
  return ancestorsOf(index, nodeId)
    .reverse()
    .map((id) => index.byId.get(id)?.label)
    .filter(Boolean);
}

/**
 * Keep as much UI state as the new projection still has. Ids are stable across
 * rebuilds where membership did not change, so an upgrade build does not collapse
 * the tree the user opened.
 */
export function retainState(index, ids) {
  const kept = new Set();
  for (const id of ids || []) if (index.byId.has(id)) kept.add(id);
  return kept;
}

export function nodeCounts(node) {
  const stats = node?.stats || {};
  return {
    subtopics: stats.visible_child_count || 0,
    evidence: stats.retrievable_chunk_count || 0,
    assets: stats.asset_count || 0,
    annotations: stats.annotation_count || 0,
    pageStart: stats.page_start ?? null,
    pageEnd: stats.page_end ?? null,
  };
}

/** "p. 4" / "pp. 4-9" / null. */
export function pageLabel(node) {
  const { pageStart, pageEnd } = nodeCounts(node);
  if (pageStart === null || pageStart === undefined) return null;
  const start = pageStart + 1;
  const end = pageEnd === null || pageEnd === undefined ? start : pageEnd + 1;
  return start === end ? `p. ${start}` : `pp. ${start}-${end}`;
}

export default {
  KIND_LABELS,
  LABEL_PROVENANCE_LABELS,
  NODE_KINDS,
  SERVING_STATES,
  SUMMARY_PROVENANCE_LABELS,
  ancestorsOf,
  breadcrumbOf,
  buildOutcomeNote,
  childrenOfNode,
  evidenceRoles,
  expandedForPath,
  hasChildren,
  indexProjection,
  initialExpanded,
  isSemanticSpan,
  nodeCounts,
  pageLabel,
  retainState,
  roleBadge,
  searchNodes,
  visibleNodeIds,
};
