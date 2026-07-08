// ============================================================
// Meesho LOD — Deterministic paste/CSV parser
// Zero-dependency. Handles CSV / TSV / pipe / semicolon pastes,
// header auto-detection, Indian phone normalization, in-paste
// dedupe. Used as the fast path + safety net around the AI parse.
// ============================================================

const FIELD_SYNONYMS = {
  phone: ['phone', 'phonenumber', 'number', 'mobile', 'contact', 'contactnumber', 'mobileno', 'phoneno', 'msisdn', 'whatsapp'],
  name: ['name', 'customername', 'customer', 'username', 'fullname', 'sellername', 'employeename', 'contactname'],
  ext_id: ['meeshouserid', 'userid', 'id', 'customerid', 'sellerid', 'employeeid', 'empid', 'uid'],
};

export function canonField(header) {
  const h = String(header || '').toLowerCase().replace(/[^a-z]/g, '');
  for (const [canon, syns] of Object.entries(FIELD_SYNONYMS)) {
    if (syns.includes(h)) return canon;
  }
  return null;
}

// slugify a raw header into a stable data key: "Days since last PDP" → days_since_last_pdp
export function slugKey(header, idx) {
  const s = String(header || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
  return s || `col_${idx}`;
}

// RFC-4180-ish single line parser (handles quoted cells, "" escapes)
export function parseDelimitedLine(line, delim) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(c => c.trim());
}

// Sniff delimiter: tab > pipe > semicolon > comma
export function sniffDelim(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  if (first.includes('\t')) return '\t';
  if (first.includes('|')) return '|';
  if ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length) return ';';
  return ',';
}

// Normalize to Indian 10-digit; returns array (handles "+919158129775, +918237867628" blobs)
export function phoneCandidates(raw) {
  const out = [];
  for (const piece of String(raw || '').split(/[,;/]| {2,}/)) {
    let d = piece.replace(/\D/g, '');
    if (!d) continue;
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    if (d.length === 10 && /^[6-9]/.test(d)) { out.push(d); continue; }
    // concatenated multi-number blob
    if (d.length > 10 && d.length % 10 === 0) {
      for (let i = 0; i < d.length; i += 10) {
        const chunk = d.slice(i, i + 10);
        if (/^[6-9]/.test(chunk)) out.push(chunk);
      }
    }
  }
  return [...new Set(out)];
}

export function formatPhone(p) {
  const d = String(p).replace(/\D/g, '');
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : p;
}

// Main entry: raw pasted text → { columns, rows, invalid, dup, hasHeader }
// columns: [{ key, label }] — every non-core column preserved into row.data
// rows:    [{ name, phone, phones, ext_id, data: {key: value} }]
export function parseContactsDeterministic(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { columns: [], rows: [], invalid: 0, dup: 0, hasHeader: false };

  const delim = sniffDelim(text);
  const firstCells = parseDelimitedLine(lines[0], delim);
  const headerCanon = firstCells.map(canonField);
  const hasHeader = headerCanon.includes('phone') &&
    firstCells.some(c => /[a-z]/i.test(c) && !/\d{7}/.test(c));

  const rows = [];
  const seen = new Set();
  let invalid = 0, dup = 0;
  let columns = [];

  if (hasHeader) {
    const keys = firstCells.map((h, i) => headerCanon[i] || slugKey(h, i));
    columns = firstCells
      .map((h, i) => ({ key: keys[i], label: String(h).trim() || keys[i] }))
      .filter(c => !['phone', 'name', 'ext_id'].includes(c.key));
    const phoneIdx = headerCanon.indexOf('phone');
    const nameIdx = headerCanon.indexOf('name');
    const idIdx = headerCanon.indexOf('ext_id');

    for (const line of lines.slice(1)) {
      const cells = parseDelimitedLine(line, delim);
      const phones = phoneCandidates(cells[phoneIdx]);
      if (!phones.length) { invalid++; continue; }
      if (seen.has(phones[0])) { dup++; continue; }
      seen.add(phones[0]);
      const data = {};
      cells.forEach((v, i) => {
        if (i === phoneIdx || i === nameIdx || i === idIdx) return;
        const val = String(v ?? '').trim();
        if (val) data[keys[i]] = val;
      });
      rows.push({
        name: nameIdx >= 0 ? String(cells[nameIdx] || '').trim() : '',
        phone: phones[0],
        phones,
        ext_id: idIdx >= 0 ? String(cells[idIdx] || '').trim() : '',
        data,
      });
    }
  } else {
    // loose mode: pull phones out of free text; leftover text on the line = name
    for (const line of lines) {
      const m = line.match(/\+?\d[\d\s().-]{7,}\d/g);
      if (!m) { invalid++; continue; }
      const phones = m.flatMap(phoneCandidates);
      if (!phones.length) { invalid++; continue; }
      if (seen.has(phones[0])) { dup++; continue; }
      seen.add(phones[0]);
      let name = line;
      for (const raw of m) name = name.replace(raw, ' ');
      name = name.replace(/[,;|\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      rows.push({ name: /[a-z]/i.test(name) ? name : '', phone: phones[0], phones, ext_id: '', data: {} });
    }
  }

  return { columns, rows, invalid, dup, hasHeader };
}

export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers, rowsArr) {
  return [headers.map(csvEscape).join(','), ...rowsArr.map(r => r.map(csvEscape).join(','))].join('\n');
}
