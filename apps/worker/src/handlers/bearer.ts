/**
 * The `Authorization: Bearer <token>` header, read once.
 *
 * Shared by the lake verbs and the connection verbs, which authenticate differently -- an
 * ingest key for the first, the service token alone for the second -- but read the header the
 * same way. Its own module so neither handler has to import the other.
 */

const BEARER = /^Bearer\s+(?<token>.+)$/iu;

export function bearerOf(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = BEARER.exec(header);
  return match?.groups?.token ?? null;
}
