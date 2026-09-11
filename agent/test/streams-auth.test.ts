import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { bodyHashHex, stringToSign, hmacHex, authHeaders } from "../src/equity/streamsClient.ts";

// Chainlink Data Streams REST auth: string-to-sign is
//   `{METHOD} {PATH_WITH_QUERY} {sha256(body)} {apiKey} {timestampMs}`
// signed HMAC-SHA256 with the API secret, hex, across three headers.

const KEY = "clientId-123";
const SECRET = "super-secret";
const PATH = "/api/v1/reports/latest?feedID=0xabc";
const TS = 1_700_000_000_000;

test("empty-body hash is the known SHA-256 of empty string", () => {
  assert.equal(bodyHashHex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("string-to-sign has the exact documented format and order", () => {
  const s = stringToSign("GET", PATH, bodyHashHex(""), KEY, TS);
  assert.equal(
    s,
    `GET ${PATH} e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ${KEY} ${TS}`,
  );
});

test("signature matches an independent HMAC-SHA256 of the string-to-sign", () => {
  const toSign = stringToSign("GET", PATH, bodyHashHex(""), KEY, TS);
  const expected = createHmac("sha256", SECRET).update(toSign).digest("hex");
  assert.equal(hmacHex(SECRET, toSign), expected);
});

test("authHeaders returns the three required headers", () => {
  const h = authHeaders("GET", PATH, "", KEY, SECRET, TS);
  assert.equal(h["Authorization"], KEY);
  assert.equal(h["X-Authorization-Timestamp"], String(TS));
  assert.match(h["X-Authorization-Signature-SHA256"], /^[0-9a-f]{64}$/);
});

test("signature is deterministic and sensitive to every input", () => {
  const base = authHeaders("GET", PATH, "", KEY, SECRET, TS)["X-Authorization-Signature-SHA256"];
  assert.equal(base, authHeaders("GET", PATH, "", KEY, SECRET, TS)["X-Authorization-Signature-SHA256"]);
  assert.notEqual(base, authHeaders("GET", PATH, "", KEY, SECRET, TS + 1)["X-Authorization-Signature-SHA256"]);
  assert.notEqual(base, authHeaders("GET", PATH + "0", "", KEY, SECRET, TS)["X-Authorization-Signature-SHA256"]);
  assert.notEqual(base, authHeaders("GET", PATH, "", KEY, "other", TS)["X-Authorization-Signature-SHA256"]);
});
