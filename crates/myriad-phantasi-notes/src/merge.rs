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

#[derive(Clone)]
struct Hunk {
    start: usize,
    end: usize,
    lines: Vec<String>,
    side: usize,
}

const MAX_DIFF_CELLS: usize = 1_000_000;

// Same bounded LCS and deletion-first tie break as noteMerge.ts.
fn diff_hunks(base: &[&str], next: &[&str], side: usize) -> Vec<Hunk> {
    let mut start = 0;
    while start < base.len() && start < next.len() && base[start] == next[start] {
        start += 1;
    }
    let (mut end, mut next_end) = (base.len(), next.len());
    while end > start && next_end > start && base[end - 1] == next[next_end - 1] {
        end -= 1;
        next_end -= 1;
    }
    let (n, m) = (end - start, next_end - start);
    if n == 0 && m == 0 {
        return Vec::new();
    }
    if n == 0 || m == 0 || (n + 1).saturating_mul(m + 1) > MAX_DIFF_CELLS {
        return vec![Hunk {
            start,
            end,
            lines: next[start..next_end]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            side,
        }];
    }
    let width = m + 1;
    let mut scores = vec![0usize; (n + 1) * width];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            scores[i * width + j] = if base[start + i] == next[start + j] {
                1 + scores[(i + 1) * width + j + 1]
            } else {
                scores[(i + 1) * width + j].max(scores[i * width + j + 1])
            };
        }
    }
    let mut hunks = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < n || j < m {
        if i < n && j < m && base[start + i] == next[start + j] {
            i += 1;
            j += 1;
            continue;
        }
        let mut hunk = Hunk {
            start: start + i,
            end: start + i,
            lines: Vec::new(),
            side,
        };
        while i < n || j < m {
            if i < n && j < m && base[start + i] == next[start + j] {
                break;
            }
            if j < m && (i == n || scores[i * width + j + 1] > scores[(i + 1) * width + j]) {
                hunk.lines.push(next[start + j].to_string());
                j += 1;
            } else {
                i += 1;
            }
        }
        hunk.end = start + i;
        hunks.push(hunk);
    }
    hunks
}

fn apply_hunks(base: &[&str], start: usize, end: usize, hunks: &[&Hunk]) -> Vec<String> {
    let mut out = Vec::new();
    let mut cursor = start;
    for hunk in hunks {
        out.extend(base[cursor..hunk.start].iter().map(|s| s.to_string()));
        out.extend(hunk.lines.iter().cloned());
        cursor = hunk.end;
    }
    out.extend(base[cursor..end].iter().map(|s| s.to_string()));
    out
}

fn merge_lines(base: &[&str], local: &[&str], remote: &[&str]) -> Vec<String> {
    let mut changes = diff_hunks(base, local, 0);
    changes.extend(diff_hunks(base, remote, 1));
    changes.sort_by_key(|h| (h.start, h.end, h.side));
    let mut out = Vec::new();
    let (mut cursor, mut i) = (0, 0);
    while i < changes.len() {
        let first = &changes[i];
        i += 1;
        let mut group = vec![first];
        let mut end = first.end;
        while i < changes.len()
            && (changes[i].start < end
                || (end == first.start && changes[i].start == end && changes[i].end == end))
        {
            let hunk = &changes[i];
            i += 1;
            group.push(hunk);
            end = end.max(hunk.end);
        }
        out.extend(base[cursor..first.start].iter().map(|s| s.to_string()));
        let left: Vec<_> = group.iter().copied().filter(|h| h.side == 0).collect();
        let right: Vec<_> = group.iter().copied().filter(|h| h.side == 1).collect();
        if left.is_empty() || right.is_empty() {
            out.extend(apply_hunks(base, first.start, end, &group));
        } else {
            let local = apply_hunks(base, first.start, end, &left);
            let remote = apply_hunks(base, first.start, end, &right);
            if local == remote {
                out.extend(local);
            } else {
                out.extend(local);
                out.extend(remote);
            }
        }
        cursor = end;
    }
    out.extend(base[cursor..].iter().map(|s| s.to_string()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_positions_handle_repeats() {
        for (base, local, remote, expected) in [
            ("x\nx", "X\nx", "x\nY", "X\nY"),
            ("x\nx\nz", "x\nz", "x\nx\nZ", "x\nZ"),
            ("x\nx", "x", "X\nx", "X"),
            ("x\nx", "x\na\nx", "x\nx\nb", "x\na\nx\nb"),
            ("a\nb\nc", "A\nb\nc", "A\nb\nc\nd", "A\nb\nc\nd"),
            ("a\nb\nc", "L\nc", "a\nR", "L\nc\na\nR"),
        ] {
            assert_eq!(merge_text(base, local, remote), expected);
        }
    }

    #[test]
    fn large_changes_conservatively_preserve_both() {
        let make = |prefix| {
            (0..1100)
                .map(|i| format!("{prefix}-{i}"))
                .collect::<Vec<_>>()
                .join("\n")
        };
        let (base, local, remote) = (make("base"), make("local"), make("remote"));
        assert_eq!(
            merge_text(&base, &local, &remote),
            format!("{local}\n{remote}")
        );
    }

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
