import { ChangeEvent, Fragment, useState } from "react";
import {
  formatBandwidth,
  graphGroups,
  groupLabel,
  interfaceLabel,
  linkNodeIds,
  nodeCapabilities,
  nodeDeviceType,
  nodeDeviceTypeLabel,
  nodeGroupId,
  normalizeTransportPort,
  optionalNumber,
  policyRulesFromGraph,
  routeEntriesFromGraph,
} from "../graphModel";
import { reachabilityScopeLabel, routeStatusLabel, testResultLabel } from "../formatters";
import type {
  GraphModel,
  LinkModel,
  NatRuleModel,
  NodeDeviceType,
  NodeGroupModel,
  NodeModel,
  PipelineLeg,
  PolicyProtocol,
  PolicyRuleModel,
  ReachabilityScope,
  RouteEntryModel,
  TrafficTestRecordModel,
  TrafficTestResultModel,
  TrafficProtocol,
} from "../types";
import { Badge, EmptyMessage, Field, buttonClass, cn, inputClass } from "./common";

export function TrafficIntentEditor({
  graph,
  protocol,
  port,
  expectedReachable,
  reachabilityScope,
  expectedViaNodeId,
  onProtocolChange,
  onPortChange,
  onExpectedReachableChange,
  onReachabilityScopeChange,
  onExpectedViaNodeIdChange,
}: {
  graph: GraphModel;
  protocol: TrafficProtocol;
  port: number;
  expectedReachable: boolean;
  reachabilityScope: ReachabilityScope;
  expectedViaNodeId: string;
  onProtocolChange: (protocol: TrafficProtocol) => void;
  onPortChange: (port: number) => void;
  onExpectedReachableChange: (reachable: boolean) => void;
  onReachabilityScopeChange: (scope: ReachabilityScope) => void;
  onExpectedViaNodeIdChange: (nodeId: string) => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-500">通信要件</h3>
        <span className="text-[11px] text-zinc-500">E2E到達性</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_88px_1fr_1fr_1fr]">
        <label className="grid gap-1 text-xs font-semibold text-zinc-600">
          種別
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
          判定範囲
          <select
            className={inputClass}
            value={reachabilityScope}
            onChange={(event) => onReachabilityScopeChange(event.target.value as ReachabilityScope)}
          >
            <option value="round_trip">往復</option>
            <option value="forward_only">片道（往路のみ）</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-zinc-600">
          経由
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
    </div>
  );
}

export function SelectedLinkPanel({
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

export function NodeDetailsPanel({
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

export function GraphEditor({
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

export function LinksPanel({
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

export function RoutingPanel({
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

export function PolicyPanel({
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

export function NatPanel({
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

export function TrafficTestsPanel({
  graph,
  tests,
  results,
  onImport,
  onExport,
  onExportReport,
  onAdd,
  onUpdate,
  onDelete,
  onRun,
  onRunAll,
}: {
  graph: GraphModel;
  tests: TrafficTestRecordModel[];
  results: Record<string, TrafficTestResultModel>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onExportReport: () => void;
  onAdd: () => void;
  onUpdate: (testId: string, patch: Partial<TrafficTestRecordModel>) => void;
  onDelete: (testId: string) => void;
  onRun: (testId: string) => void;
  onRunAll: () => void;
}) {
  const enabledCount = tests.filter((test) => test.enabled).length;
  const executedCount = tests.filter((test) => results[test.id]).length;
  const passCount = tests.filter((test) => results[test.id]?.status === "pass").length;
  const failCount = tests.filter((test) => results[test.id]?.status === "fail").length;
  const errorCount = tests.filter((test) => results[test.id]?.status === "error").length;
  const pendingCount = tests.length - executedCount;
  const [expandedTestIds, setExpandedTestIds] = useState<Set<string>>(() => new Set());

  function toggleTestDetails(testId: string) {
    setExpandedTestIds((current) => {
      const next = new Set(current);
      if (next.has(testId)) {
        next.delete(testId);
        return next;
      }
      next.add(testId);
      return next;
    });
  }

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">通信試験</h3>
          <p className="mt-1 text-xs text-zinc-500">
            {enabledCount} / {tests.length} tests enabled
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={buttonClass("secondary")} type="button" onClick={onAdd}>
            試験追加
          </button>
          <button className={buttonClass("secondary")} disabled={!enabledCount} type="button" onClick={onRunAll}>
            全件実行
          </button>
          <label className={buttonClass("secondary")}>
            試験を読み込む
            <input
              className="sr-only"
              type="file"
              accept="application/json,application/yaml,text/yaml,.json,.yaml,.yml"
              onChange={onImport}
            />
          </label>
          <button className={buttonClass("secondary")} disabled={!tests.length} type="button" onClick={onExport}>
            試験YAMLでExport
          </button>
          <button className={buttonClass("secondary")} disabled={!executedCount} type="button" onClick={onExportReport}>
            レポートExport
          </button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-5">
        <ReportMetric label="実行済み" value={`${executedCount} / ${tests.length}`} />
        <ReportMetric label="PASS" value={passCount} tone="success" />
        <ReportMetric label="FAIL" value={failCount} tone="danger" />
        <ReportMetric label="ERROR" value={errorCount} tone="danger" />
        <ReportMetric label="未実行" value={pendingCount} />
      </div>

      {tests.length ? (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full min-w-[1260px] text-left text-xs">
            <thead className="border-b border-zinc-200 bg-zinc-100 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-semibold">enabled</th>
                <th className="px-3 py-2 font-semibold">試験名</th>
                <th className="px-3 py-2 font-semibold">source IP</th>
                <th className="px-3 py-2 font-semibold">destination IP</th>
                <th className="px-3 py-2 font-semibold">protocol</th>
                <th className="px-3 py-2 font-semibold">port</th>
                <th className="px-3 py-2 font-semibold">判定範囲</th>
                <th className="px-3 py-2 font-semibold">期待到達性</th>
                <th className="px-3 py-2 font-semibold">結果</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {tests.map((test) => {
                const result = results[test.id];
                const expanded = expandedTestIds.has(test.id);
                return (
                  <Fragment key={test.id}>
                    <tr className="align-top">
                      <td className="px-3 py-2">
                        <input
                          checked={test.enabled}
                          type="checkbox"
                          onChange={(event) => onUpdate(test.id, { enabled: event.target.checked })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={inputClass}
                          value={test.expectations.scope ?? "round_trip"}
                          onChange={(event) => onUpdate(test.id, { expectations: { ...test.expectations, scope: event.target.value as ReachabilityScope } })}
                        >
                          <option value="round_trip">往復</option>
                          <option value="forward_only">片道</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputClass} placeholder={test.id} value={test.name ?? ""} onChange={(event) => onUpdate(test.id, { name: event.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputClass} value={test.source} onChange={(event) => onUpdate(test.id, { source: event.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <input className={inputClass} value={test.destination} onChange={(event) => onUpdate(test.id, { destination: event.target.value })} />
                      </td>
                      <td className="px-3 py-2">
                        <select className={inputClass} value={test.protocol} onChange={(event) => onUpdate(test.id, { protocol: event.target.value as TrafficProtocol, port: event.target.value === "icmp" ? undefined : test.port })}>
                          <option value="icmp">ICMP</option>
                          <option value="tcp">TCP</option>
                          <option value="udp">UDP</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className={inputClass}
                          disabled={test.protocol === "icmp"}
                          min="1"
                          max="65535"
                          type="number"
                          value={test.protocol === "icmp" ? "" : test.port ?? ""}
                          onChange={(event) => onUpdate(test.id, { port: optionalNumber(event.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className={inputClass}
                          value={test.expectations.reachable ? "reachable" : "unreachable"}
                          onChange={(event) => onUpdate(test.id, { expectations: { ...test.expectations, reachable: event.target.value === "reachable" } })}
                        >
                          <option value="reachable">到達可能</option>
                          <option value="unreachable">到達不可</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="grid min-w-[220px] gap-1">
                          <Badge tone={resultTone(result)}>{testResultLabel(result?.status)}</Badge>
                          <span className="break-words text-zinc-500">{result?.message ?? "まだ実行していません"}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button className={cn(buttonClass("secondary"), "whitespace-nowrap")} type="button" onClick={() => onRun(test.id)}>
                            実行
                          </button>
                          <button className={cn(buttonClass("secondary"), "whitespace-nowrap")} type="button" onClick={() => toggleTestDetails(test.id)} aria-expanded={expanded}>
                            {expanded ? "詳細を閉じる" : "詳細"}
                          </button>
                          <button className={cn(buttonClass("danger"), "whitespace-nowrap")} type="button" onClick={() => onDelete(test.id)}>
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td className="bg-zinc-50 px-3 py-3" colSpan={10}>
                          <TrafficTestDetails test={test} result={result} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyMessage>通信試験はありません。試験を追加するか、試験JSON/YAMLを読み込んでください。</EmptyMessage>
      )}
    </div>
  );
}

function resultTone(result: TrafficTestResultModel | undefined) {
  if (result?.status === "pass") {
    return "success";
  }
  if (result?.status === "fail" || result?.status === "error") {
    return "danger";
  }
  return "muted";
}

function ReportMetric({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string | number;
  tone?: "success" | "danger" | "muted";
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="text-xs font-semibold text-zinc-500">{label}</div>
      <div className={cn(
        "mt-1 text-xl font-semibold",
        tone === "success" && "text-teal-700",
        tone === "danger" && "text-red-700",
        tone === "muted" && "text-zinc-950"
      )}>
        {value}
      </div>
    </div>
  );
}

function TrafficTestDetails({
  test,
  result,
}: {
  test: TrafficTestRecordModel;
  result: TrafficTestResultModel | undefined;
}) {
  const response = result?.response;
  const okResponse = response?.ok ? response : undefined;

  return (
    <div className="grid gap-3 rounded-md border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
      <div className="grid gap-2 md:grid-cols-3">
        <DetailItem label="通信" value={`${test.source} -> ${test.destination}`} />
        <DetailItem label="プロトコル" value={test.port ? `${test.protocol.toUpperCase()}/${test.port}` : test.protocol.toUpperCase()} />
        <DetailItem label="判定範囲" value={reachabilityScopeLabel(test.expectations.scope)} />
      </div>
      <div className="grid gap-2">
        <DetailItem label="期待" value={test.expectations.reachable ? "到達可能" : "到達不可"} />
        <DetailItem label="結果" value={result ? `${testResultLabel(result.status)}: ${result.message}` : "まだ実行していません"} />
      </div>
      {response && !response.ok ? (
        <DetailItem label="エラー" value={`${response.error.code}: ${response.error.message}`} />
      ) : null}
      {okResponse ? (
        <div className="grid gap-2 lg:grid-cols-2">
          <TrafficLegDetail title="往路" leg={okResponse.forward} fallbackPath={okResponse.path} />
          <TrafficLegDetail title="復路" leg={okResponse.return_path} />
        </div>
      ) : null}
    </div>
  );
}

function TrafficLegDetail({
  title,
  leg,
  fallbackPath = [],
}: {
  title: string;
  leg?: PipelineLeg;
  fallbackPath?: string[];
}) {
  const path = leg?.path ?? fallbackPath;
  return (
    <div className="grid gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-zinc-800">{title}</span>
        <Badge tone={leg?.status === "reachable" ? "success" : leg ? "danger" : "muted"}>
          {leg ? routeStatusLabel(leg.status) : "未計算"}
        </Badge>
      </div>
      <DetailItem label="path" value={path.length ? path.join(" -> ") : "-"} />
      <DetailItem label="routes" value={leg?.matched_route_ids.length ? leg.matched_route_ids.join(" -> ") : "なし"} />
      <DetailItem label="policy" value={leg?.matched_policy_ids.length ? leg.matched_policy_ids.join(" -> ") : "なし"} />
      <DetailItem label="NAT" value={leg?.matched_nat_rule_ids.length ? leg.matched_nat_rule_ids.join(" -> ") : "なし"} />
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
      <span className="font-semibold text-zinc-700">{label}</span>
      <span className="min-w-0 break-words font-mono text-zinc-600">{value}</span>
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
