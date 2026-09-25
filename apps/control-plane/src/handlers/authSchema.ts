/**
 * Where Better Auth keeps what it writes: every model it and its plugins use, mapped onto the
 * snake_case tables `060_auth.sql` and `310_mcp_oauth.sql` created. ADR 0010, ADR 0061.
 *
 * Better Auth names its fields in camelCase and this database is snake_case, and it emits
 * unqualified table names (`handlers/auth.ts` explains the `search_path` that resolves them).
 * The mapping is mechanical, but it is not optional: a missed field is a query against a column
 * that does not exist -- at a sign-in, a consent or a token refresh, in production, never in a
 * suite that runs Better Auth on its in-memory adapter. So it is in one place, beside the two
 * migrations it mirrors, and `authSchema.test.ts` walks the library's own table list against
 * the migrated schema: a field an upgrade adds that is not mapped and migrated fails the gate.
 *
 * The plugin lists are TRANSCRIBED from the plugins' exported `schema` (1.7.5) and written as
 * literals against the plugins' option types, so a field the library does not have is a `tsc`
 * error. A single-word field is omitted where its column has the same name.
 */

import type { McpOptions } from "@better-auth/mcp";
import type { BetterAuthOptions } from "better-auth";
import type { JwtOptions } from "better-auth/plugins";

/** The authentication identity: `app.auth_user`. Its gate is `userModel` in `auth.ts`. */
export const USER_TABLE = {
  modelName: "auth_user",
  fields: {
    emailVerified: "email_verified",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
} as const;

/** The three remaining core models, onto `060_auth.sql`. */
export function coreModels(): Pick<BetterAuthOptions, "session" | "account" | "verification"> {
  return {
    session: {
      modelName: "auth_session",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    account: {
      modelName: "auth_account",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        idToken: "id_token",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      // These are login tokens, not ingestion credentials -- but they are still Google
      // tokens in a database this repo goes to lengths to keep credentials out of.
      encryptOAuthTokens: true,
    },

    verification: {
      modelName: "auth_verification",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
  };
}

/** `jwt()`'s signing keys, onto `app.auth_jwks`. */
export const JWKS_TABLE: NonNullable<JwtOptions["schema"]> = {
  jwks: {
    modelName: "auth_jwks",
    fields: {
      publicKey: "public_key",
      privateKey: "private_key",
      createdAt: "created_at",
      expiresAt: "expires_at",
    },
  },
};

/** The OAuth provider's models, onto the `app.oauth_*` tables. */
export const OAUTH_TABLES: NonNullable<McpOptions["schema"]> = {
  oauthClient: {
    modelName: "oauth_client",
    fields: {
      clientId: "client_id",
      clientSecret: "client_secret",
      clientDiscoveryId: "client_discovery_id",
      skipConsent: "skip_consent",
      enableEndSession: "enable_end_session",
      subjectType: "subject_type",
      clientCredentialsScopes: "client_credentials_scopes",
      userId: "user_id",
      createdAt: "created_at",
      updatedAt: "updated_at",
      softwareId: "software_id",
      softwareVersion: "software_version",
      softwareStatement: "software_statement",
      redirectUris: "redirect_uris",
      postLogoutRedirectUris: "post_logout_redirect_uris",
      backchannelLogoutUri: "backchannel_logout_uri",
      backchannelLogoutSessionRequired: "backchannel_logout_session_required",
      tokenEndpointAuthMethod: "token_endpoint_auth_method",
      applicationType: "application_type",
      jwksUri: "jwks_uri",
      grantTypes: "grant_types",
      responseTypes: "response_types",
      requirePKCE: "require_pkce",
      dpopBoundAccessTokens: "dpop_bound_access_tokens",
      referenceId: "reference_id",
    },
  },
  oauthResource: {
    modelName: "oauth_resource",
    fields: {
      accessTokenTtl: "access_token_ttl",
      refreshTokenTtl: "refresh_token_ttl",
      signingAlgorithm: "signing_algorithm",
      signingKeyId: "signing_key_id",
      allowedScopes: "allowed_scopes",
      customClaims: "custom_claims",
      dpopBoundAccessTokensRequired: "dpop_bound_access_tokens_required",
      createdAt: "created_at",
      updatedAt: "updated_at",
      policyVersion: "policy_version",
    },
  },
  oauthClientResource: {
    modelName: "oauth_client_resource",
    fields: { clientId: "client_id", resourceId: "resource_id", createdAt: "created_at" },
  },
  oauthRefreshToken: {
    modelName: "oauth_refresh_token",
    fields: {
      clientId: "client_id",
      sessionId: "session_id",
      userId: "user_id",
      referenceId: "reference_id",
      authorizationCodeId: "authorization_code_id",
      requestedUserInfoClaims: "requested_user_info_claims",
      expiresAt: "expires_at",
      createdAt: "created_at",
      rotatedAt: "rotated_at",
      rotationReplayResponse: "rotation_replay_response",
      rotationReplayExpiresAt: "rotation_replay_expires_at",
      authTime: "auth_time",
    },
  },
  oauthAccessToken: {
    modelName: "oauth_access_token",
    fields: {
      clientId: "client_id",
      sessionId: "session_id",
      userId: "user_id",
      referenceId: "reference_id",
      authorizationCodeId: "authorization_code_id",
      requestedUserInfoClaims: "requested_user_info_claims",
      refreshId: "refresh_id",
      expiresAt: "expires_at",
      createdAt: "created_at",
    },
  },
  oauthConsent: {
    modelName: "oauth_consent",
    fields: {
      clientId: "client_id",
      userId: "user_id",
      referenceId: "reference_id",
      requestedUserInfoClaims: "requested_user_info_claims",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  oauthClientAssertion: {
    modelName: "oauth_client_assertion",
    fields: { expiresAt: "expires_at" },
  },
};
