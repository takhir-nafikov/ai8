# pdf_to_embeddings_json.py

import argparse
import json
import uuid
import numpy as np
from pathlib import Path

import requests
from unstructured.partition.pdf import partition_pdf
from unstructured.chunking.title import chunk_by_title


OLLAMA_URL = "http://localhost:11434/api/embed"
DEFAULT_MODEL = "nomic-embed-text"


def embed_text(text: str, model: str = DEFAULT_MODEL) -> list[float]:
    response = requests.post(
        OLLAMA_URL,
        json={
            "model": model,
            "input": text,
        },
        timeout=120,
    )
    response.raise_for_status()

    data = response.json()
    return data["embeddings"][0]


def get_section(chunk) -> str | None:
    metadata = getattr(chunk, "metadata", None)

    if metadata and getattr(metadata, "section", None):
        return metadata.section

    if metadata and getattr(metadata, "category_depth", None) == 0:
        return str(chunk)

    return None


def main(pdf_path: str, output_path: str, model: str):
    pdf_path = Path(pdf_path)

    elements = partition_pdf(
        filename=str(pdf_path),
        strategy="fast",
        languages=["rus"],
    )
    print(f"Elements: {len(elements)}")

    print("Chunking...")
    chunks = chunk_by_title(
        elements,
        max_characters=1500,
        combine_text_under_n_chars=300,
        new_after_n_chars=1200,
    )
    print(f"Chunks: {len(chunks)}")

    records = []

    current_section = None

    for idx, chunk in enumerate(chunks):
        print(f"[{idx+1}/{len(chunks)}] Embedding...")
        text = str(chunk).strip()
        if not text:
            continue

        section = get_section(chunk) or current_section or "unknown"
        current_section = section

        embedding = np.array(embed_text(text, model), dtype=np.float32)

        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm

        record = {
            "chunk_id": f"{pdf_path.stem}-{idx:05d}",
            "source_file": pdf_path.name,
            "section": section,
            "text": text,
            "embedding_model": model,
            "embedding": embedding.tolist(),
            "metadata": {
                "chunk_index": idx,
                "chars": len(text),
                "element_id": str(uuid.uuid4()),
            },
        }

        records.append(record)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"Saved {len(records)} chunks to {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", help="Path to PDF file")
    parser.add_argument("-o", "--output", default="chunks.json")
    parser.add_argument("-m", "--model", default=DEFAULT_MODEL)

    args = parser.parse_args()

    main(args.pdf, args.output, args.model)