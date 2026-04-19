use crate::ip::{interface_ip, ipv4_network_matches};
use crate::{Graph, Interface, NatDirection, NatRule, NatType, PacketState, TrafficSpec};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NatState {
    pub rule_id: String,
    pub nat_type: NatType,
    pub original: String,
    pub translated: String,
}

pub(crate) fn apply_nat_stage(
    graph: &Graph,
    packet: &mut PacketState,
    interface: &Interface,
    direction: NatDirection,
    nat_type: NatType,
    already_matched_rule_ids: &[String],
) -> Option<NatState> {
    let traffic = packet.to_traffic_spec();
    let rule = graph
        .nat_rules
        .iter()
        .filter(|rule| !already_matched_rule_ids.contains(&rule.id))
        .find(|rule| {
            rule.nat_type == nat_type
                && nat_rule_matches(
                    rule,
                    &traffic,
                    packet.source.as_deref(),
                    packet.destination.as_deref(),
                    interface,
                    &direction,
                    graph,
                )
        })?;

    let original = match rule.nat_type {
        NatType::Source => packet.source.clone(),
        NatType::Destination => packet.destination.clone(),
    }
    .unwrap_or_else(|| rule.original.clone());

    let state = NatState {
        rule_id: rule.id.clone(),
        nat_type: rule.nat_type.clone(),
        original,
        translated: rule.translated.clone(),
    };
    match rule.nat_type {
        NatType::Source => packet.source = Some(rule.translated.clone()),
        NatType::Destination => packet.destination = Some(rule.translated.clone()),
    }
    Some(state)
}

pub(crate) fn apply_reverse_nat_state(packet: &mut PacketState, state: &NatState) {
    match state.nat_type {
        NatType::Source => {
            if packet.destination.as_deref() == Some(state.translated.as_str()) {
                packet.destination = Some(state.original.clone());
            }
        }
        NatType::Destination => {
            if packet.source.as_deref() == Some(state.translated.as_str()) {
                packet.source = Some(state.original.clone());
            }
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
