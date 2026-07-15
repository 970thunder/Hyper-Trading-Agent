from __future__ import annotations

from pathlib import Path

import pytest

from src.storage.object_store import ObjectStorageConfig, ObjectStorageError, S3ObjectStorage


class FakeS3Client:
    def __init__(self) -> None:
        self.buckets: set[str] = set()
        self.objects: dict[tuple[str, str], bytes] = {}

    def head_bucket(self, *, Bucket: str) -> None:
        if Bucket not in self.buckets:
            raise RuntimeError("missing bucket")

    def create_bucket(self, *, Bucket: str, **_: object) -> None:
        self.buckets.add(Bucket)

    def upload_file(self, filename: str, bucket: str, key: str, **_: object) -> None:
        self.objects[(bucket, key)] = Path(filename).read_bytes()

    def download_file(self, bucket: str, key: str, filename: str) -> None:
        Path(filename).write_bytes(self.objects[(bucket, key)])

    def delete_object(self, *, Bucket: str, Key: str) -> None:
        self.objects.pop((Bucket, Key), None)


def _storage(client: FakeS3Client) -> S3ObjectStorage:
    return S3ObjectStorage(
        ObjectStorageConfig(
            backend="s3",
            endpoint_url="http://minio:9000",
            bucket="hyper-trading",
            access_key="access",
            secret_key="secret",
            region="us-east-1",
            verify_tls=False,
        ),
        client=client,
    )


def test_s3_object_storage_round_trips_private_upload(tmp_path: Path) -> None:
    source = tmp_path / "source.md"
    source.write_text("drawdown controls", encoding="utf-8")
    client = FakeS3Client()
    storage = _storage(client)

    uploaded = storage.upload_file(source, "uploads/org_a/source.md", content_type="text/markdown")
    destination = tmp_path / "worker" / "source.md"
    materialized = storage.materialize_file("uploads/org_a/source.md", destination)

    assert uploaded["durable"] is True
    assert materialized.read_text(encoding="utf-8") == "drawdown controls"
    assert storage.status()["available"] is True


def test_s3_object_storage_rejects_path_traversal_keys(tmp_path: Path) -> None:
    source = tmp_path / "source.md"
    source.write_text("content", encoding="utf-8")

    with pytest.raises(ObjectStorageError, match="key is invalid"):
        _storage(FakeS3Client()).upload_file(source, "uploads/org_a/../../secret.md")
