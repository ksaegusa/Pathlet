import {
  linkCostFromBandwidth,
  linkEndpointInterfaceId,
  policiesToYangAclAttachments,
  policiesToYangAcls,
  routesToYangRouting,
} from "./graphModel";
import type {
  GraphModel,
  LinkModel,
  NatRuleModel,
  NodeModel,
  PolicyRuleModel,
  RouteEntryModel,
} from "./types";

const exampleNodes: NodeModel[] = [
  { id: "osaka-office", device_type: "client", layer: "access" },
  { id: "tokyo-office", device_type: "client", layer: "access" },
  { id: "osaka-wan", device_type: "network_device", layer: "edge" },
  { id: "tokyo-wan", device_type: "network_device", layer: "edge" },
  { id: "primary-center", device_type: "network_device", layer: "core" },
  { id: "dr-center", device_type: "network_device", layer: "core" },
  { id: "internet-gw", device_type: "network_device", layer: "core" },
  { id: "auth", device_type: "client", layer: "service" },
];

type ExampleLinkSpec = {
  id: string;
  fromNode: string;
  toNode: string;
  bandwidthMbps: number;
};

type ExampleRouteSpec = {
  id: string;
  nodeId: string;
  destination: string;
  nextHop: string;
  egressLinkId: string;
  metric: number;
  administrativeDistance?: number;
  vrfId?: string;
  vlanId?: number;
};

function exampleLinkSpec(id: string, fromNode: string, toNode: string, bandwidthMbps: number): ExampleLinkSpec {
  return { id, fromNode, toNode, bandwidthMbps };
}

function exampleRouteSpec(spec: ExampleRouteSpec): RouteEntryModel {
  return {
    id: spec.id,
    node_id: spec.nodeId,
    destination: spec.destination,
    next_hop: spec.nextHop,
    egress_interface: linkEndpointInterfaceId(spec.egressLinkId, spec.nodeId),
    metric: spec.metric,
    administrative_distance: spec.administrativeDistance ?? 1,
    vrf_id: spec.vrfId ?? "default",
    vlan_id: spec.vlanId,
    active: true,
  };
}

function exampleLink({ id, fromNode, toNode, bandwidthMbps }: ExampleLinkSpec): LinkModel {
  return {
    id,
    from_interface: linkEndpointInterfaceId(id, fromNode),
    to_interface: linkEndpointInterfaceId(id, toNode),
    bandwidth_mbps: bandwidthMbps,
    cost: linkCostFromBandwidth(bandwidthMbps),
    active: true,
  };
}

const exampleLinkSpecs = [
  exampleLinkSpec("osaka-office-wan", "osaka-office", "osaka-wan", 1000),
  exampleLinkSpec("tokyo-office-wan", "tokyo-office", "tokyo-wan", 1000),
  exampleLinkSpec("osaka-primary", "osaka-wan", "primary-center", 40000),
  exampleLinkSpec("osaka-dr", "osaka-wan", "dr-center", 10000),
  exampleLinkSpec("tokyo-primary", "tokyo-wan", "primary-center", 40000),
  exampleLinkSpec("primary-dr", "primary-center", "dr-center", 100000),
  exampleLinkSpec("primary-internet", "primary-center", "internet-gw", 1000),
  exampleLinkSpec("dr-internet", "dr-center", "internet-gw", 1000),
  exampleLinkSpec("primary-auth", "primary-center", "auth", 10000),
  exampleLinkSpec("dr-auth", "dr-center", "auth", 1000),
];

const exampleInterfaces = [
  ...exampleLinkSpecs.flatMap((link, index) => [
    {
      id: linkEndpointInterfaceId(link.id, link.fromNode),
      node_id: link.fromNode,
      ip_address: `10.0.${index}.1/30`,
    },
    {
      id: linkEndpointInterfaceId(link.id, link.toNode),
      node_id: link.toNode,
      ip_address: `10.0.${index}.2/30`,
    },
  ]),
  {
    id: "primary-center-erp-vip-if",
    node_id: "primary-center",
    ip_address: "10.10.0.10/32",
  },
];

const exampleRouteSpecs = [
  exampleRouteSpec({
    id: "osaka-office-default",
    nodeId: "osaka-office",
    destination: "0.0.0.0/0",
    nextHop: "osaka-wan",
    egressLinkId: "osaka-office-wan",
    metric: 10,
  }),
  exampleRouteSpec({
    id: "osaka-wan-primary",
    nodeId: "osaka-wan",
    destination: "primary-center",
    nextHop: "primary-center",
    egressLinkId: "osaka-primary",
    metric: 20,
    vlanId: 100,
  }),
  exampleRouteSpec({
    id: "osaka-wan-dr",
    nodeId: "osaka-wan",
    destination: "primary-center",
    nextHop: "dr-center",
    egressLinkId: "osaka-dr",
    metric: 30,
    vlanId: 100,
  }),
  exampleRouteSpec({
    id: "tokyo-office-default",
    nodeId: "tokyo-office",
    destination: "0.0.0.0/0",
    nextHop: "tokyo-wan",
    egressLinkId: "tokyo-office-wan",
    metric: 10,
  }),
  exampleRouteSpec({
    id: "tokyo-wan-primary",
    nodeId: "tokyo-wan",
    destination: "primary-center",
    nextHop: "primary-center",
    egressLinkId: "tokyo-primary",
    metric: 20,
    vlanId: 100,
  }),
];

const examplePolicies: PolicyRuleModel[] = [
  {
    id: "primary-center-allow-https",
    node_id: "primary-center",
    acl_name: "primary-center-ingress",
    ace_name: "allow-https-to-erp",
    name: "allow-https-to-erp",
    direction: "ingress",
    action: "permit",
    protocol: "tcp",
    source: "osaka-office",
    destination: "10.10.0.10/32",
    port: 443,
    active: true,
  },
  {
    id: "primary-center-deny-any",
    node_id: "primary-center",
    acl_name: "primary-center-ingress",
    ace_name: "default-deny",
    name: "default-deny",
    direction: "ingress",
    action: "deny",
    protocol: "any",
    source: "any",
    destination: "any",
    active: true,
  },
];

const exampleNatRules: NatRuleModel[] = [
  {
    id: "primary-center-snat-https",
    node_id: "primary-center",
    interface_id: linkEndpointInterfaceId("primary-internet", "primary-center"),
    direction: "egress",
    nat_type: "source",
    original: "10.0.0.0/8",
    translated: "203.0.113.10",
    protocol: "tcp",
    port: 443,
    active: true,
  },
];

export const exampleGraph: GraphModel = {
  nodes: exampleNodes,
  interfaces: exampleInterfaces,
  virtual_ips: [
    {
      id: "erp-vip",
      protocol: "VRRP",
      address: "10.10.0.10",
      active_node_id: "primary-center",
      standby_node_ids: ["dr-center"],
      service_node_id: "primary-center",
    },
  ],
  links: exampleLinkSpecs.map(exampleLink),
  nat_rules: exampleNatRules,
  routing: routesToYangRouting(exampleRouteSpecs),
  acls: policiesToYangAcls(examplePolicies),
  acl_attachments: policiesToYangAclAttachments(examplePolicies),
};
