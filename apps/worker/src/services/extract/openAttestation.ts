/**
 * An OpenAttestation v2 document: verified, unwrapped, and read.
 *
 * A `.oa` file -- an ACRA Business Profile is the one the issue measured, 1,020 of them -- is a
 * JSON document whose every value is salted and whose Merkle root is signed by its issuer. Its
 * content is therefore not "what the file says" until the signature says so, and that is the
 * whole shape of this module: NOTHING IS READ OUT OF A DOCUMENT THAT DID NOT VERIFY. A tampered
 * file, a wrong signature, an issuer the DNS does not vouch for -- each is a refusal by name,
 * with no text. The bytes stay whole in the lake either way.
 *
 * RECOGNISED BY CONTENT, NEVER BY NAME. The JSON reader hands a document here when its
 * `version` names the OpenAttestation schema; a `.oa` that is not one is read as ordinary
 * JSON, and a `.json` that is one is verified like any `.oa`. An extension is a hint a person
 * typed; the schema URL is the document's own claim, and the signature is what makes it true.
 *
 * THE CRYPTOGRAPHY IS THE OFFICIAL LIBRARY'S, and `openAttestationVerify.ts` is where it is
 * called, with the two lookups it makes and why each is narrower than the library's default.
 *
 * AND NOTHING ELSE LEAVES THE PROCESS. A document is refused BEFORE verification unless every
 * issuer is a `did:ethr` key with a DNS-DID proof and every proof is an
 * `OpenAttestationSignature2018`. The library falls back to its own network resolver for any
 * DID method this one does not answer, so a `did:web:` issuer would otherwise send the worker
 * to a URL a stranger wrote. The renderer URL in `$template` is never fetched.
 *
 * VALUES ARE UNWRAPPED HERE, AS STRINGS. The library's `getData` turns a `number:` value into
 * a JavaScript float, and a share capital is money (`money.md`). `unsalted` strips each
 * `<salt>:<type>:` prefix at its first two colons -- never at the last, which is how
 * `https://renderer...` becomes `//renderer...` and `did:ethr:0x...` becomes `0x...` -- and
 * keeps the value's text. It verifies nothing: before the checks it supplies only the issuer
 * fields the checks themselves consult, and nothing it produces is written until they pass.
 */

import type { DocumentsToVerify } from "@tradetrust-tt/tt-verify";

import { acraBusinessProfile } from "./acraBusinessProfile.ts";
import type { OaIssuer, OpenAttestationDeps } from "./openAttestationVerify.ts";

/** The one version this reader verifies. A new version is a new branch, never a default. */
export const OA_V2_SCHEMA = "https://schema.openattestation.com/2.0/schema.json";
const OA_SCHEMA_ROOT = "https://schema.openattestation.com/";

/** Names the schema, but not one this reader verifies. */
export const OA_UNSUPPORTED_VERSION = "openattestation-unsupported-version";
/** Claims v2 and lacks its shape: `data`, a `signature` with a Merkle root, a `proof`. */
export const OA_MALFORMED = "openattestation-malformed";
/** An issuer or proof this reader will not send anywhere to check. See the docstring. */
export const OA_UNSUPPORTED_ISSUER = "openattestation-unsupported-issuer";
export type OpenAttestationRead = { ok: true; text: string } | { ok: false; reason: string };

/** Whether a parsed JSON value claims to be an OpenAttestation document of any version. */
export function claimsOpenAttestation(value: unknown): boolean {
  return (
    isRecord(value) && typeof value.version === "string" && value.version.startsWith(OA_SCHEMA_ROOT)
  );
}

/** One OpenAttestation document, verified and then read -- or the reason it was not. */
export async function readOpenAttestation(
  deps: OpenAttestationDeps,
  document: unknown,
): Promise<OpenAttestationRead> {
  if (!isRecord(document) || document.version !== OA_V2_SCHEMA) {
    return { ok: false, reason: OA_UNSUPPORTED_VERSION };
  }
  if (!isSignedV2(document)) {
    return { ok: false, reason: OA_MALFORMED };
  }
  const data = unsalted(document.data);
  const issuers = issuersOf(data);
  if (issuers === null || !signedWithDidKeys(document.proof)) {
    return { ok: false, reason: OA_UNSUPPORTED_ISSUER };
  }

  // Loaded here, not at the top: the verifier brings ethers and the credential stack with it
  // -- measured at 109 MB of resident memory and three seconds under `--smol` -- and every
  // worker process that never meets a signed record would otherwise pay both.
  const { verifyOpenAttestation } = await import("./openAttestationVerify.ts");
  const refusal = await verifyOpenAttestation(deps, document, issuers);
  if (refusal !== null) {
    return { ok: false, reason: refusal };
  }

  const verification = {
    verified: true,
    documentIntegrity: "VALID",
    documentStatus: "VALID",
    issuerIdentity: "VALID",
    issuers: issuers.map((issuer) => ({
      name: issuer.name,
      did: issuer.id,
      identityProofType: "DNS-DID",
      identityProofLocation: issuer.location,
    })),
  };
  const profile = acraBusinessProfile(data, issuers);
  const body =
    profile === null
      ? { openAttestation: { version: OA_V2_SCHEMA, verification }, data }
      : { openAttestation: { version: OA_V2_SCHEMA, verification }, acraBusinessProfile: profile };
  return { ok: true, text: JSON.stringify(body, null, 2) };
}

interface SignedV2 {
  readonly data: Record<string, unknown>;
  readonly signature: Record<string, unknown>;
  readonly proof: unknown[];
}

/**
 * The parts of a signed v2 document this module reads. Narrowed to the library's own document
 * type as well, because the library's verifiers re-check everything else about it.
 */
function isSignedV2(
  document: Record<string, unknown>,
): document is Record<string, unknown> & SignedV2 & DocumentsToVerify {
  const { data, signature, proof } = document;
  return (
    isRecord(data) &&
    isRecord(signature) &&
    typeof signature.merkleRoot === "string" &&
    typeof signature.targetHash === "string" &&
    Array.isArray(proof) &&
    proof.length > 0
  );
}

/** Every proof an `OpenAttestationSignature2018` by a `did:ethr` key; nothing else is checked. */
function signedWithDidKeys(proofs: readonly unknown[]): boolean {
  return proofs.every(
    (proof) =>
      isRecord(proof) &&
      proof.type === "OpenAttestationSignature2018" &&
      typeof proof.verificationMethod === "string" &&
      proof.verificationMethod.startsWith("did:ethr:") &&
      typeof proof.signature === "string",
  );
}

/**
 * The issuers, when every one is a `did:ethr` key proven by DNS-DID -- the only shape this
 * reader sends anywhere to check. `null` for any other, so it is refused before any lookup.
 */
function issuersOf(data: Record<string, unknown>): OaIssuer[] | null {
  const { issuers } = data;
  if (!Array.isArray(issuers) || issuers.length === 0) {
    return null;
  }
  const out: OaIssuer[] = [];
  for (const issuer of issuers) {
    const read = dnsDidEthrIssuer(issuer);
    if (read === null) {
      return null;
    }
    out.push(read);
  }
  return out;
}

function dnsDidEthrIssuer(issuer: unknown): OaIssuer | null {
  const proof = isRecord(issuer) ? issuer.identityProof : undefined;
  if (!(isRecord(issuer) && isRecord(proof))) {
    return null;
  }
  const { id, name } = issuer;
  const { type, key, location } = proof;
  const supported =
    typeof id === "string" &&
    id.startsWith("did:ethr:") &&
    type === "DNS-DID" &&
    typeof key === "string" &&
    typeof location === "string" &&
    location !== "";
  return supported ? { id, name: typeof name === "string" ? name : null, key, location } : null;
}

/**
 * A v2 value with every `<salt>:<type>:` prefix removed, the value kept as text.
 *
 * Split at the FIRST TWO colons only; the value may hold any number of its own. `null` and
 * `undefined` values become `null`; a boolean keeps its word. A string with no prefix is left
 * as it is -- a verified document has none, and this runs only on verified documents.
 */
export function unsalted(value: unknown): Record<string, unknown> {
  const out = unsaltValue(value);
  return isRecord(out) ? out : {};
}

function unsaltValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(unsaltValue);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, unsaltValue(v)]));
  }
  if (typeof value !== "string") {
    return value;
  }
  const first = value.indexOf(":");
  const second = first < 0 ? -1 : value.indexOf(":", first + 1);
  if (second < 0) {
    return value;
  }
  const type = value.slice(first + 1, second);
  const text = value.slice(second + 1);
  return type === "null" || type === "undefined" ? null : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
