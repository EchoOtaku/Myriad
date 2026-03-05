// 网易云音乐 API 工具函数
// 提供 IP 伪装、User-Agent 生成等防封技术

use rand::Rng;

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
        // Android + Chrome
        "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 11; M2007J3SC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
        // iOS + Safari
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        // 网易云音乐官方客户端
        "Mozilla/5.0 (Linux; Android 11; M2007J3SC Build/RKQ1.200826.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/77.0.3865.120 MQQBrowser/6.2 TBS/045714 Mobile Safari/537.36 NeteaseMusic/8.7.01",
        "Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.036; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Mobile Safari/537.36 NeteaseMusic/8.8.50",
    ];

    user_agents[rng.random_range(0..user_agents.len())]
}

/// 将音乐数据中的 HTTP 图片 URL 转换为 HTTPS
/// 递归处理 JSON 对象和数组，避免 Mixed Content 警告
pub fn convert_http_to_https(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(s) => {
            // 将网易云音乐 CDN 的 HTTP 链接替换为 HTTPS
            if s.starts_with("http://")
                && (s.contains("music.126.net") || s.contains("music.163.com"))
            {
                *s = s.replace("http://", "https://");
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                convert_http_to_https(item);
            }
        }
        serde_json::Value::Object(obj) => {
            for (_, v) in obj.iter_mut() {
                convert_http_to_https(v);
            }
        }
        _ => {}
    }
}
