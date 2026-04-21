use serde::{Deserialize, Serialize};

use crate::{
    Graph, Interface, Link, Node, YangControlPlaneProtocol, YangRouting, YangRoutingState,
    YangStaticRoute, YangStaticRoutes,
};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonGraph {
    #[serde(rename = "pathlet:nodes")]
    pub nodes: Vec<YangJsonNode>,
    #[serde(rename = "ietf-interfaces:interfaces")]
    pub interfaces: YangJsonInterfaces,
    #[serde(rename = "pathlet:links")]
    pub links: Vec<YangJsonLink>,
    #[serde(
        default,
        rename = "ietf-routing:routing",
        skip_serializing_if = "Option::is_none"
    )]
    pub routing: Option<YangJsonRouting>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonNode {
    pub id: String,
    #[serde(
        default,
        rename = "pathlet:device-type",
        skip_serializing_if = "Option::is_none"
    )]
    pub device_type: Option<String>,
    #[serde(
        default,
        rename = "pathlet:default-vrf-id",
        skip_serializing_if = "Option::is_none"
    )]
    pub default_vrf_id: Option<String>,
    #[serde(
        default,
        rename = "pathlet:default-vlan-id",
        skip_serializing_if = "Option::is_none"
    )]
    pub default_vlan_id: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonInterfaces {
    #[serde(default, rename = "interface")]
    pub interface: Vec<YangJsonInterface>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonInterface {
    pub name: String,
    #[serde(rename = "pathlet:node-id")]
    pub node_id: String,
    #[serde(
        default,
        rename = "pathlet:vrf-id",
        skip_serializing_if = "Option::is_none"
    )]
    pub vrf_id: Option<String>,
    #[serde(
        default,
        rename = "pathlet:vlan-id",
        skip_serializing_if = "Option::is_none"
    )]
    pub vlan_id: Option<u16>,
    #[serde(
        default,
        rename = "ietf-ip:ipv4",
        skip_serializing_if = "Option::is_none"
    )]
    pub ipv4: Option<YangJsonIpv4>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonIpv4 {
    #[serde(default)]
    pub address: Vec<YangJsonAddress>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonAddress {
    pub ip: String,
    #[serde(
        default,
        rename = "prefix-length",
        skip_serializing_if = "Option::is_none"
    )]
    pub prefix_length: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonLink {
    pub id: String,
    #[serde(rename = "pathlet:from-interface")]
    pub from_interface: String,
    #[serde(rename = "pathlet:to-interface")]
    pub to_interface: String,
    #[serde(
        default,
        rename = "pathlet:vlan-id",
        skip_serializing_if = "Option::is_none"
    )]
    pub vlan_id: Option<u16>,
    #[serde(rename = "pathlet:cost")]
    pub cost: u32,
    #[serde(default = "default_true", rename = "pathlet:active")]
    pub active: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonRouting {
    #[serde(default, rename = "control-plane-protocols")]
    pub control_plane_protocols: YangJsonControlPlaneProtocols,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonControlPlaneProtocols {
    #[serde(default, rename = "control-plane-protocol")]
    pub control_plane_protocol: Vec<YangJsonControlPlaneProtocol>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonControlPlaneProtocol {
    #[serde(rename = "type")]
    pub protocol_type: String,
    pub name: String,
    #[serde(rename = "pathlet:node-id")]
    pub node_id: String,
    #[serde(default, rename = "static-routes")]
    pub static_routes: YangJsonStaticRoutes,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonStaticRoutes {
    #[serde(default, rename = "ipv4")]
    pub ipv4: Vec<YangJsonStaticRoute>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangJsonStaticRoute {
    pub name: String,
    #[serde(rename = "destination-prefix")]
    pub destination_prefix: String,
    #[serde(
        default,
        rename = "pathlet:next-hop-node",
        skip_serializing_if = "Option::is_none"
    )]
    pub next_hop_node: Option<String>,
    #[serde(
        default,
        rename = "next-hop-address",
        skip_serializing_if = "Option::is_none"
    )]
    pub next_hop_address: Option<String>,
    #[serde(
        default,
        rename = "outgoing-interface",
        skip_serializing_if = "Option::is_none"
    )]
    pub outgoing_interface: Option<String>,
    #[serde(default)]
    pub metric: u32,
    #[serde(
        default,
        rename = "pathlet:administrative-distance",
        skip_serializing_if = "Option::is_none"
    )]
    pub administrative_distance: Option<u32>,
    #[serde(
        default,
        rename = "pathlet:vrf-id",
        skip_serializing_if = "Option::is_none"
    )]
    pub vrf_id: Option<String>,
    #[serde(
        default,
        rename = "pathlet:vlan-id",
        skip_serializing_if = "Option::is_none"
    )]
    pub vlan_id: Option<u16>,
    #[serde(default = "default_true", rename = "pathlet:active")]
    pub active: bool,
}

pub fn graph_from_yang_json(input: YangJsonGraph) -> Graph {
    Graph {
        nodes: input
            .nodes
            .into_iter()
            .map(|node| Node {
                id: node.id,
                device_type: node.device_type,
                default_vrf_id: node.default_vrf_id,
                default_vlan_id: node.default_vlan_id,
            })
            .collect(),
        interfaces: input
            .interfaces
            .interface
            .into_iter()
            .map(|interface| {
                let address = interface
                    .ipv4
                    .and_then(|ipv4| ipv4.address.into_iter().next());
                Interface {
                    id: interface.name,
                    node_id: interface.node_id,
                    ip_address: address.map(|address| match address.prefix_length {
                        Some(prefix_length) => format!("{}/{}", address.ip, prefix_length),
                        None => address.ip,
                    }),
                    vrf_id: interface.vrf_id,
                    vlan_id: interface.vlan_id,
                }
            })
            .collect(),
        links: input
            .links
            .into_iter()
            .map(|link| Link {
                id: link.id,
                from_interface: link.from_interface,
                to_interface: link.to_interface,
                vlan_id: link.vlan_id,
                cost: link.cost,
                active: link.active,
            })
            .collect(),
        nat_rules: vec![],
        routing: input
            .routing
            .map(|routing| {
                routing
                    .control_plane_protocols
                    .control_plane_protocol
                    .into_iter()
                    .map(|protocol| {
                        let node_id = protocol.node_id;
                        YangRouting {
                            node_id: node_id.clone(),
                            routing: YangRoutingState {
                                control_plane_protocols: vec![YangControlPlaneProtocol {
                                    protocol_type: protocol.protocol_type,
                                    name: protocol.name,
                                    static_routes: YangStaticRoutes {
                                        ipv4: protocol
                                            .static_routes
                                            .ipv4
                                            .into_iter()
                                            .map(|route| YangStaticRoute {
                                                name: route.name,
                                                destination_prefix: route.destination_prefix,
                                                next_hop: Some(crate::YangNextHop {
                                                    next_hop_address: route.next_hop_address,
                                                    next_hop_node: route.next_hop_node,
                                                    outgoing_interface: route.outgoing_interface,
                                                }),
                                                metric: route.metric,
                                                administrative_distance: route
                                                    .administrative_distance,
                                                vrf_id: route.vrf_id,
                                                vlan_id: route.vlan_id,
                                                active: route.active,
                                            })
                                            .collect(),
                                    },
                                }],
                            },
                        }
                    })
                    .collect()
            })
            .unwrap_or_default(),
        acls: vec![],
        acl_attachments: vec![],
        routes: vec![],
    }
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_yang_json_fixture_with_pathlet_extensions() {
        let fixture = r#"
        {
          "pathlet:nodes": [
            {
              "id": "r1",
              "pathlet:device-type": "network_device",
              "pathlet:default-vrf-id": "blue",
              "pathlet:default-vlan-id": 100
            },
            { "id": "r2", "pathlet:device-type": "network_device" }
          ],
          "ietf-interfaces:interfaces": {
            "interface": [
              {
                "name": "r1-eth0",
                "pathlet:node-id": "r1",
                "pathlet:vrf-id": "blue",
                "pathlet:vlan-id": 100,
                "ietf-ip:ipv4": {
                  "address": [{ "ip": "10.0.0.1", "prefix-length": 24 }]
                }
              },
              {
                "name": "r2-eth0",
                "pathlet:node-id": "r2",
                "ietf-ip:ipv4": {
                  "address": [{ "ip": "10.0.0.2", "prefix-length": 24 }]
                }
              }
            ]
          },
          "pathlet:links": [
            {
              "id": "r1-r2",
              "pathlet:from-interface": "r1-eth0",
              "pathlet:to-interface": "r2-eth0",
              "pathlet:vlan-id": 100,
              "pathlet:cost": 10,
              "pathlet:active": true
            }
          ],
          "ietf-routing:routing": {
            "control-plane-protocols": {
              "control-plane-protocol": [
                {
                  "type": "static",
                  "name": "static",
                  "pathlet:node-id": "r1",
                  "static-routes": {
                    "ipv4": [
                      {
                        "name": "r1-to-r2",
                        "destination-prefix": "r2",
                        "pathlet:next-hop-node": "r2",
                        "outgoing-interface": "r1-eth0",
                        "metric": 10,
                        "pathlet:vrf-id": "blue",
                        "pathlet:vlan-id": 100,
                        "pathlet:active": true
                      }
                    ]
                  }
                }
              ]
            }
          }
        }
        "#;

        let input = serde_json::from_str::<YangJsonGraph>(fixture).unwrap();
        let graph = graph_from_yang_json(input);

        assert_eq!(graph.nodes[0].default_vrf_id.as_deref(), Some("blue"));
        assert_eq!(graph.interfaces[0].vrf_id.as_deref(), Some("blue"));
        assert_eq!(graph.links[0].vlan_id, Some(100));
        assert_eq!(graph.route_entries()[0].vrf_id.as_deref(), Some("blue"));
        assert_eq!(graph.route_entries()[0].vlan_id, Some(100));
    }
}
