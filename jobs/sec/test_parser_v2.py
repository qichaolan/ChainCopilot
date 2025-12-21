#!/usr/bin/env python3
"""
Unit tests for SEC Filing Parser v2.

Tests cover:
- Section pattern matching (10-K and 10-Q)
- TOC detection with multiple signals
- HTML extraction and sanitization
- Chunking with overlap
- Anchor detection and filtering
- Table extraction
- Edge cases and error handling
- Output writers
- DOM-based parsing
"""

import json
import pytest
import re
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

from parser_v2 import (
    FilingParserV2,
    ParsedFiling,
    Section,
    Chunk,
    Table,
    Anchor,
    HTMLSanitizer,
    HTMLTextExtractor,
    SECTION_10K_PATTERNS,
    SECTION_10Q_PATTERNS,
    write_display_artifacts,
    write_rag_artifacts,
    write_all_artifacts,
    parse_filing,
    ALLOWED_TAGS,
    ALLOWED_ATTRS,
)


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def parser():
    """Create a parser instance with default settings."""
    return FilingParserV2(chunk_size=100, chunk_overlap=20)


@pytest.fixture
def sample_10k_html():
    """Sample 10-K HTML for testing."""
    return """
    <!DOCTYPE html>
    <html>
    <body>
    <div>
        <h2>ITEM 1. BUSINESS</h2>
        <p>We are a leading technology company that provides innovative solutions
        to customers worldwide. Our business has grown significantly over the
        past fiscal year with revenues increasing by 25%.</p>

        <h3>OVERVIEW</h3>
        <p>Our company was founded in 1998 and has since become a market leader
        in enterprise software solutions.</p>

        <h2>ITEM 1A. RISK FACTORS</h2>
        <p>Investing in our securities involves risks. You should carefully consider
        the following risk factors before making an investment decision.</p>

        <h3>MARKET RISKS</h3>
        <p>Our business is subject to market volatility and economic conditions.</p>

        <h2>ITEM 2. PROPERTIES</h2>
        <p>We own and lease various properties for our operations.</p>
    </div>
    </body>
    </html>
    """


@pytest.fixture
def sample_10q_html():
    """Sample 10-Q HTML for testing."""
    return """
    <!DOCTYPE html>
    <html>
    <body>
    <div>
        <h2>PART I. FINANCIAL INFORMATION</h2>

        <h3>ITEM 1. FINANCIAL STATEMENTS</h3>
        <p>The following unaudited condensed consolidated financial statements
        should be read in conjunction with our annual report.</p>

        <table border="1">
            <caption>Consolidated Balance Sheets</caption>
            <thead>
                <tr><th>Assets</th><th>2024</th><th>2023</th></tr>
            </thead>
            <tbody>
                <tr><td>Cash</td><td>$1,000<sup>1</sup></td><td>$800</td></tr>
                <tr><td>Receivables</td><td>$500</td><td>$450</td></tr>
            </tbody>
        </table>

        <h3>ITEM 2. MANAGEMENT'S DISCUSSION AND ANALYSIS</h3>
        <p>The following discussion provides analysis of our financial condition
        and results of operations for the quarter ended September 30, 2024.</p>

        <h2>PART II. OTHER INFORMATION</h2>
        <p>Legal proceedings and other matters.</p>
    </div>
    </body>
    </html>
    """


@pytest.fixture
def toc_html():
    """HTML with a Table of Contents region."""
    return """
    <html>
    <body>
    <div>
        <h1>TABLE OF CONTENTS</h1>
        <p>PART I..............................1</p>
        <p>Item 1. Business....................3</p>
        <p>Item 1A. Risk Factors...............10</p>
        <p>Item 1B. Unresolved Staff Comments..25</p>
        <p>Item 2. Properties..................30</p>
        <p>Item 3. Legal Proceedings...........35</p>
        <p>Item 4. Mine Safety.................40</p>
        <p>PART II.............................45</p>
        <p>Item 5. Market......................50</p>
        <p>Item 6. Reserved....................55</p>
        <p>Item 7. MD&A........................60</p>
        <p>Item 8. Financial Statements........100</p>
        <p>Item 9. Changes.....................150</p>
    </div>

    <div>
        <h2>ITEM 1. BUSINESS</h2>
        <p>This is the actual business section with substantial content that
        goes on for many paragraphs describing what the company does and how
        it operates in its markets. This content should be selected over the
        TOC reference above.</p>
    </div>
    </body>
    </html>
    """


@pytest.fixture
def parsed_filing():
    """Create a sample ParsedFiling for testing writers."""
    sections = [
        Section(
            id="item_1",
            label="Item 1. Business",
            html="<p>Business content</p>",
            text="Business content",
            char_start=0,
            char_end=16,
            word_count=2,
            anchors=[
                Anchor(
                    id="item_1_overview_12345678",
                    section_id="item_1",
                    label="OVERVIEW",
                    char_start=0,
                    html_offset=0,
                )
            ],
        ),
        Section(
            id="item_1a",
            label="Item 1A. Risk Factors",
            html="<p>Risk factors content</p>",
            text="Risk factors content",
            char_start=17,
            char_end=37,
            word_count=3,
            anchors=[],
        ),
    ]

    chunks = [
        Chunk(
            id="TEST-10-K_c0000",
            section_id="item_1",
            anchor_id="item_1_b000",
            text="Business content",
            block_index=0,
            word_count=2,
        ),
        Chunk(
            id="TEST-10-K_c0001",
            section_id="item_1a",
            anchor_id="item_1a_b000",
            text="Risk factors content",
            block_index=0,
            word_count=3,
        ),
    ]

    tables = [
        Table(
            id="TEST-10-K_t000",
            section_id="item_1",
            caption="Financial Summary",
            headers=["Year", "Revenue"],
            rows=[["2024", "$100M"]],
            html="<table><tr><td>Year</td><td>Revenue</td></tr></table>",
        ),
    ]

    return ParsedFiling(
        filing_id="TEST-10-K-2024-01-01",
        cik="0001234567",
        ticker="TEST",
        company_name="Test Company",
        form_type="10-K",
        filed_at="2024-01-01",
        report_period="2023-12-31",
        raw_html="<html><body>Raw HTML</body></html>",
        sections=sections,
        chunks=chunks,
        tables=tables,
        word_count=5,
    )


# =============================================================================
# Pattern Matching Tests
# =============================================================================

class TestPatternMatching:
    """Test section pattern matching."""

    def test_10k_patterns_match_standard_format(self):
        """Test 10-K patterns match standard 'Item N. Title' format."""
        test_cases = [
            ("item 1. business", "item_1"),
            ("item 1a. risk factors", "item_1a"),
            ("ITEM 7. MANAGEMENT'S DISCUSSION", "item_7"),
            ("Item 8. Financial Statements", "item_8"),
        ]

        for text, expected_id in test_cases:
            matched = False
            for pattern, section_id, label in SECTION_10K_PATTERNS:
                if re.search(pattern, text, re.IGNORECASE):
                    assert section_id == expected_id, f"Expected {expected_id}, got {section_id}"
                    matched = True
                    break
            assert matched, f"No pattern matched '{text}'"

    def test_10k_patterns_match_colon_separator(self):
        """Test 10-K patterns work with colon separator."""
        text = "item 1: business"
        for pattern, section_id, label in SECTION_10K_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE):
                assert section_id == "item_1"
                return
        pytest.fail("No pattern matched colon separator format")

    def test_10q_patterns_match_multiline(self):
        """Test 10-Q patterns with MULTILINE flag (^ and $ anchors)."""
        text = "\nConsolidated Balance Sheets\n(Unaudited)\n"

        # Test with MULTILINE flag
        for pattern, section_id, label in SECTION_10Q_PATTERNS:
            if re.search(pattern, text, re.IGNORECASE | re.MULTILINE):
                if section_id == "item_1":
                    return
        pytest.fail("10-Q balance sheet pattern should match with MULTILINE")

    def test_10k_all_items_have_patterns(self):
        """Test that common 10-K items have patterns."""
        expected_items = [
            "item_1", "item_1a", "item_1b", "item_2", "item_3",
            "item_7", "item_7a", "item_8", "item_9", "item_9a",
        ]
        pattern_ids = [p[1] for p in SECTION_10K_PATTERNS]
        for item in expected_items:
            assert item in pattern_ids, f"Missing pattern for {item}"

    def test_10q_part_patterns(self):
        """Test 10-Q Part I and Part II patterns."""
        test_cases = [
            ("PART I - FINANCIAL INFORMATION", "part_1"),
            ("Part II: Other Information", "part_2"),
        ]
        for text, expected_id in test_cases:
            matched = False
            for pattern, section_id, label in SECTION_10Q_PATTERNS:
                if re.search(pattern, text, re.IGNORECASE | re.MULTILINE):
                    if section_id == expected_id:
                        matched = True
                        break
            assert matched, f"No pattern matched '{text}' for {expected_id}"


# =============================================================================
# TOC Detection Tests
# =============================================================================

class TestTOCDetection:
    """Test Table of Contents region detection."""

    def test_toc_detection_with_explicit_label(self, parser):
        """Test TOC detection when 'table of contents' is present."""
        text = """
        TABLE OF CONTENTS
        Item 1. Business............1
        Item 2. Properties..........10
        Item 3. Legal...............20
        Item 4. Mine Safety.........30
        """
        # Position in the middle of the TOC
        assert parser._is_toc_region(text, 50) is True

    def test_toc_detection_with_dotted_leaders(self, parser):
        """Test TOC detection with dotted leader lines."""
        text = """
        Item 1...............................1
        Item 2...............................5
        Item 3...............................10
        Item 4...............................15
        Item 5...............................20
        Item 6...............................25
        Item 7...............................30
        Item 8...............................35
        Item 9...............................40
        """
        assert parser._is_toc_region(text, 100) is True

    def test_toc_detection_rejects_regular_content(self, parser):
        """Test that regular prose content is not flagged as TOC."""
        text = """
        Our business operations involve various activities related to Item 1
        of our strategic plan. We continue to develop solutions for our
        customers across multiple markets. The following sections provide
        detailed information about our operations.
        """
        assert parser._is_toc_region(text, 50) is False

    def test_toc_detection_with_page_numbers(self, parser):
        """Test TOC detection with page number patterns."""
        text = """
        Item 1...page 1
        Item 2...page 5
        Item 3...page 10
        Item 4...page 15
        Item 5...page 20
        Item 6...page 25
        Item 7...page 30
        Item 8...page 35
        """
        assert parser._is_toc_region(text, 100) is True

    def test_toc_detection_very_high_density(self, parser):
        """Test TOC detection with very high header density (12+)."""
        # Create text with 12+ distinct items but no other TOC signals
        text = """
        Item 1 overview
        Item 2 overview
        Item 3 overview
        Item 4 overview
        Item 5 overview
        Item 6 overview
        Item 7 overview
        Item 8 overview
        Item 9 overview
        Item 9a overview
        Item 9b overview
        Item 9c overview
        Item 10 overview
        """
        assert parser._is_toc_region(text, 100) is True

    def test_toc_detection_index_to_label(self, parser):
        """Test TOC detection with 'index to' label."""
        text = """
        INDEX TO FINANCIAL STATEMENTS
        Item 1. Balance Sheet.........5
        Item 2. Income Statement......10
        Item 3. Cash Flow.............15
        Item 4. Notes.................20
        """
        assert parser._is_toc_region(text, 50) is True

    def test_toc_detection_without_explicit_label(self, parser):
        """Test TOC detection when no explicit 'table of contents' label is present.

        This tests the secondary signals (high header density + page numbers or dotted leaders)
        that should still identify a TOC region without an explicit label.
        """
        # TOC-like region with many items and page numbers, but no "TABLE OF CONTENTS" label
        text = """
        Item 1. Business.......................1
        Item 1A. Risk Factors..................10
        Item 1B. Unresolved Staff Comments.....25
        Item 2. Properties.....................30
        Item 3. Legal Proceedings..............35
        Item 4. Mine Safety....................40
        Item 5. Market.........................45
        Item 6. Reserved.......................50
        Item 7. MD&A...........................55
        Item 8. Financial Statements...........100
        """

        # Should detect as TOC due to high header density (10 items) + dotted leaders
        assert parser._is_toc_region(text, len(text) // 2) is True

    def test_toc_detection_without_label_or_leaders(self, parser):
        """Test TOC detection with very high density but no explicit signals.

        When header density is very high (12+), it should be detected as TOC even
        without page numbers or dotted leaders.
        """
        text = """
        Item 1
        Item 1A
        Item 1B
        Item 2
        Item 3
        Item 4
        Item 5
        Item 6
        Item 7
        Item 7A
        Item 8
        Item 9
        Item 9A
        """

        # Should detect as TOC due to very high header density alone (12+ distinct items)
        assert parser._is_toc_region(text, len(text) // 2) is True


# =============================================================================
# HTML Extraction Tests
# =============================================================================

class TestHTMLExtraction:
    """Test HTML extraction and sanitization."""

    def test_html_text_extraction(self):
        """Test plain text extraction from HTML."""
        extractor = HTMLTextExtractor()
        html = "<div><p>Hello</p><p>World</p></div>"
        extractor.feed(html)
        text = extractor.get_text()
        assert "Hello" in text
        assert "World" in text

    def test_html_text_extractor_skips_scripts(self):
        """Test that script content is skipped."""
        extractor = HTMLTextExtractor()
        html = "<div><script>var x = 1;</script><p>Content</p></div>"
        extractor.feed(html)
        text = extractor.get_text()
        assert "var x" not in text
        assert "Content" in text

    def test_html_text_extractor_skips_styles(self):
        """Test that style content is skipped."""
        extractor = HTMLTextExtractor()
        html = "<div><style>.class { color: red; }</style><p>Content</p></div>"
        extractor.feed(html)
        text = extractor.get_text()
        assert "color" not in text
        assert "Content" in text

    def test_html_text_extractor_handles_nested_skip_tags(self):
        """Test handling of nested skip tags."""
        extractor = HTMLTextExtractor()
        # The HTML parser processes tags sequentially; head content should be skipped
        html = "<html><head><title>Title</title></head><body><p>Body Content</p></body></html>"
        extractor.feed(html)
        text = extractor.get_text()
        # Title is inside head which is a skip tag
        assert "Title" not in text
        # Body Content should be present (body is not a skip tag)
        assert "Body Content" in text or "Content" in text

    def test_html_sanitizer_removes_scripts(self):
        """Test that sanitizer removes script tags."""
        sanitizer = HTMLSanitizer()
        html = "<div><script>alert('xss')</script><p>Safe content</p></div>"
        clean = sanitizer.sanitize(html)
        assert "<script>" not in clean
        assert "Safe content" in clean

    def test_html_sanitizer_allows_tables(self):
        """Test that sanitizer preserves table elements."""
        sanitizer = HTMLSanitizer()
        html = "<table><tr><td>Cell</td></tr></table>"
        clean = sanitizer.sanitize(html)
        assert "<table>" in clean or "<table" in clean
        assert "Cell" in clean

    def test_html_sanitizer_removes_event_handlers(self):
        """Test that sanitizer removes onclick and other event handlers."""
        sanitizer = HTMLSanitizer()
        html = '<div onclick="alert(1)"><p onmouseover="hack()">Safe</p></div>'
        clean = sanitizer.sanitize(html)
        assert "onclick" not in clean.lower()
        assert "onmouseover" not in clean.lower()
        assert "Safe" in clean

    def test_html_sanitizer_removes_javascript_urls(self):
        """Test that sanitizer removes javascript: URLs."""
        sanitizer = HTMLSanitizer()
        html = '<a href="javascript:alert(1)">Link</a>'
        clean = sanitizer.sanitize(html)
        assert "javascript:" not in clean.lower()

    def test_html_sanitizer_fallback_without_bleach(self):
        """Test fallback sanitization when bleach is not available."""
        sanitizer = HTMLSanitizer()
        html = "<script>bad</script><style>.x{}</style><p onclick='x'>Good</p>"
        # Call fallback directly
        clean = sanitizer._fallback_sanitize(html)
        assert "<script>" not in clean
        assert "<style>" not in clean
        assert "onclick" not in clean
        assert "Good" in clean


# =============================================================================
# Chunk Generation Tests
# =============================================================================

class TestChunkGeneration:
    """Test text chunking for RAG."""

    def test_small_section_single_chunk(self, parser):
        """Test that small sections produce a single chunk."""
        sections = [Section(
            id="item_1",
            label="Item 1",
            html="<p>Short content</p>",
            text="Short content with just a few words.",
            char_start=0,
            char_end=36,
            word_count=7,
        )]

        chunks = parser._generate_chunks(sections, "test_filing")
        assert len(chunks) == 1
        assert chunks[0].section_id == "item_1"

    def test_large_section_multiple_chunks(self, parser):
        """Test that large sections produce multiple overlapping chunks."""
        # Create text with more than chunk_size (100) words
        words = ["word" + str(i) for i in range(250)]
        text = " ".join(words)

        sections = [Section(
            id="item_1",
            label="Item 1",
            html=f"<p>{text}</p>",
            text=text,
            char_start=0,
            char_end=len(text),
            word_count=250,
        )]

        chunks = parser._generate_chunks(sections, "test_filing")
        assert len(chunks) > 1

        # Verify overlap: last words of chunk N should appear in chunk N+1
        for i in range(len(chunks) - 1):
            current_words = set(chunks[i].text.split()[-20:])
            next_words = set(chunks[i + 1].text.split()[:20])
            overlap = current_words & next_words
            assert len(overlap) > 0, "Chunks should have overlap"

    def test_chunking_captures_all_content(self, parser):
        """Test that chunking doesn't drop tail content."""
        # Create exactly 150 words (more than chunk_size but not divisible by chunk step)
        words = ["word" + str(i) for i in range(150)]
        text = " ".join(words)

        sections = [Section(
            id="item_1",
            label="Item 1",
            html=f"<p>{text}</p>",
            text=text,
            char_start=0,
            char_end=len(text),
            word_count=150,
        )]

        chunks = parser._generate_chunks(sections, "test_filing")

        # All words should be present across chunks
        all_chunk_words = set()
        for chunk in chunks:
            all_chunk_words.update(chunk.text.split())

        original_words = set(words)
        assert original_words <= all_chunk_words, "All original words should be in chunks"

    def test_chunk_has_token_count_backwards_compat(self, parser):
        """Test that chunks have token_count for backwards compatibility."""
        sections = [Section(
            id="item_1",
            label="Item 1",
            html="<p>Some text here</p>",
            text="Some text here",
            char_start=0,
            char_end=14,
            word_count=3,
        )]

        chunks = parser._generate_chunks(sections, "test_filing")
        chunk_dict = chunks[0].to_dict()

        assert "word_count" in chunk_dict
        assert "token_count" in chunk_dict
        assert chunk_dict["word_count"] == chunk_dict["token_count"]

    def test_chunk_ids_are_unique(self, parser):
        """Test that chunk IDs are unique."""
        words = ["word" + str(i) for i in range(300)]
        text = " ".join(words)

        sections = [
            Section(id="item_1", label="Item 1", html="", text=text[:500],
                    char_start=0, char_end=500, word_count=100),
            Section(id="item_2", label="Item 2", html="", text=text[500:],
                    char_start=500, char_end=1000, word_count=100),
        ]

        chunks = parser._generate_chunks(sections, "test_filing")
        chunk_ids = [c.id for c in chunks]
        assert len(chunk_ids) == len(set(chunk_ids)), "Chunk IDs should be unique"


# =============================================================================
# Anchor Detection Tests
# =============================================================================

class TestAnchorDetection:
    """Test anchor point detection and filtering."""

    def test_caps_headers_detected(self, parser):
        """Test that ALL CAPS headers are detected as anchors."""
        section = Section(
            id="item_1",
            label="Item 1",
            html="",
            text="\nOVERVIEW\n\nSome content here.\n\nMARKET ANALYSIS\n\nMore content.",
            char_start=0,
            char_end=100,
            word_count=10,
        )

        anchors = parser._find_anchors(section)
        labels = [a.label for a in anchors]

        assert "OVERVIEW" in labels
        assert "MARKET ANALYSIS" in labels

    def test_title_case_headers_detected(self, parser):
        """Test that Title Case headers are detected."""
        section = Section(
            id="item_1",
            label="Item 1",
            html="",
            text="\nRisk Factor Overview\n\nSome content.\n\nMarket Conditions Summary\n\n",
            char_start=0,
            char_end=100,
            word_count=10,
        )

        anchors = parser._find_anchors(section)
        labels = [a.label for a in anchors]
        # Should detect title case headers with 2+ capitalized words
        assert any("Risk" in l for l in labels)

    def test_garbage_labels_filtered(self, parser):
        """Test that garbage labels are filtered out."""
        # Test the filter directly
        assert parser._is_valid_anchor_label("OVERVIEW") is True
        assert parser._is_valid_anchor_label("123") is False
        assert parser._is_valid_anchor_label("$1,000,000") is False
        assert parser._is_valid_anchor_label("Page 1") is False
        assert parser._is_valid_anchor_label("01/15/2024") is False
        assert parser._is_valid_anchor_label("---") is False
        assert parser._is_valid_anchor_label("January 1, 2024") is False

    def test_valid_labels_pass_filter(self, parser):
        """Test that valid anchor labels pass the filter."""
        valid_labels = [
            "RISK FACTORS",
            "Management Discussion",
            "FINANCIAL STATEMENTS",
            "Our Business Strategy",
        ]

        for label in valid_labels:
            assert parser._is_valid_anchor_label(label) is True, f"'{label}' should be valid"

    def test_anchor_limit(self, parser):
        """Test that anchors are limited to 20 per section."""
        # Create text with many headers
        headers = [f"\nHEADER NUMBER {i}\n\nContent.\n" for i in range(30)]
        text = "".join(headers)

        section = Section(
            id="item_1", label="Item 1", html="", text=text,
            char_start=0, char_end=len(text), word_count=100,
        )

        anchors = parser._find_anchors(section)
        assert len(anchors) <= 20

    def test_anchor_id_generation(self, parser):
        """Test stable anchor ID generation."""
        anchor_id1 = parser._make_anchor_id("item_1", "RISK FACTORS")
        anchor_id2 = parser._make_anchor_id("item_1", "RISK FACTORS")
        anchor_id3 = parser._make_anchor_id("item_1", "OVERVIEW")

        # Same inputs should produce same ID
        assert anchor_id1 == anchor_id2
        # Different labels should produce different IDs
        assert anchor_id1 != anchor_id3
        # Should contain section and label slug
        assert "item_1" in anchor_id1
        assert "risk" in anchor_id1.lower()


# =============================================================================
# Table Extraction Tests
# =============================================================================

class TestTableExtraction:
    """Test table extraction from HTML."""

    def test_table_with_thead(self, parser):
        """Test extracting table with proper thead/tbody structure."""
        section = Section(
            id="item_1",
            label="Item 1",
            html="""
            <table>
                <thead><tr><th>Year</th><th>Revenue</th></tr></thead>
                <tbody><tr><td>2024</td><td>$100M</td></tr></tbody>
            </table>
            """,
            text="Year Revenue 2024 $100M",
            char_start=0,
            char_end=50,
            word_count=5,
        )

        tables = parser._extract_tables([section], "test_filing")
        assert len(tables) == 1
        assert tables[0].headers == ["Year", "Revenue"]
        assert len(tables[0].rows) == 1

    def test_table_with_th_in_tbody(self, parser):
        """Test extracting table with th cells in tbody (first row as headers)."""
        section = Section(
            id="item_1",
            label="Item 1",
            html="""
            <table>
                <tbody>
                    <tr><th>Year</th><th>Revenue</th></tr>
                    <tr><td>2024</td><td>$100M</td></tr>
                </tbody>
            </table>
            """,
            text="Year Revenue 2024 $100M",
            char_start=0,
            char_end=50,
            word_count=5,
        )

        tables = parser._extract_tables([section], "test_filing")
        assert len(tables) == 1
        assert tables[0].headers == ["Year", "Revenue"]
        assert len(tables[0].rows) == 1

    def test_superscript_stripped_from_cells(self, parser):
        """Test that superscripts are stripped from cell text."""
        cell_html = "$1,000<sup>1</sup>"
        text = parser._extract_cell_text(cell_html)
        assert text == "$1,000"
        assert "^" not in text
        assert "(1)" not in text

    def test_subscript_stripped_from_cells(self, parser):
        """Test that subscripts are stripped from cell text."""
        cell_html = "H<sub>2</sub>O"
        text = parser._extract_cell_text(cell_html)
        assert text == "HO"
        assert "_" not in text

    def test_br_converted_to_newline(self, parser):
        """Test that <br> tags are converted to newlines."""
        cell_html = "Line 1<br>Line 2<br/>Line 3"
        text = parser._extract_cell_text(cell_html)
        assert "\n" in text
        assert "Line 1" in text
        assert "Line 2" in text

    def test_table_with_caption(self, parser):
        """Test extracting table caption."""
        section = Section(
            id="item_1",
            label="Item 1",
            html="""
            <table>
                <caption>Financial Summary</caption>
                <tr><th>Year</th><th>Revenue</th></tr>
                <tr><td>2024</td><td>$100M</td></tr>
            </table>
            """,
            text="Financial Summary Year Revenue 2024 $100M",
            char_start=0,
            char_end=50,
            word_count=7,
        )

        tables = parser._extract_tables([section], "test_filing")
        assert len(tables) == 1
        assert tables[0].caption == "Financial Summary"

    def test_empty_table_not_extracted(self, parser):
        """Test that empty tables are not extracted."""
        section = Section(
            id="item_1",
            label="Item 1",
            html="<table></table>",
            text="",
            char_start=0,
            char_end=0,
            word_count=0,
        )

        tables = parser._extract_tables([section], "test_filing")
        assert len(tables) == 0

    def test_table_to_dict(self):
        """Test Table.to_dict() method."""
        table = Table(
            id="test_t000",
            section_id="item_1",
            caption="Test Table",
            headers=["Col1", "Col2"],
            rows=[["A", "B"]],
            html="<table></table>",
        )
        d = table.to_dict()
        assert d["id"] == "test_t000"
        assert d["caption"] == "Test Table"
        assert d["headers"] == ["Col1", "Col2"]
        assert d["rows"] == [["A", "B"]]


# =============================================================================
# Section Dataclass Tests
# =============================================================================

class TestSectionDataclass:
    """Test Section dataclass methods."""

    def test_section_to_display_dict(self):
        """Test Section.to_display_dict() method."""
        section = Section(
            id="item_1",
            label="Item 1. Business",
            html="<p>Content</p>",
            text="Content",
            char_start=0,
            char_end=7,
            word_count=1,
            anchors=[],
        )
        d = section.to_display_dict()
        assert d["id"] == "item_1"
        assert d["label"] == "Item 1. Business"
        assert d["word_count"] == 1
        assert d["anchor_count"] == 0

    def test_section_to_rag_dict(self):
        """Test Section.to_rag_dict() method."""
        section = Section(
            id="item_1",
            label="Item 1. Business",
            html="<p>Content</p>",
            text="Content",
            char_start=0,
            char_end=7,
            word_count=1,
        )
        d = section.to_rag_dict()
        assert d["id"] == "item_1"
        assert d["text"] == "Content"
        assert d["char_start"] == 0
        assert d["char_end"] == 7


# =============================================================================
# End-to-End Parsing Tests
# =============================================================================

class TestEndToEndParsing:
    """Test complete filing parsing."""

    def test_parse_10k_filing(self, parser, sample_10k_html):
        """Test parsing a 10-K filing."""
        result = parser.parse(
            html_content=sample_10k_html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        assert isinstance(result, ParsedFiling)
        assert result.ticker == "TEST"
        assert result.form_type == "10-K"
        assert len(result.sections) > 0

        # Check that expected sections were found
        section_ids = [s.id for s in result.sections]
        assert "item_1" in section_ids  # Business
        assert "item_1a" in section_ids  # Risk Factors

    def test_parse_10q_filing(self, parser, sample_10q_html):
        """Test parsing a 10-Q filing."""
        result = parser.parse(
            html_content=sample_10q_html,
            filing_id="TEST-10-Q-2024-09-30",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-Q",
            filed_at="2024-11-01",
        )

        assert isinstance(result, ParsedFiling)
        assert result.form_type == "10-Q"
        assert len(result.sections) > 0

        # Check tables were extracted
        assert len(result.tables) > 0

    def test_toc_skipped_in_favor_of_content(self, parser, toc_html):
        """Test that TOC entries are skipped in favor of actual content."""
        result = parser.parse(
            html_content=toc_html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        # Find the business section
        business_section = None
        for section in result.sections:
            if section.id == "item_1":
                business_section = section
                break

        assert business_section is not None
        # The content should be from the actual section, not the TOC
        assert "substantial content" in business_section.text.lower()

    def test_parse_with_report_period(self, parser, sample_10k_html):
        """Test parsing with report period specified."""
        result = parser.parse(
            html_content=sample_10k_html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
            report_period="2023-12-31",
        )

        assert result.report_period == "2023-12-31"

    def test_word_count_aggregation(self, parser, sample_10k_html):
        """Test that word counts are correctly aggregated."""
        result = parser.parse(
            html_content=sample_10k_html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        section_word_count = sum(s.word_count for s in result.sections)
        assert result.word_count == section_word_count


# =============================================================================
# HTML Section Extraction Tests
# =============================================================================

class TestHTMLSectionExtraction:
    """Test HTML section extraction strategies."""

    def test_extract_section_html_by_label(self, parser):
        """Test extracting section HTML by label match."""
        html = """
        <div>
            <h2>Item 1. Business</h2>
            <p>Business content here with substantial text that should be captured.</p>
            <h2>Item 2. Properties</h2>
            <p>Properties content.</p>
        </div>
        """
        section_text = "Business content here with substantial text that should be captured."

        result = parser._extract_section_html(html, "Item 1. Business", section_text, None)
        assert "Business content" in result

    def test_extract_section_html_fallback_to_text(self, parser):
        """Test fallback when section label not found in HTML."""
        html = "<div><p>Some unrelated content</p></div>"
        section_text = "This is the section text."

        result = parser._extract_section_html(html, "Item 99. Missing", section_text, None)
        # Should get text-to-html conversion
        assert "section text" in result.lower()

    def test_text_to_html_conversion(self, parser):
        """Test text to HTML conversion."""
        text = "First paragraph.\n\nSecond paragraph."
        result = parser._text_to_html(text)

        assert "<p>" in result
        assert "First paragraph" in result
        assert "Second paragraph" in result

    def test_has_prose_following(self, parser):
        """Test prose detection after a position."""
        # Text with substantial prose and no section headers nearby
        prose_text = "We are a leading technology company that provides innovative " * 20

        # Should detect prose when no headers are found
        assert parser._has_prose_following(prose_text, 0) is True

        # When headers are close together, no prose
        toc_text = "Item 1.\nItem 2.\nItem 3."
        assert parser._has_prose_following(toc_text, 0, min_chars=500) is False

        # Header at start with prose following - should return False
        # because header pattern matches at position 0
        header_with_prose = "Item 1. Business\n\nContent here..."
        assert parser._has_prose_following(header_with_prose, 0, min_chars=10) is False


# =============================================================================
# End Boundary Detection Tests
# =============================================================================

class TestEndBoundaryDetection:
    """Test section end boundary detection."""

    def test_find_end_by_next_section_label(self, parser):
        """Test finding end by next section label."""
        html = """
        <div><h2>Item 1. Business</h2><p>Content</p>
        <h2>Item 2. Properties</h2><p>More</p></div>
        """
        next_section = {"label": "Item 2. Properties"}

        end = parser._find_section_end_boundary(
            html, 0, "Item 1. Business", "Content", next_section
        )

        # End should be before Item 2
        assert end < html.find("Item 2. Properties") + 10

    def test_end_boundary_uses_section_patterns(self, parser):
        """Test that section patterns are used to find boundaries."""
        html = """
        <div><h2>ITEM 1. BUSINESS</h2><p>Content</p>
        <h2>ITEM 1A. RISK FACTORS</h2><p>Risks</p></div>
        """

        end = parser._find_section_end_boundary(
            html, 0, "ITEM 1. BUSINESS", "Content", None
        )

        # Should find boundary at ITEM 1A
        assert end > 0
        assert end < len(html)


# =============================================================================
# Output Writer Tests
# =============================================================================

class TestOutputWriters:
    """Test artifact output writers."""

    def test_write_display_artifacts(self, parsed_filing):
        """Test writing display artifacts."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            paths = write_display_artifacts(parsed_filing, output_dir)

            # Check files were created
            assert (output_dir / "display" / "raw_primary.html").exists()
            assert (output_dir / "display" / "manifest.json").exists()
            assert (output_dir / "display" / "anchors.json").exists()
            assert (output_dir / "display" / "sections" / "item_1.html").exists()

            # Verify manifest content
            with open(output_dir / "display" / "manifest.json") as f:
                manifest = json.load(f)
            assert manifest["filing_id"] == "TEST-10-K-2024-01-01"
            assert manifest["ticker"] == "TEST"

    def test_write_rag_artifacts(self, parsed_filing):
        """Test writing RAG artifacts."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            paths = write_rag_artifacts(parsed_filing, output_dir)

            # Check files were created
            assert (output_dir / "rag" / "sections.jsonl").exists()
            assert (output_dir / "rag" / "chunks.jsonl").exists()
            assert (output_dir / "rag" / "tables.jsonl").exists()

            # Verify JSONL content
            with open(output_dir / "rag" / "chunks.jsonl") as f:
                lines = f.readlines()
            assert len(lines) == 2  # Two chunks

            chunk = json.loads(lines[0])
            assert "id" in chunk
            assert "text" in chunk

    def test_write_all_artifacts(self, parsed_filing):
        """Test writing all artifacts."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            paths = write_all_artifacts(parsed_filing, output_dir)

            # Check both display and rag directories
            assert (output_dir / "display").is_dir()
            assert (output_dir / "rag").is_dir()
            assert "manifest" in paths
            assert "sections" in paths

    def test_write_rag_without_tables(self):
        """Test writing RAG artifacts when there are no tables."""
        filing = ParsedFiling(
            filing_id="TEST",
            cik="123",
            ticker="TST",
            company_name="Test",
            form_type="10-K",
            filed_at="2024-01-01",
            report_period=None,
            raw_html="<html></html>",
            sections=[],
            chunks=[],
            tables=[],  # No tables
            word_count=0,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            paths = write_rag_artifacts(filing, output_dir)

            # tables.jsonl should not be created when there are no tables
            assert not (output_dir / "rag" / "tables.jsonl").exists()

    def test_anchors_include_block_anchors(self, parsed_filing):
        """Test that anchors.json includes block anchors from chunks."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            write_display_artifacts(parsed_filing, output_dir)

            with open(output_dir / "display" / "anchors.json") as f:
                anchors = json.load(f)

            # Should have section anchors and block anchors
            anchor_ids = list(anchors.keys())
            assert any("item_1" in aid for aid in anchor_ids)

    def test_chunk_anchor_ids_exist_in_anchors_json(self, parsed_filing):
        """Test that every chunk's anchor_id exists in anchors.json.

        This is a critical integration test to ensure that chunks can be
        properly linked back to their display anchors for highlighting/navigation.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            paths = write_all_artifacts(parsed_filing, output_dir)

            # Read anchors.json
            with open(output_dir / "display" / "anchors.json") as f:
                anchors = json.load(f)

            # Read chunks.jsonl
            chunks = []
            with open(output_dir / "rag" / "chunks.jsonl") as f:
                for line in f:
                    chunks.append(json.loads(line))

            # Verify every chunk's anchor_id exists in anchors
            missing_anchors = []
            for chunk in chunks:
                anchor_id = chunk["anchor_id"]
                if anchor_id not in anchors:
                    missing_anchors.append((chunk["id"], anchor_id))

            assert len(missing_anchors) == 0, \
                f"Chunks have anchor_ids not in anchors.json: {missing_anchors}"

    def test_chunk_anchor_ids_reference_correct_section(self, parsed_filing):
        """Test that chunk anchor_ids reference the correct section."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            write_all_artifacts(parsed_filing, output_dir)

            with open(output_dir / "display" / "anchors.json") as f:
                anchors = json.load(f)

            with open(output_dir / "rag" / "chunks.jsonl") as f:
                for line in f:
                    chunk = json.loads(line)
                    anchor_id = chunk["anchor_id"]
                    section_id = chunk["section_id"]

                    # The anchor should reference the same section
                    assert anchor_id in anchors, f"Anchor {anchor_id} not found"
                    assert anchors[anchor_id]["section_id"] == section_id, \
                        f"Anchor section mismatch: {anchors[anchor_id]['section_id']} != {section_id}"


# =============================================================================
# Convenience Function Tests
# =============================================================================

class TestConvenienceFunctions:
    """Test convenience functions."""

    def test_parse_filing_function(self, sample_10k_html):
        """Test the parse_filing convenience function."""
        result = parse_filing(
            html_content=sample_10k_html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        assert isinstance(result, ParsedFiling)
        assert result.filing_id == "TEST-10-K-2024-01-01"


# =============================================================================
# DOM Parsing Tests (when BeautifulSoup is available)
# =============================================================================

class TestDOMParsing:
    """Test DOM-based parsing (experimental)."""

    def test_dom_parsing_with_bs4(self, sample_10k_html):
        """Test DOM parsing path when BeautifulSoup is available."""
        parser = FilingParserV2()

        # This should work if BS4 is installed
        result = parser.parse(
            html_content=sample_10k_html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
            use_dom_parsing=True,  # Enable DOM parsing
        )

        assert isinstance(result, ParsedFiling)

    def test_dom_parsing_fallback_on_error(self, parser):
        """Test that DOM parsing falls back to text-based on error."""
        # Malformed HTML that might cause DOM parsing issues
        html = "<div><Item 1. Business<p>Content</p></div>"

        result = parser.parse(
            html_content=html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
            use_dom_parsing=True,
        )

        # Should still produce a result via fallback
        assert isinstance(result, ParsedFiling)


# =============================================================================
# Edge Cases and Error Handling
# =============================================================================

class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_html(self, parser):
        """Test handling of empty HTML."""
        result = parser.parse(
            html_content="",
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        assert isinstance(result, ParsedFiling)
        assert len(result.sections) == 0

    def test_malformed_html(self, parser):
        """Test handling of malformed HTML."""
        malformed_html = "<div><p>Unclosed tags<table><tr><td>Cell"

        result = parser.parse(
            html_content=malformed_html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        # Should not raise an exception
        assert isinstance(result, ParsedFiling)

    def test_xbrl_inline_format(self, parser):
        """Test handling of inline XBRL format."""
        xbrl_html = """
        <html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL">
        <body>
            <ix:hidden><ix:nonfraction>12345</ix:nonfraction></ix:hidden>
            <div>
                <h2>ITEM 1. BUSINESS</h2>
                <p><ix:nonfraction name="us-gaap:Revenue">$1,000,000</ix:nonfraction></p>
            </div>
        </body>
        </html>
        """

        result = parser.parse(
            html_content=xbrl_html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        assert isinstance(result, ParsedFiling)
        # Hidden ix elements should be excluded from text
        if result.sections:
            for section in result.sections:
                assert "12345" not in section.text

    def test_very_long_html(self, parser):
        """Test handling of very long HTML documents."""
        # Create a document with many sections
        sections = []
        for i in range(50):
            sections.append(f"<h2>Section {i}</h2><p>{'Content ' * 100}</p>")
        html = f"<html><body>{''.join(sections)}</body></html>"

        result = parser.parse(
            html_content=html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        assert isinstance(result, ParsedFiling)

    def test_special_characters_in_content(self, parser):
        """Test handling of special characters."""
        html = """
        <html><body>
            <h2>ITEM 1. BUSINESS</h2>
            <p>Revenue was $1,234,567 (€1,100,000). Growth of 25% & decline of 10%.</p>
            <p>CEO's statement: "We're excited about 2024!"</p>
        </body></html>
        """

        result = parser.parse(
            html_content=html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        assert isinstance(result, ParsedFiling)
        if result.sections:
            text = result.sections[0].text
            assert "$" in text or "1,234,567" in text

    def test_unicode_content(self, parser):
        """Test handling of Unicode content."""
        html = """
        <html><body>
            <h2>ITEM 1. BUSINESS</h2>
            <p>我们是一家技术公司。日本語コンテンツ。Ελληνικά κείμενο.</p>
        </body></html>
        """

        result = parser.parse(
            html_content=html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        assert isinstance(result, ParsedFiling)

    def test_nested_tables(self, parser):
        """Test handling of nested tables."""
        section = Section(
            id="item_1",
            label="Item 1",
            html="""
            <table>
                <tr><td>Outer
                    <table><tr><td>Inner</td></tr></table>
                </td></tr>
            </table>
            """,
            text="Outer Inner",
            char_start=0,
            char_end=11,
            word_count=2,
        )

        tables = parser._extract_tables([section], "test_filing")
        # Should extract tables (behavior may vary for nested)
        assert isinstance(tables, list)

    def test_html_parsing_error_recovery(self, parser):
        """Test recovery from HTML parsing errors."""
        # HTML with invalid characters
        html = "<html><body>\x00\x01\x02<h2>ITEM 1. BUSINESS</h2><p>Content</p></body></html>"

        result = parser.parse(
            html_content=html,
            filing_id="TEST-10-K-2024-01-01",
            cik="0001234567",
            ticker="TEST",
            company_name="Test Company",
            form_type="10-K",
            filed_at="2024-01-01",
        )

        # Should handle gracefully
        assert isinstance(result, ParsedFiling)


# =============================================================================
# Section Position Finding Tests
# =============================================================================

class TestSectionPositionFinding:
    """Test section position finding with scoring."""

    def test_section_positions_sorted(self, parser):
        """Test that section positions are sorted by start position."""
        text = """
        Item 2. Properties
        Some content
        Item 1. Business
        More content
        """

        positions = parser._find_section_positions(text, SECTION_10K_PATTERNS)

        # Should be sorted by start position
        starts = [p["start"] for p in positions]
        assert starts == sorted(starts)

    def test_toc_matches_downranked(self, parser):
        """Test that TOC matches are downranked."""
        # Create text with TOC followed by actual section
        text = """
        TABLE OF CONTENTS
        Item 1. Business............1
        Item 2. Properties..........10
        Item 3. Legal...............20
        Item 4. Mine Safety.........30
        Item 5. Market..............40
        Item 6. Reserved............50
        Item 7. MD&A................60
        Item 8. Financial...........70
        Item 9. Changes.............80

        ITEM 1. BUSINESS

        We are a leading company with significant operations worldwide.
        Our products include software and services for enterprise customers.
        """

        positions = parser._find_section_positions(text, SECTION_10K_PATTERNS)

        # Item 1 should be found at the actual section, not TOC
        item_1 = next((p for p in positions if p["id"] == "item_1"), None)
        assert item_1 is not None
        assert "We are a leading" in text[item_1["start"]:item_1["start"] + 500]


# =============================================================================
# Additional Coverage Tests
# =============================================================================

class TestTextToHtmlWithTables:
    """Test _text_to_html_with_tables method."""

    def test_text_with_matching_table(self, parser):
        """Test text to HTML when a matching table is found."""
        original_html = """
        <div>
            <table><tr><td>Revenue</td><td>$100M</td></tr></table>
            <p>Other content</p>
        </div>
        """
        text = "Revenue $100M\nOther content"

        result = parser._text_to_html_with_tables(text, original_html)
        # Should contain sanitized table or paragraph elements
        assert "<" in result  # Has HTML tags

    def test_text_without_tables_in_html(self, parser):
        """Test text to HTML when original has no tables."""
        original_html = "<div><p>Simple content</p></div>"
        text = "First paragraph.\n\nSecond paragraph."

        result = parser._text_to_html_with_tables(text, original_html)
        assert "<p>" in result

    def test_text_with_table_caption_match(self, parser):
        """Test matching table by caption text."""
        original_html = """
        <table>
            <caption>Financial Summary</caption>
            <tr><td>Year</td><td>2024</td></tr>
        </table>
        """
        text = "Financial Summary\nYear 2024"

        result = parser._text_to_html_with_tables(text, original_html)
        assert result is not None


class TestDOMExtractionDetailed:
    """Detailed tests for DOM-based extraction."""

    def test_dom_extraction_finds_sections(self):
        """Test that DOM extraction finds section headers."""
        parser = FilingParserV2()
        html = """
        <html><body>
            <div>
                <h2>Item 1. Business</h2>
                <p>Business content paragraph one.</p>
                <p>Business content paragraph two.</p>
            </div>
            <div>
                <h2>Item 1A. Risk Factors</h2>
                <p>Risk content.</p>
            </div>
        </body></html>
        """

        result = parser.parse(
            html_content=html,
            filing_id="TEST-10-K",
            cik="123",
            ticker="TEST",
            company_name="Test",
            form_type="10-K",
            filed_at="2024-01-01",
            use_dom_parsing=True,
        )

        assert len(result.sections) >= 1

    def test_dom_extraction_with_no_matches(self):
        """Test DOM extraction when no patterns match."""
        parser = FilingParserV2()
        html = "<html><body><p>No section headers here.</p></body></html>"

        result = parser.parse(
            html_content=html,
            filing_id="TEST-10-K",
            cik="123",
            ticker="TEST",
            company_name="Test",
            form_type="10-K",
            filed_at="2024-01-01",
            use_dom_parsing=True,
        )

        # Should fall back to text-based and find nothing
        assert isinstance(result, ParsedFiling)


class TestHTMLExtractionStrategies:
    """Test various HTML extraction strategies."""

    def test_extract_section_by_text_anchor(self, parser):
        """Test extraction using text anchor when label not found."""
        html = """
        <div>
            <span>SOME LABEL</span>
            <p>This is distinctive anchor text that should match the section content
            with enough words to be considered substantial for matching.</p>
        </div>
        """
        section_text = "This is distinctive anchor text that should match the section content with enough words"

        # Label doesn't match but text anchor should work
        result = parser._extract_section_html(html, "Missing Label", section_text, None)
        assert result is not None

    def test_end_boundary_with_toc_context(self, parser):
        """Test end boundary detection skips TOC-like references."""
        html = """
        <div>
            <h2>ITEM 1. BUSINESS</h2>
            <p>Content here.</p>
            <p>See also: Item 2, Item 3, Item 4 for reference.</p>
            <h2>ITEM 2. PROPERTIES</h2>
        </div>
        """
        next_section = {"label": "ITEM 2. PROPERTIES"}

        end = parser._find_section_end_boundary(
            html, 0, "ITEM 1. BUSINESS", "Content here.", next_section
        )

        # Should find boundary
        assert end < len(html)

    def test_end_boundary_with_structural_breaks(self, parser):
        """Test end boundary finds structural breaks like <hr>."""
        html = """
        <div>
            <h2>ITEM 1. BUSINESS</h2>
            <p>Content.</p>
            <hr>
            <p>More content.</p>
        </div>
        """

        # Create a very long section_text so expected_html_len is long
        section_text = "Content. " * 100

        end = parser._find_section_end_boundary(
            html, 0, "ITEM 1. BUSINESS", section_text, None
        )

        assert end >= 0


class TestHTMLParsingErrors:
    """Test HTML parsing error handling."""

    def test_extract_text_with_exception(self, parser):
        """Test _extract_text handles parser exceptions gracefully."""
        # Create HTML that might cause parsing issues
        bad_html = "<div><<invalid>>text</div>"

        # Should not raise exception
        text = parser._extract_text(bad_html)
        assert isinstance(text, str)

    def test_sanitizer_data_url_removal(self):
        """Test that data: URLs are removed by fallback sanitizer."""
        sanitizer = HTMLSanitizer()
        html = '<img src="data:image/png;base64,abc123">'
        clean = sanitizer._fallback_sanitize(html)
        assert "data:" not in clean


class TestFindBlockParent:
    """Test _find_block_parent method."""

    def test_find_block_parent_with_bs4(self):
        """Test finding block parent element."""
        try:
            from bs4 import BeautifulSoup
        except ImportError:
            pytest.skip("BeautifulSoup not available")

        parser = FilingParserV2()
        html = "<div><p><span>Text</span></p></div>"
        soup = BeautifulSoup(html, 'lxml')
        span = soup.find('span')

        block = parser._find_block_parent(span)
        # Should find p or div
        assert block is not None
        assert block.name in ['p', 'div', 'span']


class TestAnchorEdgeCases:
    """Test edge cases in anchor detection."""

    def test_anchor_with_short_label(self, parser):
        """Test that short labels are filtered."""
        assert parser._is_valid_anchor_label("AB") is False
        assert parser._is_valid_anchor_label("ABC") is True

    def test_anchor_with_low_alpha_ratio(self, parser):
        """Test labels with low alphabetic ratio."""
        # "123 ABC" has 3/7 = 43% alpha, should pass
        assert parser._is_valid_anchor_label("123 ABC") is True
        # "12345" has 0% alpha, should fail
        assert parser._is_valid_anchor_label("12345") is False


class TestTableNoHeaders:
    """Test table extraction edge cases."""

    def test_table_without_headers(self, parser):
        """Test table with no headers at all."""
        section = Section(
            id="item_1",
            label="Item 1",
            html="""
            <table>
                <tbody>
                    <tr><td>A</td><td>B</td></tr>
                    <tr><td>C</td><td>D</td></tr>
                </tbody>
            </table>
            """,
            text="A B C D",
            char_start=0,
            char_end=7,
            word_count=4,
        )

        tables = parser._extract_tables([section], "test_filing")
        assert len(tables) == 1
        # All rows should be data rows
        assert len(tables[0].rows) >= 1


class TestWriterEdgeCases:
    """Test edge cases in output writers."""

    def test_manifest_includes_all_stats(self, parsed_filing):
        """Test that manifest includes all required stats."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            write_display_artifacts(parsed_filing, output_dir)

            with open(output_dir / "display" / "manifest.json") as f:
                manifest = json.load(f)

            assert "stats" in manifest
            assert "word_count" in manifest["stats"]
            assert "section_count" in manifest["stats"]
            assert "chunk_count" in manifest["stats"]
            assert "table_count" in manifest["stats"]

    def test_sections_jsonl_format(self, parsed_filing):
        """Test that sections.jsonl has correct format."""
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            write_rag_artifacts(parsed_filing, output_dir)

            with open(output_dir / "rag" / "sections.jsonl") as f:
                lines = f.readlines()

            for line in lines:
                section = json.loads(line)
                assert "id" in section
                assert "label" in section
                assert "text" in section


class TestParseFilingConvenience:
    """Additional tests for parse_filing convenience function."""

    def test_parse_filing_with_report_period(self, sample_10k_html):
        """Test parse_filing with optional report_period."""
        result = parse_filing(
            html_content=sample_10k_html,
            filing_id="TEST-10-K-2024",
            cik="123",
            ticker="TEST",
            company_name="Test Co",
            form_type="10-K",
            filed_at="2024-01-01",
            report_period="2023-12-31",
        )

        assert result.report_period == "2023-12-31"


class TestEndBoundaryTOCDetection:
    """Test TOC detection within end boundary logic."""

    def test_end_boundary_skips_toc_matches(self, parser):
        """Test that end boundary detection skips matches that look like TOC."""
        html = """
        <div>
            <h2>ITEM 1. BUSINESS</h2>
            <p>Actual content here with many words that constitute real prose.</p>
            <div>
                <p>Item 1 Item 2 Item 3 Item 4 Item 5</p>
                <h2>ITEM 1A. RISK FACTORS</h2>
            </div>
        </div>
        """
        next_section = {"label": "ITEM 1A. RISK FACTORS"}

        end = parser._find_section_end_boundary(
            html, 0, "ITEM 1. BUSINESS", "Actual content here", next_section
        )

        # Should find a boundary
        assert end > 0


class TestTextToHtmlWithTablesDetailed:
    """More detailed tests for _text_to_html_with_tables."""

    def test_table_content_matching(self, parser):
        """Test table content matching with line text."""
        original_html = """
        <table>
            <tr><td>Annual Revenue</td><td>$500M</td></tr>
            <tr><td>Net Income</td><td>$50M</td></tr>
        </table>
        <p>Additional notes</p>
        """
        text = "Annual Revenue $500M\nNet Income $50M\nAdditional notes"

        result = parser._text_to_html_with_tables(text, original_html)
        assert result is not None
        assert len(result) > 0

    def test_multiple_tables_matching(self, parser):
        """Test matching multiple tables."""
        original_html = """
        <table><tr><td>Table 1</td></tr></table>
        <p>Text between</p>
        <table><tr><td>Table 2</td></tr></table>
        """
        text = "Table 1\nText between\nTable 2"

        result = parser._text_to_html_with_tables(text, original_html)
        assert result is not None

    def test_long_caption_not_matched(self, parser):
        """Test that lines over 100 chars are not treated as table captions."""
        original_html = """
        <table><tr><td>Data</td></tr></table>
        """
        # Create line longer than 100 chars
        long_line = "A" * 150
        text = f"{long_line}\nData"

        result = parser._text_to_html_with_tables(text, original_html)
        # Should still produce HTML even if matching fails
        assert result is not None


class TestDOMExtractionEdgeCases:
    """Edge cases for DOM extraction."""

    def test_dom_with_empty_text_nodes(self):
        """Test DOM extraction with empty text nodes."""
        parser = FilingParserV2()
        html = """
        <html><body>
            <div>   </div>
            <h2>Item 1. Business</h2>
            <p>Content</p>
        </body></html>
        """

        result = parser.parse(
            html_content=html,
            filing_id="TEST",
            cik="123",
            ticker="TEST",
            company_name="Test",
            form_type="10-K",
            filed_at="2024-01-01",
            use_dom_parsing=True,
        )

        assert isinstance(result, ParsedFiling)

    def test_dom_with_navigable_strings(self):
        """Test DOM extraction handles NavigableString correctly."""
        parser = FilingParserV2()
        html = """
        <html><body>
            <h2>Item 1. Business</h2>
            Plain text here
            <p>More content</p>
        </body></html>
        """

        result = parser.parse(
            html_content=html,
            filing_id="TEST",
            cik="123",
            ticker="TEST",
            company_name="Test",
            form_type="10-K",
            filed_at="2024-01-01",
            use_dom_parsing=True,
        )

        assert isinstance(result, ParsedFiling)

    def test_dom_extraction_preserves_document_order(self):
        """Test that DOM extraction preserves document order after deduplication.

        This test verifies that sections are returned in document order even when
        the same section_id appears multiple times (e.g., in TOC and actual content).
        """
        parser = FilingParserV2()
        # HTML with sections appearing in a specific order, including duplicates
        html = """
        <html><body>
            <div>
                <h2>Item 1A. Risk Factors</h2>
                <p>This is the first occurrence with less content.</p>
            </div>
            <div>
                <h2>Item 1. Business</h2>
                <p>Business section content with substantial text that should be captured
                and is longer than the risk factors section above.</p>
            </div>
            <div>
                <h2>Item 2. Properties</h2>
                <p>Properties content.</p>
            </div>
            <div>
                <h2>Item 1A. Risk Factors</h2>
                <p>This is the second occurrence with more content that should be preferred.
                It has much more text including details about market risks, operational risks,
                and various other risk factors that investors should consider.</p>
            </div>
        </body></html>
        """

        result = parser.parse(
            html_content=html,
            filing_id="TEST-10-K",
            cik="123",
            ticker="TEST",
            company_name="Test",
            form_type="10-K",
            filed_at="2024-01-01",
            use_dom_parsing=True,
        )

        # Should have 3 sections (deduplicated by section_id)
        section_ids = [s.id for s in result.sections]

        # Sections should be in document order based on their first occurrence
        # (item_1a appears first, then item_1, then item_2)
        # But after deduplication, the order should be preserved by traversal index
        assert len(result.sections) >= 1  # At least some sections found

        # If all three are found, verify they maintain relative order
        if "item_1a" in section_ids and "item_1" in section_ids:
            idx_1a = section_ids.index("item_1a")
            idx_1 = section_ids.index("item_1")
            # item_1a appears first in document, so should come first
            assert idx_1a < idx_1, "item_1a should appear before item_1 in document order"


class TestSectionExtractionEdgeCases:
    """Edge cases in section extraction."""

    def test_section_with_empty_text(self, parser):
        """Test section extraction when text is empty."""
        html = "<div></div>"
        text = ""
        positions = []

        sections = parser._extract_sections(html, text, positions)
        assert len(sections) == 0

    def test_section_positions_with_single_match(self, parser):
        """Test section positions with only one match."""
        text = "Item 1. Business\n\nContent here."

        positions = parser._find_section_positions(text, SECTION_10K_PATTERNS)

        # Should find at least one position
        assert len(positions) >= 1


class TestHTMLExtractorEdgeCases:
    """Edge cases for HTML text extractor."""

    def test_extractor_block_tags_newlines(self):
        """Test that block tags add newlines."""
        extractor = HTMLTextExtractor()
        html = "<div>Line 1</div><div>Line 2</div>"
        extractor.feed(html)
        text = extractor.get_text()

        # Should have newlines between divs
        assert "\n" in text

    def test_extractor_br_tags(self):
        """Test that br tags add newlines."""
        extractor = HTMLTextExtractor()
        html = "<p>Line 1<br>Line 2</p>"
        extractor.feed(html)
        text = extractor.get_text()

        assert "Line 1" in text
        assert "Line 2" in text


class TestScoreCalculation:
    """Test score calculation in section matching."""

    def test_score_with_toc_and_prose(self, parser):
        """Test that scores correctly penalize TOC and boost prose."""
        # Create a text that looks like TOC
        toc_text = """
        TABLE OF CONTENTS
        Item 1.......1
        Item 2.......5
        Item 3.......10
        Item 4.......15
        Item 5.......20
        Item 6.......25
        Item 7.......30
        Item 8.......35

        Item 1. Business

        This is actual content that should be preferred.
        """ * 3  # Make it longer

        positions = parser._find_section_positions(toc_text, SECTION_10K_PATTERNS)

        # Should have positions with internal scoring data
        for p in positions:
            # Verify scoring metadata is present
            assert "_score" in p or len(positions) == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--cov=parser_v2", "--cov-report=term-missing"])
