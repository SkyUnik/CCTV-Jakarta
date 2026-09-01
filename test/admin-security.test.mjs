import assert from "node:assert/strict";
import test from "node:test";

import { isLoopbackHostname, validateAdminRequest } from "../scripts/lib/admin-security.mjs";

test("admin accepts loopback hosts and refuses LAN or cross-origin requests", () => {
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("192.168.1.8"), false);
  assert.doesNotThrow(() => validateAdminRequest({ method: "GET", headers: { host: "127.0.0.1:4175" } }, "nonce", 4175));
  assert.throws(() => validateAdminRequest({ method: "GET", headers: { host: "192.168.1.8:4175" } }, "nonce", 4175), /loopback/);
  assert.throws(() => validateAdminRequest({
    method: "POST",
    headers: { host: "127.0.0.1:4175", origin: "http://evil.example", "x-admin-nonce": "nonce" },
  }, "nonce", 4175), /Cross-origin/);
});

test("admin mutations require the session nonce", () => {
  const request = { method: "POST", headers: { host: "localhost:4175", origin: "http://localhost:4175" } };
  assert.throws(() => validateAdminRequest(request, "secret", 4175), /nonce/);
  request.headers["x-admin-nonce"] = "secret";
  assert.doesNotThrow(() => validateAdminRequest(request, "secret", 4175));
});
