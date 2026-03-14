# Impact Medicine EHR

AI-powered Electronic Health Record system with ambient voice processing.

## Subsystems

### Clinical Workflow (Node.js)
Full-stack React + Express application for clinical encounters.

```bash
npm install
npm run dev              # React frontend
node server/server.js    # Express API
```

- React SPA: Check-in, MA, Encounter, Review, Checkout
- Express API: patients, encounters, vitals, CDS, audit logging
- SQLite3 database with WAL mode
- Claude API for clinical data extraction and SOAP notes
- HIPAA-compliant audit trail

### Ambient AI (Python)
Voice-driven 5-stage workflow powered by Google Gemini.

```bash
cd ambient
pip install -r requirements.txt
python app.py            # Gradio UI on :7860
```

- Phone intake, reception, clinical SOAP/CPOE, lab tracking, billing scrub
- Runs in simulation mode without API key
- ECW-compatible output sanitization

See [ambient/README.md](ambient/README.md) for details.

## Configuration

Copy `.env.example` to `.env` and set your API keys:

```bash
cp .env.example .env
```

## Documentation

- [Architecture overview](docs/architecture.md)
- [Master blueprint specification](docs/blueprint.md)
