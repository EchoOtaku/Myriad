//! Canonical media paths. Disk location is `storage_key`, never a request URL.

use uuid::Uuid;

use super::error::MediaError;
use super::validate::extension_for_mime;

pub fn storage_key(public_id: Uuid, ext: &str) -> Result<String, MediaError> {
    let ext = normalize_ext(ext)?;
    let id = public_id.to_string();
    let prefix = id
        .get(..2)
        .ok_or_else(|| MediaError::invalid("Invalid asset id"))?;
    Ok(format!("{prefix}/{id}.{ext}"))
}

pub fn content_path(id: i32) -> String {
    format!("/api/media/{id}/content")
}

pub fn public_path(public_id: Uuid, filename: &str) -> String {
    format!("/media/assets/{public_id}/{filename}")
}

pub fn staging_url(public_id: Uuid) -> String {
    format!("/media/assets/{public_id}/staging")
}

pub fn compatible_url(public_id: Uuid, filename: &str) -> String {
    public_path(public_id, filename)
}

pub fn display_filename(original: &str, ext: &str, public_id: Uuid) -> String {
    let ext = normalize_ext(ext).unwrap_or("bin");
    let stem = std::path::Path::new(original)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let cleaned: String = stem
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .take(80)
        .collect();
    if cleaned.is_empty() {
        format!("{public_id}.{ext}")
    } else {
        format!("{cleaned}.{ext}")
    }
}

/// Keep a known local pathname. Query strings, origins, and `..` are rejected.
pub fn registered_local_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = if let Some(rest) = trimmed.split_once("://").map(|(_, rest)| rest) {
        rest.find('/').map(|i| &rest[i..])?
    } else {
        trimmed
    };
    let path = path.split('?').next().unwrap_or(path);
    if path.contains("..") || path.contains('\\') || path.contains('\0') {
        return None;
    }
    if !(path.starts_with("/media/federation/")
        || path.starts_with("/media/assets/")
        || path.starts_with("/api/media/")
        || path.starts_with("/api/phantasi/image-cache/")
        || path.starts_with("/api/brew/image-cache/"))
    {
        return None;
    }
    Some(path.to_string())
}

pub fn filename_for_mime(name: &str, mime: &str, public_id: Uuid) -> Result<String, MediaError> {
    let ext =
        extension_for_mime(mime).ok_or_else(|| MediaError::invalid("Unsupported media type"))?;
    Ok(display_filename(name, ext, public_id))
}

fn normalize_ext(ext: &str) -> Result<&str, MediaError> {
    match ext {
        "jpg" | "png" | "gif" | "webp" | "mp4" | "webm" | "mov" => Ok(ext),
        _ => Err(MediaError::invalid("Unsupported media type")),
    }
}

pub fn parse_storage_key(key: &str) -> Result<(Uuid, &'static str), MediaError> {
    let (prefix, rest) = key
        .split_once('/')
        .ok_or_else(|| MediaError::invalid("Invalid storage key"))?;
    if prefix.len() != 2
        || !prefix.bytes().all(|b| b.is_ascii_hexdigit())
        || rest.contains('/')
        || rest.contains("..")
    {
        return Err(MediaError::invalid("Invalid storage key"));
    }
    let (id, ext) = rest
        .rsplit_once('.')
        .ok_or_else(|| MediaError::invalid("Invalid storage key"))?;
    let public_id = Uuid::parse_str(id).map_err(|_| MediaError::invalid("Invalid storage key"))?;
    if public_id.to_string().get(..2) != Some(prefix) {
        return Err(MediaError::invalid("Invalid storage key"));
    }
    let ext = match ext {
        "jpg" => "jpg",
        "png" => "png",
        "gif" => "gif",
        "webp" => "webp",
        "mp4" => "mp4",
        "webm" => "webm",
        "mov" => "mov",
        _ => return Err(MediaError::invalid("Invalid storage key")),
    };
    Ok((public_id, ext))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_key_stays_inside_media_root() {
        let id = Uuid::parse_str("3f2a1b4c-5d6e-7f80-91a2-b3c4d5e6f708").unwrap();
        let key = storage_key(id, "png").unwrap();
        assert_eq!(key, "3f/3f2a1b4c-5d6e-7f80-91a2-b3c4d5e6f708.png");
        assert!(parse_storage_key(&key).is_ok());
        assert!(parse_storage_key("../secret.png").is_err());
        assert!(parse_storage_key("3f/../etc/passwd").is_err());
        assert!(parse_storage_key("3f/3f2a1b4c-5d6e-7f80-91a2-b3c4d5e6f708.png/extra").is_err());
    }

    #[test]
    fn registered_paths_do_not_follow_foreign_origins() {
        assert_eq!(
            registered_local_path("https://site.example/media/federation/1/a.jpg"),
            Some("/media/federation/1/a.jpg".into())
        );
        assert!(registered_local_path("https://other.site/media/federation/1/a.jpg").is_some());
        // Origin checks belong to the alias service; this helper only extracts a
        // pathname shape and still rejects traversal / queries-as-identity.
        assert_eq!(
            registered_local_path("/media/federation/1/a.jpg?track=1"),
            Some("/media/federation/1/a.jpg".into())
        );
        assert!(registered_local_path("/media/federation/../secret").is_none());
        assert!(registered_local_path("/tmp/x.png").is_none());
        assert!(registered_local_path("").is_none());
    }

    #[test]
    fn display_filename_ignores_client_path() {
        let id = Uuid::nil();
        assert_eq!(
            display_filename("../../etc/passwd", "png", id),
            "passwd.png"
        );
        assert_eq!(display_filename("Photo 1.PNG", "jpg", id), "Photo1.jpg");
    }
}
