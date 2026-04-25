import { ChangeEvent, useState } from "react";
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
import { actualReachabilityLabel, designIssueTone, diagnoseTrafficTest, endpointNameForIp, evaluationTone, factLabel, factTone, shortInterfaceLabel, trafficTestTitle } from "../diagnosis";
import type {
  GraphModel,
  InterfaceModel,
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
import { Badge, EmptyMessage, Field, SearchableEndpointSelect, buttonClass, cn, inputClass } from "./common";

export function TrafficIntentEditor({
  protocol,
  port,
  expectedReachable,
  reachabilityScope,
  onProtocolChange,
  onPortChange,
  onExpectedReachableChange,
  onReachabilityScopeChange,
}: {
  protocol: TrafficProtocol;
  port: number;
  expectedReachable: boolean;
  reachabilityScope: ReachabilityScope;
  onProtocolChange: (protocol: TrafficProtocol) => void;
  onPortChange: (port: number) => void;
  onExpectedReachableChange: (reachable: boolean) => void;
  onReachabilityScopeChange: (scope: ReachabilityScope) => void;
}) {
  return (
    <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-zinc-500">通信要件</h3>
        <span className="text-[11px] text-zinc-500">E2E到達性</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_88px_1fr_1fr]">
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
      </div>
    </div>
  );
}

export function SelectedLinkPanel({
  graph,
  link,
  onToggle,
  onUpdateLink,
  onDelete,
}: {
  graph: GraphModel;
  link: LinkModel | undefined;
  onToggle: (linkId: string) => void;
  onUpdateLink: (linkId: string, patch: Partial<LinkModel>) => void;
  onDelete: (linkId: string) => void;
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
      <div className="flex justify-end">
        <button className={buttonClass("danger")} type="button" onClick={() => onDelete(link.id)}>
          リンクを削除
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
          onChange={(event) => onUpdateLink(link.id, { cost: Math.max(1, Number(event.target.value) || 1) })}
        />
      </Field>
      <Field label="VLAN">
        <input
          className={inputClass}
          min="1"
          max="4094"
          type="number"
          value={link.vlan_id ?? ""}
          onChange={(event) => onUpdateLink(link.id, { vlan_id: optionalNumber(event.target.value) })}
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
  onDeleteNode,
  onAddInterface,
  onToggleInterface,
  onDeleteInterface,
  onUpdateNode,
  onUpdateInterface,
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
  onDeleteNode: (nodeId: string) => void;
  onAddInterface: (nodeId: string) => void;
  onToggleInterface: (interfaceId: string) => void;
  onDeleteInterface: (interfaceId: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<NodeModel>) => void;
  onUpdateInterface: (interfaceId: string, patch: Partial<InterfaceModel>) => void;
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
          <div className="flex flex-wrap gap-2">
            <button
              className={buttonClass(nodeDown ? "success" : "danger")}
              type="button"
              onClick={() => onToggleNode(node.id)}
            >
              {nodeDown ? "ノードを復旧" : "ノードを停止"}
            </button>
            <button className={buttonClass("danger")} type="button" onClick={() => onDeleteNode(node.id)}>
              ノードを削除
            </button>
          </div>
        </div>
        <div className="grid gap-1 text-sm text-zinc-600">
          <div>インターフェース: {interfaces.length}</div>
          <div>接続リンク: {connectedLinks.length}</div>
          <div className="grid gap-2 pt-2 sm:grid-cols-2">
            <Field label="default VRF">
              <input
                className={inputClass}
                value={node.default_vrf_id ?? ""}
                onChange={(event) => onUpdateNode(node.id, { default_vrf_id: event.target.value || undefined })}
              />
            </Field>
            <Field label="default VLAN">
              <input
                className={inputClass}
                min="1"
                max="4094"
                type="number"
                value={node.default_vlan_id ?? ""}
                onChange={(event) => onUpdateNode(node.id, { default_vlan_id: optionalNumber(event.target.value) })}
              />
            </Field>
          </div>
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
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-950">インターフェース</h3>
            <p className="mt-1 text-xs text-zinc-500">
              {typeof capabilities.maxInterfaces === "number"
                ? `最大 ${capabilities.maxInterfaces} ポートまで追加できます。`
                : "必要に応じてポートを追加できます。"}
            </p>
          </div>
          <button
            className={buttonClass("secondary")}
            disabled={typeof capabilities.maxInterfaces === "number" && interfaces.length >= capabilities.maxInterfaces}
            type="button"
            onClick={() => onAddInterface(node.id)}
          >
            インターフェース追加
          </button>
        </div>
        {interfaces.map((interfaceItem) => {
          const interfaceDown = nodeDown || downInterfaceIds.has(interfaceItem.id);
          const canDeleteInterface =
            interfaces.length > 1 || !connectedLinks.some(
              (link) => link.from_interface === interfaceItem.id || link.to_interface === interfaceItem.id
            );
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
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="IP address">
                  <input
                    className={inputClass}
                    placeholder="192.0.2.1/24"
                    value={interfaceItem.ip_address ?? ""}
                    onChange={(event) => onUpdateInterface(interfaceItem.id, { ip_address: event.target.value || undefined })}
                  />
                </Field>
                <Field label="VRF">
                  <input
                    className={inputClass}
                    value={interfaceItem.vrf_id ?? ""}
                    onChange={(event) => onUpdateInterface(interfaceItem.id, { vrf_id: event.target.value || undefined })}
                  />
                </Field>
                <Field label="VLAN">
                  <input
                    className={inputClass}
                    min="1"
                    max="4094"
                    type="number"
                    value={interfaceItem.vlan_id ?? ""}
                    onChange={(event) => onUpdateInterface(interfaceItem.id, { vlan_id: optionalNumber(event.target.value) })}
                  />
                </Field>
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
                <button
                  className={buttonClass("danger")}
                  disabled={!canDeleteInterface}
                  type="button"
                  onClick={() => onDeleteInterface(interfaceItem.id)}
                >
                  インターフェース削除
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
  onDeleteNode,
  onUpdateNodeDeviceType,
  onUpdateNodeGroup,
  selectedLinkId,
  onSelectLink,
  onUpdateLink,
  onDeleteLink,
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
  onDeleteNode: (nodeId: string) => void;
  onUpdateNodeDeviceType: (nodeId: string, deviceType: NodeDeviceType) => void;
  onUpdateNodeGroup: (nodeId: string, groupId: string) => void;
  selectedLinkId: string;
  onSelectLink: (linkId: string) => void;
  onUpdateLink: (linkId: string, patch: Partial<LinkModel>) => void;
  onDeleteLink: (linkId: string) => void;
}) {
  const groups = graphGroups(graph);
  return (
    <div className="grid gap-4 p-4">
      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
        構成編集ではノードとリンクの追加・削除・設定変更を行います。配置変更やドラッグ接続はキャンバス編集で扱います。
      </div>
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
          <div className="grid grid-cols-[1fr_160px_130px_auto] items-center gap-2" key={node.id}>
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
            <button className={cn(buttonClass("danger"), "whitespace-nowrap")} type="button" onClick={() => onDeleteNode(node.id)}>
              削除
            </button>
          </div>
        ))}
      </div>

      <LinksPanel
        graph={graph}
        selectedLinkId={selectedLinkId}
        onSelectLink={onSelectLink}
        onUpdateLink={onUpdateLink}
        onDeleteLink={onDeleteLink}
      />

    </div>
  );
}

export function LinksPanel({
  graph,
  selectedLinkId,
  onSelectLink,
  onUpdateLink,
  onDeleteLink,
}: {
  graph: GraphModel;
  selectedLinkId: string;
  onSelectLink: (linkId: string) => void;
  onUpdateLink: (linkId: string, patch: Partial<LinkModel>) => void;
  onDeleteLink: (linkId: string) => void;
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
              <th className="px-3 py-2 font-semibold">VLAN</th>
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
                    max="4094"
                    type="number"
                    value={link.vlan_id ?? ""}
                    onChange={(event) => onUpdateLink(link.id, { vlan_id: optionalNumber(event.target.value) })}
                  />
                </td>
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
                  <div className="flex flex-wrap gap-2">
                    <button className={cn(buttonClass("secondary"), "whitespace-nowrap")} type="button" onClick={() => onSelectLink(link.id)}>
                      詳細
                    </button>
                    <button className={cn(buttonClass("danger"), "whitespace-nowrap")} type="button" onClick={() => onDeleteLink(link.id)}>
                      削除
                    </button>
                  </div>
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
  const visibleNodes = graph.nodes.filter((node) => nodeFilter ? node.id === nodeFilter : filteredRoutes.some((route) => route.node_id === node.id));
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
        <div className="grid gap-3">
          {visibleNodes.map((node) => {
            const nodeRoutes = filteredRoutes.filter((route) => route.node_id === node.id);
            if (!nodeRoutes.length) {
              return null;
            }
            return (
              <div className="rounded-lg border border-zinc-200 bg-white p-3" key={node.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-950">{node.id}</h4>
                    <p className="mt-1 text-xs text-zinc-500">{nodeRoutes.filter((route) => route.active).length} active / {nodeRoutes.length} routes</p>
                  </div>
                  <button className={buttonClass("secondary")} type="button" onClick={() => onAddRoute(node.id)}>追加</button>
                </div>
                <div className="mt-3 grid gap-2">
                  {nodeRoutes.map((route) => (
                    <div className={cn("grid gap-3 rounded-md border p-3", route.active ? "border-zinc-200 bg-zinc-50" : "border-zinc-200 bg-zinc-100 opacity-70")} key={route.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="break-words font-mono text-sm font-semibold text-zinc-900">
                            {route.node_id} {"->"} {route.destination} via {route.next_hop || "direct"}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            out {shortInterfaceLabel(route.egress_interface)} / metric {route.metric}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={route.active ? "success" : "muted"}>{route.active ? "active" : "inactive"}</Badge>
                          <button className={cn(buttonClass("danger"), "whitespace-nowrap")} type="button" onClick={() => onDeleteRoute(route.id)}>削除</button>
                        </div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-4">
                        <Field label="destination"><input className={inputClass} value={route.destination} onChange={(event) => onUpdateRoute(route.id, { destination: event.target.value })} /></Field>
                        <Field label="next-hop"><input className={inputClass} value={route.next_hop ?? ""} onChange={(event) => onUpdateRoute(route.id, { next_hop: event.target.value })} /></Field>
                        <Field label="out">
                          <select className={inputClass} value={route.egress_interface ?? ""} onChange={(event) => onUpdateRoute(route.id, { egress_interface: event.target.value })}>
                            <option value="">未指定</option>
                            {graph.interfaces
                              .filter((interfaceItem) => interfaceItem.node_id === route.node_id)
                              .map((interfaceItem) => (
                                <option key={interfaceItem.id} value={interfaceItem.id}>{shortInterfaceLabel(interfaceItem.id)}</option>
                              ))}
                          </select>
                        </Field>
                        <Field label="active">
                          <select className={inputClass} value={route.active ? "active" : "inactive"} onChange={(event) => onUpdateRoute(route.id, { active: event.target.value === "active" })}>
                            <option value="active">active</option>
                            <option value="inactive">inactive</option>
                          </select>
                        </Field>
                      </div>
                      <details className="rounded-md border border-zinc-200 bg-white p-2">
                        <summary className="cursor-pointer text-xs font-semibold text-zinc-600">詳細</summary>
                        <div className="mt-2 grid gap-2 md:grid-cols-5">
                          <Field label="id"><input className={inputClass} value={route.id} readOnly /></Field>
                          <Field label="metric"><input className={inputClass} min="0" type="number" value={route.metric} onChange={(event) => onUpdateRoute(route.id, { metric: Math.max(0, Number(event.target.value) || 0) })} /></Field>
                          <Field label="AD"><input className={inputClass} min="0" type="number" value={route.administrative_distance ?? ""} onChange={(event) => onUpdateRoute(route.id, { administrative_distance: optionalNumber(event.target.value) })} /></Field>
                          <Field label="VRF"><input className={inputClass} value={route.vrf_id ?? ""} onChange={(event) => onUpdateRoute(route.id, { vrf_id: event.target.value })} /></Field>
                          <Field label="VLAN"><input className={inputClass} min="1" max="4094" type="number" value={route.vlan_id ?? ""} onChange={(event) => onUpdateRoute(route.id, { vlan_id: optionalNumber(event.target.value) })} /></Field>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
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
  const visibleNodes = networkDevices.filter((node) => nodeFilter ? node.id === nodeFilter : filteredPolicies.some((policy) => policy.node_id === node.id));
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
        <div className="grid gap-3">
          {visibleNodes.map((node) => {
            const nodePolicies = filteredPolicies.filter((policy) => policy.node_id === node.id);
            if (!nodePolicies.length) {
              return null;
            }
            return (
              <div className="rounded-lg border border-zinc-200 bg-white p-3" key={node.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-950">{node.id}</h4>
                    <p className="mt-1 text-xs text-zinc-500">{nodePolicies.filter((policy) => policy.active).length} active / {nodePolicies.length} rules</p>
                  </div>
                  <button className={buttonClass("secondary")} type="button" onClick={() => onAddPolicy(node.id)}>追加</button>
                </div>
                <div className="mt-3 grid gap-2">
                  {nodePolicies.map((policy) => (
                    <div className={cn("grid gap-3 rounded-md border p-3", policy.action === "deny" ? "border-red-200 bg-red-50/50" : "border-zinc-200 bg-zinc-50", !policy.active && "opacity-65")} key={policy.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="break-words font-mono text-sm font-semibold text-zinc-900">
                            {policy.source} {"->"} {policy.destination} | {policy.protocol.toUpperCase()}{policy.port ? `/${policy.port}` : ""} | {policy.action}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {policy.direction} / {shortInterfaceLabel(policy.interface_id)} / {policy.name ?? policy.ace_name}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={policy.action === "deny" ? "danger" : "success"}>{policy.action}</Badge>
                          <Badge tone={policy.active ? "success" : "muted"}>{policy.active ? "active" : "inactive"}</Badge>
                          <button className={cn(buttonClass("danger"), "whitespace-nowrap")} type="button" onClick={() => onDeletePolicy(policy.id)}>削除</button>
                        </div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-5">
                        <Field label="source"><input className={inputClass} value={policy.source} onChange={(event) => onUpdatePolicy(policy.id, { source: event.target.value })} /></Field>
                        <Field label="destination"><input className={inputClass} value={policy.destination} onChange={(event) => onUpdatePolicy(policy.id, { destination: event.target.value })} /></Field>
                        <Field label="protocol">
                          <select className={inputClass} value={policy.protocol} onChange={(event) => onUpdatePolicy(policy.id, { protocol: event.target.value as PolicyProtocol, port: event.target.value === "tcp" || event.target.value === "udp" ? policy.port : undefined })}>
                            <option value="any">any</option>
                            <option value="icmp">ICMP</option>
                            <option value="tcp">TCP</option>
                            <option value="udp">UDP</option>
                          </select>
                        </Field>
                        <Field label="port"><input className={inputClass} disabled={policy.protocol === "any" || policy.protocol === "icmp"} min="1" max="65535" type="number" value={policy.protocol === "any" || policy.protocol === "icmp" ? "" : policy.port ?? ""} onChange={(event) => onUpdatePolicy(policy.id, { port: optionalNumber(event.target.value) })} /></Field>
                        <Field label="action">
                          <select className={inputClass} value={policy.action} onChange={(event) => onUpdatePolicy(policy.id, { action: event.target.value as PolicyRuleModel["action"] })}>
                            <option value="permit">permit</option>
                            <option value="deny">deny</option>
                          </select>
                        </Field>
                      </div>
                      <details className="rounded-md border border-zinc-200 bg-white p-2">
                        <summary className="cursor-pointer text-xs font-semibold text-zinc-600">詳細</summary>
                        <div className="mt-2 grid gap-2 md:grid-cols-5">
                          <Field label="name"><input className={inputClass} value={policy.name ?? ""} onChange={(event) => onUpdatePolicy(policy.id, { name: event.target.value })} /></Field>
                          <Field label="direction">
                            <select className={inputClass} value={policy.direction} onChange={(event) => onUpdatePolicy(policy.id, { direction: event.target.value as PolicyRuleModel["direction"] })}>
                              <option value="ingress">ingress</option>
                              <option value="egress">egress</option>
                            </select>
                          </Field>
                          <Field label="interface">
                            <select className={inputClass} value={policy.interface_id ?? ""} onChange={(event) => onUpdatePolicy(policy.id, { interface_id: event.target.value || undefined })}>
                              <option value="">node-wide</option>
                              {graph.interfaces
                                .filter((interfaceItem) => interfaceItem.node_id === policy.node_id)
                                .map((interfaceItem) => (
                                  <option key={interfaceItem.id} value={interfaceItem.id}>{shortInterfaceLabel(interfaceItem.id)}</option>
                                ))}
                            </select>
                          </Field>
                          <Field label="active">
                            <select className={inputClass} value={policy.active ? "active" : "inactive"} onChange={(event) => onUpdatePolicy(policy.id, { active: event.target.value === "active" })}>
                              <option value="active">active</option>
                              <option value="inactive">inactive</option>
                            </select>
                          </Field>
                          <Field label="id"><input className={inputClass} value={policy.id} readOnly /></Field>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
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
  const visibleNodes = networkDevices.filter((node) => nodeFilter ? node.id === nodeFilter : filteredRules.some((rule) => rule.node_id === node.id));

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
        <div className="grid gap-3">
          {visibleNodes.map((node) => {
            const nodeRules = filteredRules.filter((rule) => rule.node_id === node.id);
            if (!nodeRules.length) {
              return null;
            }
            return (
              <div className="rounded-lg border border-zinc-200 bg-white p-3" key={node.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-950">{node.id}</h4>
                    <p className="mt-1 text-xs text-zinc-500">{nodeRules.filter((rule) => rule.active).length} active / {nodeRules.length} rules</p>
                  </div>
                  <button className={buttonClass("secondary")} type="button" onClick={() => onAddNatRule(node.id)}>追加</button>
                </div>
                <div className="mt-3 grid gap-2">
                  {nodeRules.map((rule) => (
                    <div className={cn("grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3", !rule.active && "opacity-65")} key={rule.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="break-words font-mono text-sm font-semibold text-zinc-900">
                            {rule.original} {"->"} {rule.translated} | {rule.nat_type} NAT
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {rule.direction} / {shortInterfaceLabel(rule.interface_id)} / {(rule.protocol ?? "any").toUpperCase()}{rule.port ? `/${rule.port}` : ""}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{rule.nat_type}</Badge>
                          <Badge tone={rule.active ? "success" : "muted"}>{rule.active ? "active" : "inactive"}</Badge>
                          <button className={cn(buttonClass("danger"), "whitespace-nowrap")} type="button" onClick={() => onDeleteNatRule(rule.id)}>削除</button>
                        </div>
                      </div>
                      <div className="grid gap-2 md:grid-cols-4">
                        <Field label="original"><input className={inputClass} value={rule.original} onChange={(event) => onUpdateNatRule(rule.id, { original: event.target.value })} /></Field>
                        <Field label="translated"><input className={inputClass} value={rule.translated} onChange={(event) => onUpdateNatRule(rule.id, { translated: event.target.value })} /></Field>
                        <Field label="type">
                          <select className={inputClass} value={rule.nat_type} onChange={(event) => onUpdateNatRule(rule.id, { nat_type: event.target.value as NatRuleModel["nat_type"] })}>
                            <option value="source">source</option>
                            <option value="destination">destination</option>
                          </select>
                        </Field>
                        <Field label="protocol">
                          <select className={inputClass} value={rule.protocol ?? "any"} onChange={(event) => onUpdateNatRule(rule.id, { protocol: event.target.value as PolicyProtocol, port: event.target.value === "tcp" || event.target.value === "udp" ? rule.port : undefined })}>
                            <option value="any">any</option>
                            <option value="icmp">ICMP</option>
                            <option value="tcp">TCP</option>
                            <option value="udp">UDP</option>
                          </select>
                        </Field>
                      </div>
                      <details className="rounded-md border border-zinc-200 bg-white p-2">
                        <summary className="cursor-pointer text-xs font-semibold text-zinc-600">詳細</summary>
                        <div className="mt-2 grid gap-2 md:grid-cols-5">
                          <Field label="direction">
                            <select className={inputClass} value={rule.direction} onChange={(event) => onUpdateNatRule(rule.id, { direction: event.target.value as NatRuleModel["direction"] })}>
                              <option value="ingress">ingress</option>
                              <option value="egress">egress</option>
                            </select>
                          </Field>
                          <Field label="interface">
                            <select className={inputClass} value={rule.interface_id ?? ""} onChange={(event) => onUpdateNatRule(rule.id, { interface_id: event.target.value || undefined })}>
                              <option value="">node-wide</option>
                              {graph.interfaces
                                .filter((interfaceItem) => interfaceItem.node_id === rule.node_id)
                                .map((interfaceItem) => (
                                  <option key={interfaceItem.id} value={interfaceItem.id}>{shortInterfaceLabel(interfaceItem.id)}</option>
                                ))}
                            </select>
                          </Field>
                          <Field label="port"><input className={inputClass} disabled={rule.protocol === "any" || rule.protocol === "icmp" || !rule.protocol} min="1" max="65535" type="number" value={rule.protocol === "tcp" || rule.protocol === "udp" ? rule.port ?? "" : ""} onChange={(event) => onUpdateNatRule(rule.id, { port: optionalNumber(event.target.value) })} /></Field>
                          <Field label="active">
                            <select className={inputClass} value={rule.active ? "active" : "inactive"} onChange={(event) => onUpdateNatRule(rule.id, { active: event.target.value === "active" })}>
                              <option value="active">active</option>
                              <option value="inactive">inactive</option>
                            </select>
                          </Field>
                          <Field label="id"><input className={inputClass} value={rule.id} readOnly /></Field>
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
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
  selectedTestId,
  onImport,
  onExport,
  onExportReport,
  onAdd,
  onSelect,
  onRun,
  onRunAll,
  onOpenDetails,
}: {
  graph: GraphModel;
  tests: TrafficTestRecordModel[];
  results: Record<string, TrafficTestResultModel>;
  selectedTestId: string | null;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onExportReport: () => void;
  onAdd: () => void;
  onSelect: (testId: string) => void;
  onRun: (testId: string) => void;
  onRunAll: () => void;
  onOpenDetails: (testId: string) => void;
}) {
  const enabledCount = tests.filter((test) => test.enabled).length;
  const executedCount = tests.filter((test) => results[test.id]).length;
  const passCount = tests.filter((test) => results[test.id]?.status === "pass").length;
  const failCount = tests.filter((test) => results[test.id]?.status === "fail").length;
  const errorCount = tests.filter((test) => results[test.id]?.status === "error").length;
  const pendingCount = tests.length - executedCount;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "pass" | "fail" | "error">("all");
  const selectedTest = tests.find((test) => test.id === selectedTestId) ?? tests[0];
  const endpointIpSet = new Set(interfaceEndpointOptions(graph).map((endpoint) => endpoint.ip));
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTests = tests.filter((test) => {
    const result = results[test.id];
    const status = result?.status ?? "pending";
    const diagnosis = diagnoseTrafficTest(graph, result, test);
    const title = trafficTestTitle(graph, test);
    const matchesStatus = statusFilter === "all" || status === statusFilter;
    const matchesQuery = !normalizedQuery || [
      test.id,
      test.name ?? "",
      test.source,
      test.destination,
      test.protocol,
      title,
      diagnosis.cause.code,
      diagnosis.designIssue.headline,
      diagnosis.designIssue.summary,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
    return matchesStatus && matchesQuery;
  });

  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">試験</h3>
          <p className="mt-1 text-xs text-zinc-500">
            {enabledCount} / {tests.length} 件を実行対象にします
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
        <div className="grid gap-3">
          <div className="grid gap-2 rounded-md border border-zinc-200 bg-white p-3 md:grid-cols-[minmax(0,1fr)_180px]">
            <Field label="検索">
              <input
                className={inputClass}
                placeholder="id / name / IP / design issue"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>
            <Field label="状態">
              <select className={inputClass} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="all">すべて</option>
                <option value="pending">未実行</option>
                <option value="pass">PASS</option>
                <option value="fail">FAIL</option>
                <option value="error">ERROR</option>
              </select>
            </Field>
          </div>
          <div className="max-h-[620px] overflow-auto rounded-lg border border-zinc-200 bg-white">
            {visibleTests.length ? (
              <div className="min-w-[840px] divide-y divide-zinc-100">
                {visibleTests.map((test) => {
                  const result = results[test.id];
                  const diagnosis = diagnoseTrafficTest(graph, result, test);
                  const protocol = test.port ? `${test.protocol.toUpperCase()}/${test.port}` : test.protocol.toUpperCase();
                  const selected = selectedTest?.id === test.id;
                  const endpointsExist = endpointIpSet.has(test.source) && endpointIpSet.has(test.destination);
                  return (
                    <div
                      className={cn(
                        "grid w-full grid-cols-[92px_minmax(220px,1fr)_96px_132px_132px] items-center gap-3 px-3 py-2 text-left transition hover:bg-zinc-50",
                        selected && "bg-teal-50",
                        result?.status === "fail" && "bg-red-50/50",
                        result?.status === "error" && "bg-red-50/50"
                      )}
                      key={test.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        onSelect(test.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(test.id);
                        }
                      }}
                    >
                      <div><Badge tone={resultTone(result)}>{result ? testResultLabel(result.status) : "未実行"}</Badge></div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-950">{test.name || test.id}</div>
                        <div className="truncate font-mono text-xs text-zinc-500">{test.source} {"->"} {test.destination}</div>
                        {!endpointsExist ? (
                          <div className="truncate text-xs font-semibold text-red-700">endpoint を解決できません</div>
                        ) : null}
                      </div>
                      <div className="text-xs font-semibold text-zinc-700">{protocol}</div>
                      <div><Badge tone={factTone(diagnosis.facts.e2e)}>{actualReachabilityLabel(diagnosis)}</Badge></div>
                      <div className="flex justify-end gap-2">
                        <button
                          className={buttonClass("success")}
                          disabled={!endpointsExist}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(test.id);
                            onRun(test.id);
                          }}
                        >
                          実行
                        </button>
                        <button
                          className={buttonClass("secondary")}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(test.id);
                            onOpenDetails(test.id);
                          }}
                        >
                          詳細
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyMessage>条件に一致する試験はありません。</EmptyMessage>
            )}
          </div>
        </div>
      ) : (
        <EmptyMessage>試験はありません。試験を追加するか、試験JSON/YAMLを読み込んでください。</EmptyMessage>
      )}
    </div>
  );
}

export function TrafficTestDetailPanel({
  graph,
  test,
  result,
  onUpdate,
  onDelete,
  onRun,
}: {
  graph: GraphModel;
  test: TrafficTestRecordModel | undefined;
  result: TrafficTestResultModel | undefined;
  onUpdate: (testId: string, patch: Partial<TrafficTestRecordModel>) => void;
  onDelete: (testId: string) => void;
  onRun: (testId: string) => void;
}) {
  if (!test) {
    return <EmptyMessage>試験を選択してください。</EmptyMessage>;
  }

  const diagnosis = diagnoseTrafficTest(graph, result, test);

  return (
    <div className="grid gap-3 p-4">
      <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={evaluationTone(diagnosis.evaluation.result)}>{diagnosis.evaluation.result}</Badge>
              <Badge tone={designIssueTone(diagnosis.designIssue.severity)}>{diagnosis.designIssue.headline}</Badge>
            </div>
            <div className="mt-2 break-words text-base font-semibold text-zinc-950">{trafficTestTitle(graph, test)}</div>
            <div className="mt-1 text-sm text-zinc-600">{diagnosis.designIssue.summary}</div>
          </div>
          <label className="inline-flex min-h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700">
            <input checked={test.enabled} type="checkbox" onChange={(event) => onUpdate(test.id, { enabled: event.target.checked })} />
            enabled
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass("secondary")} type="button" onClick={() => onRun(test.id)}>実行</button>
          <button className={buttonClass("danger")} type="button" onClick={() => onDelete(test.id)}>削除</button>
        </div>
        <TrafficTestEditor graph={graph} test={test} onUpdate={onUpdate} />
        <TrafficTestDetails test={test} result={result} />
      </div>
    </div>
  );
}

function TrafficTestEditor({
  graph,
  test,
  onUpdate,
}: {
  graph: GraphModel;
  test: TrafficTestRecordModel;
  onUpdate: (testId: string, patch: Partial<TrafficTestRecordModel>) => void;
}) {
  const endpointOptions = interfaceEndpointOptions(graph);
  const sourceExists = endpointOptions.some((endpoint) => endpoint.ip === test.source);
  const destinationExists = endpointOptions.some((endpoint) => endpoint.ip === test.destination);

  return (
    <div className="grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-zinc-950">試験条件</h4>
          <p className="mt-1 text-xs text-zinc-500">{endpointNameForIp(graph, test.source)} から {endpointNameForIp(graph, test.destination)} への通信</p>
        </div>
        <Badge>{test.id}</Badge>
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <Field label="id"><input className={inputClass} value={test.id} readOnly /></Field>
        <Field label="name"><input className={inputClass} placeholder={test.id} value={test.name ?? ""} onChange={(event) => onUpdate(test.id, { name: event.target.value })} /></Field>
        <Field label="source IP">
          <SearchableEndpointSelect
            options={endpointOptions}
            value={test.source}
            onChange={(source) => onUpdate(test.id, { source })}
          />
        </Field>
        <Field label="destination IP">
          <SearchableEndpointSelect
            options={endpointOptions}
            value={test.destination}
            onChange={(destination) => onUpdate(test.id, { destination })}
          />
        </Field>
      </div>
      {!sourceExists || !destinationExists ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          この試験には現在のトポロジに存在しないIPが含まれています。送信元/宛先を選び直してください。
        </div>
      ) : null}
      <div className="grid gap-2 md:grid-cols-4">
        <Field label="protocol">
          <select className={inputClass} value={test.protocol} onChange={(event) => onUpdate(test.id, { protocol: event.target.value as TrafficProtocol, port: event.target.value === "icmp" ? undefined : test.port })}>
            <option value="icmp">ICMP</option>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
        </Field>
        <Field label="port"><input className={inputClass} disabled={test.protocol === "icmp"} min="1" max="65535" type="number" value={test.protocol === "icmp" ? "" : test.port ?? ""} onChange={(event) => onUpdate(test.id, { port: optionalNumber(event.target.value) })} /></Field>
        <Field label="判定範囲">
          <select className={inputClass} value={test.expectations.scope ?? "round_trip"} onChange={(event) => onUpdate(test.id, { expectations: { ...test.expectations, scope: event.target.value as ReachabilityScope } })}>
            <option value="round_trip">往復</option>
            <option value="forward_only">片道</option>
          </select>
        </Field>
        <Field label="期待">
          <select className={inputClass} value={test.expectations.reachable ? "reachable" : "unreachable"} onChange={(event) => onUpdate(test.id, { expectations: { ...test.expectations, reachable: event.target.value === "reachable" } })}>
            <option value="reachable">到達可能</option>
            <option value="unreachable">到達不可</option>
          </select>
        </Field>
      </div>
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
