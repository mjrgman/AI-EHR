# Ambient AI Layer

Voice-driven 5-stage clinical workflow powered by Google Gemini AI.

## Stages

1. **Phone** - Pre-registration from incoming calls
2. **Reception** - Ambient check-in (address, insurance updates)
3. **Clinical** - SOAP note generation + CPOE orders from doctor-patient dialogue
4. **Lab** - Specimen collection tracking from technician audio
5. **Billing** - AI-powered claim scrubbing and revenue cycle management

## Setup

```bash
cd ambient
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

## Configuration

Copy `.env.example` from the repo root and set your Gemini API key:

```
GEMINI_API_KEY=your-key-here
```

Without a key, the app runs in **simulation mode** with realistic mock data.

## Run

```bash
python app.py
```

Opens at http://localhost:7860

## Architecture

- `app.py` - Gradio UI with 5 workflow tabs
- `intelligence.py` - `EnterpriseBrain` class (Gemini AI with ECW-compatible output sanitization)
- `database.py` - SQLAlchemy ORM (Patient, Encounter, LabOrder, Claim)
