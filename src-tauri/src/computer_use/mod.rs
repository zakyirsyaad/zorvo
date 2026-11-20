//! Computer use: agents see and operate apps on the user's Mac through
//! trycua's cua-driver, behind grants Zorvo owns.
//!
//! `driver` finds and checks the driver Zorvo ships; `worker` talks to it;
//! `state` holds the switch and the one running driver; `permissions` reads
//! and asks for Zorvo's own macOS permissions.
//! Agents never reach the driver: Zorvo's backend is its only client.

pub mod apps;
pub mod commands;
pub mod driver;
pub mod gate;
pub mod grants;
pub mod images;
pub mod instructions;
pub mod permissions;
pub mod pill;
pub mod requests;
pub mod server;
pub mod state;
pub mod tiers;
pub mod worker;

pub use apps::AppIdentity;
pub use driver::{DriverPin, DriverUnavailable};
pub use permissions::ComputerUseStatus;
pub use server::{Hooks, ScreenServer};
pub use state::{ComputerUse, DriverStarter, NoDriver};
pub use tiers::{Action, Tier};
pub use worker::{CallId, DriverClient, DriverError, SessionHandle, StartOptions};
