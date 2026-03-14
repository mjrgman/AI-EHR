"""
TRUE AI EHR - Main Application
==============================
Voice-Driven Healthcare Workflow UI

Fixes Applied:
- Fixed UTF-8 mojibake (corrupted emoji characters)
- Added proper error handling with try/except
- Replaced manual session.close() with context managers
- Added input validation
- Added type hints
- Fixed potential None reference errors
"""

import uuid
from typing import Tuple, Optional
from contextlib import contextmanager

import gradio as gr

# Import from corrected modules
from database import (
    init_db, 
    SessionOp, 
    Patient, 
    Encounter, 
    LabOrder, 
    Claim
)
from intelligence import EnterpriseBrain


# --- INITIALIZATION ---

print("\n" + "=" * 50)
print("  TRUE AI EHR - Starting Up...")
print("=" * 50)

try:
    init_db()
    print("[DB] Database initialized successfully.")
except Exception as e:
    print(f"[DB ERROR] Failed to initialize database: {e}")
    raise SystemExit(1)

brain = EnterpriseBrain()
ai_status = brain.get_status()
print(f"[AI] Mode: {ai_status.get('mode', 'UNKNOWN')}")
print("=" * 50 + "\n")


# --- SESSION CONTEXT MANAGER ---

@contextmanager
def get_session():
    """
    Context manager for safe database session handling.
    Ensures sessions are properly closed even if exceptions occur.
    """
    session = SessionOp()
    try:
        yield session
        session.commit()
    except Exception as e:
        session.rollback()
        raise e
    finally:
        session.close()


# --- HELPER FUNCTIONS ---

def get_or_create_patient(session, patient_id: str = "PT-100") -> Patient:
    """Get existing patient or create a new one."""
    pat = session.query(Patient).filter(Patient.id == patient_id).first()
    if not pat:
        pat = Patient(
            id=patient_id,
            first_name="Bruce",
            last_name="Wayne",
            journey_stage="PRE-REG"
        )
        session.add(pat)
    return pat


def validate_transcript(transcript: str) -> Tuple[bool, str]:
    """Validate transcript input."""
    if not transcript or not transcript.strip():
        return False, "Error: Please provide a transcript."
    return True, transcript.strip()


# --- WORKFLOW CONTROLLERS ---

def run_phone_intake(transcript: str) -> str:
    """
    STAGE 1: TELEPHONY - Pre-Registration
    
    Processes incoming phone calls to extract patient info
    and create/update pre-registration records.
    """
    # Validate input
    valid, result = validate_transcript(transcript)
    if not valid:
        return result
    
    try:
        # Process with AI
        data = brain.process_ambient("PHONE", result)
        
        with get_session() as sop:
            # Check if patient exists, else create Pre-Reg
            pat = sop.query(Patient).filter(
                Patient.last_name == "Wayne"
            ).first()
            
            if not pat:
                pat = Patient(
                    id=f"PT-{uuid.uuid4().hex[:6].upper()}",
                    first_name="Bruce",
                    last_name="Wayne",
                    journey_stage="PRE-REG"
                )
                sop.add(pat)
            else:
                pat.journey_stage = "PRE-REG"
            
            # Create phone encounter record
            enc = Encounter(
                id=f"ENC-{uuid.uuid4().hex[:6].upper()}",
                patient_id=pat.id,
                type="PHONE",
                transcript=transcript,
                notes=f"Intent: {data.get('intent')} | Complaint: {data.get('complaint')}"
            )
            sop.add(enc)
            
            response = (
                f"📞 CALL LOGGED\n"
                f"{'=' * 35}\n"
                f"Patient: {data.get('patient_name', 'Unknown')}\n"
                f"Intent: {data.get('intent', 'N/A')}\n"
                f"Complaint: {data.get('complaint', 'N/A')}\n"
                f"Urgency: {data.get('urgency', 'ROUTINE')}\n"
                f"Status: PRE-REGISTERED\n"
                f"Patient ID: {pat.id}"
            )
        
        return response
        
    except Exception as e:
        return f"❌ Error: {str(e)}"


def run_reception(transcript: str) -> str:
    """
    STAGE 2: ARRIVAL - Check-In
    
    Processes reception conversations to update
    patient demographics and insurance info.
    """
    # Validate input
    valid, result = validate_transcript(transcript)
    if not valid:
        return result
    
    try:
        # Process with AI
        data = brain.process_ambient("RECEPTION", result)
        
        with get_session() as sop:
            pat = sop.query(Patient).filter(
                Patient.journey_stage == "PRE-REG"
            ).first()
            
            if not pat:
                return "⚠️ No pre-registered patient found. Complete phone intake first."
            
            pat.journey_stage = "CHECKED-IN"
            
            # Update demographics if provided
            if data.get('address'):
                pat.address = data['address']
            if data.get('insurance'):
                pat.insurance_payer = data['insurance']
            if data.get('phone'):
                pat.phone = data['phone']
            
            response = (
                f"✅ CHECK-IN COMPLETE\n"
                f"{'=' * 35}\n"
                f"Patient: {pat.first_name} {pat.last_name}\n"
                f"Status: {pat.journey_stage}\n"
                f"Address: {pat.address or 'Not updated'}\n"
                f"Insurance: {pat.insurance_payer or 'Not updated'}\n"
                f"Phone: {pat.phone or 'Not updated'}"
            )
        
        return response
        
    except Exception as e:
        return f"❌ Error: {str(e)}"


def run_clinical(transcript: str) -> Tuple[str, str]:
    """
    STAGE 3: EXAM ROOM - Clinical Encounter (Dr. Dollitle)
    
    Processes clinical transcripts to generate:
    - SOAP notes (ECW compatible)
    - CPOE lab/imaging orders
    - Billing codes
    """
    # Validate input
    valid, result = validate_transcript(transcript)
    if not valid:
        return result, "No orders generated."
    
    try:
        # Process with AI
        data = brain.process_ambient("CLINICAL", result)
        
        with get_session() as sop:
            # Find checked-in patient
            pat = sop.query(Patient).filter(
                Patient.journey_stage == "CHECKED-IN"
            ).first()
            
            if not pat:
                return "⚠️ No checked-in patient found.", "Complete check-in first."
            
            pat.journey_stage = "IN-EXAM"
            
            # Create encounter
            enc_id = f"ENC-{uuid.uuid4().hex[:6].upper()}"
            sop.add(Encounter(
                id=enc_id,
                patient_id=pat.id,
                type="CLINICAL",
                transcript=transcript,
                notes=data.get('soap', '')
            ))
            
            # Generate CPOE Orders
            orders_created = []
            for order in data.get('orders', []):
                test_name = order.get('test', 'Unknown Test')
                sop.add(LabOrder(
                    encounter_id=enc_id,
                    patient_id=pat.id,
                    test_name=test_name,
                    status="ORDERED"
                ))
                orders_created.append(test_name)
            
            # Generate Billing Claims
            claims_created = []
            for bill in data.get('billing', []):
                code = bill.get('code', '00000')
                value = bill.get('val', 0.0)
                sop.add(Claim(
                    encounter_id=enc_id,
                    code=code,
                    value=value,
                    status="QUEUED"
                ))
                claims_created.append(f"{code} (${value:.2f})")
            
            # Format outputs
            soap_note = data.get('soap', 'No SOAP note generated.')
            
            order_summary = (
                f"📋 ORDERS CREATED\n"
                f"{'=' * 35}\n"
                f"Tests: {', '.join(orders_created) if orders_created else 'None'}\n\n"
                f"💰 CLAIMS QUEUED\n"
                f"{'=' * 35}\n"
                f"Codes: {', '.join(claims_created) if claims_created else 'None'}"
            )
        
        return soap_note, order_summary
        
    except Exception as e:
        return f"❌ Error: {str(e)}", ""


def run_lab(transcript: str) -> str:
    """
    STAGE 4: LAB - Specimen Collection (Tech Drac)
    
    Processes lab technician audio to track
    which specimens have been collected.
    """
    # Validate input
    valid, result = validate_transcript(transcript)
    if not valid:
        return result
    
    try:
        with get_session() as sop:
            # Update patient stage
            pat = sop.query(Patient).filter(
                Patient.journey_stage == "IN-EXAM"
            ).first()
            
            if pat:
                pat.journey_stage = "IN-LAB"
            
            # Get pending orders for AI context
            pending_orders = sop.query(LabOrder).filter(
                LabOrder.status == "ORDERED"
            ).all()
            
            if not pending_orders:
                return "⚠️ No pending orders found."
            
            pending_names = [o.test_name for o in pending_orders]
            
            # Process with AI
            data = brain.process_ambient("LAB", result, current_data=pending_names)
            
            # Update collected orders
            updates = []
            for test_name in data.get('collected', []):
                order = sop.query(LabOrder).filter(
                    LabOrder.test_name == test_name,
                    LabOrder.status == "ORDERED"
                ).first()
                
                if order:
                    order.status = "COLLECTED"
                    order.specimen_id = uuid.uuid4().hex[:6].upper()
                    updates.append(
                        f"✅ {test_name}\n"
                        f"   Specimen ID: {order.specimen_id}\n"
                        f"   Status: COLLECTED"
                    )
            
            if not updates:
                return "⚠️ No matching orders were collected."
            
            response = (
                f"🧪 LAB COLLECTION COMPLETE\n"
                f"{'=' * 35}\n" +
                "\n".join(updates)
            )
        
        return response
        
    except Exception as e:
        return f"❌ Error: {str(e)}"


def run_billing_scrub() -> str:
    """
    STAGE 5: BILLING - Claim Scrubbing (Grimm)
    
    AI-powered claim audit for:
    - Bundling issues
    - Modifier requirements
    - ICD specificity
    """
    try:
        with get_session() as sop:
            claims = sop.query(Claim).filter(
                Claim.status == "QUEUED"
            ).all()
            
            if not claims:
                return "📭 No claims in queue."
            
            log_entries = []
            total_revenue = 0.0
            
            for claim in claims:
                # AI scrubs each claim
                data = brain.process_ambient(
                    "BILLING",
                    "",
                    current_data=f"{claim.code} (${claim.value:.2f})"
                )
                
                claim.status = "SUBMITTED"
                claim.ai_audit_note = data.get('note', '')
                claim.value = data.get('revenue', claim.value)
                total_revenue += claim.value
                
                log_entries.append(
                    f"Claim #{claim.id}: {claim.code}\n"
                    f"  Status: {claim.status}\n"
                    f"  Revenue: ${claim.value:.2f}\n"
                    f"  AI Note: {claim.ai_audit_note}"
                )
            
            response = (
                f"💀 BILLING SCRUB COMPLETE\n"
                f"{'=' * 35}\n" +
                "\n\n".join(log_entries) +
                f"\n\n{'=' * 35}\n"
                f"💰 TOTAL REVENUE: ${total_revenue:.2f}"
            )
        
        return response
        
    except Exception as e:
        return f"❌ Error: {str(e)}"


def get_journey_status() -> str:
    """Get the current patient journey status."""
    try:
        with get_session() as sop:
            # Get most recently updated patient
            pat = sop.query(Patient).order_by(
                Patient.id.desc()
            ).first()
            
            if pat:
                return f"{pat.journey_stage}"
            return "NO PATIENT"
    except Exception as e:
        return f"ERROR: {str(e)}"


def get_system_info() -> str:
    """Get system status information."""
    status = brain.get_status()
    return (
        f"AI Mode: {status.get('mode', 'UNKNOWN')}\n"
        f"Model: {status.get('model', 'N/A')}\n"
        f"Active: {status.get('active', False)}"
    )


# --- GRADIO UI ---

theme = gr.themes.Soft(
    primary_hue="emerald",
    secondary_hue="blue",
    neutral_hue="slate"
)

with gr.Blocks(theme=theme, title="True AI EHR") as app:
    
    # Header
    with gr.Row(variant="panel"):
        with gr.Column(scale=3):
            gr.Markdown("# 🏥 True AI EHR")
            gr.Markdown("**Voice-Driven Healthcare Workflow: Phone → Bill**")
        with gr.Column(scale=1):
            status_banner = gr.Textbox(
                label="Patient Journey",
                value="WAITING...",
                interactive=False,
                max_lines=1
            )
            btn_refresh = gr.Button("🔄 Refresh", size="sm")
            btn_refresh.click(get_journey_status, None, status_banner)

    # Workflow Tabs
    with gr.Tabs():
        
        # TAB 1: PHONE
        with gr.Tab("1. 📞 Phone"):
            gr.Markdown("### Automated Phone Pre-Registration")
            gr.Markdown("*AI extracts patient info and chief complaint from call transcript.*")
            phone_in = gr.Textbox(
                label="Call Transcript",
                placeholder="Enter phone call transcript...",
                value="Hi, this is Bruce. I hurt my arm at work. I need to come in today.",
                lines=3
            )
            btn_phone = gr.Button("Process Call", variant="primary")
            phone_out = gr.Code(label="System Response", language=None)
            btn_phone.click(run_phone_intake, phone_in, phone_out)

        # TAB 2: RECEPTION
        with gr.Tab("2. 🏢 Reception"):
            gr.Markdown("### Ambient Check-In")
            gr.Markdown("*AI updates demographics from reception conversation.*")
            rec_in = gr.Textbox(
                label="Check-In Transcript",
                placeholder="Enter reception conversation...",
                value="Hi, checking in for my appointment. I moved recently - new address is 1007 Mountain Drive.",
                lines=3
            )
            btn_rec = gr.Button("Process Check-In", variant="primary")
            rec_out = gr.Code(label="Registration Updates", language=None)
            btn_rec.click(run_reception, rec_in, rec_out)

        # TAB 3: CLINICAL
        with gr.Tab("3. 🩺 Exam Room"):
            gr.Markdown("### Clinical Encounter (Dr. Dollitle)")
            gr.Markdown("*AI generates SOAP note, orders, and billing codes.*")
            clin_in = gr.Textbox(
                label="Clinical Transcript",
                placeholder="Enter exam room conversation...",
                value="Bruce, let me examine that arm. I see significant swelling in the left forearm. I'm ordering an X-Ray and a CBC to check for any issues. We'll bill this as a Level 4 visit.",
                lines=4
            )
            btn_clin = gr.Button("Sign Note", variant="primary")
            with gr.Row():
                note_out = gr.Textbox(
                    label="SOAP Note (ECW Compatible)",
                    lines=6,
                    interactive=False
                )
                ord_out = gr.Code(label="Orders & Claims", language=None)
            btn_clin.click(run_clinical, clin_in, [note_out, ord_out])

        # TAB 4: LAB
        with gr.Tab("4. 🧪 Lab"):
            gr.Markdown("### Specimen Collection (Tech Drac)")
            gr.Markdown("*AI tracks specimen collection from lab audio.*")
            lab_in = gr.Textbox(
                label="Lab Transcript",
                placeholder="Enter lab conversation...",
                value="Drawing the CBC now. Patient is heading to radiology for the X-Ray.",
                lines=3
            )
            btn_lab = gr.Button("Process Collection", variant="primary")
            lab_out = gr.Code(label="Collection Status", language=None)
            btn_lab.click(run_lab, lab_in, lab_out)

        # TAB 5: BILLING
        with gr.Tab("5. 💀 Billing"):
            gr.Markdown("### Revenue Cycle (Grimm)")
            gr.Markdown("*AI scrubs claims for compliance before submission.*")
            gr.Markdown("Click below to process all queued claims.")
            btn_scrub = gr.Button("Summon Grimm (Scrub Claims)", variant="primary")
            scrub_out = gr.Code(label="Scrub Log", language=None)
            btn_scrub.click(run_billing_scrub, None, scrub_out)

    # Footer / System Info
    with gr.Accordion("ℹ️ System Status", open=False):
        btn_info = gr.Button("Refresh System Info")
        info_out = gr.Code(label="Status", language=None)
        btn_info.click(get_system_info, None, info_out)
        gr.Markdown(
            "*True AI EHR - Ambient Healthcare Workflow System*"
        )


# --- MAIN ---

if __name__ == "__main__":
    print("\n🚀 Launching True AI EHR...")
    print("📍 Open http://localhost:7860 in your browser\n")
    
    app.launch(
        server_name="0.0.0.0",
        server_port=7860,
        show_error=True
    )
