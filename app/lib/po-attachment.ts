export async function uploadPoAttachment(file: File): Promise<{ url: string; name: string }> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/uploads/po-attachment", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

/** Upload several files in parallel, preserving order. */
export async function uploadPoAttachments(files: File[]): Promise<{ url: string; name: string }[]> {
  return Promise.all(files.map((f) => uploadPoAttachment(f)));
}
