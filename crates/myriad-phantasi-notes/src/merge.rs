//! 三路合并正文。没有 I/O。同时改不同行能合；同一行两边都改则两行都留。

/// `base` 是双方都见过的版本，`local` / `remote` 是各自后来的稿。
pub fn merge_text(base: &str, local: &str, remote: &str) -> String {
    if local == remote || remote == base {
        return local.to_string();
    }
    if local == base {
        return remote.to_string();
    }
    merge_lines(
        &split_keep_end(base),
        &split_keep_end(local),
        &split_keep_end(remote),
    )
    .join("\n")
}

fn split_keep_end(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    text.split('\n').collect()
}

fn first_index(lines: &[&str], start: usize, needle: &str) -> Option<usize> {
    lines[start..]
        .iter()
        .position(|line| *line == needle)
        .map(|offset| start + offset)
}

fn next_shared(base: &[&str], from: usize, other: &[&str], other_start: usize) -> Option<usize> {
    for line in &base[from..] {
        if let Some(index) = first_index(other, other_start, line) {
            return Some(index);
        }
    }
    None
}

fn merge_lines(base: &[&str], local: &[&str], remote: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    let mut li = 0;
    let mut ri = 0;
    let mut bi = 0;
    while bi < base.len() {
        let line = base[bi];
        let local_at = first_index(local, li, line);
        let remote_at = first_index(remote, ri, line);
        match (local_at, remote_at) {
            (Some(l), Some(r)) => {
                out.extend(merge_inserts(&local[li..l], &remote[ri..r]));
                out.push(line.to_string());
                li = l + 1;
                ri = r + 1;
                bi += 1;
            }
            (None, Some(r)) => {
                let end = next_shared(base, bi + 1, local, li).unwrap_or(local.len());
                out.extend(remote[ri..r].iter().map(|item| (*item).to_string()));
                out.extend(local[li..end].iter().map(|item| (*item).to_string()));
                li = end;
                ri = r + 1;
                bi += 1;
            }
            (Some(l), None) => {
                let end = next_shared(base, bi + 1, remote, ri).unwrap_or(remote.len());
                out.extend(local[li..l].iter().map(|item| (*item).to_string()));
                out.extend(remote[ri..end].iter().map(|item| (*item).to_string()));
                ri = end;
                li = l + 1;
                bi += 1;
            }
            (None, None) => {
                let local_end = next_shared(base, bi + 1, local, li).unwrap_or(local.len());
                let remote_end = next_shared(base, bi + 1, remote, ri).unwrap_or(remote.len());
                out.extend(merge_inserts(
                    &local[li..local_end],
                    &remote[ri..remote_end],
                ));
                li = local_end;
                ri = remote_end;
                bi += 1;
            }
        }
    }
    out.extend(merge_inserts(&local[li..], &remote[ri..]));
    out
}

fn merge_inserts(local: &[&str], remote: &[&str]) -> Vec<String> {
    if local == remote {
        return local.iter().map(|item| (*item).to_string()).collect();
    }
    // Coalesce identical edits, never repeated lines within an author's edit.
    local
        .iter()
        .chain(remote.iter())
        .map(|line| (*line).to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_inserted_lines_survive() {
        assert_eq!(
            merge_text("anchor", "anchor\nx\nx\n\n", "anchor\ny"),
            "anchor\nx\nx\n\n\ny"
        );
    }

    #[test]
    fn insertion_before_replaced_line_survives() {
        assert_eq!(merge_text("old", "insert\nold", "new"), "insert\nnew");
        assert_eq!(merge_text("old", "new", "insert\nold"), "insert\nnew");
    }

    #[test]
    fn unchanged_side_takes_the_other() {
        assert_eq!(merge_text("a\nb", "a\nb", "a\nB"), "a\nB");
        assert_eq!(merge_text("a\nb", "A\nb", "a\nb"), "A\nb");
    }

    #[test]
    fn different_lines_both_keep() {
        assert_eq!(merge_text("a\nb\nc", "A\nb\nc", "a\nb\nC"), "A\nb\nC");
    }

    #[test]
    fn both_append() {
        assert_eq!(merge_text("a", "a\n一", "a\n二"), "a\n一\n二");
    }

    #[test]
    fn same_line_conflict_keeps_both() {
        assert_eq!(merge_text("x", "左", "右"), "左\n右");
    }
}
