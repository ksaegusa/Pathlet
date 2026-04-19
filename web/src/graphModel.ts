import { parse as parseYaml } from "yaml";
import { graphFromYangJson, isYangJsonGraph } from "./adapters/yangJson";
import type {
  GraphModel,
  InputGraphModel,
  InputRouteRequest,
  InterfaceModel,
  LayoutDirection,
  LinkModel,
  NatRuleModel,
  NetworkLayer,
  NodeDeviceType,
  NodeGroupModel,
  NodeModel,
  PolicyProtocol,
  PolicyRuleModel,
  ReachabilityScope,
  RouteEdgeDirection,
  RouteEntryModel,
  RouteRequest,
  RouteResponse,
  TrafficTestRecordModel,
  TrafficTestResultModel,
  TrafficTestSuiteModel,
  TrafficIntent,
  TrafficProtocol,
  TopologyLayoutModel,
  YangAclAttachmentModel,
  YangAclModel,
  YangInterfaceNodeModel,
  YangRoutingModel,
} from "./types";

const layerOrder: NetworkLayer[] = ["access", "edge", "core", "service"];
const layerLabels: Record<NetworkLayer, string> = {
  access: "拠点",
  edge: "WAN",
  core: "センター",
  service: "サービス",
};

const defaultGroups: NodeGroupModel[] = layerOrder.map((layer) => ({
  id: layer,
  label: layerLabels[layer],
}));

export function applyRuntimeState(
  graph: GraphModel,
  downNodeIds: Set<string>,
  downInterfaceIds: Set<string>
): GraphModel {
  const interfaceById = new Map(
    graph.interfaces.map((interfaceItem) => [interfaceItem.id, interfaceItem])
  );

  return {
    ...graph,
    links: graph.links.map((link) => {
      const fromNodeId = interfaceById.get(link.from_interface)?.node_id;
      const toNodeId = interfaceById.get(link.to_interface)?.node_id;
      const downByNode =
        (fromNodeId ? downNodeIds.has(fromNodeId) : false) ||
        (toNodeId ? downNodeIds.has(toNodeId) : false);
      const downByInterface =
        downInterfaceIds.has(link.from_interface) || downInterfaceIds.has(link.to_interface);

      return downByNode || downByInterface ? { ...link, active: false } : link;
    }),
  };
}

export function toggleSetValue(values: Set<string>, value: string) {
  const nextValues = new Set(values);
  if (nextValues.has(value)) {
    nextValues.delete(value);
  } else {
    nextValues.add(value);
  }
  return nextValues;
}

export function buildTrafficIntent(
  graph: GraphModel,
  fromInterface: string,
  toInterface: string,
  protocol: TrafficProtocol,
  port: number | undefined,
  reachable: boolean,
  scope: ReachabilityScope,
  viaNodeId: string
): TrafficIntent {
  const normalizedPort = protocol === "icmp" ? undefined : normalizeTransportPort(port);
  return {
    source_node_id: nodeIdForInterface(graph, fromInterface) ?? fromInterface,
    destination_node_id: nodeIdForInterface(graph, toInterface) ?? toInterface,
    protocol,
    port: normalizedPort,
    expectations: {
      reachable,
      scope,
      via_node_id: viaNodeId || undefined,
      strict_path: false,
    },
  };
}

export function buildTrafficSpec(
  graph: GraphModel,
  fromInterface: string,
  toInterface: string,
  protocol: TrafficProtocol,
  port: number | undefined
): RouteRequest["traffic"] {
  return {
    protocol,
    port: protocol === "icmp" ? undefined : normalizeTransportPort(port),
    source: graph.interfaces.find((interfaceItem) => interfaceItem.id === fromInterface)?.ip_address,
    destination: graph.interfaces.find((interfaceItem) => interfaceItem.id === toInterface)?.ip_address,
  };
}

export function normalizeTransportPort(port: number | undefined) {
  if (typeof port !== "number" || !Number.isInteger(port)) {
    return 1;
  }
  return clamp(port, 1, 65535);
}

export function nodeIdForInterface(graph: GraphModel, interfaceId: string) {
  return graph.interfaces.find((interfaceItem) => interfaceItem.id === interfaceId)?.node_id;
}

export function linkNodeIds(graph: GraphModel, link: LinkModel) {
  return [
    nodeIdForInterface(graph, link.from_interface),
    nodeIdForInterface(graph, link.to_interface),
  ].filter((nodeId): nodeId is string => Boolean(nodeId));
}

export function interfaceLabel(graph: GraphModel, interfaceId: string) {
  const interfaceItem = graph.interfaces.find((item) => item.id === interfaceId);
  return interfaceItem?.ip_address ? `${interfaceId} (${interfaceItem.ip_address})` : interfaceId;
}

export function interfaceIpAddress(value: string) {
  return value.split("/")[0] ?? value;
}

export function interfacePrefixLength(value: string) {
  const prefixLength = Number(value.split("/")[1]);
  return Number.isInteger(prefixLength) ? prefixLength : undefined;
}

export function linkCostFromBandwidth(bandwidthMbps: number, referenceBandwidthMbps = 100000) {
  if (!Number.isFinite(bandwidthMbps) || bandwidthMbps <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(referenceBandwidthMbps / bandwidthMbps));
}

export function formatBandwidth(bandwidthMbps: number | undefined) {
  if (!bandwidthMbps) {
    return "-";
  }
  if (bandwidthMbps >= 1000) {
    return `${bandwidthMbps / 1000}Gbps`;
  }
  return `${bandwidthMbps}Mbps`;
}

export function routeSegmentsFromPath(path: string[], graph: GraphModel) {
  const interfaceById = new Map(
    graph.interfaces.map((interfaceItem) => [interfaceItem.id, interfaceItem])
  );
  const linkByEdge = new Map(
    graph.links.map((link) => [edgeKey(link.from_interface, link.to_interface), link])
  );
  const compactPath = compactInternalHops(path, graph);

  return compactPath.flatMap((fromInterfaceId, index) => {
    const toInterfaceId = compactPath[index + 1];
    if (!toInterfaceId) {
      return [];
    }

    const link = linkByEdge.get(edgeKey(fromInterfaceId, toInterfaceId));
    const fromNodeId = interfaceById.get(fromInterfaceId)?.node_id;
    const toNodeId = interfaceById.get(toInterfaceId)?.node_id;
    if (!link || !fromNodeId || !toNodeId) {
      return [];
    }

    return [{ link, fromNodeId, toNodeId }];
  });
}

export function nodeIdsFromPath(path: string[], graph: GraphModel) {
  const interfaceById = new Map(
    graph.interfaces.map((interfaceItem) => [interfaceItem.id, interfaceItem])
  );
  const nodeIds = compactInternalHops(path, graph).flatMap((interfaceId) => {
    const nodeId = interfaceById.get(interfaceId)?.node_id;
    return nodeId ? [nodeId] : [];
  });

  return nodeIds.filter((nodeId, index) => nodeId !== nodeIds[index - 1]);
}

export function virtualIpForInterface(graph: GraphModel, interfaceId: string) {
  const nodeId = graph.interfaces.find((interfaceItem) => interfaceItem.id === interfaceId)?.node_id;
  return (graph.virtual_ips ?? []).find((virtualIp) => virtualIp.service_node_id === nodeId);
}

export function graphGroups(graph: GraphModel) {
  const groups = graph.groups?.length ? graph.groups : defaultGroups;
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const missingGroups = graph.nodes
    .map(nodeGroupId)
    .filter((groupId, index, groupIds) => !knownGroupIds.has(groupId) && groupIds.indexOf(groupId) === index)
    .map((groupId) => ({ id: groupId, label: groupId }));

  return [...groups, ...missingGroups];
}

export function nodeGroupId(node: NodeModel) {
  return node.group_id ?? node.layer ?? "core";
}

export function nodeDeviceType(node: NodeModel): NodeDeviceType {
  return node.device_type ?? "network_device";
}

export function nodeDeviceTypeLabel(deviceType: NodeDeviceType) {
  return deviceType === "client" ? "Client" : "Network Device";
}

export function nodeCapabilities(node: NodeModel) {
  if (nodeDeviceType(node) === "client") {
    return {
      maxInterfaces: 1,
      canEditRouting: true,
      canEditPolicy: false,
      canEditNat: false,
      canHostVip: false,
      defaultRouteOnly: true,
    };
  }

  return {
    maxInterfaces: undefined,
    canEditRouting: true,
    canEditPolicy: true,
    canEditNat: true,
    canHostVip: true,
    defaultRouteOnly: false,
  };
}

export function groupLabel(graph: GraphModel, groupId: string) {
  return graphGroups(graph).find((group) => group.id === groupId)?.label ?? groupId;
}

export function sanitizeClassName(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}

export function buildLayout(graph: GraphModel, direction: LayoutDirection) {
  const layout = new Map<string, { x: number; y: number }>();
  const groups = graphGroups(graph);
  const topologyContentWidth = Math.max(1060, graph.nodes.length * 34);
  const groupWidth = topologyContentWidth / Math.max(groups.length, 1);
  const topologyContentHeight = Math.max(404, graph.nodes.length * 18);
  const groupHeight = topologyContentHeight / Math.max(groups.length, 1);

  groups.forEach((group, groupIndex) => {
    const nodes = graph.nodes.filter((node) => nodeGroupId(node) === group.id);
    nodes.forEach((node, index) => {
      const verticalSpacing = Math.max(58, (topologyContentHeight - 64) / Math.max(nodes.length, 1));
      const horizontalSpacing = Math.max(84, (topologyContentWidth - 80) / Math.max(nodes.length, 1));
      const autoX =
        direction === "lr"
          ? 30 + groupIndex * groupWidth + Math.max(120, groupWidth - 30) / 2
          : 70 + horizontalSpacing / 2 + index * horizontalSpacing;
      const autoY =
        direction === "lr"
            ? 70 + verticalSpacing / 2 + index * verticalSpacing
            : 24 + groupIndex * groupHeight + Math.max(72, groupHeight - 18) / 2 + 10;
      layout.set(node.id, {
        x: node.x ?? autoX,
        y: node.y ?? autoY,
      });
    });
  });

  return {
    nodes: layout,
    width: topologyContentWidth + 60,
    height: topologyContentHeight + 56,
    density: layoutDensityForNodeCount(graph.nodes.length),
    engine: "fallback",
  } satisfies TopologyLayoutModel;
}

export function layoutDensityForNodeCount(nodeCount: number) {
  if (nodeCount >= 80) {
    return "crowded";
  }
  if (nodeCount >= 36) {
    return "dense";
  }
  return "normal";
}

export function nodeLabelLines(nodeId: string) {
  const segments = nodeId.split(/[-_]/).filter(Boolean);
  if (segments.length <= 1) {
    return [shortenNodeLabel(nodeId)];
  }

  return [shortenNodeLabel(segments[0]), shortenNodeLabel(segments.at(-1) ?? "")];
}

function shortenNodeLabel(label: string) {
  const maxLength = 8;
  if (label.length <= maxLength) {
    return label;
  }

  return `${label.slice(0, maxLength - 3)}...`;
}

export function linkGeometry(from: { x: number; y: number }, to: { x: number; y: number }) {
  return {
    path: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
  };
}

export function routeDirectionsFromPath(routeResponse: RouteResponse | null, graph: GraphModel) {
  const edges = new Map<string, RouteEdgeDirection>();
  if (!routeResponse?.ok) {
    return edges;
  }

  for (const path of routeResponse.equal_cost_paths ?? [routeResponse.path]) {
    const compactPath = compactInternalHops(path, graph);
    for (let index = 0; index < compactPath.length - 1; index += 1) {
      const fromInterface = compactPath[index];
      const toInterface = compactPath[index + 1];
      const key = edgeKey(fromInterface, toInterface);
      if (!edges.has(key)) {
        edges.set(key, {
          from_interface: fromInterface,
          to_interface: toInterface,
        });
      }
    }
  }
  return edges;
}

export function interfaceIdsFromPath(routeResponse: RouteResponse | null) {
  if (!routeResponse?.ok) {
    return new Set<string>();
  }
  return new Set((routeResponse.equal_cost_paths ?? [routeResponse.path]).flat());
}

export function nodeIdsFromRoute(routeResponse: RouteResponse | null, graph: GraphModel) {
  if (!routeResponse?.ok) {
    return new Set<string>();
  }
  return new Set(
    (routeResponse.equal_cost_paths ?? [routeResponse.path]).flatMap((path) => nodeIdsFromPath(path, graph))
  );
}

export function loopLinkIdsFromRoute(routeResponse: RouteResponse | null, graph: GraphModel) {
  const loopLinkIds = new Set<string>();
  if (!routeResponse?.ok) {
    return loopLinkIds;
  }
  for (const linkId of routeResponse.loop_link_ids ?? []) {
    loopLinkIds.add(linkId);
  }

  const interfaceById = new Map(
    graph.interfaces.map((interfaceItem) => [interfaceItem.id, interfaceItem])
  );
  const linkByEdge = new Map(
    graph.links.map((link) => [edgeKey(link.from_interface, link.to_interface), link])
  );

  for (const path of routeResponse.equal_cost_paths ?? [routeResponse.path]) {
    const compactPath = compactInternalHops(path, graph);
    const lastIndexByNodeId = new Map<string, number>();

    compactPath.forEach((interfaceId, index) => {
      const nodeId = interfaceById.get(interfaceId)?.node_id;
      if (!nodeId) {
        return;
      }

      const previousIndex = lastIndexByNodeId.get(nodeId);
      if (previousIndex !== undefined) {
        for (let segmentIndex = previousIndex; segmentIndex < index; segmentIndex += 1) {
          const fromInterfaceId = compactPath[segmentIndex];
          const toInterfaceId = compactPath[segmentIndex + 1];
          const link = toInterfaceId
            ? linkByEdge.get(edgeKey(fromInterfaceId, toInterfaceId))
            : undefined;
          if (link) {
            loopLinkIds.add(link.id);
          }
        }
      }

      lastIndexByNodeId.set(nodeId, index);
    });
  }

  return loopLinkIds;
}

function compactInternalHops(path: string[], graph: GraphModel) {
  const interfaceById = new Map(
    graph.interfaces.map((interfaceItem) => [interfaceItem.id, interfaceItem])
  );

  return path.filter((interfaceId, index) => {
    const previous = path[index - 1];
    const next = path[index + 1];
    if (!previous || !next) {
      return true;
    }

    const currentInterface = interfaceById.get(interfaceId);
    const previousInterface = interfaceById.get(previous);
    const nextInterface = interfaceById.get(next);
    return !(
      currentInterface &&
      previousInterface &&
      nextInterface &&
      currentInterface.node_id === previousInterface.node_id &&
      currentInterface.node_id === nextInterface.node_id
    );
  });
}

export function edgeKey(a: string, b: string) {
  return [a, b].sort().join("::");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function optionalNumber(value: string) {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

export function parseTopologyText(input: string, fileName: string): InputGraphModel | InputRouteRequest {
  const isYaml = /\.(ya?ml)$/i.test(fileName);
  const parsed = isYaml ? parseYaml(input) : JSON.parse(input);
  if (!isRecord(parsed)) {
    throw new Error("トポロジJSON/YAMLが不正です");
  }
  return parsed as InputGraphModel | InputRouteRequest;
}

export function parseTestSuiteText(input: string, fileName: string): TrafficTestSuiteModel {
  const isYaml = /\.(ya?ml)$/i.test(fileName);
  const parsed = isYaml ? parseYaml(input) : JSON.parse(input);
  if (!isRecord(parsed)) {
    throw new Error("試験JSON/YAMLが不正です");
  }

  const tests = Array.isArray(parsed.tests) ? parsed.tests : Array.isArray(parsed) ? parsed : undefined;
  if (!tests) {
    throw new Error("tests を持つ試験ファイルを指定してください");
  }

  return {
    version: 1,
    tests: tests.map((test, index) => cleanTrafficTestRecord(test, index)),
  };
}

export function exportableTestSuite(tests: TrafficTestRecordModel[]): TrafficTestSuiteModel {
  return {
    version: 1,
    tests: tests.map(cleanTrafficTestRecord),
  };
}

export function routeRequestOrGraphToGraph(parsed: unknown): GraphModel {
  if (!isRecord(parsed)) {
    throw new Error("nodes/interfaces/links を持つGraphModelまたはRouteRequestを指定してください");
  }
  const nextGraph = "graph" in parsed ? parsed.graph : parsed;
  if (isYangJsonGraph(nextGraph)) {
    return normalizeGraphModel(graphFromYangJson(nextGraph));
  }
  if (!isRecord(nextGraph) || !Array.isArray(nextGraph.nodes) || !Array.isArray(nextGraph.interfaces) || !Array.isArray(nextGraph.links)) {
    throw new Error("nodes/interfaces/links を持つGraphModelまたはRouteRequestを指定してください");
  }
  return normalizeGraphModel(nextGraph as InputGraphModel);
}

export function buildRouteRequestFromTest(graph: GraphModel, test: TrafficTestRecordModel): RouteRequest {
  const fromInterface = resolveInterfaceByIp(graph, test.source);
  const toInterface = resolveInterfaceByIp(graph, test.destination);
  if (!fromInterface) {
    throw new Error(`送信元IP '${test.source}' に一致するインターフェースがありません`);
  }
  if (!toInterface) {
    throw new Error(`宛先IP '${test.destination}' に一致するインターフェースがありません`);
  }

  return {
    graph,
    from_interface: fromInterface.id,
    to_interface: toInterface.id,
    mode: "routing_table",
    traffic: {
      protocol: test.protocol,
      port: test.protocol === "icmp" ? undefined : normalizeTransportPort(test.port),
      source: test.source,
      destination: test.destination,
    },
  };
}

export function evaluateTrafficTest(
  test: TrafficTestRecordModel,
  response: RouteResponse,
  _graph: GraphModel
): TrafficTestResultModel {
  if (!response.ok) {
    return {
      test_id: test.id,
      status: test.expectations.reachable ? "fail" : "pass",
      message: response.error.message,
      response,
    };
  }

  const scope = test.expectations.scope ?? "round_trip";
  const routeStatus = scope === "forward_only"
    ? response.forward?.status ?? response.status ?? "reachable"
    : response.status ?? "reachable";
  const failures = [
    test.expectations.reachable !== (routeStatus === "reachable")
      ? `到達性: 期待 ${test.expectations.reachable ? "到達可能" : "到達不可"} / 実際 ${routeStatus}`
      : undefined,
  ].filter((failure): failure is string => Boolean(failure));

  return {
    test_id: test.id,
    status: failures.length ? "fail" : "pass",
    message: failures.length ? failures.join(" / ") : "期待値に一致しました",
    response,
  };
}

export function resolveInterfaceByIp(graph: GraphModel, ip: string) {
  const targetIp = interfaceIpAddress(ip.trim());
  return graph.interfaces.find((interfaceItem) =>
    interfaceItem.ip_address ? interfaceIpAddress(interfaceItem.ip_address) === targetIp : false
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function downloadTextFile(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function serializableGraph(graph: GraphModel): GraphModel {
  return JSON.parse(JSON.stringify(graph)) as GraphModel;
}

export function exportableGraph(graph: GraphModel) {
  const { interfaces, ...rest } = serializableGraph(graph);
  return JSON.parse(JSON.stringify({
    ...rest,
    interfaces: interfacesToYangNodes(interfaces),
  }));
}

function normalizeGraphModel(graph: InputGraphModel): GraphModel {
  return {
    ...graph,
    interfaces: interfaceEntriesFromInput(graph.interfaces),
  };
}

function interfaceEntriesFromInput(interfaces: InterfaceModel[] | YangInterfaceNodeModel[]): InterfaceModel[] {
  if (!interfaces.length || "id" in interfaces[0]) {
    return interfaces as InterfaceModel[];
  }

  return (interfaces as YangInterfaceNodeModel[]).flatMap((nodeInterfaces) =>
    nodeInterfaces.interfaces.interface.map((interfaceItem) => {
      const address = interfaceItem.ipv4?.address?.[0];
      return {
        id: interfaceItem.name,
        node_id: nodeInterfaces.node_id,
        ip_address: address
          ? `${address.ip}${typeof address.prefix_length === "number" ? `/${address.prefix_length}` : ""}`
          : undefined,
        vrf_id: interfaceItem.vrf_id,
        vlan_id: interfaceItem.vlan_id,
      };
    })
  );
}

function interfacesToYangNodes(interfaces: InterfaceModel[]): YangInterfaceNodeModel[] {
  const interfacesByNode = new Map<string, InterfaceModel[]>();
  for (const interfaceItem of interfaces) {
    interfacesByNode.set(interfaceItem.node_id, [...(interfacesByNode.get(interfaceItem.node_id) ?? []), interfaceItem]);
  }

  return [...interfacesByNode.entries()].map(([nodeId, nodeInterfaces]) => ({
    node_id: nodeId,
    interfaces: {
      interface: nodeInterfaces.map((interfaceItem) => ({
        name: interfaceItem.id,
        enabled: true,
        ipv4: interfaceItem.ip_address
          ? {
              address: [
                {
                  ip: interfaceIpAddress(interfaceItem.ip_address),
                  prefix_length: interfacePrefixLength(interfaceItem.ip_address),
                },
              ],
            }
          : undefined,
        vrf_id: interfaceItem.vrf_id,
        vlan_id: interfaceItem.vlan_id,
      })),
    },
  }));
}

export function graphWithRoutes(graph: GraphModel, routes: RouteEntryModel[]): GraphModel {
  const { routes: _routes, ...rest } = graph;
  return {
    ...rest,
    routing: routesToYangRouting(routes.map(cleanRouteEntry)),
  };
}

export function routeEntriesFromGraph(graph: GraphModel): RouteEntryModel[] {
  if (!graph.routing?.length) {
    return graph.routes ?? [];
  }

  return graph.routing.flatMap((nodeRouting) =>
    nodeRouting.routing.control_plane_protocols.flatMap((protocol) =>
      protocol.static_routes.ipv4.map((route) => ({
        id: route.name,
        node_id: nodeRouting.node_id,
        destination: route.destination_prefix,
        next_hop: route.next_hop?.next_hop_node ?? route.next_hop?.next_hop_address,
        egress_interface: route.next_hop?.outgoing_interface,
        metric: route.metric,
        administrative_distance: route.administrative_distance,
        vrf_id: route.vrf_id,
        vlan_id: route.vlan_id,
        active: route.active,
      }))
    )
  );
}

export function routesToYangRouting(routes: RouteEntryModel[]): YangRoutingModel[] {
  const routesByNodeId = new Map<string, RouteEntryModel[]>();
  for (const route of routes) {
    routesByNodeId.set(route.node_id, [...(routesByNodeId.get(route.node_id) ?? []), route]);
  }

  return [...routesByNodeId.entries()].map(([nodeId, nodeRoutes]) => ({
    node_id: nodeId,
    routing: {
      control_plane_protocols: [
        {
          type: "static",
          name: "static",
          static_routes: {
            ipv4: nodeRoutes.map((route) => ({
              name: route.id,
              destination_prefix: route.destination,
              next_hop: (route.next_hop || route.egress_interface)
                ? {
                    next_hop_node: route.next_hop,
                    outgoing_interface: route.egress_interface,
                  }
                : undefined,
              metric: route.metric,
              administrative_distance: route.administrative_distance,
              vrf_id: route.vrf_id,
              vlan_id: route.vlan_id,
              active: route.active,
            })),
          },
        },
      ],
    },
  }));
}

export function graphWithPolicies(graph: GraphModel, policies: PolicyRuleModel[]): GraphModel {
  const { policies: _policies, ...rest } = graph;
  return {
    ...rest,
    acls: policiesToYangAcls(policies.map(cleanPolicyRule)),
    acl_attachments: policiesToYangAclAttachments(policies.map(cleanPolicyRule)),
  };
}

export function policyRulesFromGraph(graph: GraphModel): PolicyRuleModel[] {
  if (!graph.acls?.length) {
    return graph.policies ?? [];
  }

  const aclByName = new Map(graph.acls.map((acl) => [acl.name, acl]));
  return (graph.acl_attachments ?? []).flatMap((attachment) =>
    (["ingress", "egress"] as const).flatMap((direction) =>
      (attachment[direction] ?? []).flatMap((aclName) => {
        const acl = aclByName.get(aclName);
        return (acl?.aces ?? []).map((ace) => {
          const protocol = policyProtocolFromAce(ace);
          return {
            id: policyRuleId(attachment.node_id, attachment.interface_id, direction, aclName, ace.name),
            node_id: attachment.node_id,
            interface_id: attachment.interface_id,
            acl_name: aclName,
            ace_name: ace.name,
            name: ace.name,
            direction,
            action: ace.actions.forwarding === "accept" ? "permit" : "deny",
            protocol,
            source: ace.matches.ipv4?.source_ipv4_network ?? "any",
            destination: ace.matches.ipv4?.destination_ipv4_network ?? "any",
            port: policyPortFromAce(ace),
            active: ace.active ?? true,
          } satisfies PolicyRuleModel;
        });
      })
    )
  );
}

export function policiesToYangAcls(policies: PolicyRuleModel[]): YangAclModel[] {
  const policiesByAclName = new Map<string, PolicyRuleModel[]>();
  for (const policy of policies) {
    policiesByAclName.set(policy.acl_name, [...(policiesByAclName.get(policy.acl_name) ?? []), policy]);
  }

  return [...policiesByAclName.entries()].map(([aclName, aclPolicies]) => ({
    name: aclName,
    type: "ipv4-acl",
    aces: aclPolicies.map((policy) => ({
      name: policy.ace_name,
      active: policy.active,
      matches: {
        ipv4: {
          source_ipv4_network: policy.source === "any" ? undefined : policy.source,
          destination_ipv4_network: policy.destination === "any" ? undefined : policy.destination,
        },
        tcp: policy.protocol === "tcp" && policy.port
          ? { destination_port: { operator: "eq", port: policy.port } }
          : undefined,
        udp: policy.protocol === "udp" && policy.port
          ? { destination_port: { operator: "eq", port: policy.port } }
          : undefined,
        icmp: policy.protocol === "icmp" ? {} : undefined,
      },
      actions: {
        forwarding: policy.action === "permit" ? "accept" : "drop",
      },
    })),
  }));
}

export function policiesToYangAclAttachments(policies: PolicyRuleModel[]): YangAclAttachmentModel[] {
  const attachmentsByNodeId = new Map<string, YangAclAttachmentModel>();
  for (const policy of policies) {
    const attachmentKey = `${policy.node_id}::${policy.interface_id ?? ""}`;
    const attachment = attachmentsByNodeId.get(attachmentKey) ?? {
      node_id: policy.node_id,
      interface_id: policy.interface_id,
    };
    const aclNames = attachment[policy.direction] ?? [];
    if (!aclNames.includes(policy.acl_name)) {
      attachment[policy.direction] = [...aclNames, policy.acl_name];
    }
    attachmentsByNodeId.set(attachmentKey, attachment);
  }
  return [...attachmentsByNodeId.values()];
}

function policyProtocolFromAce(ace: YangAclModel["aces"][number]): PolicyProtocol {
  if (ace.matches.tcp) {
    return "tcp";
  }
  if (ace.matches.udp) {
    return "udp";
  }
  if (ace.matches.icmp) {
    return "icmp";
  }
  return "any";
}

function policyPortFromAce(ace: YangAclModel["aces"][number]) {
  return ace.matches.tcp?.destination_port?.port ?? ace.matches.udp?.destination_port?.port;
}

function policyRuleId(nodeId: string, interfaceId: string | undefined, direction: string, aclName: string, aceName: string) {
  return `${nodeId}::${interfaceId ?? "node"}::${direction}::${aclName}::${aceName}`;
}

export function linkEndpointInterfaceId(linkId: string, nodeId: string) {
  return `${nodeId}-${linkId}-if`.replaceAll(/[^a-zA-Z0-9-]+/g, "-");
}

export function cleanRouteEntry(route: RouteEntryModel): RouteEntryModel {
  return {
    ...route,
    next_hop: route.next_hop?.trim() || undefined,
    egress_interface: route.egress_interface?.trim() || undefined,
    vrf_id: route.vrf_id?.trim() || undefined,
    administrative_distance: Number.isFinite(route.administrative_distance) ? route.administrative_distance : undefined,
    vlan_id: Number.isFinite(route.vlan_id) ? route.vlan_id : undefined,
  };
}

export function cleanPolicyRule(policy: PolicyRuleModel): PolicyRuleModel {
  const protocol = policy.protocol;
  const aceName = policy.name?.trim() || policy.ace_name || "policy";
  return {
    ...policy,
    name: aceName,
    ace_name: aceName,
    acl_name: policy.acl_name.trim() || `${policy.node_id}-${policy.direction}`,
    source: policy.source.trim() || "any",
    destination: policy.destination.trim() || "any",
    port: protocol === "tcp" || protocol === "udp" ? normalizeTransportPort(policy.port) : undefined,
  };
}

export function cleanNatRule(rule: NatRuleModel): NatRuleModel {
  const protocol = rule.protocol ?? "any";
  return {
    ...rule,
    interface_id: rule.interface_id?.trim() || undefined,
    original: rule.original.trim() || "any",
    translated: rule.translated.trim(),
    protocol,
    port: protocol === "tcp" || protocol === "udp" ? normalizeTransportPort(rule.port) : undefined,
  };
}

export function cleanTrafficTestRecord(input: unknown, index = 0): TrafficTestRecordModel {
  const record = isRecord(input) ? input : {};
  const protocol = isTrafficProtocol(record.protocol) ? record.protocol : "tcp";
  const expectations = isRecord(record.expectations) ? record.expectations : {};
  const scope = expectations.scope === "forward_only" ? "forward_only" : "round_trip";
  return {
    id: stringValue(record.id, `test-${index + 1}`),
    name: stringValue(record.name, "") || undefined,
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    source: stringValue(record.source, ""),
    destination: stringValue(record.destination, ""),
    protocol,
    port: protocol === "icmp" ? undefined : normalizeTransportPort(numberValue(record.port, 443)),
    expectations: {
      reachable: typeof expectations.reachable === "boolean" ? expectations.reachable : true,
      scope,
    },
  };
}

export function uniqueRouteId(graph: GraphModel, nodeId: string) {
  const base = `${nodeId}-route`.replaceAll(/[^a-zA-Z0-9-]+/g, "-");
  let candidate = base;
  let suffix = 2;

  while (routeEntriesFromGraph(graph).some((route) => route.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export function uniquePolicyId(graph: GraphModel, nodeId: string) {
  const base = `${nodeId}-policy`.replaceAll(/[^a-zA-Z0-9-]+/g, "-");
  let candidate = base;
  let suffix = 2;

  while (policyRulesFromGraph(graph).some((policy) => policy.id === candidate || policy.ace_name === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export function uniqueNatRuleId(graph: GraphModel, nodeId: string) {
  const base = `${nodeId}-nat`.replaceAll(/[^a-zA-Z0-9-]+/g, "-");
  let candidate = base;
  let suffix = 2;

  while ((graph.nat_rules ?? []).some((rule) => rule.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export function uniqueTrafficTestId(tests: TrafficTestRecordModel[]) {
  let suffix = tests.length + 1;
  let candidate = `test-${suffix}`;

  while (tests.some((test) => test.id === candidate)) {
    suffix += 1;
    candidate = `test-${suffix}`;
  }

  return candidate;
}

export function uniqueLinkId(graph: GraphModel, fromInterface: string, toInterface: string) {
  const base = `${fromInterface}-to-${toInterface}`.replaceAll(/[^a-zA-Z0-9-]+/g, "-");
  let candidate = base;
  let suffix = 2;

  while (graph.links.some((link) => link.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function isTrafficProtocol(value: unknown): value is TrafficProtocol {
  return value === "icmp" || value === "tcp" || value === "udp";
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value.trim() : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function interfaceForNewLinkEndpoint(graph: GraphModel, nodeId: string, linkId: string) {
  const node = graph.nodes.find((nodeItem) => nodeItem.id === nodeId);
  const maxInterfaces = node ? nodeCapabilities(node).maxInterfaces : undefined;
  if (typeof maxInterfaces === "number") {
    const interfaces = graph.interfaces.filter((interfaceItem) => interfaceItem.node_id === nodeId);
    const interfaceIds = new Set(interfaces.map((interfaceItem) => interfaceItem.id));
    const alreadyConnected = graph.links.some(
      (link) => interfaceIds.has(link.from_interface) || interfaceIds.has(link.to_interface)
    );
    if (interfaces.length >= maxInterfaces && alreadyConnected) {
      return undefined;
    }
    return interfaces[0]?.id ?? uniqueInterfaceId(graph, nodeId, linkId);
  }
  return uniqueInterfaceId(graph, nodeId, linkId);
}

function uniqueInterfaceId(graph: GraphModel, nodeId: string, linkId: string) {
  const base = linkEndpointInterfaceId(linkId, nodeId);
  let candidate = base;
  let suffix = 2;

  while (graph.interfaces.some((interfaceItem) => interfaceItem.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}
