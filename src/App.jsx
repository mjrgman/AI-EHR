import React, { useState, useEffect, useMemo, useRef } from 'react';
import { PATIENT, AGENTS, CDS, SOAP_DRAFT, PATIENT_VOICE, TRANSCRIPT } from './data.js';

// ============================================================
// Tweaks (defaults persisted via host)
// ============================================================
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "agentPanel": "right",
  "voiceMode": "ribbon",
  "density": "comfortable",
  "theme": "default",
  "specialty": "primary",
  "page": "encounter"
}/*EDITMODE-END*/;

function useTweaks() {
  const [t, setT] = useState(TWEAK_DEFAULTS);
  function set(k, v) {
    setT((prev) => {
      const next = typeof k === "object" ? { ...prev, ...k } : { ...prev, [k]: v };
      try { window.parent.postMessage({ type: "__edit_mode_set_keys", edits: typeof k === "object" ? k : { [k]: v } }, "*"); } catch (e) {}
      return next;
    });
  }
  return [t, set];
}

// ============================================================
// Top bar + nav
// ============================================================
function TopBar({ page, setPage, onConsent, onGear }) {
  const items = [
    ["dashboard", "Dashboard"],
    ["pre", "Pre-Visit"],
    ["encounter", "Encounter"],
    ["review", "Review & Sign"],
    ["patient", "Patient chart"],
    ["variations", "Layouts"],
  ];
  return (
    <div className="topbar">
      <div className="topbar__brand">
        <span className="ring" />
        AI-EHR <small>MJR</small>
      </div>
      <nav className="topbar__nav">
        {items.map(([k, l]) => (
          <a key={k} className={page === k ? "is-active" : ""} onClick={() => setPage(k)}>{l}</a>
        ))}
      </nav>
      <div className="topbar__right">
        <button className="btn btn--gold" onClick={onConsent} style={{borderRadius:4}}>Ambient Scribe</button>
        <button className="btn btn--ghost" onClick={onGear} style={{color:"var(--mc-ivory)"}}>Display</button>
        <div className="topbar__user">
          <div className="avatar">JR</div>
          <div>
            <div style={{fontWeight:600}}>J. Reyes, MD</div>
            <div style={{opacity:.7, fontSize:10}}>Internal Medicine · Attending</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PatientBanner({ p }) {
  return (
    <div className="banner">
      <div>
        <div className="banner__id">
          <div className="banner__name">{p.name}</div>
          <div className="banner__sub">
            <span>{p.age} {p.sex}</span>
            <span>{p.pronouns}</span>
            <span>DOB {p.dob}</span>
            <span>MRN {p.id}</span>
            <span>PCP {p.pcp}</span>
            <span>{p.insurance}</span>
          </div>
        </div>
        <div className="banner__chips">
          <span className="chip chip--ink">HTN · controlled</span>
          <span className="chip chip--ink">T2DM · A1c {p.labs.find(l=>l.name==="HbA1c").value}%</span>
          <span className="chip chip--ink">OA bilat. knees</span>
          <span className="chip chip--soft">Hyperlipidemia</span>
          {p.allergies.map(a => <span key={a.name} className="chip chip--alert">Allergy: {a.name}</span>)}
          <span className="chip chip--soft">+ TRT · {p.trt.yearsOn}y</span>
          <span className="chip chip--soft">+ GLP-1 · {p.glp1.weeks}w</span>
        </div>
      </div>
      <div className="banner__meta">
        <div className="banner__metric"><span className="label">BP</span><span className="value">{p.vitals.bp}</span><span className="delta">today · controlled</span></div>
        <div className="banner__metric"><span className="label">A1c</span><span className="value">6.1%</span><span className="delta delta--down">from 8.4 (2019)</span></div>
        <div className="banner__metric"><span className="label">LDL</span><span className="value">88</span><span className="delta delta--down">at goal</span></div>
        <div className="banner__metric"><span className="label">BMI</span><span className="value">{p.bmi}</span><span className="delta delta--down">from {p.bmiStart}</span></div>
      </div>
    </div>
  );
}

function WorkStrip() {
  const steps = [
    ["Check-in", "done"],
    ["Vitals", "done"],
    ["Pre-visit", "done"],
    ["Encounter", "current"],
    ["Review", ""],
    ["Sign", ""],
    ["Check-out", ""],
  ];
  return (
    <div className="workstrip">
      <span className="eyebrow" style={{marginRight:8}}>Workflow</span>
      {steps.map(([n, s], i) => (
        <React.Fragment key={n}>
          <div className={`workstrip__step ${s === "done" ? "is-done" : ""} ${s === "current" ? "is-current" : ""}`}>
            <span className="dot" />{n}
          </div>
          {i < steps.length - 1 && <span className="workstrip__sep" />}
        </React.Fragment>
      ))}
      <span style={{flex:1}} />
      <span style={{fontSize:11, color:"var(--mc-text-subtle)"}}>Encounter 00:14:22 · auto-saved</span>
    </div>
  );
}

// ============================================================
// Left column: patient summary
// ============================================================
function LeftSummary({ p }) {
  return (
    <div className="col col--left">
      <h4 className="section">Active problems</h4>
      {p.problems.map(pr => (
        <div key={pr.icd10} className="line">
          <div style={{fontWeight:600, color:"var(--mc-navy)"}}>{pr.name}</div>
          <div className="meta mono">{pr.icd10} · since {pr.since}{pr.note ? ` · ${pr.note}` : ""}</div>
        </div>
      ))}
      <h4 className="section" style={{marginTop:18}}>Medications</h4>
      {p.medications.map(m => (
        <div key={m.name} className="line">
          <div style={{fontWeight:600, color:"var(--mc-navy)"}}>{m.name} <span style={{color:"var(--mc-text-muted)", fontWeight:400}}>{m.dose}</span></div>
          <div className="meta">{m.route} · {m.freq} · <span className="eyebrow" style={{fontSize:9}}>{m.class}</span></div>
        </div>
      ))}
      <h4 className="section" style={{marginTop:18}}>Allergies</h4>
      {p.allergies.map(a => (
        <div key={a.name} className="line danger">
          <div style={{fontWeight:600}}>{a.name}</div>
          <div className="meta">{a.reaction} · {a.severity}</div>
        </div>
      ))}
      <h4 className="section" style={{marginTop:18}}>Recent visits</h4>
      {p.history.slice(0,4).map(h => (
        <div key={h.date} className="line">
          <div style={{fontWeight:600, fontSize:12}}>{h.type} <span style={{color:"var(--mc-text-muted)", fontWeight:400}}>· {h.date}</span></div>
          <div className="meta">{h.note}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Right column: agents + advisories
// ============================================================
function AgentRow({ a, expanded, onToggle }) {
  const initials = { phone_triage:"PT", front_desk:"FD", ma:"MA", physician_pre:"MD", scribe:"SC", cds:"DS", orders:"OR", coding:"CO", quality:"QA" }[a.key] || "AI";
  const status = {
    live:"is-live", review_needed:"is-review", complete:"is-complete", advisory:"is-live",
    ready:"is-complete", draft:"is-review", watch:"is-watch"
  }[a.status] || "is-watch";
  return (
    <div className="agent">
      <button className="agent__head" onClick={onToggle}>
        <div className="agent__icon">{initials}</div>
        <div>
          <div className="agent__name">{a.label} <span className="tier" style={{marginLeft:6, fontSize:8, width:14, height:14}}>{a.tier}</span></div>
          <div className="agent__role">{a.role} · {a.time}</div>
        </div>
        <span className={`agent__status ${status}`}>{a.status.replace(/_/g," ")}</span>
      </button>
      {expanded && (
        <div className="agent__body">
          <div style={{color:"var(--mc-text)", fontWeight:500, marginBottom:4}}>{a.headline}</div>
          {a.detail}
          {a.quote && (
            <div className="agent__quote">
              <span className="src">Patient said</span>
              “{a.quote}”
            </div>
          )}
          <div className="agent__bar">
            <span>conf {(a.confidence*100|0)}%</span>
            <span className="track"><span style={{width: `${(a.confidence*100)|0}%`}} /></span>
            <button className="btn btn--ghost" style={{padding:"2px 6px", fontSize:11}}>Open</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RightRail({ collapsed, onToggle }) {
  const [open, setOpen] = useState(new Set(["physician_pre","scribe","cds"]));
  const all = [...AGENTS.encounter, ...AGENTS.pre_visit];
  function toggle(k) {
    setOpen(prev => {
      const n = new Set(prev);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  }
  if (collapsed) {
    return (
      <div className="col col--right" style={{padding:"14px 8px", width:56}}>
        <button className="btn btn--ghost" onClick={onToggle} style={{writingMode:"vertical-rl", padding:"10px 4px"}} title="Expand agents">
          ◀  Agents (9)
        </button>
      </div>
    );
  }
  return (
    <div className="col col--right">
      <h4 className="section" style={{display:"flex", justifyContent:"space-between"}}>
        <span>AI Clinical Agents · 9 active</span>
        <button className="btn btn--ghost" style={{padding:"2px 6px", fontSize:11}} onClick={onToggle}>Collapse</button>
      </h4>
      <div style={{fontSize:11, color:"var(--mc-text-muted)", margin:"0 0 10px"}}>
        Auto-triggered on vitals save · last run 0:14 ago
      </div>
      <div className="eyebrow" style={{marginBottom:6}}>In-encounter · 5</div>
      {AGENTS.encounter.map(a => <AgentRow key={a.key} a={a} expanded={open.has(a.key)} onToggle={() => toggle(a.key)} />)}
      <div className="eyebrow" style={{margin:"14px 0 6px"}}>Pre-visit · 4</div>
      {AGENTS.pre_visit.map(a => <AgentRow key={a.key} a={a} expanded={open.has(a.key)} onToggle={() => toggle(a.key)} />)}

      <h4 className="section" style={{marginTop:20}}>Advisories · {CDS.length}</h4>
      {CDS.map(c => (
        <div key={c.id} className={`adv tier-${c.tier}`}>
          <h6>{c.title} <span className={`tier tier-${c.tier}`} style={{marginLeft:6}}>{c.tier}</span></h6>
          <p>{c.body}</p>
          {c.quote && (
            <div className="adv__quote">
              <span className="src">{c.quoteSource}</span>
              “{c.quote}”
            </div>
          )}
          <div className="row">
            <span className="ev">{c.evidence}</span>
            <span style={{flex:1}} />
            <button className="btn">Reject</button>
            <button className="btn btn--primary">{c.action}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Center: split scribe + SOAP w/ inline CDS
// ============================================================
function ScribeSplit() {
  return (
    <div className="split">
      <div className="split__pane is-ink">
        <div className="split__head">
          <span>Live transcript · speaker-labeled</span>
          <span className="live"><span className="pulse" />Recording · 12:08</span>
        </div>
        <div className="split__body">
          {TRANSCRIPT.map((t, i) => (
            <div key={i} className={`turn ${t.text.includes("peptide")||t.text.includes("knees")||t.text.includes("plateau") ? "flagged":""}`}>
              <span className={`who who--${t.who}`}>{t.who === "MD" ? "DR. REYES" : "BOB H."}</span>
              <span className="t">{t.t}</span>
              <span className="text">{t.text}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="split__pane">
        <div className="split__head">
          <span>SOAP draft · inline CDS</span>
          <span style={{fontFamily:"var(--mc-font-mono)", fontSize:11}}>78% complete</span>
        </div>
        <div className="split__body soap">
          <h5>Subjective</h5>
          <p>{SOAP_DRAFT.subjective}</p>
          <h5>Objective</h5>
          <p>{renderWithCds(SOAP_DRAFT.objective)}</p>
          <h5>Assessment</h5>
          <p>{renderWithCds(SOAP_DRAFT.assessment)}</p>
          <h5>Plan</h5>
          <p>{renderWithCds(SOAP_DRAFT.plan)}</p>
        </div>
      </div>
    </div>
  );
}

function renderWithCds(text) {
  const parts = text.split(/(\[\[cds-\d+\]\])/g);
  return parts.map((p, i) => {
    const m = p.match(/\[\[cds-(\d+)\]\]/);
    if (!m) return <React.Fragment key={i}>{p}</React.Fragment>;
    const c = CDS.find(x => x.id === `cds-${m[1]}`);
    return c ? <span key={i} className="cds-mark" title={c.body}>▤ {c.title.split(" — ")[0]}</span> : null;
  });
}

// Primary Care panel — chronic-disease management at a glance (default)
function PrimaryCarePanel({ p }) {
  const a1c = p.labs.find(l=>l.name==="HbA1c");
  const ldl = p.labs.find(l=>l.name==="LDL cholesterol");
  const vitD = p.labs.find(l=>l.name==="Vitamin D, 25-OH");
  const crp = p.labs.find(l=>l.name==="hs-CRP");
  const conditions = [
    { name:"Hypertension", icd:"I10", value:p.vitals.bp, unit:"mmHg", target:"<130/80", status:"at goal", since:"2014", med:"lisinopril 20 mg", trend:"flat" },
    { name:"Type 2 diabetes", icd:"E11.9", value:`${a1c.value}%`, unit:"A1c", target:"<7.0", status:"at goal", since:"2019", med:"metformin 1g BID + semaglutide", trend:"down" },
    { name:"Hyperlipidemia", icd:"E78.5", value:ldl.value, unit:"LDL mg/dL", target:"<100", status:"at goal", since:"2020", med:"atorvastatin 40 mg", trend:"down" },
    { name:"Osteoarthritis (knees)", icd:"M17.0", value:"flare", unit:"today", target:"PT + imaging", status:"new today", since:"2021", med:"PRN acetaminophen", trend:"flag" },
    { name:"Obesity, class I", icd:"E66.01", value:p.bmi, unit:"BMI", target:"<25", status:"improving", since:"2018", med:"GLP-1 + lifestyle", trend:"down" },
    { name:"Vitamin D deficiency", icd:"E55.9", value:vitD.value, unit:"ng/mL", target:"30–100", status:"borderline", since:"2022", med:"chole. 5000 IU daily", trend:"up" },
  ];
  return (
    <div className="panel">
      <div className="panel__head">
        <h3 className="panel__title">Primary care · chronic-disease panel</h3>
        <span className="panel__sub">6 active conditions · 5 at goal · 1 new presentation</span>
      </div>
      <div style={{display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10, marginTop:6}}>
        {conditions.map(c => {
          const flag = c.status === "new today" || c.status === "borderline";
          return (
            <div key={c.name} className="line" style={{borderLeft: flag?"2px solid var(--mc-gold)":"2px solid var(--mc-tier-a)", paddingLeft:10}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:6}}>
                <div style={{fontWeight:600, color:"var(--mc-navy)", fontSize:13}}>{c.name}</div>
                <span className="mono" style={{fontSize:10, color:"var(--mc-text-muted)"}}>{c.icd}</span>
              </div>
              <div style={{display:"flex", alignItems:"baseline", gap:6, marginTop:4}}>
                <span style={{fontFamily:"var(--mc-font-display)", fontWeight:700, fontSize:18, color:"var(--mc-navy)"}}>{c.value}</span>
                <span style={{fontSize:10, color:"var(--mc-text-muted)"}}>{c.unit}</span>
              </div>
              <div className="meta" style={{marginTop:2}}>{c.med}</div>
              <div style={{display:"flex", justifyContent:"space-between", marginTop:4, fontSize:11}}>
                <span style={{color:"var(--mc-text-muted)"}}>target {c.target}</span>
                <span style={{color: flag?"var(--mc-gold)":"var(--mc-success)", fontWeight:600}}>{c.status}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// HRT/Peptide panel
function HrtPanel({ p }) {
  return (
    <div className="hrt">
      <small>HRT · Peptide protocol</small>
      <h4>Testosterone replacement — {p.trt.yearsOn} years on regimen</h4>
      <div style={{fontSize:13, color:"rgba(255,255,255,0.78)", marginTop:6, maxWidth:560}}>
        {p.trt.regimen}. Last titration {p.trt.lastTitration}. Consent {p.trt.consent}.
      </div>
      <div className="hrt__grid">
        <div className="hrt__card"><div className="l">Total T</div><div className="v">{p.trt.currentTotalT}</div><div className="s">target {p.trt.targetTotalT}</div></div>
        <div className="hrt__card"><div className="l">Estradiol</div><div className="v">{p.trt.currentEstradiol}</div><div className="s">target {p.trt.estradiolTarget}</div></div>
        <div className="hrt__card"><div className="l">Hct (watch)</div><div className="v" style={{color:"var(--mc-gold-200)"}}>51.2%</div><div className="s">trending up</div></div>
        <div className="hrt__card"><div className="l">PSA</div><div className="v">1.4</div><div className="s">stable, &lt;4.0</div></div>
      </div>
      <div style={{display:"flex", gap:10, marginTop:14, alignItems:"center"}}>
        <button className="btn btn--gold">Renew TRT · 90 d</button>
        <button className="btn" style={{background:"transparent", color:"var(--mc-ivory)", borderColor:"rgba(255,255,255,0.30)"}}>Adjust dose</button>
        <button className="btn" style={{background:"transparent", color:"var(--mc-ivory)", borderColor:"rgba(255,255,255,0.30)"}}>Order phlebotomy</button>
        <span style={{flex:1}} />
        <span style={{fontSize:11, color:"rgba(255,255,255,0.6)"}}>Domain Logic Agent: TRT</span>
      </div>

      <div style={{marginTop:18, display:"grid", gridTemplateColumns:"1fr 1fr", gap:14}}>
        <div className="hrt__card" style={{background:"rgba(255,255,255,0.08)"}}>
          <div className="l">GLP-1 · Semaglutide</div>
          <div style={{display:"flex", alignItems:"baseline", gap:10, marginTop:6}}>
            <div className="v" style={{fontSize:28}}>1.7 mg</div>
            <span style={{fontSize:11, color:"rgba(255,255,255,0.65)"}}>weekly SC</span>
          </div>
          <div style={{display:"flex", gap:1, marginTop:8, alignItems:"end", height:30}}>
            {p.glp1.weightHistory.map((w,i) => {
              const pct = ((248-w)/40)*100;
              return <i key={i} style={{display:"inline-block", width:18, height:`${30-pct*0.3}px`, background:"var(--mc-gold-200)", marginRight:2, borderRadius:1}} />;
            })}
          </div>
          <div className="s" style={{marginTop:6}}>248 → 212 lb · plateau × 6 wk · escalate to 2.0 mg?</div>
        </div>
        <div className="hrt__card" style={{background:"rgba(255,255,255,0.08)"}}>
          <div className="l">Peptide request · BPC-157</div>
          <div className="v" style={{fontSize:18, marginTop:6}}>250 µg SC BID × 4 wk</div>
          <div className="s" style={{marginTop:4}}>Off-label · Tier C evidence · informed consent required</div>
          <div style={{display:"flex", gap:6, marginTop:10}}>
            <button className="btn btn--gold" style={{padding:"4px 8px", fontSize:11}}>Open consent</button>
            <button className="btn" style={{padding:"4px 8px", fontSize:11, background:"transparent", color:"var(--mc-ivory)", borderColor:"rgba(255,255,255,0.30)"}}>Defer to imaging</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LabsPanel({ p }) {
  return (
    <div>
      <table className="labs">
        <thead>
          <tr><th>Test</th><th>Result</th><th>Reference</th><th>Trend</th><th>Date</th><th>Tier</th></tr>
        </thead>
        <tbody>
        {p.labs.map(l => (
          <tr key={l.name}>
            <td style={{fontWeight:500}}>{l.name}</td>
            <td><span className={`num ${l.flag === "high" ? "num--flag" : ""} ${l.flag === "low" || l.flag === "borderline" ? "num--low" : ""}`}>{l.value}</span> <span style={{fontSize:11, color:"var(--mc-text-muted)"}}>{l.unit}</span></td>
            <td className="ref">{l.ref}</td>
            <td>
              <span className="spark">
                {(l.history || [l.value, l.value, l.value, l.value]).map((h,i,arr) => {
                  const max = Math.max(...arr);
                  const min = Math.min(...arr);
                  const range = Math.max(max - min, 1);
                  const heightPct = ((h - min) / range) * 100;
                  return <i key={i} style={{height: `${4 + (heightPct * 0.14)}px`}} />;
                })}
              </span>
            </td>
            <td className="ref">{l.date}</td>
            <td><span className={`tier tier-${l.tier}`}>{l.tier}</span></td>
          </tr>
        ))}
        </tbody>
      </table>
    </div>
  );
}

// Center column
function CenterEncounter({ p, voiceMode, specialty }) {
  return (
    <div className="col col--center">
      <div className="ai-banner" style={{marginBottom:12}}>
        <span className="dot-conf" /><b>AI-assisted encounter.</b>
        <span style={{color:"var(--mc-text-muted)"}}>Scribe + 4 agents are running. All outputs require physician review before signing.</span>
        <span className="conf">conf 0.91</span>
      </div>

      {specialty === "primary" && <PrimaryCarePanel p={p} />}
      {specialty === "hrt" && <div style={{marginBottom:14}}><HrtPanel p={p} /></div>}
      {specialty === "general" && <PrimaryCarePanel p={p} />}

      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Ambient scribe · split view</h3>
          <div style={{display:"flex", gap:8}}>
            <button className="btn">Pause</button>
            <button className="btn">Edit transcript</button>
            <button className="btn btn--primary">Regenerate note</button>
          </div>
        </div>
        <div className="panel__sub">
          Transcript on the left mirrors what each speaker said. The SOAP note on the right rewrites in clinical language with inline CDS markers — click to review evidence.
        </div>
        <ScribeSplit />
      </div>

      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Today’s labs · 8 panels</h3>
          <span className="panel__sub">Drawn 8:14 a.m. by MA agent · resulted 9:12 a.m.</span>
        </div>
        <LabsPanel p={p} />
      </div>

      <div className="panel">
        <div className="panel__head">
          <h3 className="panel__title">Staged orders · 3</h3>
          <button className="btn btn--primary">Cosign all</button>
        </div>
        {[
          ["Lab", "CBC w/ diff — recheck in 4 weeks", "monitor TRT-induced erythrocytosis", "A"],
          ["Imaging", "Bilateral knee X-ray, weight-bearing", "OA flare; inform escalation", "B"],
          ["Rx renewal", "Testosterone cypionate 100 mg/wk × 90 d", "standing protocol · consent on file", "A"],
        ].map(([k,t,r,tier]) => (
          <div key={t} className="line" style={{display:"grid", gridTemplateColumns:"80px 1fr auto", gap:14, alignItems:"center"}}>
            <span className="eyebrow">{k}</span>
            <div>
              <div style={{fontWeight:600, color:"var(--mc-navy)"}}>{t}</div>
              <div className="meta">{r}</div>
            </div>
            <span className={`tier tier-${tier}`}>{tier}</span>
          </div>
        ))}
      </div>

      <div style={{display:"flex", gap:10, marginTop:18}}>
        <button className="btn btn--primary" style={{padding:"10px 18px", fontSize:14}}>Review &amp; sign →</button>
        <button className="btn">Export FHIR R4 (one-click)</button>
        <button className="btn">Send to MediVault</button>
      </div>
    </div>
  );
}

// Voice ribbon (bottom)
function VoiceRibbon({ rightWidth }) {
  const [phrase, setPhrase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhrase(p => (p + 1) % TRANSCRIPT.length), 4500);
    return () => clearInterval(id);
  }, []);
  const turn = TRANSCRIPT[phrase];
  return (
    <div className="ribbon" style={{right: rightWidth}}>
      <span className="ribbon__live"><span className="pulse" />Ambient · 12:08</span>
      <div className="ribbon__waveform">
        {Array.from({length:18}).map((_,i)=> <i key={i} style={{height: 8 + ((i*7)%18), animationDelay: `${i*0.07}s`}} />)}
      </div>
      <span className="ribbon__text"><b>{turn.who === "MD" ? "Dr. Reyes" : "Bob"}</b>{turn.text}</span>
      <span style={{fontSize:11, color:"rgba(255,255,255,.55)"}}>auto-saved · patient consented at 10:46 a.m.</span>
      <button className="btn" style={{background:"transparent", color:"var(--mc-ivory)", borderColor:"rgba(255,255,255,.25)"}}>Pause</button>
    </div>
  );
}

// ============================================================
// Encounter page
// ============================================================
function EncounterPage({ tweaks }) {
  const collapsed = tweaks.agentPanel === "collapsed";
  const bottom = tweaks.agentPanel === "bottom";
  const cls = `encounter ${collapsed ? "encounter--collapsed" : ""} ${bottom ? "encounter--agentBottom":""}`;
  return (
    <div className={cls} style={{position:"relative"}}>
      <LeftSummary p={PATIENT} />
      <CenterEncounter p={PATIENT} voiceMode={tweaks.voiceMode} specialty={tweaks.specialty} />
      {!bottom && <RightRail collapsed={collapsed} onToggle={() => {}} />}
      {tweaks.voiceMode === "ribbon" && <VoiceRibbon rightWidth={collapsed ? 56 : (bottom ? 0 : 360)} />}
    </div>
  );
}

// ============================================================
// Pre-visit briefing
// ============================================================
function PreVisitPage() {
  const p = PATIENT;
  return (
    <div className="page">
      <div className="page__eyebrow">Pre-visit briefing · Front Desk Agent</div>
      <h1 className="page__title">Bob Hayes · 6-month primary-care follow-up</h1>
      <div className="page__lede">A one-page synopsis prepared by the Front Desk Agent at 8:30 a.m., with patient-voice excerpts surfaced from phone triage and the pre-visit intake form. Replaces traditional chart review.</div>

      <div className="briefing">
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"baseline"}}>
          <h2>What I learned about Bob this morning</h2>
          <span className="eyebrow">Confidence 0.97</span>
        </div>
        <div className="gold-rule" />

        <div className="briefing__grid">
          <div>
            <h5>Visit reason</h5>
            <p style={{fontSize:14, lineHeight:1.6, margin:"0 0 16px"}}>Six-month chronic-disease follow-up: hypertension, T2DM, hyperlipidemia. New presentation: bilateral knee pain after yardwork. Two specialty threads continuing in the background — TRT (8 yrs, stable) and semaglutide for T2DM/obesity.</p>

            <h5>What’s working</h5>
            <ul style={{margin:0, paddingLeft:20, fontSize:13, lineHeight:1.6, color:"var(--mc-text-muted)"}}>
              <li>BP 126/78 controlled on lisinopril 20 mg</li>
              <li>A1c 8.4 → 6.1, LDL 88 at goal on atorvastatin</li>
              <li>Weight 248 → 212 lb (BMI 34.6 → 29.6)</li>
              <li>TRT labs at target; libido + energy preserved</li>
            </ul>
          </div>
          <div>
            <h5>What needs your attention</h5>
            <div className="line flag" style={{marginBottom:8}}>
              <div style={{fontWeight:600}}>New: bilateral knee OA flare</div>
              <div className="meta">First symptomatic episode in 12 mo. Imaging + PT pathway; weight-loss helping mechanically.</div>
            </div>
            <div className="line flag" style={{marginBottom:8}}>
              <div style={{fontWeight:600}}>Care gap · colonoscopy overdue</div>
              <div className="meta">Last 2018; due now per USPSTF. Patient is 68M.</div>
            </div>
            <div className="line flag" style={{marginBottom:8}}>
              <div style={{fontWeight:600}}>Hct 51.2% — borderline (TRT side-effect)</div>
              <div className="meta">Third rising draw. Watch; specialty decision item.</div>
            </div>
            <div className="line">
              <div style={{fontWeight:600}}>Patient-raised: BPC-157 peptide question</div>
              <div className="meta">Off-label. Suggest defer until imaging back; consent template ready.</div>
            </div>
          </div>
        </div>

        <h5 style={{marginTop:22}}>Patient voice · the past 24 hours</h5>
        {PATIENT_VOICE.map((q, i) => (
          <div key={i} className="adv__quote" style={{padding:"10px 14px", margin:"8px 0", borderLeft:"2px solid var(--mc-gold)", background:"var(--mc-ivory)"}}>
            <span className="src">{q.source}</span>
            <span style={{fontSize:14, fontStyle:"italic"}}>“{q.quote}”</span>
          </div>
        ))}

        <h5 style={{marginTop:22}}>How this briefing was assembled</h5>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:10, marginTop:6}}>
          {AGENTS.pre_visit.map(a => (
            <div key={a.key} className="line">
              <div style={{fontWeight:600, color:"var(--mc-navy)"}}>{a.label}</div>
              <div className="meta">{a.headline}</div>
              <div className="meta mono" style={{marginTop:4}}>conf {(a.confidence*100|0)}% · {a.time}</div>
            </div>
          ))}
        </div>

        <div style={{display:"flex", gap:10, marginTop:22}}>
          <button className="btn btn--primary">Begin encounter →</button>
          <button className="btn">Open full chart</button>
          <button className="btn btn--ghost">Acknowledge briefing only</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Review & Sign — hallucination diff
// ============================================================
function ReviewPage() {
  return (
    <div className="page">
      <div className="page__eyebrow">Review &amp; sign · hallucination check</div>
      <h1 className="page__title">Verify before you sign</h1>
      <div className="page__lede">The Scribe drafted this note from 12:08 of ambient audio. Below is a side-by-side of the original draft and your edits, with anything the model said that’s not supported by transcript or chart highlighted in amber. Sign only after you’ve resolved each flag.</div>

      <div className="dashgrid">
        <div className="span-8">
          <div className="panel">
            <div className="panel__head">
              <h3 className="panel__title">Diff view · Assessment &amp; Plan</h3>
              <div style={{display:"flex", gap:8}}>
                <button className="btn">Show transcript</button>
                <button className="btn">Show evidence</button>
              </div>
            </div>
            <div className="diff">
              <p><b>Assessment.</b> Hypogonadism on TRT, well-controlled. T2DM with <ins>excellent glycemic response (A1c 6.8 → 6.1)</ins>. Bilateral knee OA, acute flare. <mark>BPC-157 peptide — off-label, Tier C; informed consent required.</mark></p>
              <p><b>Plan.</b> Continue TRT at 100 mg/wk; recheck CBC in 4 weeks; <del>begin therapeutic phlebotomy this week</del> <ins>if Hct &gt;52% on recheck, schedule phlebotomy</ins>. Escalate semaglutide to 2.0 mg with standard nausea precautions. <mark>Order bilateral knee X-ray, weight-bearing.</mark> Refer to PT. Defer BPC-157 pending imaging. Schedule colonoscopy.</p>
            </div>
            <div style={{display:"flex", gap:8, marginTop:12}}>
              <span className="chip" style={{background:"var(--mc-warning-soft)", color:"#7a5a07", borderColor:"transparent"}}>2 unverified claims</span>
              <span className="chip" style={{background:"var(--mc-success-soft)", color:"var(--mc-success)", borderColor:"transparent"}}>3 edits accepted</span>
              <span className="chip" style={{background:"var(--mc-danger-soft)", color:"var(--mc-danger)", borderColor:"transparent"}}>1 deletion</span>
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <h3 className="panel__title">Unverified · click each to resolve</h3>
            </div>
            {[
              ["BPC-157 — off-label, Tier C; informed consent required", "Source: Physician (pre) Agent. Not in transcript. Verify and accept, or remove from note."],
              ["Order bilateral knee X-ray, weight-bearing", "Source: CDS Agent. Patient described pain; no explicit consent to X-ray in transcript."]
            ].map(([t,r]) => (
              <div key={t} className="line flag" style={{marginBottom:8}}>
                <div style={{fontWeight:600, color:"var(--mc-navy)"}}>{t}</div>
                <div className="meta">{r}</div>
                <div style={{display:"flex", gap:6, marginTop:8}}>
                  <button className="btn btn--primary" style={{padding:"4px 8px", fontSize:11}}>Accept</button>
                  <button className="btn" style={{padding:"4px 8px", fontSize:11}}>Edit</button>
                  <button className="btn btn--ghost" style={{padding:"4px 8px", fontSize:11}}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="span-4">
          <div className="panel">
            <div className="panel__head"><h3 className="panel__title">Sign-off checklist</h3></div>
            {[
              ["AI-assisted note reviewed", true],
              ["Inline CDS resolved (4/4)", true],
              ["Hallucination flags addressed (0/2)", false],
              ["Orders cosigned (3/3)", true],
              ["Coding confirmed — 99214", true],
              ["Patient-voice citations preserved", true]
            ].map(([t, ok]) => (
              <div key={t} className="line" style={{display:"flex", alignItems:"center", gap:8}}>
                <span style={{width:14, height:14, borderRadius:3, background: ok ? "var(--mc-success)" : "var(--mc-warning)", color:"white", fontSize:10, display:"grid", placeItems:"center"}}>{ok?"✓":"!"}</span>
                <span style={{flex:1, fontSize:13}}>{t}</span>
              </div>
            ))}
            <div style={{marginTop:12, display:"flex", flexDirection:"column", gap:8}}>
              <button className="btn btn--primary" style={{padding:"10px 14px"}}>Sign &amp; close encounter</button>
              <button className="btn">Sign &amp; export FHIR Bundle</button>
              <button className="btn btn--ghost">Defer signing</button>
            </div>
          </div>
          <div className="panel">
            <div className="panel__head"><h3 className="panel__title">Audit trail</h3></div>
            <div style={{fontSize:12, color:"var(--mc-text-muted)", lineHeight:1.6}}>
              <div>10:46 a.m. · Patient verbally consented to ambient recording</div>
              <div>10:48 a.m. · Encounter began · Scribe Agent online</div>
              <div>10:51 a.m. · CDS-1 (Hct) surfaced</div>
              <div>11:02 a.m. · SOAP draft created · conf 0.91</div>
              <div>11:04 a.m. · J. Reyes accepted 3 edits, deleted 1 line</div>
              <div>11:05 a.m. · Awaiting hallucination resolution · you</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Dashboard
// ============================================================
function DashboardPage() {
  return (
    <div className="page">
      <div className="page__eyebrow">Dashboard · Wednesday, April 22, 2026</div>
      <h1 className="page__title">Good morning, Dr. Reyes.</h1>
      <div className="page__lede">8 patients on the panel today — mostly chronic-disease follow-ups and one annual physical. 3 already roomed, 1 awaiting your review &amp; sign. The Pre-Visit Agent has prepared briefings overnight for everyone.</div>

      <div className="dashgrid">
        <div className="kpi span-3"><span className="lbl">Today’s panel</span><span className="val">8</span><span className="sub delta--down">2 fewer than avg</span></div>
        <div className="kpi span-3"><span className="lbl">Encounters open</span><span className="val">3</span><span className="sub">1 awaiting sign</span></div>
        <div className="kpi span-3"><span className="lbl">Care gaps surfaced</span><span className="val">11</span><span className="sub delta--up">+4 this week</span></div>
        <div className="kpi span-3"><span className="lbl">Mean note time</span><span className="val">7m 12s</span><span className="sub delta--down">−4m 18s vs Q1</span></div>

        <div className="span-8 panel" style={{padding:0}}>
          <div className="panel__head" style={{padding:"14px 18px", margin:0, borderBottom:"1px solid var(--mc-border)"}}>
            <h3 className="panel__title">Schedule · today</h3>
            <span className="panel__sub">Click any row to open the pre-visit briefing</span>
          </div>
          <div className="sched">
            {[
              ["8:30","Marta Cole","Annual physical · Medicare wellness","Roomed","tier-A"],
              ["9:00","Henry Tann","HTN follow-up · BP recheck","Briefing","tier-A"],
              ["9:30","Diane Park","Knee pain · OA workup","Briefing","tier-A"],
              ["10:00","Bob Hayes","6-mo chronic-disease + new knee","In encounter","tier-A"],
              ["11:00","Carmen Alvarez","T2DM 3-mo · GLP-1 titration","Briefing","tier-B"],
              ["1:00","Lin Kessler","Acute URI · same-day","Awaiting","tier-B"],
              ["2:00","Yusuf Adeyemi","Hyperlipidemia 6-mo","Briefing","tier-A"],
              ["3:30","Sasha Wu","HRT consult · specialty add-on","Briefing","tier-C"],
            ].map(([t,n,r,s,tier]) => (
              <div key={n} className="sched__row">
                <span className="sched__time">{t}</span>
                <div>
                  <div className="sched__name">{n}</div>
                  <div className="sched__sub">{r}</div>
                </div>
                <span className="chip chip--soft">{s}</span>
                <span className={`tier ${tier}`}>{tier.split("-")[1]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="span-4">
          <div className="panel">
            <div className="panel__head"><h3 className="panel__title">Awaiting you</h3></div>
            <div className="line flag">
              <div style={{fontWeight:600, color:"var(--mc-navy)"}}>Bob Hayes · review &amp; sign</div>
              <div className="meta">2 hallucination flags · 3 orders staged</div>
            </div>
            <div className="line flag">
              <div style={{fontWeight:600, color:"var(--mc-navy)"}}>5 messages from MA agent</div>
              <div className="meta">Refill questions · escalation requested on 1</div>
            </div>
            <div className="line">
              <div style={{fontWeight:600, color:"var(--mc-navy)"}}>2 lab reviews · not abnormal</div>
              <div className="meta">M. Cole, H. Tann · batched</div>
            </div>
          </div>
          <div className="panel">
            <div className="panel__head"><h3 className="panel__title">Quality this month</h3></div>
            <div className="line"><div style={{fontWeight:600}}>HEDIS BCS-E · mammogram</div><div className="meta">68% — 4 to close target</div></div>
            <div className="line"><div style={{fontWeight:600}}>HEDIS COL-E · colonoscopy</div><div className="meta">71% — 1 booked today</div></div>
            <div className="line"><div style={{fontWeight:600}}>MIPS · BP control</div><div className="meta">82% — above goal</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Patient chart
// ============================================================
function PatientPage() {
  const p = PATIENT;
  return (
    <div className="page">
      <div className="page__eyebrow">Patient chart · longitudinal</div>
      <h1 className="page__title">{p.name}</h1>
      <div className="page__lede">A reading-first chart. Sections are typeset like a clinical journal article — problems, regimens, and trajectory in long form, with quick-look numerics in the margin.</div>

      <div className="dashgrid">
        <div className="span-8">
          <div className="panel">
            <div className="h-section">Trajectory <span className="rule" /></div>
            <p style={{fontSize:14, lineHeight:1.65, color:"var(--mc-text)"}}>
              Bob has been with this practice since 2014. Primary care has been built around three intertwined chronic conditions — <b>hypertension</b>, <b>type 2 diabetes</b>, and <b>hyperlipidemia</b> — with obesity as the lever moving them all. Lisinopril 20 mg has held BP at 126/78 for over a decade.
            </p>
            <p style={{fontSize:14, lineHeight:1.65, color:"var(--mc-text)"}}>
              Diabetes was diagnosed in 2019 (A1c 8.4). Glycemic control was poor on metformin alone for two years. <b>Semaglutide</b> began February 2025 with stepwise titration to 1.7 mg over 14 months; weight is down 36 lb (BMI 34.6 → 29.6) and A1c is 6.1 — at goal. Atorvastatin holds LDL at 88. Today the chronic panel is clean across the board.
            </p>
            <p style={{fontSize:14, lineHeight:1.65, color:"var(--mc-text)"}}>
              <b>New today:</b> bilateral knee OA flare — first symptomatic episode in 12 months, consistent with weight-bearing recovery. Imaging + PT pathway. Care gap: colonoscopy overdue since 2018.
            </p>
            <p style={{fontSize:14, lineHeight:1.65, color:"var(--mc-text)"}}>
              <b>Specialty thread (HRT):</b> testosterone replacement since October 2017 after symptomatic hypogonadism. Cypionate 100 mg IM weekly + anastrozole 0.5 mg twice weekly, stable for eight years. Watch item: hematocrit trending up (49.4 → 50.6 → 51.2); the dose was held last fall — pattern recurring.
            </p>
          </div>

          <div className="panel">
            <div className="h-section">Labs · today <span className="rule" /></div>
            <LabsPanel p={p} />
          </div>

          <div className="panel">
            <div className="h-section">Specialty: HRT regimen <span className="rule" /></div>
            <div style={{fontSize:11, color:"var(--mc-text-muted)", margin:"0 0 10px", textTransform:"uppercase", letterSpacing:".10em"}}>Add-on · visible because hypogonadism is on the problem list</div>
            <HrtPanel p={p} />
          </div>
        </div>

        <div className="span-4">
          <div className="panel">
            <div className="panel__head"><h3 className="panel__title">At a glance</h3></div>
            <div className="line"><div style={{fontWeight:600}}>Active problems</div><div className="meta">{p.problems.length}</div></div>
            <div className="line"><div style={{fontWeight:600}}>Active medications</div><div className="meta">{p.medications.length}</div></div>
            <div className="line"><div style={{fontWeight:600}}>Allergies</div><div className="meta">{p.allergies.map(a=>a.name).join(", ")}</div></div>
            <div className="line"><div style={{fontWeight:600}}>Care team</div><div className="meta">PCP {p.pcp}</div></div>
          </div>
          <div className="panel">
            <div className="panel__head"><h3 className="panel__title">Visit history</h3></div>
            {p.history.map(h => (
              <div key={h.date} className="line">
                <div style={{fontWeight:600, fontSize:13}}>{h.type} · {h.date}</div>
                <div className="meta">{h.note}</div>
              </div>
            ))}
          </div>
          <div className="panel">
            <div className="panel__head"><h3 className="panel__title">Patient-owned export</h3></div>
            <div style={{fontSize:12, color:"var(--mc-text-muted)", marginBottom:10}}>
              The patient owns this record. Export the full FHIR R4 Bundle to MediVault or as a download — every export is logged.
            </div>
            <button className="btn btn--primary" style={{width:"100%"}}>Export FHIR R4 Bundle</button>
            <button className="btn" style={{width:"100%", marginTop:6}}>Send to MediVault</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Variations — layout canvas
// ============================================================
function VariationsPage() {
  return (
    <div className="page">
      <div className="page__eyebrow">Layout explorations</div>
      <h1 className="page__title">Three encounter layouts</h1>
      <div className="page__lede">The hero is a calm 3-column with split scribe (default). Two alternates explore opposite ends of the focus spectrum: full-width scribe for tablet-rounding, and a collapsed Command Center with a floating agent radar for high-volume days.</div>

      <div className="canvas">
        <div className="variation">
          <div className="variation__head">
            <h3 className="variation__title">Hero · 3-column with split scribe + auto agent panel</h3>
            <span className="variation__tag">Default · desktop · 1440–</span>
          </div>
          <div className="variation__shell" style={{height:340}}>
            <MiniEncounter />
          </div>
        </div>

        <div className="variation">
          <div className="variation__head">
            <h3 className="variation__title">Variation A · Full-width scribe (rounding mode)</h3>
            <span className="variation__tag">Tablet · in-room</span>
          </div>
          <div className="variation__shell" style={{height:340}}>
            <MiniFullScribe />
          </div>
        </div>

        <div className="variation">
          <div className="variation__head">
            <h3 className="variation__title">Variation B · Collapsed Command Center + floating agent radar</h3>
            <span className="variation__tag">High-volume days</span>
          </div>
          <div className="variation__shell" style={{height:340}}>
            <MiniCommand />
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniEncounter() {
  return (
    <div style={{display:"grid", gridTemplateColumns:"180px 1fr 240px", height:"100%", fontSize:11}}>
      <div style={{borderRight:"1px solid var(--mc-border)", padding:"10px 12px", background:"var(--mc-off-white)"}}>
        <div className="eyebrow">Patient</div>
        <div style={{fontFamily:"var(--mc-font-display)", fontWeight:700, fontSize:14, color:"var(--mc-navy)", marginTop:4}}>Bob Hayes</div>
        <div style={{color:"var(--mc-text-muted)", fontSize:10}}>68 M · TRT + GLP-1</div>
        <div className="eyebrow" style={{marginTop:14}}>Problems</div>
        {["Hypogonadism","T2DM","Obesity","HTN","OA knees"].map(x => <div key={x} style={{fontSize:11, color:"var(--mc-text)", padding:"3px 0"}}>{x}</div>)}
      </div>
      <div style={{padding:"10px 14px", overflow:"hidden"}}>
        <div style={{background:"var(--mc-navy)", color:"var(--mc-ivory)", borderRadius:6, padding:"10px 12px", marginBottom:8}}>
          <div className="eyebrow" style={{color:"var(--mc-gold-200)"}}>HRT · TRT</div>
          <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6, marginTop:6}}>
            {[["T","742"],["E2","28"],["Hct","51.2"],["PSA","1.4"]].map(([l,v])=>(
              <div key={l} style={{background:"rgba(255,255,255,.08)", borderRadius:3, padding:"4px 6px"}}><div style={{fontSize:8, color:"var(--mc-gold-200)", letterSpacing:".1em"}}>{l}</div><div style={{fontFamily:"var(--mc-font-display)", fontWeight:700}}>{v}</div></div>
            ))}
          </div>
        </div>
        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:6}}>
          <div style={{background:"var(--mc-navy)", color:"var(--mc-ivory)", borderRadius:6, padding:8, fontSize:10}}>
            <div className="eyebrow" style={{color:"var(--mc-gold)"}}>Live transcript</div>
            <div style={{marginTop:6, opacity:.85}}>MD: "Hct’s creeping up at 51.2..."</div>
            <div style={{marginTop:4, opacity:.85}}>PT: "Same as last fall? You held my dose."</div>
          </div>
          <div style={{background:"var(--mc-ivory)", border:"1px solid var(--mc-border)", borderRadius:6, padding:8, fontSize:10}}>
            <div className="eyebrow">SOAP · 78%</div>
            <div style={{fontFamily:"var(--mc-font-display)", fontSize:10, color:"var(--mc-navy)", marginTop:6, fontWeight:700}}>Assessment.</div>
            <div style={{color:"var(--mc-text-muted)"}}>Hct borderline elevated; <span style={{background:"var(--mc-warning-soft)", color:"#7a5a07", padding:"0 3px", borderRadius:2}}>monitor</span>.</div>
          </div>
        </div>
      </div>
      <div style={{borderLeft:"1px solid var(--mc-border)", padding:"10px 10px", background:"var(--mc-off-white)"}}>
        <div className="eyebrow">Agents · 9</div>
        {["Scribe","CDS","Orders","Coding","Quality"].map((n,i)=>(
          <div key={n} style={{fontSize:10, padding:"4px 6px", display:"flex", justifyContent:"space-between", borderBottom:"1px solid var(--mc-border)"}}>
            <span>{n}</span>
            <span style={{fontSize:9, padding:"1px 4px", background: i===0?"var(--mc-success-soft)":"var(--mc-info-soft)", color: i===0?"var(--mc-success)":"var(--mc-info)", borderRadius:2, textTransform:"uppercase"}}>{i===0?"live":"ok"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniFullScribe() {
  return (
    <div style={{display:"grid", gridTemplateRows:"40px 1fr 50px", height:"100%"}}>
      <div style={{background:"var(--mc-navy)", color:"var(--mc-ivory)", display:"flex", alignItems:"center", padding:"0 14px", fontSize:11, gap:10}}>
        <span className="eyebrow" style={{color:"var(--mc-gold-200)"}}>Rounding</span>
        <span style={{fontFamily:"var(--mc-font-display)", fontWeight:700}}>Bob Hayes · 68 M</span>
        <span style={{flex:1}} />
        <span style={{display:"inline-flex", alignItems:"center", gap:4, color:"var(--mc-gold)"}}>● Recording 12:08</span>
      </div>
      <div style={{display:"grid", gridTemplateColumns:"1fr 1fr"}}>
        <div style={{padding:"14px 18px", background:"var(--mc-navy)", color:"var(--mc-ivory)", overflow:"hidden", fontSize:11, lineHeight:1.5}}>
          {TRANSCRIPT.slice(0,5).map((t,i)=>(
            <div key={i} style={{marginBottom:8}}>
              <span style={{fontSize:9, fontWeight:700, letterSpacing:".1em", color:t.who==="MD"?"var(--mc-gold-200)":"var(--mc-slate-200)"}}>{t.who==="MD"?"DR. REYES":"BOB"}</span>
              <span style={{marginLeft:6, color:"var(--mc-ivory)"}}>{t.text}</span>
            </div>
          ))}
        </div>
        <div style={{padding:"14px 18px", background:"var(--mc-off-white)", overflow:"hidden", fontSize:11, lineHeight:1.55, borderLeft:"1px solid var(--mc-border)"}}>
          <div className="eyebrow">SOAP draft</div>
          <div style={{fontFamily:"var(--mc-font-display)", fontWeight:700, fontSize:11, color:"var(--mc-navy)", marginTop:6}}>Subjective.</div>
          <div style={{color:"var(--mc-text-muted)"}}>68M, 8y on TRT + 14mo GLP-1. Stable energy. 36 lb total loss; 6-wk plateau at 1.7 mg.</div>
          <div style={{fontFamily:"var(--mc-font-display)", fontWeight:700, fontSize:11, color:"var(--mc-navy)", marginTop:8}}>Assessment.</div>
          <div style={{color:"var(--mc-text-muted)"}}>Hct 51.2 borderline. <span style={{background:"var(--mc-warning-soft)", color:"#7a5a07", padding:"0 3px", borderRadius:2}}>Recheck 4wk.</span></div>
        </div>
      </div>
      <div style={{background:"var(--mc-ivory)", borderTop:"1px solid var(--mc-border)", display:"flex", alignItems:"center", padding:"0 14px", gap:10, fontSize:11}}>
        <span style={{color:"var(--mc-success)", fontWeight:600}}>● Agents quiet</span>
        <span style={{color:"var(--mc-text-muted)"}}>4 advisories queued · will surface on review</span>
        <span style={{flex:1}} />
        <span className="btn btn--primary" style={{padding:"4px 10px"}}>Pause</span>
      </div>
    </div>
  );
}

function MiniCommand() {
  return (
    <div style={{position:"relative", height:"100%", padding:"14px 18px"}}>
      <div className="eyebrow">Command center</div>
      <div style={{fontFamily:"var(--mc-font-display)", fontWeight:700, fontSize:18, color:"var(--mc-navy)", marginTop:4}}>Bob Hayes · 6-mo follow-up</div>
      <div style={{display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginTop:14}}>
        {[
          ["A1c","6.1%","−0.7"],
          ["Weight","212 lb","−36"],
          ["Total T","742","target"],
          ["Hct","51.2%","watch"],
        ].map(([l,v,d])=>(
          <div key={l} style={{background:"var(--mc-off-white)", border:"1px solid var(--mc-border)", borderRadius:6, padding:"10px 12px"}}>
            <div className="eyebrow">{l}</div>
            <div style={{fontFamily:"var(--mc-font-display)", fontWeight:700, fontSize:20, color:"var(--mc-navy)"}}>{v}</div>
            <div style={{fontSize:10, color:"var(--mc-text-muted)"}}>{d}</div>
          </div>
        ))}
      </div>
      <div style={{marginTop:16, display:"grid", gridTemplateColumns:"1fr 1fr", gap:10}}>
        <div style={{background:"var(--mc-off-white)", border:"1px solid var(--mc-border)", borderLeft:"3px solid var(--mc-gold)", borderRadius:4, padding:"8px 10px", fontSize:11}}>
          <div style={{fontWeight:600, color:"var(--mc-navy)"}}>Hct rising — phlebotomy decision</div>
          <div style={{color:"var(--mc-text-muted)"}}>Endo Society 2024, IIa</div>
        </div>
        <div style={{background:"var(--mc-off-white)", border:"1px solid var(--mc-border)", borderLeft:"3px solid var(--mc-tier-a)", borderRadius:4, padding:"8px 10px", fontSize:11}}>
          <div style={{fontWeight:600, color:"var(--mc-navy)"}}>GLP-1 · escalate to 2.0 mg</div>
          <div style={{color:"var(--mc-text-muted)"}}>STEP-1 / SELECT 2024</div>
        </div>
      </div>

      <div className="radar">
        <div className="radar__core">9 agents<br/>nominal</div>
        <span className="radar__pip" style={{top:14, left:30}} />
        <span className="radar__pip" style={{top:60, right:24, background:"var(--mc-success)"}} />
        <span className="radar__pip" style={{bottom:30, left:18, background:"var(--mc-slate)"}} />
        <span className="radar__pip" style={{bottom:14, right:60, background:"var(--mc-warning)"}} />
      </div>
    </div>
  );
}

// ============================================================
// Display menu (gear)
// ============================================================
function DisplayMenu({ tweaks, set, onClose }) {
  const seg = (key, options) => (
    <div className="seg">
      {options.map(([v,l]) => (
        <button key={v} aria-pressed={tweaks[key]===v} onClick={() => set(key, v)}>{l}</button>
      ))}
    </div>
  );
  return (
    <div className="display">
      <div style={{display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8}}>
        <span style={{fontFamily:"var(--mc-font-display)", fontSize:14, fontWeight:700, color:"var(--mc-navy)"}}>Display</span>
        <button className="btn btn--ghost" style={{padding:"2px 6px"}} onClick={onClose}>×</button>
      </div>
      <h6>Agent panel</h6>
      {seg("agentPanel", [["right","Right"],["bottom","Bottom"],["collapsed","Collapsed"]])}
      <h6>Voice mode</h6>
      {seg("voiceMode", [["ribbon","Ribbon"],["full","Full transcript"],["off","Off"]])}
      <h6>Density</h6>
      {seg("density", [["comfortable","Comfortable"],["dense","Dense"]])}
      <h6>Theme</h6>
      {seg("theme", [["default","Clinical Navy"],["ivory","Warm Ivory"]])}
      <h6>Specialty pack</h6>
      {seg("specialty", [["primary","Primary care"],["hrt","HRT add-on"],["general","General"]])}
    </div>
  );
}

// ============================================================
// Consent modal
// ============================================================
function ConsentModal({ onClose }) {
  const [chk, setChk] = useState(false);
  return (
    <div className="modal__bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <small className="eyebrow">Ambient documentation</small>
        <h3>Patient consent for ambient recording</h3>
        <div className="gold-rule" />
        <p>Before the Scribe Agent begins recording, please confirm that the patient has been told:</p>
        <ul>
          <li>This visit will be transcribed by an AI scribe to assist documentation.</li>
          <li>Audio is processed locally and discarded after the SOAP note is signed.</li>
          <li>The patient may revoke consent at any time — recording stops immediately.</li>
          <li>The full audit trail (consent, agent actions, edits) is patient-accessible via MediVault.</li>
        </ul>
        <label style={{display:"flex", gap:8, alignItems:"center", fontSize:13, color:"var(--mc-text)", cursor:"pointer"}}>
          <input type="checkbox" checked={chk} onChange={e => setChk(e.target.checked)} />
          The patient has verbally consented and a witness is present.
        </label>
        <div className="modal__actions">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" disabled={!chk} onClick={onClose} style={{opacity: chk?1:.5}}>Record consent &amp; begin</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// App root
// ============================================================
function App() {
  const [tweaks, set] = useTweaks();
  const [consentOpen, setConsentOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const page = tweaks.page;
  function setPage(p) { set("page", p); }

  return (
    <div className={`app theme-${tweaks.theme} density-${tweaks.density}`}>
      <TopBar page={page} setPage={setPage} onConsent={() => setConsentOpen(true)} onGear={() => setGearOpen(g => !g)} />
      {page === "encounter" && (
        <>
          <PatientBanner p={PATIENT} />
          <WorkStrip />
        </>
      )}
      <div style={{position:"relative", overflow:"hidden", height:"100%"}}>
        {page === "dashboard" && <DashboardPage />}
        {page === "pre" && <PreVisitPage />}
        {page === "encounter" && <EncounterPage tweaks={tweaks} />}
        {page === "review" && <ReviewPage />}
        {page === "patient" && <PatientPage />}
        {page === "variations" && <VariationsPage />}
      </div>

      {consentOpen && <ConsentModal onClose={() => setConsentOpen(false)} />}
      {gearOpen && <DisplayMenu tweaks={tweaks} set={set} onClose={() => setGearOpen(false)} />}
    </div>
  );
}

export default App;
