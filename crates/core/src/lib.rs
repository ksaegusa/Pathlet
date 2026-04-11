use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

pub type AdjacencyList = HashMap<String, Vec<(String, u32)>>;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Node {
    pub id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct Interface {
    pub id: String,
    pub node_id: String,
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
pub struct Graph {
    pub nodes: Vec<Node>,
    pub interfaces: Vec<Interface>,
    pub links: Vec<Link>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RouteRequest {
    pub graph: Graph,
    pub from_interface: String,
    pub to_interface: String,
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
    pub error: Option<RouteError>,
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
                error: None,
            },
            Err(error) => Self {
                ok: false,
                path: None,
                equal_cost_paths: None,
                cost: None,
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
        return Err(RouteError::unreachable("no route found"));
    };
    let equal_cost_paths = reconstruct_paths(&previous, from_interface, to_interface);
    let Some(path) = equal_cost_paths.first().cloned() else {
        return Err(RouteError::unreachable("no route found"));
    };

    Ok(Route {
        path,
        equal_cost_paths,
        cost,
    })
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

    let adjacency = request.graph.adjacency_list()?;
    shortest_path(&adjacency, &request.from_interface, &request.to_interface)
}

pub fn calculate_route_json(input: &str) -> String {
    let response = match serde_json::from_str::<RouteRequest>(input) {
        Ok(request) => RouteResponse::from(calculate_route(request)),
        Err(error) => RouteResponse {
            ok: false,
            path: None,
            equal_cost_paths: None,
            cost: None,
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
                },
                Interface {
                    id: "r2-eth0".into(),
                    node_id: "r2".into(),
                },
                Interface {
                    id: "r2-eth1".into(),
                    node_id: "r2".into(),
                },
                Interface {
                    id: "r3-eth0".into(),
                    node_id: "r3".into(),
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

        let error = shortest_path(&adjacency, "r1-eth0", "r2-eth0").unwrap_err();
        assert_eq!(error.code, RouteErrorCode::Unreachable);
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
    fn json_api_returns_success_response() {
        let request = RouteRequest {
            graph: sample_graph(),
            from_interface: "r1-eth0".into(),
            to_interface: "r3-eth0".into(),
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
