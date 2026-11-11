// Confirms the private update-signing key belongs to the public key built into an app, so a release
// can never be signed with a key that installed copies would reject.
//
//   echo "$PRIVATE_KEY" | node check-update-key.mjs <public key>
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

const expected = process.argv[2];
const seed = Buffer.from(readFileSync(0, "utf8").trim(), "base64");
if (!expected || seed.length !== 32) {
  console.error("Usage: echo <private key> | node check-update-key.mjs <public key>");
  process.exit(1);
}
// A raw Ed25519 seed wrapped in the standard private-key encoding.
const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
const actual = createPublicKey(createPrivateKey({ key: der, format: "der", type: "pkcs8" }))
  .export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
if (actual !== expected) {
  console.error("The private signing key does not match the public key in the app.");
  process.exit(1);
}
console.log("The signing key matches the app's public key.");
