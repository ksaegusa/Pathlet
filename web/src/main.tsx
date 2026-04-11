import { ChangeEvent, ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Cable, FileJson, GitBranch, Network, Zap } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import "./styles.css";

type NodeModel = {
  id: string;
  group_id?: string;
  layer?: NetworkLayer;
  x?: number;
  y?: number;
};

type NetworkLayer = "access" | "edge" | "core" | "service";

type NodeGroupModel = {
  id: string;
  label: string;
};

type InterfaceModel = {
  id: string;
  node_id: string;
  ip_address?: string;
};

type LinkModel = {
  id: string;
  from_interface: string;
  to_interface: string;
  cost: number;
  active: boolean;
};

type VirtualIpModel = {
  id: string;
  protocol: "VRRP" | "HSRP";
  address: string;
  active_node_id: string;
  standby_node_ids: string[];
  service_node_id: string;
};

type GraphModel = {
  nodes: NodeModel[];
  interfaces: InterfaceModel[];
  links: LinkModel[];
  groups?: NodeGroupModel[];
  virtual_ips?: VirtualIpModel[];
};

type RouteRequest = {
  graph: GraphModel;
  from_interface: string;
  to_interface: string;
};

type RouteResponse =
  | { ok: true; path: string[]; equal_cost_paths?: string[][]; cost: number }
  | { ok: false; error: { code: string; message: string } };

type AlternateRoute =
  | { ok: true; path: string[]; cost: number; blockedLinkId: string }
  | { ok: false };

type TrafficProtocol = "icmp" | "tcp" | "udp";

type TrafficIntent = {
  source_node_id: string;
  destination_node_id: string;
  protocol: TrafficProtocol;
  port?: number;
  expectations: {
    reachable: boolean;
    via_node_id?: string;
    policy?: "permit" | "deny";
    nat_source_address?: string;
  };
};

type RouteEdgeDirection = {
  from_interface: string;
  to_interface: string;
};

type WasmModule = {
  default: () => Promise<void>;
  shortest_path: (json: string) => string;
};

const exampleNodes: NodeModel[] = [
  { id: "tokyo-office", layer: "access" },
  { id: "osaka-office", layer: "access" },
  { id: "nagoya-office", layer: "access" },
  { id: "fukuoka-office", layer: "access" },
  { id: "sapporo-office", layer: "access" },
  { id: "sendai-office", layer: "access" },
  { id: "tokyo-wan", layer: "edge" },
  { id: "osaka-wan", layer: "edge" },
  { id: "nagoya-wan", layer: "edge" },
  { id: "fukuoka-wan", layer: "edge" },
  { id: "sapporo-wan", layer: "edge" },
  { id: "sendai-wan", layer: "edge" },
  { id: "primary-center", layer: "core" },
  { id: "dr-center", layer: "core" },
  { id: "internet-gw", layer: "core" },
  { id: "admin-zone", layer: "core" },
  { id: "erp-vip", layer: "service" },
  { id: "files", layer: "service" },
  { id: "auth", layer: "service" },
  { id: "monitoring", layer: "service" },
];

function exampleLink(id: string, fromNode: string, toNode: string, cost: number): LinkModel {
  return {
    id,
    from_interface: `${fromNode}-eth0`,
    to_interface: `${toNode}-eth0`,
    cost,
    active: true,
  };
}

const exampleGraph: GraphModel = {
  nodes: exampleNodes,
  interfaces: exampleNodes.map((node, index) => ({
    id: `${node.id}-eth0`,
    node_id: node.id,
    ip_address: `10.0.${Math.floor(index / 254)}.${(index % 254) + 1}/24`,
  })),
  virtual_ips: [
    {
      id: "erp-vip",
      protocol: "HSRP",
      address: "10.10.0.10",
      active_node_id: "primary-center",
      standby_node_ids: ["dr-center"],
      service_node_id: "erp-vip",
    },
  ],
  links: [
    exampleLink("tokyo-office-wan", "tokyo-office", "tokyo-wan", 2),
    exampleLink("osaka-office-wan", "osaka-office", "osaka-wan", 2),
    exampleLink("nagoya-office-wan", "nagoya-office", "nagoya-wan", 3),
    exampleLink("fukuoka-office-wan", "fukuoka-office", "fukuoka-wan", 4),
    exampleLink("sapporo-office-wan", "sapporo-office", "sapporo-wan", 5),
    exampleLink("sendai-office-wan", "sendai-office", "sendai-wan", 4),
    exampleLink("tokyo-primary", "tokyo-wan", "primary-center", 3),
    exampleLink("osaka-primary", "osaka-wan", "primary-center", 4),
    exampleLink("nagoya-primary", "nagoya-wan", "primary-center", 5),
    exampleLink("fukuoka-primary", "fukuoka-wan", "primary-center", 7),
    exampleLink("sapporo-primary", "sapporo-wan", "primary-center", 8),
    exampleLink("sendai-primary", "sendai-wan", "primary-center", 6),
    exampleLink("tokyo-dr", "tokyo-wan", "dr-center", 7),
    exampleLink("osaka-dr", "osaka-wan", "dr-center", 5),
    exampleLink("nagoya-dr", "nagoya-wan", "dr-center", 6),
    exampleLink("fukuoka-dr", "fukuoka-wan", "dr-center", 4),
    exampleLink("sapporo-dr", "sapporo-wan", "dr-center", 7),
    exampleLink("sendai-dr", "sendai-wan", "dr-center", 6),
    exampleLink("primary-dr", "primary-center", "dr-center", 5),
    exampleLink("primary-internet", "primary-center", "internet-gw", 2),
    exampleLink("dr-internet", "dr-center", "internet-gw", 4),
    exampleLink("admin-primary", "admin-zone", "primary-center", 2),
    exampleLink("admin-dr", "admin-zone", "dr-center", 5),
    exampleLink("primary-erp-vip", "primary-center", "erp-vip", 2),
    exampleLink("dr-erp-vip", "dr-center", "erp-vip", 9),
    exampleLink("primary-files", "primary-center", "files", 3),
    exampleLink("primary-auth", "primary-center", "auth", 2),
    exampleLink("dr-files", "dr-center", "files", 4),
    exampleLink("dr-auth", "dr-center", "auth", 3),
    exampleLink("monitoring-primary", "monitoring", "primary-center", 3),
    exampleLink("monitoring-dr", "monitoring", "dr-center", 3),
  ],
};

const nodeRadius = 26;
const interfaceRadius = 6;
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

function App() {
  const [graph, setGraph] = useState<GraphModel>(exampleGraph);
  const [fromInterface, setFromInterface] = useState("osaka-office-eth0");
  const [toInterface, setToInterface] = useState("erp-vip-eth0");
  const [routeResponse, setRouteResponse] = useState<RouteResponse | null>(null);
  const [alternateRoute, setAlternateRoute] = useState<AlternateRoute>({ ok: false });
  const [selectionTarget, setSelectionTarget] = useState<"from" | "to">("from");
  const [status, setStatus] = useState("準備完了");
  const [selectedLinkId, setSelectedLinkId] = useState("primary-erp-vip");
  const [selectedNodeId, setSelectedNodeId] = useState("osaka-office");
  const [activeModal, setActiveModal] = useState<"link" | "graph" | "node" | null>(null);
  const [newNodeId, setNewNodeId] = useState("");
  const [newNodeGroupId, setNewNodeGroupId] = useState("edge");
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("");
  const [newLinkFrom, setNewLinkFrom] = useState("osaka-office-eth0");
  const [newLinkTo, setNewLinkTo] = useState("osaka-wan-eth0");
  const [newLinkCost, setNewLinkCost] = useState(5);
  const [trafficProtocol, setTrafficProtocol] = useState<TrafficProtocol>("tcp");
  const [trafficPort, setTrafficPort] = useState(443);
  const [expectedReachable, setExpectedReachable] = useState(true);
  const [expectedViaNodeId, setExpectedViaNodeId] = useState("primary-center");
  const [downNodeIds, setDownNodeIds] = useState<Set<string>>(() => new Set());
  const [downInterfaceIds, setDownInterfaceIds] = useState<Set<string>>(() => new Set());

  const effectiveGraph = useMemo(
    () => applyRuntimeState(graph, downNodeIds, downInterfaceIds),
    [graph, downNodeIds, downInterfaceIds]
  );
  const groups = useMemo(() => graphGroups(graph), [graph]);
  const routeEdgeDirections = useMemo(() => routeDirectionsFromPath(routeResponse, effectiveGraph), [routeResponse, effectiveGraph]);
  const routeInterfaceIds = useMemo(() => interfaceIdsFromPath(routeResponse), [routeResponse]);
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
  const layout = useMemo(() => buildLayout(graph), [graph]);
  const activeLinkCount = effectiveGraph.links.filter((link) => link.active).length;
  const downLinkCount = effectiveGraph.links.length - activeLinkCount;
  const selectedCost = routeResponse?.ok ? routeResponse.cost : "-";

  useEffect(() => {
    void calculateRoute(effectiveGraph, fromInterface, toInterface);
  }, [effectiveGraph, fromInterface, toInterface]);

  async function calculateRoute(
    nextGraph = effectiveGraph,
    nextFromInterface = fromInterface,
    nextToInterface = toInterface
  ) {
    const request: RouteRequest = {
      graph: nextGraph,
      from_interface: nextFromInterface,
      to_interface: nextToInterface,
    };

    try {
      const wasm = await loadWasm();
      const response = JSON.parse(wasm.shortest_path(JSON.stringify(request))) as RouteResponse;
      const alternate = response.ok
        ? findAlternateRoute(wasm, nextGraph, response.path, nextFromInterface, nextToInterface)
        : { ok: false as const };
      setRouteResponse(response);
      setAlternateRoute(alternate);
      setStatus(response.ok ? "" : response.error.message);
    } catch (error) {
      setRouteResponse(null);
      setAlternateRoute({ ok: false });
      setStatus(error instanceof Error ? error.message : "WASMの読み込みに失敗しました");
    }
  }

  async function importGraph(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as GraphModel | RouteRequest;
      const nextGraph = "graph" in parsed ? parsed.graph : parsed;
      const firstInterface = nextGraph.interfaces[0]?.id ?? "";
      const lastInterface = nextGraph.interfaces.at(-1)?.id ?? "";

      setGraph(nextGraph);
      setDownNodeIds(new Set());
      setDownInterfaceIds(new Set());
      setFromInterface(firstInterface);
      setToInterface(lastInterface);
      setRouteResponse(null);
      setAlternateRoute({ ok: false });
      setStatus(`${file.name} を読み込みました`);
      void calculateRoute(nextGraph, firstInterface, lastInterface);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "トポロジJSONが不正です");
    }
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
      nodes: [...graph.nodes, { id: nodeId, group_id: newNodeGroupId }],
      interfaces: [...graph.interfaces, { id: interfaceId, node_id: nodeId }],
    };
    setGraph(nextGraph);
    setNewNodeId("");
    setNewLinkTo(interfaceId);
    setStatus(`${nodeId} を追加しました`);
    void calculateRoute(applyRuntimeState(nextGraph, downNodeIds, downInterfaceIds), fromInterface, toInterface);
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

  function addLink() {
    if (!newLinkFrom || !newLinkTo || newLinkFrom === newLinkTo) {
      setStatus("異なる2つのインターフェースを選んでください");
      return;
    }

    const linkId = uniqueLinkId(graph, newLinkFrom, newLinkTo);
    const nextGraph = {
      ...graph,
      links: [
        ...graph.links,
        {
          id: linkId,
          from_interface: newLinkFrom,
          to_interface: newLinkTo,
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
            <div className="mb-2 inline-flex items-center gap-2 rounded-md bg-teal-50 px-2.5 py-1 text-sm font-semibold text-teal-700">
              <Network size={16} />
              pathlet
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
              経路シミュレーター
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600">
              リンクコストや停止状態を変えながら、最短経路の変化を確認します。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass("secondary")} type="button" onClick={() => setActiveModal("graph")}>
              <Network size={16} />
              トポロジを編集
            </button>
            <label className={buttonClass("secondary")}>
              <FileJson size={16} />
              JSONを読み込む
              <input
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={importGraph}
              />
            </label>
          </div>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Metric icon={<GitBranch size={18} />} label="現在のコスト" value={selectedCost} />
          <Metric icon={<Network size={18} />} label="ノード数" value={graph.nodes.length} />
          <Metric icon={<Cable size={18} />} label="稼働中リンク" value={activeLinkCount} />
          <Metric icon={<Zap size={18} />} label="停止中リンク" value={downLinkCount} tone="warn" />
        </section>

        <section>
          <Card className="min-h-[560px] overflow-hidden">
            <CardHeader
              title="トポロジ"
              description={`ノード詳細またはインターフェースをクリックして始点/終点を指定します。次は${selectionTarget === "from" ? "始点" : "終点"}です。`}
              action={status ? <Badge>{status}</Badge> : null}
            />
            <div className="border-t border-zinc-200 bg-zinc-100/70">
              <div className="flex flex-wrap gap-2 border-b border-zinc-200 bg-white px-4 py-3 text-xs font-medium text-zinc-600">
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-8 rounded-full bg-emerald-500" />
                  通信経路
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
                routeEdgeDirections={routeEdgeDirections}
                routeInterfaceIds={routeInterfaceIds}
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
                response={routeResponse}
                alternateRoute={alternateRoute}
              />
            </div>
          </Card>
        </section>

        <Card>
          <CardHeader
            title="リンク一覧"
            description="コストや停止状態を変更すると、経路を再計算します。"
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-y border-zinc-200 bg-zinc-100 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">状態</th>
                  <th className="px-4 py-3 font-semibold">リンク</th>
                  <th className="px-4 py-3 font-semibold">接続元</th>
                  <th className="px-4 py-3 font-semibold">接続先</th>
                  <th className="px-4 py-3 font-semibold">コスト</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {graph.links.map((link) => (
                  <tr className={cn("bg-white", link.id === selectedLinkId && "bg-teal-50/60")} key={link.id}>
                    <td className="px-4 py-3">
                      <button
                        className={buttonClass(link.active ? "success" : "danger")}
                        type="button"
                        onClick={() => toggleLink(link.id)}
                      >
                        {link.active ? "稼働" : "停止"}
                      </button>
                    </td>
                    <td className="px-4 py-3">
	                      <button
	                        className="font-medium text-zinc-900 underline-offset-4 hover:underline"
	                        type="button"
	                        onClick={() => {
                            setSelectedLinkId(link.id);
                            setActiveModal("link");
                          }}
	                      >
                        {link.id}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{interfaceLabel(graph, link.from_interface)}</td>
                    <td className="px-4 py-3 text-zinc-600">{interfaceLabel(graph, link.to_interface)}</td>
                    <td className="px-4 py-3 font-mono text-zinc-700">{link.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

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
                onSelectLink={(linkId) => {
                  setSelectedLinkId(linkId);
                  setActiveModal("link");
                }}
              />
            ) : (
              <GraphEditor
                graph={graph}
                newNodeId={newNodeId}
                newNodeGroupId={newNodeGroupId}
                newGroupId={newGroupId}
                newGroupLabel={newGroupLabel}
                newLinkFrom={newLinkFrom}
                newLinkTo={newLinkTo}
                newLinkCost={newLinkCost}
                onNodeIdChange={setNewNodeId}
                onNodeGroupChange={setNewNodeGroupId}
                onGroupIdChange={setNewGroupId}
                onGroupLabelChange={setNewGroupLabel}
                onLinkFromChange={setNewLinkFrom}
                onLinkToChange={setNewLinkTo}
                onLinkCostChange={setNewLinkCost}
                onAddNode={addNode}
                onAddGroup={addGroup}
                onAddLink={addLink}
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
  routeEdgeDirections,
  routeInterfaceIds,
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
  routeEdgeDirections: Map<string, RouteEdgeDirection>;
  routeInterfaceIds: Set<string>;
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
  const interfaceById = new Map(
    graph.interfaces.map((interfaceItem) => [interfaceItem.id, interfaceItem])
  );
  const groups = graphGroups(graph);
  const groupWidth = 700 / Math.max(groups.length, 1);

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = event.currentTarget;
    const point = svg.createSVGPoint();
    const matrix = svg.getScreenCTM();
    point.x = event.clientX;
    point.y = event.clientY;
    return matrix ? point.matrixTransform(matrix.inverse()) : point;
  }

  return (
    <svg
      className="topology block h-[560px] w-full"
      viewBox="0 0 760 460"
      role="img"
      aria-label="Network topology"
      onPointerMove={(event) => {
        if (!draggingNodeId) {
          return;
        }
        const point = pointFromEvent(event);
        onNodeMove(draggingNodeId, point.x, point.y);
      }}
      onPointerUp={() => setDraggingNodeId(null)}
      onPointerLeave={() => setDraggingNodeId(null)}
    >
      {groups.map((group, index) => (
        <g key={group.id}>
          <rect
            className="fill-white/45 stroke-zinc-200"
            x={30 + index * groupWidth}
            y="24"
            width={Math.max(92, groupWidth - 30)}
            height="404"
            rx="14"
          />
          <text className="fill-zinc-500 text-xs font-semibold uppercase" x={30 + index * groupWidth + Math.max(92, groupWidth - 30) / 2} y="48">
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
                isRoute && "route"
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

        return (
          <g key={node.id}>
            <title>{node.id}</title>
            <circle
              className={cn(
                "node",
                `group-${sanitizeClassName(nodeGroupId(node))}`,
                draggingNodeId === node.id && "dragging",
                nodeDown && "down"
              )}
              cx={point.x}
              cy={point.y}
              r={nodeRadius}
              onClick={() => onNodeSelect(node.id)}
              onPointerDown={(event) => {
                event.preventDefault();
                setDraggingNodeId(node.id);
              }}
            />
            <text
              className={cn("node-label", draggingNodeId === node.id && "dragging")}
              x={point.x}
              y={point.y + 4}
              onClick={() => onNodeSelect(node.id)}
              onPointerDown={(event) => {
                event.preventDefault();
                setDraggingNodeId(node.id);
              }}
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
              return (
                <g key={interfaceItem.id} onClick={() => onInterfaceSelect(interfaceItem.id)}>
                  <circle
                    className={cn(
                      "interface",
                      routeInterfaceIds.has(interfaceItem.id) && "route",
                      interfaceItem.id === fromInterface && "from",
                      interfaceItem.id === toInterface && "to",
                      (nodeDown || downInterfaceIds.has(interfaceItem.id)) && "down"
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
                    {role === "from" ? "F" : role === "to" ? "T" : ""}
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
  response,
  alternateRoute,
}: {
  graph: GraphModel;
  intent: TrafficIntent;
  response: RouteResponse | null;
  alternateRoute: AlternateRoute;
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
            items={[
              evaluationItem(
                "reachability",
                reachabilityLabel(intent.expectations.reachable),
                "unreachable",
                response.error.message
              ),
              notEvaluatedItem("path", "route was not calculated"),
              notEvaluatedItem("nat", "not modeled yet"),
              notEvaluatedItem("policy", "not modeled yet"),
            ]}
          />
        </div>
      </div>
    );
  }

  const routeSegments = routeSegmentsFromPath(response.path, graph);
  const routeNodeIds = nodeIdsFromPath(response.path, graph);
  const destinationVip = virtualIpForInterface(graph, response.path.at(-1) ?? "");
  const equalCostPaths = response.equal_cost_paths ?? [response.path];
  const expectedVia = intent.expectations.via_node_id;
  const actualVia = expectedVia ? routeNodeIds.includes(expectedVia) : undefined;
  const evaluationItems = [
    evaluationItem("reachability", reachabilityLabel(intent.expectations.reachable), "reachable"),
    expectedVia
      ? evaluationItem("via", expectedVia, actualVia ? expectedVia : routeNodeIds.join(" -> "))
      : notEvaluatedItem("path", "no expected via node"),
    notEvaluatedItem("nat", "not modeled yet"),
    notEvaluatedItem("policy", "not modeled yet"),
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{trafficLabel(intent)}</Badge>
        <Badge tone="success">cost {response.cost}</Badge>
        {equalCostPaths.length > 1 ? <Badge>ECMP {equalCostPaths.length}</Badge> : null}
        <Badge tone="muted">{routeSegments.length} links</Badge>
        <Badge tone="muted">{response.path.length} ifs</Badge>
        {destinationVip ? (
          <Badge>
            {destinationVip.protocol} {destinationVip.address}
          </Badge>
        ) : null}
      </div>

      <p className="break-words text-sm font-semibold leading-6 text-zinc-950">
        {routeNodeIds.join(" -> ")}
      </p>

      <EvaluationList
        items={evaluationItems}
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
                {segment.link.cost}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <details className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
        <summary className="cursor-pointer font-semibold text-zinc-700">interface path</summary>
        <p className="mt-2 break-all font-mono leading-5">{response.path.join(" -> ")}</p>
      </details>

      {equalCostPaths.length > 1 ? (
        <details className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <summary className="cursor-pointer font-semibold text-zinc-700">
            equal-cost paths ({equalCostPaths.length})
          </summary>
          <ol className="mt-2 grid gap-2">
            {equalCostPaths.map((path, index) => (
              <li className="break-all font-mono leading-5" key={`${path.join("::")}-${index}`}>
                {index + 1}. {path.join(" -> ")}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-zinc-900">代替経路</span>
          {alternateRoute.ok ? <Badge>cost {alternateRoute.cost}</Badge> : <Badge tone="muted">なし</Badge>}
        </div>
        {alternateRoute.ok ? (
          <p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-600">
            {alternateRoute.blockedLinkId} down: {alternateRoute.path.join(" -> ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type EvaluationItem = {
  label: string;
  expected: string;
  actual: string;
  status: "OK" | "NG" | "NA";
};

function EvaluationList({ items, subject }: { items: EvaluationItem[]; subject: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2">
      <div>
        <div className="text-xs font-semibold uppercase text-zinc-500">Intent Evaluation</div>
        <div className="mt-1 break-all font-mono text-xs text-zinc-600">{subject}</div>
      </div>
      {items.map((item) => (
        <div
          className="grid grid-cols-[5.5rem_1fr_1fr_3rem] items-center gap-2 text-xs"
          key={item.label}
        >
          <span className="font-semibold text-zinc-600">{item.label}</span>
          <span className="min-w-0 truncate font-mono text-zinc-600" title={item.expected}>
            expect: {item.expected}
          </span>
          <span className="min-w-0 truncate font-mono text-zinc-600" title={item.actual}>
            actual: {item.actual}
          </span>
          <Badge tone={item.status === "OK" ? "success" : item.status === "NA" ? "muted" : "danger"}>
            {item.status}
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
        <h3 className="text-xs font-semibold uppercase text-zinc-500">Intent</h3>
        <p className="mt-1 text-xs text-zinc-500">Policy/NAT 評価用の期待値です。</p>
      </div>
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <label className="grid gap-1 text-xs font-semibold text-zinc-600">
          traffic
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
          port
          <input
            className={inputClass}
            disabled={protocol === "icmp"}
            min="1"
            max="65535"
            type="number"
            value={protocol === "icmp" ? "" : port}
            onChange={(event) => onPortChange(clamp(Number(event.target.value) || 1, 1, 65535))}
          />
        </label>
      </div>
      <label className="grid gap-1 text-xs font-semibold text-zinc-600">
        expected reachability
        <select
          className={inputClass}
          value={expectedReachable ? "reachable" : "unreachable"}
          onChange={(event) => onExpectedReachableChange(event.target.value === "reachable")}
        >
          <option value="reachable">reachable</option>
          <option value="unreachable">unreachable</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-zinc-600">
        expected via
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
      <Field label="コスト">
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
  const nodeDown = downNodeIds.has(node.id);

  return (
    <div className="grid gap-4 p-4">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-950">{node.id}</h3>
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
        </div>
      </div>

      {virtualIps.length ? (
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
              {link.active ? "稼働中" : "停止中"} / コスト {link.cost}
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
  newNodeGroupId,
  newGroupId,
  newGroupLabel,
  newLinkFrom,
  newLinkTo,
  newLinkCost,
  onNodeIdChange,
  onNodeGroupChange,
  onGroupIdChange,
  onGroupLabelChange,
  onLinkFromChange,
  onLinkToChange,
  onLinkCostChange,
  onAddNode,
  onAddGroup,
  onAddLink,
  onUpdateNodeGroup,
}: {
  graph: GraphModel;
  newNodeId: string;
  newNodeGroupId: string;
  newGroupId: string;
  newGroupLabel: string;
  newLinkFrom: string;
  newLinkTo: string;
  newLinkCost: number;
  onNodeIdChange: (nodeId: string) => void;
  onNodeGroupChange: (groupId: string) => void;
  onGroupIdChange: (groupId: string) => void;
  onGroupLabelChange: (label: string) => void;
  onLinkFromChange: (interfaceId: string) => void;
  onLinkToChange: (interfaceId: string) => void;
  onLinkCostChange: (cost: number) => void;
  onAddNode: () => void;
  onAddGroup: () => void;
  onAddLink: () => void;
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
        <Field label="グループ">
          <GroupSelect groups={groups} value={newNodeGroupId} onChange={onNodeGroupChange} />
        </Field>
        <button className={buttonClass("secondary")} type="button" onClick={onAddNode}>
          ノードを追加
        </button>
      </div>

      <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <h3 className="text-sm font-semibold text-zinc-950">リンクを追加</h3>
        <Field label="接続元インターフェース">
          <select
            className={inputClass}
            value={newLinkFrom}
            onChange={(event) => onLinkFromChange(event.target.value)}
          >
            {graph.interfaces.map((interfaceItem) => (
              <option key={interfaceItem.id} value={interfaceItem.id}>
                {interfaceItem.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="接続先インターフェース">
          <select
            className={inputClass}
            value={newLinkTo}
            onChange={(event) => onLinkToChange(event.target.value)}
          >
            {graph.interfaces.map((interfaceItem) => (
              <option key={interfaceItem.id} value={interfaceItem.id}>
                {interfaceItem.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="コスト">
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
        <h3 className="text-sm font-semibold text-zinc-950">ノードのグループ</h3>
        {graph.nodes.map((node) => (
          <div className="grid grid-cols-[1fr_130px] items-center gap-2" key={node.id}>
            <span className="truncate text-sm text-zinc-700">{node.id}</span>
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

function modalTitle(activeModal: "link" | "graph" | "node") {
  if (activeModal === "link") {
    return "リンク編集";
  }
  if (activeModal === "node") {
    return "ノード詳細";
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
      <div className="max-h-[88vh] w-full max-w-xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl">
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

function findAlternateRoute(
  wasm: WasmModule,
  graph: GraphModel,
  path: string[],
  fromInterface: string,
  toInterface: string
): AlternateRoute {
  const routeLinkIds = graph.links
    .filter((link) => pathHasEdge(path, link.from_interface, link.to_interface, graph))
    .map((link) => link.id);

  const alternates = routeLinkIds
    .map((blockedLinkId) => {
      const graphWithFailure = {
        ...graph,
        links: graph.links.map((link) =>
          link.id === blockedLinkId ? { ...link, active: false } : link
        ),
      };
      const request: RouteRequest = {
        graph: graphWithFailure,
        from_interface: fromInterface,
        to_interface: toInterface,
      };
      const response = JSON.parse(wasm.shortest_path(JSON.stringify(request))) as RouteResponse;
      return response.ok ? { ...response, blockedLinkId } : null;
    })
    .filter((route): route is Extract<AlternateRoute, { ok: true }> => route !== null)
    .sort((a, b) => a.cost - b.cost);

  return alternates[0] ?? { ok: false };
}

function applyRuntimeState(
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

function toggleSetValue(values: Set<string>, value: string) {
  const nextValues = new Set(values);
  if (nextValues.has(value)) {
    nextValues.delete(value);
  } else {
    nextValues.add(value);
  }
  return nextValues;
}

function buildTrafficIntent(
  graph: GraphModel,
  fromInterface: string,
  toInterface: string,
  protocol: TrafficProtocol,
  port: number | undefined,
  reachable: boolean,
  viaNodeId: string
): TrafficIntent {
  return {
    source_node_id: nodeIdForInterface(graph, fromInterface) ?? fromInterface,
    destination_node_id: nodeIdForInterface(graph, toInterface) ?? toInterface,
    protocol,
    port,
    expectations: {
      reachable,
      via_node_id: viaNodeId || undefined,
    },
  };
}

function nodeIdForInterface(graph: GraphModel, interfaceId: string) {
  return graph.interfaces.find((interfaceItem) => interfaceItem.id === interfaceId)?.node_id;
}

function interfaceLabel(graph: GraphModel, interfaceId: string) {
  const interfaceItem = graph.interfaces.find((item) => item.id === interfaceId);
  return interfaceItem?.ip_address ? `${interfaceId} (${interfaceItem.ip_address})` : interfaceId;
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
    actual: detail ? `${actual} (${detail})` : actual,
    status,
  };
}

function notEvaluatedItem(label: string, reason: string): EvaluationItem {
  return {
    label,
    expected: "-",
    actual: reason,
    status: "NA",
  };
}

function reachabilityLabel(reachable: boolean) {
  return reachable ? "reachable" : "unreachable";
}

function pathHasEdge(path: string[], a: string, b: string, graph?: GraphModel) {
  const key = edgeKey(a, b);
  const directMatch = path.some((interfaceId, index) => {
    const next = path[index + 1];
    return next ? edgeKey(interfaceId, next) === key : false;
  });
  if (directMatch || !graph) {
    return directMatch;
  }

  const compactPath = compactInternalHops(path, graph);
  return compactPath.some((interfaceId, index) => {
    const next = compactPath[index + 1];
    return next ? edgeKey(interfaceId, next) === key : false;
  });
}

function routeSegmentsFromPath(path: string[], graph: GraphModel) {
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

function nodeIdsFromPath(path: string[], graph: GraphModel) {
  const interfaceById = new Map(
    graph.interfaces.map((interfaceItem) => [interfaceItem.id, interfaceItem])
  );
  const nodeIds = compactInternalHops(path, graph).flatMap((interfaceId) => {
    const nodeId = interfaceById.get(interfaceId)?.node_id;
    return nodeId ? [nodeId] : [];
  });

  return nodeIds.filter((nodeId, index) => nodeId !== nodeIds[index - 1]);
}

function virtualIpForInterface(graph: GraphModel, interfaceId: string) {
  const nodeId = graph.interfaces.find((interfaceItem) => interfaceItem.id === interfaceId)?.node_id;
  return (graph.virtual_ips ?? []).find((virtualIp) => virtualIp.service_node_id === nodeId);
}

function graphGroups(graph: GraphModel) {
  const groups = graph.groups?.length ? graph.groups : defaultGroups;
  const knownGroupIds = new Set(groups.map((group) => group.id));
  const missingGroups = graph.nodes
    .map(nodeGroupId)
    .filter((groupId, index, groupIds) => !knownGroupIds.has(groupId) && groupIds.indexOf(groupId) === index)
    .map((groupId) => ({ id: groupId, label: groupId }));

  return [...groups, ...missingGroups];
}

function nodeGroupId(node: NodeModel) {
  return node.group_id ?? node.layer ?? "core";
}

function groupLabel(graph: GraphModel, groupId: string) {
  return graphGroups(graph).find((group) => group.id === groupId)?.label ?? groupId;
}

function sanitizeClassName(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
}

function buildLayout(graph: GraphModel) {
  const layout = new Map<string, { x: number; y: number }>();
  const groups = graphGroups(graph);
  const groupWidth = 700 / Math.max(groups.length, 1);

  groups.forEach((group, groupIndex) => {
    const nodes = graph.nodes.filter((node) => nodeGroupId(node) === group.id);
    nodes.forEach((node, index) => {
      const spacing = 340 / Math.max(nodes.length, 1);
      layout.set(node.id, {
        x: node.x ?? 30 + groupIndex * groupWidth + Math.max(92, groupWidth - 30) / 2,
        y: node.y ?? 70 + spacing / 2 + index * spacing,
      });
    });
  });

  return layout;
}

function nodeLabelLines(nodeId: string) {
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

function linkGeometry(from: { x: number; y: number }, to: { x: number; y: number }) {
  return {
    path: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
  };
}

function routeDirectionsFromPath(routeResponse: RouteResponse | null, graph: GraphModel) {
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

function interfaceIdsFromPath(routeResponse: RouteResponse | null) {
  if (!routeResponse?.ok) {
    return new Set<string>();
  }
  return new Set((routeResponse.equal_cost_paths ?? [routeResponse.path]).flat());
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

function edgeKey(a: string, b: string) {
  return [a, b].sort().join("::");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function uniqueLinkId(graph: GraphModel, fromInterface: string, toInterface: string) {
  const base = `${fromInterface}-to-${toInterface}`.replaceAll(/[^a-zA-Z0-9-]+/g, "-");
  let candidate = base;
  let suffix = 2;

  while (graph.links.some((link) => link.id === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
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
  const wasmModulePath = "./wasm/pathlet_wasm.js";
  const wasm = (await import(/* @vite-ignore */ wasmModulePath)) as WasmModule;
  await wasm.default();
  return wasm;
}

createRoot(document.getElementById("root")!).render(<App />);
