use axum::{extract::ConnectInfo, http::HeaderMap};
use std::net::{IpAddr, SocketAddr};
use std::sync::OnceLock;

fn parse_forwarded_for(headers: &HeaderMap) -> Option<IpAddr> {
    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        // Myriad proxy rewrites XFF to a single resolved client IP. Prefer the
        // rightmost hop if a chain is still present (closest to our edge).
        .and_then(|value| {
            value
                .split(',')
                .rev()
                .find_map(|entry| entry.trim().parse::<IpAddr>().ok())
        })
}

fn parse_real_ip(headers: &HeaderMap) -> Option<IpAddr> {
    headers
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<IpAddr>().ok())
}

pub fn trusted_proxy_headers_enabled() -> bool {
    std::env::var("TRUST_PROXY_HEADERS")
        .ok()
        .is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
}

/// Parse a comma/space-separated list of CIDR prefixes or bare IPs.
///
/// Bare IPs become `/32` (v4) or `/128` (v6). Invalid tokens are skipped.
pub fn parse_proxy_peer_allowlist(raw: &str) -> Vec<ipnet::IpNet> {
    raw.split(|c: char| c == ',' || c.is_whitespace())
        .filter(|s| !s.is_empty())
        .filter_map(|token| {
            let token = token.trim();
            if token.contains('/') {
                token.parse::<ipnet::IpNet>().ok()
            } else {
                token
                    .parse::<IpAddr>()
                    .ok()
                    .map(ipnet::IpNet::from)
            }
        })
        .collect()
}

/// Env: `TRUST_PROXY_PEERS` — CIDR/IP allowlist of reverse-proxy TCP peers.
/// Empty/missing ⇒ no peer is trusted for XFF/X-Real-IP (even if TRUST_PROXY_HEADERS=1).
pub fn trusted_proxy_peer_allowlist() -> &'static [ipnet::IpNet] {
    static ALLOWLIST: OnceLock<Vec<ipnet::IpNet>> = OnceLock::new();
    ALLOWLIST
        .get_or_init(|| {
            std::env::var("TRUST_PROXY_PEERS")
                .ok()
                .map(|s| parse_proxy_peer_allowlist(&s))
                .unwrap_or_default()
        })
        .as_slice()
}

/// True when `peer` is inside any prefix of `allowlist`.
pub fn peer_in_proxy_allowlist(peer: IpAddr, allowlist: &[ipnet::IpNet]) -> bool {
    allowlist.iter().any(|net| net.contains(&peer))
}

/// Pure trust decision: honor forwarded headers only when trust is enabled **and**
/// the TCP peer is on the allowlist. Empty allowlist never trusts headers.
pub fn should_trust_proxy_headers(
    peer_ip: Option<IpAddr>,
    trust_proxy_headers: bool,
    allowlist: &[ipnet::IpNet],
) -> bool {
    if !trust_proxy_headers {
        return false;
    }
    if allowlist.is_empty() {
        return false;
    }
    peer_ip
        .map(|ip| peer_in_proxy_allowlist(ip, allowlist))
        .unwrap_or(false)
}

pub fn client_ip_from_parts(
    headers: &HeaderMap,
    peer_ip: Option<IpAddr>,
    trust_proxy_headers: bool,
) -> Option<IpAddr> {
    client_ip_from_parts_with_allowlist(
        headers,
        peer_ip,
        trust_proxy_headers,
        // Production path: env-backed allowlist. Empty ⇒ never trust XFF.
        trusted_proxy_peer_allowlist(),
    )
}

/// Testable core: same as production wiring with an explicit allowlist.
pub fn client_ip_from_parts_with_allowlist(
    headers: &HeaderMap,
    peer_ip: Option<IpAddr>,
    trust_proxy_headers: bool,
    allowlist: &[ipnet::IpNet],
) -> Option<IpAddr> {
    if should_trust_proxy_headers(peer_ip, trust_proxy_headers, allowlist) {
        // Prefer X-Real-IP: the Myriad proxy sets a single resolved client IP there.
        // Then XFF, then the TCP peer (usually the docker network address of proxy).
        parse_real_ip(headers)
            .or_else(|| parse_forwarded_for(headers))
            .or(peer_ip)
    } else {
        peer_ip
    }
}

pub fn extract_client_ip(request: &axum::extract::Request) -> Option<IpAddr> {
    let peer_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(address)| address.ip());
    client_ip_from_parts(request.headers(), peer_ip, trusted_proxy_headers_enabled())
}

/// True when a net is a full private supernet commonly used as a compose default
/// (too wide for production: any RFC1918 host could forge XFF if it reaches backend).
pub fn is_broad_private_supernet(net: &ipnet::IpNet) -> bool {
    match net {
        ipnet::IpNet::V4(n) => {
            let p = n.prefix_len();
            let net_ip = n.network();
            // Entire 10/8, 172.16/12, or 192.168/16
            (net_ip.octets()[0] == 10 && p <= 8)
                || (net_ip.octets()[0] == 172
                    && (16..=31).contains(&net_ip.octets()[1])
                    && p <= 12)
                || (net_ip.octets()[0] == 192 && net_ip.octets()[1] == 168 && p <= 16)
        }
        ipnet::IpNet::V6(_) => false,
    }
}

/// Log once at startup when proxy trust is enabled with an over-broad peer allowlist.
/// Compose defaults to all RFC1918 for convenience; production should pin to the
/// reverse-proxy network only.
pub fn log_proxy_trust_hygiene() {
    if !trusted_proxy_headers_enabled() {
        return;
    }
    let allowlist = trusted_proxy_peer_allowlist();
    if allowlist.is_empty() {
        tracing::warn!(
            "TRUST_PROXY_HEADERS is enabled but TRUST_PROXY_PEERS is empty — \
             forwarded headers are ignored (fail-closed). Set TRUST_PROXY_PEERS to \
             your reverse-proxy CIDR (e.g. the Docker network of the proxy service)."
        );
        return;
    }
    let broad: Vec<String> = allowlist
        .iter()
        .filter(|n| is_broad_private_supernet(n))
        .map(|n| n.to_string())
        .collect();
    if !broad.is_empty() {
        tracing::warn!(
            peers = %broad.join(", "),
            "TRUST_PROXY_PEERS includes broad private supernet(s). Any host on those \
             ranges that can reach the backend may forge X-Forwarded-For / X-Real-IP. \
             Prefer the reverse-proxy container network only (see docker-compose \
             comments and docs/deployment/DOCKER_DEPLOYMENT.md)."
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn net(s: &str) -> ipnet::IpNet {
        s.parse().unwrap()
    }

    #[test]
    fn ignores_forwarded_headers_unless_proxy_trust_is_enabled() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.10, 198.51.100.4"),
        );
        let peer = "192.0.2.7".parse().unwrap();
        let allow = [net("192.0.2.0/24")];

        assert_eq!(
            client_ip_from_parts_with_allowlist(&headers, Some(peer), false, &allow),
            Some(peer)
        );
    }

    #[test]
    fn empty_allowlist_never_trusts_forwarded_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", HeaderValue::from_static("203.0.113.50"));
        let peer = "10.0.0.2".parse().unwrap();

        // TRUST on but allowlist empty → ignore forged headers
        assert_eq!(
            client_ip_from_parts_with_allowlist(&headers, Some(peer), true, &[]),
            Some(peer)
        );
        assert!(!should_trust_proxy_headers(Some(peer), true, &[]));
    }

    #[test]
    fn detects_broad_rfc1918_supernets() {
        assert!(is_broad_private_supernet(&net("10.0.0.0/8")));
        assert!(is_broad_private_supernet(&net("172.16.0.0/12")));
        assert!(is_broad_private_supernet(&net("192.168.0.0/16")));
        // Tighter docker-bridge style ranges are OK
        assert!(!is_broad_private_supernet(&net("172.18.0.0/16")));
        assert!(!is_broad_private_supernet(&net("10.0.1.0/24")));
        assert!(!is_broad_private_supernet(&net("192.168.1.0/24")));
    }

    #[test]
    fn peer_outside_allowlist_ignores_forged_xff() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.10, 198.51.100.4"),
        );
        let peer = "192.0.2.7".parse().unwrap();
        let allow = [net("10.0.0.0/8")];

        assert_eq!(
            client_ip_from_parts_with_allowlist(&headers, Some(peer), true, &allow),
            Some(peer)
        );
    }

    #[test]
    fn peer_inside_allowlist_with_trust_uses_forwarded_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.10, 198.51.100.4"),
        );
        let peer = "10.0.0.2".parse().unwrap();
        let allow = [net("10.0.0.0/8"), net("172.16.0.0/12")];

        assert_eq!(
            client_ip_from_parts_with_allowlist(&headers, Some(peer), true, &allow),
            Some("198.51.100.4".parse().unwrap())
        );
    }

    #[test]
    fn trusted_proxy_prefers_x_real_ip_over_xff() {
        let mut headers = HeaderMap::new();
        headers.insert("x-real-ip", HeaderValue::from_static("203.0.113.50"));
        headers.insert("x-forwarded-for", HeaderValue::from_static("198.51.100.4"));
        let peer = "10.0.0.2".parse().unwrap();
        let allow = [net("10.0.0.0/8")];

        assert_eq!(
            client_ip_from_parts_with_allowlist(&headers, Some(peer), true, &allow),
            Some("203.0.113.50".parse().unwrap())
        );
    }

    #[test]
    fn trusted_proxy_falls_back_to_peer_without_headers() {
        let headers = HeaderMap::new();
        let peer = "10.0.0.2".parse().unwrap();
        let allow = [net("10.0.0.0/8")];

        assert_eq!(
            client_ip_from_parts_with_allowlist(&headers, Some(peer), true, &allow),
            Some(peer)
        );
    }

    #[test]
    fn trusted_proxy_skips_malformed_xff_tokens() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("not-an-ip, 203.0.113.10"),
        );
        let peer = "10.0.0.2".parse().unwrap();
        let allow = [net("10.0.0.0/8")];

        assert_eq!(
            client_ip_from_parts_with_allowlist(&headers, Some(peer), true, &allow),
            Some("203.0.113.10".parse().unwrap())
        );
    }

    #[test]
    fn parse_allowlist_accepts_cidr_and_bare_ip() {
        let nets = parse_proxy_peer_allowlist("10.0.0.0/8, 192.0.2.1, not-valid 172.16.0.0/12");
        assert_eq!(nets.len(), 3);
        assert!(peer_in_proxy_allowlist("10.1.2.3".parse().unwrap(), &nets));
        assert!(peer_in_proxy_allowlist("192.0.2.1".parse().unwrap(), &nets));
        assert!(!peer_in_proxy_allowlist("192.0.2.2".parse().unwrap(), &nets));
        assert!(peer_in_proxy_allowlist("172.16.5.5".parse().unwrap(), &nets));
    }
}
