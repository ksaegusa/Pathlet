import type { InputGraphModel, LinkModel, NodeDeviceType, NodeModel, RouteEntryModel, YangRoutingModel } from "../types";

type Rfc7951Record = Record<string, unknown>;

export function isRfc7951Graph(value: unknown): value is Rfc7951Record {
  return isRecord(value) && "ietf-interfaces:interfaces" in value && "pathlet:nodes" in value;
}

export function graphFromRfc7951(value: Rfc7951Record): InputGraphModel {
  const nodes = arrayValue(value["pathlet:nodes"]).map((node) => ({
    id: stringValue(node.id),
    device_type: nodeDeviceType(node["pathlet:device-type"]),
    default_vrf_id: optionalString(node["pathlet:default-vrf-id"]),
    default_vlan_id: optionalNumber(node["pathlet:default-vlan-id"]),
  })) satisfies NodeModel[];

  const interfacesContainer = recordValue(value["ietf-interfaces:interfaces"]);
  const interfaces = arrayValue(interfacesContainer.interface).map((interfaceItem) => {
    const ipv4 = recordValue(interfaceItem["ietf-ip:ipv4"]);
    const address = arrayValue(ipv4.address)[0];
    return {
      id: stringValue(interfaceItem.name),
      node_id: stringValue(interfaceItem["pathlet:node-id"]),
      ip_address: address
        ? `${stringValue(address.ip)}${typeof address["prefix-length"] === "number" ? `/${address["prefix-length"]}` : ""}`
        : undefined,
      vrf_id: optionalString(interfaceItem["pathlet:vrf-id"]),
      vlan_id: optionalNumber(interfaceItem["pathlet:vlan-id"]),
    };
  });

  const links = arrayValue(value["pathlet:links"]).map((link) => ({
    id: stringValue(link.id),
    from_interface: stringValue(link["pathlet:from-interface"]),
    to_interface: stringValue(link["pathlet:to-interface"]),
    vlan_id: optionalNumber(link["pathlet:vlan-id"]),
    cost: optionalNumber(link["pathlet:cost"]) ?? 1,
    active: typeof link["pathlet:active"] === "boolean" ? link["pathlet:active"] : true,
  })) satisfies LinkModel[];

  const routing = recordValue(value["ietf-routing:routing"]);
  const controlPlaneProtocols = recordValue(routing["control-plane-protocols"]);
  const routes = arrayValue(controlPlaneProtocols["control-plane-protocol"]).flatMap((protocol) =>
    arrayValue(recordValue(protocol["static-routes"]).ipv4).map((route) => ({
      id: stringValue(route.name),
      node_id: stringValue(protocol["pathlet:node-id"]),
      destination: stringValue(route["destination-prefix"]),
      next_hop: optionalString(route["pathlet:next-hop-node"]) ?? optionalString(route["next-hop-address"]),
      egress_interface: optionalString(route["outgoing-interface"]),
      metric: optionalNumber(route.metric) ?? 0,
      administrative_distance: optionalNumber(route["pathlet:administrative-distance"]),
      vrf_id: optionalString(route["pathlet:vrf-id"]),
      vlan_id: optionalNumber(route["pathlet:vlan-id"]),
      active: typeof route["pathlet:active"] === "boolean" ? route["pathlet:active"] : true,
    } satisfies RouteEntryModel))
  );

  return {
    nodes,
    interfaces,
    links,
    routing: routesToYangRouting(routes),
  };
}

function routesToYangRouting(routes: RouteEntryModel[]): YangRoutingModel[] {
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
              next_hop: route.next_hop || route.egress_interface
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

function isRecord(value: unknown): value is Rfc7951Record {
  return typeof value === "object" && value !== null;
}

function recordValue(value: unknown): Rfc7951Record {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): Rfc7951Record[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nodeDeviceType(value: unknown): NodeDeviceType | undefined {
  return value === "network_device" || value === "client" ? value : undefined;
}
