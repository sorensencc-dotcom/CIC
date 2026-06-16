from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
import os

class LazyResourceResolver(ABC):
    @abstractmethod
    def resolve(
        self, 
        path: str, 
        meta: Dict[str, Any], 
        offset: Optional[int] = None, 
        limit: Optional[int] = None
    ) -> str:
        """
        Fetch external resource, returning plain text slice based on offset/limit.
        Must return decoded UTF-8 string.
        """
        pass

class DefaultLazyResolver(LazyResourceResolver):
    def __init__(self, workspace_root: str):
        self.workspace_root = workspace_root

    def resolve(
        self, 
        path: str, 
        meta: Dict[str, Any], 
        offset: Optional[int] = None, 
        limit: Optional[int] = None
    ) -> str:
        source = meta.get("source", "s3")
        file_type = meta.get("type", "page")
        
        # Determine if we can resolve to a local file in a mock storage dir
        mock_file_path = os.path.join(self.workspace_root, "torquequery", "storage", "mock_lazy", path)
        
        if os.path.exists(mock_file_path) and os.path.isfile(mock_file_path):
            try:
                with open(mock_file_path, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
            except Exception as e:
                content = f"Error reading lazy file: {str(e)}"
        else:
            # Fallback to generating structured mock content
            if file_type == "spec":
                content = self._generate_mock_spec(path, source)
            else:
                content = self._generate_mock_text(path, source)
                
        # Handle slicing
        start = offset if offset is not None else 0
        
        if limit is not None:
            end = start + limit
            sliced_content = content[start:end]
        else:
            sliced_content = content[start:]
            
        return sliced_content

    def get_total_length(self, path: str, meta: Dict[str, Any]) -> int:
        """
        Get the total length of the full resource without fully loading it if possible,
        or falling back to len().
        """
        # Read mock file or generate
        mock_file_path = os.path.join(self.workspace_root, "torquequery", "storage", "mock_lazy", path)
        if os.path.exists(mock_file_path) and os.path.isfile(mock_file_path):
            return os.path.getsize(mock_file_path)
            
        # Fallback to length of generated content
        if meta.get("type") == "spec":
            return len(self._generate_mock_spec(path, meta.get("source", "s3")))
        return len(self._generate_mock_text(path, meta.get("source", "s3")))

    def _generate_mock_text(self, path: str, source: str) -> str:
        lines = [
            f"# Virtual File: {path}",
            f"Source: Remote {source}",
            "",
            "## Description",
            "This document is resolved dynamically from an external system.",
            "It is mapped as a lazy-loaded resource in the TorqueQuery path tree.",
            "",
            "## Content Snippet"
        ]
        # Make it reasonably large to test pagination
        for i in range(1, 150):
            lines.append(f"Line {i}: This is some simulated data segment for block {i * 7}. Lorem ipsum dolor sit amet.")
        return "\n".join(lines)

    def _generate_mock_spec(self, path: str, source: str) -> str:
        # Return a valid mock OpenAPI spec
        return """{
  "openapi": "3.0.0",
  "info": {
    "title": "Mock API Spec",
    "version": "1.0.0",
    "description": "Simulated OpenAPI spec resolved lazily."
  },
  "paths": {
    "/users": {
      "get": {
        "summary": "List all users",
        "description": "Retrieves the list of active user records.",
        "responses": {
          "200": {
            "description": "Successful operation",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": {
                    "$ref": "#/components/schemas/User"
                  }
                }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Create user",
        "description": "Adds a new user to the directory.",
        "parameters": [
          {
            "name": "dryRun",
            "in": "query",
            "required": false,
            "schema": {
              "type": "boolean"
            }
          }
        ],
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "$ref": "#/components/schemas/User"
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "User created successfully"
          }
        }
      }
    },
    "/users/{id}": {
      "get": {
        "summary": "Get user by ID",
        "responses": {
          "200": {
            "description": "Success"
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "User": {
        "type": "object",
        "required": ["id", "username"],
        "properties": {
          "id": {
            "type": "string"
          },
          "username": {
            "type": "string"
          },
          "email": {
            "type": "string"
          }
        }
      }
    }
  }
}"""
