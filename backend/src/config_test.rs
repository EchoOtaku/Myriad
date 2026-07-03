#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_config_defaults() {
        std::env::set_var("DATABASE_URL", "postgres://test:test@localhost/test");
        let config = AppConfig::from_env().unwrap();
        assert!(!config.database_url.is_empty());
        assert_eq!(config.server_port, 1103);
    }
}
