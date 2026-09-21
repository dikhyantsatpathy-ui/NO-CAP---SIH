import base64
import json
import os
from openai import OpenAI
from pydantic import BaseModel, Field

_client = None

def get_client() -> OpenAI | None:
    global _client
    if _client is not None:
        return _client
    
    url = os.getenv("LITELLM_URL", "http://localhost:4000")
    key = os.getenv("LITELLM_API_KEY", "dummy-key")
    
    if not url:
        return None
        
    _client = OpenAI(
        base_url=url,
        api_key=key,
    )
    return _client

class ExtractedFields(BaseModel):
    name: str | None = Field(description="Holder name extracted from the document", default=None)
    dob: str | None = Field(description="Date of birth in YYYY-MM-DD format", default=None)
    gender: str | None = Field(description="Gender (M, F, etc.)", default=None)
    pan: str | None = Field(description="10-character PAN number if present", default=None)
    driving_licence: str | None = Field(description="Driving licence number if present", default=None)
    passport: str | None = Field(description="Passport or visa number if present", default=None)
    voter_id: str | None = Field(description="Voter ID (EPIC) if present", default=None)
    aadhaar: str | None = Field(description="12-digit Aadhaar number without spaces if present", default=None)

class DiscrepancyResult(BaseModel):
    verdict: str = Field(description="Must be exactly 'CONSISTENT', 'DISCREPANCY', or 'INCOMPLETE'")
    reasoning: str = Field(description="Brief explanation of the verdict, explaining if variations in name/dates are semantic matches or hard mismatches.")
    semantic_match: bool = Field(description="True if all documents semantically refer to the same person despite minor typos or formatting differences.")

def extract_document_data(image_bytes: bytes, doc_type: str = "") -> dict:
    """Uses a multimodal LLM to extract structured fields from a document image."""
    client = get_client()
    if not client:
        return {"ran": False, "reason": "LiteLLM proxy not configured"}

    # Base64 encode the image
    b64_image = base64.b64encode(image_bytes).decode("utf-8")
    
    prompt = f"""
    You are an expert identity document OCR system. Extract the relevant fields from this document image.
    Document type hint: {doc_type or "Unknown"}
    
    Return the fields in JSON matching the schema. If a field is not present, set it to null.
    For dates, always format as YYYY-MM-DD.
    """
    
    try:
        response = client.chat.completions.create(
            model=os.getenv("LITELLM_EXTRACT_MODEL", "gpt-4o"),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{b64_image}"
                            }
                        }
                    ]
                }
            ],
            response_format={"type": "json_schema", "json_schema": {"name": "ExtractedFields", "schema": ExtractedFields.model_json_schema(), "strict": True}},
            temperature=0.0,
            max_tokens=1024,
        )
        content = response.choices[0].message.content
        if content:
            data = json.loads(content)
            return {"ran": True, "fields": data}
        return {"ran": False, "reason": "Empty response"}
    except Exception as e:
        return {"ran": False, "reason": str(e)}

def analyze_session_discrepancies(docs_data: list[dict]) -> dict:
    """Uses an LLM to semantically compare documents in a session for discrepancies.
    Allows minor typos, spelling variations (e.g. Mohd vs Mohammed), or formatting differences.
    """
    client = get_client()
    if not client:
        return {"ran": False, "reason": "LiteLLM proxy not configured"}
        
    prompt = f"""
    You are an expert immigration officer. Analyze the following extracted fields from multiple identity documents presented by a single traveler.
    
    Documents:
    {json.dumps(docs_data, indent=2)}
    
    Determine if these documents belong to the exact same person.
    - Minor spelling variations in transliteration (e.g., Mohd vs Mohammed, Kumar vs Kumar) are OK and should be a SEMANTIC_MATCH.
    - Date format variations or off-by-one-day typos are generally suspicious but might be acceptable if all other fields match perfectly.
    - Completely different names, DOBs, or IDs represent a hard DISCREPANCY.
    - If there is not enough overlapping data (e.g. only 1 document has a name), return INCOMPLETE.
    
    Return your verdict as CONSISTENT, DISCREPANCY, or INCOMPLETE.
    """
    
    try:
        response = client.chat.completions.create(
            model=os.getenv("LITELLM_REASONING_MODEL", "gpt-4o"),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_schema", "json_schema": {"name": "DiscrepancyResult", "schema": DiscrepancyResult.model_json_schema(), "strict": True}},
            temperature=0.0,
            max_tokens=512,
        )
        content = response.choices[0].message.content
        if content:
            return {"ran": True, "result": json.loads(content)}
        return {"ran": False, "reason": "Empty response"}
    except Exception as e:
        return {"ran": False, "reason": str(e)}
