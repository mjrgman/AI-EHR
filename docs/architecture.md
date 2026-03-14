# Impact Medicine EHR - Architecture

## Two-Layer System

The EHR consists of two independent subsystems that can run separately or together:

### Layer 1: Clinical Workflow (Node.js)
- **Frontend:** React SPA with multi-step workflow (Check-in → MA → Encounter → Review → Checkout)
- **Backend:** Express.js API with SQLite3 database
- **AI:** Claude API for clinical data extraction and SOAP note generation
- **Features:** CDS engine, HIPAA audit logging, voice input, provider learning

### Layer 2: Ambient AI (Python)
- **UI:** Gradio web interface with 5 workflow tabs
- **AI:** Google Gemini for ambient voice-to-structured-data processing
- **Features:** Phone intake, reception check-in, clinical SOAP/CPOE, lab tracking, billing scrub
- **Database:** SQLAlchemy ORM with dual-repository pattern (operational + analytical)

## How They Relate

Both layers address the same clinical workflow but at different levels:

| Stage | Node.js Layer | Python Ambient Layer |
|-------|--------------|---------------------|
| Check-in | CheckInPage with form inputs | Reception tab with voice processing |
| Clinical | EncounterPage with CDS suggestions | Clinical tab with SOAP + CPOE from audio |
| Lab | (via API endpoints) | Lab tab with specimen tracking from audio |
| Billing | (future) | Billing tab with AI claim scrubbing |

## Future Integration

The Python `EnterpriseBrain` can be wrapped as a FastAPI service, allowing the Node.js frontend to call it for ambient processing. The Gradio UI then becomes a dev/demo tool.

```
[React SPA] → [Express API] → [FastAPI Bridge] → [EnterpriseBrain]
                    ↓                                    ↓
              [SQLite3 DB]                    [SQLAlchemy DB]
```

## Running Both

```bash
# Terminal 1: Node.js EHR
npm run dev          # Frontend on :5176
node server/server.js # API on :3000

# Terminal 2: Ambient AI
cd ambient
python app.py        # Gradio on :7860
```
