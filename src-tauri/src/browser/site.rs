//! Manual site controls read the owning view/store; no cookie contents cross IPC.
use std::cell::{Cell, RefCell};
use std::ptr::NonNull;
use std::rc::Rc;

use block2::RcBlock;
use objc2::{msg_send, rc::Retained, runtime::AnyObject};
use objc2_foundation::{NSArray, NSHTTPCookie};
use objc2_web_kit::WKWebView;
use serde_json::json;
use wry::WebViewExtMacOS;

use super::Reply;

#[derive(Clone)]
struct Site {
    url: String,
    parsed: url::Url,
    host: String,
}

impl Site {
    fn from_view(view: &WKWebView) -> Result<Self, String> {
        // SAFETY: callers run on the main thread with a retained native view.
        let url = unsafe { view.URL().and_then(|url| url.absoluteString()) }
            .ok_or("This page has no website address.")?
            .to_string();
        super::navigation_url(&url)?;
        let parsed = url::Url::parse(&url).map_err(|_| "This page has no website address.")?;
        let host = parsed
            .host_str()
            .ok_or("This page has no website host.")?
            .to_ascii_lowercase();
        Ok(Self { url, parsed, host })
    }
}

fn domain_matches(host: &str, domain: &str) -> bool {
    let domain = domain.to_ascii_lowercase();
    let bare = domain.trim_start_matches('.');
    !bare.is_empty()
        && (host == bare
            || (domain.starts_with('.')
                && host
                    .strip_suffix(bare)
                    .is_some_and(|prefix| prefix.ends_with('.'))))
}

fn path_matches(path: &str, cookie_path: &str) -> bool {
    let cookie_path = if cookie_path.is_empty() {
        "/"
    } else {
        cookie_path
    };
    path == cookie_path
        || path
            .strip_prefix(cookie_path)
            .is_some_and(|rest| cookie_path.ends_with('/') || rest.starts_with('/'))
}

fn cookie_in_use(site: &Site, cookie: &NSHTTPCookie) -> bool {
    cookie_applies(
        site,
        &cookie.domain().to_string(),
        &cookie.path().to_string(),
        cookie.isSecure(),
        cookie
            .expiresDate()
            .is_some_and(|date| date.timeIntervalSinceNow() <= 0.),
    )
}

fn cookie_applies(site: &Site, domain: &str, path: &str, secure: bool, expired: bool) -> bool {
    domain_matches(&site.host, domain)
        && path_matches(site.parsed.path(), path)
        && (!secure || site.parsed.scheme() == "https")
        && !expired
}

fn live_target(view: &WKWebView, session: &str, tab: &str, expected: &str) -> bool {
    super::with_tab(session, tab, |current| {
        std::ptr::eq(&**current.view.webview(), view)
            && Site::from_view(view).is_ok_and(|site| site.url == expected)
    })
    .unwrap_or(false)
}

fn connection_security(view: &WKWebView, site: &Site) -> &'static str {
    let local = site.host == "localhost"
        || site.host.ends_with(".localhost")
        || site
            .host
            .trim_matches(['[', ']'])
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if site.parsed.scheme() == "http" {
        return if local { "local" } else { "insecure" };
    }
    // SAFETY: serverTrust is a public WKWebView property. The borrowed pointer is
    // only tested for presence during this main-thread callback, never dereferenced.
    unsafe {
        let trust: *mut AnyObject = msg_send![view, serverTrust];
        https_security(
            view.isLoading(),
            !trust.is_null(),
            view.hasOnlySecureContent(),
        )
    }
}

fn https_security(loading: bool, has_trust: bool, only_secure_content: bool) -> &'static str {
    if loading || !has_trust {
        "unknown"
    } else if only_secure_content {
        "secure"
    } else {
        "insecure"
    }
}

pub(super) fn read(view: Retained<WKWebView>, session: &str, tab: &str, reply: Reply) {
    let site = match Site::from_view(&view) {
        Ok(site) => site,
        Err(error) => {
            let _ = reply.send(Err(error));
            return;
        }
    };
    let reply = Rc::new(RefCell::new(Some(reply)));
    let sid = session.to_owned();
    let tid = tab.to_owned();
    // SAFETY: this store belongs to the retained session's native view, on main.
    let store = unsafe { view.configuration().websiteDataStore().httpCookieStore() };
    let completed = RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
        let Some(reply) = reply.borrow_mut().take() else {
            return;
        };
        if !live_target(&view, &sid, &tid, &site.url) {
            let _ = reply.send(Err("The page changed. Open site information again.".into()));
            return;
        }
        // SAFETY: WebKit keeps the callback's cookie array alive for this invocation.
        let count = unsafe { cookies.as_ref() }
            .iter()
            .filter(|cookie| cookie_in_use(&site, cookie))
            .count();
        let _ = reply.send(Ok(json!({"url":site.url,"host":site.host,"security":connection_security(&view,&site),"cookieCount":count})));
    });
    // SAFETY: WebKit copies the completion block and invokes it on the main thread.
    unsafe {
        store.getAllCookies(&completed);
    }
}

pub(super) fn clear_cookies(
    view: Retained<WKWebView>,
    session: &str,
    tab: &str,
    expected: &str,
    reply: Reply,
) {
    let site = match Site::from_view(&view) {
        Ok(site) if site.url == expected => site,
        _ => {
            let _ = reply.send(Err(
                "The page changed. Open site information again before clearing its data.".into(),
            ));
            return;
        }
    };
    let reply = Rc::new(RefCell::new(Some(reply)));
    let sid = session.to_owned();
    let tid = tab.to_owned();
    // SAFETY: the store is session-owned and only accessed on main.
    let store = unsafe { view.configuration().websiteDataStore().httpCookieStore() };
    let deleting_store = store.clone();
    let completed = RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
        if !live_target(&view, &sid, &tid, &site.url) {
            if let Some(reply) = reply.borrow_mut().take() {
                let _ = reply.send(Err(
                    "The page changed. Open site information again before clearing its data."
                        .into(),
                ));
            }
            return;
        }
        // Clearing a site includes its cookies on every path, including HttpOnly
        // and intentionally shared parent-domain cookies, never unrelated hosts.
        // SAFETY: WebKit owns this array throughout the callback.
        let cookies: Vec<_> = unsafe { cookies.as_ref() }
            .iter()
            .filter(|cookie| domain_matches(&site.host, &cookie.domain().to_string()))
            .collect();
        if cookies.is_empty() {
            if let Some(reply) = reply.borrow_mut().take() {
                read(view.clone(), &sid, &tid, reply);
            }
            return;
        }
        let remaining = Rc::new(Cell::new(cookies.len()));
        for cookie in cookies {
            let remaining = Rc::clone(&remaining);
            let reply = Rc::clone(&reply);
            let view = view.clone();
            let sid = sid.clone();
            let tid = tid.clone();
            let expected = site.url.clone();
            let done = RcBlock::new(move || {
                remaining.set(remaining.get() - 1);
                if remaining.get() == 0 {
                    if let Some(reply) = reply.borrow_mut().take() {
                        if live_target(&view, &sid, &tid, &expected) {
                            read(view.clone(), &sid, &tid, reply);
                        } else {
                            let _ = reply.send(Err(
                                "The page changed while its cookies were being cleared.".into(),
                            ));
                        }
                    }
                }
            });
            // SAFETY: the cookie and owning store are retained; WebKit copies done.
            unsafe {
                deleting_store.deleteCookie_completionHandler(&cookie, Some(&done));
            }
        }
    });
    // SAFETY: WebKit copies the block and supplies its array on main.
    unsafe {
        store.getAllCookies(&completed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_scope_preserves_host_only_and_domain_boundaries() {
        assert!(domain_matches("www.example.com", ".example.com"));
        assert!(domain_matches("example.com", ".EXAMPLE.com"));
        assert!(domain_matches("www.example.com", "www.example.com"));
        assert!(!domain_matches("www.example.com", "example.com"));
        assert!(!domain_matches("other.example.com", "www.example.com"));
        assert!(!domain_matches("badexample.com", ".example.com"));
        assert!(!domain_matches("example.com.attacker.test", ".example.com"));
        assert!(!domain_matches("example.com", "."));
    }

    #[test]
    fn cookie_paths_match_components_without_sibling_prefixes() {
        assert!(path_matches("/", "/"));
        assert!(path_matches("/account/settings", "/account"));
        assert!(path_matches("/account/settings", "/account/"));
        assert!(!path_matches("/accounts", "/account"));
        assert!(!path_matches("/other", "/account"));
        assert!(path_matches("/anything", ""));
    }

    #[test]
    fn cookie_counts_exclude_other_paths_secure_http_and_expired_entries() {
        let parsed = url::Url::parse("https://www.example.com/account/profile").unwrap();
        let mut site = Site {
            url: parsed.to_string(),
            host: "www.example.com".into(),
            parsed,
        };
        assert!(cookie_applies(
            &site,
            ".example.com",
            "/account",
            true,
            false
        ));
        assert!(!cookie_applies(
            &site,
            ".example.com",
            "/elsewhere",
            false,
            false
        ));
        assert!(!cookie_applies(&site, ".example.com", "/", false, true));
        site.parsed.set_scheme("http").unwrap();
        assert!(!cookie_applies(&site, ".example.com", "/", true, false));
        assert!(cookie_applies(&site, ".example.com", "/", false, false));
    }

    #[test]
    fn secure_connection_label_requires_native_trust_and_secure_resources() {
        assert_eq!(https_security(false, true, true), "secure");
        assert_eq!(https_security(true, true, true), "unknown");
        assert_eq!(https_security(false, false, true), "unknown");
        assert_eq!(https_security(false, true, false), "insecure");
    }
}
