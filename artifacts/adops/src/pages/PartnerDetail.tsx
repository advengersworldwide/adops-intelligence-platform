import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useGetPartner } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PartnerDetailsTab from "./PartnerDetail/DetailsTab";
import PartnerClientsTab from "./PartnerDetail/ClientsTab";
import PlatformDataTab from "./PartnerDetail/DataTab";
import PlatformAnalyticsTab from "./PartnerDetail/AnalyticsTab";

export default function PartnerDetailPage({ id }: { id: number }) {
  const { data: partner, isLoading } = useGetPartner(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/partners" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {isLoading ? (
          <Skeleton className="h-7 w-48" />
        ) : (
          <h1 className="text-xl font-bold text-foreground">{partner?.name}</h1>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : partner ? (
        <Tabs defaultValue="details">
          <TabsList className="mb-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="clients">Clients</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <PartnerDetailsTab partner={partner} />
          </TabsContent>
          <TabsContent value="clients">
            <PartnerClientsTab partnerId={id} />
          </TabsContent>
          <TabsContent value="data">
            <PlatformDataTab platformId={id} platform={partner} />
          </TabsContent>
          <TabsContent value="analytics">
            <PlatformAnalyticsTab platformId={id} platform={partner} />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">Partner not found.</p>
      )}
    </div>
  );
}
