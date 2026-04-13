use std::collections::HashMap;

use crate::ip::{interface_ip, ipv4_network_matches};
use crate::{
    Graph, Interface, NatDirection, NatRule, NatType, Route, RouteError, RouteStatus, TrafficSpec,
};

pub(crate) fn apply_nat(
    graph: &Graph,
    route: &mut Route,
    traffic: Option<&TrafficSpec>,
) -> Result<(), RouteError> {
    if graph.nat_rules.is_empty() || route.status != RouteStatus::Reachable {
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
    let mut current_source = traffic.source.clone();
    let mut current_destination = traffic.destination.clone();

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

        apply_nat_for_interface(
            graph,
            route,
            traffic,
            &mut current_source,
            &mut current_destination,
            from_interface,
            NatDirection::Egress,
        );
        apply_nat_for_interface(
            graph,
            route,
            traffic,
            &mut current_source,
            &mut current_destination,
            to_interface,
            NatDirection::Ingress,
        );
    }

    Ok(())
}

fn to_pair<T>(window: &[T]) -> Option<[&T; 2]> {
    let [left, right] = window else {
        return None;
    };
    Some([left, right])
}

fn apply_nat_for_interface(
    graph: &Graph,
    route: &mut Route,
    traffic: &TrafficSpec,
    current_source: &mut Option<String>,
    current_destination: &mut Option<String>,
    interface: &Interface,
    direction: NatDirection,
) {
    let Some(rule) = graph
        .nat_rules
        .iter()
        .filter(|rule| !route.matched_nat_rule_ids.contains(&rule.id))
        .find(|rule| {
            nat_rule_matches(
                rule,
                traffic,
                current_source.as_deref(),
                current_destination.as_deref(),
                interface,
                &direction,
                graph,
            )
        })
    else {
        return;
    };

    route.matched_nat_rule_ids.push(rule.id.clone());
    match rule.nat_type {
        NatType::Source => {
            *current_source = Some(rule.translated.clone());
            route.translated_source = current_source.clone();
        }
        NatType::Destination => {
            *current_destination = Some(rule.translated.clone());
            route.translated_destination = current_destination.clone();
        }
    }
}

fn nat_rule_matches(
    rule: &NatRule,
    traffic: &TrafficSpec,
    current_source: Option<&str>,
    current_destination: Option<&str>,
    interface: &Interface,
    direction: &NatDirection,
    graph: &Graph,
) -> bool {
    if !rule.active || &rule.direction != direction || rule.node_id != interface.node_id {
        return false;
    }
    if rule
        .interface_id
        .as_deref()
        .is_some_and(|interface_id| interface_id != interface.id)
    {
        return false;
    }
    if rule
        .protocol
        .as_deref()
        .filter(|protocol| *protocol != "any")
        .is_some_and(|protocol| !protocol.eq_ignore_ascii_case(&traffic.protocol))
    {
        return false;
    }
    if rule.port.is_some() && rule.port != traffic.port {
        return false;
    }

    let address = match rule.nat_type {
        NatType::Source => current_source,
        NatType::Destination => current_destination,
    };
    endpoint_selector_matches(&rule.original, address, graph)
}

fn endpoint_selector_matches(selector: &str, address: Option<&str>, graph: &Graph) -> bool {
    if selector == "any" {
        return true;
    }

    let Some(address) = address else {
        return false;
    };
    let Some(ip) = interface_ip(address) else {
        return false;
    };

    if ipv4_network_matches(selector, ip) {
        return true;
    }

    graph.interfaces.iter().any(|interface| {
        (interface.id == selector || interface.node_id == selector)
            && interface
                .ip_address
                .as_deref()
                .and_then(interface_ip)
                .is_some_and(|interface_ip| interface_ip == ip)
    })
}
