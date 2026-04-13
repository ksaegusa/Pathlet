use std::collections::HashMap;

use crate::ip::{interface_ip, ipv4_network_matches};
use crate::{
    Graph, Interface, Route, RouteError, RouteStatus, TrafficSpec, YangAce, YangForwardingAction,
    YangTransportMatch,
};

pub(crate) fn apply_policy(
    graph: &Graph,
    route: &mut Route,
    traffic: Option<&TrafficSpec>,
) -> Result<(), RouteError> {
    if graph.acls.is_empty()
        || graph.acl_attachments.is_empty()
        || route.status != RouteStatus::Reachable
    {
        return Ok(());
    }

    let Some(traffic) = traffic else {
        return Ok(());
    };

    let interface_by_id = graph
        .interfaces
        .iter()
        .map(|interface| (interface.id.as_str(), interface))
        .collect::<HashMap<_, _>>();

    let path_pairs = route
        .path
        .windows(2)
        .filter_map(to_pair)
        .map(|[from_interface_id, to_interface_id]| {
            (from_interface_id.clone(), to_interface_id.clone())
        })
        .collect::<Vec<_>>();

    for (from_interface_id, to_interface_id) in path_pairs {
        let from_interface_id = from_interface_id.as_str();
        let to_interface_id = to_interface_id.as_str();
        let Some(_link) = graph.links.iter().find(|link| {
            (link.from_interface == from_interface_id && link.to_interface == to_interface_id)
                || (link.from_interface == to_interface_id
                    && link.to_interface == from_interface_id)
        }) else {
            continue;
        };
        let from_interface = interface_by_id.get(from_interface_id).ok_or_else(|| {
            RouteError::invalid_input(format!(
                "path references missing interface '{from_interface_id}'"
            ))
        })?;
        let to_interface = interface_by_id.get(to_interface_id).ok_or_else(|| {
            RouteError::invalid_input(format!(
                "path references missing interface '{to_interface_id}'"
            ))
        })?;

        if let Some(denied_policy_id) =
            denied_policy_for_interface(graph, traffic, from_interface, "egress")
        {
            route.status = RouteStatus::PolicyDenied;
            route.matched_policy_ids.push(denied_policy_id);
            return Ok(());
        }
        if let Some(denied_policy_id) =
            denied_policy_for_interface(graph, traffic, to_interface, "ingress")
        {
            route.status = RouteStatus::PolicyDenied;
            route.matched_policy_ids.push(denied_policy_id);
            return Ok(());
        }
    }

    Ok(())
}

fn to_pair<T>(window: &[T]) -> Option<[&T; 2]> {
    let [left, right] = window else {
        return None;
    };
    Some([left, right])
}

fn denied_policy_for_interface(
    graph: &Graph,
    traffic: &TrafficSpec,
    interface: &Interface,
    direction: &str,
) -> Option<String> {
    let acl_by_name = graph
        .acls
        .iter()
        .map(|acl| (acl.name.as_str(), acl))
        .collect::<HashMap<_, _>>();

    graph
        .acl_attachments
        .iter()
        .filter(|attachment| attachment.node_id == interface.node_id)
        .filter(|attachment| {
            attachment
                .interface_id
                .as_deref()
                .is_none_or(|interface_id| interface_id == interface.id)
        })
        .find_map(|attachment| {
            let acl_names = if direction == "ingress" {
                &attachment.ingress
            } else {
                &attachment.egress
            };

            acl_names.iter().find_map(|acl_name| {
                let acl = acl_by_name.get(acl_name.as_str())?;
                acl.aces
                    .iter()
                    .filter(|ace| ace.active)
                    .find(|ace| ace_matches_traffic(ace, traffic))
                    .and_then(|ace| {
                        (ace.actions.forwarding == YangForwardingAction::Drop).then(|| {
                            format!(
                                "{}::{}::{direction}::{acl_name}::{}",
                                attachment.node_id,
                                attachment.interface_id.as_deref().unwrap_or("node"),
                                ace.name
                            )
                        })
                    })
            })
        })
}

fn ace_matches_traffic(ace: &YangAce, traffic: &TrafficSpec) -> bool {
    let protocol = traffic.protocol.to_ascii_lowercase();

    if ace.matches.icmp.is_some() && protocol != "icmp" {
        return false;
    }
    if let Some(tcp) = &ace.matches.tcp
        && (protocol != "tcp" || !transport_match(tcp, traffic.port))
    {
        return false;
    }
    if let Some(udp) = &ace.matches.udp
        && (protocol != "udp" || !transport_match(udp, traffic.port))
    {
        return false;
    }
    if let Some(ipv4) = &ace.matches.ipv4 {
        if let Some(source_network) = &ipv4.source_ipv4_network {
            let Some(source) = traffic.source.as_deref().and_then(interface_ip) else {
                return false;
            };
            if !ipv4_network_matches(source_network, source) {
                return false;
            }
        }
        if let Some(destination_network) = &ipv4.destination_ipv4_network {
            let Some(destination) = traffic.destination.as_deref().and_then(interface_ip) else {
                return false;
            };
            if !ipv4_network_matches(destination_network, destination) {
                return false;
            }
        }
    }

    true
}

fn transport_match(match_item: &YangTransportMatch, port: Option<u16>) -> bool {
    match &match_item.destination_port {
        Some(destination_port) if destination_port.operator == "eq" => {
            port == Some(destination_port.port)
        }
        Some(_) => false,
        None => true,
    }
}
