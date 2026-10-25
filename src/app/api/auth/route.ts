import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readJson } from '@/lib/body';
import { ApiError, checkOrigin } from '@/lib/auth';
import { isConfigured, sessionDb } from '@/lib/supabase';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (!isConfigured()) throw new ApiError(503, 'Configure o Supabase antes de entrar.');
    const body = z
      .object({ email: z.email(), password: z.string().min(8).max(128) })
      .parse(await readJson(request));
    const db = await sessionDb();
    const { error } = await db.auth.signInWithPassword(body);
    if (error) throw new ApiError(401, 'E-mail ou senha inválidos.');
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof ApiError ? error.message : 'Verifique o e-mail e a senha.' },
      { status: error instanceof ApiError ? error.status : 400 },
    );
  }
}
export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    if (!isConfigured()) throw new ApiError(503, 'Supabase não configurado.');
    const db = await sessionDb();
    await db.auth.signOut();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível sair.' }, { status: 400 });
  }
}
