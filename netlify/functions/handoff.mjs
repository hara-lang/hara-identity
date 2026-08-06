import {
  HANDOFF_AUTHORIZE_PATH,
  HANDOFF_DISCOVERY_PATH,
  HANDOFF_TOKEN_PATH,
  authorizeHandoff,
  exchangeHandoff,
  handoffDiscovery,
  handoffProblem,
} from "./_shared/handoff.mjs";

export const config = {
  path: [
    "/.well-known/hara-handoff",
    "/v1/handoffs/authorize",
    "/v1/handoffs/token",
  ],
};

export async function handle(request, options = {}) {
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname === HANDOFF_DISCOVERY_PATH) return handoffDiscovery(request, options.env ?? process.env);
    if (pathname === HANDOFF_AUTHORIZE_PATH) return await authorizeHandoff(request, options);
    if (pathname === HANDOFF_TOKEN_PATH) return await exchangeHandoff(request, options);
    return new Response("Not found", { status: 404 });
  } catch (error) {
    return handoffProblem(error, request.method);
  }
}

export default async (request) => handle(request);
