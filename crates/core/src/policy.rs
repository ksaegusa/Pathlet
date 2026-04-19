use std::collections::HashMap;

use crate::ip::{interface_ip, ipv4_network_matches};
use crate::{Graph, Interface, TrafficSpec, YangAce, YangForwardingAction, YangTransportMatch};

pub(crate) fn denied_policy_for_interface(
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
