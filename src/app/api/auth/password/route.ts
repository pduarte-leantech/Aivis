import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readJson } from '@/lib/body';
import { checkOrigin, ApiError } from '@/lib/auth';
import { isConfigured, sessionDb } from '@/lib/supabase';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (!isConfigured()) throw new ApiError(503, 'Supabase não configurado.');
    const { password } = z
      .object({ password: z.string().min(12).max(128) })
      .strict()
      .parse(await readJson(request));
    const db = await sessionDb();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user)
      throw new ApiError(401, 'O convite expirou. Solicite um novo acesso ao administrador.');
    const { error } = await db.auth.updateUser({ password });
    if (error)
      throw new ApiError(
        400,
        'A senha não foi aceita. Escolha uma senha forte e não comprometida.',
      );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof ApiError ? e.message : 'A senha deve ter entre 12 e 128 caracteres.' },
      { status: e instanceof ApiError ? e.status : 422 },
    );
  }
}
