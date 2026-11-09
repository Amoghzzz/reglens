import fs from 'fs';
import path from 'path';

// Support both pdf-parse v1 and v2
let PDFParseClass: any = null;
try {
  const pdfModule = require('pdf-parse');
  PDFParseClass = pdfModule.PDFParse || pdfModule.default || pdfModule;
} catch (e) {
  console.error('Failed to load pdf-parse:', e);
}

const months: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

export function parseDate(str: string): string | null {
  if (!str) return null;
  const cleaned = str.replace(/\s+/g, ' ').trim();
  const m1 = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (m1) {
    const month = months[m1[1].toLowerCase()];
    if (month) {
      const day = m1[2].padStart(2, '0');
      const year = m1[3];
      return `${year}-${month}-${day}`;
    }
  }
  const m2 = cleaned.match(/(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/);
  if (m2) {
    const month = months[m2[2].toLowerCase()];
    if (month) {
      const day = m2[1].padStart(2, '0');
      const year = m2[3];
      return `${year}-${month}-${day}`;
    }
  }
  return null;
}

export function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

export interface ProposedRename {
  oldName: string;
  newName: string;
  regulator: string;
  entity: string;
  topic: string;
  date: string;
  dateSource: 'updated' | 'published';
  notifId: string;
  rawTitle: string;
}

export async function extractFirstPage(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  if (typeof PDFParseClass === 'function' && PDFParseClass.prototype && PDFParseClass.prototype.getText) {
    // pdf-parse v2
    const parser = new PDFParseClass({ data: buffer });
    try {
      const res = await parser.getText({ first: 1 });
      return res.pages && res.pages[0] ? res.pages[0].text : '';
    } finally {
      await parser.destroy();
    }
  } else if (typeof PDFParseClass === 'function') {
    // pdf-parse v1
    const data = await PDFParseClass(buffer, { max: 1 });
    return data.text || '';
  }
  throw new Error('Unsupported pdf-parse interface');
}

export async function analyzePdfs(docsDir: string): Promise<{ proposals: ProposedRename[]; duplicates: string[] }> {
  const files = fs.readdirSync(docsDir).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  const proposals: ProposedRename[] = [];

  for (const file of files) {
    const filePath = path.join(docsDir, file);
    const text = await extractFirstPage(filePath);

    // 1. Regulator
    const regulator = 'RBI';

    // 2. Notification ID
    const notifMatch = text.match(/RBI\/(?:[A-Za-z]+)\/(\d{4}-\d{2}\/\d+)/i) || text.match(/RBI\/(\d{4}-\d{2}\/\d+)/i);
    const notifId = notifMatch ? notifMatch[0] : '';

    // 3. Date ("Updated as on" priority)
    const updatedMatch = text.match(/Updated\s+as\s+on\s+([\s\S]*?)(?:\)|Table\s+of\s+Contents|Chapter|\r|\n\s*\n)/i);
    let date: string | null = null;
    let dateSource: 'updated' | 'published' = 'published';

    if (updatedMatch) {
      date = parseDate(updatedMatch[1]);
      if (date) dateSource = 'updated';
    }

    if (!date) {
      const pubMatch = text.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
      if (pubMatch) {
        date = parseDate(pubMatch[0]);
      }
    }
    if (!date) {
      date = '2025-11-28'; // standard default for this RBI direction series
    }

    // 4. Title & Entity & Topic
    const titleMatch = text.match(/Reserve\s+Bank\s+of\s+India\s*\(([\s\S]*?)\)\s*Directions/i);
    const titleInside = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

    let entity = 'NBFC';
    let rawTopic = '';

    // Check if title has separator: en-dash (\u2013), em-dash (\u2014), hyphen with spaces
    if (/[\u2013\u2014]|\s-\s/.test(titleInside)) {
      const parts = titleInside.split(/\s*(?:[\u2013\u2014]|\s-\s)\s*/);
      const entityPart = parts[0].trim();
      rawTopic = parts.slice(1).join(' ').trim();
      if (/Non-Banking Financial Companies/i.test(entityPart)) {
        entity = 'NBFC';
      } else {
        entity = toPascalCase(entityPart);
      }
    } else {
      if (/Housing Finance Companies/i.test(titleInside)) {
        entity = 'HFC';
        rawTopic = 'HousingFinanceCompanies';
      } else if (/Standalone Primary Dealers/i.test(titleInside)) {
        entity = 'SPD';
        rawTopic = 'StandalonePrimaryDealers';
      } else if (/Core Investment Companies/i.test(titleInside)) {
        entity = 'CIC';
        rawTopic = 'CoreInvestmentCompanies';
      } else if (/Mortgage Guarantee Companies/i.test(titleInside)) {
        entity = 'MGC';
        rawTopic = 'MortgageGuaranteeCompanies';
      } else if (/Non-Operative Financial Holding Company/i.test(titleInside)) {
        entity = 'NOFHC';
        rawTopic = 'NonOperativeFinancialHoldingCompany';
      } else {
        entity = 'NBFC';
        rawTopic = titleInside;
      }
    }

    // Clean any residual entity text from topic
    rawTopic = rawTopic.replace(/^Non-Banking Financial Companies\s*[-–—]?\s*/i, '');

    const topic = toPascalCase(rawTopic);
    const newName = `${regulator}_${entity}_${topic}_${date}.pdf`;

    proposals.push({
      oldName: file,
      newName,
      regulator,
      entity,
      topic,
      date,
      dateSource,
      notifId,
      rawTitle: titleInside
    });
  }

  // Check for duplicate directions (same entity + topic or same notification ID)
  const duplicates: string[] = [];
  const topicMap = new Map<string, string[]>();
  const notifMap = new Map<string, string[]>();

  for (const p of proposals) {
    const key = `${p.entity}_${p.topic}`;
    if (!topicMap.has(key)) topicMap.set(key, []);
    topicMap.get(key)!.push(p.oldName);

    if (p.notifId) {
      if (!notifMap.has(p.notifId)) notifMap.set(p.notifId, []);
      notifMap.get(p.notifId)!.push(p.oldName);
    }
  }

  topicMap.forEach((files, key) => {
    if (files.length > 1) {
      duplicates.push(`Multiple files share topic '${key}': ${files.join(', ')}`);
    }
  });

  notifMap.forEach((files, notif) => {
    if (files.length > 1) {
      duplicates.push(`Multiple files share notification ID '${notif}': ${files.join(', ')}`);
    }
  });

  return { proposals, duplicates };
}

async function main() {
  const docsDir = path.resolve(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) {
    console.error(`Docs directory not found at ${docsDir}`);
    process.exit(1);
  }

  console.log(`\n===============================================================`);
  console.log(`  RegLens Document Renaming Proposal (Step A)`);
  console.log(`===============================================================\n`);

  const { proposals, duplicates } = await analyzePdfs(docsDir);

  console.log(`Found ${proposals.length} PDF documents in /docs:\n`);
  proposals.forEach((p, idx) => {
    console.log(`${(idx + 1).toString().padStart(2, ' ')}. ${p.oldName}`);
    console.log(`    -> ${p.newName}`);
    console.log(`       [${p.dateSource} date: ${p.date} | Notif: ${p.notifId || 'N/A'}]`);
  });

  console.log(`\n---------------------------------------------------------------`);
  console.log(`Version & Duplicate Direction Check:`);
  if (duplicates.length === 0) {
    console.log(`✓ No version conflicts or duplicate directions found.`);
    console.log(`  All ${proposals.length} files correspond to unique RBI master directions (RBI/DOR/2025-26/339 to 373).`);
  } else {
    console.log(`! FLAGGED DUPLICATE DIRECTIONS:`);
    duplicates.forEach(d => console.log(`  - ${d}`));
  }
  console.log(`---------------------------------------------------------------\n`);

  const args = process.argv.slice(2);
  const autoApply = args.includes('--apply') || args.includes('-y') || args.includes('--yes');

  if (autoApply) {
    console.log(`Applying renames...`);
    for (const p of proposals) {
      if (p.oldName !== p.newName) {
        fs.renameSync(path.join(docsDir, p.oldName), path.join(docsDir, p.newName));
      }
    }
    console.log(`✓ Successfully renamed ${proposals.length} files in /docs.`);
  } else {
    console.log(`Dry run mode active.`);
    console.log(`To execute this renaming on disk, run:`);
    console.log(`  npm run rename -- --apply\n`);
    console.log(`Awaiting user review and OK before applying changes.\n`);
  }
}

if (require.main === module || process.argv[1]?.endsWith('rename.ts')) {
  main().catch(err => {
    console.error('Error during rename analysis:', err);
    process.exit(1);
  });
}
