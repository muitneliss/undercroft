/**
 * An OpenAttestation document is read only after it verifies, and every way it can fail to
 * verify is a refusal by name with no text.
 *
 * NO MOCKS OF THE VERIFIER. Each document here is wrapped and signed at test time by the
 * official library, and verified by the official library; a document edited after signing is
 * refused by the same Merkle check that refuses one in production. The one thing faked is the
 * DNS, as a resolver that answers from a table -- the offline gate has no network, and a
 * resolver is exactly the seam the reader takes.
 *
 * THE DOCUMENTS ARE INVENTED (`pii.md`). The shape is an ACRA Business Profile's; the company,
 * the people and the numbers are not anyone's. The signing keys are Hardhat's first two
 * development accounts, published in its documentation and holding nothing.
 */

import { describe, expect, test as it } from "bun:test";

import {
  SUPPORTED_SIGNING_ALGORITHM,
  signDocument,
  v2,
  wrapDocument,
} from "@tradetrust-tt/tradetrust";

import { extractDocument, type Extracted } from "./extractText.ts";
import { OA_UNSUPPORTED_ISSUER, OA_UNSUPPORTED_VERSION } from "./openAttestation.ts";
import {
  OA_IDENTITY_INVALID,
  OA_SIGNATURE_INVALID,
  OA_TAMPERED,
  OA_UNVERIFIED,
  type OpenAttestationDeps,
} from "./openAttestationVerify.ts";

const ISSUER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ISSUER_DID = "did:ethr:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const OTHER_DID = "did:ethr:0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ACRA = "acratrustbar.gov.sg";

/** What the reader looks DNS up through: `dnsprove`'s resolver shape. */
type CustomDnsResolver = NonNullable<OpenAttestationDeps["dnsResolvers"]>[number];

/** A DNS that answers one TXT record per domain, as `dnsprove` expects to be answered. */
function dnsListing(records: Readonly<Record<string, string>>): {
  resolver: CustomDnsResolver;
  asked: string[];
} {
  const asked: string[] = [];
  const resolver: CustomDnsResolver = (domain) => {
    asked.push(domain);
    const key = records[domain];
    return Promise.resolve({
      AD: true,
      Answer:
        key === undefined
          ? []
          : [
              {
                name: `${domain}.`,
                type: 16,
                TTL: 300,
                data: `"openatts a=dns-did; p=${key}; v=1.0;"`,
              },
            ],
    });
  };
  return { resolver, asked };
}

const DNS_VOUCHING = dnsListing({ [ACRA]: `${ISSUER_DID}#controller` });

function profile(location = ACRA, template = "BP-COMPANY-2022-1"): v2.OpenAttestationDocument {
  return {
    $template: {
      name: template,
      type: v2.TemplateType.EmbeddedRenderer,
      url: "https://renderer.example.test",
    },
    issuers: [
      {
        id: ISSUER_DID,
        name: "REGISTRY",
        revocation: { type: v2.RevocationType.None },
        identityProof: {
          type: v2.IdentityProofType.DNSDid,
          location,
          key: `${ISSUER_DID}#controller`,
        },
      },
    ],
    productCode: "I003",
    uen: "209900001A",
    entityName: "ACME HOLDINGS PTE. LTD.",
    companyType: "EXEMPT PRIVATE COMPANY LIMITED BY SHARES",
    status: "Live Company",
    statusDate: "01/02/2024",
    incorporationDate: "01/02/2024",
    activities: [
      { name: "WHOLESALE TRADE OF A VARIETY OF GOODS WITHOUT A DOMINANT PRODUCT(46900)" },
      { name: "OTHER HOLDING COMPANIES(64202)" },
    ],
    capitals: [
      {
        type: "Issued Share Capital",
        shares: "1000",
        currency: "SINGAPORE, DOLLARS",
        sharesType: "ORDINARY",
        amount: "1000",
      },
    ],
    address: {
      type: "LOCAL",
      houseNumber: "1",
      streetName: "EXAMPLE ROAD",
      postalCode: "000001",
      formattedAddress: "1 EXAMPLE ROAD SINGAPORE (000001)",
    },
    representatives: [
      {
        name: "ALEX EXAMPLE",
        id: "X0000001A",
        position: "Director",
        appointmentDate: "01/02/2024",
      },
      {
        name: "SAM EXAMPLE",
        id: "X0000002B",
        position: "Secretary",
        appointmentDate: "31/02/2024",
      },
    ],
    shareholders: [
      { name: "ALEX EXAMPLE", id: "X0000001A", shares: "1000", sharesType: "ORDINARY" },
    ],
    verifyLink: "https://example.test/verify",
  };
}

/**
 * The same kind of company in the 2024 template: its own field names (`productId`,
 * `isNominee`, `entryDate`, `agm`), its own date form, and the items 2022 has no place for.
 * One officer is a nominee, the shareholder is stated not to be, and the secretary states
 * neither.
 */
function profile2024(
  dates: Partial<Record<"statusDate" | "entryDate", string>> = {},
  location = ACRA,
): v2.OpenAttestationDocument {
  return {
    $template: {
      name: "BP-COMPANY-2024-1",
      type: v2.TemplateType.EmbeddedRenderer,
      url: "https://renderer.example.test",
    },
    issuers: profile(location).issuers,
    productId: "I065",
    uen: "209900001A",
    entityName: "ACME HOLDINGS PTE. LTD.",
    companyType: "Exempt Private Company Limited by Shares",
    status: "Live Company",
    statusDate: dates.statusDate ?? "01 Jul 2026",
    incorporationDate: "15 Mar 2019",
    registrationDate: "15 Mar 2019",
    changeOfNameDate: "02 Jan 2021",
    formerNames: [{ name: "ACME TRADING PTE. LTD." }],
    gazettedIndicator: "N",
    activities: [{ name: "OTHER HOLDING COMPANIES (64202)" }],
    capitals: [
      {
        type: "Issued Share Capital",
        shares: "1000",
        currency: "SINGAPORE, DOLLARS",
        sharesType: "Ordinary",
        amount: "1000",
      },
    ],
    address: { type: "local", postalCode: "000001", formattedAddress: "1 EXAMPLE ROAD" },
    changeOfAddressDate: "15 Mar 2019",
    agm: [{ currentFyeDate: "31 Dec 2026", lastAgmDate: "01 Jul 2026", lastArDate: "02 Jul 2026" }],
    representatives: [
      {
        name: "ALEX EXAMPLE",
        id: "X0000001A",
        nationality: "EXAMPLIAN",
        position: "Director",
        appointmentDate: "01 Jul 2026",
        entryDate: dates.entryDate ?? "03 Jul 2026",
        isNominee: true,
        addressChanged: "04 Jul 2026",
        address: { type: "foreign", address1: "1 EXAMPLE STREET", country: "EXAMPLIA" },
      },
      {
        name: "SAM EXAMPLE",
        id: "X0000002B",
        position: "Secretary",
        appointmentDate: "01 Jul 2026",
        entryDate: "03 Jul 2026",
      },
    ],
    shareholders: [
      {
        name: "ALEX EXAMPLE",
        id: "X0000001A",
        position: "Shareholder",
        shares: "1000",
        sharesType: "Ordinary",
        currency: "SINGAPORE, DOLLARS",
        appointmentDate: "01 Jul 2026",
        entryDate: "03 Jul 2026",
        isNominee: false,
      },
    ],
    receiptNumber: "RCP0000001",
    receiptDate: "05 Jul 2026",
    signatureName: "EXAMPLE REGISTRAR",
    verifyLink: "https://example.test/verify",
  };
}

async function signed(data = profile()): Promise<Record<string, unknown>> {
  return await signedAs(wrapDocument(data), ISSUER_DID, ISSUER_KEY);
}

async function signedAs(
  wrapped: v2.WrappedDocument<v2.OpenAttestationDocument>,
  did: string,
  key: string,
): Promise<Record<string, unknown>> {
  const document = await signDocument(
    wrapped,
    SUPPORTED_SIGNING_ALGORITHM.Secp256k1VerificationKey2018,
    { public: `${did}#controller`, private: key },
  );
  // Through JSON, as the document reaches the reader: from bytes, not as the library's object.
  const copy: Record<string, unknown> = JSON.parse(JSON.stringify(document));
  return copy;
}

function read(
  document: unknown,
  resolver: CustomDnsResolver = DNS_VOUCHING.resolver,
): Promise<Extracted> {
  return extractDocument(
    {
      spawn: () => Promise.reject(new Error("no program is run for JSON")),
      workDir: "/tmp/oa-test",
      openAttestation: { dnsResolvers: [resolver] },
    },
    {
      contentType: "application/json",
      bytes: new TextEncoder().encode(JSON.stringify(document)),
      path: "/tmp/oa-test/doc",
    },
  );
}

/** Replace the value of one salted field, keeping its salt: what an edit by hand would do. */
function edited(document: Record<string, unknown>, field: string, value: string): unknown {
  const data = document.data as Record<string, string>;
  const salted = data[field] ?? "";
  const prefix = salted.slice(0, salted.indexOf(":", salted.indexOf(":") + 1) + 1);
  return { ...document, data: { ...data, [field]: `${prefix}${value}` } };
}

describe("a verified ACRA business profile", () => {
  it("is read into its profile, values unsalted and dates in ISO", async () => {
    const result = await read(await signed());

    expect(result.method).toBe("openattestation");
    const body = JSON.parse(result.text);
    expect(body.openAttestation.verification).toMatchObject({
      verified: true,
      documentIntegrity: "VALID",
      documentStatus: "VALID",
      issuerIdentity: "VALID",
      issuers: [{ did: ISSUER_DID, identityProofLocation: ACRA }],
    });
    expect(body.acraBusinessProfile).toMatchObject({
      uen: "209900001A",
      name: "ACME HOLDINGS PTE. LTD.",
      status: "Live Company",
      incorporationDate: "2024-02-01",
      registeredAddress: { postalCode: "000001", streetName: "EXAMPLE ROAD" },
      activities: [
        {
          description: "WHOLESALE TRADE OF A VARIETY OF GOODS WITHOUT A DOMINANT PRODUCT",
          ssicCode: "46900",
        },
        { description: "OTHER HOLDING COMPANIES", ssicCode: "64202" },
      ],
      shareholders: [{ name: "ALEX EXAMPLE", numberOfShares: "1000", shareType: "ORDINARY" }],
    });
  });

  it("lays a 2022 profile out whole, every field it has always had and no other", async () => {
    // The whole object, because a dbt model parses exactly this: moving the 2022 layout into
    // the template table must not add, drop or rename one key of it.
    const body = JSON.parse((await read(await signed())).text);
    const unstated = { nationality: null, addressSource: null, address: null };
    expect(body.acraBusinessProfile).toEqual({
      uen: "209900001A",
      name: "ACME HOLDINGS PTE. LTD.",
      companyType: "EXEMPT PRIVATE COMPANY LIMITED BY SHARES",
      status: "Live Company",
      statusDate: "2024-02-01",
      incorporationDate: "2024-02-01",
      gazettedIndicator: null,
      registeredAddress: {
        kind: "LOCAL",
        houseNumber: "1",
        streetName: "EXAMPLE ROAD",
        floor: null,
        unit: null,
        buildingName: null,
        postalCode: "000001",
        address1: null,
        address2: null,
        country: null,
        formattedAddress: "1 EXAMPLE ROAD SINGAPORE (000001)",
      },
      changeOfAddressDate: null,
      activities: [
        {
          description: "WHOLESALE TRADE OF A VARIETY OF GOODS WITHOUT A DOMINANT PRODUCT",
          ssicCode: "46900",
        },
        { description: "OTHER HOLDING COMPANIES", ssicCode: "64202" },
      ],
      capitals: [
        {
          type: "Issued Share Capital",
          amount: "1000",
          numberOfShares: "1000",
          currency: "SINGAPORE, DOLLARS",
          shareType: "ORDINARY",
        },
      ],
      officers: [
        {
          name: "ALEX EXAMPLE",
          identificationNumber: "X0000001A",
          position: "Director",
          appointmentDate: "2024-02-01",
          ...unstated,
        },
        {
          name: "SAM EXAMPLE",
          identificationNumber: "X0000002B",
          position: "Secretary",
          appointmentDate: null,
          ...unstated,
        },
      ],
      shareholders: [
        {
          name: "ALEX EXAMPLE",
          identificationNumber: "X0000001A",
          numberOfShares: "1000",
          shareType: "ORDINARY",
          currency: null,
          ...unstated,
        },
      ],
      document: {
        productCode: "I003",
        transactionNumber: null,
        receiptNumber: null,
        receiptDate: null,
        verificationUrl: "https://example.test/verify",
        template: {
          name: "BP-COMPANY-2022-1",
          type: "EMBEDDED_RENDERER",
          rendererUrl: "https://renderer.example.test",
        },
      },
    });
  });

  it("maps each officer's own role, and a date that is not on the calendar to null", async () => {
    const body = JSON.parse((await read(await signed())).text);
    expect(body.acraBusinessProfile.officers).toMatchObject([
      { name: "ALEX EXAMPLE", position: "Director", appointmentDate: "2024-02-01" },
      { name: "SAM EXAMPLE", position: "Secretary", appointmentDate: null },
    ]);
  });
});

describe("a verified ACRA business profile in the 2024 template", () => {
  it("is read into the same profile, by its own field names and its own dates", async () => {
    const body = JSON.parse((await read(await signed(profile2024()))).text);

    expect(body.data).toBeUndefined();
    expect(body.acraBusinessProfile).toMatchObject({
      uen: "209900001A",
      statusDate: "2026-07-01",
      activities: [{ description: "OTHER HOLDING COMPANIES", ssicCode: "64202" }],
      capitals: [{ amount: "1000", currency: "SINGAPORE, DOLLARS", numberOfShares: "1000" }],
      officers: [
        {
          position: "Director",
          appointmentDate: "2026-07-01",
          entryDate: "2026-07-03",
          isNominee: true,
          addressChangedDate: "2026-07-04",
          addressSource: null,
          address: { kind: "foreign", country: "EXAMPLIA" },
        },
        { position: "Secretary", isNominee: null },
      ],
      shareholders: [{ numberOfShares: "1000", isNominee: false, entryDate: "2026-07-03" }],
      registrationDate: "2019-03-15",
      formerNames: [{ name: "ACME TRADING PTE. LTD." }],
      changeOfNameDate: "2021-01-02",
      annualFilings: [
        {
          currentFinancialYearEnd: "2026-12-31",
          lastAgmDate: "2026-07-01",
          lastAnnualReturnDate: "2026-07-02",
          lastAnnualReturnFinancialYearEnd: null,
        },
      ],
      // `productId` is not filed as 2022's `productCode`: nothing states they are one item.
      document: { productCode: null, productId: "I065", receiptDate: "2026-07-05" },
    });
  });

  it("reads a date only in the template's own form, and one not on the calendar as null", async () => {
    const dates = ["31 Feb 2026", "1 July 2026", "01 JUL 2026", "2026-07-01", "00 Jul 2026"];
    for (const statusDate of dates) {
      const body = JSON.parse((await read(await signed(profile2024({ statusDate })))).text);
      expect([statusDate, body.acraBusinessProfile.statusDate]).toEqual([statusDate, null]);
    }
  });

  it("from an issuer other than ACRA keeps its data", async () => {
    const dns = dnsListing({ "registry.example.test": `${ISSUER_DID}#controller` });
    const fromElsewhere = profile2024({}, "registry.example.test");
    const body = JSON.parse((await read(await signed(fromElsewhere), dns.resolver)).text);
    expect(body.acraBusinessProfile).toBeUndefined();
    expect(body.data.statusDate).toBe("01 Jul 2026");
  });
});

describe("a document that does not verify yields no text", () => {
  it("edited after it was signed: refused as tampered", async () => {
    const result = await read(edited(await signed(), "uen", "209900002B"));
    expect(result).toEqual({ method: null, reason: OA_TAMPERED, text: "", truncated: false });
  });

  it("signed by a key other than the one it names: refused as a bad signature", async () => {
    // The same root, signed by somebody else, under the issuer's name.
    const wrapped = wrapDocument(profile());
    const genuine = await signedAs(wrapped, ISSUER_DID, ISSUER_KEY);
    const forged = await signedAs(wrapped, OTHER_DID, OTHER_KEY);
    const [proof] = genuine.proof as Record<string, unknown>[];
    const [forgery] = forged.proof as Record<string, unknown>[];

    const result = await read({ ...genuine, proof: [{ ...proof, signature: forgery?.signature }] });

    expect(result.reason).toBe(OA_SIGNATURE_INVALID);
  });

  it("whose issuer's DNS lists another key: refused as an unproven identity", async () => {
    const result = await read(
      await signed(),
      dnsListing({ [ACRA]: `${OTHER_DID}#controller` }).resolver,
    );
    expect(result.reason).toBe(OA_IDENTITY_INVALID);
  });

  it("when the DNS cannot be reached: 'could not verify', not 'invalid'", async () => {
    const unreachable: CustomDnsResolver = () => Promise.reject(new Error("network unreachable"));
    const result = await read(await signed(), unreachable);
    expect(result.reason).toBe(OA_UNVERIFIED);
  });
});

describe("what is refused before anything is looked up", () => {
  it("an issuer that is not a did:ethr key proven by DNS-DID", async () => {
    // The library would resolve a `did:web` issuer over the network, at a URL the document's
    // author chose. Refusing first means the DNS is never asked either.
    const document = await signed();
    const data = document.data as Record<string, unknown>;
    const [issuer] = data.issuers as Record<string, unknown>[];
    const dns = dnsListing({});
    const withWebIssuer = {
      ...document,
      data: { ...data, issuers: [{ ...issuer, id: "a:string:did:web:attacker.example.test" }] },
    };

    const result = await read(withWebIssuer, dns.resolver);

    expect(result.reason).toBe(OA_UNSUPPORTED_ISSUER);
    expect(dns.asked).toEqual([]);
  });

  it("an OpenAttestation version this reader does not verify", async () => {
    const result = await read({
      version: "https://schema.openattestation.com/3.0/schema.json",
      data: {},
    });
    expect(result.reason).toBe(OA_UNSUPPORTED_VERSION);
  });
});

describe("what is not an ACRA profile", () => {
  it("a verified document from another issuer is read as its data, values whole", async () => {
    // Unsalted at the first two colons, never the last: a URL keeps its scheme and a DID its
    // method, which a split at the last colon turns into `//renderer...` and `0x...`.
    const dns = dnsListing({ "registry.example.test": `${ISSUER_DID}#controller` });
    const result = await read(await signed(profile("registry.example.test")), dns.resolver);

    const body = JSON.parse(result.text);
    expect(body.acraBusinessProfile).toBeUndefined();
    expect(body.data.$template.url).toBe("https://renderer.example.test");
    expect(body.data.issuers[0].id).toBe(ISSUER_DID);
  });

  it("an ACRA document in a template this mapping was not written for keeps its data", async () => {
    const body = JSON.parse((await read(await signed(profile(ACRA, "BP-COMPANY-2030-1")))).text);
    expect(body.acraBusinessProfile).toBeUndefined();
    expect(body.data.uen).toBe("209900001A");
  });

  it("JSON that does not claim to be OpenAttestation is kept as its text", async () => {
    const result = await read({ invoice: "INV-1", total: "10.00" });
    expect(result).toMatchObject({ method: "txt", text: '{"invoice":"INV-1","total":"10.00"}' });
  });
});
