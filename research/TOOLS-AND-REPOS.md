# AI-Native EHR: Essential Tools, Libraries, and GitHub Repositories

**Last Updated:** March 22, 2026

Quick reference guide for developers building AI-native EHR systems and multi-agent clinical workflows.

---

## Voice / Speech-to-Text (ASR)

### Cloud APIs (Production-Grade)

| Tool | Specialization | Latency | Medical Accuracy | HIPAA | Cost |
|------|---|---|---|---|---|
| **AssemblyAI** | Medical transcription, speaker diarization | 300ms | Excellent (16.7% entity miss rate) | Yes, BAA available | ~$0.025/min |
| **Deepgram Nova-3 Medical** | Medical domain, WER optimization | <300ms | Excellent (5.8% WER) | Yes, BAA available | Custom pricing |
| **OpenAI Whisper Large-v3** | General + medical terminology | Variable | Good (10-20% improvement over v2) | Self-hosted only | Free (self-hosted) |
| **AWS Transcribe Medical** | AWS ecosystem integration | Variable | Good (HIPAA-eligible) | Yes, AWS BAA | $0.075/min |
| **Gladia** | Real-time with diarization | 103ms partial | Good | Yes, BAA | Custom |
| **Soniox** | Healthcare focus, real-time | <300ms | Excellent | Yes, BAA | Custom |

### Open-Source (Self-Hosted)

- **OpenAI Whisper** ([GitHub](https://github.com/openai/whisper)): Open-source ASR, self-hosted, no API fees. Requires GPU for acceptable inference speed.
- **Faster-Whisper** ([GitHub](https://github.com/guillaumekln/faster-whisper)): Optimized Whisper inference (4-5x faster).

**Recommendation for MVP:** Start with Whisper (free, self-hosted) or AssemblyAI (managed, medical-tuned).

---

## Clinical NLP and Text Processing

### Python Libraries (Production)

| Tool | Purpose | GitHub | Best For |
|------|---------|--------|----------|
| **medspaCy** | Clinical NLP with spaCy | [medspacy](https://github.com/medspacy/medspacy) | Section detection, negation, context |
| **MedaCy** | Medical text mining | [medaCy](https://github.com/NLPatVCU/medaCy) | Rapid prototyping of medical NLP |
| **ScispaCy** | Biomedical NLP | [scispacy](https://github.com/allenai/scispacy) | Medical literature, biomedical documents |
| **Spark NLP** | Scalable NLP | [spark-nlp](https://github.com/JohnSnowLabs/spark-nlp) | Large-scale batch clinical text |
| **cTAKES** | Clinical extraction | [cTAKES](https://github.com/apache/ctakes) | UMLS normalization, negation detection |
| **Flair** | Deep learning NLP | [flair](https://github.com/flairNLP/flair) | Named entity recognition, sequence tagging |

**Recommendation for MVP:** Use medspaCy + OpenAI API (or Claude) for summarization pipelines. Most straightforward.

---

## Large Language Models for Healthcare

### Open-Source Medical LLMs

| Model | Size | Focus | GitHub |
|-------|------|-------|--------|
| **Meditron-70B** | 70B params | Clinical knowledge | [meditron](https://github.com/epfLLM/meditron) |
| **ClinicalBERT** | BERT-sized | Clinical text mining | [ClinicalBERT](https://github.com/EmilyAlsentzer/clinicalBERT) |
| **Med-PaLM 2** | 540B+ | Medical reasoning | Research only (not open-source) |
| **LLaMA 3 (medical fine-tune)** | 7B–70B | Medical domain | Various community forks |

### Proprietary (Recommended)

- **OpenAI GPT-4o:** Best overall quality, supports vision. Requires BAA for PHI.
- **Anthropic Claude 3.5 Sonnet:** Strong reasoning, long context (200K tokens). Requires BAA for PHI.
- **Google Gemini Medical:** Emerging medical variant.

**Recommendation:** Use Meditron-70B for fine-tuning on proprietary clinical data; use GPT-4o/Claude for general-purpose reasoning and RAG.

---

## Multi-Agent Frameworks

### Core Frameworks

| Framework | Best For | GitHub | Maturity |
|-----------|----------|--------|----------|
| **CrewAI** | Role-based workflows, clinical teams | [crewai](https://github.com/joaomdmoura/crewai) | Production-ready |
| **AutoGen** | Research, human-in-the-loop | [AutoGen](https://github.com/microsoft/autogen) | Production-ready |
| **LangGraph** | Complex workflows, state machines | [langgraph](https://github.com/langchain-ai/langgraph) | Production-ready |
| **OpenAI Swarm** | Lightweight multi-agent | [swarm](https://github.com/openai/swarm) | Early access |

**Recommendation for EHR:** Start with CrewAI for hierarchical clinical workflows (chart review → assessment → coding). Use LangGraph for complex state-dependent logic.

### Example CrewAI Architecture for Pre-Visit

```python
# Agents
chart_review_agent = Agent(role="Chart Reviewer", tools=[fhir_reader, ehr_connector])
data_agent = Agent(role="Data Aggregator", tools=[lab_fetcher, imaging_fetcher])
summary_agent = Agent(role="Summarizer", tools=[llm_summarize])
risk_agent = Agent(role="Risk Identifier", tools=[hcc_classifier])

# Crew
pre_visit_crew = Crew(
    agents=[chart_review_agent, data_agent, summary_agent, risk_agent],
    tasks=[...],  # Sequential or hierarchical execution
    process=Process.HIERARCHICAL  # or SEQUENTIAL
)
```

---

## RAG (Retrieval-Augmented Generation) for Healthcare

### Framework Choices

| Framework | Focus | GitHub | Best For |
|-----------|-------|--------|----------|
| **LangChain** | Orchestration, multi-step workflows | [langchain](https://github.com/langchain-ai/langchain) | Document summarization, Q&A |
| **LlamaIndex** | Vector indexing, retrieval | [llama_index](https://github.com/run-llama/llama_index) | Large document collections |
| **HayStack** | Production NLP pipelines | [haystack](https://github.com/deepset-ai/haystack) | Document retrieval + ranking |

### Vector Databases

| Database | Open-Source | Healthcare-Ready | Scalability |
|----------|---|---|---|
| **Pinecone** | No (managed) | Yes | Cloud-native |
| **Weaviate** | Yes | Yes | Distributed |
| **Chroma** | Yes | Yes | Lightweight (local) |
| **FAISS** | Yes (Meta) | Yes | Batch/offline indexing |
| **Milvus** | Yes | Yes | Distributed, cloud |

**Recommendation:** Use LangChain (orchestration) + Weaviate (vector DB) + OpenAI embeddings. Open-source + production-ready.

---

## FHIR and Interoperability

### FHIR Standards and Tools

| Tool | Purpose | GitHub/Link |
|------|---------|-------------|
| **FHIR Specification** | Healthcare data standards | [hl7.org/fhir](https://www.hl7.org/fhir/) |
| **HAPI FHIR** | Java FHIR server | [hapifhir](https://github.com/hapifhir/hapi-fhir) |
| **SMART on FHIR** | App launch & authorization | [smart-on-fhir](https://docs.smarthealthit.org/) |
| **FHIR Python Client** | Python FHIR API wrapper | [fhir-py](https://github.com/1mg/fhir-py) |
| **Google Cloud Healthcare API** | Managed FHIR service | [GCP Healthcare](https://cloud.google.com/healthcare) |

### Integration Pattern (Python)

```python
from fhirpy import AsyncFHIRClient

client = AsyncFHIRClient(
    url="https://epic-fhir-endpoint.com/fhir/r4",
    authorization="Bearer token"
)

# Fetch patient
patient = await client.resources("Patient").fetch_by_id(patient_id)

# Fetch encounters
encounters = await client.resources("Encounter").search(patient=patient_id).fetch_all()

# Fetch observations (vitals, labs)
observations = await client.resources("Observation").search(patient=patient_id).fetch_all()
```

---

## E&M Coding Automation

### Libraries & Tools

| Tool | Approach | GitHub |
|------|----------|--------|
| **CodeEMR NLP** | MDM extraction + coding classification | Commercial |
| **EHR-native tools** | Epic native E&M coding suggestions | Epic marketplace |
| **Custom LLM pipeline** | Fine-tuned LLM for MDM classification | Build with: LangChain + medical LLM |

### Example MDM Classification (LLM-based)

```python
mdm_prompt = """
Analyze the clinical note and classify MDM level (straightforward, low, moderate, high).
Justify based on:
1. Problem complexity (number, severity of conditions)
2. Data review (amount and complexity of data reviewed)
3. Risk (risk of adverse outcomes)

Note: {clinical_note}

Return: JSON with mdm_level, problem_complexity, data_review_complexity, risk_level, justification
"""

mdm_result = llm.invoke(mdm_prompt)  # Use GPT-4, Claude, etc.
cpt_code = map_mdm_to_cpt(mdm_result["mdm_level"])
```

---

## HIPAA Compliance and Security

### De-Identification Tools

| Tool | Approach | HIPAA Safe Harbor |
|------|----------|---|
| **iMerit** | AI + human oversight | Yes |
| **BigID** | PII discovery & classification | Indirect |
| **Privacy Analytics by IQVIA** | Statistical de-identification | Expert Determination |
| **Amnesia** | Structural anonymization | Yes (open-source) |
| **Protecto AI** | Privacy-preserving ML | Yes |

### BAA-Compliant AI Services

- **AssemblyAI:** Yes, BAA available.
- **Deepgram:** Yes, BAA available.
- **AWS Healthcare (Transcribe Medical, Textract):** Yes, AWS BAA.
- **OpenAI API:** Case-by-case BAA (enterprise customers).
- **Anthropic Claude:** Case-by-case BAA (enterprise customers).
- **Google Cloud Healthcare API:** Yes, GCP BAA.

### Encryption & Access Control

```python
# Example: Encrypting PHI at rest (AES-256)
from cryptography.fernet import Fernet

key = Fernet.generate_key()
cipher = Fernet(key)
phi_encrypted = cipher.encrypt(phi_bytes)

# Example: Role-based access (mock)
@require_role("clinician")
@require_patient_access(patient_id)
def get_patient_ehr(patient_id):
    return ehr_database.fetch(patient_id)
```

---

## Clinical Decision Support and Provider Preferences

### Order Recommendation Systems

| Approach | Tools | GitHub |
|----------|-------|--------|
| **Collaborative Filtering** | scikit-surprise, implicit | [implicit](https://github.com/benfred/implicit) |
| **Neural Collaborative Filtering** | PyTorch, TensorFlow | Custom |
| **Knowledge Graph** | Neo4j + embeddings | [neo4j-python](https://github.com/neo4j/neo4j-python-driver) |

### Example Order Recommender (Lightweight)

```python
import pandas as pd
from sklearn.decomposition import NMF

# Historical orders: rows = providers, cols = procedures/meds
orders_matrix = pd.read_csv("provider_orders.csv")

# NMF factorization
model = NMF(n_components=50)
provider_factors = model.fit_transform(orders_matrix)
item_factors = model.components_.T

# Recommend for new encounter
provider_embedding = provider_factors[provider_id]
recommendations = (provider_embedding @ item_factors.T).argsort()[-10:]
```

---

## Repository Collections and Awesome Lists

### Curated Resource Lists (GitHub)

- **Awesome Healthcare** ([GitHub](https://github.com/kakoni/awesome-healthcare)): Comprehensive healthcare software and libraries.
- **Awesome AI Agents for Healthcare** ([GitHub](https://github.com/AgenticHealthAI/Awesome-AI-Agents-for-Healthcare)): Agentic AI papers, projects, and resources.
- **Healthcare ML** ([GitHub](https://github.com/isaacmg/healthcare_ml)): Curated ML/NLP resources.
- **Awesome Healthcare Datasets** ([GitHub](https://github.com/geniusrise/awesome-healthcare-datasets)): Open healthcare datasets for AI/ML.
- **MedLLMs Practical Guide** ([GitHub](https://github.com/AI-in-Health/MedLLMsPracticalGuide)): Medical LLMs application guide (Nature Reviews).

---

## Complete AI-Native EHR Tech Stack (Recommended MVP)

### Core Components

**Speech-to-Text & Ambient Documentation**
- **Primary:** AssemblyAI API (medical-tuned, 300ms latency, HIPAA BAA).
- **Alternative (self-hosted):** OpenAI Whisper + Faster-Whisper.

**Clinical NLP Pipeline**
- **Text Processing:** medspaCy (section detection, negation, context).
- **Entity Extraction:** medspaCy + scnlp for biomedical named entities.
- **Summarization:** LangChain + GPT-4o or Claude 3.5.

**Multi-Agent Orchestration**
- **Framework:** CrewAI (hierarchical workflows) or LangGraph (complex state logic).
- **Agents:**
  - Chart Review Agent (FHIR/EHR reader).
  - Data Aggregation Agent (lab/imaging fetcher).
  - Summarization Agent (NLP + LLM).
  - Risk/HCC Agent (classifier).
  - Coding Agent (E&M MDM classifier).

**RAG for Clinical Knowledge**
- **Orchestration:** LangChain.
- **Vector DB:** Weaviate or Chroma.
- **Embeddings:** OpenAI `text-embedding-3-large` or open-source embeddings.

**FHIR Interoperability**
- **Standard:** FHIR R4.
- **Client Library:** fhir-py (Python) or HAPI FHIR (Java).
- **Authorization:** OAuth 2.0 for SMART on FHIR.

**HIPAA Compliance**
- **Encryption:** AES-256 at rest (cryptography library).
- **TLS:** 1.2+ for data in transit.
- **Access Control:** Role-based (custom middleware).
- **Logging:** Audit trail for all PHI access.

### Technology Stack Summary

```
Frontend: React + TypeScript
Backend: FastAPI (Python) or Node.js
Database: PostgreSQL (EHR data) + Weaviate (vector DB)
ASR: AssemblyAI API
NLP: medspaCy + LangChain
LLM: GPT-4o / Claude 3.5 + Meditron-70B (fine-tuned)
Multi-Agent: CrewAI
FHIR: fhir-py + SMART on FHIR
Auth: OAuth 2.0
Logging: ELK stack or AWS CloudWatch
Security: HashiCorp Vault (secrets management)
Deployment: Docker + Kubernetes
```

---

## Quick Start Commands

### Install Core Libraries

```bash
# Speech recognition
pip install assemblyai

# Clinical NLP
pip install medspacy scispacy spacy

# RAG
pip install langchain langchain-openai weaviate-client

# Multi-agent
pip install crewai

# FHIR
pip install fhir-py

# LLM
pip install openai anthropic
```

### Create Your First Medical RAG Pipeline

```python
from langchain.document_loaders import UnstructuredFileLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain.embeddings import OpenAIEmbeddings
from langchain.vectorstores import Weaviate
from langchain.chains import RetrievalQA
from langchain.chat_models import ChatOpenAI

# Load clinical documents
loader = UnstructuredFileLoader("patient_notes.txt")
docs = loader.load()

# Split into chunks
splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
splits = splitter.split_documents(docs)

# Embed and store in Weaviate
embeddings = OpenAIEmbeddings(model="text-embedding-3-large")
vectorstore = Weaviate.from_documents(splits, embeddings)

# Create QA chain
llm = ChatOpenAI(model="gpt-4", temperature=0)
qa_chain = RetrievalQA.from_chain_type(llm, retriever=vectorstore.as_retriever())

# Query
result = qa_chain.run("Summarize the patient's medications and allergies")
```

---

## Recommended Reading and Research

### Key Papers and Resources

1. **Multiagent AI Systems in Health Care** - PMC/MDEDGE (2024+)
2. **Retrieval-Augmented Generation for LLMs in Healthcare** - PLOS Digital Health (2024)
3. **Prospects for AI Clinical Summarization** - Frontiers in Digital Health (2024)
4. **SMART on FHIR Standards-Based Interoperability** - PMC/Journal of Medical Internet Research
5. **ClinicNet: Machine Learning for Personalized Order Set Recommendations** - JAMIA Open

### Websites and Documentation

- FHIR Standard: https://www.hl7.org/fhir/
- SMART on FHIR: https://docs.smarthealthit.org/
- CrewAI Docs: https://docs.crewai.com/
- LangChain Docs: https://docs.langchain.com/
- AssemblyAI Medical Docs: https://docs.assemblyai.com/

---

**End of Tools and Repos Document**
