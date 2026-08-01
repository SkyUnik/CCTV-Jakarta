const HLS_TYPES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
]);

export function assessPlaylist({ body, headers, origin, status, url }) {
  const contentType = (headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  const allowOrigin = headers["access-control-allow-origin"] ?? "";
  const validManifest = /^#EXTM3U(?:\r?\n|$)/.test(body) &&
    /#EXT-X-(?:STREAM-INF|TARGETDURATION|MEDIA-SEQUENCE)/.test(body);
  const corsAllowed = allowOrigin === "*" || allowOrigin === origin;
  const warnings = [];
  if (!HLS_TYPES.has(contentType)) warnings.push(`unexpected_content_type:${contentType || "missing"}`);
  if (!corsAllowed) warnings.push("cors_not_confirmed");
  if (!validManifest) warnings.push("invalid_hls_manifest");

  return {
    url,
    status,
    contentType,
    contentLength: Number(headers["content-length"]) || null,
    corsAllowOrigin: allowOrigin || null,
    validManifest,
    safariNativeCandidate: status >= 200 && status < 300 && validManifest,
    hlsJsCandidate: status >= 200 && status < 300 && validManifest && corsAllowed,
    warnings,
  };
}

export function headersToObject(headers) {
  return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
}
