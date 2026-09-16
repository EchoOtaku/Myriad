use myriad_phantasi_notes::ai_edit::{build_prompt, validate_result};
use serde_json::{Value, json};

fn request() -> Value {
    json!({"title":"标题", "topic":"旅行", "content_md":"前😀\n重复\n重复\n后", "instruction":"整理", "locale":"zh-CN", "selection":{"start":15,"end":21,"text":"重复"}})
}

#[test]
fn full_original_survives_prompt_building_and_selection_uses_bytes() {
    let mut req = request();
    req["content_md"] = json!(format!(
        "{}{}",
        req["content_md"].as_str().unwrap(),
        "原文".repeat(20_000)
    ));
    let prompt = build_prompt(&req).unwrap();
    let decoded: Value = serde_json::from_str(&prompt).unwrap();
    assert_eq!(decoded["content_md"], req["content_md"]);
    assert_eq!(decoded["selection"]["text"], "重复");
    let output = validate_result(&req, r#"{"replacement":"**重复**","complete":true}"#).unwrap();
    assert!(output.starts_with("前😀\n重复\n**重复**\n后"));
}
#[test]
fn selection_must_match_the_original_and_utf8_boundaries() {
    for selection in [
        json!({"start":1,"end":8,"text":"x"}),
        json!({"start":15,"end":21,"text":"different"}),
        json!({"start":21,"end":15,"text":"重复"}),
    ] {
        let mut req = request();
        req["selection"] = selection;
        assert!(build_prompt(&req).is_err());
    }
}
#[test]
fn incomplete_or_empty_responses_are_rejected() {
    for response in [
        r#"{"replacement":"cut off""#,
        r#"{"replacement":"","complete":true}"#,
        r#"{"replacement":"partial","complete":false}"#,
    ] {
        assert!(validate_result(&request(), response).is_err());
    }
}
#[test]
fn code_math_images_links_footnotes_and_widgets_cannot_disappear() {
    let source = "Text [link](https://example.com) ![pic](/a.png) $x^2$ [^1]\n\n```rs\nlet x = 1;\n```\n\n[^1]: Footnote\n\n:::columns\n:::col\nLeft\n:::col\n:::widget quote 2x2\n:::\n";
    let req =
        json!({"title":"", "content_md":source,"instruction":"","locale":"en-US","selection":null});
    let response = json!({"replacement":format!("## Heading\n\n{source}"), "complete":true});
    assert!(validate_result(&req, &response.to_string()).is_ok());
    for (from, to) in [
        ("/a.png", "/b.png"),
        ("$x^2$", "$x^3$"),
        ("let x = 1;", "let x = 2;"),
        ("https://example.com", "https://other.com"),
        (":::widget quote 2x2", ""),
        ("[^1]: Footnote", ""),
    ] {
        let response = json!({"replacement":source.replace(from,to), "complete":true});
        assert!(
            validate_result(&req, &response.to_string()).is_err(),
            "lost {from}"
        );
    }
}

#[test]
fn malformed_selection_without_text_is_rejected_before_slicing() {
    let mut req = request();
    req["selection"] = json!({"start":1000,"end":2000,"text":null});
    assert!(build_prompt(&req).is_err());
}

#[test]
fn code_language_and_footnote_contents_are_preserved() {
    let source = "```rs\nlet x = 1;\n```\n\nText[^a]\n\n[^a]: Complete reference with details\n";
    let req = json!({"title":"", "content_md":source,"instruction":"","locale":"en-US","selection":null});
    for (from, to) in [("```rs", "```text"), ("Complete reference with details", "omitted")] {
        let response = json!({"replacement":source.replace(from, to),"complete":true});
        assert!(validate_result(&req, &response.to_string()).is_err(), "changed {from}");
    }
}
