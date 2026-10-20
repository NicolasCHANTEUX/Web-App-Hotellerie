import assert from "node:assert/strict";
import test from "node:test";
import { parseTrustProxy } from "./env.js";

test("exige un choix explicite de TRUST_PROXY en production", () => {
  assert.equal(parseTrustProxy(undefined, false), false);
  assert.equal(parseTrustProxy(" ", false), false);
  assert.throws(() => parseTrustProxy(undefined, true), /TRUST_PROXY is required in production/);
  assert.equal(parseTrustProxy("false", true), false);
});

test("accepte un booléen, un nombre de proxies ou leurs adresses", () => {
  assert.equal(parseTrustProxy("TRUE", true), true);
  assert.equal(parseTrustProxy("2", true), 2);
  assert.deepEqual(parseTrustProxy("10.0.0.0/8, 192.168.1.1", true), ["10.0.0.0/8", "192.168.1.1"]);
  assert.deepEqual(parseTrustProxy("loopback,fd00::/8", true), ["loopback", "fd00::/8"]);
});

test("refuse une valeur de TRUST_PROXY ambiguë", () => {
  for (const value of ["0", "11", "yes", "10.0.0.0/33", "proxy.internal", "10.0.0.1/8/2"]) {
    assert.throws(() => parseTrustProxy(value, true), /TRUST_PROXY must be/, value);
  }
});
