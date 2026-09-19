/**
 * GET /api/track-record
 *
 * Read-only feed of stored scans behind the public track record page.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { countScans, listScans } from '@/lib/store/scans';

export async function GET(request: NextRequest) {
  const limitParam = request.nextUrl.searchParams.get('limit');
  const token = request.nextUrl.searchParams.get('token');
  const limit = Number(limitParam ?? 50);

  try {
    const scans = await listScans({
      limit: Number.isFinite(limit) ? limit : 50,
      token: token ?? undefined,
    });

    return NextResponse.json(
      { total: await countScans(), returned: scans.length, scans },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    console.error('[rugshield] /api/track-record failed:', err);
    return NextResponse.json(
      { error: 'STORE_UNAVAILABLE', message: 'Scan history could not be read.' },
      { status: 500 },
    );
  }
}
