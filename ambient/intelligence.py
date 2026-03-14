"""
TRUE AI EHR - Intelligence Engine
================================
Context-Aware AI Processing with ECW Compatibility

NOTE: This file was originally misnamed as 'database.py'.
      It should be named 'intelligence.py' as it contains the AI engine.

Fixes Applied:
- Fixed UTF-8 encoding corruption (â€" -> em-dash handling)
- Added proper error handling (no bare except clauses)
- Added type hints throughout
- Made google-generativeai import optional
- Added robust JSON parsing with fallbacks
- Added comprehensive docstrings
- Added ECW character sanitization
"""

import os
import json
import time
import re
from typing import Optional, Dict, Any, List

# Attempt to load Google Generative AI (graceful fallback if not installed)
try:
    import google.generativeai as genai
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    genai = None

# Attempt to load dotenv (optional)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Get API key from environment
API_KEY = os.getenv("GEMINI_API_KEY", "").strip()


class EnterpriseBrain:
    """
    Multi-Context AI Processor for Healthcare Workflows.
    
    Supports five workflow contexts:
    - PHONE: Telephony intake and scheduling extraction
    - RECEPTION: Check-in and demographic updates
    - CLINICAL: SOAP notes, CPOE orders, and billing codes
    - LAB: Specimen collection tracking
    - BILLING: Claim scrubbing and compliance auditing
    
    Features:
    - ECW-compatible output (no em-dashes or smart quotes)
    - Graceful fallback to simulation mode
    - Robust JSON parsing with multiple fallback strategies
    
    Usage:
        brain = EnterpriseBrain()
        result = brain.process_ambient("CLINICAL", "Patient complains of...")
    """
    
    def __init__(self):
        """Initialize the AI engine with optional Gemini connection."""
        self.active = False
        self.model = None
        self._init_ai_connection()
    
    def _init_ai_connection(self) -> None:
        """Attempt to establish connection to Gemini API."""
        if not GENAI_AVAILABLE:
            print("[AI] google-generativeai not installed. Running in SIMULATION mode.")
            return
        
        if not API_KEY:
            print("[AI] No GEMINI_API_KEY found. Running in SIMULATION mode.")
            return
        
        try:
            genai.configure(api_key=API_KEY)
            self.model = genai.GenerativeModel('gemini-pro')
            # Test the connection with a simple request
            test_response = self.model.generate_content("Reply with: OK")
            if test_response and test_response.text:
                self.active = True
                print("[AI] Gemini Pro connection established successfully.")
        except Exception as e:
            print(f"[AI] Failed to connect to Gemini: {e}")
            print("[AI] Falling back to SIMULATION mode.")
    
    def _sanitize_for_ecw(self, text: str) -> str:
        """
        Sanitize text for ECW compatibility.
        
        ECW systems have known issues with certain Unicode characters.
        This method replaces problematic characters with safe alternatives.
        
        Args:
            text: Input text to sanitize
            
        Returns:
            ECW-compatible text string
        """
        if not text or not isinstance(text, str):
            return text or ""
        
        # Replace em-dashes and en-dashes with hyphens
        text = text.replace("\u2014", "-")  # em-dash (U+2014)
        text = text.replace("\u2013", "-")  # en-dash (U+2013)
        
        # Handle common UTF-8 mojibake (corrupted encoding patterns)
        # These occur when UTF-8 is misread as Latin-1
        text = text.replace("\xe2\x80\x94", "-")  # em-dash mojibake
        text = text.replace("\xe2\x80\x93", "-")  # en-dash mojibake
        
        # Replace smart quotes with standard quotes
        text = text.replace("\u201c", '"')  # left double quote (U+201C)
        text = text.replace("\u201d", '"')  # right double quote (U+201D)
        text = text.replace("\u2018", "'")  # left single quote (U+2018)
        text = text.replace("\u2019", "'")  # right single quote (U+2019)
        
        # Handle quote mojibake
        text = text.replace("\xe2\x80\x9c", '"')  # left quote mojibake
        text = text.replace("\xe2\x80\x9d", '"')  # right quote mojibake
        
        # Replace other problematic characters
        text = text.replace("…", "...")  # ellipsis
        text = text.replace("•", "-")    # bullet
        
        return text
    
    def _sanitize_result(self, data: Any) -> Any:
        """
        Recursively sanitize all strings in a data structure.
        
        Args:
            data: Dict, list, string, or other data type
            
        Returns:
            Sanitized data structure
        """
        if isinstance(data, str):
            return self._sanitize_for_ecw(data)
        elif isinstance(data, dict):
            return {k: self._sanitize_result(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self._sanitize_result(item) for item in data]
        return data
    
    def _parse_json_response(self, text: str) -> Dict[str, Any]:
        """
        Safely parse JSON from AI response with multiple fallback strategies.
        
        Args:
            text: Raw text response from AI
            
        Returns:
            Parsed dictionary or empty dict on failure
        """
        if not text:
            return {}
        
        # Strategy 1: Clean markdown and try direct parse
        cleaned = text.strip()
        cleaned = re.sub(r'^```json\s*', '', cleaned)
        cleaned = re.sub(r'^```\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
        cleaned = cleaned.strip()
        
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass
        
        # Strategy 2: Find JSON object pattern
        json_match = re.search(r'\{[^{}]*\}', text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        
        # Strategy 3: Find nested JSON object
        nested_match = re.search(r'\{.*\}', text, re.DOTALL)
        if nested_match:
            try:
                return json.loads(nested_match.group())
            except json.JSONDecodeError:
                pass
        
        # All strategies failed
        print(f"[AI WARNING] Could not parse JSON from response: {text[:100]}...")
        return {}
    
    def _build_prompt(self, context: str, transcript: str, current_data: Any = None) -> str:
        """
        Build context-specific prompts for the AI model.
        
        Args:
            context: Workflow context (PHONE, RECEPTION, CLINICAL, LAB, BILLING)
            transcript: Voice transcript or input text
            current_data: Additional context data
            
        Returns:
            Formatted prompt string
        """
        # Common constraints for all prompts
        constraints = (
            "\n\nCRITICAL CONSTRAINTS:\n"
            "1. Respond ONLY with valid JSON - no explanations or markdown.\n"
            "2. Do NOT use em-dashes (use regular hyphens only).\n"
            "3. Do NOT use smart quotes (use straight quotes only).\n"
        )
        
        prompts = {
            "PHONE": (
                f"Role: Medical Scheduler AI\n"
                f"Task: Extract scheduling information from phone call transcript.\n\n"
                f"Transcript: {transcript}\n"
                f"{constraints}"
                f"\nOutput Format:\n"
                f'{{"intent": "APPOINTMENT|INQUIRY|CANCEL|REFILL", '
                f'"patient_name": "extracted name", '
                f'"complaint": "chief complaint", '
                f'"urgency": "ROUTINE|URGENT|EMERGENCY"}}'
            ),
            
            "RECEPTION": (
                f"Role: Medical Receptionist AI\n"
                f"Task: Extract demographic updates from check-in conversation.\n\n"
                f"Transcript: {transcript}\n"
                f"{constraints}"
                f"\nOutput Format:\n"
                f'{{"address": "new address or null", '
                f'"phone": "new phone or null", '
                f'"insurance": "insurance payer or null"}}'
            ),
            
            "CLINICAL": (
                f"Role: Medical Scribe AI\n"
                f"Task: Generate SOAP note, lab orders, and billing codes.\n\n"
                f"Transcript: {transcript}\n"
                f"{constraints}"
                f"\nOutput Format:\n"
                f'{{"soap": "S: ... O: ... A: ... P: ...", '
                f'"orders": [{{"test": "test name"}}], '
                f'"billing": [{{"code": "CPT code", "val": dollar_amount}}]}}'
            ),
            
            "LAB": (
                f"Role: Lab Technician AI\n"
                f"Task: Identify which specimens were collected from the transcript.\n\n"
                f"Pending Orders: {current_data}\n"
                f"Transcript: {transcript}\n"
                f"{constraints}"
                f"\nOutput Format:\n"
                f'{{"collected": ["test1", "test2"]}}'
            ),
            
            "BILLING": (
                f"Role: Medical Coder AI\n"
                f"Task: Audit and scrub claim for compliance.\n\n"
                f"Claim Data: {current_data}\n"
                f"Check for: bundling issues, modifier 25 needs, ICD specificity.\n"
                f"{constraints}"
                f"\nOutput Format:\n"
                f'{{"status": "SCRUBBED", "note": "audit findings", "revenue": dollar_amount}}'
            )
        }
        
        return prompts.get(context, f"Process this: {transcript}")
    
    def process_ambient(
        self, 
        context: str, 
        transcript: str, 
        current_data: Optional[Any] = None
    ) -> Dict[str, Any]:
        """
        Process transcript through context-aware AI.
        
        Routes the transcript to the appropriate specialized AI persona
        based on the workflow context.
        
        Args:
            context: Workflow stage - one of:
                     PHONE, RECEPTION, CLINICAL, LAB, BILLING
            transcript: Voice transcript or input text to process
            current_data: Additional context (e.g., pending orders for LAB)
            
        Returns:
            Structured dictionary with context-specific results
            
        Example:
            >>> brain = EnterpriseBrain()
            >>> result = brain.process_ambient("PHONE", "Hi, I need an appointment")
            >>> print(result)
            {'intent': 'APPOINTMENT', 'patient_name': '...', 'complaint': '...'}
        """
        # Validate context
        valid_contexts = {"PHONE", "RECEPTION", "CLINICAL", "LAB", "BILLING"}
        if context not in valid_contexts:
            print(f"[AI WARNING] Unknown context: {context}. Valid: {valid_contexts}")
            return {}
        
        # Use simulation if AI not active
        if not self.active:
            return self._simulate(context, transcript)
        
        # Build and send prompt
        prompt = self._build_prompt(context, transcript, current_data)
        
        try:
            response = self.model.generate_content(prompt)
            
            if not response or not response.text:
                print("[AI WARNING] Empty response from model, using simulation.")
                return self._simulate(context, transcript)
            
            # Parse and sanitize response
            result = self._parse_json_response(response.text)
            
            if not result:
                print("[AI WARNING] Failed to parse response, using simulation.")
                return self._simulate(context, transcript)
            
            # Sanitize all strings for ECW compatibility
            return self._sanitize_result(result)
            
        except Exception as e:
            print(f"[AI ERROR] {type(e).__name__}: {e}")
            return self._simulate(context, transcript)
    
    def _simulate(self, context: str, text: str) -> Dict[str, Any]:
        """
        Provide realistic simulation responses for offline demos.
        
        This serves as a fail-safe when the AI API is unavailable,
        allowing the system to demonstrate functionality.
        
        Args:
            context: Workflow context
            text: Input transcript (used for future enhancements)
            
        Returns:
            Simulated response dictionary
        """
        # Brief delay to simulate processing
        time.sleep(0.5)
        
        simulations: Dict[str, Dict[str, Any]] = {
            "PHONE": {
                "intent": "APPOINTMENT",
                "patient_name": "Bruce Wayne",
                "complaint": "Arm Injury - workplace incident",
                "urgency": "URGENT"
            },
            
            "RECEPTION": {
                "address": "1007 Mountain Drive, Gotham City",
                "phone": "555-0142",
                "insurance": "Wayne Enterprises Health Plan"
            },
            
            "CLINICAL": {
                "soap": (
                    "S: Patient reports acute pain in left arm following "
                    "workplace incident. Pain rated 7/10, no numbness. "
                    "O: Left forearm with visible swelling and ecchymosis. "
                    "ROM limited by pain. Neurovascular intact distally. "
                    "A: Suspected left forearm fracture. "
                    "P: X-ray left forearm, CBC, splint and elevate."
                ),
                "orders": [
                    {"test": "CBC"},
                    {"test": "X-Ray Left Forearm 2-View"}
                ],
                "billing": [
                    {"code": "99214", "val": 150.0},
                    {"code": "73090", "val": 45.0}
                ]
            },
            
            "LAB": {
                "collected": ["CBC", "X-Ray Left Forearm 2-View"]
            },
            
            "BILLING": {
                "status": "SCRUBBED",
                "note": "AI Review: Modifier 25 applied to E/M code for same-day procedure. Codes verified for bundling compliance.",
                "revenue": 195.0
            }
        }
        
        return simulations.get(context, {})
    
    def get_status(self) -> Dict[str, Any]:
        """
        Get current status of the AI engine.
        
        Returns:
            Dictionary with status information
        """
        return {
            "active": self.active,
            "mode": "LIVE" if self.active else "SIMULATION",
            "model": "gemini-pro" if self.active else "offline-simulator",
            "genai_available": GENAI_AVAILABLE,
            "api_key_configured": bool(API_KEY)
        }
    
    def test_connection(self) -> bool:
        """
        Test the AI connection with a simple request.
        
        Returns:
            True if connection is working, False otherwise
        """
        if not self.active:
            return False
        
        try:
            response = self.model.generate_content("Reply with exactly: CONNECTION_OK")
            return response and "OK" in response.text
        except Exception as e:
            print(f"[AI] Connection test failed: {e}")
            return False


# Convenience function for quick testing
def test_brain():
    """Quick test of the EnterpriseBrain."""
    print("=" * 50)
    print("EnterpriseBrain Test")
    print("=" * 50)
    
    brain = EnterpriseBrain()
    status = brain.get_status()
    
    print(f"\nStatus: {status}")
    print(f"\nTesting PHONE context...")
    
    result = brain.process_ambient(
        "PHONE", 
        "Hi, this is John. I need to schedule an appointment for my back pain."
    )
    print(f"Result: {json.dumps(result, indent=2)}")
    
    print("\nTesting CLINICAL context...")
    result = brain.process_ambient(
        "CLINICAL",
        "Patient complains of lower back pain for 3 days. Exam shows muscle spasm. "
        "Prescribing muscle relaxants and ordering lumbar X-ray."
    )
    print(f"Result: {json.dumps(result, indent=2)}")


if __name__ == "__main__":
    test_brain()
