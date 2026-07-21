import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/auth/require";
import { getLayout, upsertLayout } from "@/lib/dashboard/layout-store";

export const runtime = "nodejs";

const LayoutItem = z.object({
  i: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  minW: z.number().optional(), minH: z.number().optional(),
});
const LayoutBodySchema = z.object({
  activeWidgets: z.array(z.string()),
  layout: z.array(LayoutItem),
  preset: z.string().nullable().default(null),
});

export async function GET(): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const row = await getLayout(auth.user.sub);
  return NextResponse.json(row);
}

export async function PUT(req: Request): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const parsed = LayoutBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const row = await upsertLayout(auth.user.sub, parsed.data);
  return NextResponse.json(row);
}