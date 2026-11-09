import { connection } from 'next/server';
import { cachedReport, checkForUpdates } from '../../../lib/updates';

/**
 * Compares the indexed Directions with the RBI's Master Directions page.
 * GET /api/updates            last saved check (no network call)
 * GET /api/updates?check=1    check now (uses a result under 12 hours old)
 * GET /api/updates?refresh=1  check now, ignoring any saved result
 */
export async function GET(req: Request) {
  await connection();
  const url = new URL(req.url);
  const refresh = url.searchParams.get('refresh') === '1';
  if (!refresh && url.searchParams.get('check') !== '1') {
    return Response.json({ report: cachedReport() });
  }
  const report = await checkForUpdates(refresh);
  return Response.json({ report }, { status: report.ok ? 200 : 502 });
}
