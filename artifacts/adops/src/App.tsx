import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import Layout from "@/components/layout/Layout";
import DashboardPage from "@/pages/Dashboard";
import ClientsPage from "@/pages/Clients";
import PartnersPage from "@/pages/Partners";
import PartnerDetailPage from "@/pages/PartnerDetail";
import BuyingHousesPage from "@/pages/BuyingHouses";
import BuyingHouseDetailPage from "@/pages/BuyingHouseDetail";
import ClientDetailPage from "@/pages/ClientDetail";
import TransactionsPage from "@/pages/Transactions";
import BillingsPage from "@/pages/Billings";
import PaymentsPage from "@/pages/Payments";
import CostPage from "@/pages/Cost";
import UploadPage from "@/pages/Upload";
import AnalyticsPage from "@/pages/Analytics";
import SettingsPage from "@/pages/Settings";
import LoginPage from "@/pages/Login";
import NotFound from "@/pages/not-found";
import { getCurrentUser, hasPermission, getRoles, setCachedRoles } from "@/lib/auth";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
      <div className="rounded-full bg-red-50 dark:bg-red-950/30 p-4 text-red-600 dark:text-red-400">
        <ShieldAlert className="h-12 w-12 animate-pulse" />
      </div>
      <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your account role does not have the permissions required to access this module. Please contact your system administrator.
      </p>
      <Link href="/">
        <Button variant="outline" className="mt-2 text-xs">
          Return to Dashboard
        </Button>
      </Link>
    </div>
  );
}

interface GuardProps {
  permission: string;
  component: React.ComponentType;
}

function PermissionGuard({ permission, component: Component }: GuardProps) {
  if (!hasPermission(permission)) {
    return <AccessDenied />;
  }
  return <Component />;
}

function Router() {
  const user = getCurrentUser();
  const [rolesLoaded, setRolesLoaded] = useState(false);

  // Populate the roles cache so hasPermission() works synchronously
  useEffect(() => {
    getRoles().then((roles) => {
      setCachedRoles(roles);
      setRolesLoaded(true);
    });
  }, []);

  if (!user) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route>
          <Redirect to="/login" />
        </Route>
      </Switch>
    );
  }

  // Wait for roles to load before evaluating PermissionGuards for non-admins
  if (!rolesLoaded && user.role !== "System Admin") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/login">
          <Redirect to="/" />
        </Route>

        <Route path="/">
          <PermissionGuard permission="View Dashboard" component={DashboardPage} />
        </Route>

        <Route path="/clients">
          <PermissionGuard permission="View Clients" component={ClientsPage} />
        </Route>

        <Route path="/clients/:id">
          {(params) => (
            <PermissionGuard permission="View Clients" component={() => <ClientDetailPage id={parseInt(params.id!, 10)} />} />
          )}
        </Route>

        <Route path="/buying-houses">
          <PermissionGuard permission="View Buying Houses" component={BuyingHousesPage} />
        </Route>

        <Route path="/buying-houses/:id">
          {(params) => (
            <PermissionGuard permission="View Buying Houses" component={() => <BuyingHouseDetailPage id={parseInt(params.id!, 10)} />} />
          )}
        </Route>

        <Route path="/partners">
          <PermissionGuard permission="View Partners" component={PartnersPage} />
        </Route>

        <Route path="/partners/:id">
          {(params) => (
            <PermissionGuard permission="View Partners" component={() => <PartnerDetailPage id={parseInt(params.id!, 10)} />} />
          )}
        </Route>

        <Route path="/transactions">
          <PermissionGuard permission="View Transactions" component={TransactionsPage} />
        </Route>

        <Route path="/billings">
          <PermissionGuard permission="View Billings" component={BillingsPage} />
        </Route>

        <Route path="/payments">
          <PermissionGuard permission="View Payments" component={PaymentsPage} />
        </Route>

        <Route path="/cost">
          <PermissionGuard permission="View Cost" component={CostPage} />
        </Route>

        <Route path="/upload">
          <PermissionGuard permission="Upload Data" component={UploadPage} />
        </Route>

        <Route path="/analytics">
          <PermissionGuard permission="View Analytics" component={AnalyticsPage} />
        </Route>

        <Route path="/settings">
          <PermissionGuard permission="Manage Settings" component={SettingsPage} />
        </Route>

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
