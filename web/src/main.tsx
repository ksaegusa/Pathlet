import { ChangeEvent, ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Cable, FileDown, FileJson, GitBranch, Network, Shield, Zap } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { stringify as stringifyYaml } from "yaml";
import { exampleGraph } from "./exampleGraph";
import {
  applyRuntimeState,
  buildLayout,
  buildTrafficIntent,
  buildTrafficSpec,
  clamp,
  cleanNatRule,
  cleanPolicyRule,
  cleanRouteEntry,
  downloadTextFile,
  edgeKey,
  exportableGraph,
  formatBandwidth,
  graphGroups,
  graphWithPolicies,
  graphWithRoutes,
  groupLabel,
  interfaceForNewLinkEndpoint,
  interfaceIdsFromPath,
  interfaceLabel,
  linkEndpointInterfaceId,
  linkGeometry,
  linkNodeIds,
  nodeCapabilities,
  loopLinkIdsFromRoute,
  nodeDeviceType,
  nodeDeviceTypeLabel,
  nodeGroupId,
  nodeIdsFromPath,
  nodeIdsFromRoute,
  nodeLabelLines,
  normalizeTransportPort,
  optionalNumber,
  parseTopologyText,
  policyRulesFromGraph,
  routeDirectionsFromPath,
  routeEntriesFromGraph,
  routeRequestOrGraphToGraph,
  routeSegmentsFromPath,
  sanitizeClassName,
  toggleSetValue,
  uniqueLinkId,
  uniqueNatRuleId,
  uniquePolicyId,
  uniqueRouteId,
  virtualIpForInterface,
} from "./graphModel";
import type {
  ActiveModal,
  GraphModel,
  InterfaceDisplayMode,
  LayoutDirection,
  LinkModel,
  NatRuleModel,
  NodeDeviceType,
  NodeGroupModel,
  NodeModel,
  PolicyProtocol,
  PolicyRuleModel,
  RouteEntryModel,
  RouteEdgeDirection,
  RouteMode,
  RouteRequest,
  RouteResponse,
  RouteStatus,
  TrafficIntent,
  TrafficProtocol,
  WasmModule,
} from "./types";
import initWasm, { shortest_path } from "./wasm/pathlet_wasm.js";
import "./styles.css";

const nodeRadius = 26;
const interfaceRadius = 6;

function App() {
  const [graph, setGraph] = useState<GraphModel>(exampleGraph);
  const [fromInterface, setFromInterface] = useState(linkEndpointInterfaceId("osaka-office-wan", "osaka-office"));
  const [toInterface, setToInterface] = useState("primary-center-erp-vip-if");
  const [routeResponse, setRouteResponse] = useState<RouteResponse | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<"from" | "to">("from");
  const [status, setStatus] = useState("準備完了");
  const [selectedLinkId, setSelectedLinkId] = useState("osaka-primary");
  const [selectedNodeId, setSelectedNodeId] = useState("osaka-office");
  const [activeModal, setActiveModal] = useState<ActiveModal | null>(null);
  const [newNodeId, setNewNodeId] = useState("");
  const [newNodeDeviceType, setNewNodeDeviceType] = useState<NodeDeviceType>("network_device");
  const [newNodeGroupId, setNewNodeGroupId] = useState("edge");
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [newLinkFrom, setNewLinkFrom] = useState("osaka-office");
  const [newLinkTo, setNewLinkTo] = useState("osaka-wan");
  const [newLinkCost, setNewLinkCost] = useState(5);
  const [trafficProtocol, setTrafficProtocol] = useState<TrafficProtocol>("tcp");
  const [trafficPort, setTrafficPort] = useState(443);
  const [expectedReachable, setExpectedReachable] = useState(true);
  const [expectedViaNodeId, setExpectedViaNodeId] = useState("primary-center");
  const [downNodeIds, setDownNodeIds] = useState<Set<string>>(() => new Set());
  const [downInterfaceIds, setDownInterfaceIds] = useState<Set<string>>(() => new Set());
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>("lr");
  const [routeMode, setRouteMode] = useState<RouteMode>("routing_table");
  const [interfaceDisplayMode, setInterfaceDisplayMode] = useState<InterfaceDisplayMode>("compact");

  const effectiveGraph = useMemo(
    () => applyRuntimeState(graph, downNodeIds, downInterfaceIds),
    [graph, downNodeIds, downInterfaceIds]
  );
  const groups = useMemo(() => graphGroups(graph), [graph]);
  const routeEdgeDirections = useMemo(() => routeDirectionsFromPath(routeResponse, effectiveGraph), [routeResponse, effectiveGraph]);
  const loopLinkIds = useMemo(() => loopLinkIdsFromRoute(routeResponse, effectiveGraph), [routeResponse, effectiveGraph]);
  const routeInterfaceIds = useMemo(() => interfaceIdsFromPath(routeResponse), [routeResponse]);
  const routeNodeIds = useMemo(() => nodeIdsFromRoute(routeResponse, effectiveGraph), [routeResponse, effectiveGraph]);
  const trafficIntent = useMemo(
    () =>
      buildTrafficIntent(
        graph,
        fromInterface,
        toInterface,
        trafficProtocol,
        trafficProtocol === "icmp" ? undefined : trafficPort,
        expectedReachable,
        expectedViaNodeId
      ),
    [graph, fromInterface, toInterface, trafficProtocol, trafficPort, expectedReachable, expectedViaNodeId]
  );
  const layout = useMemo(() => buildLayout(graph, layoutDirection), [graph, layoutDirection]);
  const activeLinkCount = effectiveGraph.links.filter((link) => link.active).length;
  const downLinkCount = effectiveGraph.links.length - activeLinkCount;
  const selectedCost = routeResponse?.ok ? routeResponse.cost : "-";

  useEffect(() => {
    void calculateRoute(effectiveGraph, fromInterface, toInterface);
  }, [effectiveGraph, fromInterface, toInterface, routeMode, trafficProtocol, trafficPort]);

  async function calculateRoute(
    nextGraph = effectiveGraph,
    nextFromInterface = fromInterface,
    nextToInterface = toInterface,
    nextRouteMode = routeMode
  ) {
    const request: RouteRequest = {
      graph: nextGraph,
      from_interface: nextFromInterface,
      to_interface: nextToInterface,
      mode: nextRouteMode,
      traffic: buildTrafficSpec(nextGraph, nextFromInterface, nextToInterface, trafficProtocol, trafficProtocol === "icmp" ? undefined : trafficPort),
    };

    try {
      const wasm = await loadWasm();
      const response = JSON.parse(wasm.shortest_path(JSON.stringify(request))) as RouteResponse;
      setRouteResponse(response);
      setStatus(response.ok ? routeStatusLabel(response.status) : response.error.message);
    } catch (error) {
      setRouteResponse(null);
      setStatus(error instanceof Error ? error.message : "WASMの読み込みに失敗しました");
    }
  }

  async function importGraph(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const parsed = parseTopologyText(await file.text(), file.name);
      const nextGraph = routeRequestOrGraphToGraph(parsed);
      const firstInterface = nextGraph.interfaces[0]?.id ?? "";
      const lastInterface = nextGraph.interfaces.at(-1)?.id ?? "";

      setGraph(nextGraph);
      setDownNodeIds(new Set());
      setDownInterfaceIds(new Set());
      setFromInterface(firstInterface);
      setToInterface(lastInterface);
      setRouteResponse(null);
      setStatus(`${file.name} を読み込みました`);
      void calculateRoute(nextGraph, firstInterface, lastInterface);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "トポロジJSON/YAMLが不正です");
    }
  }

  function exportGraphAsYaml() {
    downloadTextFile("pathlet-topology.yaml", stringifyYaml(exportableGraph(graph)), "application/yaml;charset=utf-8");
    setStatus("YAMLをExportしました");
  }

  function toggleLink(linkId: string) {
    const nextGraph = {
      ...graph,
      links: graph.links.map((link) =>
        link.id === linkId ? { ...link, active: !link.active } : link
      ),
    };
    setGraph(nextGraph);
    setSelectedLinkId(linkId);
    setActiveModal("link");
    void calculateRoute(applyRuntimeState(nextGraph, downNodeIds, downInterfaceIds), fromInterface, toInterface);
  }

  function updateLinkCost(linkId: string, cost: number) {
    const nextGraph = {
      ...graph,
      links: graph.links.map((link) => (link.id === linkId ? { ...link, cost } : link)),
    };
    setGraph(nextGraph);
    setSelectedLinkId(linkId);
    setActiveModal("link");
    void calculateRoute(applyRuntimeState(nextGraph, downNodeIds, downInterfaceIds), fromInterface, toInterface);
  }

  function updateLinkFromTable(linkId: string, patch: Partial<LinkModel>) {
    const nextGraph = {
      ...graph,
      links: graph.links.map((link) => (link.id === linkId ? { ...link, ...patch } : link)),
    };
    setGraph(nextGraph);
    setSelectedLinkId(linkId);
    void calculateRoute(applyRuntimeState(nextGraph, downNodeIds, downInterfaceIds), fromInterface, toInterface);
  }

  function selectInterface(interfaceId: string) {
    if (selectionTarget === "from") {
      setRouteEndpoint("from", interfaceId);
      return;
    }

    setRouteEndpoint("to", interfaceId);
  }

  function setRouteEndpoint(target: "from" | "to", interfaceId: string) {
    if (target === "from") {
      setFromInterface(interfaceId);
      setSelectionTarget("to");
      void calculateRoute(effectiveGraph, interfaceId, toInterface);
      return;
    }

    setToInterface(interfaceId);
    setSelectionTarget("from");
    void calculateRoute(effectiveGraph, fromInterface, interfaceId);
  }

  function addNode() {
    const nodeId = newNodeId.trim();
    if (!nodeId) {
      setStatus("ノードIDを入力してください");
      return;
    }
    if (graph.nodes.some((node) => node.id === nodeId)) {
      setStatus(`ノード '${nodeId}' はすでに存在します`);
      return;
    }

    const interfaceId = `${nodeId}-eth0`;
    const nextGraph = {
      ...graph,
      nodes: [...graph.nodes, { id: nodeId, device_type: newNodeDeviceType, group_id: newNodeGroupId }],
      interfaces: [...graph.interfaces, { id: interfaceId, node_id: nodeId }],
    };
    setGraph(nextGraph);
    setNewNodeId("");
    setNewLinkTo(nodeId);
    setStatus(`${nodeId} を追加しました`);
    void calculateRoute(applyRuntimeState(nextGraph, downNodeIds, downInterfaceIds), fromInterface, toInterface);
  }

  function updateNodeDeviceType(nodeId: string, deviceType: NodeDeviceType) {
    const nextGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === nodeId ? { ...node, device_type: deviceType } : node
      ),
    };
    setGraph(nextGraph);
  }

  function updateNodeGroup(nodeId: string, groupId: string) {
    const nextGraph = {
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === nodeId ? { ...node, group_id: groupId, layer: undefined } : node
      ),
    };
    setGraph(nextGraph);
  }

  function addGroup() {
    const groupId = newGroupId.trim();
    const label = newGroupLabel.trim() || groupId;
    if (!groupId) {
      setStatus("グループIDを入力してください");
      return;
    }
    if (groups.some((group) => group.id === groupId)) {
      setStatus(`グループ '${groupId}' はすでに存在します`);
      return;
    }

    const nextGraph = {
      ...graph,
      groups: [...groups, { id: groupId, label }],
    };
    setGraph(nextGraph);
    setNewGroupId("");
    setNewGroupLabel("");
    setNewNodeGroupId(groupId);
    setStatus(`${label} グループを追加しました`);
  }

  function moveNode(nodeId: string, x: number, y: number) {
    setGraph((currentGraph) => ({
      ...currentGraph,
      nodes: currentGraph.nodes.map((node) =>
        node.id === nodeId ? { ...node, x: clamp(x, 44, 716), y: clamp(y, 68, 416) } : node
      ),
    }));
  }

  function changeLayoutDirection(direction: LayoutDirection) {
    setLayoutDirection(direction);
    setGraph((currentGraph) => ({
      ...currentGraph,
      nodes: currentGraph.nodes.map(({ x: _x, y: _y, ...node }) => node),
    }));
  }

  function addRoute(nodeId: string) {
    const node = graph.nodes.find((nodeItem) => nodeItem.id === nodeId);
    if (node && nodeCapabilities(node).defaultRouteOnly && routeEntriesFromGraph(graph).some((route) => route.node_id === nodeId && route.destination === "0.0.0.0/0")) {
      setStatus(`${nodeId} にはデフォルトルートがすでにあります`);
      return;
    }

    setGraph((currentGraph) =>
      graphWithRoutes(currentGraph, [
        ...routeEntriesFromGraph(currentGraph),
        {
          id: uniqueRouteId(currentGraph, nodeId),
          node_id: nodeId,
          destination: "0.0.0.0/0",
          metric: 10,
          administrative_distance: 1,
          vrf_id: "default",
          active: true,
        },
      ])
    );
    setStatus(`${nodeId} にルートを追加しました`);
  }

  function updateRoute(routeId: string, patch: Partial<RouteEntryModel>) {
    setGraph((currentGraph) =>
      graphWithRoutes(
        currentGraph,
        routeEntriesFromGraph(currentGraph).map((route) => {
          if (route.id !== routeId) {
            return route;
          }
          const nextRoute = cleanRouteEntry({ ...route, ...patch });
          const node = currentGraph.nodes.find((nodeItem) => nodeItem.id === nextRoute.node_id);
          return node && nodeCapabilities(node).defaultRouteOnly
            ? { ...nextRoute, destination: "0.0.0.0/0" }
            : nextRoute;
        })
      )
    );
  }

  function deleteRoute(routeId: string) {
    setGraph((currentGraph) =>
      graphWithRoutes(
        currentGraph,
        routeEntriesFromGraph(currentGraph).filter((route) => route.id !== routeId)
      )
    );
    setStatus(`${routeId} を削除しました`);
  }

  function addPolicy(nodeId: string) {
    setGraph((currentGraph) =>
      graphWithPolicies(currentGraph, [
        ...policyRulesFromGraph(currentGraph),
        {
          id: uniquePolicyId(currentGraph, nodeId),
          node_id: nodeId,
          acl_name: `${nodeId}-ingress`,
          ace_name: "new-policy",
          name: "new-policy",
          direction: "ingress",
          action: "permit",
          protocol: "tcp",
          source: "any",
          destination: "any",
          port: 443,
          active: true,
        },
      ])
    );
    setStatus(`${nodeId} にPolicyを追加しました`);
  }

  function updatePolicy(policyId: string, patch: Partial<PolicyRuleModel>) {
    setGraph((currentGraph) =>
      graphWithPolicies(
        currentGraph,
        policyRulesFromGraph(currentGraph).map((policy) =>
          policy.id === policyId ? cleanPolicyRule({ ...policy, ...patch }) : policy
        )
      )
    );
  }

  function deletePolicy(policyId: string) {
    setGraph((currentGraph) =>
      graphWithPolicies(
        currentGraph,
        policyRulesFromGraph(currentGraph).filter((policy) => policy.id !== policyId)
      )
    );
    setStatus(`${policyId} を削除しました`);
  }

  function addNatRule(nodeId: string) {
    setGraph((currentGraph) => ({
      ...currentGraph,
      nat_rules: [
        ...(currentGraph.nat_rules ?? []),
        {
          id: uniqueNatRuleId(currentGraph, nodeId),
          node_id: nodeId,
          direction: "egress",
          nat_type: "source",
          original: "any",
          translated: "203.0.113.10",
          protocol: "any",
          active: true,
        },
      ],
    }));
    setStatus(`${nodeId} にNATルールを追加しました`);
  }

  function updateNatRule(ruleId: string, patch: Partial<NatRuleModel>) {
    setGraph((currentGraph) => ({
      ...currentGraph,
      nat_rules: (currentGraph.nat_rules ?? []).map((rule) =>
        rule.id === ruleId ? cleanNatRule({ ...rule, ...patch }) : rule
      ),
    }));
  }

  function deleteNatRule(ruleId: string) {
    setGraph((currentGraph) => ({
      ...currentGraph,
      nat_rules: (currentGraph.nat_rules ?? []).filter((rule) => rule.id !== ruleId),
    }));
    setStatus(`${ruleId} を削除しました`);
  }

  function addLink() {
    if (!newLinkFrom || !newLinkTo || newLinkFrom === newLinkTo) {
      setStatus("異なる2つのノードを選んでください");
      return;
    }

    const linkId = uniqueLinkId(graph, newLinkFrom, newLinkTo);
    const fromInterface = interfaceForNewLinkEndpoint(graph, newLinkFrom, linkId);
    const toInterface = interfaceForNewLinkEndpoint(graph, newLinkTo, linkId);
    if (!fromInterface || !toInterface) {
      setStatus("Client は1ポートのみ接続できます");
      return;
    }
    const existingInterfaceIds = new Set(graph.interfaces.map((interfaceItem) => interfaceItem.id));
    const nextGraph = {
      ...graph,
      interfaces: [
        ...graph.interfaces,
        ...[
          { id: fromInterface, node_id: newLinkFrom },
          { id: toInterface, node_id: newLinkTo },
        ].filter((interfaceItem) => !existingInterfaceIds.has(interfaceItem.id)),
      ],
      links: [
        ...graph.links,
        {
          id: linkId,
          from_interface: fromInterface,
          to_interface: toInterface,
          cost: Math.max(1, newLinkCost),
          active: true,
        },
      ],
    };
    setGraph(nextGraph);
    setSelectedLinkId(linkId);
    setActiveModal("link");
    setStatus(`${linkId} を追加しました`);
    void calculateRoute(applyRuntimeState(nextGraph, downNodeIds, downInterfaceIds), fromInterface, toInterface);
  }

  function selectNode(nodeId: string) {
    setSelectedNodeId(nodeId);
    setActiveModal("node");
  }

  function toggleNodeStatus(nodeId: string) {
    const nextDownNodeIds = toggleSetValue(downNodeIds, nodeId);
    setDownNodeIds(nextDownNodeIds);
    void calculateRoute(applyRuntimeState(graph, nextDownNodeIds, downInterfaceIds), fromInterface, toInterface);
  }

  function toggleInterfaceStatus(interfaceId: string) {
    const nextDownInterfaceIds = toggleSetValue(downInterfaceIds, interfaceId);
    setDownInterfaceIds(nextDownInterfaceIds);
    void calculateRoute(applyRuntimeState(graph, downNodeIds, nextDownInterfaceIds), fromInterface, toInterface);
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-5 py-5 lg:px-8">
        <header className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950">
              <Network size={16} />
              Pathlet
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass("secondary")} type="button" onClick={() => setActiveModal("graph")}>
              <Network size={16} />
              トポロジを編集
            </button>
            <ToolbarSeparator />
            <button className={buttonClass("secondary")} type="button" onClick={() => setActiveModal("links")}>
              <Cable size={16} />
              Links
            </button>
            <button className={buttonClass("secondary")} type="button" onClick={() => setActiveModal("routing")}>
              <GitBranch size={16} />
              Routing
            </button>
            <button className={buttonClass("secondary")} type="button" onClick={() => setActiveModal("policy")}>
              <Shield size={16} />
              Policy
            </button>
            <button className={buttonClass("secondary")} type="button" onClick={() => setActiveModal("nat")}>
              <Cable size={16} />
              NAT
            </button>
            <ToolbarSeparator />
            <label className={buttonClass("secondary")}>
              <FileJson size={16} />
              JSON/YAMLを読み込む
              <input
                className="sr-only"
                type="file"
                accept="application/json,application/yaml,text/yaml,.json,.yaml,.yml"
                onChange={importGraph}
              />
            </label>
            <button className={buttonClass("secondary")} type="button" onClick={exportGraphAsYaml}>
              <FileDown size={16} />
              YAMLでExport
            </button>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric icon={<GitBranch size={18} />} label="現在のcost" value={selectedCost} />
          <Metric icon={<Network size={18} />} label="ノード数" value={graph.nodes.length} />
          <Metric icon={<Cable size={18} />} label="稼働中リンク" value={activeLinkCount} />
          <Metric icon={<Zap size={18} />} label="停止中リンク" value={downLinkCount} tone="warn" />
        </section>

        <section>
          <Card className="min-h-[560px] overflow-hidden">
            <CardHeader
              title="トポロジ"
              action={
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5">
                    {(["shortest_path", "routing_table"] as const).map((mode) => (
                      <button
                        className={cn(
                          "rounded px-2.5 py-1 text-xs font-semibold transition",
                          routeMode === mode
                            ? "bg-teal-700 text-white"
                            : "text-zinc-600 hover:bg-zinc-100"
                        )}
                        key={mode}
                        type="button"
                        onClick={() => setRouteMode(mode)}
                      >
                        {mode === "shortest_path" ? "Dijkstra" : "Routing Table"}
                      </button>
                    ))}
                  </div>
                  <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5">
                    {(["compact", "detail"] as const).map((mode) => (
                      <button
                        className={cn(
                          "rounded px-2.5 py-1 text-xs font-semibold transition",
                          interfaceDisplayMode === mode
                            ? "bg-teal-700 text-white"
                            : "text-zinc-600 hover:bg-zinc-100"
                        )}
                        key={mode}
                        type="button"
                        onClick={() => setInterfaceDisplayMode(mode)}
                      >
                        {mode === "compact" ? "簡易" : "詳細"}
                      </button>
                    ))}
                  </div>
                  <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5">
                    {(["lr", "td"] as const).map((direction) => (
                      <button
                        className={cn(
                          "rounded px-2.5 py-1 text-xs font-semibold transition",
                          layoutDirection === direction
                            ? "bg-teal-700 text-white"
                            : "text-zinc-600 hover:bg-zinc-100"
                        )}
                        key={direction}
                        type="button"
                        onClick={() => changeLayoutDirection(direction)}
                      >
                        {direction.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {status ? <Badge>{status}</Badge> : null}
                </div>
              }
            />
            <div className="border-t border-zinc-200 bg-zinc-100/70">
              <div className="flex flex-wrap gap-2 border-b border-zinc-200 bg-white px-4 py-3 text-xs font-medium text-zinc-600">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-8 rounded-full bg-emerald-500" />
                  通信経路
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-8 rounded-full bg-red-500" />
                  ループ
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-8 rounded-full border border-dashed border-zinc-400" />
                  停止中リンク
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-teal-700" />
                  始点
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-yellow-600" />
                  終点
                </span>
              </div>
              <Topology
                graph={effectiveGraph}
                layout={layout}
                layoutDirection={layoutDirection}
                interfaceDisplayMode={interfaceDisplayMode}
                routeEdgeDirections={routeEdgeDirections}
                loopLinkIds={loopLinkIds}
                routeInterfaceIds={routeInterfaceIds}
                routeNodeIds={routeNodeIds}
                fromInterface={fromInterface}
                toInterface={toInterface}
                downNodeIds={downNodeIds}
                downInterfaceIds={downInterfaceIds}
                onNodeSelect={selectNode}
                onInterfaceSelect={selectInterface}
                onLinkSelect={(linkId) => {
                  setSelectedLinkId(linkId);
                  setActiveModal("link");
                }}
                onNodeMove={moveNode}
              />
            </div>
            <div className="grid gap-4 border-t border-zinc-200 bg-white p-4 xl:grid-cols-[280px_1fr]">
              <div className="grid content-start gap-3">
                <EndpointSummary graph={effectiveGraph} label="始点" interfaceId={fromInterface} />
                <EndpointSummary graph={effectiveGraph} label="終点" interfaceId={toInterface} />
                <TrafficIntentEditor
                  graph={graph}
                  protocol={trafficProtocol}
                  port={trafficPort}
                  expectedReachable={expectedReachable}
                  expectedViaNodeId={expectedViaNodeId}
                  onProtocolChange={setTrafficProtocol}
                  onPortChange={setTrafficPort}
                  onExpectedReachableChange={setExpectedReachable}
                  onExpectedViaNodeIdChange={setExpectedViaNodeId}
                />
              </div>
              <RouteDetails
                graph={effectiveGraph}
                intent={trafficIntent}
                routeMode={routeMode}
                response={routeResponse}
              />
            </div>
          </Card>
        </section>

        {activeModal ? (
          <Modal
            title={modalTitle(activeModal)}
            onClose={() => setActiveModal(null)}
          >
            {activeModal === "link" ? (
              <SelectedLinkPanel
                graph={effectiveGraph}
                link={graph.links.find((link) => link.id === selectedLinkId)}
                onToggle={toggleLink}
                onCostChange={updateLinkCost}
              />
            ) : activeModal === "links" ? (
              <LinksPanel
                graph={graph}
                selectedLinkId={selectedLinkId}
                onSelectLink={(linkId) => {
                  setSelectedLinkId(linkId);
                  setActiveModal("link");
                }}
                onUpdateLink={updateLinkFromTable}
              />
            ) : activeModal === "node" ? (
              <NodeDetailsPanel
                graph={effectiveGraph}
                node={graph.nodes.find((node) => node.id === selectedNodeId)}
                fromInterface={fromInterface}
                toInterface={toInterface}
                downNodeIds={downNodeIds}
                downInterfaceIds={downInterfaceIds}
                onToggleNode={toggleNodeStatus}
                onToggleInterface={toggleInterfaceStatus}
                onSetEndpoint={setRouteEndpoint}
                onAddRoute={addRoute}
                onUpdateRoute={updateRoute}
                onDeleteRoute={deleteRoute}
                onAddPolicy={addPolicy}
                onUpdatePolicy={updatePolicy}
                onDeletePolicy={deletePolicy}
                onAddNatRule={addNatRule}
                onUpdateNatRule={updateNatRule}
                onDeleteNatRule={deleteNatRule}
                onSelectLink={(linkId) => {
                  setSelectedLinkId(linkId);
                  setActiveModal("link");
                }}
              />
            ) : activeModal === "routing" ? (
              <RoutingPanel graph={graph} onAddRoute={addRoute} onUpdateRoute={updateRoute} onDeleteRoute={deleteRoute} />
            ) : activeModal === "policy" ? (
              <PolicyPanel graph={graph} onAddPolicy={addPolicy} onUpdatePolicy={updatePolicy} onDeletePolicy={deletePolicy} />
            ) : activeModal === "nat" ? (
              <NatPanel graph={graph} onAddNatRule={addNatRule} onUpdateNatRule={updateNatRule} onDeleteNatRule={deleteNatRule} />
            ) : (
              <GraphEditor
                graph={graph}
                newNodeId={newNodeId}
                newNodeDeviceType={newNodeDeviceType}
                newNodeGroupId={newNodeGroupId}
                newGroupId={newGroupId}
                newGroupLabel={newGroupLabel}
                newLinkFrom={newLinkFrom}
                newLinkTo={newLinkTo}
                newLinkCost={newLinkCost}
                onNodeIdChange={setNewNodeId}
                onNodeDeviceTypeChange={setNewNodeDeviceType}
                onNodeGroupChange={setNewNodeGroupId}
                onGroupIdChange={setNewGroupId}
                onGroupLabelChange={setNewGroupLabel}
                onLinkFromChange={setNewLinkFrom}
                onLinkToChange={setNewLinkTo}
                onLinkCostChange={setNewLinkCost}
                onAddNode={addNode}
                onAddGroup={addGroup}
                onAddLink={addLink}
                onUpdateNodeDeviceType={updateNodeDeviceType}
                onUpdateNodeGroup={updateNodeGroup}
              />
            )}
          </Modal>
        ) : null}
      </div>
    </main>
  );
}

function Topology({
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
  const groupWidth = 700 / Math.max(groups.length, 1);
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
      viewBox="0 0 760 460"
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
            width={layoutDirection === "lr" ? Math.max(92, groupWidth - 30) : 700}
            height={layoutDirection === "lr" ? 404 : Math.max(72, groupHeight - 18)}
            rx="14"
          />
          <text
            className="fill-zinc-500 text-xs font-semibold uppercase"
            x={layoutDirection === "lr" ? 30 + index * groupWidth + Math.max(92, groupWidth - 30) / 2 : 380}
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

function RouteDetails({
  graph,
  intent,
  routeMode,
  response,
}: {
  graph: GraphModel;
  intent: TrafficIntent;
  routeMode: RouteMode;
  response: RouteResponse | null;
}) {
  if (!response) {
    return <EmptyMessage>まだ経路を計算していません。</EmptyMessage>;
  }

  if (!response.ok) {
    return (
      <div className="p-4">
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <strong>{response.error.code}</strong>: {response.error.message}
        </div>
        <div className="mt-3">
          <EvaluationList
            subject={`${intent.source_node_id} -> ${intent.destination_node_id} / ${trafficLabel(intent)}`}
            routePath="未計算"
            items={[
              evaluationItem(
                "到達性",
                reachabilityLabel(intent.expectations.reachable),
                "到達不可",
                response.error.message
              ),
              notApplicableItem("経路", "未計算"),
              notApplicableItem("NAT", "未計算"),
              notApplicableItem("Policy", "未計算"),
            ]}
          />
        </div>
      </div>
    );
  }

  const routeSegments = routeSegmentsFromPath(response.path, graph);
  const routeNodeIds = nodeIdsFromPath(response.path, graph);
  const destinationVip = virtualIpForInterface(graph, response.path.at(-1) ?? "");
  const routeStatus = response.status ?? "reachable";
  const policyAllowed = routeStatus !== "policy_denied";
  const expectedVia = intent.expectations.via_node_id;
  const evaluationItems = [
    evaluationItem("到達性", reachabilityLabel(intent.expectations.reachable), routeStatusLabel(routeStatus)),
    expectedVia
      ? viaEvaluationItem(expectedVia, routeNodeIds, intent.expectations.strict_path ?? false)
      : notApplicableItem("経由拠点", "指定なし"),
    natEvaluationItem(intent, response),
    evaluationItem(
      "Policy",
      "permit",
      policyAllowed ? "permit" : "deny",
      response.matched_policy_ids?.join(" -> ")
    ),
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{routeMode === "shortest_path" ? "Dijkstra" : "Routing Table"}</Badge>
        <Badge>{trafficLabel(intent)}</Badge>
        <Badge tone={routeStatus === "reachable" ? "success" : "danger"}>
          {routeStatusLabel(routeStatus)}
        </Badge>
        <Badge tone="success">link cost {response.cost}</Badge>
        <Badge tone="muted">{routeSegments.length} links</Badge>
        {destinationVip ? (
          <Badge>
            {destinationVip.protocol} {destinationVip.address}
          </Badge>
        ) : null}
      </div>

      <p className="break-words text-sm font-semibold leading-6 text-zinc-950">
        経路: {routeNodeIds.join(" -> ")}
      </p>

      <EvaluationList
        items={evaluationItems}
        routePath={routeNodeIds.join(" -> ")}
        subject={`${intent.source_node_id} -> ${intent.destination_node_id} / ${trafficLabel(intent)}`}
      />

      {routeSegments.length ? (
        <div className="overflow-hidden rounded-md border border-zinc-200">
          {routeSegments.map((segment, index) => (
            <div
              className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-2 border-b border-zinc-100 bg-white px-2.5 py-2 text-sm last:border-b-0"
              key={`${segment.link.id}-${index}`}
            >
              <span className="font-mono text-xs text-zinc-400">{index + 1}</span>
              <div className="min-w-0">
                <div className="truncate font-semibold text-zinc-900">
                  {segment.fromNodeId} {"->"} {segment.toNodeId}
                </div>
                <div className="truncate font-mono text-xs text-zinc-500">{segment.link.id}</div>
              </div>
              <span className="font-mono text-xs font-semibold text-zinc-600">
                link cost {segment.link.cost}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {response.matched_route_ids?.length ? (
        <details className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <summary className="cursor-pointer font-semibold text-zinc-700">
            参照ルート ({response.matched_route_ids.length})
          </summary>
          <p className="mt-2 overflow-x-auto whitespace-nowrap font-mono leading-5">{response.matched_route_ids.join(" -> ")}</p>
        </details>
      ) : null}

      {response.matched_policy_ids?.length ? (
        <details className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <summary className="cursor-pointer font-semibold">
            Policy deny ({response.matched_policy_ids.length})
          </summary>
          <p className="mt-2 overflow-x-auto whitespace-nowrap font-mono leading-5">{response.matched_policy_ids.join(" -> ")}</p>
        </details>
      ) : null}

      {response.matched_nat_rule_ids?.length ? (
        <details className="rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-700">
          <summary className="cursor-pointer font-semibold">
            NAT ({response.matched_nat_rule_ids.length})
          </summary>
          <p className="mt-2 overflow-x-auto whitespace-nowrap font-mono leading-5">{response.matched_nat_rule_ids.join(" -> ")}</p>
          <p className="mt-2 overflow-x-auto whitespace-nowrap font-mono leading-5">
            source {response.translated_source ?? "-"} / destination {response.translated_destination ?? "-"}
          </p>
        </details>
      ) : null}
    </div>
  );
}

type EvaluationItem = {
  label: string;
  expected: string;
  actual: string;
  detail?: string;
  status: "OK" | "NG" | "not_applicable" | "not_implemented";
};

function EvaluationList({ items, subject, routePath }: { items: EvaluationItem[]; subject: string; routePath: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2">
      <div>
        <div className="text-xs font-semibold text-zinc-500">検証結果（上記経路に対して）</div>
        <div className="mt-1 break-all text-xs text-zinc-600">通信要件: {subject}</div>
        <div className="mt-1 break-all text-xs text-zinc-600">評価対象経路: {routePath}</div>
      </div>
      {items.map((item) => (
        <div
          className="grid gap-2 rounded-md border border-zinc-200 bg-white p-2 text-xs md:grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)_5rem] md:items-start"
          key={item.label}
        >
          <span className="font-semibold text-zinc-600">{item.label}</span>
          <span className="min-w-0 break-words font-mono text-zinc-600" title={item.expected}>
            要件: {item.expected}
          </span>
          <div className="min-w-0 font-mono text-zinc-600" title={item.actual}>
            <span className="break-words">結果: {item.actual}</span>
            {item.detail ? (
              <code className="mt-1 block max-w-full truncate rounded bg-zinc-100 px-1.5 py-1 text-[11px] text-zinc-500" title={item.detail}>
                {item.detail}
              </code>
            ) : null}
          </div>
          <Badge tone={item.status === "OK" ? "success" : item.status === "NG" ? "danger" : "muted"}>
            {evaluationStatusLabel(item.status)}
          </Badge>
        </div>
      ))}
    </div>
  );
}

function TrafficIntentEditor({
  graph,
  protocol,
  port,
  expectedReachable,
  expectedViaNodeId,
  onProtocolChange,
  onPortChange,
  onExpectedReachableChange,
  onExpectedViaNodeIdChange,
}: {
  graph: GraphModel;
  protocol: TrafficProtocol;
  port: number;
  expectedReachable: boolean;
  expectedViaNodeId: string;
  onProtocolChange: (protocol: TrafficProtocol) => void;
  onPortChange: (port: number) => void;
  onExpectedReachableChange: (reachable: boolean) => void;
  onExpectedViaNodeIdChange: (nodeId: string) => void;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div>
        <h3 className="text-xs font-semibold text-zinc-500">通信要件</h3>
        <p className="mt-1 text-xs text-zinc-500">
          エンドツーエンドの到達性を検証します。NAT は結果側に変換内容として表示します。
        </p>
      </div>
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <label className="grid gap-1 text-xs font-semibold text-zinc-600">
          通信種別
          <select
            className={inputClass}
            value={protocol}
            onChange={(event) => onProtocolChange(event.target.value as TrafficProtocol)}
          >
            <option value="icmp">ICMP</option>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-zinc-600">
          ポート
          <input
            className={inputClass}
            disabled={protocol === "icmp"}
            min="1"
            max="65535"
            type="number"
            value={protocol === "icmp" ? "" : port}
            onChange={(event) => onPortChange(normalizeTransportPort(Number(event.target.value)))}
          />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-zinc-600">
        到達性
        <select
          className={inputClass}
          value={expectedReachable ? "reachable" : "unreachable"}
          onChange={(event) => onExpectedReachableChange(event.target.value === "reachable")}
        >
          <option value="reachable">到達可能</option>
          <option value="unreachable">到達不可</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-zinc-600">
        経由拠点
        <select
          className={inputClass}
          value={expectedViaNodeId}
          onChange={(event) => onExpectedViaNodeIdChange(event.target.value)}
        >
          <option value="">未指定</option>
          {graph.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.id}
            </option>
          ))}
        </select>
        <span className="text-[11px] font-normal text-zinc-500">指定した拠点を経由するかを確認します。</span>
      </label>
    </div>
  );
}

function SelectedLinkPanel({
  graph,
  link,
  onToggle,
  onCostChange,
}: {
  graph: GraphModel;
  link: LinkModel | undefined;
  onToggle: (linkId: string) => void;
  onCostChange: (linkId: string, cost: number) => void;
}) {
  if (!link) {
    return <EmptyMessage>トポロジまたは一覧からリンクを選んでください。</EmptyMessage>;
  }

  return (
    <div className="grid gap-3 p-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div>
          <div className="text-sm font-semibold text-zinc-950">{link.id}</div>
          <div className="mt-1 text-xs text-zinc-500">
            {`${interfaceLabel(graph, link.from_interface)} -> ${interfaceLabel(graph, link.to_interface)}`}
          </div>
        </div>
        <button
          className={buttonClass(link.active ? "success" : "danger")}
          type="button"
          onClick={() => onToggle(link.id)}
        >
          {link.active ? "稼働" : "停止"}
        </button>
      </div>
      <Field label="帯域">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm text-zinc-700">
          {formatBandwidth(link.bandwidth_mbps)}
        </div>
      </Field>
      <Field label="link cost">
        <input
          className={inputClass}
          min="1"
          type="number"
          value={link.cost}
          onChange={(event) => onCostChange(link.id, Math.max(1, Number(event.target.value) || 1))}
        />
      </Field>
    </div>
  );
}

function NodeDetailsPanel({
  graph,
  node,
  fromInterface,
  toInterface,
  downNodeIds,
  downInterfaceIds,
  onToggleNode,
  onToggleInterface,
  onSetEndpoint,
  onAddRoute,
  onUpdateRoute,
  onDeleteRoute,
  onAddPolicy,
  onUpdatePolicy,
  onDeletePolicy,
  onAddNatRule,
  onUpdateNatRule,
  onDeleteNatRule,
  onSelectLink,
}: {
  graph: GraphModel;
  node: NodeModel | undefined;
  fromInterface: string;
  toInterface: string;
  downNodeIds: Set<string>;
  downInterfaceIds: Set<string>;
  onToggleNode: (nodeId: string) => void;
  onToggleInterface: (interfaceId: string) => void;
  onSetEndpoint: (target: "from" | "to", interfaceId: string) => void;
  onAddRoute: (nodeId: string) => void;
  onUpdateRoute: (routeId: string, patch: Partial<RouteEntryModel>) => void;
  onDeleteRoute: (routeId: string) => void;
  onAddPolicy: (nodeId: string) => void;
  onUpdatePolicy: (policyId: string, patch: Partial<PolicyRuleModel>) => void;
  onDeletePolicy: (policyId: string) => void;
  onAddNatRule: (nodeId: string) => void;
  onUpdateNatRule: (ruleId: string, patch: Partial<NatRuleModel>) => void;
  onDeleteNatRule: (ruleId: string) => void;
  onSelectLink: (linkId: string) => void;
}) {
  if (!node) {
    return <EmptyMessage>トポロジからノードを選んでください。</EmptyMessage>;
  }

  const interfaces = graph.interfaces.filter(
    (interfaceItem) => interfaceItem.node_id === node.id
  );
  const interfaceIds = new Set(interfaces.map((interfaceItem) => interfaceItem.id));
  const connectedLinks = graph.links.filter(
    (link) => interfaceIds.has(link.from_interface) || interfaceIds.has(link.to_interface)
  );
  const virtualIps = (graph.virtual_ips ?? []).filter(
    (virtualIp) =>
      virtualIp.service_node_id === node.id ||
      virtualIp.active_node_id === node.id ||
      virtualIp.standby_node_ids.includes(node.id)
  );
  const routes = routeEntriesFromGraph(graph)
    .filter((route) => route.node_id === node.id)
    .sort((a, b) => (a.vrf_id ?? "default").localeCompare(b.vrf_id ?? "default") || a.metric - b.metric || a.destination.localeCompare(b.destination));
  const policies = policyRulesFromGraph(graph)
    .filter((policy) => policy.node_id === node.id)
    .sort((a, b) => a.direction.localeCompare(b.direction) || a.id.localeCompare(b.id));
  const natRules = (graph.nat_rules ?? [])
    .filter((rule) => rule.node_id === node.id)
    .sort((a, b) => a.direction.localeCompare(b.direction) || a.id.localeCompare(b.id));
  const nodeDown = downNodeIds.has(node.id);
  const deviceType = nodeDeviceType(node);
  const capabilities = nodeCapabilities(node);

  return (
    <div className="grid gap-4 p-4">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-950">{node.id}</h3>
            <Badge>{nodeDeviceTypeLabel(deviceType)}</Badge>
            <Badge>{groupLabel(graph, nodeGroupId(node))}</Badge>
            <Badge tone={nodeDown ? "danger" : "success"}>{nodeDown ? "down" : "up"}</Badge>
          </div>
          <button
            className={buttonClass(nodeDown ? "success" : "danger")}
            type="button"
            onClick={() => onToggleNode(node.id)}
          >
            {nodeDown ? "ノードを復旧" : "ノードを停止"}
          </button>
        </div>
        <div className="grid gap-1 text-sm text-zinc-600">
          <div>インターフェース: {interfaces.length}</div>
          <div>接続リンク: {connectedLinks.length}</div>
          <div>
            {capabilities.defaultRouteOnly
              ? "Client は1ポートとデフォルトルートを基本に扱います。"
              : "Network Device は複数ポート、Routing、Policy、NAT、VIPを扱います。"}
          </div>
        </div>
      </div>

      {capabilities.canHostVip && virtualIps.length ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-zinc-950">冗長VIP</h3>
          {virtualIps.map((virtualIp) => (
            <div className="rounded-lg border border-zinc-200 bg-white p-3 text-sm" key={virtualIp.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-zinc-950">{virtualIp.id}</span>
                <Badge>{virtualIp.protocol}</Badge>
                {virtualIp.service_node_id === node.id ? <Badge tone="muted">VIP</Badge> : null}
                {virtualIp.active_node_id === node.id ? <Badge tone="success">active</Badge> : null}
                {virtualIp.standby_node_ids.includes(node.id) ? <Badge tone="muted">standby</Badge> : null}
              </div>
              <div className="grid gap-1 text-zinc-600">
                <div>address: {virtualIp.address}</div>
                <div>active: {virtualIp.active_node_id}</div>
                <div>standby: {virtualIp.standby_node_ids.join(", ")}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {capabilities.canEditPolicy ? (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-950">Policy</h3>
            <button className={buttonClass("secondary")} type="button" onClick={() => onAddPolicy(node.id)}>
              Policy追加
            </button>
          </div>
          {policies.length ? (
            policies.map((policy) => (
              <div className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-3" key={policy.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 max-w-full overflow-x-auto whitespace-nowrap font-mono text-xs font-semibold text-zinc-800" title={policy.id}>
                      {policy.id}
                    </span>
                    <Badge tone={policy.active ? "success" : "muted"}>
                      {policy.active ? "active" : "inactive"}
                    </Badge>
                    <Badge tone={policy.action === "permit" ? "success" : "danger"}>
                      {policy.action}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={buttonClass(policy.active ? "danger" : "success")}
                      type="button"
                      onClick={() => onUpdatePolicy(policy.id, { active: !policy.active })}
                    >
                      {policy.active ? "無効化" : "有効化"}
                    </button>
                    <button className={buttonClass("danger")} type="button" onClick={() => onDeletePolicy(policy.id)}>
                      削除
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label="名前">
                    <input
                      className={inputClass}
                      value={policy.name ?? ""}
                      onChange={(event) => onUpdatePolicy(policy.id, { name: event.target.value })}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="方向">
                      <select
                        className={inputClass}
                        value={policy.direction}
                        onChange={(event) => onUpdatePolicy(policy.id, { direction: event.target.value as PolicyRuleModel["direction"] })}
                      >
                        <option value="ingress">ingress</option>
                        <option value="egress">egress</option>
                      </select>
                    </Field>
                    <Field label="動作">
                      <select
                        className={inputClass}
                        value={policy.action}
                        onChange={(event) => onUpdatePolicy(policy.id, { action: event.target.value as PolicyRuleModel["action"] })}
                      >
                        <option value="permit">permit</option>
                        <option value="deny">deny</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="送信元">
                    <input
                      className={inputClass}
                      value={policy.source}
                      onChange={(event) => onUpdatePolicy(policy.id, { source: event.target.value })}
                    />
                  </Field>
                  <Field label="宛先">
                    <input
                      className={inputClass}
                      value={policy.destination}
                      onChange={(event) => onUpdatePolicy(policy.id, { destination: event.target.value })}
                    />
                  </Field>
                  <div className="grid grid-cols-[1fr_7rem] gap-2">
                    <Field label="プロトコル">
                      <select
                        className={inputClass}
                        value={policy.protocol}
                        onChange={(event) => onUpdatePolicy(policy.id, { protocol: event.target.value as PolicyProtocol })}
                      >
                        <option value="any">any</option>
                        <option value="icmp">ICMP</option>
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                      </select>
                    </Field>
                    <Field label="ポート">
                      <input
                        className={inputClass}
                        disabled={policy.protocol === "any" || policy.protocol === "icmp"}
                        min="1"
                        max="65535"
                        type="number"
                        value={policy.protocol === "any" || policy.protocol === "icmp" ? "" : policy.port ?? ""}
                        onChange={(event) => onUpdatePolicy(policy.id, { port: normalizeTransportPort(Number(event.target.value)) })}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyMessage>このノードにPolicyはありません。</EmptyMessage>
          )}
        </div>
      ) : null}

      {capabilities.canEditNat ? (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-zinc-950">NAT</h3>
            <button className={buttonClass("secondary")} type="button" onClick={() => onAddNatRule(node.id)}>
              NAT追加
            </button>
          </div>
          {natRules.length ? (
            natRules.map((rule) => (
              <div className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-3" key={rule.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 max-w-full overflow-x-auto whitespace-nowrap font-mono text-xs font-semibold text-zinc-800" title={rule.id}>
                      {rule.id}
                    </span>
                    <Badge tone={rule.active ? "success" : "muted"}>
                      {rule.active ? "active" : "inactive"}
                    </Badge>
                    <Badge>{rule.direction}</Badge>
                    <Badge>{rule.nat_type}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={buttonClass(rule.active ? "danger" : "success")}
                      type="button"
                      onClick={() => onUpdateNatRule(rule.id, { active: !rule.active })}
                    >
                      {rule.active ? "無効化" : "有効化"}
                    </button>
                    <button className={buttonClass("danger")} type="button" onClick={() => onDeleteNatRule(rule.id)}>
                      削除
                    </button>
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label="interface">
                    <select className={inputClass} value={rule.interface_id ?? ""} onChange={(event) => onUpdateNatRule(rule.id, { interface_id: event.target.value || undefined })}>
                      <option value="">node-wide</option>
                      {interfaces.map((interfaceItem) => (
                        <option key={interfaceItem.id} value={interfaceItem.id}>
                          {interfaceLabel(graph, interfaceItem.id)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="direction">
                      <select className={inputClass} value={rule.direction} onChange={(event) => onUpdateNatRule(rule.id, { direction: event.target.value as NatRuleModel["direction"] })}>
                        <option value="ingress">ingress</option>
                        <option value="egress">egress</option>
                      </select>
                    </Field>
                    <Field label="type">
                      <select className={inputClass} value={rule.nat_type} onChange={(event) => onUpdateNatRule(rule.id, { nat_type: event.target.value as NatRuleModel["nat_type"] })}>
                        <option value="source">source</option>
                        <option value="destination">destination</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="original">
                    <input className={inputClass} value={rule.original} onChange={(event) => onUpdateNatRule(rule.id, { original: event.target.value })} />
                  </Field>
                  <Field label="translated">
                    <input className={inputClass} value={rule.translated} onChange={(event) => onUpdateNatRule(rule.id, { translated: event.target.value })} />
                  </Field>
                  <div className="grid grid-cols-[1fr_7rem] gap-2">
                    <Field label="protocol">
                      <select
                        className={inputClass}
                        value={rule.protocol ?? "any"}
                        onChange={(event) => onUpdateNatRule(rule.id, { protocol: event.target.value as PolicyProtocol, port: event.target.value === "tcp" || event.target.value === "udp" ? rule.port : undefined })}
                      >
                        <option value="any">any</option>
                        <option value="icmp">ICMP</option>
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                      </select>
                    </Field>
                    <Field label="port">
                      <input
                        className={inputClass}
                        disabled={rule.protocol === "any" || rule.protocol === "icmp" || !rule.protocol}
                        min="1"
                        max="65535"
                        type="number"
                        value={rule.protocol === "tcp" || rule.protocol === "udp" ? rule.port ?? "" : ""}
                        onChange={(event) => onUpdateNatRule(rule.id, { port: optionalNumber(event.target.value) })}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <EmptyMessage>このノードにNATルールはありません。</EmptyMessage>
          )}
        </div>
      ) : null}

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-950">{capabilities.defaultRouteOnly ? "Default Route" : "Routing Table"}</h3>
          <button className={buttonClass("secondary")} type="button" onClick={() => onAddRoute(node.id)}>
            {capabilities.defaultRouteOnly ? "デフォルトルート追加" : "ルート追加"}
          </button>
        </div>
        {routes.length ? (
          routes.map((route) => (
            <div className="grid gap-2 rounded-lg border border-zinc-200 bg-white p-3" key={route.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-all font-mono text-xs font-semibold text-zinc-800">
                    {route.id}
                  </span>
                  <Badge tone={route.active ? "success" : "muted"}>
                    {route.active ? "active" : "inactive"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={buttonClass(route.active ? "danger" : "success")}
                    type="button"
                    onClick={() => onUpdateRoute(route.id, { active: !route.active })}
                  >
                    {route.active ? "無効化" : "有効化"}
                  </button>
                  <button className={buttonClass("danger")} type="button" onClick={() => onDeleteRoute(route.id)}>
                    削除
                  </button>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <Field label={capabilities.defaultRouteOnly ? "宛先（固定）" : "宛先"}>
                  <input
                    className={inputClass}
                    disabled={capabilities.defaultRouteOnly}
                    value={route.destination}
                    onChange={(event) => onUpdateRoute(route.id, { destination: event.target.value })}
                  />
                </Field>
                <Field label="next-hop">
                  <input
                    className={inputClass}
                    placeholder="node, interface, or IP"
                    value={route.next_hop ?? ""}
                    onChange={(event) => onUpdateRoute(route.id, { next_hop: event.target.value })}
                  />
                </Field>
                <Field label="egress">
                  <select
                    className={inputClass}
                    value={route.egress_interface ?? ""}
                    onChange={(event) => onUpdateRoute(route.id, { egress_interface: event.target.value })}
                  >
                    <option value="">未指定</option>
                    {interfaces.map((interfaceItem) => (
                      <option key={interfaceItem.id} value={interfaceItem.id}>
                        {interfaceLabel(graph, interfaceItem.id)}
                      </option>
                    ))}
                  </select>
                </Field>
                {capabilities.defaultRouteOnly ? null : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="metric">
                        <input
                          className={inputClass}
                          min="0"
                          type="number"
                          value={route.metric}
                          onChange={(event) => onUpdateRoute(route.id, { metric: Math.max(0, Number(event.target.value) || 0) })}
                        />
                      </Field>
                      <Field label="AD">
                        <input
                          className={inputClass}
                          min="0"
                          type="number"
                          value={route.administrative_distance ?? ""}
                          onChange={(event) => onUpdateRoute(route.id, { administrative_distance: optionalNumber(event.target.value) })}
                        />
                      </Field>
                    </div>
                    <Field label="VRF">
                      <input
                        className={inputClass}
                        value={route.vrf_id ?? ""}
                        onChange={(event) => onUpdateRoute(route.id, { vrf_id: event.target.value })}
                      />
                    </Field>
                    <Field label="VLAN">
                      <input
                        className={inputClass}
                        min="1"
                        max="4094"
                        type="number"
                        value={route.vlan_id ?? ""}
                        onChange={(event) => onUpdateRoute(route.id, { vlan_id: optionalNumber(event.target.value) })}
                      />
                    </Field>
                  </>
                )}
              </div>
            </div>
          ))
        ) : (
          <EmptyMessage>このノードにルートはありません。</EmptyMessage>
        )}
      </div>

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-zinc-950">インターフェース</h3>
        {interfaces.map((interfaceItem) => {
          const interfaceDown = nodeDown || downInterfaceIds.has(interfaceItem.id);
          return (
            <div
              className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-3"
              key={interfaceItem.id}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-xs font-semibold text-zinc-800">
                  {interfaceItem.id}
                </span>
                {interfaceItem.ip_address ? (
                  <Badge tone="muted">{interfaceItem.ip_address}</Badge>
                ) : null}
                {interfaceItem.id === fromInterface ? <Badge tone="success">始点</Badge> : null}
                {interfaceItem.id === toInterface ? <Badge>終点</Badge> : null}
                <Badge tone={interfaceDown ? "danger" : "success"}>
                  {interfaceDown ? "down" : "up"}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className={buttonClass(interfaceDown ? "success" : "danger")}
                  disabled={nodeDown}
                  type="button"
                  onClick={() => onToggleInterface(interfaceItem.id)}
                >
                  {interfaceDown ? "ポートを復旧" : "ポートを停止"}
                </button>
                <button
                  className={buttonClass("secondary")}
                  type="button"
                  onClick={() => onSetEndpoint("from", interfaceItem.id)}
                >
                  始点にする
                </button>
                <button
                  className={buttonClass("secondary")}
                  type="button"
                  onClick={() => onSetEndpoint("to", interfaceItem.id)}
                >
                  終点にする
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-zinc-950">接続リンク</h3>
        {connectedLinks.map((link) => (
          <button
            className="grid gap-1 rounded-lg border border-zinc-200 bg-white p-3 text-left text-sm hover:bg-zinc-50"
            key={link.id}
            type="button"
            onClick={() => onSelectLink(link.id)}
          >
            <span className="font-semibold text-zinc-950">{link.id}</span>
            <span className="break-all font-mono text-xs text-zinc-500">
              {interfaceLabel(graph, link.from_interface)} -&gt; {interfaceLabel(graph, link.to_interface)}
            </span>
            <span className="text-xs text-zinc-500">
              {link.active ? "稼働中" : "停止中"} / {formatBandwidth(link.bandwidth_mbps)} / link cost {link.cost}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function GraphEditor({
  graph,
  newNodeId,
  newNodeDeviceType,
  newNodeGroupId,
  newGroupId,
  newGroupLabel,
  newLinkFrom,
  newLinkTo,
  newLinkCost,
  onNodeIdChange,
  onNodeDeviceTypeChange,
  onNodeGroupChange,
  onGroupIdChange,
  onGroupLabelChange,
  onLinkFromChange,
  onLinkToChange,
  onLinkCostChange,
  onAddNode,
  onAddGroup,
  onAddLink,
  onUpdateNodeDeviceType,
  onUpdateNodeGroup,
}: {
  graph: GraphModel;
  newNodeId: string;
  newNodeDeviceType: NodeDeviceType;
  newNodeGroupId: string;
  newGroupId: string;
  newGroupLabel: string;
  newLinkFrom: string;
  newLinkTo: string;
  newLinkCost: number;
  onNodeIdChange: (nodeId: string) => void;
  onNodeDeviceTypeChange: (deviceType: NodeDeviceType) => void;
  onNodeGroupChange: (groupId: string) => void;
  onGroupIdChange: (groupId: string) => void;
  onGroupLabelChange: (label: string) => void;
  onLinkFromChange: (nodeId: string) => void;
  onLinkToChange: (nodeId: string) => void;
  onLinkCostChange: (cost: number) => void;
  onAddNode: () => void;
  onAddGroup: () => void;
  onAddLink: () => void;
  onUpdateNodeDeviceType: (nodeId: string, deviceType: NodeDeviceType) => void;
  onUpdateNodeGroup: (nodeId: string, groupId: string) => void;
}) {
  const groups = graphGroups(graph);
  return (
    <div className="grid gap-4 p-4">
      <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <h3 className="text-sm font-semibold text-zinc-950">グループを追加</h3>
        <Field label="グループID">
          <input
            className={inputClass}
            placeholder="dmz"
            value={newGroupId}
            onChange={(event) => onGroupIdChange(event.target.value)}
          />
        </Field>
        <Field label="表示名">
          <input
            className={inputClass}
            placeholder="DMZ"
            value={newGroupLabel}
            onChange={(event) => onGroupLabelChange(event.target.value)}
          />
        </Field>
        <button className={buttonClass("secondary")} type="button" onClick={onAddGroup}>
          グループを追加
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <h3 className="text-sm font-semibold text-zinc-950">ノードを追加</h3>
        <Field label="ノードID">
          <input
            className={inputClass}
            placeholder="branch-a"
            value={newNodeId}
            onChange={(event) => onNodeIdChange(event.target.value)}
          />
        </Field>
        <Field label="種別">
          <NodeDeviceTypeSelect value={newNodeDeviceType} onChange={onNodeDeviceTypeChange} />
        </Field>
        <Field label="グループ">
          <GroupSelect groups={groups} value={newNodeGroupId} onChange={onNodeGroupChange} />
        </Field>
        <button className={buttonClass("secondary")} type="button" onClick={onAddNode}>
          ノードを追加
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <h3 className="text-sm font-semibold text-zinc-950">リンクを追加</h3>
        <Field label="接続元ノード">
          <select
            className={inputClass}
            value={newLinkFrom}
            onChange={(event) => onLinkFromChange(event.target.value)}
          >
            {graph.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="接続先ノード">
          <select
            className={inputClass}
            value={newLinkTo}
            onChange={(event) => onLinkToChange(event.target.value)}
          >
            {graph.nodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="link cost">
          <input
            className={inputClass}
            min="1"
            type="number"
            value={newLinkCost}
            onChange={(event) => onLinkCostChange(Math.max(1, Number(event.target.value) || 1))}
          />
        </Field>
        <button className={buttonClass("secondary")} type="button" onClick={onAddLink}>
          リンクを追加
        </button>
      </div>

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold text-zinc-950">ノードの種別とグループ</h3>
        {graph.nodes.map((node) => (
          <div className="grid grid-cols-[1fr_160px_130px] items-center gap-2" key={node.id}>
            <span className="truncate text-sm text-zinc-700">{node.id}</span>
            <NodeDeviceTypeSelect
              value={nodeDeviceType(node)}
              onChange={(deviceType) => onUpdateNodeDeviceType(node.id, deviceType)}
            />
            <GroupSelect
              groups={groups}
              value={nodeGroupId(node)}
              onChange={(groupId) => onUpdateNodeGroup(node.id, groupId)}
            />
          </div>
        ))}
      </div>

    </div>
  );
}

function LinksPanel({
  graph,
  selectedLinkId,
  onSelectLink,
  onUpdateLink,
}: {
  graph: GraphModel;
  selectedLinkId: string;
  onSelectLink: (linkId: string) => void;
  onUpdateLink: (linkId: string, patch: Partial<LinkModel>) => void;
}) {
  const [nodeFilter, setNodeFilter] = useState("");
  const filteredLinks = graph.links.filter((link) =>
    nodeFilter ? linkNodeIds(graph, link).includes(nodeFilter) : true
  );
  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">Links</h3>
          <p className="mt-1 text-xs text-zinc-500">{filteredLinks.length} / {graph.links.length} links</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500">表示</span>
          <select className={inputClass} value={nodeFilter} onChange={(event) => setNodeFilter(event.target.value)}>
            <option value="">すべて</option>
            {graph.nodes.map((node) => (
              <option key={node.id} value={node.id}>{node.id}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full min-w-[1040px] text-left text-xs">
          <thead className="border-b border-zinc-200 bg-zinc-100 text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-semibold">active</th>
              <th className="px-3 py-2 font-semibold">id</th>
              <th className="px-3 py-2 font-semibold">from</th>
              <th className="px-3 py-2 font-semibold">to</th>
              <th className="px-3 py-2 font-semibold">bandwidth</th>
              <th className="px-3 py-2 font-semibold">cost</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {filteredLinks.map((link) => (
              <tr className={cn("align-top", link.id === selectedLinkId && "bg-teal-50/60")} key={link.id}>
                <td className="px-3 py-2">
                  <input checked={link.active} type="checkbox" onChange={(event) => onUpdateLink(link.id, { active: event.target.checked })} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap font-mono text-zinc-700">{link.id}</td>
                <td className="px-3 py-2 whitespace-nowrap font-mono text-zinc-600">{interfaceLabel(graph, link.from_interface)}</td>
                <td className="px-3 py-2 whitespace-nowrap font-mono text-zinc-600">{interfaceLabel(graph, link.to_interface)}</td>
                <td className="px-3 py-2 font-mono text-zinc-700">{formatBandwidth(link.bandwidth_mbps)}</td>
                <td className="px-3 py-2">
                  <input
                    className={inputClass}
                    min="1"
                    type="number"
                    value={link.cost}
                    onChange={(event) => onUpdateLink(link.id, { cost: Math.max(1, Number(event.target.value) || 1) })}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                    <button className={cn(buttonClass("secondary"), "whitespace-nowrap")} type="button" onClick={() => onSelectLink(link.id)}>
                    詳細
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoutingPanel({
  graph,
  onAddRoute,
  onUpdateRoute,
  onDeleteRoute,
}: {
  graph: GraphModel;
  onAddRoute: (nodeId: string) => void;
  onUpdateRoute: (routeId: string, patch: Partial<RouteEntryModel>) => void;
  onDeleteRoute: (routeId: string) => void;
}) {
  const routes = routeEntriesFromGraph(graph);
  const [nodeFilter, setNodeFilter] = useState("");
  const [newRouteNodeId, setNewRouteNodeId] = useState(graph.nodes[0]?.id ?? "");
  const filteredRoutes = routes.filter((route) => nodeFilter ? route.node_id === nodeFilter : true);
  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">Routing</h3>
          <p className="mt-1 text-xs text-zinc-500">{filteredRoutes.length} / {routes.length} routes</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500">表示</span>
          <select className={inputClass} value={nodeFilter} onChange={(event) => setNodeFilter(event.target.value)}>
            <option value="">すべて</option>
            {graph.nodes.map((node) => (
              <option key={node.id} value={node.id}>{node.id}</option>
            ))}
          </select>
          <span className="text-xs font-semibold text-zinc-500">追加先</span>
          <select className={inputClass} value={newRouteNodeId} onChange={(event) => setNewRouteNodeId(event.target.value)}>
            {graph.nodes.map((node) => (
              <option key={node.id} value={node.id}>{node.id}</option>
            ))}
          </select>
          <button className={buttonClass("secondary")} disabled={!newRouteNodeId} type="button" onClick={() => onAddRoute(newRouteNodeId)}>
            追加
          </button>
        </div>
      </div>
      {filteredRoutes.length ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[1500px] text-left text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-100 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-semibold">active</th>
                <th className="px-3 py-2 font-semibold">id</th>
                <th className="px-3 py-2 font-semibold">node</th>
                <th className="px-3 py-2 font-semibold">destination</th>
                <th className="px-3 py-2 font-semibold">next-hop</th>
                <th className="px-3 py-2 font-semibold">egress</th>
                <th className="px-3 py-2 font-semibold">metric</th>
                <th className="px-3 py-2 font-semibold">AD</th>
                <th className="px-3 py-2 font-semibold">VRF</th>
                <th className="px-3 py-2 font-semibold">VLAN</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredRoutes.map((route) => (
                <tr key={route.id} className="align-top">
                  <td className="px-3 py-2">
                    <input
                      checked={route.active}
                      type="checkbox"
                      onChange={(event) => onUpdateRoute(route.id, { active: event.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-zinc-700">{route.id}</td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={route.node_id} onChange={(event) => onUpdateRoute(route.id, { node_id: event.target.value })}>
                      {graph.nodes.map((node) => (
                        <option key={node.id} value={node.id}>{node.id}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} value={route.destination} onChange={(event) => onUpdateRoute(route.id, { destination: event.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} value={route.next_hop ?? ""} onChange={(event) => onUpdateRoute(route.id, { next_hop: event.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={route.egress_interface ?? ""} onChange={(event) => onUpdateRoute(route.id, { egress_interface: event.target.value })}>
                      <option value="">未指定</option>
                      {graph.interfaces
                        .filter((interfaceItem) => interfaceItem.node_id === route.node_id)
                        .map((interfaceItem) => (
                          <option key={interfaceItem.id} value={interfaceItem.id}>{interfaceLabel(graph, interfaceItem.id)}</option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} min="0" type="number" value={route.metric} onChange={(event) => onUpdateRoute(route.id, { metric: Math.max(0, Number(event.target.value) || 0) })} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} min="0" type="number" value={route.administrative_distance ?? ""} onChange={(event) => onUpdateRoute(route.id, { administrative_distance: optionalNumber(event.target.value) })} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} value={route.vrf_id ?? ""} onChange={(event) => onUpdateRoute(route.id, { vrf_id: event.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} min="1" max="4094" type="number" value={route.vlan_id ?? ""} onChange={(event) => onUpdateRoute(route.id, { vlan_id: optionalNumber(event.target.value) })} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button className={cn(buttonClass("danger"), "whitespace-nowrap")} type="button" onClick={() => onDeleteRoute(route.id)}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyMessage>表示対象のルートはありません。</EmptyMessage>
      )}
    </div>
  );
}

function PolicyPanel({
  graph,
  onAddPolicy,
  onUpdatePolicy,
  onDeletePolicy,
}: {
  graph: GraphModel;
  onAddPolicy: (nodeId: string) => void;
  onUpdatePolicy: (policyId: string, patch: Partial<PolicyRuleModel>) => void;
  onDeletePolicy: (policyId: string) => void;
}) {
  const policies = policyRulesFromGraph(graph);
  const networkDevices = graph.nodes.filter((node) => nodeDeviceType(node) !== "client");
  const [nodeFilter, setNodeFilter] = useState("");
  const [newPolicyNodeId, setNewPolicyNodeId] = useState(networkDevices[0]?.id ?? "");
  const filteredPolicies = policies.filter((policy) => nodeFilter ? policy.node_id === nodeFilter : true);
  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">Policy</h3>
          <p className="mt-1 text-xs text-zinc-500">{filteredPolicies.length} / {policies.length} rules</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500">表示</span>
          <select className={inputClass} value={nodeFilter} onChange={(event) => setNodeFilter(event.target.value)}>
            <option value="">すべて</option>
            {networkDevices.map((node) => (
              <option key={node.id} value={node.id}>{node.id}</option>
            ))}
          </select>
          <span className="text-xs font-semibold text-zinc-500">追加先</span>
          <select className={inputClass} value={newPolicyNodeId} onChange={(event) => setNewPolicyNodeId(event.target.value)}>
            {networkDevices.map((node) => (
              <option key={node.id} value={node.id}>{node.id}</option>
            ))}
          </select>
          <button className={buttonClass("secondary")} disabled={!newPolicyNodeId} type="button" onClick={() => onAddPolicy(newPolicyNodeId)}>
            追加
          </button>
        </div>
      </div>
      {filteredPolicies.length ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[1560px] text-left text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-100 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-semibold">active</th>
                <th className="px-3 py-2 font-semibold">id</th>
                <th className="px-3 py-2 font-semibold">node</th>
                <th className="px-3 py-2 font-semibold">interface</th>
                <th className="px-3 py-2 font-semibold">name</th>
                <th className="px-3 py-2 font-semibold">direction</th>
                <th className="px-3 py-2 font-semibold">action</th>
                <th className="px-3 py-2 font-semibold">protocol</th>
                <th className="px-3 py-2 font-semibold">port</th>
                <th className="px-3 py-2 font-semibold">source</th>
                <th className="px-3 py-2 font-semibold">destination</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredPolicies.map((policy) => (
                <tr key={policy.id} className="align-top">
                  <td className="px-3 py-2">
                    <input checked={policy.active} type="checkbox" onChange={(event) => onUpdatePolicy(policy.id, { active: event.target.checked })} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-zinc-700">{policy.id}</td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={policy.node_id} onChange={(event) => onUpdatePolicy(policy.id, { node_id: event.target.value, interface_id: undefined })}>
                      {networkDevices.map((node) => (
                        <option key={node.id} value={node.id}>{node.id}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={policy.interface_id ?? ""} onChange={(event) => onUpdatePolicy(policy.id, { interface_id: event.target.value || undefined })}>
                      <option value="">node-wide</option>
                      {graph.interfaces
                        .filter((interfaceItem) => interfaceItem.node_id === policy.node_id)
                        .map((interfaceItem) => (
                          <option key={interfaceItem.id} value={interfaceItem.id}>{interfaceLabel(graph, interfaceItem.id)}</option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} value={policy.name ?? ""} onChange={(event) => onUpdatePolicy(policy.id, { name: event.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={policy.direction} onChange={(event) => onUpdatePolicy(policy.id, { direction: event.target.value as PolicyRuleModel["direction"] })}>
                      <option value="ingress">ingress</option>
                      <option value="egress">egress</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={policy.action} onChange={(event) => onUpdatePolicy(policy.id, { action: event.target.value as PolicyRuleModel["action"] })}>
                      <option value="permit">permit</option>
                      <option value="deny">deny</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className={inputClass}
                      value={policy.protocol}
                      onChange={(event) => onUpdatePolicy(policy.id, { protocol: event.target.value as PolicyProtocol, port: event.target.value === "tcp" || event.target.value === "udp" ? policy.port : undefined })}
                    >
                      <option value="any">any</option>
                      <option value="icmp">ICMP</option>
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className={inputClass}
                      disabled={policy.protocol === "any" || policy.protocol === "icmp"}
                      min="1"
                      max="65535"
                      type="number"
                      value={policy.protocol === "any" || policy.protocol === "icmp" ? "" : policy.port ?? ""}
                      onChange={(event) => onUpdatePolicy(policy.id, { port: optionalNumber(event.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} value={policy.source} onChange={(event) => onUpdatePolicy(policy.id, { source: event.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} value={policy.destination} onChange={(event) => onUpdatePolicy(policy.id, { destination: event.target.value })} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button className={cn(buttonClass("danger"), "whitespace-nowrap")} type="button" onClick={() => onDeletePolicy(policy.id)}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyMessage>表示対象のPolicyはありません。</EmptyMessage>
      )}
    </div>
  );
}

function NatPanel({
  graph,
  onAddNatRule,
  onUpdateNatRule,
  onDeleteNatRule,
}: {
  graph: GraphModel;
  onAddNatRule: (nodeId: string) => void;
  onUpdateNatRule: (ruleId: string, patch: Partial<NatRuleModel>) => void;
  onDeleteNatRule: (ruleId: string) => void;
}) {
  const rules = graph.nat_rules ?? [];
  const networkDevices = graph.nodes.filter((node) => nodeDeviceType(node) !== "client");
  const [nodeFilter, setNodeFilter] = useState("");
  const [newRuleNodeId, setNewRuleNodeId] = useState(networkDevices[0]?.id ?? "");
  const filteredRules = rules.filter((rule) => nodeFilter ? rule.node_id === nodeFilter : true);

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">NAT</h3>
          <p className="mt-1 text-xs text-zinc-500">{filteredRules.length} / {rules.length} rules</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-zinc-500">表示</span>
          <select className={inputClass} value={nodeFilter} onChange={(event) => setNodeFilter(event.target.value)}>
            <option value="">すべて</option>
            {networkDevices.map((node) => (
              <option key={node.id} value={node.id}>{node.id}</option>
            ))}
          </select>
          <span className="text-xs font-semibold text-zinc-500">追加先</span>
          <select className={inputClass} value={newRuleNodeId} onChange={(event) => setNewRuleNodeId(event.target.value)}>
            {networkDevices.map((node) => (
              <option key={node.id} value={node.id}>{node.id}</option>
            ))}
          </select>
          <button className={buttonClass("secondary")} disabled={!newRuleNodeId} type="button" onClick={() => onAddNatRule(newRuleNodeId)}>
            追加
          </button>
        </div>
      </div>
      {filteredRules.length ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[1560px] text-left text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-100 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-semibold">active</th>
                <th className="px-3 py-2 font-semibold">id</th>
                <th className="px-3 py-2 font-semibold">node</th>
                <th className="px-3 py-2 font-semibold">interface</th>
                <th className="px-3 py-2 font-semibold">direction</th>
                <th className="px-3 py-2 font-semibold">type</th>
                <th className="px-3 py-2 font-semibold">protocol</th>
                <th className="px-3 py-2 font-semibold">port</th>
                <th className="px-3 py-2 font-semibold">original</th>
                <th className="px-3 py-2 font-semibold">translated</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredRules.map((rule) => (
                <tr key={rule.id} className="align-top">
                  <td className="px-3 py-2">
                    <input checked={rule.active} type="checkbox" onChange={(event) => onUpdateNatRule(rule.id, { active: event.target.checked })} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-zinc-700">{rule.id}</td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={rule.node_id} onChange={(event) => onUpdateNatRule(rule.id, { node_id: event.target.value, interface_id: undefined })}>
                      {networkDevices.map((node) => (
                        <option key={node.id} value={node.id}>{node.id}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={rule.interface_id ?? ""} onChange={(event) => onUpdateNatRule(rule.id, { interface_id: event.target.value || undefined })}>
                      <option value="">node-wide</option>
                      {graph.interfaces
                        .filter((interfaceItem) => interfaceItem.node_id === rule.node_id)
                        .map((interfaceItem) => (
                          <option key={interfaceItem.id} value={interfaceItem.id}>{interfaceLabel(graph, interfaceItem.id)}</option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={rule.direction} onChange={(event) => onUpdateNatRule(rule.id, { direction: event.target.value as NatRuleModel["direction"] })}>
                      <option value="ingress">ingress</option>
                      <option value="egress">egress</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className={inputClass} value={rule.nat_type} onChange={(event) => onUpdateNatRule(rule.id, { nat_type: event.target.value as NatRuleModel["nat_type"] })}>
                      <option value="source">source</option>
                      <option value="destination">destination</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className={inputClass}
                      value={rule.protocol ?? "any"}
                      onChange={(event) => onUpdateNatRule(rule.id, { protocol: event.target.value as PolicyProtocol, port: event.target.value === "tcp" || event.target.value === "udp" ? rule.port : undefined })}
                    >
                      <option value="any">any</option>
                      <option value="icmp">ICMP</option>
                      <option value="tcp">TCP</option>
                      <option value="udp">UDP</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className={inputClass}
                      disabled={rule.protocol === "any" || rule.protocol === "icmp" || !rule.protocol}
                      min="1"
                      max="65535"
                      type="number"
                      value={rule.protocol === "tcp" || rule.protocol === "udp" ? rule.port ?? "" : ""}
                      onChange={(event) => onUpdateNatRule(rule.id, { port: optionalNumber(event.target.value) })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} value={rule.original} onChange={(event) => onUpdateNatRule(rule.id, { original: event.target.value })} />
                  </td>
                  <td className="px-3 py-2">
                    <input className={inputClass} value={rule.translated} onChange={(event) => onUpdateNatRule(rule.id, { translated: event.target.value })} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button className={cn(buttonClass("danger"), "whitespace-nowrap")} type="button" onClick={() => onDeleteNatRule(rule.id)}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyMessage>表示対象のNATルールはありません。</EmptyMessage>
      )}
    </div>
  );
}

function GroupSelect({
  groups,
  value,
  onChange,
}: {
  groups: NodeGroupModel[];
  value: string;
  onChange: (groupId: string) => void;
}) {
  return (
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}>
      {groups.map((group) => (
        <option key={group.id} value={group.id}>
          {group.label}
        </option>
      ))}
    </select>
  );
}

function NodeDeviceTypeSelect({
  value,
  onChange,
}: {
  value: NodeDeviceType;
  onChange: (deviceType: NodeDeviceType) => void;
}) {
  return (
    <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value as NodeDeviceType)}>
      <option value="network_device">Network Device</option>
      <option value="client">Client</option>
    </select>
  );
}

function Metric({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  tone?: "default" | "warn";
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className={cn("mb-3 flex h-9 w-9 items-center justify-center rounded-md", tone === "warn" ? "bg-yellow-50 text-yellow-700" : "bg-teal-50 text-teal-700")}>
        {icon}
      </div>
      <div className="text-2xl font-semibold text-zinc-950">{value}</div>
      <div className="text-sm text-zinc-500">{label}</div>
    </div>
  );
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-lg border border-zinc-200 bg-white shadow-sm", className)}>{children}</section>;
}

function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function EndpointSummary({
  graph,
  label,
  interfaceId,
}: {
  graph: GraphModel;
  label: string;
  interfaceId: string;
}) {
  const interfaceItem = graph.interfaces.find((item) => item.id === interfaceId);
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="text-xs font-semibold text-zinc-500">{label}</div>
      <div className="mt-1 break-all font-mono text-xs font-semibold text-zinc-900">
        {interfaceId}
      </div>
      {interfaceItem?.ip_address ? (
        <div className="mt-1 break-all font-mono text-xs text-zinc-500">
          {interfaceItem.ip_address}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-zinc-700">
      {label}
      {children}
    </label>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <p className="m-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">{children}</p>;
}

function ToolbarSeparator() {
  return <span aria-hidden="true" className="mx-1 flex min-h-9 items-center text-zinc-300">|</span>;
}

function modalTitle(activeModal: ActiveModal) {
  if (activeModal === "link") {
    return "リンク編集";
  }
  if (activeModal === "links") {
    return "Links";
  }
  if (activeModal === "node") {
    return "ノード詳細";
  }
  if (activeModal === "routing") {
    return "Routing";
  }
  if (activeModal === "policy") {
    return "Policy";
  }
  if (activeModal === "nat") {
    return "NAT";
  }
  return "トポロジ編集";
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[88vh] w-full max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-4 py-3">
          <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
          <button className={buttonClass("secondary")} type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="max-h-[calc(88vh-64px)] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "muted" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1",
        tone === "success" && "bg-teal-50 text-teal-700 ring-teal-200",
        tone === "muted" && "bg-zinc-100 text-zinc-600 ring-zinc-200",
        tone === "danger" && "bg-red-50 text-red-700 ring-red-200",
        tone === "default" && "bg-zinc-50 text-zinc-700 ring-zinc-200"
      )}
    >
      {children}
    </span>
  );
}

function trafficLabel(intent: TrafficIntent) {
  const protocol = intent.protocol.toUpperCase();
  return intent.port ? `${protocol}/${intent.port}` : protocol;
}

function evaluationItem(
  label: string,
  expected: string,
  actual: string,
  detail?: string
): EvaluationItem {
  const status = expected === actual ? "OK" : "NG";
  return {
    label,
    expected,
    actual,
    detail,
    status,
  };
}

function viaEvaluationItem(expectedVia: string, routeNodeIds: string[], strictPath: boolean): EvaluationItem {
  const matched = routeNodeIds.includes(expectedVia);
  return {
    label: "経由拠点",
    expected: strictPath ? `${expectedVia}（厳密経路）` : expectedVia,
    actual: matched ? `${expectedVia} を経由` : routeNodeIds.join(" -> "),
    status: matched ? "OK" : "NG",
  };
}

function natEvaluationItem(_intent: TrafficIntent, response: Extract<RouteResponse, { ok: true }>): EvaluationItem {
  const actualSource = response.translated_source;
  const actualDestination = response.translated_destination;
  const matchedRules = response.matched_nat_rule_ids ?? [];
  const actual = actualSource || actualDestination ? `source ${actualSource ?? "-"} / destination ${actualDestination ?? "-"}` : "変換なし";

  return {
    label: "NAT",
    expected: "到達性判定の補足",
    actual,
    detail: matchedRules.join(" -> ") || undefined,
    status: "not_applicable",
  };
}

function notApplicableItem(label: string, reason: string): EvaluationItem {
  return {
    label,
    expected: "-",
    actual: reason,
    status: "not_applicable",
  };
}

function reachabilityLabel(reachable: boolean) {
  return reachable ? "到達可能" : "到達不可";
}

function routeStatusLabel(status: RouteStatus | undefined) {
  if (status === "unreachable") {
    return "到達不可";
  }
  if (status === "loop") {
    return "ループ";
  }
  if (status === "no_route") {
    return "経路なし";
  }
  if (status === "blackhole") {
    return "ブラックホール";
  }
  if (status === "policy_denied") {
    return "Policy deny";
  }
  return "到達可能";
}

function evaluationStatusLabel(status: EvaluationItem["status"]) {
  if (status === "not_applicable") {
    return "対象外";
  }
  if (status === "not_implemented") {
    return "未評価";
  }
  return status;
}

function buttonClass(variant: "primary" | "secondary" | "success" | "danger" = "primary") {
  return cn(
    "inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-teal-200",
    variant === "primary" && "bg-teal-700 text-white hover:bg-teal-800",
    variant === "secondary" && "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50",
    variant === "success" && "bg-teal-50 text-teal-700 ring-1 ring-teal-200 hover:bg-teal-100",
    variant === "danger" && "bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100"
  );
}

const inputClass =
  "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-2 focus:ring-teal-100";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

async function loadWasm() {
  await initWasm();
  return { shortest_path } satisfies WasmModule;
}

createRoot(document.getElementById("root")!).render(<App />);
