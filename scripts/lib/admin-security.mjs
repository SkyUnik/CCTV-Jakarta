export function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

export function validateAdminRequest(request, nonce, port) {
  const host = String(request.headers.host ?? "");
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (!isLoopbackHostname(hostname)) throw new Error("Admin requests must use a loopback host");
  const origin = request.headers.origin;
  if (origin) {
    const parsed = new URL(origin);
    if (!isLoopbackHostname(parsed.hostname) || parsed.port !== String(port)) {
      throw new Error("Cross-origin admin request refused");
    }
  }
  if (request.method !== "GET" && request.headers["x-admin-nonce"] !== nonce) {
    throw new Error("Invalid admin session nonce");
  }
}

export async function readJsonBody(request, maximumBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
