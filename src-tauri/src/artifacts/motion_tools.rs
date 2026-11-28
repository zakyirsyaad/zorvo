//! `render_motion` and `render_status`, answered in the backend: their answers carry images, and
//! the webview never receives one. They read and write only in the composition the session
//! showed, so they need no card and no grant.

use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use serde_json::{json, Value};

use super::motion_render::{
    is_job_id, Destination, JobState, JobView, MotionRenderer, NOT_SHOWN, NO_SUCH_JOB,
};
use crate::agent_tools::path::ToolsPath;
use crate::agent_tools::tools::MOTION_TOOL_NAMES;
use crate::agent_tools::{AgentTools, ScreenCall, ScreenTools};

/// Stills of up to four formats and twelve times may take this long, page loads included.
const STILLS_TIMEOUT: Duration = Duration::from_secs(150);
const POLL: Duration = Duration::from_millis(250);

pub struct MotionServer {
    renderer: Arc<MotionRenderer>,
    tools: OnceLock<Weak<AgentTools>>,
    me: Weak<MotionServer>,
    /// Calls that ended some other way (timed out, cancelled): a waiting status stops.
    ended: Mutex<HashSet<String>>,
}

fn text(content: impl Into<String>) -> Value {
    json!({ "type": "text", "text": content.into() })
}

/// What an agent reads about a job.
pub fn job_text(view: &JobView) -> String {
    let state = match view.state {
        JobState::Queued => "queued",
        JobState::Rendering => "rendering",
        JobState::Done => "done",
        JobState::Failed => "failed",
        JobState::Cancelled => "cancelled",
    };
    let formats: Vec<Value> = view
        .formats
        .iter()
        .map(|f| json!({ "format": f.id, "frame": f.frame, "frames": f.total, "file": f.file }))
        .collect();
    json!({ "job": view.job, "state": state, "formats": formats, "error": view.error }).to_string()
}

impl MotionServer {
    pub fn new(renderer: Arc<MotionRenderer>) -> Arc<Self> {
        Arc::new_cyclic(|me| Self {
            renderer,
            tools: OnceLock::new(),
            me: me.clone(),
            ended: Mutex::new(HashSet::new()),
        })
    }

    pub fn attach(self: &Arc<Self>, tools: &Arc<AgentTools>) {
        let _ = self.tools.set(Arc::downgrade(tools));
        tools.set_screen_tools(Arc::clone(self) as Arc<dyn ScreenTools>);
    }

    fn respond(&self, call_id: &str, outcome: Result<Vec<Value>, String>) {
        let Some(tools) = self.tools.get().and_then(Weak::upgrade) else {
            return;
        };
        match outcome {
            Ok(content) => tools.respond_content(call_id, true, content),
            Err(sentence) => tools.respond(call_id, false, &sentence),
        }
    }

    fn has_ended(&self, call_id: &str) -> bool {
        self.ended
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(call_id)
    }

    fn handle(&self, call: &ScreenCall) -> Result<Vec<Value>, String> {
        match call.tool.as_str() {
            "render_motion" => self.render_motion(call),
            "render_status" => self.render_status(call),
            _ => Err("That tool does not exist.".to_string()),
        }
    }

    fn render_motion(&self, call: &ScreenCall) -> Result<Vec<Value>, String> {
        let name = call.args["motion"].as_str().unwrap_or_default();
        let key = self
            .renderer
            .find(&call.session_id, name)
            .ok_or_else(|| NOT_SHOWN.to_string())?;
        let formats: Vec<String> = call.args["formats"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let Some(times) = call.args["frames"].as_array() else {
            let view =
                self.renderer
                    .enqueue(&call.session_id, &key, formats, Destination::Out, false)?;
            return Ok(vec![text(format!(
                "Rendering started. Call render_status with this job to follow it, and wait for it before you say the video is ready.\n{}",
                job_text(&view)
            ))]);
        };
        let times: Vec<f64> = times.iter().filter_map(Value::as_f64).collect();
        let stills =
            self.renderer
                .stills(&call.session_id, &key, formats, times, STILLS_TIMEOUT)?;
        let listed: Vec<String> = stills
            .frames
            .iter()
            .map(|(format, t, path)| format!("- {format} at {t:.2} s: {path}"))
            .collect();
        let mut content = vec![text(format!(
            "Stills of {}, with motion blur as the video will have it. The contact sheet has a row per format, times left to right. Full-size frames, relative to the motion's folder:\n{}",
            stills.title,
            listed.join("\n")
        ))];
        content.push(match call.path {
            ToolsPath::Mcp => json!({
                "type": "image",
                "data": base64::engine::general_purpose::STANDARD.encode(&stills.sheet),
                "mimeType": "image/jpeg"
            }),
            ToolsPath::Command => text(format!("Contact sheet: {}", stills.sheet_relative)),
        });
        Ok(content)
    }

    fn render_status(&self, call: &ScreenCall) -> Result<Vec<Value>, String> {
        let job = call.args["job"].as_str().unwrap_or_default();
        if !is_job_id(job) {
            return Err(NO_SUCH_JOB.to_string());
        }
        let wait = Duration::from_secs_f64(call.args["wait"].as_f64().unwrap_or(0.0));
        let started = Instant::now();
        loop {
            let view = self
                .renderer
                .job(&call.session_id, job)
                .ok_or_else(|| NO_SUCH_JOB.to_string())?;
            let is_open = matches!(view.state, JobState::Queued | JobState::Rendering);
            if !is_open || started.elapsed() >= wait || self.has_ended(&call.call_id) {
                return Ok(vec![text(job_text(&view))]);
            }
            thread::sleep(POLL);
        }
    }
}

impl ScreenTools for MotionServer {
    fn offers(&self, tool: &str) -> bool {
        MOTION_TOOL_NAMES.contains(&tool)
    }

    fn call(&self, call: ScreenCall) {
        let Some(server) = self.me.upgrade() else {
            return;
        };
        let call_id = call.call_id.clone();
        let spawned = thread::Builder::new().spawn(move || {
            let outcome = server.handle(&call);
            server.respond(&call.call_id, outcome);
            server
                .ended
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&call.call_id);
        });
        if spawned.is_err() {
            self.respond(&call_id, Err("Rendering is not available.".to_string()));
        }
    }

    fn ended(&self, call_id: &str) {
        self.ended
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(call_id.to_string());
    }

    fn forget(&self, session: &str) {
        self.renderer.forget(session, false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifacts::motion_render::FormatProgress;

    #[test]
    fn job_text_is_json_an_agent_reads() {
        let view = JobView {
            job: "r-0123456789abcdef".into(),
            session_id: "s".into(),
            key: "m-0123456789abcdef".into(),
            state: JobState::Done,
            formats: vec![FormatProgress {
                id: "wide".into(),
                frame: 900,
                total: 900,
                file: Some("out/wide.mp4".into()),
            }],
            error: None,
            by_user: false,
            saved: 0,
        };
        let parsed: Value = serde_json::from_str(&job_text(&view)).expect("json");
        assert_eq!(parsed["state"], "done");
        assert_eq!(parsed["formats"][0]["file"], "out/wide.mp4");
    }
}
