use std::net::Ipv4Addr;

pub(crate) fn ipv4_network_matches(network: &str, ip: Ipv4Addr) -> bool {
    if network == "any" {
        return true;
    }
    if network.contains('/') {
        return ipv4_prefix_match(network, ip).is_some();
    }
    if let Some(network_ip) = interface_ip(network) {
        return network_ip == ip;
    }
    false
}

pub(crate) fn interface_ip(value: &str) -> Option<Ipv4Addr> {
    value.split('/').next()?.parse().ok()
}

pub(crate) fn ipv4_prefix_match(cidr: &str, target_ip: Ipv4Addr) -> Option<u8> {
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
