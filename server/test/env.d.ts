// Types `exports` from "cloudflare:workers" with the Worker's own entry module.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("../src/index");
  }
}
