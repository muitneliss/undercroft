"""S3 / MinIO implementation of :class:`~vcdo.lake.store.ObjectStore`.

Deliberately thin. All the interesting behaviour --- immutability, content
addressing, manifests, retention --- lives in :class:`~vcdo.lake.store.LakeStore`
above this seam, where it is testable without a network. This class only knows
how to move bytes.

That split is what lets the entire lake test suite run offline against
:class:`~vcdo.lake.memory.InMemoryObjectStore` while the production path differs
only in which object store is constructed.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - import cost only matters at runtime
    from vcdo.core.config import Config

__all__ = ["S3ObjectStore", "from_config"]


class S3ObjectStore:
    def __init__(
        self,
        bucket: str,
        *,
        endpoint_url: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
        client=None,
    ) -> None:
        self.bucket = bucket
        if client is not None:
            self._s3 = client
        else:
            import boto3

            self._s3 = boto3.client(
                "s3",
                endpoint_url=endpoint_url,
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                region_name=region,
            )

    def get(self, key: str) -> bytes:
        from botocore.exceptions import ClientError

        try:
            return self._s3.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                raise KeyError(f"no such object: {key}") from None
            raise

    def put(self, key: str, data: bytes) -> None:
        self._s3.put_object(Bucket=self.bucket, Key=key, Body=data)

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self._s3.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise
        return True

    def list(self, prefix: str) -> Iterator[str]:
        # Paginated explicitly. `list_objects_v2` truncates at 1000 keys and
        # returns success, so a naive single call silently reports a partial
        # lake -- which downstream reads as "these objects do not exist".
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                yield obj["Key"]

    def delete(self, key: str) -> None:
        self._s3.delete_object(Bucket=self.bucket, Key=key)


def from_config(cfg: Config, bucket: str | None = None) -> S3ObjectStore:
    return S3ObjectStore(
        bucket or cfg.s3_bucket_raw,
        endpoint_url=cfg.s3_endpoint,
        access_key=cfg.s3_access_key,
        secret_key=cfg.s3_secret_key,
        region=cfg.s3_region,
    )
