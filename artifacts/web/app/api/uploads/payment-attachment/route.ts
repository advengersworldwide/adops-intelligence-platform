import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return createClient(url, key);
}

export async function POST(req: Request): Promise<Response> {
  let formData: FormData;
  try { formData = await req.formData(); } catch { return NextResponse.json({ error: "Invalid form data" }, { status: 400 }); }
  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const originalName = file instanceof File ? file.name : "upload.bin";
  const ext = originalName.split(".").pop() ?? "bin";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const supabase = getSupabase();
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await supabase.storage.from("payment-attachments").upload(path, buffer, { contentType: file.type });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from("payment-attachments").getPublicUrl(path);
    return NextResponse.json({ url: publicUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}
