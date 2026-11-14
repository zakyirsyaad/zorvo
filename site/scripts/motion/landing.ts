// The landing page's motion: GSAP for the scenes (a timeline each), Motion for springs and gestures.
// A port of the approved design's script, with the same timelines, durations, eases and staggers.
//
// It is the only script the site ships, bundled to /motion.js by scripts/build-motion.mjs, and it keeps
// three safety properties:
//   1. Every animation starts from a state the page's own CSS already shows (a `from`, or a state
//      hidden here and shown again), so the HTML is complete and readable without this script.
//   2. Nothing runs under prefers-reduced-motion: reduce.
//   3. GSAP and Motion never animate `transform` on the same element (a test pins the data hooks).
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { animate, hover, inView, press, stagger } from "motion";

const ROOT = "[data-landing]";
// A scene plays once, when its trigger reaches 72% of the viewport.
const scene = (trigger: Element): ScrollTrigger.Vars => ({ trigger, start: "top 72%", toggleActions: "play none none none" });
const typing = { clipPath: "inset(0 100% 0 0)" };
const typed = { clipPath: "inset(0 0% 0 0)" };

const prepped: HTMLElement[] = [];
const counted: HTMLElement[] = [];
const stops: Array<() => void> = [];
let ctx: gsap.Context | null = null;

// If anything throws while the scenes are set up, put the page back as the HTML has it.
function teardown() {
  ctx?.revert();
  ctx = null;
  stops.forEach((stop) => {
    try {
      stop();
    } catch {
      /* already stopped */
    }
  });
  prepped.forEach((el) => {
    el.style.opacity = "";
    el.style.transform = "";
  });
  counted.forEach((el) => {
    el.textContent = el.dataset.final ?? el.textContent;
  });
  stops.length = prepped.length = counted.length = 0;
}

function start(root: HTMLElement) {
  gsap.registerPlugin(ScrollTrigger);
  const q = <T extends HTMLElement = HTMLElement>(sel: string, el?: Element): T[] =>
    Array.from((el ?? root).querySelectorAll<T>(sel));
  const one = <T extends HTMLElement = HTMLElement>(sel: string, el?: Element): T => {
    const found = (el ?? root).querySelector<T>(sel);
    if (!found) throw new Error(`missing ${sel}`);
    return found;
  };

  // GSAP: a number that counts to its final value on a timeline.
  const count = (tl: gsap.core.Timeline, el: HTMLElement, duration: number, at: gsap.Position) => {
    const to = Number(el.dataset.count);
    const from = Number(el.dataset.from || 0);
    const value = { v: from };
    el.dataset.final = el.textContent ?? "";
    counted.push(el);
    tl.fromTo(
      value,
      { v: from },
      {
        v: to,
        duration,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = Math.round(value.v).toLocaleString("en-US");
        },
      },
      at,
    );
  };

  // Motion: hide now, then spring in when the group scrolls into view.
  const hide = (els: HTMLElement[]) => els.forEach((el) => (el.style.opacity = "0"));
  const spring = { type: "spring", stiffness: 220, damping: 26 } as const;
  const whenSeen = (group: Element, els: HTMLElement[], play: () => void, amount?: number) => {
    hide(els);
    prepped.push(...els);
    stops.push(inView(group, () => void play(), { amount: amount || 0.25 }));
  };

  ctx = gsap.context(() => {
    // Hero: the headline rises line by line, then the window and what is inside it.
    const heroTl = gsap.timeline({ defaults: { ease: "power3.out" } });
    heroTl
      .from(q("[data-hero] .lp-ln > span"), { yPercent: 110, duration: 0.9, stagger: 0.09, ease: "power4.out" })
      .from(q("[data-hero-fade]"), { y: 16, autoAlpha: 0, duration: 0.6, stagger: 0.07 }, "-=0.55")
      .from("[data-win]", { y: 56, autoAlpha: 0, scale: 0.97, duration: 1.1 }, "-=0.5")
      .from(q("[data-srow]"), { x: -10, autoAlpha: 0, duration: 0.4, stagger: 0.05 }, "-=0.6")
      .from(q("[data-chat]"), { y: 10, autoAlpha: 0, duration: 0.45, stagger: 0.16 }, "-=0.2");
    gsap.to("[data-win]", {
      yPercent: -4,
      ease: "none",
      scrollTrigger: { trigger: "[data-hero]", start: "top top", end: "bottom top", scrub: 0.6 },
    });
    gsap.to(q(".lp-pulse"), { opacity: 0.35, duration: 0.9, repeat: -1, yoyo: true, ease: "sine.inOut" });

    // Compare: the prompt is typed, three agents run at their own pace, one is picked.
    const cmp = one("[data-compare]");
    const run = gsap.timeline({ scrollTrigger: scene(cmp), defaults: { ease: "power3.out" } });
    run
      .from("[data-cmp-prompt]", { y: 20, autoAlpha: 0, duration: 0.5 })
      .fromTo("[data-cmp-type]", typing, { ...typed, duration: 1, ease: "steps(30)" })
      .from(q("[data-cmp-chip]"), { scale: 0.8, autoAlpha: 0, duration: 0.3, stagger: 0.08, ease: "back.out(2)" }, "-=0.3")
      .to("[data-cmp-start]", { scale: 0.95, duration: 0.1, yoyo: true, repeat: 1, ease: "power1.inOut" })
      .from(q("[data-cmp-card]"), { y: 28, autoAlpha: 0, duration: 0.55, stagger: 0.1 })
      .addLabel("run");
    q("[data-cmp-card]").forEach((card, index) => {
      const duration = [2.2, 1.5, 2.8][index];
      run.fromTo(one(".lp-bar i", card), { scaleX: 0 }, { scaleX: 1, duration, ease: "power1.inOut" }, "run");
      q("[data-count]", card).forEach((el) => count(run, el, duration, "run"));
      run
        .fromTo(one(".lp-st-a", card), { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.2 }, "run+=" + duration)
        .fromTo(one(".lp-st-b", card), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, "run+=" + duration);
    });
    run
      .fromTo("[data-cmp-win]", { borderColor: "#27272a" }, { borderColor: "#71717a", duration: 0.3 }, "run+=3.1")
      .from("[data-cmp-confirm]", { y: 24, autoAlpha: 0, duration: 0.5, ease: "back.out(1.4)" }, "run+=3.2");

    // Delegate: the task goes from one session to the other, and the answer comes back.
    const hand = gsap.timeline({ scrollTrigger: scene(one("[data-dlg]")), defaults: { ease: "power3.out" } });
    hand
      .from(q("[data-dlg-pane]"), { y: 28, autoAlpha: 0, duration: 0.6, stagger: 0.12 })
      .to("[data-dlg-ph]", { autoAlpha: 0, duration: 0.1 })
      .fromTo("[data-dlg-type]", { ...typing, autoAlpha: 1 }, { ...typed, duration: 1.3, ease: "steps(38)" })
      .fromTo(
        "[data-dlg-pop]",
        { autoAlpha: 0, y: 8, scale: 0.97 },
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.3, ease: "back.out(1.6)" },
        "<0.15",
      )
      .to("[data-dlg-pop]", { autoAlpha: 0, y: 6, duration: 0.25 }, "+=0.5")
      .to("[data-dlg-send]", { scale: 0.95, duration: 0.1, yoyo: true, repeat: 1, ease: "power1.inOut" })
      .to("[data-dlg-type]", { autoAlpha: 0, duration: 0.15 })
      .to("[data-dlg-ph]", { autoAlpha: 1, duration: 0.15 }, "<")
      .from("[data-dlg-msg]", { y: 12, autoAlpha: 0, duration: 0.4 }, "<")
      .from("[data-dlg-status]", { y: 6, autoAlpha: 0, duration: 0.35 })
      .fromTo("[data-dlg-dot]", { left: "0%", autoAlpha: 1 }, { left: "100%", duration: 0.8, ease: "power2.inOut" })
      .from(q("[data-dlg-b]"), { y: 10, autoAlpha: 0, duration: 0.4, stagger: 0.22 })
      .to("[data-dlg-dot]", { left: "0%", duration: 0.8, ease: "power2.inOut" })
      .to("[data-dlg-dot]", { autoAlpha: 0, duration: 0.2 })
      .from("[data-dlg-report]", { y: 14, autoAlpha: 0, scale: 0.97, duration: 0.5, ease: "back.out(1.5)" }, "<");

    // Private: the session arrives, its answer is verified, the balance ticks down.
    const prv = gsap.timeline({ scrollTrigger: scene(one("[data-prv]")), defaults: { ease: "power3.out" } });
    prv
      .from("[data-prv]", { y: 28, autoAlpha: 0, duration: 0.6 })
      .from("[data-prv-chip]", { scale: 0.8, autoAlpha: 0, duration: 0.35, ease: "back.out(2)" }, "-=0.2")
      .from(q("[data-prv-item]"), { y: 10, autoAlpha: 0, duration: 0.4, stagger: 0.18 })
      .fromTo("[data-prv-check]", { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.4, ease: "power2.out" }, "-=0.5")
      .fromTo("[data-prv-badge]", { borderColor: "#27272a" }, { borderColor: "#34d399", duration: 0.25, yoyo: true, repeat: 1 }, "<");
    q("[data-prv] [data-count]").forEach((el) => count(prv, el, 0.9, ">-0.2"));

    // NEAR: the path of a private answer lights up step by step, and ends verified.
    const flow = gsap.timeline({ scrollTrigger: scene(one("[data-flow]")), defaults: { ease: "power3.out" } });
    flow
      .from(q("[data-flow-step]"), { x: -12, autoAlpha: 0, duration: 0.35, stagger: 0.16 })
      .fromTo("[data-flow-end]", { borderColor: "#27272a" }, { borderColor: "#34d399", duration: 0.3 });

    // Numbers, the terminal and the symbol.
    const stats = gsap.timeline({ scrollTrigger: scene(one("[data-stats]")) });
    q("[data-stats] [data-count]").forEach((el) => count(stats, el, 1.6, 0));
    const term = gsap.timeline({ scrollTrigger: scene(one("[data-term]")) });
    term
      .fromTo("[data-term-type]", typing, { ...typed, duration: 1.4, ease: "steps(44)" })
      .from(q("[data-term-out]"), { autoAlpha: 0, duration: 0.01, stagger: 0.09 }, "+=0.2");
    gsap.fromTo(
      q("[data-draw] path"),
      { strokeDasharray: 1, strokeDashoffset: 1 },
      { strokeDashoffset: 0, duration: 0.55, stagger: 0.18, ease: "power2.out", scrollTrigger: scene(one("[data-draw]")) },
    );
  }, root);

  // Motion: text and cards spring in as their group is seen.
  q("[data-reveal]").forEach((group) => {
    const items = q("[data-r]", group);
    whenSeen(group, items, () => animate(items, { opacity: [0, 1], y: [18, 0] }, { ...spring, delay: stagger(0.07) }));
  });

  // Motion: the comment lands on its line, then the bar offers to add it.
  const rev = one("[data-rev]");
  const rows = q("[data-rev-row]", rev);
  const note = one("[data-rev-comment]", rev);
  const bar = one("[data-rev-bar]", rev);
  whenSeen(
    rev,
    [...rows, note, bar],
    () => {
      animate(rows, { opacity: [0, 1], x: [-8, 0] }, { duration: 0.35, delay: stagger(0.04) });
      animate(note, { opacity: [0, 1], scale: [0.94, 1], y: [10, 0] }, { type: "spring", stiffness: 300, damping: 20, delay: 0.7 });
      animate(bar, { opacity: [0, 1], y: [24, 0] }, { type: "spring", stiffness: 260, damping: 22, delay: 1.2 });
    },
    0.35,
  );

  // Motion: the permission card arrives, Allow once is pressed, the plan moves a step.
  const perm = one("[data-perm]");
  const parts = q("[data-perm-item]", perm);
  const before = one(".lp-pl-a", perm);
  const after = one(".lp-pl-b", perm);
  const allow = one("[data-perm-btn]", perm);
  whenSeen(
    perm,
    parts,
    () => {
      animate(parts, { opacity: [0, 1], y: [20, 0], scale: [0.96, 1] }, { type: "spring", stiffness: 260, damping: 22, delay: stagger(0.12) });
      animate(allow, { scale: [1, 0.94, 1] }, { duration: 0.3, delay: 1.5 });
      before.style.visibility = "visible";
      animate(before, { opacity: [1, 1, 0] }, { duration: 1.9, times: [0, 0.92, 1] });
      animate(after, { opacity: [0, 0, 1] }, { duration: 1.9, times: [0, 0.92, 1] });
    },
    0.4,
  );
  prepped.push(before, after, allow);
  stops.push(() => {
    before.style.visibility = "";
  });

  // Motion: gestures. Cards lift, buttons press, feature cells light up.
  const lift = { type: "spring", stiffness: 380, damping: 24 } as const;
  q("[data-hover]").forEach((el) =>
    stops.push(
      hover(el, () => {
        animate(el, { y: -4 }, lift);
        return () => animate(el, { y: 0 }, lift);
      }),
    ),
  );
  q("[data-press]").forEach((el) =>
    stops.push(
      press(el, () => {
        animate(el, { scale: 0.96 }, lift);
        return () => animate(el, { scale: 1 }, lift);
      }),
    ),
  );
  q("[data-cell]").forEach((el) =>
    stops.push(
      hover(el, () => {
        animate(el, { backgroundColor: "#111113" }, { duration: 0.2 });
        return () => animate(el, { backgroundColor: "rgba(17,17,19,0)" }, { duration: 0.3 });
      }),
    ),
  );

  // Positions move once the fonts arrive.
  void document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

function boot() {
  const root = document.querySelector<HTMLElement>(ROOT);
  if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    start(root);
  } catch {
    teardown();
  }
}

boot();
