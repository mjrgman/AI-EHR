import os
import json
import time
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")

class EnterpriseBrain:
    def __init__(self):
        self.active = False
        if API_KEY:
            try:
                genai.configure(api_key=API_KEY)
                self.model = genai.GenerativeModel('gemini-pro')
                self.active = True
            except: pass
    
    def process_ambient(self, context, transcript, current_data=None):
        """
        Routes the transcript to the correct specialized AI Persona.
        """
        if not self.active: return self._simulate(context, transcript)

        # 1. PHONE AI (Extraction)
        if context == "PHONE":
            prompt = (f"Role: Medical Scheduler. Task: Extract pre-reg data.\\n"
                      f"Transcript: {transcript}\\n"
                      f"Output JSON: {{'intent': 'APPOINTMENT', 'patient_name': '...', 'complaint': '...'}}")

        # 2. RECEPTION AI (Updates)
        elif context == "RECEPTION":
            prompt = (f"Role: Receptionist. Task: Update demographics.\\n"
                      f"Transcript: {transcript}\\n"
                      f"Output JSON: {{'address': '...', 'insurance': '...'}}")
        
        # 3. CLINICAL AI (Scribe + CPOE)
        elif context == "CLINICAL":
            prompt = (f"Role: Medical Scribe. Task: SOAP Note + CPOE Orders.\\n"
                      f"Transcript: {transcript}\\n"
                      f"CRITICAL CONSTRAINT: Do NOT use em-dashes (—). Use hyphens (-).\\n"
                      f"Output JSON: {{'soap': '...', 'orders': [{{'test': '...'}}], 'billing': [{{'code': '...', 'val': 0.0}}]}}")

        # 4. LAB AI (Fulfillment)
        elif context == "LAB":
            prompt = (f"Role: Lab Tech. Task: Identify collected specimens from transcript.\\n"
                      f"Pending Orders: {current_data}\\n"
                      f"Transcript: {transcript}\\n"
                      f"Output JSON: {{'collected': ['...']}}")

        # 5. BILLING AI (Revenue Cycle)
        elif context == "BILLING":
            prompt = (f"Role: Medical Coder. Task: Scrub Claim.\\n"
                      f"Claim Data: {current_data}\\n"
                      f"Action: Check for bundling, modifier 25 needs, or ICD specificity.\\n"
                      f"Output JSON: {{'status': 'SCRUBBED', 'note': '...', 'revenue': 0.0}}")

        try:
            response = self.model.generate_content(prompt)
            # Clean Markdown formatting if present
            clean_text = response.text.replace("```json", "").replace("```", "").strip()
            return json.loads(clean_text)
        except:
            return self._simulate(context, transcript)

    def _simulate(self, context, text):
        # Fail-safe simulation for offline demos
        time.sleep(1.0)
        if context == "PHONE":
            return {"intent": "APPOINTMENT", "patient_name": "Bruce Wayne", "complaint": "Arm Injury"}
        elif context == "RECEPTION":
            return {"address": "1007 Mountain Dr", "insurance": "Wayne Enterprises Health"}
        elif context == "CLINICAL":
            return {
                "soap": "S: Pt reports pain... O: Swelling L Arm... A: Fracture... P: Cast.", 
                "orders": [{"test": "CBC"}, {"test": "X-Ray Arm"}], 
                "billing": [{"code": "99214", "val": 150.0}, {"code": "73090", "val": 45.0}]
            }
        elif context == "LAB":
            return {"collected": ["CBC", "X-Ray Arm"]}
        elif context == "BILLING":
            return {"status": "SCRUBBED", "note": "AI Applied Modifier 25.", "revenue": 195.0}
        return {}