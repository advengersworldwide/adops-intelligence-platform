export async function uploadPoAttachment(file: File): Promise<{ url: string; name: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/uploads/po-attachment", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}
