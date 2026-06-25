"use client";

export function CreateClientPODialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div />;
}
