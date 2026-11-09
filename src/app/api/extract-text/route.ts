import type { NextRequest } from 'next/server';

/** Extracts text from an uploaded PDF so it can be checked against a Direction. Text files are read in the browser. */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return Response.json({ error: 'No file received.' }, { status: 400 });
    if (file.size > 15 * 1024 * 1024) return Response.json({ error: 'Please upload a PDF under 15 MB.' }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('pdf-parse');
    const PDFParse = mod.PDFParse || mod.default || mod;
    let text = '';
    if (typeof PDFParse === 'function' && PDFParse.prototype?.getText) {
      const parser = new PDFParse({ data: buffer });
      try {
        const res = await parser.getText();
        text = res.text || (res.pages || []).map((p: any) => p.text || '').join('\n');
      } finally {
        await parser.destroy?.();
      }
    } else if (typeof PDFParse === 'function') {
      text = (await PDFParse(buffer)).text || '';
    }
    text = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return Response.json({ error: 'No text found in that PDF. If it is a scan, paste the text instead.' }, { status: 422 });
    return Response.json({ text, chars: text.length });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Could not read that file.' }, { status: 500 });
  }
}
