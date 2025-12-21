"""
SEC Filing Parser - Extract sections and create AI/UI friendly derivatives.

Parses 10-K and 10-Q filings to create:
- manifest.json: Small metadata file for UI + Copilot context
- section_index.json: Per-section details with precise locations
- chunks.jsonl: RAG-ready text chunks for vector search
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from html.parser import HTMLParser
from io import StringIO

logger = logging.getLogger(__name__)


# 10-K section patterns (Item numbers and common names)
SECTION_10K_PATTERNS = [
    (r"item\s*1\.?\s*business", "item_1", "Item 1. Business"),
    (r"item\s*1a\.?\s*risk\s*factors", "item_1a", "Item 1A. Risk Factors"),
    (r"item\s*1b\.?\s*unresolved\s*staff\s*comments", "item_1b", "Item 1B. Unresolved Staff Comments"),
    (r"item\s*1c\.?\s*cybersecurity", "item_1c", "Item 1C. Cybersecurity"),
    (r"item\s*2\.?\s*properties", "item_2", "Item 2. Properties"),
    (r"item\s*3\.?\s*legal\s*proceedings", "item_3", "Item 3. Legal Proceedings"),
    (r"item\s*4\.?\s*mine\s*safety", "item_4", "Item 4. Mine Safety Disclosures"),
    (r"item\s*5\.?\s*market\s*for", "item_5", "Item 5. Market for Registrant's Common Equity"),
    (r"item\s*6\.?\s*reserved", "item_6", "Item 6. [Reserved]"),
    (r"item\s*7\.?\s*management.{0,20}discussion", "item_7", "Item 7. MD&A"),
    (r"item\s*7a\.?\s*quantitative", "item_7a", "Item 7A. Quantitative and Qualitative Disclosures"),
    (r"item\s*8\.?\s*financial\s*statements", "item_8", "Item 8. Financial Statements"),
    (r"item\s*9\.?\s*changes\s*in\s*accountants", "item_9", "Item 9. Changes in and Disagreements with Accountants"),
    (r"item\s*9a\.?\s*controls", "item_9a", "Item 9A. Controls and Procedures"),
    (r"item\s*9b\.?\s*other\s*information", "item_9b", "Item 9B. Other Information"),
    (r"item\s*9c\.?\s*disclosure", "item_9c", "Item 9C. Disclosure Regarding Foreign Jurisdictions"),
    (r"item\s*10\.?\s*directors", "item_10", "Item 10. Directors, Executive Officers"),
    (r"item\s*11\.?\s*executive\s*compensation", "item_11", "Item 11. Executive Compensation"),
    (r"item\s*12\.?\s*security\s*ownership", "item_12", "Item 12. Security Ownership"),
    (r"item\s*13\.?\s*certain\s*relationships", "item_13", "Item 13. Certain Relationships"),
    (r"item\s*14\.?\s*principal\s*account", "item_14", "Item 14. Principal Accountant Fees"),
    (r"item\s*15\.?\s*exhibits", "item_15", "Item 15. Exhibits and Financial Statement Schedules"),
    (r"item\s*16\.?\s*form\s*10-k\s*summary", "item_16", "Item 16. Form 10-K Summary"),
]

# 10-Q section patterns
SECTION_10Q_PATTERNS = [
    (r"part\s*i[\s\-—]+financial\s*information", "part_1", "Part I. Financial Information"),
    (r"item\s*1\.?\s*financial\s*statements", "item_1", "Item 1. Financial Statements"),
    (r"item\s*2\.?\s*management.{0,20}discussion", "item_2", "Item 2. MD&A"),
    (r"item\s*3\.?\s*quantitative", "item_3", "Item 3. Quantitative and Qualitative Disclosures"),
    (r"item\s*4\.?\s*controls", "item_4", "Item 4. Controls and Procedures"),
    (r"part\s*ii[\s\-—]+other\s*information", "part_2", "Part II. Other Information"),
    (r"item\s*1\.?\s*legal\s*proceedings", "item_1_legal", "Item 1. Legal Proceedings"),
    (r"item\s*1a\.?\s*risk\s*factors", "item_1a", "Item 1A. Risk Factors"),
    (r"item\s*2\.?\s*unregistered\s*sales", "item_2_sales", "Item 2. Unregistered Sales of Equity"),
    (r"item\s*3\.?\s*defaults", "item_3_defaults", "Item 3. Defaults Upon Senior Securities"),
    (r"item\s*4\.?\s*mine\s*safety", "item_4_mine", "Item 4. Mine Safety Disclosures"),
    (r"item\s*5\.?\s*other\s*information", "item_5", "Item 5. Other Information"),
    (r"item\s*6\.?\s*exhibits", "item_6", "Item 6. Exhibits"),
]


class HTMLTextExtractor(HTMLParser):
    """Extract plain text from HTML, preserving structure."""

    def __init__(self):
        super().__init__()
        self.result = StringIO()
        self.skip_tags = {'script', 'style', 'head', 'meta', 'link'}
        self.block_tags = {'p', 'div', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'}
        self.current_tag = None
        self.skip_content = False

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag.lower()
        if self.current_tag in self.skip_tags:
            self.skip_content = True
        if self.current_tag in self.block_tags:
            self.result.write('\n')

    def handle_endtag(self, tag):
        if tag.lower() in self.skip_tags:
            self.skip_content = False
        if tag.lower() in self.block_tags:
            self.result.write('\n')

    def handle_data(self, data):
        if not self.skip_content:
            self.result.write(data)

    def get_text(self) -> str:
        return self.result.getvalue()


@dataclass
class Section:
    """Represents a section of a filing."""
    id: str
    label: str
    char_start: int
    char_end: int
    text: str
    anchors: List[str] = field(default_factory=list)
    chunk_ids: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "char_start": self.char_start,
            "char_end": self.char_end,
            "anchors": self.anchors,
            "chunk_ids": self.chunk_ids,
        }


@dataclass
class Chunk:
    """Represents a text chunk for RAG."""
    id: str
    section_id: str
    text: str
    char_start: int  # Approximate - may drift due to whitespace normalization
    char_end: int    # Approximate - may drift due to whitespace normalization
    token_count: int
    anchor_id: str = ""  # Stable anchor: section_id + block index (e.g., "item_1a_b003")
    block_index: int = 0  # Block index within section for reliable UI highlighting

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "section_id": self.section_id,
            "text": self.text,
            "char_start": self.char_start,
            "char_end": self.char_end,
            "token_count": self.token_count,
            "anchor_id": self.anchor_id,
            "block_index": self.block_index,
        }


@dataclass
class ParsedFiling:
    """Result of parsing a filing."""
    filing_id: str
    cik: str
    ticker: str
    company_name: str
    form_type: str
    filed_at: str
    report_period: Optional[str]
    raw_text: str
    sections: List[Section]
    chunks: List[Chunk]
    word_count: int

    def to_manifest(self) -> Dict[str, Any]:
        """Generate manifest.json content."""
        return {
            "filing_id": self.filing_id,
            "cik": self.cik,
            "ticker": self.ticker,
            "company_name": self.company_name,
            "form_type": self.form_type,
            "filed_at": self.filed_at,
            "report_period": self.report_period,
            "sections": [
                {"id": s.id, "label": s.label}
                for s in self.sections
            ],
            "stats": {
                "word_count": self.word_count,
                "section_count": len(self.sections),
                "chunk_count": len(self.chunks),
            }
        }

    def to_section_index(self) -> Dict[str, Any]:
        """Generate section_index.json content."""
        return {
            "filing_id": self.filing_id,
            "sections": [s.to_dict() for s in self.sections],
        }


class FilingParser:
    """Parse SEC filings to extract sections and create derivatives."""

    def __init__(
        self,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
    ):
        """
        Initialize parser.

        Args:
            chunk_size: Target size for text chunks (in words)
            chunk_overlap: Overlap between chunks (in words)
        """
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def parse(
        self,
        html_content: str,
        filing_id: str,
        cik: str,
        ticker: str,
        company_name: str,
        form_type: str,
        filed_at: str,
        report_period: Optional[str] = None,
    ) -> ParsedFiling:
        """
        Parse an SEC filing HTML.

        Args:
            html_content: Raw HTML content
            filing_id: Filing identifier (e.g., "0000320193-24-000123")
            cik: Company CIK
            ticker: Stock ticker
            company_name: Company name
            form_type: Form type (10-K, 10-Q)
            filed_at: Filing date
            report_period: Report period date

        Returns:
            ParsedFiling with sections and chunks
        """
        # Extract text from HTML
        text = self._extract_text(html_content)

        # Select section patterns based on form type
        if "10-K" in form_type.upper():
            patterns = SECTION_10K_PATTERNS
        else:
            patterns = SECTION_10Q_PATTERNS

        # Find sections
        sections = self._find_sections(text, patterns)

        # Generate chunks
        chunks = self._generate_chunks(text, sections, filing_id)

        # Update sections with chunk IDs
        for section in sections:
            section.chunk_ids = [
                c.id for c in chunks
                if c.section_id == section.id
            ]

        # Calculate stats
        word_count = len(text.split())

        return ParsedFiling(
            filing_id=filing_id,
            cik=cik,
            ticker=ticker,
            company_name=company_name,
            form_type=form_type,
            filed_at=filed_at,
            report_period=report_period,
            raw_text=text,
            sections=sections,
            chunks=chunks,
            word_count=word_count,
        )

    def _extract_text(self, html: str) -> str:
        """Extract clean text from HTML."""
        parser = HTMLTextExtractor()
        try:
            parser.feed(html)
            text = parser.get_text()
        except Exception as e:
            logger.warning(f"HTML parsing error, falling back to regex: {e}")
            # Fallback: strip tags with regex
            text = re.sub(r'<[^>]+>', ' ', html)

        # Clean up whitespace while preserving newlines for structure
        # 1. Normalize Windows/Mac newlines to Unix
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        # 2. Collapse horizontal whitespace (spaces, tabs) but NOT newlines
        text = re.sub(r'[ \t]+', ' ', text)
        # 3. Remove trailing whitespace from lines
        text = re.sub(r' +\n', '\n', text)
        # 4. Collapse 3+ consecutive newlines to 2 (preserve paragraph breaks)
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = text.strip()

        return text

    def _find_sections(
        self,
        text: str,
        patterns: List[Tuple[str, str, str]],
    ) -> List[Section]:
        """Find sections in the text."""
        sections = []
        text_lower = text.lower()

        # Find all section matches
        matches = []
        for pattern, section_id, label in patterns:
            for match in re.finditer(pattern, text_lower, re.IGNORECASE):
                matches.append({
                    "id": section_id,
                    "label": label,
                    "start": match.start(),
                    "match_text": match.group(),
                })

        # Sort by position
        matches.sort(key=lambda x: x["start"])

        # SEC filings have multiple occurrences of section headers:
        # 1. TOC entries (very little content after them)
        # 2. Inline references within narrative (also little content)
        # 3. Actual section headers (lots of content after them)
        #
        # Strategy: For each section ID, keep the occurrence with the MOST content following it.
        # This reliably identifies the actual section, not TOC or inline references.
        section_matches = {}
        text_len = len(text)

        for i, m in enumerate(matches):
            section_id = m["id"]
            # Calculate content length: distance to next match or end of text
            if i < len(matches) - 1:
                content_len = matches[i + 1]["start"] - m["start"]
            else:
                content_len = text_len - m["start"]

            # Keep the match with the most content after it
            if section_id not in section_matches or content_len > section_matches[section_id]["_content_len"]:
                section_matches[section_id] = {**m, "_content_len": content_len}

        # Re-sort by position to maintain document order
        unique_matches = sorted(section_matches.values(), key=lambda x: x["start"])

        # Create sections with end positions
        for i, match in enumerate(unique_matches):
            if i < len(unique_matches) - 1:
                end = unique_matches[i + 1]["start"]
            else:
                end = len(text)

            section_text = text[match["start"]:end].strip()

            # Find potential anchors (headers, key terms)
            anchors = self._find_anchors(section_text)

            section = Section(
                id=match["id"],
                label=match["label"],
                char_start=match["start"],
                char_end=end,
                text=section_text,
                anchors=anchors[:10],  # Limit to 10 anchors
            )
            sections.append(section)

        return sections

    def _find_anchors(self, text: str) -> List[str]:
        """Find anchor points (headers, key terms) in section text."""
        anchors = []
        seen = set()

        # Pattern 1: ALL CAPS headers (traditional SEC style)
        # Allow punctuation, numbers, and longer text
        for match in re.finditer(r'\n\s*([A-Z][A-Z0-9\s\-—–,.:;\'\"()]{5,80})\s*\n', text):
            anchor = match.group(1).strip()
            if anchor and anchor.upper() == anchor and anchor not in seen:
                seen.add(anchor)
                anchors.append(anchor)

        # Pattern 2: Title Case headers (modern SEC filings)
        # e.g., "Risk Factors", "Management's Discussion"
        for match in re.finditer(r'\n\s*([A-Z][a-zA-Z0-9\s\-—–,.:;\'\"()]{5,80})\s*\n', text):
            anchor = match.group(1).strip()
            # Check if it looks like a title (words start with caps, not just first word)
            words = anchor.split()
            if len(words) >= 2:
                # At least 2 words start with uppercase (title case indicator)
                caps_words = sum(1 for w in words if w and w[0].isupper())
                if caps_words >= 2 and anchor not in seen:
                    seen.add(anchor)
                    anchors.append(anchor)

        # Pattern 3: Bold-style markers (text between newlines, short, capitalized)
        for match in re.finditer(r'\n\s*([A-Z][^.\n]{3,40})\s*\n', text):
            anchor = match.group(1).strip()
            words = anchor.split()
            # Avoid long sentences, keep short header-like text
            if 2 <= len(words) <= 8 and anchor not in seen:
                seen.add(anchor)
                anchors.append(anchor)

        return anchors[:20]  # Limit to top 20 anchors

    def _generate_chunks(
        self,
        text: str,
        sections: List[Section],
        filing_id: str,
    ) -> List[Chunk]:
        """Generate text chunks for RAG with stable anchor IDs."""
        chunks = []
        chunk_counter = 0

        for section in sections:
            section_text = section.text
            words = section_text.split()
            section_block_index = 0  # Block counter within this section

            if len(words) <= self.chunk_size:
                # Section fits in one chunk
                chunk_id = f"{filing_id}_chunk_{chunk_counter:04d}"
                anchor_id = f"{section.id}_b{section_block_index:03d}"
                chunk = Chunk(
                    id=chunk_id,
                    section_id=section.id,
                    text=section_text,
                    char_start=section.char_start,
                    char_end=section.char_end,
                    token_count=len(words),
                    anchor_id=anchor_id,
                    block_index=section_block_index,
                )
                chunks.append(chunk)
                chunk_counter += 1
            else:
                # Split section into overlapping chunks
                start_word = 0
                while start_word < len(words):
                    end_word = min(start_word + self.chunk_size, len(words))
                    chunk_words = words[start_word:end_word]
                    chunk_text = ' '.join(chunk_words)

                    # Calculate approximate character positions (may drift due to whitespace)
                    prefix_len = len(' '.join(words[:start_word]))
                    if start_word > 0:
                        prefix_len += 1  # Account for space
                    char_start = section.char_start + prefix_len
                    char_end = char_start + len(chunk_text)

                    chunk_id = f"{filing_id}_chunk_{chunk_counter:04d}"
                    anchor_id = f"{section.id}_b{section_block_index:03d}"
                    chunk = Chunk(
                        id=chunk_id,
                        section_id=section.id,
                        text=chunk_text,
                        char_start=char_start,
                        char_end=char_end,
                        token_count=len(chunk_words),
                        anchor_id=anchor_id,
                        block_index=section_block_index,
                    )
                    chunks.append(chunk)
                    chunk_counter += 1
                    section_block_index += 1

                    # Move to next chunk with overlap
                    start_word = end_word - self.chunk_overlap
                    if start_word >= len(words) - self.chunk_overlap:
                        break

        return chunks


def parse_filing(
    html_content: str,
    filing_id: str,
    cik: str,
    ticker: str,
    company_name: str,
    form_type: str,
    filed_at: str,
    report_period: Optional[str] = None,
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
) -> ParsedFiling:
    """
    Convenience function to parse a filing.

    Args:
        html_content: Raw HTML
        filing_id: Filing ID
        cik: Company CIK
        ticker: Stock ticker
        company_name: Company name
        form_type: Form type
        filed_at: Filing date
        report_period: Report period
        chunk_size: Chunk size in words
        chunk_overlap: Chunk overlap in words

    Returns:
        ParsedFiling object
    """
    parser = FilingParser(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )
    return parser.parse(
        html_content=html_content,
        filing_id=filing_id,
        cik=cik,
        ticker=ticker,
        company_name=company_name,
        form_type=form_type,
        filed_at=filed_at,
        report_period=report_period,
    )


def write_derivatives(
    parsed: ParsedFiling,
    output_dir: Path,
    base_name: str,
) -> Dict[str, Path]:
    """
    Write all derivative files for a parsed filing.

    Args:
        parsed: Parsed filing
        output_dir: Output directory
        base_name: Base filename (e.g., "AAPL-10-K-2024-10-30")

    Returns:
        Dict mapping file type to path
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = {}

    # Write manifest.json
    manifest_path = output_dir / f"{base_name}-manifest.json"
    with open(manifest_path, 'w') as f:
        json.dump(parsed.to_manifest(), f, indent=2)
    paths["manifest"] = manifest_path
    logger.debug(f"Wrote manifest: {manifest_path}")

    # Write section_index.json
    section_index_path = output_dir / f"{base_name}-sections.json"
    with open(section_index_path, 'w') as f:
        json.dump(parsed.to_section_index(), f, indent=2)
    paths["section_index"] = section_index_path
    logger.debug(f"Wrote section index: {section_index_path}")

    # Write chunks.jsonl
    chunks_path = output_dir / f"{base_name}-chunks.jsonl"
    with open(chunks_path, 'w') as f:
        for chunk in parsed.chunks:
            f.write(json.dumps(chunk.to_dict()) + '\n')
    paths["chunks"] = chunks_path
    logger.debug(f"Wrote {len(parsed.chunks)} chunks: {chunks_path}")

    # Write normalized text (clean text without HTML)
    text_path = output_dir / f"{base_name}.txt"
    with open(text_path, 'w') as f:
        f.write(parsed.raw_text)
    paths["text"] = text_path
    logger.debug(f"Wrote text: {text_path}")

    return paths
