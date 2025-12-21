"""
Filing Analysis Tools for Fundamental Agent.

These tools call the existing Next.js API routes to:
- Fetch filing metadata and sections
- Search within filings
- Get AI-powered analysis
"""

from __future__ import annotations

import os
import httpx
from typing import Optional, Dict, Any, List


# API base URL - defaults to localhost for development
API_BASE_URL = os.environ.get("FILING_API_URL", "http://localhost:3000")


async def fetch_filing_metadata(filing_id: str) -> Dict[str, Any]:
    """
    Fetch filing manifest/metadata.

    Args:
        filing_id: Filing identifier (e.g., 'AAPL-10-K-2024-10-30')

    Returns:
        Filing metadata including sections TOC
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_BASE_URL}/api/filings/{filing_id}/manifest",
            timeout=30.0
        )

        if response.status_code != 200:
            raise Exception(f"Failed to fetch filing metadata: {response.status_code}")

        data = response.json()
        return {
            "filingId": data.get("filing_id"),
            "ticker": data.get("ticker"),
            "cik": data.get("cik"),
            "companyName": data.get("company_name"),
            "formType": data.get("form_type"),
            "filedAt": data.get("filed_at"),
            "reportPeriod": data.get("report_period"),
            "sections": data.get("sections", []),
            "stats": data.get("stats", {}),
        }


async def fetch_section_content(
    filing_id: str,
    section_id: str,
    format: str = "text"
) -> Dict[str, Any]:
    """
    Fetch content of a specific section.

    Args:
        filing_id: Filing identifier
        section_id: Section ID (e.g., 'item_1a', 'item_7')
        format: Response format ('text' or 'html')

    Returns:
        Section content with text and optional HTML
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_BASE_URL}/api/filings/{filing_id}/section/{section_id}",
            params={"format": format},
            timeout=30.0
        )

        if response.status_code != 200:
            raise Exception(f"Failed to fetch section {section_id}: {response.status_code}")

        data = response.json()
        section = data.get("section", {})

        return {
            "sectionId": section.get("id"),
            "label": section.get("label"),
            "text": section.get("text", ""),
            "html": section.get("html"),
            "charStart": section.get("char_start", 0),
            "charEnd": section.get("char_end", 0),
        }


async def search_filing(
    filing_id: str,
    query: str,
    top_k: int = 5
) -> Dict[str, Any]:
    """
    Search for keywords within a filing.

    Args:
        filing_id: Filing identifier
        query: Search query
        top_k: Maximum results to return

    Returns:
        Search matches with snippets and section references
    """
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{API_BASE_URL}/api/filings/{filing_id}/search",
            params={"q": query, "topK": top_k},
            timeout=30.0
        )

        if response.status_code != 200:
            raise Exception(f"Search failed: {response.status_code}")

        data = response.json()

        return {
            "query": data.get("query", query),
            "matches": [
                {
                    "sectionId": match.get("section_id"),
                    "chunkId": match.get("chunk_id"),
                    "snippet": match.get("snippet"),
                    "score": match.get("score"),
                }
                for match in data.get("matches", [])
            ],
            "totalMatches": len(data.get("matches", [])),
        }


async def analyze_filing(
    filing_id: str,
    question: str,
    scope: str = "entire_filing",
    section_ids: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Ask an analytical question about the filing using RAG.

    Args:
        filing_id: Filing identifier
        question: The question to answer
        scope: Analysis scope ('current_section', 'selected_sections', 'entire_filing')
        section_ids: Specific sections to analyze (optional)

    Returns:
        AI answer with citations
    """
    async with httpx.AsyncClient() as client:
        payload = {
            "question": question,
            "scope": scope,
        }
        if section_ids:
            payload["sectionIds"] = section_ids

        response = await client.post(
            f"{API_BASE_URL}/api/filings/{filing_id}/ask",
            json=payload,
            timeout=60.0  # Longer timeout for AI analysis
        )

        if response.status_code != 200:
            raise Exception(f"Analysis failed: {response.status_code}")

        data = response.json()

        return {
            "answer": data.get("answer", ""),
            "citations": [
                {
                    "sectionId": cite.get("section_id"),
                    "sectionLabel": cite.get("section_label"),
                    "chunkId": cite.get("chunk_id"),
                    "snippet": cite.get("snippet"),
                }
                for cite in data.get("citations", [])
            ],
            "confidence": data.get("confidence", 0.0),
            "followups": data.get("followups", []),
        }


async def summarize_section(
    filing_id: str,
    section_id: str,
    section_text: Optional[str] = None
) -> Dict[str, Any]:
    """
    Summarize a section of the filing.

    If section_text is provided, uses it directly.
    Otherwise fetches the section content first.

    Args:
        filing_id: Filing identifier
        section_id: Section to summarize
        section_text: Optional pre-fetched section text

    Returns:
        Summary and key points
    """
    # If text not provided, fetch it
    if not section_text:
        section = await fetch_section_content(filing_id, section_id, format="text")
        section_text = section.get("text", "")

    if not section_text:
        return {
            "summary": "No content available for this section.",
            "keyPoints": [],
        }

    # Use the analyze endpoint with a summarization prompt
    result = await analyze_filing(
        filing_id=filing_id,
        question=f"Provide a concise summary of this section, highlighting the key points and any material information. Section: {section_id}",
        scope="current_section",
        section_ids=[section_id]
    )

    return {
        "summary": result.get("answer", ""),
        "keyPoints": [],  # Could parse from answer if needed
        "citations": result.get("citations", []),
    }


# ============================================================================
# Sync wrappers for LangGraph nodes
# ============================================================================

import asyncio


def fetch_filing_metadata_sync(filing_id: str) -> Dict[str, Any]:
    """Sync wrapper for fetch_filing_metadata."""
    return asyncio.run(fetch_filing_metadata(filing_id))


def fetch_section_content_sync(
    filing_id: str,
    section_id: str,
    format: str = "text"
) -> Dict[str, Any]:
    """Sync wrapper for fetch_section_content."""
    return asyncio.run(fetch_section_content(filing_id, section_id, format))


def search_filing_sync(
    filing_id: str,
    query: str,
    top_k: int = 5
) -> Dict[str, Any]:
    """Sync wrapper for search_filing."""
    return asyncio.run(search_filing(filing_id, query, top_k))


def analyze_filing_sync(
    filing_id: str,
    question: str,
    scope: str = "entire_filing",
    section_ids: Optional[List[str]] = None
) -> Dict[str, Any]:
    """Sync wrapper for analyze_filing."""
    return asyncio.run(analyze_filing(filing_id, question, scope, section_ids))


def summarize_section_sync(
    filing_id: str,
    section_id: str,
    section_text: Optional[str] = None
) -> Dict[str, Any]:
    """Sync wrapper for summarize_section."""
    return asyncio.run(summarize_section(filing_id, section_id, section_text))
