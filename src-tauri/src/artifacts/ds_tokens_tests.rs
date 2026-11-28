//! Tests of `ds_tokens.rs`, kept apart so the module stays short.

use super::*;

const TWO_THEMES: &str =
    r#""themes": [{"id": "dark", "name": "Dark"}, {"id": "light", "name": "Light"}]"#;

fn read(json: &str) -> DsTokens {
    parse_tokens(json.as_bytes()).expect("tokens read")
}

fn zorvo() -> DsTokens {
    parse_tokens(include_bytes!("../../../docs/design-system/tokens.json"))
        .expect("Zorvo's tokens read")
}

/// One family's tokens beside two themes.
fn family(name: &str, tokens: &str) -> DsTokens {
    if name == "color" {
        return read(&format!(
            r#"{{"color": {{{TWO_THEMES}, "tokens": [{tokens}]}}}}"#
        ));
    }
    read(&format!(
        r#"{{"color": {{{TWO_THEMES}, "tokens": []}}, "{name}": {{"tokens": [{tokens}]}}}}"#
    ))
}

fn token<'a>(tokens: &'a DsTokens, name: &str) -> Option<&'a DsToken> {
    tokens.tokens.iter().find(|token| token.name == name)
}

fn reason_of(tokens: &DsTokens, name: &str) -> Option<&'static str> {
    tokens
        .dropped
        .iter()
        .find(|drop| drop.name == name)
        .map(|drop| drop.reason)
}

fn dropped(family: &str, name: &str, reason: &'static str) -> DsDropped {
    DsDropped {
        family: family.into(),
        name: name.into(),
        reason,
    }
}

#[test]
fn top_level_name_version_and_meta_are_not_families() {
    let tokens = zorvo();
    for skipped in ["name", "version", "meta", "type"] {
        assert!(
            tokens.tokens.iter().all(|t| t.family != skipped),
            "{skipped}"
        );
        assert!(
            tokens.dropped.iter().all(|d| d.family != skipped),
            "{skipped}"
        );
    }
}

#[test]
fn zorvos_tokens_read_with_nothing_dropped() {
    let tokens = zorvo();
    let ids: Vec<&str> = tokens.themes.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["dark", "light"]);
    assert_eq!(tokens.dropped, Vec::new());
    assert_eq!(
        tokens.tokens.iter().filter(|t| t.family == "color").count(),
        39
    );
    let families: Vec<&str> = tokens
        .families
        .iter()
        .map(|(name, _)| name.as_str())
        .collect();
    assert_eq!(families, ["sans", "mono"]);
    assert_eq!(
        tokens.source,
        Some(DsSource::Code {
            paths: vec![
                "src/styles/globals.css".into(),
                "docs/brand/zorvo-brand-brief.md".into(),
                "docs/brand/assets/".into(),
                "src-tauri/icons/icon.png".into(),
            ],
            commit: Some("8b5a02f".into()),
        })
    );
    let popover = token(&tokens, "shadow-popover").expect("a shadow");
    assert_eq!(popover.values[1], "0 12px 32px -8px rgba(9,9,11,0.18)");
    assert!(token(&tokens, "ease-soft").is_some());
    assert!(!tokens.styles.is_empty());
}

#[test]
fn each_reason_drops_one_token() {
    let tokens = parse_tokens(include_bytes!("../../tests/fixtures/ds-tokens-mixed.json"))
        .expect("the fixture reads");
    assert_eq!(
        tokens.dropped,
        vec![
            dropped("color", "red", "named colour"),
            dropped("color", "brand", "var()"),
            dropped("color", "mixed", "color-mix()"),
            dropped("color", "ghost", "missing alias"),
            dropped("color", "self", "alias of itself"),
            dropped("color", "loop-a", "alias of itself"),
            dropped("color", "loop-b", "alias of itself"),
            dropped("color", "accent", "duplicate name"),
            dropped("color", "empty", "no value"),
            dropped("spacing", "space-odd", "bad length"),
            dropped("elevation", "", "not a list"),
        ]
    );
    let accent = token(&tokens, "accent").expect("the first accent stays");
    assert_eq!(accent.values, ["#111", "#eee"]);
    assert_eq!(accent.usage.as_deref(), Some("Links and focus rings."));
    assert_eq!(
        tokens.source,
        Some(DsSource::Code {
            paths: vec!["src/app.css".into()],
            commit: Some("a1b2c3d".into())
        })
    );
}

#[test]
fn a_token_without_the_first_theme_drops_with_no_value() {
    let tokens = family(
        "color",
        r##"{"name": "paper", "value": {"light": "#fff"}}"##,
    );
    assert_eq!(tokens.dropped, vec![dropped("color", "paper", "no value")]);
    assert!(tokens.tokens.is_empty());
}

#[test]
fn a_missing_theme_inherits_the_first() {
    let tokens = family("color", r##"{"name": "ink", "value": {"dark": "#000"}}"##);
    assert_eq!(token(&tokens, "ink").unwrap().values, ["#000", "#000"]);
}

#[test]
fn aliases_resolve_per_theme() {
    let tokens = read(&format!(
        r##"{{"color": {{{TWO_THEMES}, "tokens": [
            {{"name": "accent", "value": {{"dark": "#111", "light": "#eee"}}}},
            {{"name": "link", "value": "{{accent}}"}},
            {{"name": "gap-colour", "value": "{{gap}}"}}
        ]}}, "spacing": {{"tokens": [{{"name": "gap", "value": "4px"}}]}}}}"##
    ));
    assert_eq!(token(&tokens, "link").unwrap().values, ["#111", "#eee"]);
    assert_eq!(reason_of(&tokens, "gap-colour"), Some("missing alias"));
}

#[test]
fn colour_functions_cannot_nest() {
    let tokens = family(
        "color",
        r##"{"name": "a", "value": "rgb(var(--x))"},
            {"name": "b", "value": "color-mix(in srgb, #000, #fff)"},
            {"name": "c", "value": "red"},
            {"name": "d", "value": "oklch(calc(1) 0 0)"},
            {"name": "e", "value": "oklch(0.7 0.1 250deg / 50%)"},
            {"name": "f", "value": "#abcd"},
            {"name": "g", "value": "#abcde"}"##,
    );
    assert_eq!(reason_of(&tokens, "a"), Some("var()"));
    assert_eq!(reason_of(&tokens, "b"), Some("color-mix()"));
    assert_eq!(reason_of(&tokens, "c"), Some("named colour"));
    assert_eq!(reason_of(&tokens, "d"), Some("named colour"));
    assert!(token(&tokens, "e").is_some());
    assert!(token(&tokens, "f").is_some());
    assert_eq!(reason_of(&tokens, "g"), Some("named colour"));
}

#[test]
fn shadow_takes_lengths_colours_inset_and_commas() {
    let tokens = family(
        "shadow",
        r##"{"name": "a", "value": "0 1px 2px rgba(0,0,0,.2), inset 0 0 0 1px #fff"},
            {"name": "b", "value": "0 12px 32px -8px rgba(9,9,11,0.18)"},
            {"name": "c", "value": "0 0 4px red"}"##,
    );
    assert!(token(&tokens, "a").is_some());
    assert!(token(&tokens, "b").is_some());
    assert_eq!(reason_of(&tokens, "c"), Some("named colour"));
}

#[test]
fn motion_takes_times_beziers_and_keywords() {
    let tokens = family(
        "motion",
        r#"{"name": "a", "value": "120ms"},
           {"name": "b", "value": ".2s"},
           {"name": "c", "value": "cubic-bezier(0.2, 0.8, 0.2, 1)"},
           {"name": "d", "value": "ease-in-out"},
           {"name": "e", "value": "cubic-bezier(1,2,3)"}"#,
    );
    for name in ["a", "b", "c", "d"] {
        assert!(token(&tokens, name).is_some(), "{name}");
    }
    assert_eq!(reason_of(&tokens, "e"), Some("bad length"));
}

#[test]
fn lengths_take_px_rem_em_percent_and_numbers() {
    let tokens = family(
        "radius",
        r#"{"name": "a", "value": "4px"}, {"name": "b", "value": "-0.5rem"},
           {"name": "c", "value": "1.25em"}, {"name": "d", "value": "50%"},
           {"name": "e", "value": 9999}, {"name": "f", "value": "4 px"}"#,
    );
    for name in ["a", "b", "c", "d", "e"] {
        assert!(token(&tokens, name).is_some(), "{name}");
    }
    assert_eq!(token(&tokens, "e").unwrap().values, ["9999", "9999"]);
    assert_eq!(reason_of(&tokens, "f"), Some("bad length"));
}

#[test]
fn other_families_refuse_stylesheet_breakers() {
    let tokens = family(
        "opacity",
        r#"{"name": "a", "value": "0.5"}, {"name": "b", "value": "a;b"},
           {"name": "c", "value": "url(x)"}, {"name": "d", "value": "expression(1)"},
           {"name": "e", "value": "<"}"#,
    );
    assert!(token(&tokens, "a").is_some());
    for name in ["b", "c", "d", "e"] {
        assert_eq!(reason_of(&tokens, name), Some("bad length"), "{name}");
    }
}

#[test]
fn a_w3c_map_reads_as_an_empty_family() {
    let tokens = read(r#"{"spacing": {"sm": {"$value": "4px"}}}"#);
    assert_eq!(tokens.dropped, vec![dropped("spacing", "", "not a list")]);
    assert!(tokens.tokens.is_empty());
}

#[test]
fn bad_theme_ids_are_dropped() {
    let tokens = read(
        r##"{"color": {"themes": [{"id": "has space"}, {"id": "dark", "name": "Dark"}, {"id": 3}],
            "tokens": [{"name": "ink", "value": "#000"}]}}"##,
    );
    let ids: Vec<&str> = tokens.themes.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["dark"]);
    let tokens = read(r##"{"color": {"themes": [{"id": "has space"}], "tokens": []}}"##);
    let ids: Vec<&str> = tokens.themes.iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, ["default"]);
    assert!(is_theme_id("high-contrast_2"));
    assert!(!is_theme_id(""));
    assert!(!is_theme_id(&"a".repeat(33)));
    assert!(!is_theme_id("a/b"));
}

#[test]
fn references_source_reads_files() {
    let tokens =
        read(r#"{"meta": {"source": {"kind": "references", "files": ["brand/logo.svg"]}}}"#);
    assert_eq!(
        tokens.source,
        Some(DsSource::References {
            files: vec!["brand/logo.svg".into()]
        })
    );
    assert_eq!(
        read(r#"{"meta": {"source": {"kind": "magic"}}}"#).source,
        None
    );
}

#[test]
fn names_are_checked_once_across_families_but_type() {
    let tokens = read(
        r##"{"color": {"tokens": [{"name": "gap", "value": "#000"}]},
            "spacing": {"tokens": [{"name": "gap", "value": "4px"}, {"name": "-bad", "value": "4px"}]},
            "type": {"families": {"gap": "serif"}}}"##,
    );
    assert_eq!(
        tokens.dropped,
        vec![dropped("spacing", "gap", "duplicate name")]
    );
    assert_eq!(tokens.tokens.len(), 1);
}

#[test]
fn type_reads_fonts_families_and_styles() {
    let tokens = read(
        r#"{"type": {
            "fonts": [
              {"family": "Acme", "file": "fonts/Acme.woff2", "weight": 600, "style": "italic"},
              {"family": "Inter", "weight": 1000},
              {"weight": 400}
            ],
            "families": {"sans": "Acme, sans-serif", "mono": 4},
            "groups": [{"name": "App", "family": "sans", "styles": [
              {"name": "title", "fontSize": "20px", "lineHeight": "28px", "fontWeight": 600, "letterSpacing": "-0.01em"},
              {"name": "body", "fontSize": "14px", "lineHeight": "20px", "fontWeight": 400, "family": "mono"},
              {"name": "broken", "fontSize": "14px"}
            ]}]
        }}"#,
    );
    assert_eq!(
        tokens.fonts,
        vec![
            DsFont {
                family: "Acme".into(),
                file: Some("fonts/Acme.woff2".into()),
                weight: Some(600),
                style: Some("italic".into())
            },
            DsFont {
                family: "Inter".into(),
                file: None,
                weight: None,
                style: None
            },
        ]
    );
    assert_eq!(
        tokens.families,
        vec![("sans".to_string(), "Acme, sans-serif".to_string())]
    );
    assert_eq!(tokens.styles.len(), 2);
    assert_eq!(tokens.styles[0].group, "App");
    assert_eq!(tokens.styles[0].letter_spacing.as_deref(), Some("-0.01em"));
    assert_eq!(tokens.styles[0].family.as_deref(), Some("sans"));
    assert_eq!(tokens.styles[1].family.as_deref(), Some("mono"));
    assert_eq!(tokens.styles[1].font_weight, 400);
}

#[test]
fn the_hash_follows_the_name_and_values() {
    let one = family("radius", r#"{"name": "r", "value": "4px"}"#);
    let two = family("radius", r#"{"name": "r", "value": "6px"}"#);
    let hash = &token(&one, "r").unwrap().hash;
    assert_eq!(hash.len(), 16);
    assert_eq!(
        hash,
        &token(&family("radius", r#"{"name": "r", "value": "4px"}"#), "r")
            .unwrap()
            .hash
    );
    assert_ne!(hash, &token(&two, "r").unwrap().hash);
}

#[test]
fn no_color_themes_means_one_default_theme() {
    let tokens = read(r#"{"spacing": {"tokens": [{"name": "s", "value": "4px"}]}}"#);
    assert_eq!(
        tokens.themes,
        vec![DsTheme {
            id: "default".into(),
            name: "Default".into()
        }]
    );
    assert_eq!(token(&tokens, "s").unwrap().values, ["4px"]);
}

#[test]
fn refuses_only_size_utf8_json_and_non_objects() {
    let secret = "SECRETTEXT";
    let big = format!(r#"{{"note": "{secret}{}"}}"#, "x".repeat(MAX_TOKENS_BYTES));
    for bytes in [
        big.into_bytes(),
        vec![b'{', 0xff, b'}'],
        format!(r#"["{secret}"]"#).into_bytes(),
        format!(r#"{{"{secret}""#).into_bytes(),
    ] {
        let error = parse_tokens(&bytes).expect_err("refused");
        assert!(error.starts_with("tokens.json: "), "{error}");
        assert!(!error.contains(secret), "{error}");
    }
}
