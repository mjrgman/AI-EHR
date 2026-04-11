/**
 * LabCorp Result Parser
 *
 * Normalizes LabCorp PDF and XML result payloads into the shape the rest of
 * the EHR consumes. The output contract is stable — this module is the seam
 * between LabCorp's wire format and `patient.labs[]` / the Domain Logic
 * engine's `LAB_ALIASES` lookup.
 *
 * Contract:
 *   Input:  Buffer (PDF or XML bytes)
 *   Output: {
 *     ok: boolean,                       // false on parse failure — never throws
 *     source: 'labcorp_pdf' | 'labcorp_xml',
 *     labOrderId: string|null,
 *     orderedAt: string|null,            // ISO 8601
 *     resultedAt: string|null,           // ISO 8601
 *     patient: { firstName, lastName, dob } | null,
 *     results: Array<{
 *       code: string,                    // raw LabCorp test name (do NOT normalize — alias mapping happens downstream)
 *       displayName: string,
 *       value: number|string|null,
 *       unit: string|null,
 *       refRange: string|null,           // e.g. "70-99"
 *       abnormalFlag: string|null,       // 'H', 'L', 'HH', 'LL', 'N', or null
 *       resultedAt: string|null
 *     }>,
 *     warnings: Array<string>,
 *     rawExcerpt: string                 // first 500 chars for triage if parsing is weak
 *   }
 *
 * Safety:
 *   - Parser NEVER throws. All errors are captured in `warnings`, `ok` is false.
 *     Failing loud during ingestion would crash the LabSynthesisAgent mid-stream
 *     and block the whole patient's lab flow.
 *   - Raw LabCorp test names are preserved exactly so downstream alias matching
 *     in `server/domain/functional-med-engine.js` (LAB_ALIASES) can catch
 *     variant naming.
 *   - No PHI is ever logged — warnings include field names only.
 */

// Lazy-required to keep boot-time fast and to allow test environments without
// these optional deps installed. We also export a small shim that returns a
// helpful message if the dep is missing.
let _pdfParse = null;
let _xmlParser = null;

function getPdfParse() {
  if (_pdfParse === null) {
    try {
      // eslint-disable-next-line global-require
      _pdfParse = require('pdf-parse');
    } catch (err) {
      _pdfParse = false;
    }
  }
  return _pdfParse || null;
}

function getXmlParser() {
  if (_xmlParser === null) {
    try {
      // eslint-disable-next-line global-require
      const { XMLParser } = require('fast-xml-parser');
      _xmlParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        trimValues: true,
        parseAttributeValue: true,
        parseTagValue: true
      });
    } catch (err) {
      _xmlParser = false;
    }
  }
  return _xmlParser || null;
}

// ==========================================
// PDF PARSING
// ==========================================

/**
 * Parse a LabCorp PDF result buffer.
 *
 * LabCorp PDFs are typically structured as a header block, then a tabular
 * result section. We rely on line-based heuristics because LabCorp doesn't
 * publish a machine-readable PDF template — this is best-effort extraction.
 * Results that fail to parse get surfaced as warnings and the full raw text
 * is available for manual triage via the vault.
 *
 * @param {Buffer} buffer
 * @returns {Promise<Object>}
 */
async function parsePdfResult(buffer) {
  const base = {
    ok: false,
    source: 'labcorp_pdf',
    labOrderId: null,
    orderedAt: null,
    resultedAt: null,
    patient: null,
    results: [],
    warnings: [],
    rawExcerpt: ''
  };

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    base.warnings.push('empty_or_invalid_buffer');
    return base;
  }

  const pdfParse = getPdfParse();
  if (!pdfParse) {
    base.warnings.push('pdf_parse_unavailable');
    return base;
  }

  let rawText = '';
  try {
    const parsed = await pdfParse(buffer);
    rawText = parsed.text || '';
  } catch (err) {
    base.warnings.push(`pdf_decode_error:${err.code || 'unknown'}`);
    return base;
  }

  base.rawExcerpt = rawText.slice(0, 500);

  if (!rawText.trim()) {
    base.warnings.push('empty_pdf_text');
    return base;
  }

  // Header fields — simple regex extraction
  const orderIdMatch = rawText.match(/(?:Order\s*(?:ID|Number|#)|Specimen\s*#)\s*[:\s]+([A-Z0-9\-]{4,})/i);
  if (orderIdMatch) base.labOrderId = orderIdMatch[1].trim();

  const orderedMatch = rawText.match(/(?:Date\s*Collected|Collection\s*Date|Ordered)\s*[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}(?:\s+[0-9:]+(?:\s*[AP]M)?)?)/i);
  if (orderedMatch) base.orderedAt = normalizeDate(orderedMatch[1]);

  const resultedMatch = rawText.match(/(?:Date\s*Reported|Report\s*Date|Resulted)\s*[:\s]+([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4}(?:\s+[0-9:]+(?:\s*[AP]M)?)?)/i);
  if (resultedMatch) base.resultedAt = normalizeDate(resultedMatch[1]);

  // Result rows — expected shape per LabCorp mock fixtures:
  //   "Test Name ........ value unit refRange flag"
  // or the simpler form used in our fixtures:
  //   "TEST_NAME | VALUE | UNIT | REF_RANGE | FLAG"
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const row = tryParseResultLine(line);
    if (row) base.results.push(row);
  }

  if (base.results.length === 0) {
    base.warnings.push('no_results_extracted');
  }

  base.ok = base.results.length > 0;
  return base;
}

// Parse a single result line. Supports two delimiters:
//   (a) pipe-delimited (used by our mock fixtures): "Name | 123 | mg/dL | 70-99 | H"
//   (b) whitespace columns ending in a flag: "Name 123 mg/dL 70-99 H"
//
// The first form is unambiguous; the second is heuristic and only used if the
// first doesn't match. Lines that look like headers or dividers are skipped.
function tryParseResultLine(line) {
  if (!line || line.length < 5) return null;
  if (/^[-=_]{4,}$/.test(line)) return null; // divider
  if (/^(?:PATIENT|ORDER|REPORT|PAGE|COLLECTION|RECEIVED|SPECIMEN)\b/i.test(line)) return null;

  // Pipe-delimited form
  if (line.includes('|')) {
    const parts = line.split('|').map((p) => p.trim());
    if (parts.length >= 3) {
      const [code, valueStr, unit = null, refRange = null, flagRaw = null] = parts;
      if (!code || !valueStr) return null;
      if (/^(test|name|result|value)$/i.test(code)) return null; // header row
      return buildResultRow(code, valueStr, unit, refRange, flagRaw);
    }
  }

  // Whitespace form — look for "Name  value  unit  range  flag"
  // Require at least: word(s) followed by a number
  const m = line.match(/^([A-Za-z][A-Za-z0-9 ()\-\/,]+?)\s+([<>]?[0-9]+(?:\.[0-9]+)?)\s+([A-Za-z\/%µμ0-9\^]+)?(?:\s+([0-9.\-<>]+(?:\s*-\s*[0-9.]+)?))?(?:\s+(H|L|HH|LL|N|A))?\s*$/);
  if (m) {
    const [, code, valueStr, unit, refRange, flagRaw] = m;
    return buildResultRow(code, valueStr, unit, refRange, flagRaw);
  }

  return null;
}

function buildResultRow(code, valueStr, unit, refRange, flagRaw) {
  let value = valueStr;
  const numeric = parseFloat(valueStr);
  if (!Number.isNaN(numeric) && /^[<>]?[0-9]+(\.[0-9]+)?$/.test(valueStr.trim())) {
    value = numeric;
  }
  return {
    code: code.trim(),
    displayName: code.trim(),
    value,
    unit: unit ? unit.trim() : null,
    refRange: refRange ? refRange.trim() : null,
    abnormalFlag: flagRaw ? flagRaw.trim().toUpperCase() : null,
    resultedAt: null
  };
}

// ==========================================
// XML PARSING
// ==========================================

/**
 * Parse a LabCorp XML result buffer. We accept two flavors:
 *
 *   1. HL7 V2-over-XML envelope (`<ORU_R01><PATIENT_RESULT>...</PATIENT_RESULT></ORU_R01>`)
 *      The real LabCorp wire format is HL7 v2 pipe-delimited, but some customers
 *      receive a pre-wrapped XML envelope. We support a simplified form here.
 *
 *   2. A LabCorp-specific `<LabCorpResult>` wrapper used in our mock fixtures
 *      for deterministic tests. This is the preferred fixture format because
 *      it's readable.
 *
 * @param {Buffer} buffer
 * @returns {Object}
 */
function parseXmlResult(buffer) {
  const base = {
    ok: false,
    source: 'labcorp_xml',
    labOrderId: null,
    orderedAt: null,
    resultedAt: null,
    patient: null,
    results: [],
    warnings: [],
    rawExcerpt: ''
  };

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    base.warnings.push('empty_or_invalid_buffer');
    return base;
  }

  const xml = buffer.toString('utf8');
  base.rawExcerpt = xml.slice(0, 500);

  const parser = getXmlParser();
  if (!parser) {
    base.warnings.push('xml_parser_unavailable');
    return base;
  }

  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    base.warnings.push(`xml_decode_error:${err.code || 'unknown'}`);
    return base;
  }

  // Try the LabCorpResult shape first
  const lc = parsed?.LabCorpResult || parsed?.labcorpResult;
  if (lc) {
    base.labOrderId = lc.orderId || lc['@_orderId'] || null;
    base.orderedAt = normalizeDate(lc.orderedAt);
    base.resultedAt = normalizeDate(lc.resultedAt);
    if (lc.patient) {
      base.patient = {
        firstName: lc.patient.firstName || null,
        lastName: lc.patient.lastName || null,
        dob: lc.patient.dob || null
      };
    }
    const rows = lc.results?.result;
    const rowArray = Array.isArray(rows) ? rows : rows ? [rows] : [];
    for (const r of rowArray) {
      base.results.push({
        code: String(r.code || r.name || '').trim(),
        displayName: String(r.displayName || r.name || r.code || '').trim(),
        value: normalizeValue(r.value),
        unit: r.unit || null,
        refRange: r.refRange || r.referenceRange || null,
        abnormalFlag: (r.flag || r.abnormalFlag || null),
        resultedAt: normalizeDate(r.resultedAt) || base.resultedAt
      });
    }
    base.ok = base.results.length > 0;
    if (!base.ok) base.warnings.push('no_results_in_xml');
    return base;
  }

  // Minimal HL7-V2-over-XML fallback: walk OBX segments
  const obxNodes = findAll(parsed, 'OBX');
  for (const obx of obxNodes) {
    const code = String(obx?.['OBX.3']?.['CE.2'] || obx?.['OBX.3'] || '').trim();
    const value = normalizeValue(obx?.['OBX.5']);
    const unit = obx?.['OBX.6'] || null;
    const refRange = obx?.['OBX.7'] || null;
    const flag = obx?.['OBX.8'] || null;
    if (!code) continue;
    base.results.push({
      code,
      displayName: code,
      value,
      unit: unit ? String(unit) : null,
      refRange: refRange ? String(refRange) : null,
      abnormalFlag: flag ? String(flag) : null,
      resultedAt: null
    });
  }

  base.ok = base.results.length > 0;
  if (!base.ok) base.warnings.push('no_results_in_xml');
  return base;
}

// Helper: walk an arbitrary parsed XML tree looking for all nodes with a given
// key name. Used by the HL7 fallback path.
function findAll(node, key, out = []) {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === key) {
      if (Array.isArray(v)) out.push(...v);
      else out.push(v);
    } else {
      findAll(v, key, out);
    }
  }
  return out;
}

// ==========================================
// SHARED HELPERS
// ==========================================

function normalizeValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return raw;
  const str = String(raw).trim();
  if (!str) return null;
  const asNum = parseFloat(str);
  if (!Number.isNaN(asNum) && /^[<>]?[0-9]+(\.[0-9]+)?$/.test(str)) return asNum;
  return str;
}

function normalizeDate(raw) {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;
  // Pass through ISO 8601
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str;
  // MM/DD/YYYY or MM-DD-YYYY
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const [, mo, day, yr] = m;
    const year = yr.length === 2 ? `20${yr}` : yr;
    return `${year}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return str; // fall through — downstream will treat as unparseable
}

module.exports = {
  parsePdfResult,
  parseXmlResult,
  // Internal helpers exported only for unit tests
  _internal: {
    tryParseResultLine,
    normalizeDate,
    normalizeValue,
    findAll
  }
};
