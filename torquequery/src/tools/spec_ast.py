import json
import yaml
from typing import Dict, List, Any, Optional

def _parse_spec(content: str) -> Dict[str, Any]:
    """
    Safely parse spec content as either JSON or YAML.
    """
    cleaned = content.strip()
    if cleaned.startswith("{") or cleaned.startswith("["):
        try:
            return json.loads(cleaned)
        except Exception:
            pass
    # Fallback to YAML
    try:
        return yaml.safe_load(cleaned) or {}
    except Exception as e:
        print(f"Error parsing spec as YAML/JSON: {str(e)}")
        return {}

def list_endpoints(spec_content: str) -> List[Dict[str, Any]]:
    """
    List all endpoints defined in the spec with their method, route, and summary.
    """
    spec = _parse_spec(spec_content)
    endpoints = []
    
    paths = spec.get("paths", {})
    for route, path_item in paths.items():
        if not isinstance(path_item, dict):
            continue
        for method, operation in path_item.items():
            if method.lower() not in ["get", "post", "put", "delete", "patch", "options", "head", "trace"]:
                continue
            if not isinstance(operation, dict):
                continue
                
            endpoints.append({
                "method": method.upper(),
                "route": route,
                "summary": operation.get("summary", ""),
                "description": operation.get("description", ""),
                "parameters": operation.get("parameters", []),
                "requestBodySchemaName": _extract_request_body_schema(operation),
                "responses": operation.get("responses", {})
            })
            
    return endpoints

def get_endpoint(spec_content: str, method: str, route: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve full structured details for a specific route and method.
    """
    spec = _parse_spec(spec_content)
    paths = spec.get("paths", {})
    
    # Try to find matching route (handling case sensitivity and trailing slashes)
    matched_route = None
    for r in paths.keys():
        if r.strip("/").lower() == route.strip("/").lower():
            matched_route = r
            break
            
    if not matched_route:
        return None
        
    path_item = paths[matched_route]
    if not isinstance(path_item, dict):
        return None
        
    operation = path_item.get(method.lower())
    if not operation or not isinstance(operation, dict):
        return None
        
    return {
        "method": method.upper(),
        "route": matched_route,
        "summary": operation.get("summary", ""),
        "description": operation.get("description", ""),
        "parameters": operation.get("parameters", []),
        "requestBodySchemaName": _extract_request_body_schema(operation),
        "responses": operation.get("responses", {})
    }

def find_schema(spec_content: str, schema_name: str) -> Optional[Dict[str, Any]]:
    """
    Locate and return a schema declaration under components/schemas.
    """
    spec = _parse_spec(spec_content)
    schemas = spec.get("components", {}).get("schemas", {})
    
    # Check direct match or case-insensitive match
    if schema_name in schemas:
        return schemas[schema_name]
        
    for name, schema in schemas.items():
        if name.lower() == schema_name.lower():
            return schema
            
    # Also check legacy definitions block
    definitions = spec.get("definitions", {})
    if schema_name in definitions:
        return definitions[schema_name]
    for name, schema in definitions.items():
        if name.lower() == schema_name.lower():
            return schema
            
    return None

def search_spec(spec_content: str, query: str) -> Dict[str, Any]:
    """
    Search endpoint summaries, routes, and schema names for a given query term.
    """
    endpoints = list_endpoints(spec_content)
    spec = _parse_spec(spec_content)
    
    matched_endpoints = []
    q = query.lower()
    
    for ep in endpoints:
        if (q in ep["route"].lower() or 
            q in ep["summary"].lower() or 
            q in ep["description"].lower()):
            matched_endpoints.append(ep)
            
    matched_schemas = {}
    schemas = spec.get("components", {}).get("schemas", {})
    for name, schema in schemas.items():
        if q in name.lower() or q in json.dumps(schema).lower():
            matched_schemas[name] = schema
            
    # Check definitions
    definitions = spec.get("definitions", {})
    for name, schema in definitions.items():
        if q in name.lower() or q in json.dumps(schema).lower():
            matched_schemas[name] = schema
            
    return {
        "endpoints": matched_endpoints,
        "schemas": matched_schemas
    }

def _extract_request_body_schema(operation: Dict[str, Any]) -> str:
    """
    Helper to extract schema name referenced in requestBody.
    """
    req_body = operation.get("requestBody", {})
    if not isinstance(req_body, dict):
        return ""
    content = req_body.get("content", {})
    for media_type, media_obj in content.items():
        if not isinstance(media_obj, dict):
            continue
        schema = media_obj.get("schema", {})
        ref = schema.get("$ref", "")
        if ref:
            # Extract name from "#/components/schemas/User" or "#/definitions/User"
            return ref.split("/")[-1]
    return ""
