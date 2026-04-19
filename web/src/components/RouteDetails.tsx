import { nodeIdsFromPath, routeSegmentsFromPath, virtualIpForInterface } from "../graphModel";
import { evaluationStatusLabel, type EvaluationStatus, reachabilityLabel, reachabilityScopeLabel, routeStatusLabel, trafficLabel } from "../formatters";
import type { GraphModel, PipelineLeg, RouteMode, RouteResponse, TrafficIntent } from "../types";
import { Badge, EmptyMessage } from "./common";

export function RouteDetails({
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
            items={[
              evaluationItem(
                "到達性",
                reachabilityLabel(intent.expectations.reachable),
                "到達不可",
                response.error.message
              ),
            ]}
          />
        </div>
      </div>
    );
  }

  const forwardPath = response.forward?.path ?? response.path;
  const returnPath = response.return_path?.path ?? [];
  const routeSegments = routeSegmentsFromPath(forwardPath, graph);
  const routeNodeIds = nodeIdsFromPath(forwardPath, graph);
  const destinationVip = virtualIpForInterface(graph, forwardPath.at(-1) ?? "");
  const routeStatus = response.status ?? "reachable";
  const forwardStatus = response.forward?.status ?? routeStatus;
  const returnStatus = response.return_path?.status;
  const effectiveStatus = effectiveRouteStatus(response, intent);
  const expectedVia = intent.expectations.via_node_id;
  const evaluationItems = [
    evaluationItem("到達性", reachabilityLabel(intent.expectations.reachable), routeStatusLabel(effectiveStatus), routeOutcomeDetail(response, intent)),
    evaluationItem("判定範囲", reachabilityScopeLabel(intent.expectations.scope), reachabilityScopeLabel(intent.expectations.scope)),
    evaluationItem("往路", "到達可能", routeStatusLabel(forwardStatus), response.forward ? legFailureDetail("往路", response.forward) : undefined),
    ...(intent.expectations.scope === "forward_only" ? [] : response.return_path ? [evaluationItem("復路", "到達可能", routeStatusLabel(returnStatus), legFailureDetail("復路", response.return_path))] : []),
    ...(expectedVia ? [viaEvaluationItem(expectedVia, routeNodeIds, intent.expectations.strict_path ?? false)] : []),
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{routeMode === "shortest_path" ? "Dijkstra" : "Routing Table"}</Badge>
        <Badge>{trafficLabel(intent)}</Badge>
        <Badge tone={effectiveStatus === "reachable" ? "success" : "danger"}>
          {routeStatusLabel(effectiveStatus)}
        </Badge>
        <Badge tone="success">link cost {response.cost}</Badge>
        <Badge tone="muted">往路 {routeSegments.length} links</Badge>
        {destinationVip ? (
          <Badge>
            {destinationVip.protocol} {destinationVip.address}
          </Badge>
        ) : null}
      </div>

      <RouteDecisionSummary graph={graph} intent={intent} response={response} />

      <EvaluationList
        items={evaluationItems}
        subject={`${intent.source_node_id} -> ${intent.destination_node_id} / ${trafficLabel(intent)}`}
      />

      <PipelineDetails graph={graph} forward={response.forward} returnPath={response.return_path} fallbackForwardPath={forwardPath} />
    </div>
  );
}

type EvaluationItem = {
  label: string;
  expected: string;
  actual: string;
  detail?: string;
  status: EvaluationStatus;
};

function RouteDecisionSummary({
  graph,
  intent,
  response,
}: {
  graph: GraphModel;
  intent: TrafficIntent;
  response: Extract<RouteResponse, { ok: true }>;
}) {
  const routeStatus = response.status ?? "reachable";
  const effectiveStatus = effectiveRouteStatus(response, intent);
  const actualReachable = effectiveStatus === "reachable";
  const expectationMatched = intent.expectations.reachable === actualReachable;
  const forwardPath = response.forward?.path ?? response.path;
  const returnPath = response.return_path?.path ?? [];
  const forwardNodes = nodeIdsFromPath(forwardPath, graph);
  const returnNodes = nodeIdsFromPath(returnPath, graph);
  const returnStatus = response.return_path?.status;
  const isReturnFailure = response.forward?.status === "reachable" && returnStatus && returnStatus !== "reachable";
  const decisionHeadline = routeDecisionHeadline(response, intent);
  const toneClass = expectationMatched
    ? "rounded-md border border-teal-200 bg-teal-50 p-3"
    : "rounded-md border border-red-200 bg-red-50 p-3";
  const titleClass = expectationMatched ? "text-sm font-semibold text-teal-800" : "text-sm font-semibold text-red-800";
  const textClass = expectationMatched ? "text-xs leading-5 text-teal-700" : "text-xs leading-5 text-red-700";

  return (
    <div className={toneClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={titleClass}>
          {expectationMatched ? "要件判定: OK" : "要件判定: NG"}
        </div>
        <Badge tone={expectationMatched ? "success" : "danger"}>
          実際 {routeStatusLabel(effectiveStatus)}
        </Badge>
      </div>
      <div className="mt-2 grid gap-1.5">
        <SummaryRow label="通信要件" value={`${intent.source_node_id} -> ${intent.destination_node_id} / ${trafficLabel(intent)} / ${reachabilityLabel(intent.expectations.reachable)} / ${reachabilityScopeLabel(intent.expectations.scope)}`} />
        <SummaryRow label="往路" value={forwardNodes.length ? forwardNodes.join(" -> ") : "経路情報なし"} />
        {intent.expectations.scope === "forward_only" ? null : response.return_path ? <SummaryRow label="復路" value={returnNodes.length ? returnNodes.join(" -> ") : "経路情報なし"} /> : null}
        <SummaryRow label="理由" value={decisionHeadline} />
        <SummaryRow label="参照情報" value={routeEvidenceSummary(response)} />
      </div>
      {intent.expectations.scope !== "forward_only" && isReturnFailure ? (
        <p className={`mt-2 ${textClass}`}>
          往路だけを見ると到達していますが、E2E では復路まで含めて判定しています。
        </p>
      ) : null}
    </div>
  );
}

function routeDecisionHeadline(response: Extract<RouteResponse, { ok: true }>, intent: TrafficIntent) {
  const routeStatus = effectiveRouteStatus(response, intent);
  const actualReachable = routeStatus === "reachable";
  if (actualReachable && !intent.expectations.reachable) {
    return intent.expectations.scope === "forward_only"
      ? "到達不可を期待しましたが、往路は到達できます。"
      : "到達不可を期待しましたが、往路・復路とも到達できます。";
  }
  if (actualReachable) {
    return intent.expectations.scope === "forward_only"
      ? "往路が到達できるためOKです。"
      : "往路・復路とも到達できるためOKです。";
  }

  const failedLegLabel = intent.expectations.scope === "forward_only" || response.forward?.status !== "reachable" ? "往路" : response.return_path?.status !== "reachable" ? "復路" : "通信";
  if (routeStatus === "no_route") {
    return `${failedLegLabel}に必要な経路がないためNGです。`;
  }
  if (routeStatus === "policy_denied") {
    return `${failedLegLabel}でPolicy denyに一致したためNGです。`;
  }
  if (routeStatus === "loop") {
    return `${failedLegLabel}でルーティングループを検出したためNGです。`;
  }
  if (routeStatus === "blackhole") {
    return `${failedLegLabel}でblackhole routeに一致したためNGです。`;
  }
  if (routeStatus === "unreachable") {
    return `${failedLegLabel}で宛先まで到達できないためNGです。`;
  }
  return `通信は${routeStatusLabel(routeStatus)}です。`;
}

function effectiveRouteStatus(response: Extract<RouteResponse, { ok: true }>, intent: TrafficIntent) {
  return intent.expectations.scope === "forward_only"
    ? response.forward?.status ?? response.status ?? "reachable"
    : response.status ?? "reachable";
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-xs sm:grid-cols-[5rem_minmax(0,1fr)]">
      <span className="font-semibold text-zinc-700">{label}</span>
      <span className="min-w-0 break-words font-mono text-zinc-700">{value}</span>
    </div>
  );
}

function PipelineDetails({
  graph,
  forward,
  returnPath,
  fallbackForwardPath,
}: {
  graph: GraphModel;
  forward?: PipelineLeg;
  returnPath?: PipelineLeg;
  fallbackForwardPath: string[];
}) {
  if (!forward && !returnPath) {
    return null;
  }

  return (
    <div className="grid gap-2">
      <div>
        <h3 className="text-sm font-semibold text-zinc-950">経路と処理</h3>
        <p className="mt-1 text-xs text-zinc-500">
          往路と復路それぞれのパス、ルート参照、Policy、NAT をまとめて表示します。
        </p>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {forward ? <PipelineLegDetails graph={graph} title="往路" leg={forward} fallbackPath={fallbackForwardPath} /> : null}
        {returnPath ? <PipelineLegDetails graph={graph} title="復路" leg={returnPath} fallbackPath={[]} /> : null}
      </div>
    </div>
  );
}

function PipelineLegDetails({
  graph,
  title,
  leg,
  fallbackPath,
}: {
  graph: GraphModel;
  title: string;
  leg: PipelineLeg;
  fallbackPath: string[];
}) {
  const path = leg.path.length ? leg.path : fallbackPath;
  const segments = routeSegmentsFromPath(path, graph);
  const nodeIds = nodeIdsFromPath(path, graph);
  return (
    <div className={leg.status === "reachable" ? "rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600" : "rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700"}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">{title}</h4>
        <Badge tone={leg.status === "reachable" ? "success" : "danger"}>
          {routeStatusLabel(leg.status)}
        </Badge>
      </div>
      <div className="grid gap-2">
        <PipelineRow label="nodes" value={nodeIds.length ? nodeIds.join(" -> ") : "経路情報なし"} />
        <PipelineRow label="links" value={segments.length ? segments.map((segment) => `${segment.link.id}(cost ${segment.link.cost})`).join(" -> ") : "なし"} />
        <PipelineRow label="IP" value={pipelineAddressSummary(leg)} />
        <PipelineRow label="routes" value={leg.matched_route_ids.length ? leg.matched_route_ids.join(" -> ") : "なし"} />
        <PipelineRow label="policy" value={leg.matched_policy_ids.length ? leg.matched_policy_ids.join(" -> ") : "なし"} />
        <PipelineRow label="NAT" value={leg.matched_nat_rule_ids.length ? leg.matched_nat_rule_ids.join(" -> ") : "なし"} />
        {leg.status !== "reachable" ? (
          <p className="rounded bg-white/70 px-2 py-1 leading-5">
            {legFailureDetail(title, leg)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PipelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
      <span className="font-semibold">{label}</span>
      <span className="min-w-0 overflow-x-auto whitespace-nowrap font-mono leading-5">{value}</span>
    </div>
  );
}

function pipelineAddressSummary(leg: PipelineLeg) {
  return `source ${leg.source_before ?? "-"} -> ${leg.source_after ?? "-"} / destination ${leg.destination_before ?? "-"} -> ${leg.destination_after ?? "-"}`;
}

function routeEvidenceSummary(response: Extract<RouteResponse, { ok: true }>) {
  const routes = compactEvidence([
    ...(response.forward?.matched_route_ids ?? response.matched_route_ids ?? []),
    ...(response.return_path?.matched_route_ids ?? []),
  ]);
  const policies = compactEvidence([
    ...(response.forward?.matched_policy_ids ?? response.matched_policy_ids ?? []),
    ...(response.return_path?.matched_policy_ids ?? []),
  ]);
  const natRules = compactEvidence([
    ...(response.forward?.matched_nat_rule_ids ?? response.matched_nat_rule_ids ?? []),
    ...(response.return_path?.matched_nat_rule_ids ?? []),
  ]);

  return `routes ${routes.length ? routes.join(" -> ") : "なし"} / policy ${policies.length ? policies.join(" -> ") : "なし"} / NAT ${natRules.length ? natRules.join(" -> ") : "なし"}`;
}

function compactEvidence(values: string[]) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function EvaluationList({ items, subject }: { items: EvaluationItem[]; subject: string }) {
  return (
    <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2">
      <div>
        <div className="text-xs font-semibold text-zinc-500">E2E検証結果</div>
        <div className="mt-1 break-all text-xs text-zinc-600">通信要件: {subject}</div>
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

function routeOutcomeDetail(response: Extract<RouteResponse, { ok: true }>, intent: TrafficIntent) {
  const forwardStatus = response.forward?.status;
  const returnStatus = response.return_path?.status;
  if (forwardStatus && forwardStatus !== "reachable") {
    return `往路が ${routeStatusLabel(forwardStatus)} です。宛先まで到達できていません。`;
  }
  if (intent.expectations.scope === "forward_only") {
    return "片道判定のため、復路はOK/NG判定に含めません。";
  }
  if (returnStatus && returnStatus !== "reachable") {
    return `往路は到達していますが、復路が ${routeStatusLabel(returnStatus)} です。戻り通信の経路、Policy、NAT戻しを確認してください。`;
  }
  if ((response.status ?? "reachable") !== "reachable") {
    return `通信は ${routeStatusLabel(response.status)} と判定されました。`;
  }
  return "往路と復路の両方が到達可能です。";
}

function legFailureDetail(label: string, leg: PipelineLeg) {
  if (leg.status === "reachable") {
    return undefined;
  }
  const path = leg.path.length ? ` 到達できた範囲: ${leg.path.join(" -> ")}。` : "";
  if (leg.status === "no_route") {
    return `${label}で次の宛先へ進むルートが見つかりません。${path}`;
  }
  if (leg.status === "policy_denied") {
    return `${label}でPolicy denyに一致しました。${leg.matched_policy_ids.join(" -> ")}`;
  }
  if (leg.status === "loop") {
    return `${label}でループを検出しました。${path}`;
  }
  if (leg.status === "blackhole") {
    return `${label}でblackhole routeに一致しました。${path}`;
  }
  return `${label}は ${routeStatusLabel(leg.status)} です。${path}`;
}
