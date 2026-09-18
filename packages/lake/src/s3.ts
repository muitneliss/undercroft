/**
 * {@link ObjectStore} backed by S3 or any S3-compatible service (MinIO).
 *
 * The seam is narrow enough that this file is the only place in the platform that knows
 * S3 exists. Everything above it runs against {@link InMemoryObjectStore} with no network.
 */

// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { byCodeUnit, ObjectNotFound, type ObjectStore } from "./objectStore.ts";

export interface S3StoreConfig {
  readonly bucket: string;
  readonly endpoint?: string;
  readonly region?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  /** MinIO needs path-style addressing; real S3 does not care. Defaults to true. */
  readonly forcePathStyle?: boolean;
}

function isNoSuchKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

export class S3ObjectStore implements ObjectStore {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(config: S3StoreConfig) {
    this.#bucket = config.bucket;
    this.#client = new S3Client({
      forcePathStyle: config.forcePathStyle ?? true,
      region: config.region ?? "us-east-1",
      ...(config.endpoint === undefined ? {} : { endpoint: config.endpoint }),
      ...(config.accessKeyId !== undefined && config.secretAccessKey !== undefined
        ? {
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      const body = response.Body;
      if (body === undefined) {
        throw new ObjectNotFound(key);
      }
      return await body.transformToByteArray();
    } catch (error) {
      if (isNoSuchKey(error)) {
        throw new ObjectNotFound(key);
      }
      throw error;
    }
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    await this.#client.send(new PutObjectCommand({ Bucket: this.#bucket, Key: key, Body: data }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNoSuchKey(error)) {
        return false;
      }
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const response = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#bucket,
          Prefix: prefix,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
      );
      for (const item of response.Contents ?? []) {
        if (item.Key !== undefined) {
          keys.push(item.Key);
        }
      }
      token = response.IsTruncated === true ? response.NextContinuationToken : undefined;
    } while (token !== undefined);
    // S3 returns keys in lexicographic order per page; sort to honour the contract across
    // page boundaries, which the in-memory store also guarantees.
    return keys.sort(byCodeUnit);
  }

  async delete(key: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
  }
}
