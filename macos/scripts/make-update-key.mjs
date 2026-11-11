// Creates the key pair that signs macOS updates, in the form Sparkle's tools read.
//
//   node make-update-key.mjs <private key file>
//
// Writes the private key to the file and prints the public key. The private key signs every update:
// keep it out of the repository and store it as a release secret. The public key goes in the app
// (SPARKLE_PUBLIC_KEY for package.sh). Any computer with Node.js can run this.
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node make-update-key.mjs <private key file>");
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
// The last 32 bytes of each encoding are the raw Ed25519 seed and public key.
const raw = (key, type) => key.export({ format: "der", type }).subarray(-32).toString("base64");
writeFileSync(file, raw(privateKey, "pkcs8") + "\n", { flag: "wx", mode: 0o600 });
console.log(raw(publicKey, "spki"));
