import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs/lib/elk.bundled.js";
import { buildLayout, graphGroups, layoutDensityForNodeCount, nodeGroupId, nodeIdForInterface } from "./graphModel";
import type { GraphModel, LayoutDirection, TopologyLayoutModel } from "./types";

let elkInstance: Promise<ELK> | null = null;

async function getElk() {
  elkInstance ??= import("elkjs/lib/elk.bundled.js").then(({ default: Elk }) => new Elk());
  return elkInstance;
}

export async function buildElkLayout(
  graph: GraphModel,
  direction: LayoutDirection
): Promise<TopologyLayoutModel> {
  if (!graph.nodes.length) {
    return buildLayout(graph, direction);
  }

  const density = layoutDensityForNodeCount(graph.nodes.length);
  const nodeSize = density === "crowded" ? 42 : density === "dense" ? 50 : 64;
  const graphPadding = density === "crowded" ? 20 : 30;
  const groupPadding = density === "crowded" ? 18 : 26;
  const groups = graphGroups(graph);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeSet = new Set<string>();
  const edges: ElkExtendedEdge[] = [];

  graph.links.forEach((link) => {
    const sourceNodeId = nodeIdForInterface(graph, link.from_interface);
    const targetNodeId = nodeIdForInterface(graph, link.to_interface);
    if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
      return;
    }

    const edgeId = [sourceNodeId, targetNodeId].sort().join("::");
    if (edgeSet.has(edgeId)) {
      return;
    }
    edgeSet.add(edgeId);
    edges.push({
      id: `edge:${edgeId}`,
      sources: [sourceNodeId],
      targets: [targetNodeId],
    });
  });

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction === "lr" ? "RIGHT" : "DOWN",
      "elk.edgeRouting": "POLYLINE",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": `[top=${graphPadding},left=${graphPadding},bottom=${graphPadding},right=${graphPadding}]`,
      "elk.spacing.nodeNode": density === "crowded" ? "28" : "42",
      "elk.layered.spacing.nodeNodeBetweenLayers": density === "crowded" ? "58" : "78",
    },
    children: groups.flatMap((group) => {
      const groupNodes = graph.nodes.filter((node) => nodeGroupId(node) === group.id);
      if (!groupNodes.length) {
        return [];
      }

      return [{
        id: `group:${group.id}`,
        width: nodeSize + groupPadding * 2,
        height: nodeSize + groupPadding * 2,
        layoutOptions: {
          "elk.padding": `[top=${groupPadding},left=${groupPadding},bottom=${groupPadding},right=${groupPadding}]`,
        },
        children: groupNodes.map((node) => ({
          id: node.id,
          width: nodeSize,
          height: nodeSize,
        })),
      }];
    }),
    edges,
  };

  const elk = await getElk();
  const result = await elk.layout(elkGraph);
  const rawNodes = new Map<string, { x: number; y: number }>();
  const rawGroups = new Map<string, { x: number; y: number; width: number; height: number; label: string }>();

  result.children?.forEach((groupNode) => {
    const groupId = groupNode.id.replace(/^group:/, "");
    const group = groups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }
    const groupX = groupNode.x ?? 0;
    const groupY = groupNode.y ?? 0;
    rawGroups.set(group.id, {
      x: groupX,
      y: groupY,
      width: groupNode.width ?? nodeSize + groupPadding * 2,
      height: groupNode.height ?? nodeSize + groupPadding * 2,
      label: group.label,
    });

    groupNode.children?.forEach((node) => {
      const sourceNode = nodeById.get(node.id);
      rawNodes.set(node.id, {
        x: sourceNode?.x ?? groupX + (node.x ?? 0) + (node.width ?? nodeSize) / 2,
        y: sourceNode?.y ?? groupY + (node.y ?? 0) + (node.height ?? nodeSize) / 2,
      });
    });
  });
  const compacted = compactLayout(rawNodes, rawGroups, density === "crowded" ? 28 : 40);

  return {
    nodes: compacted.nodes,
    groups: compacted.groups,
    width: compacted.width,
    height: compacted.height,
    density,
    engine: "elk",
  };
}

function compactLayout(
  nodes: Map<string, { x: number; y: number }>,
  groups: Map<string, { x: number; y: number; width: number; height: number; label: string }>,
  padding: number
) {
  const points = [...nodes.values()];
  if (!points.length) {
    return { nodes, groups, width: 240, height: 180 };
  }

  const groupRects = [...groups.values()];
  const minX = Math.min(
    ...points.map((point) => point.x),
    ...groupRects.map((group) => group.x)
  );
  const maxX = Math.max(
    ...points.map((point) => point.x),
    ...groupRects.map((group) => group.x + group.width)
  );
  const minY = Math.min(
    ...points.map((point) => point.y),
    ...groupRects.map((group) => group.y)
  );
  const maxY = Math.max(
    ...points.map((point) => point.y),
    ...groupRects.map((group) => group.y + group.height)
  );
  const compactedNodes = new Map<string, { x: number; y: number }>();
  const compactedGroups = new Map<string, { x: number; y: number; width: number; height: number; label: string }>();

  nodes.forEach((point, nodeId) => {
    compactedNodes.set(nodeId, {
      x: point.x - minX + padding,
      y: point.y - minY + padding,
    });
  });
  groups.forEach((group, groupId) => {
    compactedGroups.set(groupId, {
      ...group,
      x: group.x - minX + padding,
      y: group.y - minY + padding,
    });
  });

  return {
    nodes: compactedNodes,
    groups: compactedGroups,
    width: Math.max(240, Math.ceil(maxX - minX + padding * 2)),
    height: Math.max(180, Math.ceil(maxY - minY + padding * 2)),
  };
}
