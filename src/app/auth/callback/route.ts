import { NextResponse } from 'next/server';
import { isConfigured, sessionDb } from '@/lib/supabase';
import type { EmailOtpType } from '@supabase/supabase-js';
export async function GET(request: Request) {
  const url = new URL(request.url),
    base = process.env.APP_URL || url.origin;
  if (!isConfigured()) return NextResponse.redirect(`${base}/access?error=configuration`);
  const db = await sessionDb(),
    code = url.searchParams.get('code'),
    hash = url.searchParams.get('token_hash'),
    type = url.searchParams.get('type');
  if (code) {
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${base}/access`);
  }
  if (hash && type && ['invite', 'recovery'].includes(type)) {
    const { error } = await db.auth.verifyOtp({ token_hash: hash, type: type as EmailOtpType });
    if (!error) return NextResponse.redirect(`${base}/access`);
  }
  return NextResponse.redirect(`${base}/access?error=expired`);
}
