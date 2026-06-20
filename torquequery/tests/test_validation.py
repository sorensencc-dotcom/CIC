"""
Tests for TorqueQuery input validation
"""

import pytest
from src.utils.validation import (
    ValidationError,
    validate_query,
    validate_fs_read,
    validate_spec_path,
    validate_pdf_path,
    validate_chat_instruction,
    validate_page_range,
)


class TestQueryValidation:
    def test_valid_query(self):
        question, labels = validate_query("What is X?", ["tag1", "tag2"])
        assert question == "What is X?"
        assert labels == ["tag1", "tag2"]

    def test_empty_question_rejected(self):
        with pytest.raises(ValidationError):
            validate_query("")

    def test_whitespace_only_rejected(self):
        with pytest.raises(ValidationError):
            validate_query("   \n  ")

    def test_question_too_long_rejected(self):
        with pytest.raises(ValidationError):
            validate_query("x" * 10001)

    def test_non_string_question_rejected(self):
        with pytest.raises(ValidationError):
            validate_query(None)

    def test_invalid_task_labels_rejected(self):
        with pytest.raises(ValidationError):
            validate_query("What?", "not-array")

    def test_label_with_non_string_rejected(self):
        with pytest.raises(ValidationError):
            validate_query("What?", ["tag1", 123])

    def test_label_too_long_rejected(self):
        with pytest.raises(ValidationError):
            validate_query("What?", ["x" * 101])

    def test_default_labels_empty(self):
        question, labels = validate_query("What?", None)
        assert labels == []


class TestFsReadValidation:
    def test_valid_read(self):
        path, offset, limit = validate_fs_read("/docs/file.md", 0, 1000)
        assert path == "/docs/file.md"
        assert offset == 0
        assert limit == 1000

    def test_default_offset_and_limit(self):
        path, offset, limit = validate_fs_read("/docs/file.md")
        assert offset == 0
        assert limit == 50000

    def test_empty_path_rejected(self):
        with pytest.raises(ValidationError):
            validate_fs_read("")

    def test_path_too_long_rejected(self):
        with pytest.raises(ValidationError):
            validate_fs_read("/" + "x" * 1024)

    def test_negative_offset_rejected(self):
        with pytest.raises(ValidationError):
            validate_fs_read("/docs/file.md", -1, 1000)

    def test_zero_limit_rejected(self):
        with pytest.raises(ValidationError):
            validate_fs_read("/docs/file.md", 0, 0)

    def test_limit_too_large_rejected(self):
        with pytest.raises(ValidationError):
            validate_fs_read("/docs/file.md", 0, 1000001)

    def test_non_integer_offset_rejected(self):
        with pytest.raises(ValidationError):
            validate_fs_read("/docs/file.md", "not-int", 1000)

    def test_non_integer_limit_rejected(self):
        with pytest.raises(ValidationError):
            validate_fs_read("/docs/file.md", 0, "not-int")


class TestSpecPathValidation:
    def test_valid_json_spec(self):
        path = validate_spec_path("/specs/api.json")
        assert path == "/specs/api.json"

    def test_valid_yaml_spec(self):
        path = validate_spec_path("/specs/api.yaml")
        assert path == "/specs/api.yaml"

    def test_valid_yml_spec(self):
        path = validate_spec_path("/specs/api.yml")
        assert path == "/specs/api.yml"

    def test_empty_path_rejected(self):
        with pytest.raises(ValidationError):
            validate_spec_path("")

    def test_wrong_extension_rejected(self):
        with pytest.raises(ValidationError):
            validate_spec_path("/specs/api.md")

    def test_path_too_long_rejected(self):
        with pytest.raises(ValidationError):
            validate_spec_path("/" + "x" * 1024 + ".json")


class TestPdfPathValidation:
    def test_valid_pdf_path(self):
        path = validate_pdf_path("/docs/document.pdf")
        assert path == "/docs/document.pdf"

    def test_empty_path_rejected(self):
        with pytest.raises(ValidationError):
            validate_pdf_path("")

    def test_wrong_extension_rejected(self):
        with pytest.raises(ValidationError):
            validate_pdf_path("/docs/document.txt")

    def test_path_too_long_rejected(self):
        with pytest.raises(ValidationError):
            validate_pdf_path("/" + "x" * 1024 + ".pdf")


class TestChatInstructionValidation:
    def test_valid_instruction(self):
        instr = validate_chat_instruction("Change the color to blue")
        assert instr == "Change the color to blue"

    def test_whitespace_trimmed(self):
        instr = validate_chat_instruction("  Make it bold  ")
        assert instr == "Make it bold"

    def test_empty_instruction_rejected(self):
        with pytest.raises(ValidationError):
            validate_chat_instruction("")

    def test_whitespace_only_rejected(self):
        with pytest.raises(ValidationError):
            validate_chat_instruction("   \n  ")

    def test_instruction_too_long_rejected(self):
        with pytest.raises(ValidationError):
            validate_chat_instruction("x" * 5001)


class TestPageRangeValidation:
    def test_valid_range(self):
        start, end = validate_page_range(1, 10)
        assert start == 1
        assert end == 10

    def test_single_page(self):
        start, end = validate_page_range(5, 5)
        assert start == 5
        assert end == 5

    def test_zero_start_rejected(self):
        with pytest.raises(ValidationError):
            validate_page_range(0, 10)

    def test_negative_start_rejected(self):
        with pytest.raises(ValidationError):
            validate_page_range(-1, 10)

    def test_inverted_range_rejected(self):
        with pytest.raises(ValidationError):
            validate_page_range(10, 5)

    def test_range_too_large_rejected(self):
        with pytest.raises(ValidationError):
            validate_page_range(1, 102)

    def test_non_integer_rejected(self):
        with pytest.raises(ValidationError):
            validate_page_range("1", 10)
