//! Version parsing and comparison.
//!
//! Updater accepts a constrained subset of semver:
//!   ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.]+)?$
//!
//! Anything outside this pattern is rejected at the boundary. Inside the program
//! we use [`semver::Version`] for comparisons.

use once_cell::sync::Lazy;
use regex::Regex;
use semver::Version;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

use crate::error::UpdaterError;

static VERSION_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^v(?P<sv>[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.]+)?)$").unwrap());

/// A validated `v`-prefixed Myriad version.
#[derive(Debug, Clone, Eq, PartialEq, Hash)]
pub struct MyriadVersion {
    raw: String,
    inner: Version,
}

impl MyriadVersion {
    pub fn parse(s: &str) -> Result<Self, UpdaterError> {
        let caps = VERSION_RE
            .captures(s)
            .ok_or_else(|| UpdaterError::InvalidInput(format!("invalid version: {s}")))?;
        let sv = &caps["sv"];
        let inner = Version::parse(sv)
            .map_err(|e| UpdaterError::InvalidInput(format!("invalid version {s}: {e}")))?;
        Ok(Self {
            raw: s.to_string(),
            inner,
        })
    }

    pub fn as_str(&self) -> &str {
        &self.raw
    }

    pub fn semver(&self) -> &Version {
        &self.inner
    }

    /// True when this version is older than `other` according to semver precedence.
    pub fn older_than(&self, other: &MyriadVersion) -> bool {
        self.inner < other.inner
    }
}

impl fmt::Display for MyriadVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.raw)
    }
}

impl FromStr for MyriadVersion {
    type Err = UpdaterError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

impl Serialize for MyriadVersion {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        ser.serialize_str(&self.raw)
    }
}

impl<'de> Deserialize<'de> for MyriadVersion {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let s = String::deserialize(de)?;
        Self::parse(&s).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain() {
        let v = MyriadVersion::parse("v1.2.3").unwrap();
        assert_eq!(v.as_str(), "v1.2.3");
    }

    #[test]
    fn accepts_pre_release() {
        let v = MyriadVersion::parse("v1.2.3-beta.4").unwrap();
        assert_eq!(v.semver().pre.as_str(), "beta.4");
    }

    #[test]
    fn rejects_garbage() {
        for bad in ["", "1.2.3", "vX.Y.Z", "v1.2", "v1.2.3-BETA"] {
            assert!(MyriadVersion::parse(bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn ordering() {
        let a = MyriadVersion::parse("v1.2.3").unwrap();
        let b = MyriadVersion::parse("v1.2.4").unwrap();
        assert!(a.older_than(&b));
        assert!(!b.older_than(&a));
    }
}
