import { error } from "./http";

export default {
  async fetch(): Promise<Response> {
    return error("not_found", 404);
  },
} satisfies ExportedHandler;
