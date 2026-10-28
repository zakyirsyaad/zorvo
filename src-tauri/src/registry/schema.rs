//! Strict parsing of the ACP agent registry. Each entry is validated on its own,
//! so one malformed entry never hides the others.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::resolve::LEGACY_IDS;

/// One agent at one version, as Zorvo stores and runs it.
///
/// The derived `Deserialize` is for Zorvo's own files only. It skips
/// `choose_distribution` and `is_valid_entry`, so it must never read raw
/// registry data: use [`parse_registry`] or [`parse_entry`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    pub distribution: Distribution,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(try_from = "DistributionWire", into = "DistributionWire")]
pub enum Distribution {
    Npx {
        package: String,
        args: Vec<String>,
        env: BTreeMap<String, String>,
    },
    Uvx {
        package: String,
        args: Vec<String>,
        env: BTreeMap<String, String>,
    },
    Binary {
        platforms: BTreeMap<String, BinaryTarget>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BinaryTarget {
    pub archive: String,
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
    /// Missing in some registry entries; an empty value never passes
    /// validation, so such a target is reported instead of run.
    #[serde(default, deserialize_with = "sha256_or_empty")]
    pub sha256: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
}

/// A missing or `null` checksum reads as empty, which never validates.
fn sha256_or_empty<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Serialize, Deserialize)]
struct PackageWire {
    package: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    env: BTreeMap<String, String>,
}

/// The `distribution` shape of one *stored* entry: exactly one of the three keys
/// (`TryFrom` rejects zero or several). The registry's own shape, where an entry
/// may offer several, is read by `EntryWire` and `choose_distribution`.
#[derive(Serialize, Deserialize)]
struct DistributionWire {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    npx: Option<PackageWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    uvx: Option<PackageWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    binary: Option<BTreeMap<String, BinaryTarget>>,
}

impl TryFrom<DistributionWire> for Distribution {
    type Error = String;

    fn try_from(wire: DistributionWire) -> Result<Self, String> {
        match (wire.npx, wire.uvx, wire.binary) {
            (Some(p), None, None) => Ok(Self::Npx {
                package: p.package,
                args: p.args,
                env: p.env,
            }),
            (None, Some(p), None) => Ok(Self::Uvx {
                package: p.package,
                args: p.args,
                env: p.env,
            }),
            (None, None, Some(platforms)) => Ok(Self::Binary { platforms }),
            _ => Err("distribution must have exactly one of npx, uvx or binary".into()),
        }
    }
}

impl From<Distribution> for DistributionWire {
    fn from(distribution: Distribution) -> Self {
        let empty = || DistributionWire {
            npx: None,
            uvx: None,
            binary: None,
        };
        match distribution {
            Distribution::Npx { package, args, env } => DistributionWire {
                npx: Some(PackageWire { package, args, env }),
                ..empty()
            },
            Distribution::Uvx { package, args, env } => DistributionWire {
                uvx: Some(PackageWire { package, args, env }),
                ..empty()
            },
            Distribution::Binary { platforms } => DistributionWire {
                binary: Some(platforms),
                ..empty()
            },
        }
    }
}

/// Why Zorvo lists a registry agent but cannot offer it. A closed set: the UI
/// words each one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnavailableReason {
    /// The download for this Mac publishes no valid SHA-256, so Zorvo cannot
    /// verify it and never runs it.
    NoChecksum,
    /// The entry is malformed or fails a validation rule (unpinned package,
    /// unsafe command, unsafe environment variable, ...).
    InvalidEntry,
}

/// A registry agent that failed validation, with just enough to show it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UnavailableAgent {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub reason: UnavailableReason,
}

/// What a registry document holds: the entries Zorvo can offer, and the agents
/// it lists but cannot (sorted by id, one per id).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedRegistry {
    pub entries: Vec<RegistryEntry>,
    pub unavailable: Vec<UnavailableAgent>,
}

/// Parses a registry document, keeping only the entries that pass validation.
/// Fails only when the document itself is not a registry.
pub fn parse_registry(json: &str) -> Result<Vec<RegistryEntry>, String> {
    parse_registry_report(json).map(|parsed| parsed.entries)
}

/// [`parse_registry`], also reporting the agents that failed validation. An
/// entry with no usable id (or an id the app reserves) is left out of both:
/// there is nothing to show it as.
pub fn parse_registry_report(json: &str) -> Result<ParsedRegistry, String> {
    let root: Value =
        serde_json::from_str(json).map_err(|e| format!("registry is not valid JSON: {e}"))?;
    let agents = root
        .get("agents")
        .and_then(Value::as_array)
        .ok_or_else(|| "registry has no agents list".to_string())?;
    let mut parsed = ParsedRegistry::default();
    for agent in agents {
        match assess(agent) {
            Assessment::Offered(entry) => parsed.entries.push(entry),
            Assessment::Unavailable(unavailable) => parsed.unavailable.push(unavailable),
            Assessment::Ignored => {}
        }
    }
    // The UI keys rows by id, and a registry that only reorders changes nothing.
    parsed.unavailable.sort_by(|a, b| a.id.cmp(&b.id));
    parsed
        .unavailable
        .dedup_by(|later, first| later.id == first.id);
    Ok(parsed)
}

/// Deserializes one registry entry and applies the validation rules; `None` when
/// it is malformed or fails them. Shared by the registry and the version history.
pub fn parse_entry(value: &Value) -> Option<RegistryEntry> {
    match assess(value) {
        Assessment::Offered(entry) => Some(entry),
        Assessment::Unavailable(_) | Assessment::Ignored => None,
    }
}

enum Assessment {
    Offered(RegistryEntry),
    Unavailable(UnavailableAgent),
    Ignored,
}

/// An entry as the registry writes it. Its `distribution` may offer several
/// kinds, each read on its own so one malformed kind cannot hide another.
#[derive(Deserialize)]
struct EntryWire {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    distribution: Value,
}

fn assess(value: &Value) -> Assessment {
    let Some(id) = value
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| is_valid_id(id) && !is_reserved_id(id))
    else {
        return Assessment::Ignored;
    };
    let unavailable = |reason| {
        Assessment::Unavailable(UnavailableAgent {
            id: id.to_string(),
            name: value
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
                .unwrap_or(id)
                .to_string(),
            description: value
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string),
            reason,
        })
    };
    match serde_json::from_value::<EntryWire>(value.clone()) {
        Err(_) => unavailable(UnavailableReason::InvalidEntry),
        Ok(wire) => match choose_distribution(wire) {
            Ok(entry) => Assessment::Offered(entry),
            Err(reason) => unavailable(reason),
        },
    }
}

/// Picks the one distribution Zorvo runs from those an entry offers, by this
/// preference (the first that passes [`is_valid_entry`] wins):
///
/// 1. a pinned `npx` package;
/// 2. a pinned `uvx` package;
/// 3. a binary with a build for this Mac and a valid checksum;
/// 4. a valid binary with no build for this Mac, which the catalog shows as
///    unsupported, so it is chosen only when nothing runnable is offered.
///
/// A package comes first on purpose: it does not depend on this Mac's platform
/// (so the choice kept in the history is the same on every Mac), a binary is
/// looked up on `PATH` by its program name before Zorvo's own copy is used (an
/// unrelated program of that name would run as the agent), and Zorvo may not
/// be able to unpack a binary's archive format.
///
/// A candidate that fails validation is never chosen and never contributes its
/// args or environment: the choice only decides which valid candidate runs. An
/// entry that offers one kind behaves exactly as it did before several were
/// accepted.
fn choose_distribution(wire: EntryWire) -> Result<RegistryEntry, UnavailableReason> {
    let EntryWire {
        id,
        name,
        version,
        description,
        icon,
        distribution,
    } = wire;
    let kind = |name: &str| distribution.get(name).cloned();
    let binary = kind("binary")
        .and_then(|raw| serde_json::from_value::<BTreeMap<String, BinaryTarget>>(raw).ok());
    let checksum_missing = binary
        .as_ref()
        .and_then(|platforms| platforms.get(current_platform()))
        .is_some_and(|target| !is_sha256(&target.sha256));
    let mut candidates = Vec::new();
    if let Some(platforms) = binary {
        candidates.push(Distribution::Binary { platforms });
    }
    let package = |name: &str| kind(name).and_then(|raw| serde_json::from_value(raw).ok());
    if let Some(PackageWire { package, args, env }) = package("npx") {
        candidates.push(Distribution::Npx { package, args, env });
    }
    if let Some(PackageWire { package, args, env }) = package("uvx") {
        candidates.push(Distribution::Uvx { package, args, env });
    }
    candidates
        .into_iter()
        .map(|distribution| RegistryEntry {
            id: id.clone(),
            name: name.clone(),
            version: version.clone(),
            description: description.clone(),
            icon: icon.clone(),
            distribution,
        })
        .filter(is_valid_entry)
        .min_by_key(preference_rank)
        .ok_or(if checksum_missing {
            UnavailableReason::NoChecksum
        } else {
            UnavailableReason::InvalidEntry
        })
}

/// Lower is preferred; see [`choose_distribution`].
fn preference_rank(entry: &RegistryEntry) -> u8 {
    match &entry.distribution {
        Distribution::Npx { .. } => 0,
        Distribution::Uvx { .. } => 1,
        Distribution::Binary { platforms } if platforms.contains_key(current_platform()) => 2,
        Distribution::Binary { .. } => 3,
    }
}

/// The platform key the registry uses for this machine, e.g. `darwin-aarch64`.
pub fn current_platform() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "darwin-aarch64",
        ("macos", "x86_64") => "darwin-x86_64",
        ("linux", "aarch64") => "linux-aarch64",
        ("linux", "x86_64") => "linux-x86_64",
        ("windows", "aarch64") => "windows-aarch64",
        ("windows", "x86_64") => "windows-x86_64",
        _ => "unsupported",
    }
}

/// Ids the app already uses for something else: the old built-in ACP agents
/// (migrated to their registry ids) and the removed agents, whose ids stay
/// reserved because the frontend still strips them from saved settings.
const REMOVED_AGENT_IDS: [&str; 2] = ["omp", "aider"];

fn is_reserved_id(id: &str) -> bool {
    LEGACY_IDS.iter().any(|(legacy, _)| *legacy == id) || REMOVED_AGENT_IDS.contains(&id)
}

/// A binary's version is checked too: the installer joins it into a path
/// under `tools/`. An npx or uvx version is only shown; its package is pinned.
fn is_valid_entry(entry: &RegistryEntry) -> bool {
    is_valid_id(&entry.id)
        && !is_reserved_id(&entry.id)
        && match &entry.distribution {
            Distribution::Npx { package, env, .. } => {
                is_pinned_npm_package(package) && is_safe_env(env)
            }
            Distribution::Uvx { package, env, .. } => {
                (is_pinned_npm_package(package) || is_pinned_pypi_package(package))
                    && is_safe_env(env)
            }
            Distribution::Binary { platforms } => {
                // Only this machine's target matters; others are kept but never run.
                // An entry without one stays in the catalog, shown as unsupported.
                is_exact_version(&entry.version)
                    && platforms
                        .get(current_platform())
                        .is_none_or(|t| is_valid_binary_target(t) && is_safe_env(&t.env))
            }
        }
}

/// `^[a-z0-9][a-z0-9-]*$`
fn is_valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// `name@X.Y.Z` where `name` is a plain npm package name, so the package can
/// never be read as a command-line option or a URL.
fn is_pinned_npm_package(package: &str) -> bool {
    let Some(at) = package.rfind('@').filter(|&i| i > 0) else {
        return false;
    };
    is_npm_name(&package[..at]) && is_exact_version(&package[at + 1..])
}

/// `^(@[a-z0-9~][a-z0-9-._~]*/)?[a-z0-9~][a-z0-9-._~]*$`: no leading `-` or
/// `.`, no `:`, and `/` only after a scope.
fn is_npm_name(name: &str) -> bool {
    match name.strip_prefix('@') {
        Some(scoped) => scoped
            .split_once('/')
            .is_some_and(|(scope, rest)| is_npm_name_part(scope) && is_npm_name_part(rest)),
        None => is_npm_name_part(name),
    }
}

fn is_npm_name_part(part: &str) -> bool {
    let mut chars = part.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '~')
        && chars.all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.' | '_' | '~')
        })
}

/// PyPI style `name==X.Y.Z`, `name` matching `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
fn is_pinned_pypi_package(package: &str) -> bool {
    package
        .split_once("==")
        .is_some_and(|(name, version)| is_pypi_name(name) && is_exact_version(version))
}

fn is_pypi_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Prefixes of variables that steer the loader, a runtime or a package manager.
const DENIED_ENV_PREFIXES: [&str; 7] = [
    "DYLD_",
    "LD_",
    "NPM_CONFIG_",
    "UV_",
    "PIP_",
    "PYTHON",
    "NODE_",
];

/// Variables that steer the search path, the shell, proxies or trusted certificates.
const DENIED_ENV_KEYS: [&str; 13] = [
    "PATH",
    "HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "BASH_ENV",
    "ENV",
    "SHELL",
];

/// Variable names must look like `^[A-Z_][A-Z0-9_]*$` and must not be denied.
fn is_safe_env(env: &BTreeMap<String, String>) -> bool {
    env.keys().all(|key| is_safe_env_key(key))
}

/// One variable name that passes the `is_safe_env` rules.
pub(crate) fn is_safe_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    chars
        .next()
        .is_some_and(|c| c.is_ascii_uppercase() || c == '_')
        && chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !DENIED_ENV_KEYS.contains(&key)
        && !DENIED_ENV_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix))
}

/// `^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$`
fn is_exact_version(version: &str) -> bool {
    let core_end = version.find(['-', '+']).unwrap_or(version.len());
    let (core, suffix) = version.split_at(core_end);
    let parts: Vec<&str> = core.split('.').collect();
    let core_ok = parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
    let suffix_ok = suffix.is_empty()
        || (suffix.len() > 1
            && suffix[1..]
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'));
    core_ok && suffix_ok
}

fn is_valid_binary_target(target: &BinaryTarget) -> bool {
    target.archive.starts_with("https://")
        && is_sha256(&target.sha256)
        && is_safe_relative_cmd(&target.cmd)
        && !is_generic_program(&target.cmd)
}

/// Programs a Mac may already have that run whatever they are given. A binary
/// agent is found on `PATH` by its `cmd`'s file name, so one named like these
/// would count as installed and run the registry's args with that program.
const GENERIC_PROGRAMS: &[&str] = &[
    "git",
    "awk",
    "gawk",
    "nawk",
    "sed",
    "tclsh",
    "wish",
    "expect",
    "ssh",
    "scp",
    "curl",
    "wget",
    "make",
    "xargs",
    "env",
    "sudo",
    "open",
    "osascript",
    "sh",
    "bash",
    "zsh",
    "fish",
    "dash",
    "ksh",
    "csh",
    "tcsh",
    "deno",
    "bun",
    "npx",
    "npm",
    "pnpm",
    "yarn",
    "uv",
    "uvx",
];

/// Interpreter and runtime families, matched as a prefix so versioned names
/// (`python3.12`, `node22`, `lua5.4`) are caught too.
const GENERIC_PROGRAM_PREFIXES: &[&str] = &[
    "python",
    "pip",
    "node",
    "ruby",
    "perl",
    "php",
    "lua",
    "java",
    "swift",
    "pwsh",
    "powershell",
];

/// True when `cmd`'s file name (any case) is a general-purpose program or
/// starts like an interpreter or runtime.
fn is_generic_program(cmd: &str) -> bool {
    let name = cmd.rsplit('/').next().unwrap_or(cmd).to_ascii_lowercase();
    GENERIC_PROGRAMS.contains(&name.as_str())
        || GENERIC_PROGRAM_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|c| c.is_ascii_hexdigit())
}

/// A path inside the archive: relative (a leading `./` is fine) and never climbing out.
fn is_safe_relative_cmd(cmd: &str) -> bool {
    !cmd.is_empty()
        && !cmd.starts_with('/')
        && !cmd.contains('\\')
        && !cmd.split('/').any(|part| part == "..")
}
