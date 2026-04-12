use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};
use std::net::Ipv4Addr;

pub type AdjacencyList = HashMap<String, Vec<(String, u32)>>;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Node {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Interface {
    pub id: String,
    pub node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip_address: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Link {
    pub id: String,
    pub from_interface: String,
    pub to_interface: String,
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
pub struct Graph {
    pub nodes: Vec<Node>,
    pub interfaces: Vec<Interface>,
    pub links: Vec<Link>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<RouteEntry>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouteRequest {
    pub graph: Graph,
    pub from_interface: String,
    pub to_interface: String,
    #[serde(default)]
    pub mode: RouteMode,
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
    pub loop_link_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RouteError>,
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
    pub loop_link_ids: Vec<String>,
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

        for route in &self.routes {
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

        Ok(())
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

    match request.mode {
        RouteMode::ShortestPath => {
            let adjacency = request.graph.adjacency_list()?;
            shortest_path(&adjacency, &request.from_interface, &request.to_interface)
        }
        RouteMode::RoutingTable => routing_table_path(
            &request.graph,
            &request.from_interface,
            &request.to_interface,
        ),
    }
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
    let mut current_node_id = from.node_id.as_str();
    let mut path = vec![from_interface.to_string()];
    let mut matched_route_ids = Vec::new();
    let mut loop_link_ids = Vec::new();
    let mut visited_nodes = HashMap::<String, usize>::from([(current_node_id.to_string(), 0)]);
    let mut cost = 0_u32;
    let hop_limit = graph.nodes.len().saturating_mul(4).max(16);

    for _ in 0..hop_limit {
        if current_node_id == target_node_id {
            append_interface_hop(&mut path, to_interface);
            return Ok(Route {
                path: path.clone(),
                equal_cost_paths: vec![path],
                cost,
                status: RouteStatus::Reachable,
                matched_route_ids,
                loop_link_ids,
            });
        }

        let selected =
            if let Some(link) = direct_link_to_node(graph, current_node_id, target_node_id) {
                Some((None, link))
            } else {
                let Some(route) = best_route_for_node(
                    graph,
                    current_node_id,
                    target_node_id,
                    to_interface,
                    target_ip,
                ) else {
                    return Ok(Route {
                        path: path.clone(),
                        equal_cost_paths: vec![path],
                        cost,
                        status: RouteStatus::NoRoute,
                        matched_route_ids,
                        loop_link_ids,
                    });
                };
                let Some(link) = resolve_route_link(graph, route) else {
                    matched_route_ids.push(route.id.clone());
                    return Ok(Route {
                        path: path.clone(),
                        equal_cost_paths: vec![path],
                        cost,
                        status: RouteStatus::Blackhole,
                        matched_route_ids,
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
        loop_link_ids,
    })
}

fn best_route_for_node<'a>(
    graph: &'a Graph,
    node_id: &str,
    target_node_id: &str,
    target_interface_id: &str,
    target_ip: Option<Ipv4Addr>,
) -> Option<&'a RouteEntry> {
    graph
        .routes
        .iter()
        .filter(|route| route.active && route.node_id == node_id)
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
        if let Some(route_ip) = interface_ip(&route.destination) {
            if route_ip == target_ip {
                return Some(128);
            }
        }
        if let Some(prefix_len) = ipv4_prefix_match(&route.destination, target_ip) {
            return Some(prefix_len);
        }
    }

    (route.destination == "0.0.0.0/0").then_some(0)
}

fn resolve_route_link<'a>(graph: &'a Graph, route: &RouteEntry) -> Option<&'a Link> {
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
            );
        }
    }

    route
        .egress_interface
        .as_deref()
        .and_then(|egress_interface| {
            active_links_from_node(graph, &route.node_id)
                .into_iter()
                .find(|link| link_uses_interface(link, egress_interface))
        })
}

fn direct_link_to_node<'a>(
    graph: &'a Graph,
    from_node_id: &str,
    to_node_id: &str,
) -> Option<&'a Link> {
    active_link_between_nodes(graph, from_node_id, to_node_id, None)
}

fn active_link_between_nodes<'a>(
    graph: &'a Graph,
    from_node_id: &str,
    to_node_id: &str,
    egress_interface: Option<&str>,
) -> Option<&'a Link> {
    active_links_from_node(graph, from_node_id)
        .into_iter()
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

fn interface_ip(value: &str) -> Option<Ipv4Addr> {
    value.split('/').next()?.parse().ok()
}

fn ipv4_prefix_match(cidr: &str, target_ip: Ipv4Addr) -> Option<u8> {
    let (network, prefix_len) = cidr.split_once('/')?;
    let network = network.parse::<Ipv4Addr>().ok()?;
    let prefix_len = prefix_len.parse::<u8>().ok()?;
    if prefix_len > 32 {
        return None;
    }
    let mask = if prefix_len == 0 {
        0
    } else {
        u32::MAX << (32 - prefix_len)
    };
    ((u32::from(network) & mask) == (u32::from(target_ip) & mask)).then_some(prefix_len)
}

pub fn calculate_route_json(input: &str) -> String {
    let response = match serde_json::from_str::<RouteRequest>(input) {
        Ok(request) => RouteResponse::from(calculate_route(request)),
        Err(error) => RouteResponse {
            ok: false,
            path: None,
            equal_cost_paths: None,
            cost: None,
            status: None,
            matched_route_ids: None,
            loop_link_ids: None,
            error: Some(RouteError::invalid_input(format!(
                "invalid JSON route request: {error}"
            ))),
        },
    };

    serde_json::to_string(&response).expect("route response should always serialize")
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
                Node { id: "r1".into() },
                Node { id: "r2".into() },
                Node { id: "r3".into() },
            ],
            interfaces: vec![
                Interface {
                    id: "r1-eth0".into(),
                    node_id: "r1".into(),
                    ip_address: Some("10.0.0.1/24".into()),
                },
                Interface {
                    id: "r2-eth0".into(),
                    node_id: "r2".into(),
                    ip_address: Some("10.0.0.2/24".into()),
                },
                Interface {
                    id: "r2-eth1".into(),
                    node_id: "r2".into(),
                    ip_address: Some("10.0.1.2/24".into()),
                },
                Interface {
                    id: "r3-eth0".into(),
                    node_id: "r3".into(),
                    ip_address: Some("10.0.2.3/24".into()),
                },
            ],
            links: vec![
                Link {
                    id: "l1".into(),
                    from_interface: "r1-eth0".into(),
                    to_interface: "r2-eth0".into(),
                    cost: 10,
                    active: true,
                },
                Link {
                    id: "l2".into(),
                    from_interface: "r2-eth0".into(),
                    to_interface: "r3-eth0".into(),
                    cost: 5,
                    active: true,
                },
                Link {
                    id: "l3".into(),
                    from_interface: "r1-eth0".into(),
                    to_interface: "r3-eth0".into(),
                    cost: 100,
                    active: true,
                },
                Link {
                    id: "down".into(),
                    from_interface: "r2-eth1".into(),
                    to_interface: "r3-eth0".into(),
                    cost: 1,
                    active: false,
                },
            ],
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
    fn json_api_returns_success_response() {
        let request = RouteRequest {
            graph: sample_graph(),
            from_interface: "r1-eth0".into(),
            to_interface: "r3-eth0".into(),
            mode: RouteMode::ShortestPath,
        };
        let json = serde_json::to_string(&request).unwrap();
        let response: RouteResponse = serde_json::from_str(&calculate_route_json(&json)).unwrap();

        assert_eq!(
            response,
            RouteResponse {
                ok: true,
                path: Some(vec!["r1-eth0".into(), "r2-eth0".into(), "r3-eth0".into()]),
                equal_cost_paths: Some(vec![vec![
                    "r1-eth0".into(),
                    "r2-eth0".into(),
                    "r3-eth0".into()
                ]]),
                cost: Some(15),
                status: Some(RouteStatus::Reachable),
                matched_route_ids: Some(vec![]),
                loop_link_ids: Some(vec![]),
                error: None,
            }
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
