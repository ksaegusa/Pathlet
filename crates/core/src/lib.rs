use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::net::Ipv4Addr;

mod ip;
mod nat;
mod policy;
pub mod rfc7951;

use ip::{interface_ip, ipv4_prefix_match};
use nat::{NatState, apply_nat_stage, apply_reverse_nat_state};
use policy::denied_policy_for_interface;

pub type AdjacencyList = HashMap<String, Vec<(String, u32)>>;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Node {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_vrf_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_vlan_id: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Interface {
    pub id: String,
    pub node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vrf_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vlan_id: Option<u16>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Link {
    pub id: String,
    pub from_interface: String,
    pub to_interface: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vlan_id: Option<u16>,
    pub cost: u32,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouteEntry {
    pub id: String,
    pub node_id: String,
    pub destination: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_hop: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub egress_interface: Option<String>,
    pub metric: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub administrative_distance: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vrf_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vlan_id: Option<u16>,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangRouting {
    pub node_id: String,
    pub routing: YangRoutingState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangRoutingState {
    #[serde(default)]
    pub control_plane_protocols: Vec<YangControlPlaneProtocol>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangControlPlaneProtocol {
    #[serde(rename = "type")]
    pub protocol_type: String,
    pub name: String,
    #[serde(default)]
    pub static_routes: YangStaticRoutes,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangStaticRoutes {
    #[serde(default)]
    pub ipv4: Vec<YangStaticRoute>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangStaticRoute {
    pub name: String,
    pub destination_prefix: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_hop: Option<YangNextHop>,
    pub metric: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub administrative_distance: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vrf_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vlan_id: Option<u16>,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangNextHop {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_hop_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_hop_node: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outgoing_interface: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Graph {
    pub nodes: Vec<Node>,
    #[serde(deserialize_with = "deserialize_interfaces")]
    pub interfaces: Vec<Interface>,
    pub links: Vec<Link>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub nat_rules: Vec<NatRule>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routing: Vec<YangRouting>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub acls: Vec<YangAcl>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub acl_attachments: Vec<YangAclAttachment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<RouteEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
enum InterfaceInput {
    Flat(Interface),
    Yang(YangNodeInterfaces),
}

#[derive(Clone, Debug, Deserialize)]
struct YangNodeInterfaces {
    node_id: String,
    interfaces: YangInterfacesState,
}

#[derive(Clone, Debug, Deserialize)]
struct YangInterfacesState {
    #[serde(default, rename = "interface")]
    interfaces: Vec<YangInterface>,
}

#[derive(Clone, Debug, Deserialize)]
struct YangInterface {
    name: String,
    vrf_id: Option<String>,
    vlan_id: Option<u16>,
    ipv4: Option<YangInterfaceIpv4>,
}

#[derive(Clone, Debug, Deserialize)]
struct YangInterfaceIpv4 {
    #[serde(default)]
    address: Vec<YangInterfaceAddress>,
}

#[derive(Clone, Debug, Deserialize)]
struct YangInterfaceAddress {
    ip: String,
    prefix_length: Option<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangAcl {
    pub name: String,
    #[serde(rename = "type")]
    pub acl_type: String,
    #[serde(default)]
    pub aces: Vec<YangAce>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangAce {
    pub name: String,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub matches: YangAceMatches,
    pub actions: YangAceActions,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangAceMatches {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ipv4: Option<YangIpv4Match>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tcp: Option<YangTransportMatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub udp: Option<YangTransportMatch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icmp: Option<YangEmptyMatch>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangIpv4Match {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_ipv4_network: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_ipv4_network: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangTransportMatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_port: Option<YangPortMatch>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangPortMatch {
    pub operator: String,
    pub port: u16,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangEmptyMatch {}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangAceActions {
    pub forwarding: YangForwardingAction,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum YangForwardingAction {
    Accept,
    Drop,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct YangAclAttachment {
    pub node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interface_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ingress: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub egress: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct NatRule {
    pub id: String,
    pub node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interface_id: Option<String>,
    pub direction: NatDirection,
    pub nat_type: NatType,
    pub original: String,
    pub translated: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub active: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NatDirection {
    Ingress,
    Egress,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NatType {
    Source,
    Destination,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouteRequest {
    pub graph: Graph,
    pub from_interface: String,
    pub to_interface: String,
    #[serde(default)]
    pub mode: RouteMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traffic: Option<TrafficSpec>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TrafficSpec {
    pub protocol: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PacketState {
    pub protocol: String,
    pub port: Option<u16>,
    pub source: Option<String>,
    pub destination: Option<String>,
}

impl PacketState {
    fn from_traffic(traffic: Option<&TrafficSpec>) -> Self {
        let Some(traffic) = traffic else {
            return Self {
                protocol: "icmp".into(),
                port: None,
                source: None,
                destination: None,
            };
        };
        Self {
            protocol: traffic.protocol.clone(),
            port: traffic.port,
            source: traffic.source.clone(),
            destination: traffic.destination.clone(),
        }
    }

    fn to_traffic_spec(&self) -> TrafficSpec {
        TrafficSpec {
            protocol: self.protocol.clone(),
            port: self.port,
            source: self.source.clone(),
            destination: self.destination.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouteResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub equal_cost_paths: Option<Vec<Vec<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<RouteStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_route_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_policy_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_nat_rule_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translated_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translated_destination: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forward: Option<PipelineLeg>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub return_path: Option<PipelineLeg>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_link_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RouteError>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PipelineLeg {
    pub path: Vec<String>,
    pub status: RouteStatus,
    pub matched_route_ids: Vec<String>,
    pub matched_policy_ids: Vec<String>,
    pub matched_nat_rule_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_after: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_after: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteMode {
    #[default]
    ShortestPath,
    RoutingTable,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteStatus {
    Reachable,
    Unreachable,
    Loop,
    NoRoute,
    Blackhole,
    PolicyDenied,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouteError {
    pub code: RouteErrorCode,
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RouteErrorCode {
    InvalidInput,
    NotFound,
    Unreachable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Route {
    pub path: Vec<String>,
    pub equal_cost_paths: Vec<Vec<String>>,
    pub cost: u32,
    pub status: RouteStatus,
    pub matched_route_ids: Vec<String>,
    pub matched_policy_ids: Vec<String>,
    pub matched_nat_rule_ids: Vec<String>,
    pub translated_source: Option<String>,
    pub translated_destination: Option<String>,
    pub forward: Option<PipelineLeg>,
    pub return_path: Option<PipelineLeg>,
    pub loop_link_ids: Vec<String>,
}

fn default_true() -> bool {
    true
}

fn deserialize_interfaces<'de, D>(deserializer: D) -> Result<Vec<Interface>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let inputs = Vec::<InterfaceInput>::deserialize(deserializer)?;
    Ok(inputs
        .into_iter()
        .flat_map(|input| match input {
            InterfaceInput::Flat(interface) => vec![interface],
            InterfaceInput::Yang(node_interfaces) => node_interfaces
                .interfaces
                .interfaces
                .into_iter()
                .map(|interface| {
                    let address = interface
                        .ipv4
                        .and_then(|ipv4| ipv4.address.into_iter().next());
                    Interface {
                        id: interface.name,
                        node_id: node_interfaces.node_id.clone(),
                        ip_address: address.map(|address| match address.prefix_length {
                            Some(prefix_length) => format!("{}/{}", address.ip, prefix_length),
                            None => address.ip,
                        }),
                        vrf_id: interface.vrf_id,
                        vlan_id: interface.vlan_id,
                    }
                })
                .collect(),
        })
        .collect())
}

#[derive(Clone, Eq, PartialEq)]
struct QueueState {
    cost: u32,
    interface_id: String,
}

impl Ord for QueueState {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .cmp(&self.cost)
            .then_with(|| self.interface_id.cmp(&other.interface_id))
    }
}

impl PartialOrd for QueueState {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Graph {
    pub fn validate(&self) -> Result<(), RouteError> {
        let node_ids: HashSet<&str> = self.nodes.iter().map(|node| node.id.as_str()).collect();
        let interface_ids: HashSet<&str> = self
            .interfaces
            .iter()
            .map(|interface| interface.id.as_str())
            .collect();

        for interface in &self.interfaces {
            if !node_ids.contains(interface.node_id.as_str()) {
                return Err(RouteError::invalid_input(format!(
                    "interface '{}' references missing node '{}'",
                    interface.id, interface.node_id
                )));
            }
        }

        for link in &self.links {
            if !interface_ids.contains(link.from_interface.as_str()) {
                return Err(RouteError::invalid_input(format!(
                    "link '{}' references missing from_interface '{}'",
                    link.id, link.from_interface
                )));
            }
            if !interface_ids.contains(link.to_interface.as_str()) {
                return Err(RouteError::invalid_input(format!(
                    "link '{}' references missing to_interface '{}'",
                    link.id, link.to_interface
                )));
            }
        }

        for route in self.route_entries() {
            if !node_ids.contains(route.node_id.as_str()) {
                return Err(RouteError::invalid_input(format!(
                    "route '{}' references missing node '{}'",
                    route.id, route.node_id
                )));
            }
            if let Some(egress_interface) = &route.egress_interface {
                let Some(interface) = self
                    .interfaces
                    .iter()
                    .find(|interface| interface.id == *egress_interface)
                else {
                    return Err(RouteError::invalid_input(format!(
                        "route '{}' references missing egress_interface '{}'",
                        route.id, egress_interface
                    )));
                };

                if interface.node_id != route.node_id {
                    return Err(RouteError::invalid_input(format!(
                        "route '{}' egress_interface '{}' belongs to node '{}', not '{}'",
                        route.id, egress_interface, interface.node_id, route.node_id
                    )));
                }
            }
        }

        for rule in &self.nat_rules {
            if !node_ids.contains(rule.node_id.as_str()) {
                return Err(RouteError::invalid_input(format!(
                    "NAT rule '{}' references missing node '{}'",
                    rule.id, rule.node_id
                )));
            }
            if let Some(interface_id) = &rule.interface_id {
                let Some(interface) = self
                    .interfaces
                    .iter()
                    .find(|interface| interface.id == *interface_id)
                else {
                    return Err(RouteError::invalid_input(format!(
                        "NAT rule '{}' references missing interface '{}'",
                        rule.id, interface_id
                    )));
                };

                if interface.node_id != rule.node_id {
                    return Err(RouteError::invalid_input(format!(
                        "NAT rule '{}' interface '{}' belongs to node '{}', not '{}'",
                        rule.id, interface_id, interface.node_id, rule.node_id
                    )));
                }
            }
        }

        Ok(())
    }

    pub fn route_entries(&self) -> Vec<RouteEntry> {
        if self.routing.is_empty() {
            return self.routes.clone();
        }

        self.routing
            .iter()
            .flat_map(|node_routing| {
                node_routing
                    .routing
                    .control_plane_protocols
                    .iter()
                    .flat_map(|protocol| {
                        protocol.static_routes.ipv4.iter().map(|route| RouteEntry {
                            id: route.name.clone(),
                            node_id: node_routing.node_id.clone(),
                            destination: route.destination_prefix.clone(),
                            next_hop: route.next_hop.as_ref().and_then(|next_hop| {
                                next_hop
                                    .next_hop_node
                                    .clone()
                                    .or_else(|| next_hop.next_hop_address.clone())
                            }),
                            egress_interface: route
                                .next_hop
                                .as_ref()
                                .and_then(|next_hop| next_hop.outgoing_interface.clone()),
                            metric: route.metric,
                            administrative_distance: route.administrative_distance,
                            vrf_id: route.vrf_id.clone(),
                            vlan_id: route.vlan_id,
                            active: route.active,
                        })
                    })
            })
            .collect()
    }

    pub fn interface_exists(&self, interface_id: &str) -> bool {
        self.interfaces
            .iter()
            .any(|interface| interface.id == interface_id)
    }

    pub fn adjacency_list(&self) -> Result<AdjacencyList, RouteError> {
        self.validate()?;

        let mut adjacency = self
            .interfaces
            .iter()
            .map(|interface| (interface.id.clone(), Vec::new()))
            .collect::<AdjacencyList>();

        let mut interfaces_by_node = HashMap::<&str, Vec<&str>>::new();
        for interface in &self.interfaces {
            interfaces_by_node
                .entry(interface.node_id.as_str())
                .or_default()
                .push(interface.id.as_str());
        }

        for interface_ids in interfaces_by_node.values() {
            for from_interface in interface_ids {
                for to_interface in interface_ids {
                    if from_interface != to_interface {
                        adjacency
                            .entry((*from_interface).to_string())
                            .or_default()
                            .push(((*to_interface).to_string(), 0));
                    }
                }
            }
        }

        for link in self.links.iter().filter(|link| link.active) {
            adjacency
                .entry(link.from_interface.clone())
                .or_default()
                .push((link.to_interface.clone(), link.cost));
            adjacency
                .entry(link.to_interface.clone())
                .or_default()
                .push((link.from_interface.clone(), link.cost));
        }

        Ok(adjacency)
    }
}

impl RouteError {
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self {
            code: RouteErrorCode::InvalidInput,
            message: message.into(),
        }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self {
            code: RouteErrorCode::NotFound,
            message: message.into(),
        }
    }

    pub fn unreachable(message: impl Into<String>) -> Self {
        Self {
            code: RouteErrorCode::Unreachable,
            message: message.into(),
        }
    }
}

impl From<Result<Route, RouteError>> for RouteResponse {
    fn from(result: Result<Route, RouteError>) -> Self {
        match result {
            Ok(route) => Self {
                ok: true,
                path: Some(route.path),
                equal_cost_paths: Some(route.equal_cost_paths),
                cost: Some(route.cost),
                status: Some(route.status),
                matched_route_ids: Some(route.matched_route_ids),
                matched_policy_ids: Some(route.matched_policy_ids),
                matched_nat_rule_ids: Some(route.matched_nat_rule_ids),
                translated_source: route.translated_source,
                translated_destination: route.translated_destination,
                forward: route.forward,
                return_path: route.return_path,
                loop_link_ids: Some(route.loop_link_ids),
                error: None,
            },
            Err(error) => Self {
                ok: false,
                path: None,
                equal_cost_paths: None,
                cost: None,
                status: None,
                matched_route_ids: None,
                matched_policy_ids: None,
                matched_nat_rule_ids: None,
                translated_source: None,
                translated_destination: None,
                forward: None,
                return_path: None,
                loop_link_ids: None,
                error: Some(error),
            },
        }
    }
}

pub fn shortest_path(
    adjacency: &AdjacencyList,
    from_interface: &str,
    to_interface: &str,
) -> Result<Route, RouteError> {
    if !adjacency.contains_key(from_interface) {
        return Err(RouteError::not_found(format!(
            "from_interface '{}' was not found",
            from_interface
        )));
    }
    if !adjacency.contains_key(to_interface) {
        return Err(RouteError::not_found(format!(
            "to_interface '{}' was not found",
            to_interface
        )));
    }

    let mut distances = HashMap::<String, u32>::new();
    let mut previous = HashMap::<String, Vec<String>>::new();
    let mut queue = BinaryHeap::new();

    distances.insert(from_interface.to_string(), 0);
    queue.push(QueueState {
        cost: 0,
        interface_id: from_interface.to_string(),
    });

    while let Some(QueueState { cost, interface_id }) = queue.pop() {
        if cost > *distances.get(&interface_id).unwrap_or(&u32::MAX) {
            continue;
        }

        for (neighbor, edge_cost) in adjacency.get(&interface_id).into_iter().flatten() {
            let next_cost = cost.checked_add(*edge_cost).ok_or_else(|| {
                RouteError::invalid_input("route cost overflowed u32 while calculating path")
            })?;

            if next_cost < *distances.get(neighbor).unwrap_or(&u32::MAX) {
                distances.insert(neighbor.clone(), next_cost);
                previous.insert(neighbor.clone(), vec![interface_id.clone()]);
                queue.push(QueueState {
                    cost: next_cost,
                    interface_id: neighbor.clone(),
                });
            } else if next_cost == *distances.get(neighbor).unwrap_or(&u32::MAX) {
                let predecessors = previous.entry(neighbor.clone()).or_default();
                if !predecessors.contains(&interface_id) {
                    predecessors.push(interface_id.clone());
                    predecessors.sort();
                }
            }
        }
    }

    let Some(cost) = distances.get(to_interface).copied() else {
        return Ok(unreachable_shortest_path_route(
            &previous,
            &distances,
            from_interface,
        ));
    };
    let equal_cost_paths = reconstruct_paths(&previous, from_interface, to_interface);
    let Some(path) = equal_cost_paths.first().cloned() else {
        return Ok(unreachable_shortest_path_route(
            &previous,
            &distances,
            from_interface,
        ));
    };

    Ok(Route {
        path: path.clone(),
        equal_cost_paths,
        cost,
        status: RouteStatus::Reachable,
        matched_route_ids: vec![],
        matched_policy_ids: vec![],
        matched_nat_rule_ids: vec![],
        translated_source: None,
        translated_destination: None,
        forward: None,
        return_path: None,
        loop_link_ids: vec![],
    })
}

fn unreachable_shortest_path_route(
    previous: &HashMap<String, Vec<String>>,
    distances: &HashMap<String, u32>,
    from_interface: &str,
) -> Route {
    let (frontier_interface, cost) = distances
        .iter()
        .max_by(
            |(left_interface, left_cost), (right_interface, right_cost)| {
                left_cost
                    .cmp(right_cost)
                    .then_with(|| left_interface.cmp(right_interface))
            },
        )
        .map(|(interface_id, cost)| (interface_id.as_str(), *cost))
        .unwrap_or((from_interface, 0));
    let equal_cost_paths = reconstruct_paths(previous, from_interface, frontier_interface);
    let path = equal_cost_paths
        .first()
        .cloned()
        .unwrap_or_else(|| vec![from_interface.to_string()]);

    Route {
        path: path.clone(),
        equal_cost_paths: if equal_cost_paths.is_empty() {
            vec![path]
        } else {
            equal_cost_paths
        },
        cost,
        status: RouteStatus::Unreachable,
        matched_route_ids: vec![],
        matched_policy_ids: vec![],
        matched_nat_rule_ids: vec![],
        translated_source: None,
        translated_destination: None,
        forward: None,
        return_path: None,
        loop_link_ids: vec![],
    }
}

pub fn calculate_route(request: RouteRequest) -> Result<Route, RouteError> {
    request.graph.validate()?;

    if !request.graph.interface_exists(&request.from_interface) {
        return Err(RouteError::not_found(format!(
            "from_interface '{}' was not found",
            request.from_interface
        )));
    }
    if !request.graph.interface_exists(&request.to_interface) {
        return Err(RouteError::not_found(format!(
            "to_interface '{}' was not found",
            request.to_interface
        )));
    }

    let mut forward_packet = PacketState::from_traffic(request.traffic.as_ref());
    let source_before = forward_packet.source.clone();
    let destination_before = forward_packet.destination.clone();
    let mut matched_nat_states = Vec::<NatState>::new();
    let mut matched_nat_rule_ids = Vec::<String>::new();

    let from_interface = request
        .graph
        .interfaces
        .iter()
        .find(|interface| interface.id == request.from_interface)
        .ok_or_else(|| {
            RouteError::not_found(format!(
                "from_interface '{}' was not found",
                request.from_interface
            ))
        })?;
    if let Some(state) = apply_nat_stage(
        &request.graph,
        &mut forward_packet,
        from_interface,
        NatDirection::Ingress,
        NatType::Destination,
        &matched_nat_rule_ids,
    ) {
        matched_nat_rule_ids.push(state.rule_id.clone());
        matched_nat_states.push(state);
    }

    let forward_to_interface = interface_for_packet_destination(&request.graph, &forward_packet)
        .unwrap_or(request.to_interface.as_str());
    let mut forward_route = route_for_mode(
        &request.graph,
        &request.mode,
        &request.from_interface,
        forward_to_interface,
    )?;

    if forward_route.status == RouteStatus::Reachable {
        apply_pipeline_policy(&request.graph, &mut forward_route, &forward_packet)?;
    }
    if forward_route.status == RouteStatus::Reachable {
        apply_post_routing_snat(
            &request.graph,
            &mut forward_route,
            &mut forward_packet,
            &mut matched_nat_rule_ids,
            &mut matched_nat_states,
        )?;
    }
    forward_route.matched_nat_rule_ids = matched_nat_rule_ids.clone();
    forward_route.translated_source = changed_value(&source_before, &forward_packet.source);
    forward_route.translated_destination =
        changed_value(&destination_before, &forward_packet.destination);

    let forward_leg = pipeline_leg(
        &forward_route,
        source_before.clone(),
        destination_before.clone(),
        forward_packet.source.clone(),
        forward_packet.destination.clone(),
    );

    if forward_route.status != RouteStatus::Reachable {
        forward_route.forward = Some(forward_leg);
        return Ok(forward_route);
    }

    let return_source_before = forward_packet.destination.clone();
    let return_destination_before = forward_packet.source.clone();
    let mut return_packet = PacketState {
        protocol: forward_packet.protocol.clone(),
        port: forward_packet.port,
        source: return_source_before.clone(),
        destination: return_destination_before.clone(),
    };
    for state in matched_nat_states.iter().rev() {
        apply_reverse_nat_state(&mut return_packet, state);
    }

    let mut return_route = route_for_mode(
        &request.graph,
        &request.mode,
        &request.to_interface,
        &request.from_interface,
    )?;
    return_route.matched_nat_rule_ids = matched_nat_rule_ids;
    return_route.translated_source = changed_value(&return_source_before, &return_packet.source);
    return_route.translated_destination =
        changed_value(&return_destination_before, &return_packet.destination);

    let return_leg = pipeline_leg(
        &return_route,
        return_source_before,
        return_destination_before,
        return_packet.source,
        return_packet.destination,
    );

    let mut route = forward_route;
    route.forward = Some(forward_leg);
    route.return_path = Some(return_leg);
    if return_route.status != RouteStatus::Reachable {
        route.status = return_route.status;
        route
            .matched_route_ids
            .extend(return_route.matched_route_ids);
        route.loop_link_ids.extend(return_route.loop_link_ids);
        route.loop_link_ids.sort();
        route.loop_link_ids.dedup();
    }
    Ok(route)
}

fn route_for_mode(
    graph: &Graph,
    mode: &RouteMode,
    from_interface: &str,
    to_interface: &str,
) -> Result<Route, RouteError> {
    match mode {
        RouteMode::ShortestPath => {
            let adjacency = graph.adjacency_list()?;
            shortest_path(&adjacency, from_interface, to_interface)
        }
        RouteMode::RoutingTable => routing_table_path(graph, from_interface, to_interface),
    }
}

fn interface_for_packet_destination<'a>(graph: &'a Graph, packet: &PacketState) -> Option<&'a str> {
    let destination = packet.destination.as_deref()?;
    let destination_ip = interface_ip(destination)?;
    graph
        .interfaces
        .iter()
        .find(|interface| {
            interface
                .ip_address
                .as_deref()
                .and_then(interface_ip)
                .is_some_and(|interface_ip| interface_ip == destination_ip)
        })
        .map(|interface| interface.id.as_str())
}

fn changed_value(before: &Option<String>, after: &Option<String>) -> Option<String> {
    (before != after).then(|| after.clone()).flatten()
}

fn pipeline_leg(
    route: &Route,
    source_before: Option<String>,
    destination_before: Option<String>,
    source_after: Option<String>,
    destination_after: Option<String>,
) -> PipelineLeg {
    PipelineLeg {
        path: route.path.clone(),
        status: route.status.clone(),
        matched_route_ids: route.matched_route_ids.clone(),
        matched_policy_ids: route.matched_policy_ids.clone(),
        matched_nat_rule_ids: route.matched_nat_rule_ids.clone(),
        source_before,
        destination_before,
        source_after,
        destination_after,
    }
}

fn apply_pipeline_policy(
    graph: &Graph,
    route: &mut Route,
    packet: &PacketState,
) -> Result<(), RouteError> {
    if graph.acls.is_empty() || graph.acl_attachments.is_empty() {
        return Ok(());
    }
    let traffic = packet.to_traffic_spec();
    let interface_by_id = graph
        .interfaces
        .iter()
        .map(|interface| (interface.id.as_str(), interface))
        .collect::<HashMap<_, _>>();

    for (from_interface_id, to_interface_id) in active_path_pairs(graph, &route.path) {
        let from_interface = interface_by_id
            .get(from_interface_id.as_str())
            .ok_or_else(|| {
                RouteError::invalid_input(format!(
                    "path references missing interface '{from_interface_id}'"
                ))
            })?;
        let to_interface = interface_by_id
            .get(to_interface_id.as_str())
            .ok_or_else(|| {
                RouteError::invalid_input(format!(
                    "path references missing interface '{to_interface_id}'"
                ))
            })?;

        if let Some(denied_policy_id) =
            denied_policy_for_interface(graph, &traffic, to_interface, "ingress")
        {
            route.status = RouteStatus::PolicyDenied;
            route.matched_policy_ids.push(denied_policy_id);
            return Ok(());
        }
        if let Some(denied_policy_id) =
            denied_policy_for_interface(graph, &traffic, from_interface, "egress")
        {
            route.status = RouteStatus::PolicyDenied;
            route.matched_policy_ids.push(denied_policy_id);
            return Ok(());
        }
    }

    Ok(())
}

fn apply_post_routing_snat(
    graph: &Graph,
    route: &mut Route,
    packet: &mut PacketState,
    matched_nat_rule_ids: &mut Vec<String>,
    matched_nat_states: &mut Vec<NatState>,
) -> Result<(), RouteError> {
    if graph.nat_rules.is_empty() {
        return Ok(());
    }
    let interface_by_id = graph
        .interfaces
        .iter()
        .map(|interface| (interface.id.as_str(), interface))
        .collect::<HashMap<_, _>>();

    for (from_interface_id, _) in active_path_pairs(graph, &route.path) {
        let from_interface = interface_by_id
            .get(from_interface_id.as_str())
            .ok_or_else(|| {
                RouteError::invalid_input(format!(
                    "path references missing interface '{from_interface_id}'"
                ))
            })?;
        if let Some(state) = apply_nat_stage(
            graph,
            packet,
            from_interface,
            NatDirection::Egress,
            NatType::Source,
            matched_nat_rule_ids,
        ) {
            matched_nat_rule_ids.push(state.rule_id.clone());
            matched_nat_states.push(state);
        }
    }

    route.matched_nat_rule_ids = matched_nat_rule_ids.clone();
    Ok(())
}

fn active_path_pairs(graph: &Graph, path: &[String]) -> Vec<(String, String)> {
    path.windows(2)
        .filter_map(|window| {
            let [from_interface, to_interface] = window else {
                return None;
            };
            graph
                .links
                .iter()
                .any(|link| {
                    (link.from_interface == *from_interface && link.to_interface == *to_interface)
                        || (link.from_interface == *to_interface
                            && link.to_interface == *from_interface)
                })
                .then(|| (from_interface.clone(), to_interface.clone()))
        })
        .collect()
}

pub fn routing_table_path(
    graph: &Graph,
    from_interface: &str,
    to_interface: &str,
) -> Result<Route, RouteError> {
    graph.validate()?;

    let interface_by_id = graph
        .interfaces
        .iter()
        .map(|interface| (interface.id.as_str(), interface))
        .collect::<HashMap<_, _>>();
    let from = interface_by_id.get(from_interface).ok_or_else(|| {
        RouteError::not_found(format!("from_interface '{from_interface}' was not found"))
    })?;
    let to = interface_by_id.get(to_interface).ok_or_else(|| {
        RouteError::not_found(format!("to_interface '{to_interface}' was not found"))
    })?;

    let target_node_id = to.node_id.as_str();
    let target_ip = to.ip_address.as_deref().and_then(interface_ip);
    let route_context = route_context_for_interface(graph, from);
    let mut current_node_id = from.node_id.as_str();
    let mut path = vec![from_interface.to_string()];
    let mut matched_route_ids = Vec::new();
    let mut loop_link_ids = Vec::new();
    let mut visited_nodes = HashMap::<String, usize>::from([(current_node_id.to_string(), 0)]);
    let mut cost = 0_u32;
    let hop_limit = graph.nodes.len().saturating_mul(4).max(16);
    let routes = graph.route_entries();

    for _ in 0..hop_limit {
        if current_node_id == target_node_id {
            append_interface_hop(&mut path, to_interface);
            return Ok(Route {
                path: path.clone(),
                equal_cost_paths: vec![path],
                cost,
                status: RouteStatus::Reachable,
                matched_route_ids,
                matched_policy_ids: vec![],
                matched_nat_rule_ids: vec![],
                translated_source: None,
                translated_destination: None,
                forward: None,
                return_path: None,
                loop_link_ids,
            });
        }

        let selected = if let Some(link) = connected_link_to_target(
            graph,
            current_node_id,
            target_node_id,
            target_ip,
            &route_context,
        ) {
            Some((None, link))
        } else {
            let Some(route) = best_route_for_node(
                graph,
                current_node_id,
                target_node_id,
                to_interface,
                target_ip,
                &route_context,
                &routes,
            ) else {
                return Ok(Route {
                    path: path.clone(),
                    equal_cost_paths: vec![path],
                    cost,
                    status: RouteStatus::NoRoute,
                    matched_route_ids,
                    matched_policy_ids: vec![],
                    matched_nat_rule_ids: vec![],
                    translated_source: None,
                    translated_destination: None,
                    forward: None,
                    return_path: None,
                    loop_link_ids,
                });
            };
            let Some(link) = resolve_route_link(graph, route, &route_context) else {
                matched_route_ids.push(route.id.clone());
                return Ok(Route {
                    path: path.clone(),
                    equal_cost_paths: vec![path],
                    cost,
                    status: RouteStatus::Blackhole,
                    matched_route_ids,
                    matched_policy_ids: vec![],
                    matched_nat_rule_ids: vec![],
                    translated_source: None,
                    translated_destination: None,
                    forward: None,
                    return_path: None,
                    loop_link_ids,
                });
            };
            Some((Some(route), link))
        };

        let Some((route, link)) = selected else {
            unreachable!("routing table selection should return or select a link");
        };

        if let Some(route) = route {
            matched_route_ids.push(route.id.clone());
        }

        let (egress_interface, ingress_interface) =
            oriented_link_interfaces(link, current_node_id, graph).ok_or_else(|| {
                RouteError::invalid_input(format!(
                    "link '{}' is not connected to node '{}'",
                    link.id, current_node_id
                ))
            })?;
        append_interface_hop(&mut path, egress_interface);
        append_interface_hop(&mut path, ingress_interface);
        cost = cost.checked_add(link.cost).ok_or_else(|| {
            RouteError::invalid_input("route cost overflowed u32 while tracing routing table")
        })?;

        let next_node_id = interface_by_id
            .get(ingress_interface)
            .map(|interface| interface.node_id.as_str())
            .ok_or_else(|| {
                RouteError::invalid_input(format!(
                    "link '{}' resolved missing ingress interface '{}'",
                    link.id, ingress_interface
                ))
            })?;

        if let Some(previous_index) = visited_nodes.get(next_node_id).copied() {
            let loop_link_set = links_between_path_nodes(graph, &path, previous_index);
            loop_link_ids = loop_link_set.into_iter().collect();
            loop_link_ids.sort();
            return Ok(Route {
                path: path.clone(),
                equal_cost_paths: vec![path],
                cost,
                status: RouteStatus::Loop,
                matched_route_ids,
                matched_policy_ids: vec![],
                matched_nat_rule_ids: vec![],
                translated_source: None,
                translated_destination: None,
                forward: None,
                return_path: None,
                loop_link_ids,
            });
        }

        visited_nodes.insert(next_node_id.to_string(), path.len() - 1);
        current_node_id = next_node_id;
    }

    Ok(Route {
        path: path.clone(),
        equal_cost_paths: vec![path],
        cost,
        status: RouteStatus::Loop,
        matched_route_ids,
        matched_policy_ids: vec![],
        matched_nat_rule_ids: vec![],
        translated_source: None,
        translated_destination: None,
        forward: None,
        return_path: None,
        loop_link_ids,
    })
}

fn best_route_for_node<'a>(
    graph: &Graph,
    node_id: &str,
    target_node_id: &str,
    target_interface_id: &str,
    target_ip: Option<Ipv4Addr>,
    context: &RouteContext,
    routes: &'a [RouteEntry],
) -> Option<&'a RouteEntry> {
    routes
        .iter()
        .filter(|route| route.active && route.node_id == node_id)
        .filter(|route| route_matches_context(graph, route, context))
        .filter_map(|route| {
            route_match_score(route, target_node_id, target_interface_id, target_ip).map(|score| {
                let administrative_distance = route.administrative_distance.unwrap_or(1);
                (route, score, administrative_distance, route.metric)
            })
        })
        .min_by(
            |(_, left_score, left_ad, left_metric), (_, right_score, right_ad, right_metric)| {
                right_score
                    .cmp(left_score)
                    .then_with(|| left_ad.cmp(right_ad))
                    .then_with(|| left_metric.cmp(right_metric))
            },
        )
        .map(|(route, _, _, _)| route)
}

fn route_match_score(
    route: &RouteEntry,
    target_node_id: &str,
    target_interface_id: &str,
    target_ip: Option<Ipv4Addr>,
) -> Option<u8> {
    if route.destination == target_node_id || route.destination == target_interface_id {
        return Some(129);
    }

    if let Some(target_ip) = target_ip {
        if let Some(route_ip) = interface_ip(&route.destination)
            && route_ip == target_ip
        {
            return Some(128);
        }
        if let Some(prefix_len) = ipv4_prefix_match(&route.destination, target_ip) {
            return Some(prefix_len);
        }
    }

    (route.destination == "0.0.0.0/0").then_some(0)
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RouteContext {
    vrf_id: String,
    vlan_id: Option<u16>,
}

fn route_context_for_interface(graph: &Graph, interface: &Interface) -> RouteContext {
    let node = graph.nodes.iter().find(|node| node.id == interface.node_id);
    RouteContext {
        vrf_id: interface
            .vrf_id
            .clone()
            .or_else(|| node.and_then(|node| node.default_vrf_id.clone()))
            .unwrap_or_else(|| "default".to_string()),
        vlan_id: interface
            .vlan_id
            .or_else(|| node.and_then(|node| node.default_vlan_id)),
    }
}

fn effective_route_vrf<'a>(graph: &'a Graph, route: &'a RouteEntry) -> &'a str {
    route.vrf_id.as_deref().unwrap_or_else(|| {
        graph
            .nodes
            .iter()
            .find(|node| node.id == route.node_id)
            .and_then(|node| node.default_vrf_id.as_deref())
            .unwrap_or("default")
    })
}

fn route_matches_context(graph: &Graph, route: &RouteEntry, context: &RouteContext) -> bool {
    effective_route_vrf(graph, route) == context.vrf_id
        && route
            .vlan_id
            .is_none_or(|route_vlan_id| Some(route_vlan_id) == context.vlan_id)
}

fn link_matches_context(link: &Link, context: &RouteContext) -> bool {
    link.vlan_id
        .is_none_or(|link_vlan_id| Some(link_vlan_id) == context.vlan_id)
}

fn resolve_route_link<'a>(
    graph: &'a Graph,
    route: &RouteEntry,
    context: &RouteContext,
) -> Option<&'a Link> {
    if let Some(next_hop) = &route.next_hop {
        if let Some(next_hop_interface) = graph.interfaces.iter().find(|interface| {
            interface.id == *next_hop
                || interface
                    .ip_address
                    .as_deref()
                    .and_then(interface_ip)
                    .is_some_and(|ip| ip.to_string() == *next_hop)
        }) {
            return active_links_from_node(graph, &route.node_id)
                .into_iter()
                .filter(|link| link_matches_context(link, context))
                .filter(|link| {
                    route
                        .egress_interface
                        .as_ref()
                        .is_none_or(|egress| link_uses_interface(link, egress))
                })
                .find(|link| link_uses_interface(link, &next_hop_interface.id));
        }

        if graph.nodes.iter().any(|node| node.id == *next_hop) {
            return active_link_between_nodes(
                graph,
                &route.node_id,
                next_hop,
                route.egress_interface.as_deref(),
                context,
            );
        }
    }

    route
        .egress_interface
        .as_deref()
        .and_then(|egress_interface| {
            active_links_from_node(graph, &route.node_id)
                .into_iter()
                .filter(|link| link_matches_context(link, context))
                .find(|link| link_uses_interface(link, egress_interface))
        })
}

fn connected_link_to_target<'a>(
    graph: &'a Graph,
    from_node_id: &str,
    to_node_id: &str,
    target_ip: Option<Ipv4Addr>,
    context: &RouteContext,
) -> Option<&'a Link> {
    let direct_links = active_links_from_node(graph, from_node_id)
        .into_iter()
        .filter(|link| link_matches_context(link, context))
        .filter(|link| {
            let Some((_, ingress_interface)) = oriented_link_interfaces(link, from_node_id, graph)
            else {
                return false;
            };
            graph.interfaces.iter().any(|interface| {
                interface.id == ingress_interface && interface.node_id == to_node_id
            })
        })
        .collect::<Vec<_>>();

    if let Some(target_ip) = target_ip
        && let Some(link) = direct_links.iter().copied().find(|link| {
            let Some((egress_interface, _)) = oriented_link_interfaces(link, from_node_id, graph)
            else {
                return false;
            };
            graph.interfaces.iter().any(|interface| {
                interface.id == egress_interface
                    && interface
                        .ip_address
                        .as_deref()
                        .and_then(|ip_address| ipv4_prefix_match(ip_address, target_ip))
                        .is_some()
            })
        })
    {
        return Some(link);
    }

    direct_links.into_iter().next()
}

fn active_link_between_nodes<'a>(
    graph: &'a Graph,
    from_node_id: &str,
    to_node_id: &str,
    egress_interface: Option<&str>,
    context: &RouteContext,
) -> Option<&'a Link> {
    active_links_from_node(graph, from_node_id)
        .into_iter()
        .filter(|link| link_matches_context(link, context))
        .filter(|link| egress_interface.is_none_or(|egress| link_uses_interface(link, egress)))
        .find(|link| {
            let Some((_, ingress_interface)) = oriented_link_interfaces(link, from_node_id, graph)
            else {
                return false;
            };
            graph.interfaces.iter().any(|interface| {
                interface.id == ingress_interface && interface.node_id == to_node_id
            })
        })
}

fn active_links_from_node<'a>(graph: &'a Graph, node_id: &str) -> Vec<&'a Link> {
    graph
        .links
        .iter()
        .filter(|link| link.active)
        .filter(|link| {
            graph.interfaces.iter().any(|interface| {
                interface.node_id == node_id
                    && (interface.id == link.from_interface || interface.id == link.to_interface)
            })
        })
        .collect()
}

fn oriented_link_interfaces<'a>(
    link: &'a Link,
    current_node_id: &str,
    graph: &Graph,
) -> Option<(&'a str, &'a str)> {
    let from_node_id = graph
        .interfaces
        .iter()
        .find(|interface| interface.id == link.from_interface)
        .map(|interface| interface.node_id.as_str())?;
    let to_node_id = graph
        .interfaces
        .iter()
        .find(|interface| interface.id == link.to_interface)
        .map(|interface| interface.node_id.as_str())?;

    if from_node_id == current_node_id {
        Some((link.from_interface.as_str(), link.to_interface.as_str()))
    } else if to_node_id == current_node_id {
        Some((link.to_interface.as_str(), link.from_interface.as_str()))
    } else {
        None
    }
}

fn link_uses_interface(link: &Link, interface_id: &str) -> bool {
    link.from_interface == interface_id || link.to_interface == interface_id
}

fn append_interface_hop(path: &mut Vec<String>, interface_id: &str) {
    if path.last().is_none_or(|current| current != interface_id) {
        path.push(interface_id.to_string());
    }
}

fn links_between_path_nodes(graph: &Graph, path: &[String], start_index: usize) -> HashSet<String> {
    let mut link_ids = HashSet::new();
    for window in path[start_index..].windows(2) {
        let [from_interface, to_interface] = window else {
            continue;
        };
        if let Some(link) = graph.links.iter().find(|link| {
            (link.from_interface == *from_interface && link.to_interface == *to_interface)
                || (link.from_interface == *to_interface && link.to_interface == *from_interface)
        }) {
            link_ids.insert(link.id.clone());
        }
    }
    link_ids
}

pub fn calculate_route_json(input: &str) -> String {
    let response = match parse_route_request(input) {
        Ok(request) => RouteResponse::from(calculate_route(request)),
        Err(error) => RouteResponse {
            ok: false,
            path: None,
            equal_cost_paths: None,
            cost: None,
            status: None,
            matched_route_ids: None,
            matched_policy_ids: None,
            matched_nat_rule_ids: None,
            translated_source: None,
            translated_destination: None,
            forward: None,
            return_path: None,
            loop_link_ids: None,
            error: Some(RouteError::invalid_input(format!(
                "invalid JSON/YAML route request: {error}"
            ))),
        },
    };

    serde_json::to_string(&response).expect("route response should always serialize")
}

fn parse_route_request(input: &str) -> Result<RouteRequest, String> {
    match serde_json::from_str::<RouteRequest>(input) {
        Ok(request) => Ok(request),
        Err(json_error) => serde_yaml::from_str::<RouteRequest>(input)
            .map_err(|yaml_error| format!("JSON: {json_error}; YAML: {yaml_error}")),
    }
}

fn reconstruct_paths(
    previous: &HashMap<String, Vec<String>>,
    from_interface: &str,
    to_interface: &str,
) -> Vec<Vec<String>> {
    fn walk(
        previous: &HashMap<String, Vec<String>>,
        from_interface: &str,
        current: &str,
        path: &mut Vec<String>,
        visited: &mut HashSet<String>,
        paths: &mut Vec<Vec<String>>,
    ) {
        if current == from_interface {
            let mut completed = path.clone();
            completed.reverse();
            paths.push(completed);
            return;
        }

        let Some(predecessors) = previous.get(current) else {
            return;
        };
        for predecessor in predecessors {
            if visited.contains(predecessor) {
                continue;
            }
            path.push(predecessor.clone());
            visited.insert(predecessor.clone());
            walk(previous, from_interface, predecessor, path, visited, paths);
            visited.remove(predecessor);
            path.pop();
        }
    }

    let mut paths = Vec::new();
    let mut path = vec![to_interface.to_string()];
    let mut visited = HashSet::from([to_interface.to_string()]);
    walk(
        previous,
        from_interface,
        to_interface,
        &mut path,
        &mut visited,
        &mut paths,
    );
    paths.sort();
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_graph() -> Graph {
        Graph {
            nodes: vec![
                Node {
                    id: "r1".into(),
                    device_type: None,
                    default_vrf_id: None,
                    default_vlan_id: None,
                },
                Node {
                    id: "r2".into(),
                    device_type: None,
                    default_vrf_id: None,
                    default_vlan_id: None,
                },
                Node {
                    id: "r3".into(),
                    device_type: None,
                    default_vrf_id: None,
                    default_vlan_id: None,
                },
            ],
            interfaces: vec![
                Interface {
                    id: "r1-eth0".into(),
                    node_id: "r1".into(),
                    ip_address: Some("10.0.0.1/24".into()),
                    vrf_id: None,
                    vlan_id: None,
                },
                Interface {
                    id: "r2-eth0".into(),
                    node_id: "r2".into(),
                    ip_address: Some("10.0.0.2/24".into()),
                    vrf_id: None,
                    vlan_id: None,
                },
                Interface {
                    id: "r2-eth1".into(),
                    node_id: "r2".into(),
                    ip_address: Some("10.0.1.2/24".into()),
                    vrf_id: None,
                    vlan_id: None,
                },
                Interface {
                    id: "r3-eth0".into(),
                    node_id: "r3".into(),
                    ip_address: Some("10.0.2.3/24".into()),
                    vrf_id: None,
                    vlan_id: None,
                },
            ],
            links: vec![
                Link {
                    id: "l1".into(),
                    from_interface: "r1-eth0".into(),
                    to_interface: "r2-eth0".into(),
                    vlan_id: None,
                    cost: 10,
                    active: true,
                },
                Link {
                    id: "l2".into(),
                    from_interface: "r2-eth0".into(),
                    to_interface: "r3-eth0".into(),
                    vlan_id: None,
                    cost: 5,
                    active: true,
                },
                Link {
                    id: "l3".into(),
                    from_interface: "r1-eth0".into(),
                    to_interface: "r3-eth0".into(),
                    vlan_id: None,
                    cost: 100,
                    active: true,
                },
                Link {
                    id: "down".into(),
                    from_interface: "r2-eth1".into(),
                    to_interface: "r3-eth0".into(),
                    vlan_id: None,
                    cost: 1,
                    active: false,
                },
            ],
            nat_rules: vec![],
            routing: vec![],
            acls: vec![],
            acl_attachments: vec![],
            routes: vec![],
        }
    }

    #[test]
    fn adjacency_list_is_bidirectional_and_skips_inactive_links() {
        let adjacency = sample_graph().adjacency_list().unwrap();

        assert!(adjacency["r1-eth0"].contains(&("r2-eth0".into(), 10)));
        assert!(adjacency["r2-eth0"].contains(&("r1-eth0".into(), 10)));
        assert!(!adjacency["r2-eth1"].contains(&("r3-eth0".into(), 1)));
        assert!(!adjacency["r3-eth0"].contains(&("r2-eth1".into(), 1)));
    }

    #[test]
    fn adjacency_list_connects_interfaces_on_the_same_node() {
        let adjacency = sample_graph().adjacency_list().unwrap();

        assert!(adjacency["r2-eth0"].contains(&("r2-eth1".into(), 0)));
        assert!(adjacency["r2-eth1"].contains(&("r2-eth0".into(), 0)));
    }

    #[test]
    fn shortest_path_chooses_lowest_cost_route() {
        let adjacency = sample_graph().adjacency_list().unwrap();
        let route = shortest_path(&adjacency, "r1-eth0", "r3-eth0").unwrap();

        assert_eq!(route.path, vec!["r1-eth0", "r2-eth0", "r3-eth0"]);
        assert_eq!(
            route.equal_cost_paths,
            vec![vec!["r1-eth0", "r2-eth0", "r3-eth0"]]
        );
        assert_eq!(route.cost, 15);
    }

    #[test]
    fn shortest_path_returns_equal_cost_paths() {
        let mut graph = sample_graph();
        graph.links.push(Link {
            id: "equal-cost".into(),
            from_interface: "r1-eth0".into(),
            to_interface: "r3-eth0".into(),
            vlan_id: None,
            cost: 15,
            active: true,
        });
        let adjacency = graph.adjacency_list().unwrap();
        let route = shortest_path(&adjacency, "r1-eth0", "r3-eth0").unwrap();

        assert_eq!(route.cost, 15);
        assert_eq!(
            route.equal_cost_paths,
            vec![
                vec!["r1-eth0", "r2-eth0", "r3-eth0"],
                vec!["r1-eth0", "r3-eth0"],
            ]
        );
    }

    #[test]
    fn inactive_links_can_make_route_unreachable() {
        let graph = Graph {
            links: vec![Link {
                id: "l1".into(),
                from_interface: "r1-eth0".into(),
                to_interface: "r2-eth0".into(),
                vlan_id: None,
                cost: 10,
                active: false,
            }],
            ..sample_graph()
        };
        let adjacency = graph.adjacency_list().unwrap();

        let route = shortest_path(&adjacency, "r1-eth0", "r2-eth0").unwrap();
        assert_eq!(route.status, RouteStatus::Unreachable);
        assert_eq!(route.path, vec!["r1-eth0"]);
        assert_eq!(route.equal_cost_paths, vec![vec!["r1-eth0"]]);
        assert_eq!(route.cost, 0);
    }

    #[test]
    fn missing_interface_is_not_found() {
        let adjacency = sample_graph().adjacency_list().unwrap();
        let error = shortest_path(&adjacency, "missing", "r3-eth0").unwrap_err();

        assert_eq!(error.code, RouteErrorCode::NotFound);
    }

    #[test]
    fn invalid_link_endpoint_is_invalid_input() {
        let mut graph = sample_graph();
        graph.links.push(Link {
            id: "bad".into(),
            from_interface: "missing".into(),
            to_interface: "r1-eth0".into(),
            vlan_id: None,
            cost: 1,
            active: true,
        });

        let error = graph.validate().unwrap_err();
        assert_eq!(error.code, RouteErrorCode::InvalidInput);
    }

    #[test]
    fn invalid_route_egress_interface_is_invalid_input() {
        let mut graph = sample_graph();
        graph.routes.push(RouteEntry {
            id: "bad-route".into(),
            node_id: "r1".into(),
            destination: "0.0.0.0/0".into(),
            next_hop: None,
            egress_interface: Some("r2-eth0".into()),
            metric: 10,
            administrative_distance: Some(1),
            vrf_id: Some("default".into()),
            vlan_id: Some(100),
            active: true,
        });

        let error = graph.validate().unwrap_err();
        assert_eq!(error.code, RouteErrorCode::InvalidInput);
    }

    #[test]
    fn routing_table_mode_uses_node_routes() {
        let mut graph = sample_graph();
        graph.links.retain(|link| link.id != "l3");
        graph.routes.push(RouteEntry {
            id: "r1-to-r3".into(),
            node_id: "r1".into(),
            destination: "r3".into(),
            next_hop: Some("r2".into()),
            egress_interface: Some("r1-eth0".into()),
            metric: 10,
            administrative_distance: Some(1),
            vrf_id: Some("default".into()),
            vlan_id: None,
            active: true,
        });

        let route = routing_table_path(&graph, "r1-eth0", "r3-eth0").unwrap();

        assert_eq!(route.status, RouteStatus::Reachable);
        assert_eq!(route.path, vec!["r1-eth0", "r2-eth0", "r3-eth0"]);
        assert_eq!(route.matched_route_ids, vec!["r1-to-r3"]);
        assert_eq!(route.cost, 15);
    }

    #[test]
    fn routing_table_mode_prefers_connected_prefix_over_other_direct_link() {
        let mut graph = sample_graph();
        graph
            .interfaces
            .iter_mut()
            .find(|interface| interface.id == "r2-eth1")
            .unwrap()
            .ip_address = Some("10.0.2.2/24".into());
        graph
            .links
            .iter_mut()
            .find(|link| link.id == "down")
            .unwrap()
            .active = true;

        let route = routing_table_path(&graph, "r2-eth0", "r3-eth0").unwrap();

        assert_eq!(route.status, RouteStatus::Reachable);
        assert_eq!(route.path, vec!["r2-eth0", "r2-eth1", "r3-eth0"]);
        assert_eq!(route.matched_route_ids, Vec::<String>::new());
    }

    #[test]
    fn routing_table_mode_uses_yang_routing() {
        let mut graph = sample_graph();
        graph.links.retain(|link| link.id != "l3");
        graph
            .interfaces
            .iter_mut()
            .find(|interface| interface.id == "r1-eth0")
            .unwrap()
            .vlan_id = Some(100);
        graph.routing.push(YangRouting {
            node_id: "r1".into(),
            routing: YangRoutingState {
                control_plane_protocols: vec![YangControlPlaneProtocol {
                    protocol_type: "static".into(),
                    name: "static".into(),
                    static_routes: YangStaticRoutes {
                        ipv4: vec![YangStaticRoute {
                            name: "r1-to-r3".into(),
                            destination_prefix: "r3".into(),
                            next_hop: Some(YangNextHop {
                                next_hop_address: None,
                                next_hop_node: Some("r2".into()),
                                outgoing_interface: Some("r1-eth0".into()),
                            }),
                            metric: 10,
                            administrative_distance: Some(1),
                            vrf_id: Some("default".into()),
                            vlan_id: Some(100),
                            active: true,
                        }],
                    },
                }],
            },
        });

        let route = routing_table_path(&graph, "r1-eth0", "r3-eth0").unwrap();

        assert_eq!(route.status, RouteStatus::Reachable);
        assert_eq!(route.path, vec!["r1-eth0", "r2-eth0", "r3-eth0"]);
        assert_eq!(route.matched_route_ids, vec!["r1-to-r3"]);
    }

    #[test]
    fn routing_table_mode_filters_routes_by_effective_vrf() {
        let mut graph = sample_graph();
        graph.links.retain(|link| link.id != "l3");
        graph
            .nodes
            .iter_mut()
            .find(|node| node.id == "r1")
            .unwrap()
            .default_vrf_id = Some("blue".into());
        graph.routes.push(RouteEntry {
            id: "red-route".into(),
            node_id: "r1".into(),
            destination: "r3".into(),
            next_hop: Some("r2".into()),
            egress_interface: Some("r1-eth0".into()),
            metric: 10,
            administrative_distance: Some(1),
            vrf_id: Some("red".into()),
            vlan_id: None,
            active: true,
        });

        let route = routing_table_path(&graph, "r1-eth0", "r3-eth0").unwrap();

        assert_eq!(route.status, RouteStatus::NoRoute);
        assert!(route.matched_route_ids.is_empty());
    }

    #[test]
    fn routing_table_mode_uses_node_default_vrf_for_unscoped_routes() {
        let mut graph = sample_graph();
        graph.links.retain(|link| link.id != "l3");
        graph
            .nodes
            .iter_mut()
            .find(|node| node.id == "r1")
            .unwrap()
            .default_vrf_id = Some("blue".into());
        graph.routes.push(RouteEntry {
            id: "node-default-vrf-route".into(),
            node_id: "r1".into(),
            destination: "r3".into(),
            next_hop: Some("r2".into()),
            egress_interface: Some("r1-eth0".into()),
            metric: 10,
            administrative_distance: Some(1),
            vrf_id: None,
            vlan_id: None,
            active: true,
        });

        let route = routing_table_path(&graph, "r1-eth0", "r3-eth0").unwrap();

        assert_eq!(route.status, RouteStatus::Reachable);
        assert_eq!(route.matched_route_ids, vec!["node-default-vrf-route"]);
    }

    #[test]
    fn routing_table_mode_filters_routes_and_links_by_vlan() {
        let mut graph = sample_graph();
        graph.links.retain(|link| link.id != "l3");
        graph
            .interfaces
            .iter_mut()
            .find(|interface| interface.id == "r1-eth0")
            .unwrap()
            .vlan_id = Some(100);
        graph
            .links
            .iter_mut()
            .find(|link| link.id == "l1")
            .unwrap()
            .vlan_id = Some(200);
        graph.routes.push(RouteEntry {
            id: "vlan-100-route".into(),
            node_id: "r1".into(),
            destination: "r3".into(),
            next_hop: Some("r2".into()),
            egress_interface: Some("r1-eth0".into()),
            metric: 10,
            administrative_distance: Some(1),
            vrf_id: Some("default".into()),
            vlan_id: Some(100),
            active: true,
        });

        let route = routing_table_path(&graph, "r1-eth0", "r3-eth0").unwrap();

        assert_eq!(route.status, RouteStatus::Blackhole);
        assert_eq!(route.matched_route_ids, vec!["vlan-100-route"]);
    }

    #[test]
    fn routing_table_mode_reports_no_route_at_last_reached_node() {
        let mut graph = sample_graph();
        graph.links.retain(|link| link.id == "l1");
        graph.routes.push(RouteEntry {
            id: "r1-to-r3".into(),
            node_id: "r1".into(),
            destination: "r3".into(),
            next_hop: Some("r2".into()),
            egress_interface: Some("r1-eth0".into()),
            metric: 10,
            administrative_distance: Some(1),
            vrf_id: Some("default".into()),
            vlan_id: None,
            active: true,
        });

        let route = routing_table_path(&graph, "r1-eth0", "r3-eth0").unwrap();

        assert_eq!(route.status, RouteStatus::NoRoute);
        assert_eq!(route.path, vec!["r1-eth0", "r2-eth0"]);
        assert_eq!(route.matched_route_ids, vec!["r1-to-r3"]);
    }

    #[test]
    fn routing_table_mode_reports_loop() {
        let mut graph = sample_graph();
        graph.links.retain(|link| link.id == "l1");
        graph.routes = vec![
            RouteEntry {
                id: "r1-to-r3".into(),
                node_id: "r1".into(),
                destination: "r3".into(),
                next_hop: Some("r2".into()),
                egress_interface: Some("r1-eth0".into()),
                metric: 10,
                administrative_distance: Some(1),
                vrf_id: Some("default".into()),
                vlan_id: None,
                active: true,
            },
            RouteEntry {
                id: "r2-to-r3".into(),
                node_id: "r2".into(),
                destination: "r3".into(),
                next_hop: Some("r1".into()),
                egress_interface: Some("r2-eth0".into()),
                metric: 10,
                administrative_distance: Some(1),
                vrf_id: Some("default".into()),
                vlan_id: None,
                active: true,
            },
        ];

        let route = routing_table_path(&graph, "r1-eth0", "r3-eth0").unwrap();

        assert_eq!(route.status, RouteStatus::Loop);
        assert_eq!(route.loop_link_ids, vec!["l1"]);
        assert_eq!(route.matched_route_ids, vec!["r1-to-r3", "r2-to-r3"]);
    }

    #[test]
    fn route_calculation_applies_ingress_policy_deny() {
        let mut graph = sample_graph();
        graph.acls = vec![YangAcl {
            name: "r2-ingress".into(),
            acl_type: "ipv4-acl".into(),
            aces: vec![YangAce {
                name: "deny-https".into(),
                active: true,
                matches: YangAceMatches {
                    ipv4: Some(YangIpv4Match {
                        source_ipv4_network: Some("10.0.0.0/24".into()),
                        destination_ipv4_network: Some("10.0.2.3".into()),
                    }),
                    tcp: Some(YangTransportMatch {
                        destination_port: Some(YangPortMatch {
                            operator: "eq".into(),
                            port: 443,
                        }),
                    }),
                    udp: None,
                    icmp: None,
                },
                actions: YangAceActions {
                    forwarding: YangForwardingAction::Drop,
                },
            }],
        }];
        graph.acl_attachments = vec![YangAclAttachment {
            node_id: "r2".into(),
            interface_id: Some("r2-eth0".into()),
            ingress: vec!["r2-ingress".into()],
            egress: vec![],
        }];

        let route = calculate_route(RouteRequest {
            graph,
            from_interface: "r1-eth0".into(),
            to_interface: "r3-eth0".into(),
            mode: RouteMode::ShortestPath,
            traffic: Some(TrafficSpec {
                protocol: "tcp".into(),
                port: Some(443),
                source: Some("10.0.0.1/24".into()),
                destination: Some("10.0.2.3/24".into()),
            }),
        })
        .unwrap();

        assert_eq!(route.status, RouteStatus::PolicyDenied);
        assert_eq!(
            route.matched_policy_ids,
            vec!["r2::r2-eth0::ingress::r2-ingress::deny-https"]
        );
    }

    #[test]
    fn route_calculation_applies_egress_source_nat() {
        let mut graph = sample_graph();
        graph.nat_rules = vec![NatRule {
            id: "r2-snat".into(),
            node_id: "r2".into(),
            interface_id: Some("r2-eth0".into()),
            direction: NatDirection::Egress,
            nat_type: NatType::Source,
            original: "10.0.0.0/24".into(),
            translated: "203.0.113.10".into(),
            protocol: Some("tcp".into()),
            port: Some(443),
            active: true,
        }];

        let route = calculate_route(RouteRequest {
            graph,
            from_interface: "r1-eth0".into(),
            to_interface: "r3-eth0".into(),
            mode: RouteMode::ShortestPath,
            traffic: Some(TrafficSpec {
                protocol: "tcp".into(),
                port: Some(443),
                source: Some("10.0.0.1/24".into()),
                destination: Some("10.0.2.3/24".into()),
            }),
        })
        .unwrap();

        assert_eq!(route.status, RouteStatus::Reachable);
        assert_eq!(route.matched_nat_rule_ids, vec!["r2-snat"]);
        assert_eq!(route.translated_source, Some("203.0.113.10".into()));
        assert_eq!(route.translated_destination, None);
        assert_eq!(
            route
                .return_path
                .as_ref()
                .and_then(|leg| leg.destination_after.clone()),
            Some("10.0.0.1/24".into())
        );
    }

    #[test]
    fn route_calculation_fails_when_stateful_return_has_no_route() {
        let mut graph = sample_graph();
        graph.links.retain(|link| link.id != "l3");
        graph.routes.push(RouteEntry {
            id: "r1-to-r3".into(),
            node_id: "r1".into(),
            destination: "r3".into(),
            next_hop: Some("r2".into()),
            egress_interface: Some("r1-eth0".into()),
            metric: 10,
            administrative_distance: Some(1),
            vrf_id: Some("default".into()),
            vlan_id: None,
            active: true,
        });

        let route = calculate_route(RouteRequest {
            graph,
            from_interface: "r1-eth0".into(),
            to_interface: "r3-eth0".into(),
            mode: RouteMode::RoutingTable,
            traffic: Some(TrafficSpec {
                protocol: "tcp".into(),
                port: Some(443),
                source: Some("10.0.0.1/24".into()),
                destination: Some("10.0.2.3/24".into()),
            }),
        })
        .unwrap();

        assert_ne!(route.status, RouteStatus::Reachable);
        assert_eq!(
            route.return_path.as_ref().map(|leg| leg.status.clone()),
            Some(RouteStatus::NoRoute)
        );
    }

    #[test]
    fn json_api_returns_success_response() {
        let request = RouteRequest {
            graph: sample_graph(),
            from_interface: "r1-eth0".into(),
            to_interface: "r3-eth0".into(),
            mode: RouteMode::ShortestPath,
            traffic: None,
        };
        let json = serde_json::to_string(&request).unwrap();
        let response: RouteResponse = serde_json::from_str(&calculate_route_json(&json)).unwrap();

        assert!(response.ok);
        assert_eq!(
            response.path,
            Some(vec!["r1-eth0".into(), "r2-eth0".into(), "r3-eth0".into()])
        );
        assert_eq!(response.status, Some(RouteStatus::Reachable));
        assert_eq!(
            response.forward.as_ref().map(|leg| leg.status.clone()),
            Some(RouteStatus::Reachable)
        );
        assert_eq!(
            response.return_path.as_ref().map(|leg| leg.status.clone()),
            Some(RouteStatus::Reachable)
        );
    }

    #[test]
    fn json_api_accepts_yaml_input() {
        let yaml = serde_yaml::to_string(&RouteRequest {
            graph: sample_graph(),
            from_interface: "r1-eth0".into(),
            to_interface: "r3-eth0".into(),
            mode: RouteMode::ShortestPath,
            traffic: None,
        })
        .unwrap();
        let response: RouteResponse = serde_json::from_str(&calculate_route_json(&yaml)).unwrap();

        assert!(response.ok);
        assert_eq!(
            response.path,
            Some(vec!["r1-eth0".into(), "r2-eth0".into(), "r3-eth0".into()])
        );
    }

    #[test]
    fn json_api_accepts_yang_interfaces_input() {
        let yaml = r#"
graph:
  nodes:
    - id: r1
    - id: r2
  interfaces:
    - node_id: r1
      interfaces:
        interface:
          - name: r1-eth0
            ipv4:
              address:
                - ip: 10.0.0.1
                  prefix_length: 24
    - node_id: r2
      interfaces:
        interface:
          - name: r2-eth0
            ipv4:
              address:
                - ip: 10.0.0.2
                  prefix_length: 24
  links:
    - id: l1
      from_interface: r1-eth0
      to_interface: r2-eth0
      cost: 10
      active: true
from_interface: r1-eth0
to_interface: r2-eth0
mode: shortest_path
"#;
        let response: RouteResponse = serde_json::from_str(&calculate_route_json(yaml)).unwrap();

        assert!(response.ok);
        assert_eq!(response.status, Some(RouteStatus::Reachable));
        assert_eq!(
            response.path,
            Some(vec!["r1-eth0".into(), "r2-eth0".into()])
        );
    }

    #[test]
    fn json_api_returns_invalid_input_for_bad_json() {
        let response: RouteResponse = serde_json::from_str(&calculate_route_json("{")).unwrap();

        assert!(!response.ok);
        assert_eq!(
            response.error.map(|error| error.code),
            Some(RouteErrorCode::InvalidInput)
        );
    }
}
