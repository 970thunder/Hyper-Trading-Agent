"""Commercial worker placeholder.

The production compose starts this process so long-running RAG ingestion and
Agent jobs have a stable deployment target. The current MVP runs ingestion
synchronously; queued execution can be added without changing compose shape.
"""

from __future__ import annotations

import time


def main() -> int:
    while True:
        time.sleep(60)


if __name__ == "__main__":
    raise SystemExit(main())
