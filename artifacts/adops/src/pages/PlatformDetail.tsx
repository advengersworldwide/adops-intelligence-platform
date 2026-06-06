import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useGetPlatform } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PlatformDetailsTab from "./PlatformDetail/DetailsTab";
import PlatformDataTab from "./PlatformDetail/DataTab";
import PlatformAnalyticsTab from "./PlatformDetail/AnalyticsTab";

export default function PlatformDetailPage({ id }: { id: number }) {
  const { data: platform, isLoading } = useGetPlatform(id);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/platforms" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {isLoading ? (
          <Skeleton className="h-7 w-48" />
        ) : (
          <h1 className="text-xl font-bold text-foreground">{platform?.name}</h1>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : platform ? (
        <Tabs defaultValue="details">
          <TabsList className="mb-4">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>
          <TabsContent value="details">
            <PlatformDetailsTab platform={platform} />
          </TabsContent>
          <TabsContent value="data">
            <PlatformDataTab platformId={id} platform={platform} />
          </TabsContent>
          <TabsContent value="analytics">
            <PlatformAnalyticsTab platformId={id} platform={platform} />
          </TabsContent>
        </Tabs>
      ) : (
        <p className="text-sm text-muted-foreground">Platform not found.</p>
      )}
    </div>
  );
}
