//! Bilibili IP/UA/cookie helpers for anti-block fetchers.

// Bilibili API 工具函数
// 提供 IP 伪装、User-Agent 生成等防封技术
// 参考网易云音乐的防封策略

use rand::RngExt;

/// 生成随机设备ID (模拟Android设备)
pub fn generate_device_id() -> String {
    let mut rng = rand::rng();
    let bytes: Vec<u8> = (0..16).map(|_| rng.random()).collect();
    bytes.iter().map(|b| format!("{:02X}", b)).collect()
}

/// 生成随机的中国大陆 IP 地址
/// 使用真实的中国电信/联通/移动的 IP 段，增强真实性
pub fn get_random_china_ip() -> String {
    let mut rng = rand::rng();

    // 中国大陆主流运营商的真实 IP 段（部分示例）
    let china_ip_ranges = [
        // 中国电信
        ("58.20", 0..255, 0..255),
        ("58.21", 0..255, 0..255),
        ("58.22", 0..255, 0..255),
        ("59.41", 0..255, 0..255),
        ("60.12", 0..255, 0..255),
        ("60.13", 0..255, 0..255),
        ("61.128", 0..255, 0..255),
        ("61.129", 0..255, 0..255),
        ("116.21", 0..255, 0..255),
        ("116.22", 0..255, 0..255),
        ("116.23", 0..255, 0..255),
        ("218.4", 0..255, 0..255),
        ("218.5", 0..255, 0..255),
        ("218.6", 0..255, 0..255),
        // 中国联通
        ("112.24", 0..255, 0..255),
        ("112.25", 0..255, 0..255),
        ("112.26", 0..255, 0..255),
        ("112.27", 0..255, 0..255),
        ("113.12", 0..255, 0..255),
        ("113.13", 0..255, 0..255),
        ("124.160", 0..255, 0..255),
        ("124.161", 0..255, 0..255),
        ("221.192", 0..255, 0..255),
        ("221.193", 0..255, 0..255),
        // 中国移动
        ("111.13", 0..255, 0..255),
        ("111.19", 0..255, 0..255),
        ("111.20", 0..255, 0..255),
        ("111.40", 0..255, 0..255),
        ("117.131", 0..255, 0..255),
        ("117.132", 0..255, 0..255),
        ("117.136", 0..255, 0..255),
        ("223.64", 0..255, 0..255),
        ("223.72", 0..255, 0..255),
        ("223.73", 0..255, 0..255),
    ];

    let (prefix, range2, range3) = &china_ip_ranges[rng.random_range(0..china_ip_ranges.len())];
    let third = rng.random_range(range2.clone());
    let fourth = rng.random_range(range3.clone());

    format!("{}.{}.{}", prefix, third, fourth)
}

/// 获取随机 User-Agent（模拟不同设备和浏览器）
/// 降低被识别为爬虫的风险
pub fn get_random_user_agent() -> &'static str {
    let mut rng = rand::rng();
    let user_agents = [
        // 桌面浏览器 - Chrome
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        // 桌面浏览器 - Firefox
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
        // 桌面浏览器 - Edge
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
        // Android + Chrome
        "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 11; M2007J3SC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
        // iOS + Safari
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
        // Bilibili 官方客户端
        "Mozilla/5.0 (Linux; Android 11; M2007J3SC Build/RKQ1.200826.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Mobile Safari/537.36 BiliApp/6.78.0",
        "Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.036; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Mobile Safari/537.36 BiliApp/6.80.0",
    ];

    user_agents[rng.random_range(0..user_agents.len())]
}

/// 生成随机的 buvid3 (Bilibili User Video ID)
/// 用于模拟真实用户身份
pub fn generate_buvid3() -> String {
    let mut rng = rand::rng();
    let chars: Vec<char> = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
        .chars()
        .collect();

    let random_part: String = (0..32)
        .map(|_| chars[rng.random_range(0..chars.len())])
        .collect();

    random_part
}

/// 生成 Bilibili Cookie
/// 包含必要的设备标识和会话信息
pub fn generate_bilibili_cookie() -> String {
    let device_id = generate_device_id();
    let buvid3 = generate_buvid3();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    format!(
        "buvid3={}; CURRENT_FNVAL=4048; CURRENT_QUALITY=80; b_nut={}; _uuid={}; DedeUserID=0; DedeUserID__ckMd5=0; SESSDATA=",
        buvid3,
        timestamp,
        device_id
    )
}
