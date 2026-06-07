import { Router, type IRouter } from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set");
  return createClient(url, key);
}

router.post("/uploads/payment-attachment", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }
  try {
    const supabase = getSupabase();
    const ext = req.file.originalname.split(".").pop() ?? "bin";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage
      .from("payment-attachments")
      .upload(path, req.file.buffer, { contentType: req.file.mimetype });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from("payment-attachments").getPublicUrl(path);
    res.json({ url: publicUrl });
  } catch (err) {
    console.error("[file-upload]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Upload failed" });
  }
});

export default router;