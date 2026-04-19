export type NodeModel = {
  id: string;
  device_type?: NodeDeviceType;
  group_id?: string;
  layer?: NetworkLayer;
  x?: number;
  y?: number;
};

export type NodeDeviceType = "network_device" | "client";
export type NetworkLayer = "access" | "edge" | "core" | "service";

export type NodeGroupModel = {
  id: string;
  label: string;
};

export type InterfaceModel = {
  id: string;
  node_id: string;
  ip_address?: string;
};

export type YangInterfaceNodeModel = {
  node_id: string;
  interfaces: {
    interface: YangInterfaceModel[];
  };
};

export type YangInterfaceModel = {
  name: string;
  type?: string;
  enabled?: boolean;
  ipv4?: {
    address?: Array<{
      ip: string;
      prefix_length?: number;
    }>;
  };
};

export type LinkModel = {
  id: string;
  from_interface: string;
  to_interface: string;
  bandwidth_mbps?: number;
  cost: number;
  active: boolean;
};

export type VirtualIpModel = {
  id: string;
  protocol: string;
  address: string;
  active_node_id: string;
  standby_node_ids: string[];
  service_node_id: string;
};

export type RouteEntryModel = {
  id: string;
  node_id: string;
  destination: string;
  next_hop?: string;
  egress_interface?: string;
  metric: number;
  administrative_distance?: number;
  vrf_id?: string;
  vlan_id?: number;
  active: boolean;
};

export type YangStaticRouteModel = {
  name: string;
  destination_prefix: string;
  next_hop?: {
    next_hop_address?: string;
    next_hop_node?: string;
    outgoing_interface?: string;
  };
  metric: number;
  administrative_distance?: number;
  vrf_id?: string;
  vlan_id?: number;
  active: boolean;
};

export type YangRoutingModel = {
  node_id: string;
  routing: {
    control_plane_protocols: Array<{
      type: "static";
      name: string;
      static_routes: {
        ipv4: YangStaticRouteModel[];
      };
    }>;
  };
};

export type PolicyProtocol = TrafficProtocol | "any";

export type PolicyRuleModel = {
  id: string;
  node_id: string;
  interface_id?: string;
  acl_name: string;
  ace_name: string;
  name?: string;
  direction: "ingress" | "egress";
  action: "permit" | "deny";
  protocol: PolicyProtocol;
  source: string;
  destination: string;
  port?: number;
  active: boolean;
};

export type YangAclModel = {
  name: string;
  type: "ipv4-acl";
  aces: Array<{
    name: string;
    active?: boolean;
    matches: {
      ipv4?: {
        source_ipv4_network?: string;
        destination_ipv4_network?: string;
      };
      tcp?: {
        destination_port?: {
          operator: "eq";
          port: number;
        };
      };
      udp?: {
        destination_port?: {
          operator: "eq";
          port: number;
        };
      };
      icmp?: Record<string, never>;
    };
    actions: {
      forwarding: "accept" | "drop";
    };
  }>;
};

export type YangAclAttachmentModel = {
  node_id: string;
  interface_id?: string;
  ingress?: string[];
  egress?: string[];
};

export type NatRuleModel = {
  id: string;
  node_id: string;
  interface_id?: string;
  direction: "ingress" | "egress";
  nat_type: "source" | "destination";
  original: string;
  translated: string;
  protocol?: PolicyProtocol;
  port?: number;
  active: boolean;
};

export type GraphModel = {
  nodes: NodeModel[];
  interfaces: InterfaceModel[];
  links: LinkModel[];
  groups?: NodeGroupModel[];
  virtual_ips?: VirtualIpModel[];
  nat_rules?: NatRuleModel[];
  routing?: YangRoutingModel[];
  acls?: YangAclModel[];
  acl_attachments?: YangAclAttachmentModel[];
  routes?: RouteEntryModel[];
  policies?: PolicyRuleModel[];
};

export type InputGraphModel = Omit<GraphModel, "interfaces"> & {
  interfaces: InterfaceModel[] | YangInterfaceNodeModel[];
};

export type InputRouteRequest = Omit<RouteRequest, "graph"> & {
  graph: InputGraphModel;
};

export type RouteRequest = {
  graph: GraphModel;
  from_interface: string;
  to_interface: string;
  mode: RouteMode;
  traffic?: {
    protocol: TrafficProtocol;
    port?: number;
    source?: string;
    destination?: string;
  };
};

export type RouteResponse =
  | {
      ok: true;
      path: string[];
      equal_cost_paths?: string[][];
      cost: number;
      status?: RouteStatus;
      matched_route_ids?: string[];
      matched_policy_ids?: string[];
      matched_nat_rule_ids?: string[];
      translated_source?: string;
      translated_destination?: string;
      forward?: PipelineLeg;
      return_path?: PipelineLeg;
      loop_link_ids?: string[];
    }
  | { ok: false; error: { code: string; message: string } };

export type PipelineLeg = {
  path: string[];
  status: RouteStatus;
  matched_route_ids: string[];
  matched_policy_ids: string[];
  matched_nat_rule_ids: string[];
  source_before?: string;
  destination_before?: string;
  source_after?: string;
  destination_after?: string;
};

export type TrafficProtocol = "icmp" | "tcp" | "udp";
export type LayoutDirection = "lr" | "td";
export type RouteMode = "shortest_path" | "routing_table";
export type RouteStatus = "reachable" | "unreachable" | "loop" | "no_route" | "blackhole" | "policy_denied";
export type ReachabilityScope = "round_trip" | "forward_only";
export type InterfaceDisplayMode = "compact" | "detail";
export type ActiveModal = "link" | "links" | "graph" | "node";

export type TrafficIntent = {
  source_node_id: string;
  destination_node_id: string;
  protocol: TrafficProtocol;
  port?: number;
  expectations: {
    reachable: boolean;
    scope?: ReachabilityScope;
    via_node_id?: string;
    strict_path?: boolean;
    policy?: "permit" | "deny";
  };
};

export type RouteEdgeDirection = {
  from_interface: string;
  to_interface: string;
};

export type TrafficTestSuiteModel = {
  version: 1;
  tests: TrafficTestRecordModel[];
};

export type TrafficTestRecordModel = {
  id: string;
  name?: string;
  enabled: boolean;
  source: string;
  destination: string;
  protocol: TrafficProtocol;
  port?: number;
  expectations: {
    reachable: boolean;
    scope?: ReachabilityScope;
  };
};

export type TrafficTestResultModel = {
  test_id: string;
  status: "pass" | "fail" | "error";
  message: string;
  response?: RouteResponse;
};

export type WasmModule = {
  shortest_path: (json: string) => string;
};
