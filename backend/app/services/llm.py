import json
import logging
import re
from typing import Any
from pydantic import BaseModel, Field

from app.config import GEMINI_API_KEY

logger = logging.getLogger(__name__)


class GeneratedFlashcardItem(BaseModel):
    question: str = Field(
        description="Concrete, detail-focused multiple-choice question testing a specific technical mechanism, trade-off, or fact from the passage."
    )
    options: list[str] = Field(
        description="Exactly 4 multiple-choice options formatted as 'A) ...', 'B) ...', 'C) ...', 'D) ...'."
    )
    answer: str = Field(
        description="The correct option letter and a concise technical explanation referencing the passage."
    )


class ChunkExtractionSchema(BaseModel):
    chunk_summary: str = Field(
        description="1-2 sentence technical summary of this chunk."
    )
    flashcards: list[GeneratedFlashcardItem] = Field(
        description="2 to 4 detail-oriented multiple-choice flashcards extracted from this chunk."
    )


def chunk_text(
    text: str, target_words: int = 900, overlap_words: int = 100
) -> list[str]:
    """Split article prose into ~900-word overlapping chunks so single-sentence technical details aren't lost."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    if not paragraphs:
        return []

    chunks: list[str] = []
    current_Run: list[str] = []
    current_words = 0

    for para in paragraphs:
        para_words = len(para.split())
        if current_words + para_words > target_words and current_Run:
            chunks.append("\n\n".join(current_Run))
            # Retain trailing paragraphs for context overlap
            overlap_run: list[str] = []
            overlap_count = 0
            for prev_para in reversed(current_Run):
                pw = len(prev_para.split())
                if overlap_count + pw <= overlap_words or not overlap_run:
                    overlap_run.insert(0, prev_para)
                    overlap_count += pw
                else:
                    break
            current_Run = overlap_run
            current_words = overlap_count

        current_Run.append(para)
        current_words += para_words

    if current_Run:
        chunks.append("\n\n".join(current_Run))

    # Cap at 6 chunks for PoC latency while covering long posts thoroughly
    return chunks[:6]


def _extract_chunk_with_gemini(
    title: str, chunk: str, chunk_index: int, total_chunks: int
) -> ChunkExtractionSchema:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_API_KEY)
    prompt = (
        f"You are extracting technical Anki flashcards for a software engineer reading '{title}' "
        f"(Chunk {chunk_index + 1} of {total_chunks}).\n\n"
        "Instructions:\n"
        "1. Write a concise 1-2 sentence technical summary of this chunk.\n"
        "2. Extract 2 to 3 concrete, detail-oriented Multiple-Choice flashcards that capture minute technical details, "
        "specific numbers, architectural mechanisms, command flags, or subtle trade-offs mentioned in this passage—the kind of single-sentence detail a general summary usually skips.\n"
        "3. Every flashcard MUST have exactly 4 plausible options labeled 'A) ...', 'B) ...', 'C) ...', 'D) ...' and a clear 'answer' string stating the winning option and why.\n\n"
        f"--- PASSAGE CHUNK {chunk_index + 1} ---\n{chunk}"
    )

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ChunkExtractionSchema,
            temperature=0.2,
        ),
    )
    data = json.loads(response.text or "{}")
    return ChunkExtractionSchema.model_validate(data)


def _fallback_extract_from_chunk(
    title: str, chunk: str, chunk_index: int
) -> ChunkExtractionSchema:
    """Deterministic technical passage extractor used when GEMINI_API_KEY is not set in backend/.env."""
    sentences = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+", " ".join(chunk.split()))
        if len(s.strip()) > 45
    ]
    if not sentences:
        sentences = [chunk.strip()[:240]]

    summary_sent = sentences[0][:260]
    cards: list[GeneratedFlashcardItem] = []

    # Select up to 2 information-dense sentences per chunk
    scored = sorted(
        sentences,
        key=lambda s: (
            sum(1 for ch in s if ch.isdigit()) * 2
            + sum(
                1
                for kw in (
                    "because",
                    "instead",
                    "latency",
                    "memory",
                    "queue",
                    "token",
                    "index",
                    "cache",
                    "database",
                    "api",
                    "model",
                    "thread",
                    "protocol",
                    "default",
                    "requires",
                    "allows",
                )
                if kw in s.lower()
            )
            * 3
            + min(len(s), 180) // 30
        ),
        reverse=True,
    )

    chosen = scored[:2] if len(scored) >= 2 else scored[:1]
    for idx, fact in enumerate(chosen):
        clean_fact = fact.rstrip(".")
        cards.append(
            GeneratedFlashcardItem(
                question=(
                    f"[{title} — Section {chunk_index + 1}.{idx + 1}] "
                    f"Which specific technical detail is stated in this section of the article?"
                ),
                options=[
                    f"A) {clean_fact}.",
                    "B) The operation relies exclusively on synchronous client-side polling without background state.",
                    "C) All intermediate payloads are discarded before persistence to avoid indexing overhead.",
                    "D) The configuration defaults to unbounded in-memory caching across all worker processes.",
                ],
                answer=(
                    f"Correct Answer: A\n\n"
                    f"Explanation (Chunk {chunk_index + 1}): The article specifically notes: \"{clean_fact}.\""
                ),
            )
        )

    return ChunkExtractionSchema(chunk_summary=summary_sent, flashcards=cards)


def generate_summary_and_flashcards(
    title: str, text: str
) -> tuple[str, list[dict[str, Any]]]:
    """Chunk article text and extract an overall summary + detail-level flashcards across all chunks."""
    chunks = chunk_text(text)
    if not chunks:
        chunks = [text.strip()]

    chunk_summaries: list[str] = []
    all_cards: list[dict[str, Any]] = []

    for idx, chunk in enumerate(chunks):
        extraction: ChunkExtractionSchema | None = None
        if GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
            try:
                extraction = _extract_chunk_with_gemini(
                    title=title,
                    chunk=chunk,
                    chunk_index=idx,
                    total_chunks=len(chunks),
                )
            except Exception as exc:
                logger.warning(
                    "Gemini extraction failed on chunk %s (%s); using local chunk extractor fallback.",
                    idx,
                    exc,
                )

        if extraction is None:
            extraction = _fallback_extract_from_chunk(
                title=title, chunk=chunk, chunk_index=idx
            )

        if extraction.chunk_summary:
            chunk_summaries.append(extraction.chunk_summary.strip())

        for card in extraction.flashcards:
            opts = list(card.options)[:4]
            while len(opts) < 4:
                opts.append(f"{chr(65 + len(opts))}) None of the above")
            all_cards.append(
                {
                    "chunk_index": idx,
                    "question": card.question.strip(),
                    "options_json": opts,
                    "answer": card.answer.strip(),
                }
            )

    overall_summary = " ".join(chunk_summaries[:4]).strip()
    if not overall_summary:
        overall_summary = f"Extracted {len(all_cards)} detail-focused flashcards across {len(chunks)} chunk(s)."

    return overall_summary, all_cards
