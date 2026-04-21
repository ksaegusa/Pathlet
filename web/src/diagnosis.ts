import { nodeIdsFromPath } from "./graphModel";
import type { GraphModel, RouteResponse, RouteStatus, TrafficIntent, TrafficTestRecordModel, TrafficTestResultModel } from "./types";

export type ReachabilityFact = "pass" | "fail" | "not_checked";
export type EvaluationResult = "PASS" | "FAIL" | "PENDING" | "ERROR";
export type CauseCode =
  | "NONE"
  | "PENDING"
  | "EXPECTATION_MISMATCH"
  | "REV_ROUTE_MISSING"
  | "POLICY_DENY"
  | "NO_ROUTE"
  | "LOOP"
  | "BLACKHOLE"
  | "UNREACHABLE"
  | "ERROR";

export type NodeDecisionState = "SOURCE" | "GOAL" | "FWD" | "REV" | "AFFECTED" | "STOP" | "UNCONNECTED";
export type DiagnosisLeg = "forward" | "return" | "traffic" | "none";
export type Evidence = {
  routes: string[];
  policies: string[];
  natRules: string[];
  primaryCause: "route" | "policy" | "nat" | "topology" | "none";
};
export type Remediation = {
  summary: string;
  actions: string[];
  target: {
    type: "route" | "policy" | "nat" | "topology" | "none";
    nodeId?: string;
    interfaceId?: string;
    ruleId?: string;
  };
  confidence: "high" | "medium" | "low";
};

export type RouteDiagnosis = {
  facts: {
    e2e: ReachabilityFact;
    forward: ReachabilityFact;
    reverse: ReachabilityFact;
  };
  evaluation: {
    expectedReachable: boolean;
    result: EvaluationResult;
  };
  cause: {
    code: CauseCode;
    leg: DiagnosisLeg;
    message: string;
    evidence: Evidence;
  };
  remediation: Remediation;
};

export function actualReachabilityLabel(diagnosis: RouteDiagnosis) {
  if (diagnosis.facts.e2e === "pass") {
    return "REACHABLE";
  }
  if (diagnosis.facts.e2e === "fail") {
    return "BLOCKED";
  }
  return "NOT CHECKED";
}

export function nextActionForDiagnosis(diagnosis: RouteDiagnosis) {
  return diagnosis.remediation.summary;
}

export function diagnoseRoute(graph: GraphModel, response: RouteResponse | null, intent: TrafficIntent): RouteDiagnosis {
  if (!response) {
    return pendingDiagnosis(intent.expectations.reachable);
  }

  if (!response.ok) {
    return {
      facts: { e2e: "fail", forward: "not_checked", reverse: "not_checked" },
      evaluation: { expectedReachable: intent.expectations.reachable, result: "ERROR" },
      cause: {
        code: "ERROR",
        leg: "traffic",
        message: response.error.code,
        evidence: { routes: [], policies: [], natRules: [], primaryCause: "none" },
      },
      remediation: {
        summary: "入力値またはトポロジデータを確認してください",
        actions: [response.error.message],
        target: { type: "none" },
        confidence: "high",
      },
    };
  }

  const forwardStatus = response.forward?.status ?? response.status ?? "reachable";
  const reverseStatus = intent.expectations.scope === "forward_only" ? undefined : response.return_path?.status;
  const effectiveStatus = effectiveStatusForIntent(response, intent);
  const e2eReachable = effectiveStatus === "reachable";
  const expectationMatched = intent.expectations.reachable === e2eReachable;
  const failedLeg = failedLegFor(response, intent, effectiveStatus);
  const causeCode = causeCodeFor(response, intent, effectiveStatus, expectationMatched);
  const evidence = evidenceFor(response, failedLeg);

  return {
    facts: {
      e2e: e2eReachable ? "pass" : "fail",
      forward: forwardStatus === "reachable" ? "pass" : "fail",
      reverse: intent.expectations.scope === "forward_only" ? "not_checked" : reverseStatus === "reachable" ? "pass" : "fail",
    },
    evaluation: {
      expectedReachable: intent.expectations.reachable,
      result: expectationMatched ? "PASS" : "FAIL",
    },
    cause: {
      code: causeCode,
      leg: failedLeg,
      message: messageFor(causeCode, failedLeg, expectationMatched),
      evidence,
    },
      remediation: remediationForDiagnosis(graph, response, causeCode, failedLeg, expectationMatched, evidence),
  };
}

export function diagnoseTrafficTest(graph: GraphModel, result: TrafficTestResultModel | undefined, test: TrafficTestRecordModel): RouteDiagnosis {
  if (!result) {
    return pendingDiagnosis(test.expectations.reachable);
  }

  if (!result.response) {
    return {
      facts: { e2e: result.status === "pass" ? "pass" : "fail", forward: "not_checked", reverse: "not_checked" },
      evaluation: { expectedReachable: test.expectations.reachable, result: result.status === "pass" ? "PASS" : result.status === "error" ? "ERROR" : "FAIL" },
      cause: {
        code: result.status === "error" ? "ERROR" : result.status === "pass" ? "NONE" : "EXPECTATION_MISMATCH",
        leg: "traffic",
        message: result.message,
        evidence: { routes: [], policies: [], natRules: [], primaryCause: "none" },
      },
      remediation: {
        summary: result.status === "pass" ? "期待どおりです" : result.message,
        actions: [test.expectations.reachable ? "期待: 到達可能" : "期待: 到達不可"],
        target: { type: "none" },
        confidence: "medium",
      },
    };
  }

  const intent: TrafficIntent = {
    source_node_id: test.source,
    destination_node_id: test.destination,
    protocol: test.protocol,
    port: test.port,
    expectations: test.expectations,
  };
  return diagnoseRoute(graph, result.response, intent);
}

export function effectiveStatusForIntent(response: Extract<RouteResponse, { ok: true }>, intent: TrafficIntent): RouteStatus {
  return intent.expectations.scope === "forward_only"
    ? response.forward?.status ?? response.status ?? "reachable"
    : response.status ?? "reachable";
}

export function causeCodeLabel(code: CauseCode) {
  return code;
}

export function evaluationTone(result: EvaluationResult): "success" | "danger" | "warn" | "muted" {
  if (result === "PASS") {
    return "success";
  }
  if (result === "FAIL" || result === "ERROR") {
    return "danger";
  }
  return "muted";
}

export function factLabel(fact: ReachabilityFact) {
  if (fact === "pass") {
    return "REACHABLE";
  }
  if (fact === "fail") {
    return "BLOCKED";
  }
  return "N/A";
}

export function factTone(fact: ReachabilityFact): "success" | "danger" | "muted" {
  if (fact === "pass") {
    return "success";
  }
  if (fact === "fail") {
    return "danger";
  }
  return "muted";
}

export function causeTone(code: CauseCode, evaluationResult?: EvaluationResult): "success" | "danger" | "muted" {
  if (code === "NONE") {
    return "success";
  }
  if (evaluationResult === "PASS") {
    return "muted";
  }
  if (code === "PENDING") {
    return "muted";
  }
  return "danger";
}

export function nodeStateLabel(state: NodeDecisionState) {
  if (state === "SOURCE") {
    return "SRC";
  }
  if (state === "GOAL") {
    return "GOAL";
  }
  if (state === "AFFECTED") {
    return "CAUSE";
  }
  if (state === "STOP") {
    return "STOP";
  }
  if (state === "UNCONNECTED") {
    return "未接続";
  }
  return state;
}

export function nodeDecisionStates({
  graph,
  response,
  intent,
  downNodeIds,
  downInterfaceIds,
}: {
  graph: GraphModel;
  response: RouteResponse | null;
  intent: TrafficIntent;
  downNodeIds: Set<string>;
  downInterfaceIds: Set<string>;
}) {
  const states = new Map<string, NodeDecisionState>();
  const diagnosis = diagnoseRoute(graph, response, intent);
  const forwardNodes = response?.ok ? nodeIdsFromPath(response.forward?.path ?? response.path, graph) : [];
  const reverseNodes = response?.ok ? nodeIdsFromPath(response.return_path?.path ?? [], graph) : [];
  const affectedNodes = affectedNodeIds(graph, response, diagnosis.cause.leg);

  for (const node of graph.nodes) {
    const nodeInterfaces = graph.interfaces.filter((interfaceItem) => interfaceItem.node_id === node.id);
    const stopped = downNodeIds.has(node.id) || nodeInterfaces.some((interfaceItem) => downInterfaceIds.has(interfaceItem.id));
    const activeLinks = graph.links.filter((link) =>
      link.active && nodeInterfaces.some((interfaceItem) => link.from_interface === interfaceItem.id || link.to_interface === interfaceItem.id)
    );

    if (stopped) {
      states.set(node.id, "STOP");
    } else if (!activeLinks.length) {
      states.set(node.id, "UNCONNECTED");
    } else if (affectedNodes.has(node.id)) {
      states.set(node.id, "AFFECTED");
    } else if (forwardNodes[0] === node.id) {
      states.set(node.id, "SOURCE");
    } else if (forwardNodes.at(-1) === node.id) {
      states.set(node.id, "GOAL");
    } else if (forwardNodes.includes(node.id)) {
      states.set(node.id, "FWD");
    } else if (reverseNodes.includes(node.id)) {
      states.set(node.id, "REV");
    }
  }

  return states;
}

export function trafficTestTitle(graph: GraphModel, test: TrafficTestRecordModel) {
  return `${endpointNameForIp(graph, test.source)} -> ${endpointNameForIp(graph, test.destination)}`;
}

export function endpointNameForIp(graph: GraphModel, ipOrCidr: string) {
  const ip = ipOrCidr.split("/")[0] ?? ipOrCidr;
  const interfaceItem = graph.interfaces.find((item) => item.ip_address?.split("/")[0] === ip);
  return interfaceItem?.node_id ?? ipOrCidr;
}

export function shortInterfaceLabel(interfaceId: string | undefined) {
  if (!interfaceId) {
    return "node-wide";
  }
  return interfaceId
    .replace(/-if$/, "")
    .replace(/-wan-/, "-")
    .replace(/-eth/, "-e");
}

function pendingDiagnosis(expectedReachable: boolean): RouteDiagnosis {
  return {
    facts: { e2e: "not_checked", forward: "not_checked", reverse: "not_checked" },
    evaluation: { expectedReachable, result: "PENDING" },
    cause: {
      code: "PENDING",
      leg: "none",
      message: "判定待ち",
      evidence: { routes: [], policies: [], natRules: [], primaryCause: "none" },
    },
    remediation: {
      summary: "試験または手動確認を実行してください",
      actions: ["実行後に修正候補を表示します"],
      target: { type: "none" },
      confidence: "high",
    },
  };
}

function causeCodeFor(
  response: Extract<RouteResponse, { ok: true }>,
  intent: TrafficIntent,
  status: RouteStatus,
  expectationMatched: boolean
): CauseCode {
  if (status === "reachable") {
    return expectationMatched ? "NONE" : "EXPECTATION_MISMATCH";
  }
  if (intent.expectations.scope !== "forward_only" && response.forward?.status === "reachable" && response.return_path?.status !== "reachable") {
    return response.return_path?.status === "policy_denied" ? "POLICY_DENY" : "REV_ROUTE_MISSING";
  }
  if (status === "policy_denied") {
    return "POLICY_DENY";
  }
  if (status === "no_route") {
    return "NO_ROUTE";
  }
  if (status === "loop") {
    return "LOOP";
  }
  if (status === "blackhole") {
    return "BLACKHOLE";
  }
  return "UNREACHABLE";
}

function failedLegFor(
  response: Extract<RouteResponse, { ok: true }>,
  intent: TrafficIntent,
  status: RouteStatus
): RouteDiagnosis["cause"]["leg"] {
  if (status === "reachable") {
    return "none";
  }
  if (intent.expectations.scope === "forward_only") {
    return "forward";
  }
  if (response.forward?.status === "reachable" && response.return_path?.status !== "reachable") {
    return "return";
  }
  return response.forward?.status !== "reachable" ? "forward" : "traffic";
}

function messageFor(code: CauseCode, failedLeg: DiagnosisLeg, expectationMatched: boolean) {
  if (code === "NONE") {
    return expectationMatched ? "期待と実際が一致しています" : "到達不可を期待しましたが到達できます";
  }
  if (code === "PENDING") {
    return "判定待ち";
  }
  if (code === "REV_ROUTE_MISSING") {
    return "復路の経路が不足";
  }
  if (code === "POLICY_DENY") {
    return `${legLabel(failedLeg)}でPolicy拒否`;
  }
  if (code === "NO_ROUTE") {
    return `${legLabel(failedLeg)}の次ホップなし`;
  }
  if (code === "LOOP") {
    return `${legLabel(failedLeg)}でループ`;
  }
  if (code === "BLACKHOLE") {
    return `${legLabel(failedLeg)}でblackhole`;
  }
  if (code === "EXPECTATION_MISMATCH") {
    return "期待結果と実際の到達性が違います";
  }
  if (code === "ERROR") {
    return "入力または計算でエラーが発生しました";
  }
  return `${legLabel(failedLeg)}で到達できません`;
}

function evidenceFor(response: Extract<RouteResponse, { ok: true }>, failedLeg: DiagnosisLeg): Evidence {
  const leg = failedLeg === "return" ? response.return_path : response.forward;
  if (!leg) {
    return routeEvidence(response);
  }
  return {
    routes: leg.matched_route_ids,
    policies: leg.matched_policy_ids,
    natRules: leg.matched_nat_rule_ids,
    primaryCause: leg.matched_policy_ids.length
      ? "policy"
      : leg.matched_nat_rule_ids.length
        ? "nat"
        : leg.matched_route_ids.length
          ? "route"
          : "none",
  };
}

function routeEvidence(response: Extract<RouteResponse, { ok: true }>): Evidence {
  return {
    routes: response.matched_route_ids ?? [],
    policies: response.matched_policy_ids ?? [],
    natRules: response.matched_nat_rule_ids ?? [],
    primaryCause: response.matched_policy_ids?.length
      ? "policy"
      : response.matched_nat_rule_ids?.length
        ? "nat"
        : response.matched_route_ids?.length
          ? "route"
          : "none",
  };
}

function affectedNodeIds(graph: GraphModel, response: RouteResponse | null, failedLeg: DiagnosisLeg) {
  if (!response?.ok) {
    return new Set<string>();
  }
  const leg = failedLeg === "return" ? response.return_path : failedLeg === "forward" ? response.forward : undefined;
  const path = leg?.path ?? [];
  if (!path.length) {
    return new Set<string>();
  }
  return new Set(nodeIdsFromPath(path, graph));
}

function legLabel(failedLeg: DiagnosisLeg) {
  if (failedLeg === "return") {
    return "復路";
  }
  if (failedLeg === "forward") {
    return "往路";
  }
  return "通信";
}

function remediationForDiagnosis(
  graph: GraphModel,
  response: Extract<RouteResponse, { ok: true }>,
  code: CauseCode,
  failedLeg: DiagnosisLeg,
  expectationMatched: boolean,
  evidence: Evidence
): Remediation {
  const failedNodeId = failedNodeFor(graph, response, failedLeg);
  if (code === "NONE") {
    return {
      summary: expectationMatched ? "期待どおりに到達しています" : "到達不可を期待しましたが到達できます",
      actions: expectationMatched ? ["追加対応は不要です"] : ["期待値または試験条件を見直してください"],
      target: { type: "none" },
      confidence: "high",
    };
  }
  if (code === "PENDING") {
    return {
      summary: "試験または手動確認を実行してください",
      actions: ["実行後に修正ポイントを表示します"],
      target: { type: "none" },
      confidence: "high",
    };
  }
  if (code === "POLICY_DENY") {
    return {
      summary: "該当Policyのdeny条件を確認してください",
      actions: ["action、direction、interface、source/destination条件を確認", "必要ならpermit ruleまたは例外を追加"],
      target: { type: "policy", nodeId: failedNodeId, ruleId: evidence.policies[0] },
      confidence: evidence.policies[0] ? "high" : "medium",
    };
  }
  if (code === "REV_ROUTE_MISSING") {
    return {
      summary: "戻り方向のRouteを追加または修正してください",
      actions: ["復路のnext-hopとegress interfaceを確認", "NAT戻しが必要ならtranslatedアドレスへの戻り経路も確認"],
      target: { type: "route", nodeId: failedNodeId },
      confidence: failedNodeId ? "high" : "medium",
    };
  }
  if (code === "NO_ROUTE") {
    return {
      summary: "宛先へのRouteを追加または修正してください",
      actions: ["destination、next-hop、egress interfaceを確認", "VRF/VLANが意図どおりか確認"],
      target: { type: "route", nodeId: failedNodeId, ruleId: evidence.routes[0] },
      confidence: failedNodeId ? "high" : "medium",
    };
  }
  if (code === "LOOP") {
    return {
      summary: "next-hopの循環を解消してください",
      actions: ["同じ宛先に対するrouteのnext-hop循環を確認", "優先度やinactive routeの設定も確認"],
      target: { type: "route", nodeId: failedNodeId, ruleId: evidence.routes[0] },
      confidence: "medium",
    };
  }
  if (code === "BLACKHOLE") {
    return {
      summary: "blackhole routeの意図を確認してください",
      actions: ["blackhole routeが必要か確認", "必要でなければ通常routeへ置き換え"],
      target: { type: "route", nodeId: failedNodeId, ruleId: evidence.routes[0] },
      confidence: "medium",
    };
  }
  if (code === "ERROR") {
    return {
      summary: "入力値またはトポロジデータを確認してください",
      actions: ["interface、route、link参照の整合性を確認"],
      target: { type: "none" },
      confidence: "high",
    };
  }
  return {
    summary: `${legLabel(failedLeg)}のRouting、Policy、NATを順に確認してください`,
    actions: ["まずrouting、その後policy、最後にNATを確認"],
    target: { type: evidence.primaryCause === "none" ? "topology" : evidence.primaryCause, nodeId: failedNodeId },
    confidence: "medium",
  };
}

function failedNodeFor(graph: GraphModel, response: Extract<RouteResponse, { ok: true }>, failedLeg: DiagnosisLeg) {
  const path = failedLeg === "return"
    ? (response.return_path?.path ?? [])
    : failedLeg === "forward"
      ? (response.forward?.path ?? response.path)
      : response.path;
  const interfaceId = path.length ? path.at(-1) : undefined;
  return interfaceId
    ? graph.interfaces.find((interfaceItem) => interfaceItem.id === interfaceId)?.node_id
    : undefined;
}
