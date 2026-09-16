//! Edits are returned inline; only explicit confirmation persists a new asset.

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reference_paths_cannot_escape_federation_storage() {
        assert!(federation_reference_path("/media/federation/1/picture.png").is_some());
        for path in ["/media/federation/../secret", "/media/federation/1/../../secret", "https://example.org/a.png", "/media/federation/1/%2e%2e", "/media/federation/1/a/b"] {
            assert!(federation_reference_path(path).is_none(), "{path}");
        }
    }
    #[test]
    fn rejects_blank_prompts_and_unbounded_generation_dimensions() {
        assert!(validate_edit_request("  ", 1024, 1024).is_err());
        assert!(validate_edit_request("edit", 0, 1024).is_err());
        assert!(validate_edit_request("edit", 8192, 8192).is_err());
        assert!(validate_edit_request("edit", 1024, 1024).is_ok());
    }
}
