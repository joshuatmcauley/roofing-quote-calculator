// Worker entry. Static files are served by Cloudflare's asset layer; only /api/*
// reaches this code (see run_worker_first in wrangler.jsonc).
import { onRequestPost } from "./functions/api/send-quote.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/send-quote") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
      return onRequestPost({ request, env });
    }
    return new Response("Not found", { status: 404 });
  },
};
