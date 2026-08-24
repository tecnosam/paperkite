import { NextResponse } from 'next/server';
import { getLiveStatus } from '@/lib/status';

export const dynamic = 'force-dynamic';

export async function GET() {
  const status = await getLiveStatus();
  return NextResponse.json(status);
}
