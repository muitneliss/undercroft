/**
 * Whether an OpenAttestation v2 document verifies: its integrity, its signature, and its
 * issuer's identity -- each by the official library, with its two outward lookups narrowed.
 *
 * THE CRYPTOGRAPHY IS THE OFFICIAL LIBRARY'S. `@tradetrust-tt/tt-verify` is IMDA's maintained
 * successor to GovTech's archived `@govtechsg/oa-verify`, and it recomputes the Merkle root
 * (`OpenAttestationHash`) and recovers the signer (`OpenAttestationDidSignedDocumentStatus`).
 * Nothing here hashes or recovers anything. What this module supplies are its two outward
 * lookups, each deliberately narrower than the library's default:
 *
 *   - **A `did:ethr` key is resolved to its DEFAULT document, offline.** The library's own
 *     resolver asks an Ethereum RPC (Infura, by default, with a key baked into the package) for
 *     the ERC-1056 registry's record of the key. An Ethereum RPC is a credential and a network
 *     dependency this platform does not have, and the default document is exactly what the
 *     registry answers for a key that was never changed -- which, read on 2026-09-24, is true
 *     of ACRA's. The trade is stated rather than hidden: a key RE-ASSIGNED on-chain is not
 *     seen. What still binds the key to its issuer is the next lookup, which is live.
 *   - **A DNS-DID identity proof is checked against the issuer's DNS TXT record**, through
 *     `@tradetrust-tt/dnsprove`'s DNS-over-HTTPS resolvers unless `deps.dnsResolvers` says
 *     otherwise. The library's stock verifier cannot be handed a resolver, which is the only
 *     reason the check below is written here: it is that verifier's comparison, verbatim.
 */

import { type CustomDnsResolver, getDnsDidRecords } from "@tradetrust-tt/dnsprove";
import {
  type AllVerificationFragment,
  type DocumentsToVerify,
  openAttestationDidSignedDocumentStatus,
  openAttestationHash,
  type VerificationFragment,
  type Verifier,
  verificationBuilder,
} from "@tradetrust-tt/tt-verify";
import { type DIDResolutionResult, Resolver } from "did-resolver";

/** The content does not hash to the signed root: edited after it was issued. */
export const OA_TAMPERED = "openattestation-tampered";
/** The root was not signed by the key the document names. */
export const OA_SIGNATURE_INVALID = "openattestation-signature-invalid";
/** The issuer's DNS does not list the signing key. */
export const OA_IDENTITY_INVALID = "openattestation-identity-invalid";
/**
 * A check could not be completed -- the DNS lookup failed, most often. A verdict about this
 * run and not about the document, so it is kept apart from the three above.
 */
export const OA_UNVERIFIED = "openattestation-could-not-verify";

export interface OpenAttestationDeps {
  /** Where DNS-DID TXT records are looked up. Absent: dnsprove's DNS-over-HTTPS defaults. */
  readonly dnsResolvers?: readonly CustomDnsResolver[];
}

/** An issuer as the checks need it, unsalted. */
export interface OaIssuer {
  readonly id: string;
  readonly name: string | null;
  readonly key: string;
  readonly location: string;
}

/**
 * The refusal a document's three checks amount to, or `null` when all three passed.
 *
 * The document has already been narrowed to the shape this reader will check at all
 * (`openAttestation.ts`): every issuer a `did:ethr` key with a DNS-DID proof.
 */
export async function verifyOpenAttestation(
  deps: OpenAttestationDeps,
  document: DocumentsToVerify,
  issuers: readonly OaIssuer[],
): Promise<string | null> {
  const run = verificationBuilder(
    [openAttestationHash, openAttestationDidSignedDocumentStatus, dnsDidIdentity(deps, issuers)],
    // `network` only names the chain a default provider would be built for; no verifier above
    // asks a provider anything, and the resolver is the only DID lookup there is.
    { network: "homestead", resolver: DEFAULT_DOCUMENT_RESOLVER },
  );
  return refusalFor(await run(document));
}

/**
 * The refusal the fragments amount to, or `null` when every check passed.
 *
 * Each of the three checks must have run AND passed. A skipped fragment is not a pass -- "no
 * evidence is never pass" -- so a verifier that decided this document was not its business is
 * refused here, exactly like one that looked and disagreed.
 */
function refusalFor(fragments: readonly VerificationFragment[]): string | null {
  function status(name: string): string {
    return fragments.find((fragment) => fragment.name === name)?.status ?? "MISSING";
  }
  const checks: readonly [string, string][] = [
    ["OpenAttestationHash", OA_TAMPERED],
    ["OpenAttestationDidSignedDocumentStatus", OA_SIGNATURE_INVALID],
    [DNS_DID_NAME, OA_IDENTITY_INVALID],
  ];
  for (const [name, reason] of checks) {
    const verdict = status(name);
    if (verdict === "INVALID") {
      return reason;
    }
    if (verdict !== "VALID") {
      return OA_UNVERIFIED;
    }
  }
  return null;
}

const DNS_DID_NAME = "OpenAttestationDnsDidIdentityProof";

/**
 * The stock DNS-DID verifier's comparison -- a record at the issuer's location whose key is the
 * proof's key, case-insensitively -- with the lookup injectable. See the module docstring.
 */
function dnsDidIdentity(
  deps: OpenAttestationDeps,
  issuers: readonly OaIssuer[],
): Verifier<AllVerificationFragment> {
  function fragment(status: "VALID" | "INVALID" | "ERROR", data: unknown): AllVerificationFragment {
    return status === "VALID"
      ? { name: DNS_DID_NAME, type: "ISSUER_IDENTITY", status, data }
      : {
          name: DNS_DID_NAME,
          type: "ISSUER_IDENTITY",
          status,
          data,
          reason: { code: 0, codeString: status, message: "issuer identity not established" },
        };
  }
  return {
    test: (): boolean => true,
    skip: (): never => {
      throw new Error("the DNS-DID check is never skipped");
    },
    verify: async (): Promise<AllVerificationFragment> => {
      try {
        const results = await Promise.all(
          issuers.map(async (issuer) => {
            const records = await getDnsDidRecords(
              issuer.location,
              deps.dnsResolvers === undefined ? undefined : [...deps.dnsResolvers],
            );
            const found = records.some(
              (record) => record.publicKey.toLowerCase() === issuer.key.toLowerCase(),
            );
            return {
              location: issuer.location,
              key: issuer.key,
              status: found ? "VALID" : "INVALID",
            };
          }),
        );
        return fragment(results.every((r) => r.status === "VALID") ? "VALID" : "INVALID", results);
      } catch {
        return fragment("ERROR", []);
      }
    },
  };
}

/**
 * `did:ethr:<address>` resolved to the document ERC-1056 defines for an unchanged key: one
 * controller, the address itself. See the module docstring for what this does not see.
 */
const DEFAULT_DOCUMENT_RESOLVER = new Resolver({
  ethr: (did: string): Promise<DIDResolutionResult> => {
    const address = did.slice("did:ethr:".length);
    return Promise.resolve({
      didResolutionMetadata: {},
      didDocumentMetadata: {},
      didDocument: {
        id: did,
        verificationMethod: [
          {
            id: `${did}#controller`,
            type: "EcdsaSecp256k1RecoveryMethod2020",
            controller: did,
            blockchainAccountId: `${address}@eip155:1`,
          },
        ],
      },
    });
  },
});
