//! Turns a registry entry into an [`AgentProfile`] the rest of the app can launch.
//! The webview never supplies a program or args; they come from the pinned entry.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use crate::env_resolver::find_binary_in_path_str;
use crate::installer::npm_bin::{package_name, recorded_program};
use crate::installer::plan::{InstalledTools, PlannedStep};
use crate::installer::prerequisites::{prerequisites_for, Prerequisite};
use crate::installer::runtimes::{RuntimeKind, MIN_USER_NODE_MAJOR};
use crate::profiles::AgentProfile;
use crate::registry::cli_launch::{cli_launch_for, is_new_enough, CliLaunch};
use crate::registry::schema::{current_platform, BinaryTarget, Distribution, RegistryEntry};

/// Old built-in profile ids and the registry ids that replace them.
pub const LEGACY_IDS: [(&str, &str); 3] = [
    ("claude-code", "claude-acp"),
    ("codex", "codex-acp"),
    ("qwen", "qwen-code"),
];

pub const SOURCE_REGISTRY: &str = "registry";
pub const AVAILABILITY_READY: &str = "ready";
pub const AVAILABILITY_NEEDS_RUNTIME: &str = "needs_runtime";
pub const AVAILABILITY_NOT_INSTALLED: &str = "not_installed";
/// A binary agent with no build for this Mac: listed in the catalog, never run.
pub const AVAILABILITY_UNSUPPORTED: &str = "unsupported";

/// Maps a legacy built-in id to its registry id; other ids come back unchanged.
pub fn canonical_agent_id(id: &str) -> &str {
    LEGACY_IDS
        .iter()
        .find(|(legacy, _)| *legacy == id)
        .map_or(id, |(_, canonical)| canonical)
}

/// What this machine has: the login-shell `PATH`, globally installed npm
/// packages, and what Zorvo installed itself.
pub struct SystemTools<'a> {
    pub path_var: Option<&'a str>,
    pub npm_globals: &'a BTreeSet<String>,
    pub installed: &'a InstalledTools,
}

impl SystemTools<'_> {
    fn locate(&self, binary: &str) -> Option<String> {
        self.path_var
            .and_then(|path_var| find_binary_in_path_str(binary, path_var))
            .map(|path| path.to_string_lossy().to_string())
    }

    /// The user's own Node is used only from [`MIN_USER_NODE_MAJOR`] on.
    fn user_node_is_usable(&self) -> bool {
        self.installed
            .user_node_major
            .is_some_and(|major| major >= MIN_USER_NODE_MAJOR)
    }

    fn pinned_installed(&self, kind: RuntimeKind) -> bool {
        match kind {
            RuntimeKind::Node => self.installed.pinned_node_installed,
            RuntimeKind::Uv => self.installed.pinned_uv_installed,
        }
    }

    /// [`first_user_program`] on this machine's `PATH`.
    fn locate_user_installed(&self, binary: &str) -> Option<String> {
        first_user_program(binary, self.path_var?)
    }
}

/// The first `binary` on `path_var` that is not one of Apple's system tools,
/// so a binary agent named like one never counts as installed.
pub fn first_user_program(binary: &str, path_var: &str) -> Option<String> {
    path_var
        .split(':')
        .filter_map(|dir| find_binary_in_path_str(binary, dir))
        .find(|path| !is_system_tool(path))
        .map(|path| path.to_string_lossy().to_string())
}

/// The user's CLI that runs a binary agent in place of the registry's program.
struct UserCli {
    launch: &'static CliLaunch,
    path: String,
}

/// The CLI [`cli_launch_for`] names for `entry`, when it is on `PATH` and
/// reported a version from its minimum on.
fn user_cli(entry: &RegistryEntry, tools: &SystemTools) -> Option<UserCli> {
    let launch = cli_launch_for(&entry.id)?;
    let path = tools.locate_user_installed(launch.program)?;
    let version = tools.installed.cli_versions.get(&path)?;
    is_new_enough(version, launch.min_version).then_some(UserCli { launch, path })
}

/// Where Apple keeps its own command-line tools and developer tools.
pub const SYSTEM_TOOL_DIRS: &[&str] = &[
    "/usr/bin/",
    "/bin/",
    "/usr/sbin/",
    "/sbin/",
    "/System/",
    "/Library/Developer/",
    "/Applications/Xcode",
];

/// True when `path` is inside one of [`SYSTEM_TOOL_DIRS`].
pub fn is_system_tool_path(path: &str) -> bool {
    SYSTEM_TOOL_DIRS.iter().any(|dir| path.starts_with(dir))
}

/// [`is_system_tool_path`] for `path` as found or as it resolves through symlinks.
fn is_system_tool(path: &Path) -> bool {
    is_system_tool_path(&path.to_string_lossy())
        || std::fs::canonicalize(path)
            .is_ok_and(|real| is_system_tool_path(&real.to_string_lossy()))
}

fn basename(cmd: &str) -> &str {
    cmd.rsplit('/').next().unwrap_or(cmd)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

/// Where the agent's program was found, and the `PATH` changes it runs with.
struct Located {
    path: String,
    prepend: Vec<String>,
    append: Vec<String>,
}

impl Located {
    fn as_is(path: String) -> Self {
        Self {
            path,
            prepend: Vec::new(),
            append: Vec::new(),
        }
    }
}

/// How the agent's own program resolves, before its prerequisites.
enum Program {
    Found(Located),
    /// Neither the user's runtime nor Zorvo's can run it. Holds the user's
    /// own tool when it was found but cannot be used (`npx` with too old a Node).
    NeedsRuntime(Option<String>),
    /// A binary agent with no copy on `PATH` or from Zorvo, or an npx agent
    /// whose package Zorvo has not installed.
    NotInstalled,
}

/// Everything decided about one entry on this machine.
struct Resolution<'e> {
    kind: &'static str,
    command: String,
    args: Vec<String>,
    /// `args` without the entry's own arguments: the agent's interactive setup.
    setup_args: Vec<String>,
    installed_on_system: bool,
    program: Program,
    /// Zorvo's runtime, when the user's own cannot run the agent.
    zorvo_runtime: Option<RuntimeKind>,
    /// The current platform's target of a binary agent.
    target: Option<&'e BinaryTarget>,
    missing_prerequisites: Vec<&'static Prerequisite>,
    /// The `bin` dirs of Zorvo's prerequisites the agent uses.
    prerequisite_bins: Vec<String>,
}

impl Resolution<'_> {
    fn availability(&self) -> &'static str {
        if self.kind == "binary" && self.target.is_none() {
            return AVAILABILITY_UNSUPPORTED;
        }
        match self.program {
            Program::NeedsRuntime(_) => AVAILABILITY_NEEDS_RUNTIME,
            Program::NotInstalled => AVAILABILITY_NOT_INSTALLED,
            Program::Found(_) if !self.missing_prerequisites.is_empty() => {
                AVAILABILITY_NOT_INSTALLED
            }
            Program::Found(_) => AVAILABILITY_READY,
        }
    }
}

/// The program an npx agent's install recorded, when that file is there.
/// A record without one, or one whose file is gone, counts as no install.
fn installed_npm_program(entry: &RegistryEntry, tools: &SystemTools) -> Option<String> {
    let key = (entry.id.clone(), entry.version.clone());
    let dir = tools.installed.agents.get(&key)?;
    let bin = tools.installed.agent_bins.get(&key)?;
    recorded_program(dir, bin).map(|program| path_string(&program))
}

/// An npx agent runs from Zorvo's install of its package, never through
/// `npx`. It needs a Node: the user's when it is new enough, else Zorvo's,
/// first on `PATH` so the program's `#!/usr/bin/env node` cannot pick up the
/// user's older Node.
fn npm_agent_program(entry: &RegistryEntry, tools: &SystemTools) -> (Program, Option<RuntimeKind>) {
    let installed = installed_npm_program(entry, tools);
    if tools.user_node_is_usable() && tools.locate("npx").is_some() {
        let program = installed.map_or(Program::NotInstalled, |path| {
            Program::Found(Located::as_is(path))
        });
        return (program, None);
    }
    let program = match (&tools.installed.node, installed) {
        (None, _) => Program::NeedsRuntime(tools.locate("npx")),
        (Some(_), None) => Program::NotInstalled,
        (Some(node), Some(path)) => Program::Found(Located {
            path,
            prepend: vec![path_string(&node.bin_dir)],
            append: Vec::new(),
        }),
    };
    (program, Some(RuntimeKind::Node))
}

/// The user's `uvx` of any version, else Zorvo's, appended to `PATH`.
fn uvx_program(tools: &SystemTools) -> (Program, Option<RuntimeKind>) {
    if let Some(path) = tools.locate("uvx") {
        return (Program::Found(Located::as_is(path)), None);
    }
    let program = tools
        .installed
        .uv
        .as_ref()
        .map_or(Program::NeedsRuntime(None), |uv| {
            Program::Found(Located {
                path: path_string(&uv.bin_dir.join("uvx")),
                prepend: Vec::new(),
                append: vec![path_string(&uv.bin_dir)],
            })
        });
    (program, Some(RuntimeKind::Uv))
}

/// The user's CLI for the agent, else the `cmd` basename on `PATH` outside
/// Apple's system tool dirs, else Zorvo's copy at the entry's version, run by
/// its full path inside the install dir.
fn binary_program(
    entry: &RegistryEntry,
    target: &BinaryTarget,
    cli: Option<&UserCli>,
    tools: &SystemTools,
) -> Program {
    if let Some(cli) = cli {
        return Program::Found(Located::as_is(cli.path.clone()));
    }
    if let Some(path) = tools.locate_user_installed(basename(&target.cmd)) {
        return Program::Found(Located::as_is(path));
    }
    let key = (entry.id.clone(), entry.version.clone());
    tools
        .installed
        .agents
        .get(&key)
        .map_or(Program::NotInstalled, |dir| {
            let relative = target.cmd.strip_prefix("./").unwrap_or(&target.cmd);
            Program::Found(Located::as_is(path_string(&dir.join(relative))))
        })
}

fn resolve<'e>(entry: &'e RegistryEntry, tools: &SystemTools) -> Resolution<'e> {
    let cli = user_cli(entry, tools);
    // `setup_args` is the same launch without the entry's own arguments, which are its ACP flags.
    let (kind, command, args, setup_args, installed_on_system, target) = match &entry.distribution {
        // `npx` here only names the kind: the program is the installed package's own.
        Distribution::Npx { package, args, .. } => (
            "npx",
            "npx".to_string(),
            args.clone(),
            Vec::new(),
            tools.npm_globals.contains(package_name(package)),
            None,
        ),
        Distribution::Uvx { package, args, .. } => (
            "uvx",
            "uvx".to_string(),
            [vec![package.clone()], args.clone()].concat(),
            vec![package.clone()],
            false,
            None,
        ),
        Distribution::Binary { platforms } => {
            let target = platforms.get(current_platform());
            // The CLI's own arguments replace the registry build's.
            let (command, args, installed) = match &cli {
                Some(cli) => (cli.launch.program.to_string(), cli.launch.args(), true),
                None => {
                    let command = target.map_or_else(String::new, |t| basename(&t.cmd).to_string());
                    let args = target.map_or_else(Vec::new, |t| t.args.clone());
                    // Apple's own tools never count as the agent (see `first_user_program`).
                    let installed = tools.locate_user_installed(&command).is_some();
                    (command, args, installed)
                }
            };
            ("binary", command, args, Vec::new(), installed, target)
        }
    };
    let (program, zorvo_runtime) = match (kind, target) {
        ("npx", _) => npm_agent_program(entry, tools),
        ("uvx", _) => uvx_program(tools),
        (_, Some(target)) => (binary_program(entry, target, cli.as_ref(), tools), None),
        (_, None) => (Program::NotInstalled, None),
    };

    // The user's own copy first, then Zorvo's.
    let not_on_path: Vec<&'static Prerequisite> = prerequisites_for(&entry.id)
        .iter()
        .filter(|p| tools.locate(p.command).is_none())
        .collect();
    let prerequisite_bins = not_on_path
        .iter()
        .filter_map(|p| tools.installed.prereq_bins.get(p.command))
        .map(|bin| path_string(bin))
        .collect();
    let missing_prerequisites = not_on_path
        .into_iter()
        .filter(|p| !tools.installed.prereq_bins.contains_key(p.command))
        .collect();

    Resolution {
        kind,
        command,
        args,
        setup_args,
        installed_on_system,
        program,
        zorvo_runtime,
        target,
        missing_prerequisites,
        prerequisite_bins,
    }
}

/// What an install of `entry` would do, in order: Zorvo's pinned runtime when
/// the agent depends on it and it is not installed yet, the missing
/// prerequisites, then the agent's own archive or npm package. Empty when the
/// agent is ready.
pub fn planned_steps(entry: &RegistryEntry, tools: &SystemTools) -> Vec<PlannedStep> {
    steps_for(entry, &resolve(entry, tools), tools)
}

fn steps_for(
    entry: &RegistryEntry,
    resolution: &Resolution,
    tools: &SystemTools,
) -> Vec<PlannedStep> {
    if resolution.availability() == AVAILABILITY_READY {
        return Vec::new();
    }
    let runtime = resolution
        .zorvo_runtime
        .filter(|kind| !tools.pinned_installed(*kind))
        .map(PlannedStep::Runtime);
    let prerequisites = resolution
        .missing_prerequisites
        .iter()
        .map(|p| PlannedStep::Prerequisite(p));
    let agent = match (&resolution.program, resolution.target) {
        (Program::NotInstalled, Some(target)) => Some(PlannedStep::Agent {
            id: entry.id.clone(),
            name: entry.name.clone(),
            version: entry.version.clone(),
            url: target.archive.clone(),
            sha256: target.sha256.clone(),
            cmd: target.cmd.clone(),
        }),
        _ => npm_agent_step(entry, tools),
    };
    runtime
        .into_iter()
        .chain(prerequisites)
        .chain(agent)
        .collect()
}

/// The npm install of an npx agent whose package Zorvo has not installed.
fn npm_agent_step(entry: &RegistryEntry, tools: &SystemTools) -> Option<PlannedStep> {
    let Distribution::Npx { package, .. } = &entry.distribution else {
        return None;
    };
    installed_npm_program(entry, tools)
        .is_none()
        .then(|| PlannedStep::NpmAgent {
            id: entry.id.clone(),
            name: entry.name.clone(),
            version: entry.version.clone(),
            package: package.clone(),
        })
}

/// False only for a binary agent with no build for this Mac.
pub fn is_supported(entry: &RegistryEntry) -> bool {
    match &entry.distribution {
        Distribution::Binary { platforms } => platforms.contains_key(current_platform()),
        _ => true,
    }
}

/// Where an agent stands on this Mac, for the catalog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallStatus {
    /// Installed by Zorvo, or run on Zorvo's own Node.js or uv.
    ByZorvo,
    /// Found outside Zorvo: `location` is the program for a binary agent and
    /// `None` for a globally installed npm package.
    OnYourMac {
        location: Option<String>,
    },
    /// Runs on the user's own tools; nothing to install.
    Ready,
    NotInstalled,
    /// A binary agent with no build for this Mac.
    Unsupported,
}

impl InstallStatus {
    /// True for a binary found on the user's PATH, which Zorvo does not manage.
    pub fn is_user_binary(&self) -> bool {
        matches!(self, InstallStatus::OnYourMac { location: Some(_) })
    }
}

/// [`InstallStatus`] of `entry` on the machine described by `tools`.
pub fn install_status(entry: &RegistryEntry, tools: &SystemTools) -> InstallStatus {
    let resolution = resolve(entry, tools);
    match resolution.availability() {
        AVAILABILITY_UNSUPPORTED => return InstallStatus::Unsupported,
        AVAILABILITY_READY => {}
        _ => return InstallStatus::NotInstalled,
    }
    let program = match &resolution.program {
        Program::Found(located) => Some(located.path.clone()),
        _ => None,
    };
    // A ready npx agent always runs Zorvo's install, whatever the user has globally.
    if resolution.kind == "npx" {
        return InstallStatus::ByZorvo;
    }
    if resolution.installed_on_system {
        let location = (resolution.kind == "binary").then_some(program).flatten();
        return InstallStatus::OnYourMac { location };
    }
    let from_zorvo_tools = resolution.kind == "binary" && program.is_some();
    if resolution.zorvo_runtime.is_some() || from_zorvo_tools {
        InstallStatus::ByZorvo
    } else {
        InstallStatus::Ready
    }
}

pub fn resolve_profile(entry: &RegistryEntry, tools: &SystemTools, listed: bool) -> AgentProfile {
    let resolution = resolve(entry, tools);
    let availability = resolution.availability();
    let install_plan = (availability != AVAILABILITY_READY
        && availability != AVAILABILITY_UNSUPPORTED)
        .then(|| {
            steps_for(entry, &resolution, tools)
                .iter()
                .map(|step| step.display(tools.installed.manifest.as_ref(), current_platform()))
                .collect()
        });
    let (program_path, unusable, prepend, append) = match resolution.program {
        Program::Found(located) => (
            Some(located.path),
            None,
            located.prepend,
            [located.append, resolution.prerequisite_bins].concat(),
        ),
        Program::NeedsRuntime(unusable) => (None, unusable, Vec::new(), Vec::new()),
        Program::NotInstalled => (None, None, Vec::new(), Vec::new()),
    };

    let mut profile = AgentProfile::new(
        entry.id.clone(),
        entry.name.clone(),
        resolution.command.clone(),
    );
    profile.acp_program = Some(resolution.command);
    profile.acp_args = resolution.args;
    profile.setup_args = resolution.setup_args;
    profile.detected = availability == AVAILABILITY_READY;
    profile.detected_path = program_path.clone().or(unusable);
    profile.acp_program_path = program_path;
    profile.acp_path_prepend = prepend;
    profile.acp_path_append = append;
    profile.version = Some(entry.version.clone());
    profile.distribution = Some(resolution.kind.to_string());
    profile.availability = availability.to_string();
    profile.install_plan = install_plan;
    profile.description = entry.description.clone();
    profile.installed_on_system = resolution.installed_on_system;
    profile.listed = listed;
    profile
}

/// The environment variables the registry sets for this entry: the package's
/// own, or the current platform's target for a binary.
pub fn registry_env(entry: &RegistryEntry) -> BTreeMap<String, String> {
    match &entry.distribution {
        Distribution::Npx { env, .. } | Distribution::Uvx { env, .. } => env.clone(),
        Distribution::Binary { platforms } => platforms
            .get(current_platform())
            .map(|target| target.env.clone())
            .unwrap_or_default(),
    }
}

/// Why a profile cannot run, for the launch error; `None` when it is ready.
pub fn missing_reason(profile: &AgentProfile) -> Option<String> {
    match profile.availability.as_str() {
        AVAILABILITY_NEEDS_RUNTIME => {
            let (runtime, tool) = match profile.distribution.as_deref() {
                Some("uvx") => ("uv", "uvx"),
                _ => ("Node.js", "npx"),
            };
            // `npx` was found, so it is the user's Node that is too old.
            if tool == "npx" && profile.detected_path.is_some() {
                return Some(format!(
                    "{} needs Node.js {MIN_USER_NODE_MAJOR} or newer",
                    profile.name
                ));
            }
            Some(format!(
                "{} needs {runtime} ({tool}), which was not found",
                profile.name
            ))
        }
        AVAILABILITY_NOT_INSTALLED => Some(match missing_prerequisite(profile) {
            Some(command) => format!("{} needs {command}, which was not found", profile.name),
            None if profile.distribution.as_deref() == Some("npx") => {
                format!("{} is not installed", profile.name)
            }
            None => format!(
                "{} is not installed ({} was not found on PATH)",
                profile.name, profile.command
            ),
        }),
        _ => None,
    }
}

/// The first missing prerequisite of an agent whose own program was found.
fn missing_prerequisite(profile: &AgentProfile) -> Option<&str> {
    profile.acp_program_path.as_ref()?;
    profile
        .install_plan
        .iter()
        .flatten()
        .find(|step| step.kind == "prerequisite")
        .map(|step| step.name.as_str())
}
