# Paperclip Setup Report — ImpactMed Consulting

**Date:** March 28, 2026
**Instance:** localhost:3100
**Company:** ImpactMed Consulting (IMP)

---

## Projects (6 total)

| Project | Repo | Local Folder | Goal Linked | Issues |
|---------|------|-------------|-------------|--------|
| The Lab (CATC) | github.com/mjrgman/THE_LAB | C:\Users\micha\files\THE_LAB | Launch CATC AI Lab Pilot Program | 3 |
| AI Book | — | C:\Users\micha\files\Documents\AI book\ACTIVE | Publish on Amazon KDP | 4 |
| AI-EHR | github.com/mjrgman/AI-EHR | C:\Users\micha\files\EHR | Deploy AI-EHR v1.0 to Production | 2 |
| Substack | — | C:\Users\micha\files\substack | Establish Online Presence | 2 |
| Website | — | C:\Users\micha\files\Website | Establish Online Presence | 2 |
| Onboarding | — | Paperclip-managed | — | 0 |

## Issues (14 total)

| ID | Title | Project | Priority |
|----|-------|---------|----------|
| IMP-6 | Complete v14.7 final editorial pass and publish-ready audit | AI Book | Critical |
| IMP-2 | Deploy AI-EHR v1.0 to production environment | AI-EHR | High |
| IMP-14 | Implement AI-assisted clinical documentation module | AI-EHR | High |
| IMP-11 | Set up Substack newsletter and publish first post | Substack | High |
| IMP-12 | Launch ImpactMed Consulting website v1.0 | Website | High |
| IMP-7 | Reconcile all 102 Chicago endnotes across 15 chapters | AI Book | Medium |
| IMP-4 | Design CATC AI Lab curriculum and physician training program | The Lab | Medium |
| IMP-9 | Build book launch marketing plan and GAFP presentation | AI Book | Medium |
| IMP-8 | Finalize book cover design and Amazon KDP listing | AI Book | Medium |
| IMP-5 | Establish GAFP partnership and pilot recruitment | The Lab | Medium |
| IMP-3 | Build CATC website and onboarding portal | The Lab | Medium |
| IMP-13 | Create book landing page with pre-order and KDP links | Website | Medium |
| IMP-10 | Build content calendar for Substack (Q2-Q3 2026) | Substack | Medium |
| IMP-1 | Hire your first engineer and create a hiring plan | Onboarding | — |

## Goals (5 total)

| Goal | Status | Linked Projects |
|------|--------|----------------|
| Publish Revolutionizing Healthcare with AI on Amazon KDP | Planned | AI Book |
| Launch CATC AI Lab Pilot Program | Planned | The Lab |
| Deploy AI-EHR v1.0 to Production | Planned | AI-EHR |
| Establish ImpactMed Consulting Online Presence | Planned | Website, Substack |
| Build Autonomous AI Agent Workforce | Planned | — |

## Agents (3 total)

| Agent | Role | Model | Reports To | Status | Instructions |
|-------|------|-------|-----------|--------|-------------|
| Liz | CEO | claude-opus-4-6 | Dr. Renner (you) | Idle | AGENTS.md written |
| CTO | CTO | claude-sonnet-4-6 | Liz | Approved | AGENTS.md written |
| HAL | Engineer | claude-sonnet-4-6 | Liz | Idle | AGENTS.md written |

## Org Chart

```
Dr. Michael Renner (Founder/Owner)
└── Liz (CEO — Claude Opus 4.6)
    ├── CTO (Chief Technology Officer — Claude Sonnet 4.6)
    └── HAL (AI Systems Engineer — Claude Sonnet 4.6)
```

## Agent Job Descriptions Written

Each agent has a full AGENTS.md instruction file at:
`C:\Users\micha\.paperclip\instances\default\companies\{companyId}\agents\{agentId}\instructions\AGENTS.md`

Contents include: Identity, Responsibilities, Decision Authority, Project/Repo Assignments, Communication Style, Rules (including Project Whistle firewall, manuscript protections, CATC scope).

## GitHub Repos Not Yet in Paperclip

These repos exist under mjrgman but don't have dedicated projects:

| Repo | Notes |
|------|-------|
| mjrgman/program | Data processing, automation scripts — could be added as utility project |
| mjrgman/ai-partnership-lab | Made private — could be folded into The Lab |
| mjrgman/renner-ai-vault | Knowledge vault — managed by HAL |
| mjrgman/healthcare-ai-textbook-mcp | Book MCP server — managed by HAL |
| mjrgman/HALExtension | HAL's namesake — could get its own project |

## Actions Taken This Session

1. Audited existing Paperclip state (4 projects, 9 issues, 2 agents, 0 goals)
2. Created Substack project with local folder and 2 issues
3. Created Website project with local folder and 2 issues
4. Created 1 additional AI-EHR issue (clinical documentation module)
5. Created HAL agent (claude-sonnet-4-6, engineer role)
6. Created 5 company goals and linked them to projects
7. Renamed CEO agent from "CEO" to "Liz"
8. Wrote full AGENTS.md job descriptions for Liz, CTO, and HAL
9. Set org chain: CTO → Liz, HAL → Liz
10. Approved CTO agent (was pending board approval)
11. Disabled "require board approval for new agents" setting

## Remaining Items for Michael

- **CTO needs instructions verified** — check Instructions tab to confirm AGENTS.md loaded
- **5 GitHub repos** not yet in Paperclip (see table above) — add if desired
- **Liz is live** — she started running after the CTO approval
- **Project statuses** all show "backlog" — update to "active" as work begins
