//! 笔记正文分栏 / 正文小组件。
//!
//! 原文是 `:::columns` / `:::widget`，渲染时变成带 class 的 `div`。
//! 栏里的 Markdown 再走同一套渲染。不是首页宫格，也不是 Notion 导入分栏。

use std::fmt::Write as _;

/// 和前端 `WIDGET_SIZE_KEYS` 同一份。工具条默认档可以更短，解析仍认这些。
const WIDGET_SIZES: &[&str] = &[
    "1x1", "2x1", "1x2", "2x2", "2x3", "3x2", "3x3", "2x4", "4x1", "4x2", "4x4",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LayoutSeg {
    Text {
        start: usize,
        end: usize,
    },
    Columns {
        start: usize,
        end: usize,
        columns: Vec<String>,
    },
    Widget {
        start: usize,
        end: usize,
        typ: String,
        size: String,
        config: Option<String>,
    },
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct MdFence {
    ch: u8,
    n: usize,
}

impl MdFence {
    pub(crate) fn closer(self) -> String {
        std::iter::repeat(self.ch as char)
            .take(self.n.max(3))
            .collect()
    }
}

fn fence_indent(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < 3 && i < bytes.len() && bytes[i] == b' ' {
        i += 1;
    }
    &line[i..]
}

pub(crate) fn fence_open(line: &str) -> Option<MdFence> {
    let t = fence_indent(line);
    let ch = *t.as_bytes().first()?;
    if ch != b'`' && ch != b'~' {
        return None;
    }
    let n = t.bytes().take_while(|&c| c == ch).count();
    if n < 3 {
        return None;
    }
    if ch == b'`' && t[n..].contains('`') {
        return None;
    }
    Some(MdFence { ch, n })
}

pub(crate) fn fence_close(line: &str, open: MdFence) -> bool {
    let t = fence_indent(line);
    let n = t.bytes().take_while(|&c| c == open.ch).count();
    n >= open.n && n >= 3 && t[n..].trim().is_empty()
}

/// 这一行还在围栏里（含开/闭行）时不要去认 `:::widget`。
pub(crate) fn eat_fence(line: &str, fence: &mut Option<MdFence>) -> bool {
    if let Some(open) = *fence {
        if fence_close(line, open) {
            *fence = None;
        }
        return true;
    }
    if let Some(open) = fence_open(line) {
        *fence = Some(open);
        return true;
    }
    false
}

pub(crate) fn parse_note_layout(markdown: &str) -> Vec<LayoutSeg> {
    let lines: Vec<&str> = markdown.split('\n').collect();
    let mut segs = Vec::new();
    let mut index = 0usize;
    let mut offset = 0usize;
    let mut text_from = 0usize;
    let mut fence = None;

    let flush_text = |segs: &mut Vec<LayoutSeg>, from: usize, to: usize| {
        if from >= to {
            return;
        }
        let text = &markdown[from..to];
        if text.trim().is_empty() {
            return;
        }
        segs.push(LayoutSeg::Text {
            start: from,
            end: to,
        });
    };

    while index < lines.len() {
        let line = lines[index];
        let last = index + 1 == lines.len();
        let next = offset + line.len() + if last { 0 } else { 1 };

        if eat_fence(line, &mut fence) {
            index += 1;
            offset = next;
            continue;
        }

        if let Some((typ, size, config)) = parse_widget_line(line) {
            flush_text(&mut segs, text_from, offset);
            segs.push(LayoutSeg::Widget {
                start: offset,
                end: offset + line.len(),
                typ,
                size,
                config,
            });
            text_from = next;
            index += 1;
            offset = next;
            continue;
        }

        if is_columns_open(line) {
            flush_text(&mut segs, text_from, offset);
            let parsed = take_columns(&lines, index, offset);
            segs.push(parsed.seg);
            index = parsed.next_index;
            offset = parsed.next_offset;
            text_from = offset;
            continue;
        }

        index += 1;
        offset = next;
    }

    flush_text(&mut segs, text_from, markdown.len());
    segs
}

struct TakenColumns {
    seg: LayoutSeg,
    next_index: usize,
    next_offset: usize,
}

fn take_columns(lines: &[&str], start_index: usize, start_offset: usize) -> TakenColumns {
    let mut index = start_index + 1;
    let mut offset = start_offset + lines[start_index].len();
    if start_index < lines.len().saturating_sub(1) {
        offset += 1;
    }

    let mut columns: Vec<Vec<&str>> = vec![Vec::new()];
    let mut fence = None;

    while index < lines.len() {
        let line = lines[index];
        let last = index + 1 == lines.len();
        let next = offset + line.len() + if last { 0 } else { 1 };

        let in_fence = eat_fence(line, &mut fence);
        if !in_fence && is_column_mark(line) {
            columns.push(Vec::new());
            index += 1;
            offset = next;
            continue;
        }
        if !in_fence && is_fence_close(line) {
            return TakenColumns {
                seg: LayoutSeg::Columns {
                    start: start_offset,
                    end: offset + line.len(),
                    columns: columns.into_iter().map(|col| col.join("\n")).collect(),
                },
                next_index: index + 1,
                next_offset: next,
            };
        }

        columns.last_mut().expect("column buffer").push(line);
        index += 1;
        offset = next;
    }

    TakenColumns {
        seg: LayoutSeg::Columns {
            start: start_offset,
            end: offset,
            columns: columns.into_iter().map(|col| col.join("\n")).collect(),
        },
        next_index: index,
        next_offset: offset,
    }
}

fn is_columns_open(line: &str) -> bool {
    let trimmed = line.trim_end();
    trimmed == ":::columns"
}

fn is_column_mark(line: &str) -> bool {
    line.trim_end() == ":::col"
}

fn is_fence_close(line: &str) -> bool {
    line.trim_end() == ":::"
}

const CONFIG_MAX: usize = 2048;

fn looks_like_size(token: &str) -> bool {
    let mut parts = token.split('x');
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(cols), Some(rows), None)
            if !cols.is_empty()
                && !rows.is_empty()
                && cols.bytes().all(|b| b.is_ascii_digit())
                && rows.bytes().all(|b| b.is_ascii_digit())
    )
}

fn take_widget_config(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.len() > CONFIG_MAX {
        return None;
    }
    // 和前端 parseWidgetConfig 对齐：必须是能 JSON.parse 的非空对象，才写 data-config。
    let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;
    let obj = value.as_object()?;
    if obj.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn strip_widget_keyword(trimmed: &str) -> Option<&str> {
    const KEY: &str = ":::widget";
    let bytes = trimmed.as_bytes();
    if bytes.len() < KEY.len() || !bytes[..KEY.len()].eq_ignore_ascii_case(KEY.as_bytes()) {
        return None;
    }
    Some(&trimmed[KEY.len()..])
}

fn parse_widget_line(line: &str) -> Option<(String, String, Option<String>)> {
    let trimmed = line.trim_end();
    let rest = strip_widget_keyword(trimmed)?;
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let rest = rest.trim_start();
    let typ_len = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let typ = rest[..typ_len].to_ascii_lowercase();
    if !is_widget_type(&typ) {
        return None;
    }
    let mut remain = rest[typ_len..].trim_start();

    let size = if remain.is_empty() {
        normalize_size("")
    } else {
        let token_len = remain.find(char::is_whitespace).unwrap_or(remain.len());
        let token = &remain[..token_len];
        if looks_like_size(token) {
            remain = remain[token_len..].trim_start();
            normalize_size(token)
        } else {
            normalize_size("")
        }
    };

    let config = if remain.is_empty() {
        None
    } else if remain.starts_with('{') {
        take_widget_config(remain)
    } else {
        return None;
    };
    Some((typ, size, config))
}

fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(b as char),
            _ => {
                let _ = write!(out, "%{b:02X}");
            }
        }
    }
    out
}

fn is_widget_type(typ: &str) -> bool {
    let mut chars = typ.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_lowercase()
        && chars.all(|ch| {
            ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '.' || ch == '_' || ch == '-'
        })
        && typ.len() <= 64
}

fn normalize_size(size: &str) -> String {
    if WIDGET_SIZES.contains(&size) {
        size.to_string()
    } else {
        "2x2".to_string()
    }
}

pub(crate) fn escape_attr(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

pub(crate) fn widget_html(typ: &str, size: &str, config: Option<&str>) -> String {
    let mut out = format!(
        "<div class=\"note-widget not-prose\" data-widget=\"{}\" data-size=\"{}\"",
        escape_attr(typ),
        escape_attr(size),
    );
    if let Some(json) = config {
        let _ = write!(
            out,
            " data-config=\"{}\"",
            escape_attr(&encode_uri_component(json))
        );
    }
    out.push_str("></div>");
    out
}

pub(crate) fn stamp_wrapper(html: &str, start: usize, end: usize) -> String {
    let Some(gt) = html.find('>') else {
        return html.to_string();
    };
    let mut out = String::with_capacity(html.len() + 48);
    out.push_str(&html[..gt]);
    let _ = write!(out, " data-md-start=\"{start}\" data-md-end=\"{end}\"");
    out.push_str(&html[gt..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tilde_fence_skips_widget() {
        let md = "上\n\n~~~\n:::widget secret 2x2\n~~~\n\n下";
        let segs = parse_note_layout(md);
        assert_eq!(segs.len(), 1);
        match &segs[0] {
            LayoutSeg::Text { start, end } => {
                assert!(md[*start..*end].contains(":::widget secret"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn parses_widget_and_skips_fence() {
        let md = "上\n\n:::widget Weather 4x2\n\n```\n:::widget secret 2x2\n```";
        let segs = parse_note_layout(md);
        assert!(matches!(&segs[0], LayoutSeg::Text { .. }));
        match &segs[1] {
            LayoutSeg::Widget { typ, size, .. } => {
                assert_eq!(typ, "weather");
                assert_eq!(size, "4x2");
            }
            other => panic!("{other:?}"),
        }
        match &segs[2] {
            LayoutSeg::Text { start, end } => {
                assert!(md[*start..*end].contains(":::widget secret"));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn parses_two_columns() {
        let md = ":::columns\n左 **粗**\n:::col\n右\n:::";
        let segs = parse_note_layout(md);
        match &segs[0] {
            LayoutSeg::Columns { columns, .. } => {
                assert_eq!(columns.len(), 2);
                assert!(columns[0].contains("左"));
                assert_eq!(columns[1].trim(), "右");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn widget_sizes_match_frontend_grid_keys() {
        let mut got = WIDGET_SIZES.to_vec();
        got.sort_unstable();
        assert_eq!(
            got,
            [
                "1x1", "1x2", "2x1", "2x2", "2x3", "2x4", "3x2", "3x3", "4x1", "4x2", "4x4"
            ]
        );
        assert_eq!(parse_widget_line(":::widget quote 3x3").unwrap().1, "3x3");
        assert_eq!(parse_widget_line(":::widget quote 9x9").unwrap().1, "2x2");
        assert_eq!(
            parse_widget_line(":::WIDGET weather 2x2").unwrap().0,
            "weather"
        );
    }

    #[test]
    fn parses_widget_config_and_drops_bad_json() {
        let ok = parse_widget_line(r#":::widget weather 2x2 {"city":"Tokyo"}"#).unwrap();
        assert_eq!(ok.0, "weather");
        assert_eq!(ok.1, "2x2");
        assert_eq!(ok.2.as_deref(), Some(r#"{"city":"Tokyo"}"#));

        let no_size = parse_widget_line(r#":::widget weather {"city":"Tokyo"}"#).unwrap();
        assert_eq!(no_size.1, "2x2");
        assert_eq!(no_size.2.as_deref(), Some(r#"{"city":"Tokyo"}"#));

        // 花括号垃圾、截断、尾逗号都丢掉，和前端 JSON.parse 一样。尾巴不是对象就不当小组件。
        let junk = parse_widget_line(":::widget weather 2x2 {nope}").unwrap();
        assert_eq!(junk.2, None);
        assert_eq!(
            parse_widget_line(r#":::widget weather 2x2 {"city":"#)
                .unwrap()
                .2,
            None
        );
        assert_eq!(
            parse_widget_line(r#":::widget weather 2x2 {"city":"Tokyo",}"#)
                .unwrap()
                .2,
            None
        );

        assert_eq!(parse_widget_line(":::widget weather 2x2 hello"), None);
        assert_eq!(
            parse_widget_line(":::widget weather 2x2 {}").unwrap().2,
            None
        );
    }

    #[test]
    fn widget_html_percent_encodes_config() {
        let html = widget_html("weather", "2x2", Some(r#"{"city":"Tokyo"}"#));
        assert!(
            html.contains("data-config=\"%7B%22city%22%3A%22Tokyo%22%7D\""),
            "{html}"
        );
        assert!(html.contains("class=\"note-widget not-prose\""), "{html}");
        assert!(html.contains("></div>"), "{html}");
        assert!(!html.contains(">weather<"), "{html}");
        assert!(!html.contains("onclick"), "{html}");
    }
}
