"""Private S3-compatible storage for original uploaded documents.

The application continues to keep a local working copy for parsers that need a
filesystem path.  When the optional S3 backend is enabled, every upload is
also written to a tenant-scoped private bucket and a worker can materialize a
missing local copy from the same storage key.  This permits API and worker
containers to run on different hosts without changing the RAG source contract.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any


class ObjectStorageError(RuntimeError):
    """A configured durable object storage operation could not complete."""


def _flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name, "")
    if not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _storage_key(value: str) -> str:
    key = str(value or "").replace("\\", "/").lstrip("/")
    path = PurePosixPath(key)
    if not key or path.is_absolute() or ".." in path.parts or not key.startswith("uploads/"):
        raise ObjectStorageError("object storage key is invalid")
    return key


@dataclass(frozen=True)
class ObjectStorageConfig:
    backend: str
    endpoint_url: str
    bucket: str
    access_key: str
    secret_key: str
    region: str
    verify_tls: bool

    @classmethod
    def from_environment(cls) -> "ObjectStorageConfig":
        return cls(
            backend=os.getenv("HYPER_TRADING_OBJECT_STORAGE_BACKEND", "local").strip().lower() or "local",
            endpoint_url=os.getenv("HYPER_TRADING_OBJECT_STORAGE_ENDPOINT", "").strip(),
            bucket=os.getenv("HYPER_TRADING_OBJECT_STORAGE_BUCKET", "").strip(),
            access_key=os.getenv("HYPER_TRADING_OBJECT_STORAGE_ACCESS_KEY", "").strip(),
            secret_key=os.getenv("HYPER_TRADING_OBJECT_STORAGE_SECRET_KEY", "").strip(),
            region=os.getenv("HYPER_TRADING_OBJECT_STORAGE_REGION", "us-east-1").strip() or "us-east-1",
            verify_tls=_flag("HYPER_TRADING_OBJECT_STORAGE_VERIFY_TLS", True),
        )


class LocalObjectStorage:
    backend = "local"

    def upload_file(self, local_path: Path, storage_key: str, *, content_type: str = "") -> dict[str, Any]:
        del local_path, content_type
        return {"backend": self.backend, "storage_key": _storage_key(storage_key), "durable": False}

    def materialize_file(self, storage_key: str, destination: Path) -> Path:
        del storage_key, destination
        raise ObjectStorageError("object storage is disabled")

    def delete_file(self, storage_key: str) -> None:
        del storage_key

    def status(self) -> dict[str, Any]:
        return {"backend": self.backend, "configured": True, "available": True, "bucket": "", "error": ""}


class S3ObjectStorage:
    backend = "s3"

    def __init__(self, config: ObjectStorageConfig, *, client: Any | None = None) -> None:
        if config.backend != self.backend:
            raise ObjectStorageError("S3 object storage configuration is invalid")
        missing = [
            name
            for name, value in {
                "HYPER_TRADING_OBJECT_STORAGE_ENDPOINT": config.endpoint_url,
                "HYPER_TRADING_OBJECT_STORAGE_BUCKET": config.bucket,
                "HYPER_TRADING_OBJECT_STORAGE_ACCESS_KEY": config.access_key,
                "HYPER_TRADING_OBJECT_STORAGE_SECRET_KEY": config.secret_key,
            }.items()
            if not value
        ]
        if missing:
            raise ObjectStorageError(f"S3 object storage is missing {', '.join(missing)}")
        self.config = config
        self._client = client

    @property
    def client(self) -> Any:
        if self._client is None:
            try:
                import boto3
                from botocore.config import Config
            except ImportError as exc:  # pragma: no cover - dependency is required in production images
                raise ObjectStorageError("S3 object storage requires boto3") from exc
            self._client = boto3.client(
                "s3",
                endpoint_url=self.config.endpoint_url,
                aws_access_key_id=self.config.access_key,
                aws_secret_access_key=self.config.secret_key,
                region_name=self.config.region,
                verify=self.config.verify_tls,
                config=Config(s3={"addressing_style": "path"}),
            )
        return self._client

    def _ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.config.bucket)
            return
        except Exception as head_error:  # Provider-specific error types vary between S3 and MinIO.
            try:
                create_args: dict[str, Any] = {"Bucket": self.config.bucket}
                if self.config.region != "us-east-1" and not self.config.endpoint_url.startswith(("http://", "https://")):
                    create_args["CreateBucketConfiguration"] = {"LocationConstraint": self.config.region}
                self.client.create_bucket(**create_args)
            except Exception as create_error:
                raise ObjectStorageError("could not access or create the object-storage bucket") from create_error

    def upload_file(self, local_path: Path, storage_key: str, *, content_type: str = "") -> dict[str, Any]:
        key = _storage_key(storage_key)
        if not local_path.is_file():
            raise ObjectStorageError("local upload file is missing")
        try:
            self._ensure_bucket()
            extra_args = {"ContentType": content_type} if content_type else None
            if extra_args:
                self.client.upload_file(str(local_path), self.config.bucket, key, ExtraArgs=extra_args)
            else:
                self.client.upload_file(str(local_path), self.config.bucket, key)
        except ObjectStorageError:
            raise
        except Exception as exc:
            raise ObjectStorageError("could not upload original document to object storage") from exc
        return {"backend": self.backend, "storage_key": key, "bucket": self.config.bucket, "durable": True}

    def materialize_file(self, storage_key: str, destination: Path) -> Path:
        key = _storage_key(storage_key)
        temporary = destination.with_name(f".{destination.name}.download")
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            self.client.download_file(self.config.bucket, key, str(temporary))
            temporary.replace(destination)
        except Exception as exc:
            if temporary.exists():
                temporary.unlink(missing_ok=True)
            raise ObjectStorageError("could not materialize original document from object storage") from exc
        return destination

    def delete_file(self, storage_key: str) -> None:
        key = _storage_key(storage_key)
        try:
            self.client.delete_object(Bucket=self.config.bucket, Key=key)
        except Exception as exc:
            raise ObjectStorageError("could not delete object-storage document") from exc

    def status(self) -> dict[str, Any]:
        try:
            self._ensure_bucket()
        except ObjectStorageError as exc:
            return {
                "backend": self.backend,
                "configured": True,
                "available": False,
                "bucket": self.config.bucket,
                "error": str(exc),
            }
        return {
            "backend": self.backend,
            "configured": True,
            "available": True,
            "bucket": self.config.bucket,
            "error": "",
        }


def build_object_storage(config: ObjectStorageConfig | None = None) -> LocalObjectStorage | S3ObjectStorage:
    resolved = config or ObjectStorageConfig.from_environment()
    if resolved.backend == "local":
        return LocalObjectStorage()
    if resolved.backend == "s3":
        return S3ObjectStorage(resolved)
    raise ObjectStorageError("HYPER_TRADING_OBJECT_STORAGE_BACKEND must be local or s3")


def object_storage_status() -> dict[str, Any]:
    try:
        return build_object_storage().status()
    except ObjectStorageError as exc:
        return {
            "backend": ObjectStorageConfig.from_environment().backend,
            "configured": False,
            "available": False,
            "bucket": "",
            "error": str(exc),
        }
