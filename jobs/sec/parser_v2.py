"""
SEC Filing Parser v2 - Dual-output: Display (HTML) + RAG (text)

Produces two artifact sets per filing:

A) Display output (HTML-first) - for UI rendering:
   - display/raw_primary.html     : Original as-filed HTML
   - display/sections/{id}.html   : Sanitized per-section HTML
   - display/manifest.json        : TOC, metadata, stats, anchor map
   - display/anchors.json         : Stable anchor IDs for citations

B) RAG output (text-first) - for search/embeddings:
   - rag/sections.jsonl           : Section text + metadata
   - rag/chunks.jsonl             : Chunked text with stable IDs
   - rag/tables.jsonl             : Extracted tables (optional)
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
import html

try:
    from bs4 import BeautifulSoup, NavigableString, Tag
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

try:
    import bleach
    HAS_BLEACH = True
except ImportError:
    HAS_BLEACH = False

logger = logging.getLogger(__name__)


# =============================================================================
# Section Patterns
# =============================================================================

SECTION_10K_PATTERNS = [
    # Patterns allow both period (.) and colon (:) separators - e.g., "Item 1. Business" or "Item 1: Business"
    (r"item\s*1[.:]*\s*business", "item_1", "Item 1. Business"),
    (r"item\s*1a[.:]*\s*risk\s*factors", "item_1a", "Item 1A. Risk Factors"),
    (r"item\s*1b[.:]*\s*unresolved\s*staff\s*comments", "item_1b", "Item 1B. Unresolved Staff Comments"),
    (r"item\s*1c[.:]*\s*cybersecurity", "item_1c", "Item 1C. Cybersecurity"),
    (r"item\s*2[.:]*\s*properties", "item_2", "Item 2. Properties"),
    (r"item\s*3[.:]*\s*legal\s*proceedings", "item_3", "Item 3. Legal Proceedings"),
    (r"item\s*4[.:]*\s*mine\s*safety", "item_4", "Item 4. Mine Safety Disclosures"),
    (r"item\s*5[.:]*\s*market\s*for", "item_5", "Item 5. Market for Registrant's Common Equity"),
    (r"item\s*6[.:]*\s*reserved", "item_6", "Item 6. [Reserved]"),
    (r"item\s*7[.:]*\s*management.{0,20}discussion", "item_7", "Item 7. MD&A"),
    (r"item\s*7a[.:]*\s*quantitative", "item_7a", "Item 7A. Quantitative and Qualitative Disclosures"),
    (r"item\s*8[.:]*\s*financial\s*statements", "item_8", "Item 8. Financial Statements"),
    (r"item\s*9[.:]*\s*changes\s*in\s*accountants", "item_9", "Item 9. Changes in and Disagreements with Accountants"),
    (r"item\s*9a[.:]*\s*controls", "item_9a", "Item 9A. Controls and Procedures"),
    (r"item\s*9b[.:]*\s*other\s*information", "item_9b", "Item 9B. Other Information"),
    (r"item\s*9c[.:]*\s*disclosure", "item_9c", "Item 9C. Disclosure Regarding Foreign Jurisdictions"),
    (r"item\s*10[.:]*\s*directors", "item_10", "Item 10. Directors, Executive Officers"),
    (r"item\s*11[.:]*\s*executive\s*compensation", "item_11", "Item 11. Executive Compensation"),
    (r"item\s*12[.:]*\s*security\s*ownership", "item_12", "Item 12. Security Ownership"),
    (r"item\s*13[.:]*\s*certain\s*relationships", "item_13", "Item 13. Certain Relationships"),
    (r"item\s*14[.:]*\s*principal\s*account", "item_14", "Item 14. Principal Accountant Fees"),
    (r"item\s*15[.:]*\s*exhibits", "item_15", "Item 15. Exhibits and Financial Statement Schedules"),
    (r"item\s*16[.:]*\s*form\s*10-k\s*summary", "item_16", "Item 16. Form 10-K Summary"),
]

SECTION_10Q_PATTERNS = [
    # Patterns allow both period (.) and colon (:) separators, and newlines in some cases
    (r"part\s*i[\s\-—:]+financial\s*information", "part_1", "Part I. Financial Information"),
    # Item 1 Financial Statements - multiple patterns for different filing formats
    # Pattern 1: Standard "Item 1. Financial Statements" with optional prefixes (preferred)
    (r"item\s*1[.:]*\s+(?:unaudited\s+)?(?:condensed\s+)?(?:consolidated\s+)?financial\s*statements", "item_1", "Item 1. Financial Statements"),
    # Pattern 2: Balance sheets as fallback - require it to be a standalone heading
    # (must be preceded by newline/tag and followed by newline/tag to avoid matching references)
    # This catches cases where Item 1 header is only in ToC
    (r"(?:^|\n|>)\s*(?:condensed\s+)?consolidated\s+balance\s+sheets?(?:\s*\(?unaudited\)?)?\s*(?:\n|<|$)", "item_1", "Item 1. Financial Statements"),
    # Pattern 3: Some companies use "Statements of Financial Position" instead of "Balance Sheets"
    (r"(?:^|\n|>)\s*(?:condensed\s+)?consolidated\s+statements?\s+of\s+financial\s+position\s*(?:\n|<|$)", "item_1", "Item 1. Financial Statements"),
    (r"item\s*2[.:]*\s*management.{0,20}discussion", "item_2", "Item 2. MD&A"),
    (r"item\s*3[.:]*\s*quantitative", "item_3", "Item 3. Quantitative and Qualitative Disclosures"),
    (r"item\s*4[.:]*\s*controls", "item_4", "Item 4. Controls and Procedures"),
    (r"part\s*ii[\s\-—:]+other\s*information", "part_2", "Part II. Other Information"),
    (r"item\s*1[.:]*\s*legal\s*proceedings", "item_1_legal", "Item 1. Legal Proceedings"),
    (r"item\s*1a[.:]*\s*risk\s*factors", "item_1a", "Item 1A. Risk Factors"),
    (r"item\s*2[.:]*\s*unregistered\s*sales", "item_2_sales", "Item 2. Unregistered Sales of Equity"),
    (r"item\s*3[.:]*\s*defaults", "item_3_defaults", "Item 3. Defaults Upon Senior Securities"),
    (r"item\s*4[.:]*\s*mine\s*safety", "item_4_mine", "Item 4. Mine Safety Disclosures"),
    (r"item\s*5[.:]*\s*other\s*information", "item_5", "Item 5. Other Information"),
    (r"item\s*6[.:]*\s*exhibits", "item_6", "Item 6. Exhibits"),
]


# =============================================================================
# HTML Processing
# =============================================================================

# Tags allowed in sanitized output
ALLOWED_TAGS = frozenset({
    'div', 'span', 'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'a', 'b', 'strong', 'i', 'em', 'u', 'sub', 'sup', 's',
    'pre', 'code', 'blockquote',
    'img', 'figure', 'figcaption',
    'font',  # SEC filings often use <font>
})

# Attributes allowed per tag (bleach format)
ALLOWED_ATTRS = {
    '*': ['id', 'class'],  # Allow on all tags
    'a': ['href', 'name', 'id'],
    'img': ['src', 'alt', 'width', 'height'],
    'table': ['border', 'cellpadding', 'cellspacing', 'width', 'summary'],
    'td': ['colspan', 'rowspan', 'align', 'valign', 'width', 'nowrap'],
    'th': ['colspan', 'rowspan', 'align', 'valign', 'width', 'scope'],
    'col': ['width', 'span'],
    'colgroup': ['span'],
    'font': ['size', 'color'],  # Legacy but common in SEC filings
}

# Protocols allowed in href/src attributes
ALLOWED_PROTOCOLS = frozenset({'http', 'https', 'mailto'})


class HTMLSanitizer:
    """Sanitize SEC HTML for display using bleach."""

    def sanitize(self, html_content: str) -> str:
        """Sanitize HTML content, removing dangerous elements and attributes."""
        if HAS_BLEACH:
            # Use bleach for proper sanitization
            cleaned = bleach.clean(
                html_content,
                tags=ALLOWED_TAGS,
                attributes=ALLOWED_ATTRS,
                protocols=ALLOWED_PROTOCOLS,
                strip=True,  # Strip disallowed tags instead of escaping
                strip_comments=True,
            )
            return cleaned
        else:
            # Fallback: basic regex-based sanitization (less secure)
            logger.warning("bleach not available, using basic regex sanitization")
            return self._fallback_sanitize(html_content)

    def _fallback_sanitize(self, html_content: str) -> str:
        """Fallback sanitization when bleach is not available."""
        # Remove dangerous tags entirely
        dangerous_tags = {'script', 'style', 'meta', 'link', 'head', 'iframe', 'object', 'embed', 'form', 'input'}
        for tag in dangerous_tags:
            html_content = re.sub(
                rf'<{tag}[^>]*>.*?</{tag}>',
                '', html_content, flags=re.IGNORECASE | re.DOTALL
            )
            html_content = re.sub(
                rf'<{tag}[^>]*/?>',
                '', html_content, flags=re.IGNORECASE
            )

        # Remove on* event handlers
        html_content = re.sub(r'\s+on\w+\s*=\s*["\'][^"\']*["\']', '', html_content, flags=re.IGNORECASE)

        # Remove javascript: and data: URLs
        html_content = re.sub(r'(href|src)\s*=\s*["\']javascript:[^"\']*["\']', r'\1="#"', html_content, flags=re.IGNORECASE)
        html_content = re.sub(r'(href|src)\s*=\s*["\']data:[^"\']*["\']', r'\1="#"', html_content, flags=re.IGNORECASE)

        return html_content


class HTMLTextExtractor(HTMLParser):
    """Extract plain text from HTML, preserving structure."""

    def __init__(self):
        super().__init__()
        self.result = StringIO()
        self.skip_tags = {'script', 'style', 'head', 'meta', 'link'}
        self.block_tags = {'p', 'div', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th'}
        self.skip_content = False
        self.tag_stack = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        self.tag_stack.append(tag)
        if tag in self.skip_tags:
            self.skip_content = True
        if tag in self.block_tags:
            self.result.write('\n')

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.tag_stack and self.tag_stack[-1] == tag:
            self.tag_stack.pop()
        if tag in self.skip_tags:
            self.skip_content = any(t in self.skip_tags for t in self.tag_stack)
        if tag in self.block_tags:
            self.result.write('\n')

    def handle_data(self, data):
        if not self.skip_content:
            self.result.write(data)

    def get_text(self) -> str:
        return self.result.getvalue()


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class Anchor:
    """A navigable anchor point in the document."""
    id: str              # Stable ID (e.g., "item_1a_risk_macroeconomic")
    section_id: str      # Parent section
    label: str           # Display label
    char_start: int      # Position in section text
    html_offset: int     # Position in section HTML (for highlighting)


@dataclass
class Section:
    """A section of the filing with both HTML and text versions."""
    id: str
    label: str
    html: str            # Sanitized HTML for display
    text: str            # Clean text for RAG
    char_start: int      # Position in full text
    char_end: int
    anchors: List[Anchor] = field(default_factory=list)
    word_count: int = 0

    def to_display_dict(self) -> Dict[str, Any]:
        """For display/manifest.json"""
        return {
            "id": self.id,
            "label": self.label,
            "word_count": self.word_count,
            "anchor_count": len(self.anchors),
        }

    def to_rag_dict(self) -> Dict[str, Any]:
        """For rag/sections.jsonl"""
        return {
            "id": self.id,
            "label": self.label,
            "text": self.text,
            "char_start": self.char_start,
            "char_end": self.char_end,
            "word_count": self.word_count,
        }


@dataclass
class Chunk:
    """A text chunk for RAG with stable anchor reference."""
    id: str              # Unique chunk ID
    section_id: str
    anchor_id: str       # Reference to display anchor for highlighting
    text: str
    block_index: int     # Position within section
    word_count: int      # Approximate word count (not actual tokens)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "section_id": self.section_id,
            "anchor_id": self.anchor_id,
            "text": self.text,
            "block_index": self.block_index,
            "word_count": self.word_count,
            "token_count": self.word_count,  # Backwards compat: alias for word_count
        }


@dataclass
class Table:
    """An extracted table for structured Q&A."""
    id: str
    section_id: str
    caption: Optional[str]
    headers: List[str]
    rows: List[List[str]]
    html: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "section_id": self.section_id,
            "caption": self.caption,
            "headers": self.headers,
            "rows": self.rows,
        }


@dataclass
class ParsedFiling:
    """Complete parsed filing with display and RAG artifacts."""
    filing_id: str
    cik: str
    ticker: str
    company_name: str
    form_type: str
    filed_at: str
    report_period: Optional[str]
    raw_html: str
    sections: List[Section]
    chunks: List[Chunk]
    tables: List[Table]
    word_count: int


# =============================================================================
# Parser
# =============================================================================

class FilingParserV2:
    """Parse SEC filings into display and RAG artifacts."""

    def __init__(
        self,
        chunk_size: int = 800,
        chunk_overlap: int = 150,
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.sanitizer = HTMLSanitizer()

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
        use_dom_parsing: bool = False,  # DOM parsing is experimental; text-based is more reliable for SEC filings
    ) -> ParsedFiling:
        """Parse filing into display and RAG artifacts.

        Args:
            use_dom_parsing: If True and BeautifulSoup is available, use DOM-based
                section extraction. Currently experimental - text-based extraction
                is more reliable for complex SEC filing structures.
        """
        # Select patterns based on form type
        if "10-K" in form_type.upper():
            patterns = SECTION_10K_PATTERNS
        else:
            patterns = SECTION_10Q_PATTERNS

        # Use text-based extraction by default (more reliable for SEC filings)
        # DOM-based is available as experimental option
        sections = []
        if use_dom_parsing and HAS_BS4:
            try:
                sections = self._extract_sections_dom(html_content, patterns)
                logger.debug(f"DOM-based extraction found {len(sections)} sections")
            except Exception as e:
                logger.warning(f"DOM-based extraction failed, falling back to text-based: {e}")
                sections = []

        # Default to text-based extraction
        if not sections:
            text = self._extract_text(html_content)
            section_positions = self._find_section_positions(text, patterns)
            sections = self._extract_sections(html_content, text, section_positions)

        # Find anchors within sections
        for section in sections:
            section.anchors = self._find_anchors(section)

        # Generate chunks for RAG
        chunks = self._generate_chunks(sections, filing_id)

        # Extract tables
        tables = self._extract_tables(sections, filing_id)

        # Calculate stats
        word_count = sum(s.word_count for s in sections)

        return ParsedFiling(
            filing_id=filing_id,
            cik=cik,
            ticker=ticker,
            company_name=company_name,
            form_type=form_type,
            filed_at=filed_at,
            report_period=report_period,
            raw_html=html_content,
            sections=sections,
            chunks=chunks,
            tables=tables,
            word_count=word_count,
        )

    def _extract_text(self, html_content: str) -> str:
        """Extract clean text from HTML."""
        parser = HTMLTextExtractor()
        try:
            parser.feed(html_content)
            text = parser.get_text()
        except Exception as e:
            logger.warning(f"HTML parsing error: {e}")
            text = re.sub(r'<[^>]+>', ' ', html_content)

        # Clean whitespace while preserving newlines
        text = text.replace('\r\n', '\n').replace('\r', '\n')
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r' +\n', '\n', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()

    def _is_toc_region(self, text: str, pos: int, window: int = 1500) -> bool:
        """Check if position is in a Table of Contents region.

        A TOC region is characterized by:
        1. High density of section headers (8+ distinct item/part patterns)
        2. Secondary signals: page numbers, "table of contents" text
        3. Repeated patterns of "item... number" structure

        Returns True if multiple signals indicate this is a TOC.
        """
        start = max(0, pos - window)
        end = min(len(text), pos + window)
        region = text[start:end].lower()

        # Signal 1: Count distinct item/part references in the region
        item_pattern = r'item\s+(\d+[a-c]?)'
        part_pattern = r'part\s+([ivx]+|\d+)'

        item_matches = set(re.findall(item_pattern, region, re.IGNORECASE))
        part_matches = set(re.findall(part_pattern, region, re.IGNORECASE))
        total_distinct = len(item_matches) + len(part_matches)

        # Signal 2: Check for explicit TOC indicators
        toc_indicators = [
            'table of contents',
            'index to',
            'contents page',
        ]
        has_toc_label = any(indicator in region for indicator in toc_indicators)

        # Signal 3: Check for page number patterns (common in TOC)
        # Patterns like "... 1", "... 12", "page 1", etc. at end of lines
        page_number_pattern = r'(?:page\s*)?(\d{1,3})\s*(?:\n|$)'
        page_numbers = re.findall(page_number_pattern, region)
        has_many_page_numbers = len(page_numbers) >= 5

        # Signal 4: Check for dotted leader lines (... or ....) common in TOC
        dotted_leaders = len(re.findall(r'\.{3,}', region))
        has_dotted_leaders = dotted_leaders >= 3

        # Decision logic:
        # - Definitely TOC: has explicit TOC label + high header density
        # - Likely TOC: high header density (8+) + any secondary signal
        # - Possible TOC: very high header density (12+) alone
        if has_toc_label and total_distinct >= 4:
            return True
        if total_distinct >= 8 and (has_many_page_numbers or has_dotted_leaders):
            return True
        if total_distinct >= 12:
            return True

        return False

    def _has_prose_following(self, text: str, pos: int, min_chars: int = 500) -> bool:
        """Check if there's substantial prose content following a position.

        Returns True if there are at least min_chars of text before the next
        section header pattern, indicating actual content rather than just ToC entries.
        """
        # Look at the text following this position
        following = text[pos:pos + min_chars + 200].lower()

        # Find the next header pattern
        next_header = re.search(
            r'(item\s+\d+[a-c]?[.:]*\s*\w|part\s+[ivx]+[.:]*\s*\w)',
            following,
            re.IGNORECASE
        )

        if next_header is None:
            # No next header found in window - likely has prose
            return True

        # Check if there's enough content before the next header
        chars_before_next = next_header.start()
        return chars_before_next >= min_chars

    def _find_section_positions(
        self,
        text: str,
        patterns: List[Tuple[str, str, str]],
    ) -> List[Dict[str, Any]]:
        """Find section positions using 'most content' heuristic with TOC detection.

        Improvements over naive 'most content':
        1. Detects TOC regions (high header density) and downranks matches there
        2. Prefers matches with substantial prose following (not just more headers)
        """
        text_lower = text.lower()
        matches = []

        for pattern, section_id, label in patterns:
            for match in re.finditer(pattern, text_lower, re.IGNORECASE | re.MULTILINE):
                matches.append({
                    "id": section_id,
                    "label": label,
                    "start": match.start(),
                })

        matches.sort(key=lambda x: x["start"])

        # Keep best match for each section ID, considering:
        # - Content length (primary signal)
        # - TOC region detection (downrank TOC matches)
        # - Prose following (prefer matches with actual content)
        section_matches = {}
        text_len = len(text)

        for i, m in enumerate(matches):
            section_id = m["id"]
            pos = m["start"]
            content_len = (matches[i + 1]["start"] if i < len(matches) - 1 else text_len) - pos

            # Check if this match is in a TOC region
            is_toc = self._is_toc_region(text, pos)

            # Check if there's prose following this match
            has_prose = self._has_prose_following(text, pos)

            # Calculate score: content length, but penalize TOC matches heavily
            # and boost matches with prose
            score = content_len
            if is_toc:
                score = score * 0.1  # Heavily penalize TOC matches
            if has_prose:
                score = score * 1.5  # Boost matches with prose content

            if section_id not in section_matches or score > section_matches[section_id]["_score"]:
                section_matches[section_id] = {
                    **m,
                    "_score": score,
                    "_content_len": content_len,
                    "_is_toc": is_toc,
                    "_has_prose": has_prose,
                }

        return sorted(section_matches.values(), key=lambda x: x["start"])

    def _extract_sections(
        self,
        html_content: str,
        text: str,
        positions: List[Dict[str, Any]],
    ) -> List[Section]:
        """Extract sections with both HTML and text."""
        sections = []
        text_len = len(text)

        for i, pos in enumerate(positions):
            # Text boundaries
            start = pos["start"]
            end = positions[i + 1]["start"] if i < len(positions) - 1 else text_len
            section_text = text[start:end].strip()

            # Get next section info for end-boundary detection
            next_section = positions[i + 1] if i < len(positions) - 1 else None

            # Try to find corresponding HTML section
            # Use section label to locate in HTML
            section_html = self._extract_section_html(
                html_content, pos["label"], section_text, next_section
            )

            section = Section(
                id=pos["id"],
                label=pos["label"],
                html=section_html,
                text=section_text,
                char_start=start,
                char_end=end,
                word_count=len(section_text.split()),
            )
            sections.append(section)

        return sections

    def _extract_sections_dom(
        self,
        html_content: str,
        patterns: List[Tuple[str, str, str]],
    ) -> List[Section]:
        """Extract sections using DOM-based parsing with BeautifulSoup.

        This is more robust than text-based extraction as it works directly
        in DOM space without needing to map text positions back to HTML.
        """
        if not HAS_BS4:
            raise RuntimeError("BeautifulSoup not available for DOM parsing")

        # Suppress XML-as-HTML warning for XBRL filings
        import warnings
        from bs4 import XMLParsedAsHTMLWarning
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
            soup = BeautifulSoup(html_content, 'lxml')

        # Remove script, style, and hidden XBRL elements
        for tag in soup.find_all(['script', 'style', 'ix:hidden']):
            tag.decompose()

        # Build regex patterns for matching section headers
        compiled_patterns = []
        for pattern, section_id, label in patterns:
            compiled_patterns.append((re.compile(pattern, re.IGNORECASE | re.MULTILINE), section_id, label))

        # Find all text nodes and their parent elements that match section patterns
        # Track traversal index to preserve document order after deduplication
        section_nodes: List[Tuple[Tag, str, str, int]] = []  # (element, section_id, label, traversal_index)

        # Walk through all elements looking for section headers
        traversal_index = 0
        for element in soup.find_all(text=True):
            if not element.strip():
                continue
            text = element.strip()
            parent = element.parent
            if parent is None or parent.name in ['script', 'style']:
                continue

            # Check if this text matches any section pattern
            for compiled, section_id, label in compiled_patterns:
                if compiled.search(text):
                    # Find the containing block-level element
                    block_parent = self._find_block_parent(parent)
                    if block_parent:
                        section_nodes.append((block_parent, section_id, label, traversal_index))
                        traversal_index += 1
                    break

        if not section_nodes:
            return []

        # Deduplicate by section_id - keep the one with most content, but preserve FIRST traversal index
        # This ensures document order is maintained even when selecting a later occurrence for content
        section_map: Dict[str, Tuple[Tag, str, str, int]] = {}

        for node, section_id, label, trav_idx in section_nodes:
            if section_id not in section_map:
                section_map[section_id] = (node, section_id, label, trav_idx)
            else:
                # Keep the one that appears to have more content, but preserve first occurrence's traversal index
                existing_entry = section_map[section_id]
                existing_node = existing_entry[0]
                first_trav_idx = existing_entry[3]  # Keep the first occurrence's index for ordering
                existing_content = len(existing_node.get_text(strip=True))
                new_content = len(node.get_text(strip=True))
                if new_content > existing_content:
                    # Use new node but keep original traversal index for document order
                    section_map[section_id] = (node, section_id, label, first_trav_idx)

        # Convert to sections - sort by traversal index to preserve document order
        sections = []
        items = sorted(section_map.values(), key=lambda x: x[3])  # Sort by traversal_index

        for i, (node, section_id, label, _trav_idx) in enumerate(items):
            # Collect content until next section header
            html_parts = []
            text_parts = []

            # Include the header node
            html_parts.append(str(node))
            text_parts.append(node.get_text(separator='\n', strip=True))

            # Collect following siblings until next section
            current = node.next_sibling
            next_section_node = items[i + 1][0] if i + 1 < len(items) else None

            while current:
                if isinstance(current, NavigableString):
                    if current.strip():
                        text_parts.append(current.strip())
                    current = current.next_sibling
                    continue

                if not isinstance(current, Tag):
                    current = current.next_sibling
                    continue

                # Check if we've reached the next section
                if next_section_node and current == next_section_node:
                    break

                # Check if this element contains a section header
                current_text = current.get_text(strip=True)
                is_next_section = False
                for compiled, sid, _ in compiled_patterns:
                    if sid != section_id and compiled.search(current_text):
                        is_next_section = True
                        break

                if is_next_section:
                    break

                html_parts.append(str(current))
                text_parts.append(current.get_text(separator='\n', strip=True))
                current = current.next_sibling

            section_html = '\n'.join(html_parts)
            section_text = '\n'.join(text_parts)

            # Sanitize HTML
            section_html = self.sanitizer.sanitize(section_html)

            section = Section(
                id=section_id,
                label=label,
                html=section_html,
                text=section_text,
                char_start=0,  # DOM-based doesn't track char positions
                char_end=0,
                word_count=len(section_text.split()),
            )
            sections.append(section)

        return sections

    def _find_block_parent(self, element: Tag) -> Optional[Tag]:
        """Find the nearest block-level parent element."""
        block_tags = {'div', 'p', 'section', 'article', 'main', 'td', 'th', 'li', 'tr'}
        current = element
        while current and hasattr(current, 'name'):
            if current.name in block_tags:
                return current
            current = current.parent
        return element if hasattr(element, 'name') else None

    def _extract_section_html(
        self,
        html_content: str,
        label: str,
        section_text: str,
        next_section: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Extract and sanitize HTML for a section.

        Uses multiple strategies to find section HTML:
        1. Try matching section label directly
        2. Try matching distinctive text anchors from section content
        3. Fall back to text-to-HTML conversion (preserving detected tables)

        Args:
            html_content: Full HTML of the filing
            label: Section label (e.g., "Item 1. Business")
            section_text: Extracted text content of this section
            next_section: Info about the next section for end-boundary detection
        """
        # Strategy 1: Find section in HTML by label
        escaped_label = re.escape(label).replace(r'\ ', r'\s*')
        pattern = re.compile(escaped_label, re.IGNORECASE)

        matches = list(pattern.finditer(html_content))

        best_start = None
        best_content_len = 0

        if matches:
            for m in matches:
                # Estimate content length by looking ahead
                end_pos = min(m.end() + len(section_text) * 2, len(html_content))
                content = html_content[m.start():end_pos]
                if len(content) > best_content_len:
                    best_content_len = len(content)
                    best_start = m.start()

        # Strategy 2: If label not found, try text anchors from section content
        if best_start is None:
            # Get distinctive text from section (skip header line, find first substantial content)
            lines = [l.strip() for l in section_text.strip().split('\n') if l.strip()]

            for line in lines[1:15]:  # Look at lines 2-15 (skip header)
                # Clean line for matching (remove excess whitespace)
                anchor = re.sub(r'\s+', ' ', line)[:80]
                if len(anchor) >= 30:  # Need substantial text
                    # Create a flexible pattern (allow for HTML tags within text)
                    # Insert (?:<[^>]*>|\s)* between words to allow tags
                    words = anchor.split()[:8]  # First 8 words
                    if len(words) >= 4:
                        flex_pattern = r'(?:<[^>]*>|\s)*'.join(re.escape(w) for w in words)
                        anchor_match = re.search(flex_pattern, html_content, re.IGNORECASE)
                        if anchor_match:
                            # Walk back to find the section header
                            search_region = html_content[max(0, anchor_match.start() - 3000):anchor_match.start()]

                            # Look for the section header pattern (e.g., "ITEM 2" or "Item 2")
                            header_patterns = [
                                r'>\s*(ITEM\s+\d+[A-C]?\.?)',
                                r'>\s*(Item\s+\d+[A-C]?\.?)',
                            ]

                            header_pos = None
                            for hp in header_patterns:
                                hm = list(re.finditer(hp, search_region, re.IGNORECASE))
                                if hm:
                                    # Use the last match (closest to anchor)
                                    header_pos = hm[-1].start()
                                    break

                            if header_pos is not None:
                                # Walk back a bit more to get the opening div/span
                                raw_start = max(0, anchor_match.start() - 3000 + header_pos - 100)
                            else:
                                # No header found, just walk back
                                raw_start = max(0, anchor_match.start() - 500)

                            # Find a proper tag boundary - look for preceding '<' that opens a tag
                            for i in range(raw_start, max(0, raw_start - 200), -1):
                                if html_content[i] == '<':
                                    best_start = i
                                    break
                            else:
                                best_start = raw_start

                            break

        if best_start is None:
            # Fallback: convert text to HTML, but try to preserve tables from original
            return self._text_to_html_with_tables(section_text, html_content)

        # Find end boundary using next section info
        end = self._find_section_end_boundary(
            html_content, best_start, label, section_text, next_section
        )

        section_html = html_content[best_start:end]

        # Sanitize
        return self.sanitizer.sanitize(section_html)

    def _find_section_end_boundary(
        self,
        html_content: str,
        start_pos: int,
        current_label: str,
        section_text: str,
        next_section: Optional[Dict[str, Any]],
    ) -> int:
        """Find the end boundary for a section in HTML.

        Uses multiple strategies:
        1. If next_section is known, search for its label
        2. Search for common section header patterns
        3. Use section text length as sanity check
        4. Look for document end markers (signatures, exhibits)
        """
        # Skip past current section header (at least the label length + some buffer)
        min_skip = len(current_label) + 500
        search_from = start_pos + min_skip

        # Strategy 1: Find next section by its label (most reliable)
        if next_section and next_section.get("label"):
            next_label = next_section["label"]
            # Create flexible pattern for next section label
            escaped_next = re.escape(next_label).replace(r'\ ', r'\s*')
            next_label_pattern = re.compile(escaped_next, re.IGNORECASE)

            for m in next_label_pattern.finditer(html_content[search_from:]):
                # Verify this isn't a ToC reference by checking surrounding context
                match_pos = search_from + m.start()
                context_before = html_content[max(0, match_pos - 200):match_pos].lower()

                # Skip if this looks like a ToC entry (has many other Item references nearby)
                toc_indicator = context_before.count('item ') + context_before.count('part ')
                if toc_indicator < 3:
                    # Walk back to find tag boundary
                    end_pos = match_pos
                    for i in range(match_pos, max(search_from, match_pos - 100), -1):
                        if html_content[i] == '<':
                            end_pos = i
                            break
                    return end_pos

        # Strategy 2: Comprehensive section header patterns
        # These patterns match section headers in the actual content (not ToC)
        section_patterns = [
            # Item patterns with required content indicators
            r'>\s*Item\s+\d+[A-C]?\s*[.:]\s*[A-Z][a-z]',  # "Item 1. Business"
            r'>\s*ITEM\s+\d+[A-C]?\s*[.:]\s*[A-Z]',  # "ITEM 1. BUSINESS"
            # Part patterns
            r'>\s*PART\s+I{1,3}V?\s*[.:\-—]',  # "PART I." or "PART II -"
            r'>\s*Part\s+I{1,3}V?\s*[.:\-—]',
            # Document end markers
            r'>\s*SIGNATURES?\s*<',
            r'>\s*EXHIBIT\s+INDEX\s*<',
        ]

        end = len(html_content)

        for pattern in section_patterns:
            match = re.search(pattern, html_content[search_from:], re.IGNORECASE)
            if match:
                candidate_end = search_from + match.start()

                # Verify this is a real section boundary (not just a reference)
                # Check that there's substantial content between start and this point
                content_between = html_content[start_pos:candidate_end]
                text_content = re.sub(r'<[^>]+>', ' ', content_between)
                word_count = len(text_content.split())

                # Only accept if we have reasonable content
                if word_count >= 50:
                    # Walk back to find tag boundary
                    for i in range(candidate_end, max(search_from, candidate_end - 100), -1):
                        if html_content[i] == '<':
                            candidate_end = i
                            break
                    end = min(end, candidate_end)
                    break

        # Strategy 3: Sanity check using expected text length
        # HTML should be roughly 2-5x the text length due to tags
        expected_html_len = len(section_text) * 4
        max_reasonable_end = start_pos + expected_html_len

        if end > max_reasonable_end and max_reasonable_end < len(html_content):
            # We might be capturing too much - try to find a better boundary
            # Look for any major structural break
            structural_breaks = [
                r'<hr[^>]*>',
                r'</body>',
                r'<div[^>]*page-break',
            ]
            for pattern in structural_breaks:
                match = re.search(pattern, html_content[search_from:max_reasonable_end], re.IGNORECASE)
                if match:
                    end = min(end, search_from + match.start())
                    break

        # Final safeguard: never return document end without a warning
        # Cap at a reasonable maximum (expected HTML length * 1.5)
        absolute_max = start_pos + int(expected_html_len * 1.5)
        if end >= len(html_content) - 100:
            # We're at document end - this likely means no boundary was found
            logger.warning(
                f"Section end-boundary fell back to document end for '{current_label}'. "
                f"Capping at {absolute_max - start_pos} chars from start."
            )
            end = min(end, absolute_max)

        return end

    def _text_to_html_with_tables(self, text: str, original_html: str) -> str:
        """Convert text to HTML, attempting to preserve tables from original HTML.

        For sections with tabular data, try to extract actual <table> elements
        from the original HTML based on table content matching.
        """
        # Check if original HTML has tables
        tables_in_html = re.findall(r'<table[^>]*>.*?</table>', original_html, re.IGNORECASE | re.DOTALL)

        if not tables_in_html:
            # No tables to preserve, use simple conversion
            return self._text_to_html(text)

        # Build HTML with tables inserted at appropriate positions
        result_parts = []
        text_lines = text.split('\n')
        used_tables = set()

        i = 0
        while i < len(text_lines):
            line = text_lines[i].strip()

            # Check if this line might be a table header
            table_match = None
            if line and len(line) < 100:  # Potential table caption/header
                # Look for a table that contains this text
                for j, table_html in enumerate(tables_in_html):
                    if j in used_tables:
                        continue
                    # Extract text from table
                    table_text = re.sub(r'<[^>]+>', ' ', table_html)
                    table_text = re.sub(r'\s+', ' ', table_text)

                    # Check if line content appears in table
                    if line[:30].lower() in table_text.lower():
                        table_match = (j, table_html)
                        break

            if table_match:
                j, table_html = table_match
                used_tables.add(j)
                # Sanitize and add table
                sanitized_table = self.sanitizer.sanitize(table_html)
                result_parts.append(sanitized_table)
                # Skip lines that are part of the table content
                table_text = re.sub(r'<[^>]+>', ' ', table_html)
                table_lines = [l.strip() for l in table_text.split('\n') if l.strip()]
                # Skip similar lines in source text
                skip_count = 0
                for k in range(i, min(i + len(table_lines) + 5, len(text_lines))):
                    if text_lines[k].strip() in table_text or k < i + 3:
                        skip_count += 1
                    else:
                        break
                i += max(skip_count, 1)
            else:
                # Regular text line
                if line:
                    result_parts.append(f'<p>{html.escape(line)}</p>')
                i += 1

        return '\n'.join(result_parts) if result_parts else self._text_to_html(text)

    def _text_to_html(self, text: str) -> str:
        """Convert plain text to simple HTML."""
        escaped = html.escape(text)
        paragraphs = escaped.split('\n\n')
        html_parts = [f'<p>{p.replace(chr(10), "<br>")}</p>' for p in paragraphs if p.strip()]
        return '\n'.join(html_parts)

    def _find_anchors(self, section: Section) -> List[Anchor]:
        """Find navigable anchor points in a section."""
        anchors = []
        seen = set()
        text = section.text

        # Pattern 1: ALL CAPS headers
        for match in re.finditer(r'\n\s*([A-Z][A-Z0-9\s\-—–,.:;\'\"()]{5,60})\s*\n', text):
            label = match.group(1).strip()
            if label.upper() == label and label not in seen:
                # Filter garbage labels
                if not self._is_valid_anchor_label(label):
                    continue
                seen.add(label)
                anchor_id = self._make_anchor_id(section.id, label)
                anchors.append(Anchor(
                    id=anchor_id,
                    section_id=section.id,
                    label=label,
                    char_start=match.start(),
                    html_offset=0,  # Would need HTML parsing to get accurate offset
                ))

        # Pattern 2: Title Case headers
        for match in re.finditer(r'\n\s*([A-Z][a-zA-Z0-9\s\-—–,.:;\'\"()]{5,60})\s*\n', text):
            label = match.group(1).strip()
            words = label.split()
            caps_words = sum(1 for w in words if w and w[0].isupper())
            if len(words) >= 2 and caps_words >= 2 and label not in seen:
                # Filter garbage labels
                if not self._is_valid_anchor_label(label):
                    continue
                seen.add(label)
                anchor_id = self._make_anchor_id(section.id, label)
                anchors.append(Anchor(
                    id=anchor_id,
                    section_id=section.id,
                    label=label,
                    char_start=match.start(),
                    html_offset=0,
                ))

        return anchors[:20]

    def _is_valid_anchor_label(self, label: str) -> bool:
        """Check if a label is a valid, meaningful anchor.

        Filters out:
        - Labels that are mostly whitespace
        - Labels that are mostly numbers/punctuation
        - Common non-header patterns (dates, page numbers, etc.)
        """
        # Must have at least 3 alphabetic characters
        alpha_chars = sum(1 for c in label if c.isalpha())
        if alpha_chars < 3:
            return False

        # Alphabetic chars should be at least 30% of the label
        if alpha_chars / len(label) < 0.3:
            return False

        # Filter out common garbage patterns
        garbage_patterns = [
            r'^\s*\d+\s*$',  # Just numbers
            r'^page\s+\d+',  # Page numbers
            r'^\s*\$[\d,.\s]+$',  # Dollar amounts
            r'^[,.\s\-—–]+$',  # Just punctuation
            r'^\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}',  # Dates
            r'^(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d',  # Month dates
        ]
        label_lower = label.lower().strip()
        for pattern in garbage_patterns:
            if re.match(pattern, label_lower, re.IGNORECASE):
                return False

        return True

    def _make_anchor_id(self, section_id: str, label: str) -> str:
        """Generate stable, collision-proof anchor ID from section and label."""
        # Normalize label to create slug
        slug = re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_')[:20]
        # Add hash suffix to prevent collisions
        hash_suffix = hashlib.sha1(label.encode()).hexdigest()[:8]
        return f"{section_id}_{slug}_{hash_suffix}"

    def _generate_chunks(self, sections: List[Section], filing_id: str) -> List[Chunk]:
        """Generate text chunks for RAG."""
        chunks = []
        chunk_counter = 0

        for section in sections:
            words = section.text.split()
            block_index = 0

            if len(words) <= self.chunk_size:
                anchor_id = f"{section.id}_b{block_index:03d}"
                chunks.append(Chunk(
                    id=f"{filing_id}_c{chunk_counter:04d}",
                    section_id=section.id,
                    anchor_id=anchor_id,
                    text=section.text,
                    block_index=block_index,
                    word_count=len(words),
                ))
                chunk_counter += 1
            else:
                start_word = 0
                while start_word < len(words):
                    end_word = min(start_word + self.chunk_size, len(words))
                    chunk_text = ' '.join(words[start_word:end_word])

                    anchor_id = f"{section.id}_b{block_index:03d}"
                    chunks.append(Chunk(
                        id=f"{filing_id}_c{chunk_counter:04d}",
                        section_id=section.id,
                        anchor_id=anchor_id,
                        text=chunk_text,
                        block_index=block_index,
                        word_count=end_word - start_word,
                    ))
                    chunk_counter += 1
                    block_index += 1

                    # If we've reached the end, stop
                    if end_word >= len(words):
                        break

                    # Move to next position with overlap, but ensure we make progress
                    next_start = end_word - self.chunk_overlap
                    # Prevent infinite loop: always advance by at least 1
                    start_word = max(next_start, start_word + 1)

        return chunks

    def _extract_tables(self, sections: List[Section], filing_id: str) -> List[Table]:
        """Extract tables from section HTML."""
        tables = []
        table_counter = 0

        for section in sections:
            # Find tables in section HTML
            for match in re.finditer(r'<table[^>]*>(.*?)</table>', section.html, re.IGNORECASE | re.DOTALL):
                table_html = match.group(0)

                # Extract caption
                caption_match = re.search(r'<caption[^>]*>(.*?)</caption>', table_html, re.IGNORECASE | re.DOTALL)
                caption = self._extract_cell_text(caption_match.group(1)) if caption_match else None

                # Extract headers from <thead> or first row with <th> cells
                headers = []
                header_match = re.search(r'<thead[^>]*>(.*?)</thead>', table_html, re.IGNORECASE | re.DOTALL)
                if header_match:
                    # Get headers from thead
                    for th in re.finditer(r'<th[^>]*>(.*?)</th>', header_match.group(1), re.IGNORECASE | re.DOTALL):
                        headers.append(self._extract_cell_text(th.group(1)))

                # Extract rows - handle both <td> and <th> cells
                rows = []
                # Find tbody if present, otherwise use whole table
                tbody_match = re.search(r'<tbody[^>]*>(.*?)</tbody>', table_html, re.IGNORECASE | re.DOTALL)
                table_body = tbody_match.group(1) if tbody_match else table_html

                for tr in re.finditer(r'<tr[^>]*>(.*?)</tr>', table_body, re.IGNORECASE | re.DOTALL):
                    row_html = tr.group(1)
                    row = []

                    # Extract cells - both <td> and <th> in order of appearance
                    for cell in re.finditer(r'<(td|th)[^>]*>(.*?)</\1>', row_html, re.IGNORECASE | re.DOTALL):
                        row.append(self._extract_cell_text(cell.group(2)))

                    if row:
                        # If no headers yet and first row has <th>, use as headers
                        if not headers and '<th' in row_html.lower():
                            headers = row
                        else:
                            rows.append(row)

                if rows:  # Only include non-empty tables
                    tables.append(Table(
                        id=f"{filing_id}_t{table_counter:03d}",
                        section_id=section.id,
                        caption=caption,
                        headers=headers,
                        rows=rows,
                        html=table_html,
                    ))
                    table_counter += 1

        return tables

    def _extract_cell_text(self, cell_html: str) -> str:
        """Extract text from a table cell, preserving some formatting.

        For superscripts/subscripts, we strip them by default to avoid
        corrupting financial data (e.g., "100^(1)" is misleading when it
        should be "100" with a footnote reference).
        """
        # Convert <br> to newlines
        text = re.sub(r'<br\s*/?>', '\n', cell_html, flags=re.IGNORECASE)

        # Handle superscripts - typically footnote references in SEC filings
        # Strip them entirely to avoid corrupting data; footnotes are separate
        text = re.sub(r'<sup[^>]*>.*?</sup>', '', text, flags=re.IGNORECASE | re.DOTALL)

        # Handle subscripts - also typically formatting that can be stripped
        text = re.sub(r'<sub[^>]*>.*?</sub>', '', text, flags=re.IGNORECASE | re.DOTALL)

        # Strip remaining tags
        text = re.sub(r'<[^>]+>', '', text)
        # Normalize whitespace but preserve newlines
        text = re.sub(r'[ \t]+', ' ', text)
        text = re.sub(r' *\n *', '\n', text)
        return text.strip()


# =============================================================================
# Output Writers
# =============================================================================

def write_display_artifacts(parsed: ParsedFiling, output_dir: Path) -> Dict[str, Path]:
    """Write display artifacts for UI rendering."""
    display_dir = output_dir / "display"
    display_dir.mkdir(parents=True, exist_ok=True)
    sections_dir = display_dir / "sections"
    sections_dir.mkdir(exist_ok=True)

    paths = {}

    # 1. Raw primary HTML (as-filed)
    raw_path = display_dir / "raw_primary.html"
    with open(raw_path, 'w', encoding='utf-8') as f:
        f.write(parsed.raw_html)
    paths["raw_html"] = raw_path

    # 2. Per-section HTML
    for section in parsed.sections:
        section_path = sections_dir / f"{section.id}.html"
        with open(section_path, 'w', encoding='utf-8') as f:
            f.write(section.html)
        paths[f"section_{section.id}"] = section_path

    # 3. Manifest
    manifest = {
        "filing_id": parsed.filing_id,
        "cik": parsed.cik,
        "ticker": parsed.ticker,
        "company_name": parsed.company_name,
        "form_type": parsed.form_type,
        "filed_at": parsed.filed_at,
        "report_period": parsed.report_period,
        "stats": {
            "word_count": parsed.word_count,
            "section_count": len(parsed.sections),
            "chunk_count": len(parsed.chunks),
            "table_count": len(parsed.tables),
        },
        "sections": [s.to_display_dict() for s in parsed.sections],
    }
    manifest_path = display_dir / "manifest.json"
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
    paths["manifest"] = manifest_path

    # 4. Anchors
    anchors = {}
    for section in parsed.sections:
        for anchor in section.anchors:
            anchors[anchor.id] = {
                "section_id": anchor.section_id,
                "label": anchor.label,
                "char_start": anchor.char_start,
            }
    # Add block anchors for chunks
    for chunk in parsed.chunks:
        if chunk.anchor_id not in anchors:
            anchors[chunk.anchor_id] = {
                "section_id": chunk.section_id,
                "label": f"Block {chunk.block_index}",
                "chunk_id": chunk.id,
            }

    anchors_path = display_dir / "anchors.json"
    with open(anchors_path, 'w', encoding='utf-8') as f:
        json.dump(anchors, f, indent=2)
    paths["anchors"] = anchors_path

    return paths


def write_rag_artifacts(parsed: ParsedFiling, output_dir: Path) -> Dict[str, Path]:
    """Write RAG artifacts for search/embeddings."""
    rag_dir = output_dir / "rag"
    rag_dir.mkdir(parents=True, exist_ok=True)

    paths = {}

    # 1. Sections JSONL
    sections_path = rag_dir / "sections.jsonl"
    with open(sections_path, 'w', encoding='utf-8') as f:
        for section in parsed.sections:
            f.write(json.dumps(section.to_rag_dict()) + '\n')
    paths["sections"] = sections_path

    # 2. Chunks JSONL
    chunks_path = rag_dir / "chunks.jsonl"
    with open(chunks_path, 'w', encoding='utf-8') as f:
        for chunk in parsed.chunks:
            f.write(json.dumps(chunk.to_dict()) + '\n')
    paths["chunks"] = chunks_path

    # 3. Tables JSONL (if any)
    if parsed.tables:
        tables_path = rag_dir / "tables.jsonl"
        with open(tables_path, 'w', encoding='utf-8') as f:
            for table in parsed.tables:
                f.write(json.dumps(table.to_dict()) + '\n')
        paths["tables"] = tables_path

    return paths


def write_all_artifacts(parsed: ParsedFiling, output_dir: Path) -> Dict[str, Path]:
    """Write all artifacts (display + RAG)."""
    paths = {}
    paths.update(write_display_artifacts(parsed, output_dir))
    paths.update(write_rag_artifacts(parsed, output_dir))
    return paths


# =============================================================================
# Convenience
# =============================================================================

def parse_filing(
    html_content: str,
    filing_id: str,
    cik: str,
    ticker: str,
    company_name: str,
    form_type: str,
    filed_at: str,
    report_period: Optional[str] = None,
) -> ParsedFiling:
    """Convenience function to parse a filing."""
    parser = FilingParserV2()
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
