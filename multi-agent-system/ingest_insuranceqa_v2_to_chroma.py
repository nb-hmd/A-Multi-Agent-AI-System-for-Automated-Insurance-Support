"""
Build a persistent ChromaDB collection from the deccan-ai/insuranceQA-v2 dataset.

This script is designed to be reproducible and notebook-free.
"""

import argparse
import hashlib
import os
import sys
import time


def _stable_id(split_name: str, idx: int, question: str, answer: str) -> str:
    h = hashlib.sha256()
    h.update((split_name or "").encode("utf-8", errors="ignore"))
    h.update(b"|")
    h.update(str(idx).encode("utf-8", errors="ignore"))
    h.update(b"|")
    h.update((question or "").encode("utf-8", errors="ignore"))
    h.update(b"|")
    h.update((answer or "").encode("utf-8", errors="ignore"))
    return h.hexdigest()


def _normalize_text(t: str) -> str:
    t = str(t or "").strip()
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    return t


def _iter_rows(ds_dict, limit: int | None):
    seen = 0
    for split_name, ds in ds_dict.items():
        for i, row in enumerate(ds):
            q = _normalize_text(row.get("input", ""))
            a = _normalize_text(row.get("output", ""))
            if not q or not a:
                continue
            yield split_name, i, q, a
            seen += 1
            if limit is not None and seen >= limit:
                return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--chroma-path", default=os.getenv("CHROMA_PATH", "./chroma_db"))
    parser.add_argument("--collection", default=os.getenv("CHROMA_COLLECTION", "insurance_FAQ_collection"))
    parser.add_argument("--reset", action="store_true", help="Delete and recreate the collection first")
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--limit", type=int, default=0, help="Limit rows for smoke testing (0 = no limit)")
    parser.add_argument("--source", default="deccan-ai/insuranceQA-v2")
    args = parser.parse_args()

    try:
        from datasets import load_dataset
    except Exception as e:
        print(f"ERROR: datasets is not installed or failed to import: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        import chromadb
    except Exception as e:
        print(f"ERROR: chromadb is not installed or failed to import: {e}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.chroma_path, exist_ok=True)
    client = chromadb.PersistentClient(path=args.chroma_path)

    if args.reset:
        try:
            client.delete_collection(name=args.collection)
        except Exception:
            pass

    collection = client.get_or_create_collection(name=args.collection)

    ds = load_dataset(args.source)
    ds_dict = {k: v for k, v in ds.items() if k in {"train", "validation", "test"}}
    if not ds_dict:
        ds_dict = ds

    limit = None if int(args.limit or 0) <= 0 else int(args.limit)
    batch_size = max(1, int(args.batch_size))

    t0 = time.time()
    added = 0
    batch_docs = []
    batch_metas = []
    batch_ids = []

    for split_name, idx, q, a in _iter_rows(ds_dict, limit):
        doc = f"Question: {q}\nAnswer: {a}"
        batch_docs.append(doc)
        batch_metas.append({"question": q, "answer": a, "split": split_name, "source": args.source})
        batch_ids.append(_stable_id(split_name, idx, q, a))

        if len(batch_docs) >= batch_size:
            collection.add(documents=batch_docs, metadatas=batch_metas, ids=batch_ids)
            added += len(batch_docs)
            batch_docs, batch_metas, batch_ids = [], [], []
            if added % (batch_size * 10) == 0:
                elapsed = time.time() - t0
                rate = added / elapsed if elapsed > 0 else 0
                print(f"Added {added} docs (rate {rate:.1f}/s)")

    if batch_docs:
        collection.add(documents=batch_docs, metadatas=batch_metas, ids=batch_ids)
        added += len(batch_docs)

    total = collection.count()
    elapsed = time.time() - t0
    print(f"Done. Added {added} docs. Collection now has {total} docs. Time {elapsed:.1f}s.")


if __name__ == "__main__":
    main()

