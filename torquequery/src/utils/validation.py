"""
Input validation for TorqueQuery endpoints
"""

class ValidationError(Exception):
    """Validation error for API inputs"""
    pass


def validate_query(question: str, task_labels: list[str] | None = None) -> tuple[str, list[str]]:
    """Validate /query endpoint input"""
    if not question or not isinstance(question, str):
        raise ValidationError("question is required and must be string")

    if len(question) > 10000:
        raise ValidationError("question exceeds 10000 character limit")

    if not question.strip():
        raise ValidationError("question cannot be empty or whitespace-only")

    labels = task_labels or []
    if not isinstance(labels, list):
        raise ValidationError("taskLabels must be array")

    for label in labels:
        if not isinstance(label, str):
            raise ValidationError("taskLabels must contain only strings")
        if len(label) > 100:
            raise ValidationError("taskLabel exceeds 100 character limit")

    return question.strip(), labels


def validate_fs_read(path: str, offset: int | None = None, limit: int | None = None) -> tuple[str, int, int]:
    """Validate /api/fs/read endpoint input"""
    if not path or not isinstance(path, str):
        raise ValidationError("path is required and must be string")

    if len(path) > 1024:
        raise ValidationError("path exceeds 1024 character limit")

    safe_offset = offset or 0
    safe_limit = limit or 50000

    if not isinstance(safe_offset, int) or safe_offset < 0:
        raise ValidationError("offset must be non-negative integer")

    if not isinstance(safe_limit, int) or safe_limit < 1:
        raise ValidationError("limit must be positive integer")

    if safe_limit > 1000000:
        raise ValidationError("limit exceeds 1MB ceiling")

    return path, safe_offset, safe_limit


def validate_spec_path(spec_path: str) -> str:
    """Validate spec file path"""
    if not spec_path or not isinstance(spec_path, str):
        raise ValidationError("specPath is required and must be string")

    if len(spec_path) > 1024:
        raise ValidationError("specPath exceeds 1024 character limit")

    if not (spec_path.endswith(".json") or spec_path.endswith(".yaml") or spec_path.endswith(".yml")):
        raise ValidationError("specPath must point to .json, .yaml, or .yml file")

    return spec_path


def validate_pdf_path(pdf_path: str) -> str:
    """Validate PDF file path"""
    if not pdf_path or not isinstance(pdf_path, str):
        raise ValidationError("pdfPath is required and must be string")

    if len(pdf_path) > 1024:
        raise ValidationError("pdfPath exceeds 1024 character limit")

    if not pdf_path.endswith(".pdf"):
        raise ValidationError("pdfPath must point to .pdf file")

    return pdf_path


def validate_chat_instruction(instruction: str) -> str:
    """Validate chat-edit-session instruction"""
    if not instruction or not isinstance(instruction, str):
        raise ValidationError("instruction is required and must be string")

    if len(instruction) > 5000:
        raise ValidationError("instruction exceeds 5000 character limit")

    if not instruction.strip():
        raise ValidationError("instruction cannot be empty or whitespace-only")

    return instruction.strip()


def validate_page_range(start_page: int, end_page: int) -> tuple[int, int]:
    """Validate PDF page range"""
    if not isinstance(start_page, int) or not isinstance(end_page, int):
        raise ValidationError("startPage and endPage must be integers")

    if start_page < 1:
        raise ValidationError("startPage must be >= 1")

    if end_page < start_page:
        raise ValidationError("endPage must be >= startPage")

    if end_page - start_page > 100:
        raise ValidationError("page range cannot exceed 100 pages")

    return start_page, end_page
