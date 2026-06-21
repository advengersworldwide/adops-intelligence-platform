"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPartnerClients, useLinkPartnerClient, useUnlinkPartnerClient, useSetPartnerEventPayout,
  useListClients, getListPartnerClientsQueryKey,
  type PartnerClientEvent,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useHasPermission } from "@/lib/auth/user-context";

export default function PartnerClientsTab({ partnerId }: { partnerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const canEdit = useHasPermission("Edit Partners");
  const invalidate = () => qc.invalidateQueries({ queryKey: getListPartnerClientsQueryKey(partnerId) });

  const { data: partnerClients } = useListPartnerClients(partnerId);
  const { data: allClients } = useListClients();
  const link = useLinkPartnerClient({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Client added" }); } } });
  const unlink = useUnlinkPartnerClient({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Client removed" }); } } });
  const setPayout = useSetPartnerEventPayout({ mutation: { onSuccess: () => { invalidate(); toast({ title: "Payout saved" }); } } });

  const [selectClient, setSelectClient] = useState("");
  const linkedIds = new Set((partnerClients ?? []).map(pc => pc.clientId));
  const available = (allClients ?? []).filter(c => !linkedIds.has(c.id));

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="flex gap-2 max-w-md">
          <Select value={selectClient} onValueChange={setSelectClient}>
            <SelectTrigger><SelectValue placeholder="Select a client to add" /></SelectTrigger>
            <SelectContent>
              {available.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button disabled={!selectClient} onClick={() => {
            link.mutate({ id: partnerId, data: { clientId: parseInt(selectClient, 10) } });
            setSelectClient("");
          }}>Add</Button>
        </div>
      )}

      {(partnerClients ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No clients configured for this partner yet.</p>
      ) : (partnerClients ?? []).map(pc => (
        <div key={pc.clientId} className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{pc.clientName}</h3>
              <p className="text-xs text-muted-foreground">Buying House: {pc.buyingHouseName ?? "—"}</p>
            </div>
            {canEdit && (
              <Button variant="ghost" size="icon" onClick={() => unlink.mutate({ id: partnerId, clientId: pc.clientId })} aria-label="Remove client">
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
          </div>
          {pc.events.length === 0 ? (
            <p className="text-xs text-muted-foreground">This client has no events yet. Add events on the client's page.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-2 text-left text-[10px] font-medium text-muted-foreground">Event</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium text-muted-foreground">Cost Model</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium text-muted-foreground">Billable ($)</th>
                  <th className="px-2 py-2 text-left text-[10px] font-medium text-muted-foreground">Payout ($)</th>
                </tr>
              </thead>
              <tbody>
                {pc.events.map(ev => (
                  <PayoutRow
                    key={ev.clientEventId}
                    partnerId={partnerId}
                    clientId={pc.clientId}
                    ev={ev}
                    canEdit={!!canEdit}
                    onSave={(rate) => setPayout.mutate({ id: partnerId, clientId: pc.clientId, eventId: ev.clientEventId, data: { payoutRate: rate } })}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function PayoutRow({ ev, canEdit, onSave }: {
  partnerId: number;
  clientId: number;
  ev: PartnerClientEvent;
  canEdit: boolean;
  onSave: (rate: number) => void;
}) {
  const [val, setVal] = useState(ev.payoutRate != null ? String(ev.payoutRate) : "");
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-2 py-2 text-xs font-medium">{ev.name}</td>
      <td className="px-2 py-2 text-xs text-muted-foreground">{ev.costModelName ?? "—"}</td>
      <td className="px-2 py-2 text-xs">{ev.billableRate}</td>
      <td className="px-2 py-2">
        <Input type="number" className="w-28 h-8" value={val} disabled={!canEdit}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => { const n = Number(val); if (canEdit && val.trim() !== "" && !Number.isNaN(n)) onSave(n); }} />
      </td>
    </tr>
  );
}
