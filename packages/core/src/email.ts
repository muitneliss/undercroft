/**
 * Sending an email, and the seam that keeps the gate offline.
 *
 * This interface was three fields and no templating system, on the stated ground that "the
 * day a second kind of message exists is the day to grow it". Five kinds exist now -- a
 * sign-in code, an invitation, a failed run, a lapsing grant, a lapsing key -- so that day
 * arrived and the growth is `emailTemplate.ts`, one leaf set two ways. ADR 0030 records it.
 *
 * `text` stayed REQUIRED while `html` is optional, which is the whole shape of the decision:
 * the plain-text branch is the message and the markup is the same message set. A sender that
 * accepted markup alone would let somebody ship a message that is blank in every client with
 * images and styles off, and nobody would notice until a customer said so.
 *
 * An HTTPS API rather than SMTP. SMTP would mean a dependency and four settings whose
 * failure mode is a message that is silently never delivered; a JSON POST fails with a
 * status code, in the same shape as every other outbound call in this repo, and needs
 * nothing but `fetch`.
 *
 * `send` RAISES on a non-2xx and never resolves on a failed send. A sender that swallows
 * the error would turn "the mail provider rejected the address" into "the user never got
 * their code and nothing was written down" -- the exact shape of the never-guess rule, in
 * an area where the only other observer is a confused person staring at an empty inbox.
 */

import { HttpError, UndercroftError } from "./errors.ts";

export interface EmailMessage {
  /** A single recipient. Sign-in codes are never sent to more than one address. */
  readonly to: string;
  readonly subject: string;
  /** The message. Never derived from `html`, and never optional -- see the docstring. */
  readonly text: string;
  /**
   * The same message, set. Optional so a caller with nothing to set can still send, and so
   * the `text` branch can never be the thing that goes missing.
   */
  readonly html?: string;
}

export interface EmailSender {
  send: (message: EmailMessage) => Promise<void>;
}

/** A message that no provider would accept. Raised before anything is sent. */
export class UnsendableEmail extends UndercroftError {}

/** Resend's endpoint. Any provider taking `{ from, to, subject, text, html }` works unchanged. */
export const DEFAULT_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export interface HttpEmailSenderOptions {
  readonly apiKey: string;
  /** The envelope sender, e.g. `Undercroft <no-reply@example.test>`. */
  readonly from: string;
  readonly endpoint?: string;
  /** Injected so a test can drive this without a network. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * A sender that POSTs to a provider's JSON API.
 *
 * The body excerpt on failure is capped: a provider's error page can be a whole HTML
 * document, and the useful part is always at the front.
 */
export function createHttpEmailSender(options: HttpEmailSenderOptions): EmailSender {
  const endpoint = options.endpoint ?? DEFAULT_EMAIL_ENDPOINT;
  const doFetch = options.fetch ?? globalThis.fetch;

  return {
    async send(message: EmailMessage): Promise<void> {
      assertSendable(message);

      const response = await doFetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        // `html` is omitted rather than sent as undefined when there is none: a provider
        // handed an explicit null for it is within its rights to send an empty HTML part,
        // and a mail client shown an empty HTML part renders an empty message.
        body: JSON.stringify({
          from: options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
        }),
      });

      if (!response.ok) {
        throw new HttpError(response.status, endpoint, (await response.text()).slice(0, 200));
      }
    },
  };
}

/**
 * The in-memory sender, for tests.
 *
 * It REFUSES an unsendable message rather than recording it, for the reason `tests.md`
 * gives: a fake that accepts anything makes a broken boundary look fine. A real provider
 * rejects an empty recipient with a 422, so one that quietly recorded it would let a bug
 * that sends codes to nobody pass the suite.
 */
export class InMemoryEmailSender implements EmailSender {
  private readonly messages: EmailMessage[] = [];

  send(message: EmailMessage): Promise<void> {
    assertSendable(message);
    this.messages.push(message);
    return Promise.resolve();
  }

  /** Everything sent, oldest first. */
  get sent(): readonly EmailMessage[] {
    return this.messages;
  }

  /** The most recent message, or null. Named so an absent one reads as absent. */
  get last(): EmailMessage | null {
    return this.messages.at(-1) ?? null;
  }
}

function assertSendable(message: EmailMessage): void {
  // An address with no `@` is the one malformation worth catching here: it is what a
  // mis-wired template variable produces, and the provider's rejection of it arrives far
  // from the cause.
  if (message.to === "" || !message.to.includes("@")) {
    throw new UnsendableEmail(`not a usable recipient address: ${JSON.stringify(message.to)}`);
  }
  if (message.subject === "") {
    throw new UnsendableEmail("an email with no subject");
  }
  if (message.text === "") {
    throw new UnsendableEmail("an email with no body");
  }
}
