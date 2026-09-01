//! Pure resource-resolution plans for *installed* Tapp packages.
//!
//! HTTP handlers keep visibility/auth and filesystem IO. This module owns how
//! a stored manifest JSON maps to relative paths the reader should attempt.

use myriad_tapp_contract::manifest::TappManifest;

/// 宿主预编译 Tailwind 产物的固定路径（契约：与作者层样式并行）。
pub use myriad_tapp_contract::contract_rules::{HOST_PAGE_CSS, HOST_WIDGET_CSS};
pub use myriad_tapp_rules::{
    filter_widget_paths, installed_core_entry, installed_layer_entries, installed_page_entry,
    installed_text_resource_plan, installed_widget_ids, installed_widget_layer_paths,
    installed_widget_template_paths, manifest_declares_core, manifest_declares_page,
    manifest_declares_widgets, require_known_widget_id, InstalledTextResourcePlan,
    InstalledWidgetTemplatePath, UnknownWidgetId,
};

/// Whether `path` is declared in a typed manifest's `assets` list.
///
/// For payloads already validated against the current contract. Serving
/// installed packages must use [`installed_manifest_declares_asset`], which
/// reads by key and cannot fail on a manifest from another contract version.
#[allow(dead_code)] // 仅测试调用：本仓无生产调用点（编译器已核）。
pub fn manifest_declares_asset(manifest: &TappManifest, path: &str) -> bool {
    manifest
        .assets
        .as_ref()
        .is_some_and(|declared| declared.iter().any(|entry| entry == path))
}

/// Whether `path` is declared in a stored manifest JSON's `assets` list.
///
/// Reads by key like the rest of the serve path, so a manifest shaped for a
/// different contract version degrades to "not declared" instead of failing
/// deserialization and surfacing as a 500.
pub fn installed_manifest_declares_asset(manifest: &serde_json::Value, path: &str) -> bool {
    manifest
        .get("assets")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|declared| {
            declared
                .iter()
                .filter_map(serde_json::Value::as_str)
                .any(|entry| entry == path)
        })
}

/// Whether an asset byte length is within the single-file install limit.
pub fn asset_bytes_within_limit(size: u64, max_bytes: u64) -> bool {
    size <= max_bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn layerless_manifest_declares_no_author_styles() {
        let plan = installed_text_resource_plan(&json!({}));
        assert!(plan.core_styles.is_none());
        assert!(plan.page_styles.is_none());
        assert!(plan.widget_styles.is_empty());
        assert!(plan.page_template.is_none());
    }

    /// 作者样式来自层声明；宿主预编译产物走固定路径，不参与这份计划。
    #[test]
    fn author_styles_come_from_layer_declarations() {
        let plan = installed_text_resource_plan(&json!({
            "core": { "entry": "core.js", "styles": "shared.css" },
            "page": { "entry": "page/index.js", "template": "shell.html", "styles": "p.css" },
            "widgets": [{ "id": "card", "entry": "widget.js", "styles": "w.css" }]
        }));
        assert_eq!(plan.core_styles.as_deref(), Some("shared.css"));
        assert_eq!(plan.page_styles.as_deref(), Some("p.css"));
        assert_eq!(
            plan.widget_styles,
            vec![("card".to_string(), "w.css".to_string())]
        );
        assert_eq!(plan.page_template.as_deref(), Some("shell.html"));
        // 宿主产物在独立目录，作者可以放心把层样式命名成 page.css / widget.css
        assert_eq!(HOST_WIDGET_CSS, "host/widget.css");
        assert_eq!(HOST_PAGE_CSS, "host/page.css");
    }

    #[test]
    fn layer_entries_follow_core_page_widget_order() {
        let manifest = json!({
            "core": { "entry": "core.js" },
            "page": { "entry": "page/index.js" },
            "widgets": [{ "id": "card", "entry": "widget.js" }]
        });
        assert_eq!(installed_core_entry(&manifest).as_deref(), Some("core.js"));
        assert_eq!(
            installed_page_entry(&manifest).as_deref(),
            Some("page/index.js")
        );
        assert_eq!(
            installed_layer_entries(&manifest),
            vec!["core.js", "page/index.js", "widget.js"]
        );
        assert!(installed_layer_entries(&json!({})).is_empty());
    }

    #[test]
    fn requested_widget_id_must_be_declared() {
        let manifest = json!({
            "widgets": [
                { "id": "card", "entry": "components/card.js" },
                { "id": "list", "entry": "components/list.js" }
            ]
        });
        assert_eq!(installed_widget_ids(&manifest), vec!["card", "list"]);
        assert_eq!(require_known_widget_id(&manifest, None).unwrap(), None);
        assert_eq!(
            require_known_widget_id(&manifest, Some("card")).unwrap(),
            Some("card")
        );
        assert_eq!(
            require_known_widget_id(&manifest, Some("ghost")).unwrap_err(),
            UnknownWidgetId("ghost".into())
        );
        assert_eq!(
            filter_widget_paths(
                vec![
                    ("card".into(), "components/card.js".into()),
                    ("list".into(), "components/list.js".into())
                ],
                Some("card")
            ),
            vec![("card".into(), "components/card.js".into())]
        );
    }

    #[test]
    fn widget_template_plans() {
        let manifest = json!({
            "widgets": [{
                "id": "card",
                "templates": {
                    "2x2": "templates/card-2x2.html",
                    "4x2": "templates/card-4x2.html"
                }
            }]
        });
        let templates = installed_widget_template_paths(&manifest);
        assert_eq!(templates.len(), 2);
        assert!(templates
            .iter()
            .any(|t| t.widget_id == "card" && t.size == "2x2"));
        assert!(installed_widget_template_paths(&json!({})).is_empty());
    }

    #[test]
    fn asset_declaration_and_size_gate() {
        let manifest: TappManifest = serde_json::from_value(json!({
            "id": "com.example.app",
            "name": "App",
            "version": "1.0.0",
            "core": { "entry": "core.js" },
            "category": "utility",
            "permissions": [],
            "assets": ["assets/icon.png", "assets/felt/table.png"]
        }))
        .unwrap();
        assert!(manifest_declares_asset(&manifest, "assets/icon.png"));
        assert!(!manifest_declares_asset(&manifest, "assets/missing.png"));
        assert!(!manifest_declares_asset(
            &serde_json::from_value(json!({
                "id": "com.example.app",
                "name": "App",
                "version": "1.0.0",
                "core": { "entry": "core.js" },
                "category": "utility",
                "permissions": []
            }))
            .unwrap(),
            "assets/icon.png"
        ));
        assert!(asset_bytes_within_limit(10, 100));
        assert!(!asset_bytes_within_limit(101, 100));
    }

    #[test]
    fn installed_asset_declaration_degrades_instead_of_failing() {
        let manifest = json!({ "assets": ["assets/icon.png"] });
        assert!(installed_manifest_declares_asset(
            &manifest,
            "assets/icon.png"
        ));
        assert!(!installed_manifest_declares_asset(
            &manifest,
            "assets/missing.png"
        ));

        // 与当前契约不符的 manifest 只会退化为「未声明」，不会让调用方失败——
        // 强类型反序列化在这里会变成 500。
        for shape in [
            json!({}),
            json!({ "assets": "not-an-array" }),
            json!({ "assets": [42] }),
            json!({ "core": { "entry": "core.js" } }),
        ] {
            assert!(!installed_manifest_declares_asset(
                &shape,
                "assets/icon.png"
            ));
        }
    }
}
