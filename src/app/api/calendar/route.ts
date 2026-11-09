import { connection } from 'next/server';
import { allCachedChecklists, chunksFor, listDirections, type Obligation } from '../../../lib/obligations';

/** Every dated obligation (periodic, deadline or event-driven) across the checklists generated so far. */
export async function GET() {
  // Read fresh data on every request (otherwise Next.js may prerender this at build time).
  await connection();
  try {
    const directions = listDirections();
    const checklists = allCachedChecklists();
    const items: (Obligation & { document: string; title: string; entity: string; date: string })[] = [];
    for (const c of checklists) {
      for (const it of c.items) {
        if (it.timing.kind === 'ongoing') continue;
        items.push({ ...it, document: c.document, title: c.title, entity: c.entity, date: c.date });
      }
    }
    return Response.json({
      items,
      chunks: chunksFor(items),
      built: checklists.length,
      total: directions.length,
      missing: directions.filter((d) => !d.hasChecklist).map((d) => ({ document: d.document, shortTitle: d.shortTitle })),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Could not build the calendar.' }, { status: 500 });
  }
}
