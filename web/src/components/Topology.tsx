import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import {
  edgeKey,
  graphGroups,
  linkGeometry,
  nodeDeviceType,
  nodeGroupId,
  nodeLabelLines,
  sanitizeClassName,
} from "../graphModel";
import type { GraphModel, InterfaceDisplayMode, RouteEdgeDirection } from "../types";
import type { TopologyLayoutModel } from "../types";
import type { NodeDecisionState } from "../diagnosis";
import { nodeStateLabel } from "../diagnosis";
import { cn } from "./common";

export function Topology({
  graph,
  layout,
  interfaceDisplayMode,
  routeEdgeDirections,
  problemLinkIds,
  routeInterfaceIds,
  routeNodeIds,
  fromInterface,
  toInterface,
  downNodeIds,
  downInterfaceIds,
  nodeStates,
  onNodeSelect,
  onInterfaceSelect,
  onLinkSelect,
  onNodeMove,
  onNodeMoveEnd,
}: {
  graph: GraphModel;
  layout: TopologyLayoutModel;
  interfaceDisplayMode: InterfaceDisplayMode;
  routeEdgeDirections: Map<string, RouteEdgeDirection>;
  problemLinkIds: Set<string>;
  routeInterfaceIds: Set<string>;
  routeNodeIds: Set<string>;
  fromInterface: string;
  toInterface: string;
  downNodeIds: Set<string>;
  downInterfaceIds: Set<string>;
  nodeStates: Map<string, NodeDecisionState>;
  onNodeSelect: (nodeId: string) => void;
  onInterfaceSelect: (interfaceId: string) => void;
  onLinkSelect: (linkId: string) => void;
  onNodeMove: (nodeId: string, x: number, y: number) => void;
  onNodeMoveEnd?: (nodeId: string) => void;
}) {
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickNodeIdRef = useRef<string | null>(null);
  const interfaceById = new Map(
    graph.interfaces.map((interfaceItem) => [interfaceItem.id, interfaceItem])
  );
  const groups = graphGroups(graph);
  const hasRoute = routeNodeIds.size > 0;
  const nodeRadius = layout.density === "crowded" ? 16 : layout.density === "dense" ? 21 : 26;
  const interfaceRadius = layout.density === "crowded" ? 4 : 6;
  const routePacketRadius = layout.density === "crowded" ? 3 : 5;
  const nodeChipWidth = layout.density === "crowded" ? 54 : 58;
  const renderedHeight = Math.min(860, Math.max(layout.engine === "elk" ? 380 : 520, layout.height * 0.78));
  const groupBounds = groups.flatMap((group) => {
    const points = graph.nodes
      .filter((node) => nodeGroupId(node) === group.id)
      .map((node) => layout.nodes.get(node.id))
      .filter((point): point is { x: number; y: number } => Boolean(point));
    if (!points.length) {
      return [];
    }

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const paddingX = layout.density === "crowded" ? 36 : 58;
    const paddingY = layout.density === "crowded" ? 46 : 64;
    const x = Math.max(12, minX - paddingX);
    const y = Math.max(28, minY - paddingY);
    return [
      {
        id: group.id,
        label: group.label,
        x,
        y,
        width: Math.max(72, Math.min(layout.width - x - 12, maxX - minX + paddingX * 2)),
        height: Math.max(64, Math.min(layout.height - y - 12, maxY - minY + paddingY * 2)),
      },
    ];
  });

  function groupLabelDisplay(label: string, width: number) {
    const maxChars = Math.max(6, Math.floor((width - 28) / 6.2));
    if (label.length <= maxChars) {
      return label;
    }
    return `${label.slice(0, Math.max(3, maxChars - 1))}…`;
  }

  function pointFromEvent(event: ReactPointerEvent<Element>) {
    const svg = event.currentTarget instanceof SVGSVGElement
      ? event.currentTarget
      : event.currentTarget instanceof SVGElement
        ? event.currentTarget.ownerSVGElement
        : null;
    if (!svg) {
      return { x: 0, y: 0 };
    }
    const point = svg.createSVGPoint();
    const matrix = svg.getScreenCTM();
    point.x = event.clientX;
    point.y = event.clientY;
    return matrix ? point.matrixTransform(matrix.inverse()) : point;
  }

  function startNodeDrag(event: ReactPointerEvent, nodeId: string) {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { nodeId, startX: event.clientX, startY: event.clientY, moved: false };
    setDraggingNodeId(nodeId);
  }

  function selectNodeUnlessDragged(nodeId: string) {
    if (suppressClickNodeIdRef.current === nodeId) {
      suppressClickNodeIdRef.current = null;
      return;
    }
    onNodeSelect(nodeId);
  }

  function finishNodeDrag() {
    const drag = dragRef.current;
    if (drag?.moved) {
      suppressClickNodeIdRef.current = drag.nodeId;
      onNodeMoveEnd?.(drag.nodeId);
      window.setTimeout(() => {
        if (suppressClickNodeIdRef.current === drag.nodeId) {
          suppressClickNodeIdRef.current = null;
        }
      }, 0);
    }
    dragRef.current = null;
    setDraggingNodeId(null);
  }
  return (
    <svg
      className={cn("topology block w-full", `density-${layout.density}`)}
      style={{ height: renderedHeight }}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label="Network topology"
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!draggingNodeId || !drag) {
          return;
        }
        const movedDistance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (movedDistance < 4 && !drag.moved) {
          return;
        }
        drag.moved = true;
        const point = pointFromEvent(event);
        onNodeMove(draggingNodeId, point.x, point.y);
      }}
      onPointerUp={finishNodeDrag}
      onPointerLeave={finishNodeDrag}
    >
      {groupBounds.map((group) => (
        <g key={group.id}>
          {(() => {
            const labelWidth = Math.max(40, Math.min(group.width - 20, 180));
            const visibleLabel = groupLabelDisplay(group.label, labelWidth);
            const labelX = group.x + group.width / 2 - labelWidth / 2;
            return (
              <>
                <clipPath id={`group-label-clip-${sanitizeClassName(group.id)}`}>
                  <rect x={labelX + 4} y={group.y - 8} width={labelWidth - 8} height={16} rx="4" />
                </clipPath>
                <rect
                  className="topology-group"
                  x={group.x}
                  y={group.y}
                  width={group.width}
                  height={group.height}
                  rx="8"
                />
                <rect
                  className="topology-group-label-bg"
                  x={labelX}
                  y={group.y - 10}
                  width={labelWidth}
                  height={20}
                  rx="6"
                />
                <text
                  className="topology-group-label"
                  clipPath={`url(#group-label-clip-${sanitizeClassName(group.id)})`}
                  x={group.x + group.width / 2}
                  y={group.y}
                >
                  {visibleLabel}
                </text>
              </>
            );
          })()}
        </g>
      ))}

      {graph.links.map((link) => {
        const fromNodeId = interfaceById.get(link.from_interface)?.node_id;
        const toNodeId = interfaceById.get(link.to_interface)?.node_id;
        const from = fromNodeId ? layout.nodes.get(fromNodeId) : undefined;
        const to = toNodeId ? layout.nodes.get(toNodeId) : undefined;
        if (!from || !to) {
          return null;
        }

        const routeDirection = routeEdgeDirections.get(edgeKey(link.from_interface, link.to_interface));
        const isRoute = Boolean(routeDirection);
        const hasProblem = problemLinkIds.has(link.id);
        const isDimmed = hasRoute && !isRoute && !hasProblem;
        const geometry = linkGeometry(from, to);
        const routeFromNodeId = routeDirection
          ? interfaceById.get(routeDirection.from_interface)?.node_id
          : undefined;
        const routeToNodeId = routeDirection
          ? interfaceById.get(routeDirection.to_interface)?.node_id
          : undefined;
        const routeFrom = routeFromNodeId ? layout.nodes.get(routeFromNodeId) : undefined;
        const routeTo = routeToNodeId ? layout.nodes.get(routeToNodeId) : undefined;
        const routeGeometry = routeFrom && routeTo ? linkGeometry(routeFrom, routeTo) : geometry;
        const routePath = routeDirection?.from_interface === link.to_interface &&
          routeDirection.to_interface === link.from_interface
          ? routeGeometry.reversePath
          : routeGeometry.path;
        return (
          <g key={link.id}>
            <path
              className={cn(
                "topology-link",
                link.active ? "active" : "inactive",
                isRoute && "route",
                hasProblem && "problem",
                isDimmed && "dimmed",
                layout.density === "crowded" && isDimmed && "context"
              )}
              d={geometry.path}
              onClick={() => {
                onLinkSelect(link.id);
              }}
            />
            {isRoute ? (
              <circle className="route-packet" r={routePacketRadius}>
                <animateMotion dur="1.6s" path={routePath} repeatCount="indefinite" />
              </circle>
            ) : null}
          </g>
        );
      })}

      {graph.nodes.map((node) => {
        const point = layout.nodes.get(node.id);
        if (!point) {
          return null;
        }

        const interfaces = graph.interfaces.filter(
          (interfaceItem) => interfaceItem.node_id === node.id
        );
        const labelLines = nodeLabelLines(node.id);
        const nodeDown = downNodeIds.has(node.id);
        const isEndpointNode =
          interfaces.some((interfaceItem) => interfaceItem.id === fromInterface) ||
          interfaces.some((interfaceItem) => interfaceItem.id === toInterface);
        const isDimmed = hasRoute && !routeNodeIds.has(node.id) && !isEndpointNode;
        const isClientNode = nodeDeviceType(node) === "client";
        const nodeState = nodeStates.get(node.id);
        const contextNode = layout.density === "crowded" && isDimmed;
        const renderedNodeRadius = contextNode ? 7 : nodeRadius;
        const showNodeLabel =
          layout.density !== "crowded" ||
          Boolean(nodeState) ||
          isEndpointNode ||
          routeNodeIds.has(node.id);
        const showNodeStateChip =
          Boolean(nodeState) &&
          (layout.density !== "crowded" ||
            nodeState === "SOURCE" ||
            nodeState === "GOAL" ||
            nodeState === "AFFECTED" ||
            nodeState === "STOP");
        const nodeShapeClassName = cn(
          "node",
          `group-${sanitizeClassName(nodeGroupId(node))}`,
          nodeState && `state-${nodeState.toLowerCase()}`,
          draggingNodeId === node.id && "dragging",
          nodeDown && "down",
          isDimmed && "dimmed",
          contextNode && "context"
        );
        const nodeHandlers = {
          onClick: () => selectNodeUnlessDragged(node.id),
          onPointerDown: (event: ReactPointerEvent) => startNodeDrag(event, node.id),
        };

        return (
          <g key={node.id}>
            <title>{`${node.id}${interfaces.length ? ` / ${interfaces.length} interfaces` : ""}`}</title>
            {isClientNode ? (
              <circle
                className={nodeShapeClassName}
                cx={point.x}
                cy={point.y}
                r={renderedNodeRadius}
                {...nodeHandlers}
              />
            ) : (
              <rect
                className={nodeShapeClassName}
                height={renderedNodeRadius * 2}
                rx="6"
                width={renderedNodeRadius * 2}
                x={point.x - renderedNodeRadius}
                y={point.y - renderedNodeRadius}
                {...nodeHandlers}
              />
            )}
            {showNodeLabel ? (
              <text
                className={cn(
                  "node-label",
                  draggingNodeId === node.id && "dragging",
                  isDimmed && "dimmed"
                )}
                x={point.x}
                y={point.y + 4}
                onClick={() => selectNodeUnlessDragged(node.id)}
                onPointerDown={(event) => startNodeDrag(event, node.id)}
              >
                {labelLines.map((line, index) => (
                  <tspan
                    x={point.x}
                    dy={index === 0 ? `${(1 - labelLines.length) * 0.55}em` : "1.1em"}
                    key={`${line}-${index}`}
                  >
                    {line}
                  </tspan>
                ))}
              </text>
            ) : null}
            {showNodeStateChip && nodeState ? (
              <g>
                <rect
                  className={cn("node-state-chip", `state-${nodeState.toLowerCase()}`)}
                  x={point.x - nodeChipWidth / 2}
                  y={point.y + renderedNodeRadius + 10}
                  width={nodeChipWidth}
                  height="18"
                  rx="5"
                />
                <text className="node-state-label" x={point.x} y={point.y + renderedNodeRadius + 23}>
                  {nodeStateLabel(nodeState)}
                </text>
              </g>
            ) : null}
            {interfaces.map((interfaceItem, index) => {
              const angle = (Math.PI * 2 * index) / Math.max(interfaces.length, 1);
              const role =
                interfaceItem.id === fromInterface
                  ? "from"
                  : interfaceItem.id === toInterface
                    ? "to"
                    : "";
              const interfaceDown = nodeDown || downInterfaceIds.has(interfaceItem.id);
              const interfaceInRoute = routeInterfaceIds.has(interfaceItem.id);
              if (
                (interfaceDisplayMode === "compact" || layout.density === "crowded") &&
                !role &&
                !interfaceInRoute &&
                !interfaceDown
              ) {
                return null;
              }
              const interfaceLabel =
                role === "from"
                  ? "F"
                  : role === "to"
                    ? "T"
                    : interfaceDisplayMode === "detail" && layout.density === "normal"
                      ? index + 1
                      : "";
              return (
                <g key={interfaceItem.id} onClick={() => onInterfaceSelect(interfaceItem.id)}>
                  <circle
                    className={cn(
                      "interface",
                      interfaceInRoute && "route",
                      interfaceItem.id === fromInterface && "from",
                      interfaceItem.id === toInterface && "to",
                      interfaceDown && "down"
                    )}
                    cx={point.x + Math.cos(angle) * (nodeRadius + 9)}
                    cy={point.y + Math.sin(angle) * (nodeRadius + 9)}
                    r={interfaceRadius}
                  >
                    <title>{interfaceItem.id}</title>
                  </circle>
                  <text
                    className="interface-label"
                    x={point.x + Math.cos(angle) * (nodeRadius + 25)}
                    y={point.y + Math.sin(angle) * (nodeRadius + 25) + 4}
                  >
                    {interfaceLabel}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
