import { connection } from 'next/server';
import { listDirections } from '../../../lib/obligations';

/** The 35 indexed Directions, with whether a checklist has been generated for each. */
export async function GET() {
  // Read fresh data on every request (otherwise Next.js may prerender this at build time).
  await connection();
  try {
    return Response.json({ directions: listDirections() });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Could not list Directions.' }, { status: 500 });
  }
}
