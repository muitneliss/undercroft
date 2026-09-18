/**
 * base64url, because Gmail speaks it and nothing else here does.
 *
 * A Gmail message part carries its bytes as `body.data` in RFC 4648 §5 base64url: `-` and
 * `_` for `+` and `/`, and padding omitted. Feeding that to a plain base64 decoder does not
 * fail -- it silently produces different bytes, which would then be stored as a PDF nobody
 * can open, hashed, and deduplicated against other corrupt copies of itself.
 *
 * Node's decoder handles the alphabet and the missing padding exactly, so this is a named
 * home for the conversion rather than an implementation of it. It is named so the call site
 * says which encoding it believes it has.
 */

/**
 * Decode base64url text to bytes.
 *
 * @throws RangeError when the input is not base64url. Node's decoder is lenient -- it skips
 * characters outside the alphabet rather than refusing -- so the check is explicit here. A
 * truncated or HTML-wrapped payload is a fault worth raising at the boundary, not bytes to
 * store and discover later.
 */
export function decodeBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text)) {
    throw new RangeError("not base64url: expected only A-Z a-z 0-9 - _ and optional = padding");
  }
  return new Uint8Array(Buffer.from(text, "base64url"));
}
