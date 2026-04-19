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
import type { GraphModel, InterfaceDisplayMode, LayoutDirection, RouteEdgeDirection } from "../types";
import { cn } from "./common";

const nodeRadius = 26;
const interfaceRadius = 6;

export function Topology({
  graph,
  layout,
  layoutDirection,
  interfaceDisplayMode,
  routeEdgeDirections,
  loopLinkIds,
  routeInterfaceIds,
  routeNodeIds,
  fromInterface,
  toInterface,
  downNodeIds,
  downInterfaceIds,
  onNodeSelect,
  onInterfaceSelect,
  onLinkSelect,
  onNodeMove,
}: {
  graph: GraphModel;
  layout: Map<string, { x: number; y: number }>;
  layoutDirection: LayoutDirection;
  interfaceDisplayMode: InterfaceDisplayMode;
  routeEdgeDirections: Map<string, RouteEdgeDirection>;
  loopLinkIds: Set<string>;
  routeInterfaceIds: Set<string>;
  routeNodeIds: Set<string>;
  fromInterface: string;
  toInterface: string;
  downNodeIds: Set<string>;
  downInterfaceIds: Set<string>;
  onNodeSelect: (nodeId: string) => void;
  onInterfaceSelect: (interfaceId: string) => void;
  onLinkSelect: (linkId: string) => void;
  onNodeMove: (nodeId: string, x: number, y: number) => void;
}) {
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClickNodeIdRef = useRef<string | null>(null);
  const interfaceById = new Map(
    graph.interfaces.map((interfaceItem) => [interfaceItem.id, interfaceItem])
  );
  const groups = graphGroups(graph);
  const topologyContentWidth = 1060;
  const groupWidth = topologyContentWidth / Math.max(groups.length, 1);
  const groupHeight = 404 / Math.max(groups.length, 1);
  const hasRoute = routeNodeIds.size > 0;

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    const matrix = svg.getScreenCTM();
    point.x = event.clientX;
    point.y = event.clientY;
    return matrix ? point.matrixTransform(matrix.inverse()) : point;
  }

  function startNodeDrag(event: ReactPointerEvent, nodeId: string) {
    event.stopPropagation();
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
      className="topology block h-[560px] w-full"
      viewBox="0 0 1120 460"
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
      {groups.map((group, index) => (
        <g key={group.id}>
          <rect
            className="fill-white/45 stroke-zinc-200"
            x={layoutDirection === "lr" ? 30 + index * groupWidth : 30}
            y={layoutDirection === "lr" ? 24 : 24 + index * groupHeight}
            width={layoutDirection === "lr" ? Math.max(120, groupWidth - 30) : topologyContentWidth}
            height={layoutDirection === "lr" ? 404 : Math.max(72, groupHeight - 18)}
            rx="14"
          />
          <text
            className="fill-zinc-500 text-xs font-semibold uppercase"
            x={layoutDirection === "lr" ? 30 + index * groupWidth + Math.max(120, groupWidth - 30) / 2 : 560}
            y={layoutDirection === "lr" ? 48 : 24 + index * groupHeight + 24}
          >
            {group.label}
          </text>
        </g>
      ))}

      {graph.links.map((link) => {
        const fromNodeId = interfaceById.get(link.from_interface)?.node_id;
        const toNodeId = interfaceById.get(link.to_interface)?.node_id;
        const from = fromNodeId ? layout.get(fromNodeId) : undefined;
        const to = toNodeId ? layout.get(toNodeId) : undefined;
        if (!from || !to) {
          return null;
        }

        const routeDirection = routeEdgeDirections.get(edgeKey(link.from_interface, link.to_interface));
        const isRoute = Boolean(routeDirection);
        const isLoop = loopLinkIds.has(link.id);
        const isDimmed = hasRoute && !isRoute && !isLoop;
        const geometry = linkGeometry(from, to);
        const routeFromNodeId = routeDirection
          ? interfaceById.get(routeDirection.from_interface)?.node_id
          : undefined;
        const routeToNodeId = routeDirection
          ? interfaceById.get(routeDirection.to_interface)?.node_id
          : undefined;
        const routeFrom = routeFromNodeId ? layout.get(routeFromNodeId) : undefined;
        const routeTo = routeToNodeId ? layout.get(routeToNodeId) : undefined;
        const routeGeometry = routeFrom && routeTo ? linkGeometry(routeFrom, routeTo) : geometry;
        return (
          <g key={link.id}>
            <path
              className={cn(
                "topology-link",
                link.active ? "active" : "inactive",
                isRoute && "route",
                isLoop && "loop",
                isDimmed && "dimmed"
              )}
              d={geometry.path}
              onClick={() => {
                onLinkSelect(link.id);
              }}
            />
            {isRoute ? (
              <circle className="route-packet" r="5">
                <animateMotion dur="1.6s" path={routeGeometry.path} repeatCount="indefinite" />
              </circle>
            ) : null}
          </g>
        );
      })}

      {graph.nodes.map((node) => {
        const point = layout.get(node.id);
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
        const nodeShapeClassName = cn(
          "node",
          `group-${sanitizeClassName(nodeGroupId(node))}`,
          draggingNodeId === node.id && "dragging",
          nodeDown && "down",
          isDimmed && "dimmed"
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
                r={nodeRadius}
                {...nodeHandlers}
              />
            ) : (
              <rect
                className={nodeShapeClassName}
                height={nodeRadius * 2}
                rx="6"
                width={nodeRadius * 2}
                x={point.x - nodeRadius}
                y={point.y - nodeRadius}
                {...nodeHandlers}
              />
            )}
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
                interfaceDisplayMode === "compact" &&
                !role &&
                !interfaceDown
              ) {
                return null;
              }
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
                    {role === "from" ? "F" : role === "to" ? "T" : interfaceDisplayMode === "detail" ? index + 1 : ""}
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
