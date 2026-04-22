import { ChangeEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileDown, FileJson, ListChecks, Network, Shield } from "lucide-react";
import { stringify as stringifyYaml } from "yaml";
import { Badge, Card, CardHeader, Field, Modal, SearchableEndpointSelect, buttonClass, cn } from "./components/common";
import { DecisionBanner } from "./components/DecisionBanner";
import { GraphEditor, NatPanel, NodeDetailsPanel, PolicyPanel, RoutingPanel, SelectedLinkPanel, TrafficIntentEditor, TrafficTestDetailPanel, TrafficTestsPanel } from "./components/editors";
import { RouteDetails } from "./components/RouteDetails";
import { Topology } from "./components/Topology";
import { exampleGraph, exampleTrafficTests } from "./exampleGraph";
import { modalTitle, routeStatusLabel } from "./formatters";
import { diagnoseRoute, diagnoseTrafficTest, endpointNameForIp, factLabel, nodeDecisionStates, trafficTestTitle } from "./diagnosis";
import { buildElkLayout } from "./topologyLayout";
import {
  applyRuntimeState,
  buildRouteRequestFromTest,
  buildLayout,
  buildTrafficIntent,
  buildTrafficSpec,
  clamp,
  cleanNatRule,
  cleanPolicyRule,
  cleanRouteEntry,
  downloadTextFile,
  exportableGraph,
  graphGroups,
  graphWithPolicies,
  graphWithRoutes,
  interfaceForNewLinkEndpoint,
  interfaceIdsFromPath,
  linkEndpointInterfaceId,
  nodeCapabilities,
  loopLinkIdsFromRoute,
  nodeIdsFromRoute,
  parseTestSuiteText,
  parseTopologyText,
  policyRulesFromGraph,
  evaluateTrafficTest,
  exportableTestSuite,
  routeDirectionsFromPath,
  routeEntriesFromGraph,
  routeRequestOrGraphToGraph,
  resolveInterfaceByIp,
  toggleSetValue,
  uniqueLinkId,
  uniqueNatRuleId,
  uniquePolicyId,
  uniqueRouteId,
  uniqueTrafficTestId,
  cleanTrafficTestRecord,
} from "./graphModel";
import type {
  ActiveModal,
  GraphModel,
  InterfaceDisplayMode,
  LayoutDirection,
  LinkModel,
  NatRuleModel,
  NodeDeviceType,
  PolicyRuleModel,
  RouteEntryModel,
  RouteMode,
  RouteRequest,
  RouteResponse,
  ReachabilityScope,
  TrafficTestRecordModel,
  TrafficTestResultModel,
  TrafficProtocol,
  TopologyLayoutModel,
  WasmModule,
} from "./types";
import initWasm, { shortest_path } from "./wasm/pathlet_wasm.js";
import "./styles.css";

function App() {
  const [graph, setGraph] = useState<GraphModel>(exampleGraph);
  const [fromInterface, setFromInterface] = useState(linkEndpointInterfaceId("osaka-office-wan", "osaka-office"));
  const [toInterface, setToInterface] = useState(linkEndpointInterfaceId("internet-public-api", "public-api"));
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
  const [manualSourceIp, setManualSourceIp] = useState(() =>
    interfaceHostIp(exampleGraph, linkEndpointInterfaceId("osaka-office-wan", "osaka-office"))
  );
  const [manualDestinationIp, setManualDestinationIp] = useState(() =>
    interfaceHostIp(exampleGraph, linkEndpointInterfaceId("internet-public-api", "public-api"))
  );
  const [expectedReachable, setExpectedReachable] = useState(true);
  const [reachabilityScope, setReachabilityScope] = useState<ReachabilityScope>("round_trip");
  const [downNodeIds, setDownNodeIds] = useState<Set<string>>(() => new Set());
  const [downInterfaceIds, setDownInterfaceIds] = useState<Set<string>>(() => new Set());
  const [layoutDirection, setLayoutDirection] = useState<LayoutDirection>("lr");
  const [layout, setLayout] = useState<TopologyLayoutModel>(() => buildLayout(exampleGraph, "lr"));
  const [routeMode, setRouteMode] = useState<RouteMode>("routing_table");
  const [activeView, setActiveView] = useState<"topology" | "rules" | "tests">("topology");
  const [interfaceDisplayMode, setInterfaceDisplayMode] = useState<InterfaceDisplayMode>("compact");
  const [trafficTests, setTrafficTests] = useState<TrafficTestRecordModel[]>(exampleTrafficTests);
  const [trafficTestResults, setTrafficTestResults] = useState<Record<string, TrafficTestResultModel>>({});
  const [selectedTrafficTestId, setSelectedTrafficTestId] = useState<string | null>(exampleTrafficTests[0]?.id ?? null);
  const [openRuleSections, setOpenRuleSections] = useState({
    routing: true,
    policy: false,
    nat: false,
  });

  const effectiveGraph = useMemo(
    () => applyRuntimeState(graph, downNodeIds, downInterfaceIds),
    [graph, downNodeIds, downInterfaceIds]
  );
  const groups = useMemo(() => graphGroups(graph), [graph]);
  const endpointOptions = useMemo(() => interfaceEndpointOptions(graph), [graph]);
  const trafficIntent = useMemo(
    () =>
      buildTrafficIntent(
        graph,
        fromInterface,
        toInterface,
        trafficProtocol,
        trafficProtocol === "icmp" ? undefined : trafficPort,
        expectedReachable,
        reachabilityScope,
        ""
      ),
    [graph, fromInterface, toInterface, trafficProtocol, trafficPort, expectedReachable, reachabilityScope]
  );
  const selectedTrafficTest = useMemo(
    () => trafficTests.find((test) => test.id === selectedTrafficTestId),
    [trafficTests, selectedTrafficTestId]
  );
  const selectedTrafficTestResult = selectedTrafficTest ? trafficTestResults[selectedTrafficTest.id] : undefined;
  const displayResponse = selectedTrafficTest ? selectedTrafficTestResult?.response ?? null : routeResponse;
  const displayIntent = useMemo(
    () => selectedTrafficTest
      ? {
          source_node_id: endpointNameForIp(effectiveGraph, selectedTrafficTest.source),
          destination_node_id: endpointNameForIp(effectiveGraph, selectedTrafficTest.destination),
          protocol: selectedTrafficTest.protocol,
          port: selectedTrafficTest.port,
          expectations: selectedTrafficTest.expectations,
        }
      : trafficIntent,
    [effectiveGraph, selectedTrafficTest, trafficIntent]
  );
  const routeDiagnosis = useMemo(
    () => selectedTrafficTest ? diagnoseTrafficTest(effectiveGraph, selectedTrafficTestResult, selectedTrafficTest) : diagnoseRoute(effectiveGraph, routeResponse, trafficIntent),
    [effectiveGraph, routeResponse, selectedTrafficTest, selectedTrafficTestResult, trafficIntent]
  );
  const displaySourceLabel = selectedTrafficTest
    ? endpointNameForIp(effectiveGraph, selectedTrafficTest.source)
    : manualSourceIp || trafficIntent.source_node_id;
  const displayDestinationLabel = selectedTrafficTest
    ? endpointNameForIp(effectiveGraph, selectedTrafficTest.destination)
    : manualDestinationIp || trafficIntent.destination_node_id;
  const displayProtocolLabel = selectedTrafficTest
    ? `${selectedTrafficTest.protocol.toUpperCase()}${selectedTrafficTest.protocol === "icmp" ? "" : `/${selectedTrafficTest.port ?? 443}`}`
    : `${trafficProtocol.toUpperCase()}${trafficProtocol === "icmp" ? "" : `/${trafficPort}`}`;
  const displayContextLabel = selectedTrafficTest
    ? `試験: ${selectedTrafficTest.name || selectedTrafficTest.id}`
    : "手動条件";
  const displayRouteEdgeDirections = useMemo(() => routeDirectionsFromPath(displayResponse, effectiveGraph), [displayResponse, effectiveGraph]);
  const displayLoopLinkIds = useMemo(() => loopLinkIdsFromRoute(displayResponse, effectiveGraph), [displayResponse, effectiveGraph]);
  const displayRouteInterfaceIds = useMemo(() => interfaceIdsFromPath(displayResponse), [displayResponse]);
  const displayRouteNodeIds = useMemo(() => nodeIdsFromRoute(displayResponse, effectiveGraph), [displayResponse, effectiveGraph]);
  const nodeStates = useMemo(
    () =>
      nodeDecisionStates({
        graph: effectiveGraph,
        response: displayResponse,
        intent: displayIntent,
        downNodeIds,
        downInterfaceIds,
      }),
    [effectiveGraph, displayResponse, displayIntent, downNodeIds, downInterfaceIds]
  );
  const activeLinkCount = effectiveGraph.links.filter((link) => link.active).length;
  const downLinkCount = effectiveGraph.links.length - activeLinkCount;
  const selectedCost = displayResponse?.ok ? displayResponse.cost : "-";
  const topologyLayoutKey = useMemo(
    () => JSON.stringify({
      nodes: graph.nodes.map(({ id, device_type, group_id, layer }) => ({ id, device_type, group_id, layer })),
      interfaces: graph.interfaces.map(({ id, node_id }) => ({ id, node_id })),
      links: graph.links.map(({ id, from_interface, to_interface }) => ({ id, from_interface, to_interface })),
      groups: graph.groups ?? [],
      direction: layoutDirection,
    }),
    [graph.nodes, graph.interfaces, graph.links, graph.groups, layoutDirection]
  );
  const routeCalculationKey = useMemo(
    () => JSON.stringify({
      ...effectiveGraph,
      nodes: effectiveGraph.nodes.map(({ x: _x, y: _y, ...node }) => node),
    }),
    [effectiveGraph]
  );

  useEffect(() => {
    void calculateRoute(effectiveGraph, fromInterface, toInterface);
  }, [routeCalculationKey, fromInterface, toInterface, routeMode, trafficProtocol, trafficPort]);

  useEffect(() => {
    let cancelled = false;
    logEvent("topology.layout.start", { direction: layoutDirection, nodes: graph.nodes.length, links: graph.links.length });
    const fallbackLayout = buildLayout(graph, layoutDirection);
    setLayout(fallbackLayout);

    buildElkLayout(graph, layoutDirection)
      .then((nextLayout) => {
        if (!cancelled) {
          setLayout(nextLayout);
          logEvent("topology.layout.ready", { engine: nextLayout.engine, width: nextLayout.width, height: nextLayout.height });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLayout(fallbackLayout);
          logEvent("topology.layout.fallback", { engine: fallbackLayout.engine });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [topologyLayoutKey]);

  async function calculateRoute(
    nextGraph = effectiveGraph,
    nextFromInterface = fromInterface,
    nextToInterface = toInterface,
    nextRouteMode = routeMode,
    nextTraffic?: RouteRequest["traffic"]
  ) {
    const request: RouteRequest = {
      graph: nextGraph,
      from_interface: nextFromInterface,
      to_interface: nextToInterface,
      mode: nextRouteMode,
      traffic: nextTraffic ?? buildTrafficSpec(nextGraph, nextFromInterface, nextToInterface, trafficProtocol, trafficProtocol === "icmp" ? undefined : trafficPort),
    };

    try {
      logEvent("route.calculate", {
        mode: request.mode,
        from: nextFromInterface,
        to: nextToInterface,
        protocol: request.traffic?.protocol,
        port: request.traffic?.port,
      });
      const wasm = await loadWasm();
      const response = JSON.parse(wasm.shortest_path(JSON.stringify(request))) as RouteResponse;
      setRouteResponse(response);
      setStatus(response.ok ? routeStatusLabel(response.status) : response.error.message);
      logEvent("route.result", response.ok ? { status: response.status, cost: response.cost } : { error: response.error });
    } catch (error) {
      setRouteResponse(null);
      setStatus(error instanceof Error ? error.message : "WASMの読み込みに失敗しました");
      logEvent("route.error", { message: error instanceof Error ? error.message : String(error) });
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
      setManualSourceIp(interfaceHostIp(nextGraph, firstInterface));
      setManualDestinationIp(interfaceHostIp(nextGraph, lastInterface));
      setSelectedTrafficTestId(null);
      setRouteResponse(null);
      setStatus(`${file.name} を読み込みました`);
      logEvent("topology.import", { file: file.name, nodes: nextGraph.nodes.length, links: nextGraph.links.length });
      void calculateRoute(nextGraph, firstInterface, lastInterface);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "トポロジJSON/YAMLが不正です");
      logEvent("topology.import.error", { file: file.name, message: error instanceof Error ? error.message : String(error) });
    }
  }

  function exportGraphAsYaml() {
    downloadTextFile("pathlet-topology.yaml", stringifyYaml(exportableGraph(graph)), "application/yaml;charset=utf-8");
    setStatus("YAMLをExportしました");
    logEvent("topology.export", { nodes: graph.nodes.length, links: graph.links.length });
  }

  async function importTrafficTests(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const suite = parseTestSuiteText(await file.text(), file.name);
      setTrafficTests(suite.tests);
      setTrafficTestResults({});
      setSelectedTrafficTestId(suite.tests[0]?.id ?? null);
      setStatus(`${file.name} の試験を読み込みました`);
      logEvent("tests.import", { file: file.name, tests: suite.tests.length });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "試験JSON/YAMLが不正です");
      logEvent("tests.import.error", { file: file.name, message: error instanceof Error ? error.message : String(error) });
    } finally {
      event.target.value = "";
    }
  }

  function exportTrafficTestsAsYaml() {
    downloadTextFile("pathlet-tests.yaml", stringifyYaml(exportableTestSuite(trafficTests)), "application/yaml;charset=utf-8");
    setStatus("試験YAMLをExportしました");
  }

  function exportTrafficTestReport() {
    const executedTests = trafficTests.filter((test) => trafficTestResults[test.id]);
    const passCount = executedTests.filter((test) => trafficTestResults[test.id]?.status === "pass").length;
    const failCount = executedTests.filter((test) => trafficTestResults[test.id]?.status === "fail").length;
    const errorCount = executedTests.filter((test) => trafficTestResults[test.id]?.status === "error").length;
    const lines = [
      "# Pathlet Traffic Test Report",
      "",
      `- Total tests: ${trafficTests.length}`,
      `- Enabled tests: ${trafficTests.filter((test) => test.enabled).length}`,
      `- Executed tests: ${executedTests.length}`,
      `- PASS: ${passCount}`,
      `- FAIL: ${failCount}`,
      `- ERROR: ${errorCount}`,
      "",
      "## Review Summary",
      "",
      "- This report focuses on design review output: intent, reality, design issue, and technical cause.",
      "",
      "| E2E | FWD | REV | Evaluation | Intent | Reality | Design Issue | Technical Cause | Advice | Test | Source | Destination | Protocol | Scope | Expected | Message |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      ...trafficTests.map((test) => {
        const result = trafficTestResults[test.id];
        const diagnosis = diagnoseTrafficTest(graph, result, test);
        return [
          factLabel(diagnosis.facts.e2e),
          factLabel(diagnosis.facts.forward),
          factLabel(diagnosis.facts.reverse),
          diagnosis.evaluation.result,
          markdownCell(diagnosis.intentRealityGap.intentLabel),
          markdownCell(diagnosis.intentRealityGap.realityLabel),
          markdownCell(diagnosis.designIssue.headline),
          diagnosis.cause.code,
          markdownCell(diagnosis.designAdvice.summary),
          markdownCell(test.name || test.id),
          markdownCell(test.source),
          markdownCell(test.destination),
          markdownCell(test.port ? `${test.protocol.toUpperCase()}/${test.port}` : test.protocol.toUpperCase()),
          test.expectations.scope === "forward_only" ? "片道" : "往復",
          test.expectations.reachable ? "到達可能" : "到達不可",
          markdownCell(result?.message ?? diagnosis.designIssue.summary),
        ].join(" | ");
      }).map((row) => `| ${row} |`),
      "",
    ];
    downloadTextFile("pathlet-test-report.md", lines.join("\n"), "text/markdown;charset=utf-8");
    setStatus("試験レポートをExportしました");
  }

  function addTrafficTest() {
    const firstIp = graph.interfaces.find((interfaceItem) => interfaceItem.ip_address)?.ip_address ?? "";
    const lastIp = [...graph.interfaces].reverse().find((interfaceItem) => interfaceItem.ip_address)?.ip_address ?? "";
    const testId = uniqueTrafficTestId(trafficTests);
    setTrafficTests((currentTests) => [
      ...currentTests,
      {
        id: testId,
        name: "new test",
        enabled: true,
        source: firstIp,
        destination: lastIp,
        protocol: "tcp",
        port: 443,
        expectations: {
          reachable: true,
          scope: "round_trip",
        },
      },
    ]);
    setSelectedTrafficTestId(testId);
    setStatus(`${testId} を追加しました`);
    logEvent("tests.add", { testId });
  }

  function updateTrafficTest(testId: string, patch: Partial<TrafficTestRecordModel>) {
    setTrafficTests((currentTests) =>
      currentTests.map((test) =>
        test.id === testId ? cleanTrafficTestRecord({ ...test, ...patch }) : test
      )
    );
    setTrafficTestResults((currentResults) => {
      const { [testId]: _removed, ...nextResults } = currentResults;
      return nextResults;
    });
  }

  function deleteTrafficTest(testId: string) {
    const remainingTests = trafficTests.filter((test) => test.id !== testId);
    setTrafficTests(remainingTests);
    setSelectedTrafficTestId((currentId) => currentId === testId ? remainingTests[0]?.id ?? null : currentId);
    setTrafficTestResults((currentResults) => {
      const { [testId]: _removed, ...nextResults } = currentResults;
      return nextResults;
    });
    setStatus(`${testId} を削除しました`);
    logEvent("tests.delete", { testId });
  }

  function selectTrafficTest(testId: string) {
    const test = trafficTests.find((testItem) => testItem.id === testId);
    if (!test) {
      return;
    }
    logEvent("tests.select", { testId });
    setSelectedTrafficTestId(testId);
    setTrafficProtocol(test.protocol);
    setManualSourceIp(test.source);
    setManualDestinationIp(test.destination);
    if (test.protocol !== "icmp") {
      setTrafficPort(test.port ?? 443);
    }
    setExpectedReachable(test.expectations.reachable);
    setReachabilityScope(test.expectations.scope ?? "round_trip");
    try {
      const request = buildRouteRequestFromTest(effectiveGraph, test);
      setFromInterface(request.from_interface);
      setToInterface(request.to_interface);
      setRouteMode(request.mode);
    } catch {
      // Keep the selected test visible even when its endpoints no longer match the topology.
    }
    if (trafficTestResults[testId]?.response) {
      setRouteResponse(trafficTestResults[testId].response ?? null);
    }
  }

  async function runTrafficTest(testId: string) {
    const test = trafficTests.find((testItem) => testItem.id === testId);
    if (!test) {
      setStatus(`${testId} が見つかりません`);
      logEvent("tests.run.missing", { testId });
      return;
    }

    logEvent("tests.run.start", { testId: test.id });
    const result = await executeTrafficTest(test, true);
    setTrafficTestResults((currentResults) => ({ ...currentResults, [test.id]: result }));
    setSelectedTrafficTestId(test.id);
    setStatus(`${test.id}: ${result.message}`);
    logEvent("tests.run.result", { testId: test.id, status: result.status, message: result.message });
  }

  async function runAllTrafficTests() {
    const enabledTests = trafficTests.filter((test) => test.enabled);
    const nextResults: Record<string, TrafficTestResultModel> = {};
    logEvent("tests.runAll.start", { tests: enabledTests.length });
    for (const test of enabledTests) {
      nextResults[test.id] = await executeTrafficTest(test, false);
    }
    setTrafficTestResults((currentResults) => ({ ...currentResults, ...nextResults }));
    const passCount = Object.values(nextResults).filter((result) => result.status === "pass").length;
    setStatus(`試験 ${passCount} / ${enabledTests.length} 件 PASS`);
    logEvent("tests.runAll.result", { pass: passCount, total: enabledTests.length });
  }

  async function executeTrafficTest(test: TrafficTestRecordModel, focusRoute: boolean): Promise<TrafficTestResultModel> {
    try {
      const request = buildRouteRequestFromTest(effectiveGraph, test);
      const wasm = await loadWasm();
      const response = JSON.parse(wasm.shortest_path(JSON.stringify(request))) as RouteResponse;
      const result = evaluateTrafficTest(test, response, effectiveGraph);

      if (focusRoute) {
        setFromInterface(request.from_interface);
        setToInterface(request.to_interface);
        setRouteMode(request.mode);
        setTrafficProtocol(test.protocol);
        if (test.protocol !== "icmp") {
          setTrafficPort(test.port ?? 443);
        }
        setExpectedReachable(test.expectations.reachable);
        setReachabilityScope(test.expectations.scope ?? "round_trip");
        setRouteResponse(response);
      }

      return result;
    } catch (error) {
      if (focusRoute) {
        setRouteResponse(null);
      }
      logEvent("tests.run.error", { testId: test.id, message: error instanceof Error ? error.message : String(error) });
      return {
        test_id: test.id,
        status: "error",
        message: error instanceof Error ? error.message : "試験の実行に失敗しました",
      };
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

  function updateLinkFromTable(linkId: string, patch: Partial<LinkModel>) {
    const nextGraph = {
      ...graph,
      links: graph.links.map((link) => (link.id === linkId ? { ...link, ...patch } : link)),
    };
    setGraph(nextGraph);
    setSelectedLinkId(linkId);
    void calculateRoute(applyRuntimeState(nextGraph, downNodeIds, downInterfaceIds), fromInterface, toInterface);
  }

  function updateNode(nodeId: string, patch: Partial<GraphModel["nodes"][number]>) {
    const nextGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    };
    setGraph(nextGraph);
    void calculateRoute(applyRuntimeState(nextGraph, downNodeIds, downInterfaceIds), fromInterface, toInterface);
  }

  function updateInterface(interfaceId: string, patch: Partial<GraphModel["interfaces"][number]>) {
    const nextGraph = {
      ...graph,
      interfaces: graph.interfaces.map((interfaceItem) =>
        interfaceItem.id === interfaceId ? { ...interfaceItem, ...patch } : interfaceItem
      ),
    };
    setGraph(nextGraph);
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
    setSelectedTrafficTestId(null);
    logEvent("route.endpoint.select", { target, interfaceId });
    if (target === "from") {
      setFromInterface(interfaceId);
      setManualSourceIp(interfaceHostIp(effectiveGraph, interfaceId));
      setSelectionTarget("to");
      void calculateRoute(effectiveGraph, interfaceId, toInterface);
      return;
    }

    setToInterface(interfaceId);
    setManualDestinationIp(interfaceHostIp(effectiveGraph, interfaceId));
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
    const nextX = clamp(x, 44, Math.max(44, layout.width - 44));
    const nextY = clamp(y, 44, Math.max(44, layout.height - 44));
    setLayout((currentLayout) => {
      const nextNodes = new Map(currentLayout.nodes);
      nextNodes.set(nodeId, { x: nextX, y: nextY });
      return { ...currentLayout, nodes: nextNodes };
    });
    setGraph((currentGraph) => ({
      ...currentGraph,
      nodes: currentGraph.nodes.map((node) =>
        node.id === nodeId ? { ...node, x: nextX, y: nextY } : node
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
          translated: "",
          protocol: "any",
          active: false,
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
    logEvent("topology.node.open", { nodeId });
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

  function showManualTrafficCheck() {
    setSelectedTrafficTestId(null);
    runManualTrafficCheck();
  }

  function runManualTrafficCheck() {
    const sourceIp = manualSourceIp.trim();
    const destinationIp = manualDestinationIp.trim();
    const sourceInterface = resolveInterfaceByIp(effectiveGraph, sourceIp);
    const destinationInterface = resolveInterfaceByIp(effectiveGraph, destinationIp);

    setSelectedTrafficTestId(null);
    if (!sourceInterface) {
      setStatus(`送信元IP '${sourceIp}' に一致するインターフェースがありません`);
      return;
    }
    if (!destinationInterface) {
      setStatus(`宛先IP '${destinationIp}' に一致するインターフェースがありません`);
      return;
    }

    setSelectedTrafficTestId(null);
    setFromInterface(sourceInterface.id);
    setToInterface(destinationInterface.id);
    void calculateRoute(
      effectiveGraph,
      sourceInterface.id,
      destinationInterface.id,
      routeMode,
      {
        protocol: trafficProtocol,
        port: trafficProtocol === "icmp" ? undefined : trafficPort,
        source: sourceIp,
        destination: destinationIp,
      }
    );
    logEvent("manualCheck.run", {
      source: sourceIp,
      destination: destinationIp,
      from: sourceInterface.id,
      to: destinationInterface.id,
    });
  }

  const viewTabs = [
    { id: "topology", label: "設計確認", icon: <Network size={16} /> },
    { id: "rules", label: "ルール編集", icon: <Shield size={16} /> },
    { id: "tests", label: "試験", icon: <ListChecks size={16} /> },
  ] as const;

  const topologyCanvas = (
    <div className="border-t border-zinc-200 bg-zinc-100/70">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">トポロジ操作</h3>
          <p className="mt-1 text-xs text-zinc-500">編集、読み込み、Exportをここで扱います。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass("secondary")} type="button" onClick={() => setActiveModal("graph")}>
            <Network size={16} />
            トポロジを編集
          </button>
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
      </div>
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
        interfaceDisplayMode={interfaceDisplayMode}
        routeEdgeDirections={displayRouteEdgeDirections}
        loopLinkIds={displayLoopLinkIds}
        routeInterfaceIds={displayRouteInterfaceIds}
        routeNodeIds={displayRouteNodeIds}
        fromInterface={fromInterface}
        toInterface={toInterface}
        downNodeIds={downNodeIds}
        downInterfaceIds={downInterfaceIds}
        nodeStates={nodeStates}
        onNodeSelect={selectNode}
        onInterfaceSelect={selectInterface}
        onLinkSelect={(linkId) => {
          setSelectedLinkId(linkId);
          setActiveModal("link");
          logEvent("topology.link.open", { linkId });
        }}
        onNodeMove={moveNode}
        onNodeMoveEnd={(nodeId) => logEvent("topology.node.moved", { nodeId })}
      />
    </div>
  );

  const endpointAndIntentPanel = (
    <div className="grid content-start gap-3">
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Field label="送信元IP">
          <SearchableEndpointSelect
            options={endpointOptions}
            value={manualSourceIp}
            onChange={(sourceIp) => {
              setSelectedTrafficTestId(null);
              setManualSourceIp(sourceIp);
            }}
          />
        </Field>
        <Field label="宛先IP">
          <SearchableEndpointSelect
            options={endpointOptions}
            value={manualDestinationIp}
            onChange={(destinationIp) => {
              setSelectedTrafficTestId(null);
              setManualDestinationIp(destinationIp);
            }}
          />
        </Field>
        <div className="flex items-end">
          <button className={buttonClass("success")} disabled={!manualSourceIp || !manualDestinationIp} type="button" onClick={runManualTrafficCheck}>
            確認
          </button>
        </div>
      </div>
      <TrafficIntentEditor
        protocol={trafficProtocol}
        port={trafficPort}
        expectedReachable={expectedReachable}
        reachabilityScope={reachabilityScope}
        onProtocolChange={(protocol) => {
          setSelectedTrafficTestId(null);
          setTrafficProtocol(protocol);
        }}
        onPortChange={(port) => {
          setSelectedTrafficTestId(null);
          setTrafficPort(port);
        }}
        onExpectedReachableChange={(reachable) => {
          setSelectedTrafficTestId(null);
          setExpectedReachable(reachable);
        }}
        onReachabilityScopeChange={(scope) => {
          setSelectedTrafficTestId(null);
          setReachabilityScope(scope);
        }}
      />
    </div>
  );

  const advancedTopologySettings = (
    <details className="border-t border-zinc-200 bg-white px-4 py-3">
      <summary className="cursor-pointer text-xs font-semibold text-zinc-600">トポロジ情報と表示設定</summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-zinc-600">
          <Badge tone="muted">{graph.nodes.length} nodes</Badge>
          <Badge tone="success">{activeLinkCount} active links</Badge>
          <Badge tone={downLinkCount ? "warn" : "muted"}>{downLinkCount} down links</Badge>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <SegmentedControl
            label="判定"
            value={routeMode}
            options={[
              { value: "routing_table", label: "Routing Table" },
              { value: "shortest_path", label: "Dijkstra" },
            ]}
            onChange={(value) => {
              setSelectedTrafficTestId(null);
              setRouteMode(value as RouteMode);
            }}
          />
          <SegmentedControl
            label="Interface"
            value={interfaceDisplayMode}
            options={[
              { value: "compact", label: "簡易" },
              { value: "detail", label: "詳細" },
            ]}
            onChange={(value) => setInterfaceDisplayMode(value as InterfaceDisplayMode)}
          />
          <SegmentedControl
            label="Layout"
            value={layoutDirection}
            options={[
              { value: "lr", label: "LR" },
              { value: "td", label: "TD" },
            ]}
            onChange={(value) => changeLayoutDirection(value as LayoutDirection)}
          />
        </div>
      </div>
    </details>
  );

  function toggleRuleSection(section: keyof typeof openRuleSections) {
    setOpenRuleSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function jumpToDiagnosisTarget() {
    const targetNodeId = routeDiagnosis.remediation.target.nodeId;
    if (targetNodeId) {
      setSelectedNodeId(targetNodeId);
      setActiveModal("node");
      setStatus(`${targetNodeId} を開きました`);
      return;
    }

    if (routeDiagnosis.remediation.target.type === "route") {
      setActiveView("rules");
      setOpenRuleSections((current) => ({ ...current, routing: true }));
      return;
    }
    if (routeDiagnosis.remediation.target.type === "policy") {
      setActiveView("rules");
      setOpenRuleSections((current) => ({ ...current, policy: true }));
      return;
    }
    if (routeDiagnosis.remediation.target.type === "nat") {
      setActiveView("rules");
      setOpenRuleSections((current) => ({ ...current, nat: true }));
    }
  }

  function ruleSection({
    id,
    title,
    summary,
    children,
  }: {
    id: keyof typeof openRuleSections;
    title: string;
    summary: string;
    children: ReactNode;
  }) {
    const open = openRuleSections[id];
    return (
      <Card className="overflow-hidden">
        <button
          className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-zinc-50"
          type="button"
          onClick={() => toggleRuleSection(id)}
          aria-expanded={open}
        >
          <div>
            <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
            <p className="mt-1 text-sm text-zinc-500">{summary}</p>
          </div>
          <Badge tone={open ? "success" : "muted"}>{open ? "閉じる" : "開く"}</Badge>
        </button>
        {open ? <div className="border-t border-zinc-200">{children}</div> : null}
      </Card>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-3 py-5 sm:px-5 lg:px-8 2xl:px-10">
        <header className="grid gap-4 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h1 className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950">
              <Network size={16} />
              Pathlet
            </h1>
          </div>
        </header>

        <section className="grid gap-4">
          <Card className="min-h-[560px] overflow-hidden">
            <CardHeader title="トポロジ" action={<Badge tone={selectedTrafficTest ? "default" : "success"}>{displayContextLabel}</Badge>} />
            {advancedTopologySettings}
            {topologyCanvas}
          </Card>

          <Card className="overflow-hidden">
            <DecisionBanner
              diagnosis={routeDiagnosis}
              source={displaySourceLabel}
              destination={displayDestinationLabel}
              protocol={displayProtocolLabel}
              sourceLabel={displayContextLabel}
              onJump={jumpToDiagnosisTarget}
            />
          </Card>
        </section>

        <nav className="flex flex-wrap gap-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          {viewTabs.map((view) => (
            <button
              className={buttonClass(activeView === view.id ? "primary" : "secondary")}
              key={view.id}
              type="button"
              onClick={() => {
                setActiveView(view.id);
                if (view.id === "topology") {
                  showManualTrafficCheck();
                } else {
                  logEvent("view.change", { view: view.id });
                }
              }}
            >
              {view.icon}
              {view.label}
            </button>
          ))}
        </nav>

        {activeView === "topology" ? (
          <section className="grid gap-4">
            <Card>
              <CardHeader
                title="手動確認"
                description="試験ではなく、その場で送信元と宛先を変えて確認する場合に使います。"
              />
              <div className="p-4 pt-0">{endpointAndIntentPanel}</div>
            </Card>
            <Card>
              <CardHeader title="経路詳細" description={`現在のcost: ${selectedCost}`} />
              <div className="p-4 pt-0">
                <details>
                  <summary className="cursor-pointer text-sm font-semibold text-zinc-700">経路と技術詳細を開く</summary>
                  <div className="mt-3">
                    <RouteDetails
                      graph={effectiveGraph}
                      intent={displayIntent}
                      routeMode={routeMode}
                      response={displayResponse}
                    />
                  </div>
                </details>
              </div>
            </Card>
          </section>
        ) : activeView === "rules" ? (
          <section className="grid gap-4">
            {ruleSection({
              id: "routing",
              title: "Routing",
              summary: `${routeEntriesFromGraph(graph).length} routes`,
              children: <RoutingPanel graph={graph} onAddRoute={addRoute} onUpdateRoute={updateRoute} onDeleteRoute={deleteRoute} />,
            })}
            {ruleSection({
              id: "policy",
              title: "Policy",
              summary: `${policyRulesFromGraph(graph).length} rules`,
              children: <PolicyPanel graph={graph} onAddPolicy={addPolicy} onUpdatePolicy={updatePolicy} onDeletePolicy={deletePolicy} />,
            })}
            {ruleSection({
              id: "nat",
              title: "NAT",
              summary: `${graph.nat_rules?.length ?? 0} rules`,
              children: <NatPanel graph={graph} onAddNatRule={addNatRule} onUpdateNatRule={updateNatRule} onDeleteNatRule={deleteNatRule} />,
            })}
          </section>
        ) : (
          <section className="grid gap-4">
            <Card>
              <CardHeader title="試験" />
              <TrafficTestsPanel
                graph={graph}
                tests={trafficTests}
                results={trafficTestResults}
                selectedTestId={selectedTrafficTestId}
                onImport={importTrafficTests}
                onExport={exportTrafficTestsAsYaml}
                onExportReport={exportTrafficTestReport}
                onAdd={addTrafficTest}
                onSelect={selectTrafficTest}
                onRun={runTrafficTest}
                onRunAll={runAllTrafficTests}
                onOpenDetails={(testId) => {
                  setSelectedTrafficTestId(testId);
                  setActiveModal("test");
                  logEvent("tests.detail.open", { testId });
                }}
              />
            </Card>
          </section>
        )}

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
                onUpdateNode={updateNode}
                onUpdateInterface={updateInterface}
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
            ) : activeModal === "test" ? (
              <TrafficTestDetailPanel
                graph={effectiveGraph}
                test={trafficTests.find((test) => test.id === selectedTrafficTestId)}
                result={selectedTrafficTestId ? trafficTestResults[selectedTrafficTestId] : undefined}
                onUpdate={updateTrafficTest}
                onDelete={(testId) => {
                  deleteTrafficTest(testId);
                  setActiveModal(null);
                }}
                onRun={runTrafficTest}
              />
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
                selectedLinkId={selectedLinkId}
                onSelectLink={(linkId) => {
                  setSelectedLinkId(linkId);
                  setActiveModal("link");
                }}
                onUpdateLink={updateLinkFromTable}
              />
            )}
          </Modal>
        ) : null}
      </div>
    </main>
  );
}

async function loadWasm() {
  await initWasm();
  return { shortest_path } satisfies WasmModule;
}

function logEvent(event: string, payload?: Record<string, unknown>) {
  console.info(`[Pathlet] ${event}`, payload ?? {});
}

function interfaceHostIp(graph: GraphModel, interfaceId: string) {
  return graph.interfaces.find((interfaceItem) => interfaceItem.id === interfaceId)?.ip_address?.split("/")[0] ?? "";
}

function interfaceEndpointOptions(graph: GraphModel) {
  return graph.interfaces.flatMap((interfaceItem) => {
    const ip = interfaceItem.ip_address?.split("/")[0];
    if (!ip) {
      return [];
    }
    return [{
      interfaceId: interfaceItem.id,
      ip,
      label: `${ip} (${interfaceItem.node_id})`,
    }];
  });
}

function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase text-zinc-500">{label}</span>
      <div className="inline-flex rounded-md border border-zinc-200 bg-white p-0.5">
        {options.map((option) => (
          <button
            className={cn(
              "rounded px-2.5 py-1 text-xs font-semibold transition",
              value === option.value ? "bg-teal-700 text-white" : "text-zinc-600 hover:bg-zinc-100"
            )}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function markdownCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

createRoot(document.getElementById("root")!).render(<App />);
