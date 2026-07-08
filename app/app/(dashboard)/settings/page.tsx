"use client";

import { useState, useEffect } from "react";
import { Sun, Moon, Monitor, Bell, Shield, Database, Palette, Globe, Plus, Trash2, Pencil, Users as UsersIcon, Key } from "lucide-react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useListCostModels, useCreateCostModel, useDeleteCostModel, getListCostModelsQueryKey,
  useListPaymentTerms, useCreatePaymentTerm, useDeletePaymentTerm, getListPaymentTermsQueryKey,
  useGetTaxSettings, useUpdateTaxSettings, getGetTaxSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PermissionGuard } from "@/components/PermissionGuard";

// All permissions defined inline (was exported from @/lib/auth in the source app)
const ALL_PERMISSIONS = [
  "View Transactions",
  "View Billings",
  "View Billing Detail",
  "View Payments",
  "View Cost",
  "View Analytics",
  "Upload Data",
  "Manage Settings",
  "View Clients",
  "View Buying Houses",
  "View Partners",
];

interface Role {
  name: string;
  permissions: string[];
  isSystem?: boolean;
}

interface User {
  name: string;
  email: string;
  role: string;
  isSystem?: boolean;
  password?: string;
}

// --- Auth API fetch helpers (replace @/lib/auth functions) ---
async function getRoles(): Promise<Role[]> {
  const res = await fetch("/api/roles");
  if (!res.ok) return [];
  return res.json();
}

async function saveRole(role: Role): Promise<void> {
  await fetch("/api/roles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(role),
  });
}

async function deleteRole(name: string): Promise<boolean> {
  const res = await fetch(`/api/roles/${encodeURIComponent(name)}`, { method: "DELETE" });
  return res.ok;
}

async function getUsers(): Promise<User[]> {
  const res = await fetch("/api/users");
  if (!res.ok) return [];
  return res.json();
}

async function saveUser(user: User): Promise<void> {
  await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
}

async function deleteUser(email: string): Promise<boolean> {
  const res = await fetch(`/api/users/${encodeURIComponent(email)}`, { method: "DELETE" });
  return res.ok;
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

  // Active settings tabs
  const [activeTab, setActiveTab] = useState<"general" | "roles" | "users" | "costModels" | "paymentTerms">("general");

  // General Settings States
  const [alertNegative, setAlertNegative] = useState(
    () => typeof window !== "undefined" ? localStorage.getItem("adops-alert-negative") !== "false" : true
  );
  const [alertLowMargin, setAlertLowMargin] = useState(
    () => typeof window !== "undefined" ? localStorage.getItem("adops-alert-low-margin") !== "false" : true
  );
  const [weeklyReport, setWeeklyReport] = useState(
    () => typeof window !== "undefined" ? localStorage.getItem("adops-weekly-report") === "true" : false
  );
  const [analyticsCollection, setAnalyticsCollection] = useState(
    () => typeof window !== "undefined" ? localStorage.getItem("adops-analytics-collection") === "true" : false
  );

  const [baseCurrency, setBaseCurrency] = useState<string>(
    () => (typeof window !== "undefined" ? localStorage.getItem("adops-base-currency") : null) || "USD"
  );
  const [rateMode, setRateMode] = useState<string>(
    () => (typeof window !== "undefined" ? localStorage.getItem("adops-rate-mode") : null) || "Automatic"
  );
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>(() => {
    try {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("adops-exchange-rates");
        if (stored) return JSON.parse(stored);
      }
    } catch (e) {
      console.error(e);
    }
    return { usd: 1.0, eur: 0.92, gbp: 0.79, inr: 83.0, jpy: 155.0, cad: 1.36, aud: 1.50, pkr: 278.0, sar: 3.75, aed: 3.67 };
  });

  // RBAC Roles States
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [newRoleName, setNewRoleName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  // RBAC Users States
  const [users, setUsers] = useState<User[]>([]);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState("");

  // Catalog hooks
  const qc = useQueryClient();
  const { data: costModels } = useListCostModels();
  const createCostModel = useCreateCostModel({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListCostModelsQueryKey() }); toast({ title: "Cost model added" }); } } });
  const deleteCostModelM = useDeleteCostModel({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListCostModelsQueryKey() }); toast({ title: "Cost model deleted" }); } } });
  const { data: paymentTerms } = useListPaymentTerms();
  const createPaymentTerm = useCreatePaymentTerm({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListPaymentTermsQueryKey() }); toast({ title: "Payment term added" }); } } });
  const deletePaymentTermM = useDeletePaymentTerm({ mutation: { onSuccess: () => { qc.invalidateQueries({ queryKey: getListPaymentTermsQueryKey() }); toast({ title: "Payment term deleted" }); } } });

  // Load roles and users from the API on mount
  useEffect(() => {
    getRoles().then(setRoles);
    getUsers().then(setUsers);
  }, []);

  const fetchRates = async (base: string) => {
    try {
      const res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base.toLowerCase()}.json`);
      if (res.ok) {
        const data = await res.json();
        const rates = data[base.toLowerCase()];
        if (rates) {
          setExchangeRates(rates);
          localStorage.setItem("adops-exchange-rates", JSON.stringify(rates));
        }
      }
    } catch (e) {
      console.error("Failed to fetch rates:", e);
    }
  };

  useEffect(() => {
    localStorage.removeItem("adops-platform-fee");
    if (rateMode === "Automatic") {
      fetchRates(baseCurrency);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBaseCurrencyChange = (val: string) => {
    setBaseCurrency(val);
    localStorage.setItem("adops-base-currency", val);
    if (rateMode === "Automatic") {
      fetchRates(val);
    } else {
      const updated = { ...exchangeRates, [val.toLowerCase()]: 1.0 };
      setExchangeRates(updated);
      localStorage.setItem("adops-exchange-rates", JSON.stringify(updated));
    }
  };

  const handleModeChange = (val: string) => {
    setRateMode(val);
    localStorage.setItem("adops-rate-mode", val);
    if (val === "Automatic") {
      fetchRates(baseCurrency);
    }
  };

  const handleManualRateChange = (cur: string, val: string) => {
    const parsed = parseFloat(val);
    const updated = { ...exchangeRates, [cur]: isNaN(parsed) ? 0 : parsed };
    setExchangeRates(updated);
    localStorage.setItem("adops-exchange-rates", JSON.stringify(updated));
  };

  // Role CRUD logic
  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoleName.trim()) {
      toast({ title: "Role name cannot be empty", variant: "destructive" });
      return;
    }
    const role: Role = {
      name: newRoleName.trim(),
      permissions: selectedPermissions,
      isSystem: editingRole?.isSystem || false
    };
    await saveRole(role);
    setRoles(await getRoles());
    setRoleDialogOpen(false);
    setEditingRole(null);
    setNewRoleName("");
    setSelectedPermissions([]);
    toast({ title: `Role "${role.name}" saved successfully` });
  };

  const startEditRole = (role: Role) => {
    setEditingRole(role);
    setNewRoleName(role.name);
    setSelectedPermissions(role.permissions);
    setRoleDialogOpen(true);
  };

  const handleDeleteRole = async (name: string) => {
    const ok = await deleteRole(name);
    if (ok) {
      setRoles(await getRoles());
      toast({ title: `Role "${name}" deleted` });
    } else {
      toast({ title: "Cannot delete system roles", variant: "destructive" });
    }
  };

  const togglePermission = (perm: string) => {
    setSelectedPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  // User CRUD logic
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim()) {
      toast({ title: "Name cannot be empty", variant: "destructive" });
      return;
    }
    if (!newUserEmail.trim()) {
      toast({ title: "Email cannot be empty", variant: "destructive" });
      return;
    }
    if (!editingUser && !newUserPassword) {
      toast({ title: "Password is required for new users", variant: "destructive" });
      return;
    }
    if (!newUserRole) {
      toast({ title: "Please assign a role", variant: "destructive" });
      return;
    }

    const userObj: User = {
      name: newUserName.trim(),
      email: newUserEmail.trim(),
      role: newUserRole,
      isSystem: editingUser?.isSystem || false
    };

    if (newUserPassword) {
      userObj.password = newUserPassword;
    }

    await saveUser(userObj);
    setUsers(await getUsers());
    setUserDialogOpen(false);
    setEditingUser(null);
    setNewUserName("");
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserRole("");
    toast({ title: `User "${userObj.name}" saved successfully` });
  };

  const startEditUser = (u: User) => {
    setEditingUser(u);
    setNewUserName(u.name);
    setNewUserEmail(u.email);
    setNewUserPassword("");
    setNewUserRole(u.role);
    setUserDialogOpen(true);
  };

  const handleDeleteUser = async (email: string) => {
    const ok = await deleteUser(email);
    if (ok) {
      setUsers(await getUsers());
      toast({ title: "User account deleted" });
    } else {
      toast({ title: "Cannot delete system accounts", variant: "destructive" });
    }
  };

  return (
    <PermissionGuard permission="Manage Settings">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your platform preferences, configurations, and user rights</p>
        </div>

        {/* Settings Navigation Tabs */}
        <div className="flex border-b border-border">
          {[
            { id: "general", label: "Currency & Appearance" },
            { id: "roles", label: "Roles & Rights" },
            { id: "users", label: "User Accounts" },
            { id: "costModels", label: "Cost Models" },
            { id: "paymentTerms", label: "Payment Terms" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* GENERAL SETTINGS TAB */}
        {activeTab === "general" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left Column */}
            <div className="space-y-6">
              {/* Theme / Appearance */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Palette className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { value: "light" as const, label: "Light", icon: Sun },
                    { value: "dark" as const, label: "Dark", icon: Moon },
                    { value: "system" as const, label: "System", icon: Monitor },
                  ].map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      data-testid={`theme-${value}`}
                      className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all cursor-pointer ${
                        theme === value
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/30"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      <span className="text-xs font-medium">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Notifications */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Bell className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
                </div>
                <div className="space-y-3">
                  {[
                    {
                      label: "Alert on negative profit",
                      description: "Notify when any campaign goes negative",
                      checked: alertNegative,
                      onChange: (v: boolean) => { setAlertNegative(v); localStorage.setItem("adops-alert-negative", String(v)); },
                    },
                    {
                      label: "Low margin warnings",
                      description: "Alert when margin drops below 10%",
                      checked: alertLowMargin,
                      onChange: (v: boolean) => { setAlertLowMargin(v); localStorage.setItem("adops-alert-low-margin", String(v)); },
                    },
                    {
                      label: "Weekly performance report",
                      description: "Receive summary every Monday",
                      checked: weeklyReport,
                      onChange: (v: boolean) => { setWeeklyReport(v); localStorage.setItem("adops-weekly-report", String(v)); },
                    },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <div className="pr-4">
                        <p className="text-sm font-medium text-foreground">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      </div>
                      <Switch
                        checked={item.checked}
                        onCheckedChange={item.onChange}
                        data-testid={`switch-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column */}
            <div className="space-y-6">
              {/* Data & Privacy */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">Data &amp; Privacy</h2>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between py-2 border-b border-border">
                    <div>
                      <p className="text-sm font-medium text-foreground">Data Retention</p>
                      <p className="text-xs text-muted-foreground">Keep transaction data for</p>
                    </div>
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">24 months</span>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium text-foreground">Analytics</p>
                      <p className="text-xs text-muted-foreground">Usage data collection</p>
                    </div>
                    <Switch
                      checked={analyticsCollection}
                      onCheckedChange={(v) => { setAnalyticsCollection(v); localStorage.setItem("adops-analytics-collection", String(v)); }}
                      data-testid="switch-analytics-collection"
                    />
                  </div>
                </div>
              </div>

              {/* Currency Settings */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">Currency Settings</h2>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Base Currency</label>
                    <Select value={baseCurrency} onValueChange={handleBaseCurrencyChange}>
                      <SelectTrigger className="w-full text-sm mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD", "PKR", "SAR", "AED"].map(cur => (
                          <SelectItem key={cur} value={cur}>{cur}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Rate Setup Mode</label>
                    <div className="flex gap-2 mt-1.5">
                      {[
                        { value: "Automatic", label: "Automatic (API)" },
                        { value: "Manual", label: "Manual Rates" },
                      ].map(mode => (
                        <button
                          key={mode.value}
                          onClick={() => handleModeChange(mode.value)}
                          className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
                            rateMode === mode.value
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-border text-muted-foreground hover:bg-muted/50"
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {rateMode === "Automatic" ? (
                    <div className="rounded-xl bg-muted/30 p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">Connected</span>
                      </div>
                      <div className="pt-1.5 border-t border-border/50 grid grid-cols-3 gap-2 text-[10px] text-center">
                        {["EUR", "GBP", "INR", "USD", "JPY", "CAD", "AUD", "PKR", "SAR", "AED"].map(cur => {
                          if (cur === baseCurrency) return null;
                          const rate = exchangeRates[cur.toLowerCase()];
                          return (
                            <div key={cur} className="rounded bg-background p-1 border border-border/30">
                              <p className="font-bold text-muted-foreground">{cur}</p>
                              <p className="text-foreground mt-0.5">{rate ? rate.toFixed(3) : "—"}</p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border/50 p-3 space-y-3">
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Manual Conversion Rates (1 {baseCurrency} = ?)</p>
                      <div className="grid grid-cols-2 gap-3">
                        {["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD", "PKR", "SAR", "AED"].map(cur => {
                          if (cur === baseCurrency) return null;
                          const key = cur.toLowerCase();
                          return (
                            <div key={cur} className="space-y-1">
                              <label className="text-[10px] font-medium text-muted-foreground">{cur}</label>
                              <Input
                                type="number"
                                step="0.0001"
                                className="h-8 text-xs"
                                value={exchangeRates[key] ?? ""}
                                onChange={e => handleManualRateChange(key, e.target.value)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Tax Settings */}
              <TaxSettingsCard />

              {/* About */}
              <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold text-foreground">About</h2>
                </div>
                <div className="space-y-2.5 text-sm">
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Version</span>
                    <span className="font-medium text-foreground">1.0.0</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/50">
                    <span className="text-muted-foreground">Stack</span>
                    <span className="font-medium text-foreground">Next.js + Express + PostgreSQL</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">Platform</span>
                    <span className="font-medium text-foreground">AdOps Intelligence</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ROLES & RIGHTS MANAGEMENT TAB */}
        {activeTab === "roles" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">Roles &amp; Rights</h2>
                <p className="text-sm text-muted-foreground">Define roles and check specific module permissions for each role.</p>
              </div>
              <Button size="sm" className="gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white" onClick={() => {
                setEditingRole(null);
                setNewRoleName("");
                setSelectedPermissions([]);
                setRoleDialogOpen(true);
              }}>
                <Plus className="h-3.5 w-3.5" /> Add Role
              </Button>
            </div>

            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Role Name</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Permissions / Access Rights</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map(r => (
                    <tr key={r.name} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 text-sm font-semibold text-foreground flex items-center gap-2">
                        {r.name}
                        {r.isSystem && (
                          <span className="rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 text-[10px] font-medium uppercase">
                            System
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">
                        <div className="flex flex-wrap gap-1.5 max-w-2xl">
                          {r.permissions.length === ALL_PERMISSIONS.length ? (
                            <span className="rounded-full bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 px-2 py-0.5 font-medium">
                              All Rights Enabled
                            </span>
                          ) : r.permissions.length === 0 ? (
                            <span className="rounded-full bg-slate-100 text-slate-500 dark:bg-slate-900 px-2 py-0.5 font-medium">
                              No Permissions Enabled
                            </span>
                          ) : (
                            r.permissions.map(p => (
                              <span key={p} className="rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 px-2.5 py-0.5 font-medium">
                                {p}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-sm">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => startEditRole(r)}
                            disabled={r.isSystem}
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 hover:bg-destructive/10 text-destructive"
                            onClick={() => handleDeleteRole(r.name)}
                            disabled={r.isSystem}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add / Edit Role Dialog */}
            <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editingRole ? "Edit Access Role" : "Create Access Role"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSaveRole} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Role Name</label>
                    <Input
                      required
                      value={newRoleName}
                      onChange={e => setNewRoleName(e.target.value)}
                      placeholder="e.g. Campaign Editor"
                      disabled={editingRole?.isSystem}
                      className="text-sm h-9"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground block">Select Right Permissions</label>
                    <div className="grid grid-cols-2 gap-2.5 border border-border rounded-xl p-3 bg-muted/20 max-h-60 overflow-y-auto">
                      {ALL_PERMISSIONS.map(perm => (
                        <label key={perm} className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={selectedPermissions.includes(perm)}
                            onChange={() => togglePermission(perm)}
                            className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 h-4 w-4 cursor-pointer"
                          />
                          <span>{perm}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <DialogFooter className="pt-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setRoleDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" className="bg-violet-600 hover:bg-violet-500 text-white">
                      {editingRole ? "Save Changes" : "Create Role"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* USER ACCOUNTS MANAGEMENT TAB */}
        {activeTab === "users" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">User Accounts</h2>
                <p className="text-sm text-muted-foreground">Create users and assign them active security roles.</p>
              </div>
              <Button size="sm" className="gap-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white" onClick={() => {
                setEditingUser(null);
                setNewUserName("");
                setNewUserEmail("");
                setNewUserPassword("");
                setNewUserRole(roles[0]?.name || "");
                setUserDialogOpen(true);
              }}>
                <Plus className="h-3.5 w-3.5" /> Add User
              </Button>
            </div>

            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">User Name</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Email Address</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">Assigned Role</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.email} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 text-sm font-semibold text-foreground flex items-center gap-2">
                        {u.name}
                        {u.isSystem && (
                          <span className="rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 text-[10px] font-medium uppercase">
                            System Admin
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-sm text-muted-foreground">{u.email}</td>
                      <td className="px-5 py-3 text-xs">
                        <span className="rounded-full bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 px-2.5 py-0.5 font-semibold">
                          {u.role}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-sm">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => startEditUser(u)}
                            disabled={u.isSystem}
                          >
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 hover:bg-destructive/10 text-destructive"
                            onClick={() => handleDeleteUser(u.email)}
                            disabled={u.isSystem}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add / Edit User Dialog */}
            <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingUser ? "Edit User Account" : "Create User Account"}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSaveUser} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Full Name</label>
                    <Input
                      required
                      value={newUserName}
                      onChange={e => setNewUserName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="text-sm h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Email Address</label>
                    <Input
                      required
                      type="email"
                      value={newUserEmail}
                      onChange={e => setNewUserEmail(e.target.value)}
                      placeholder="e.g. john@advengers.com"
                      disabled={!!editingUser}
                      className="text-sm h-9"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-xs font-semibold text-muted-foreground">Password</label>
                      {editingUser && (
                        <span className="text-[10px] text-muted-foreground">(leave unmodified to keep current)</span>
                      )}
                    </div>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="password"
                        required={!editingUser}
                        value={newUserPassword}
                        onChange={e => setNewUserPassword(e.target.value)}
                        placeholder="••••••••"
                        className="pl-9 text-sm h-9"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">Assign Role</label>
                    <Select value={newUserRole} onValueChange={setNewUserRole}>
                      <SelectTrigger className="w-full text-sm mt-1 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map(r => (
                          <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <DialogFooter className="pt-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setUserDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" className="bg-violet-600 hover:bg-violet-500 text-white">
                      {editingUser ? "Save User" : "Create User"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {activeTab === "costModels" && (
          <CatalogTab
            title="Cost Models" description="Names referenced when configuring client events."
            placeholder="e.g. CPI, CPA, CPL"
            items={costModels ?? []}
            onAdd={(name) => createCostModel.mutate({ data: { name } })}
            onDelete={(id) => deleteCostModelM.mutate({ id })}
          />
        )}

        {activeTab === "paymentTerms" && (
          <CatalogTab
            title="Payment Terms" description="Names referenced by clients and partners."
            placeholder="e.g. Net 30, Net 60"
            items={paymentTerms ?? []}
            onAdd={(name) => createPaymentTerm.mutate({ data: { name } })}
            onDelete={(id) => deletePaymentTermM.mutate({ id })}
          />
        )}
      </div>
    </PermissionGuard>
  );
}

function CatalogTab({
  title, description, items, onAdd, onDelete, placeholder,
}: {
  title: string;
  description: string;
  items: Array<{ id: number; name: string }>;
  onAdd: (name: string) => void;
  onDelete: (id: number) => void;
  placeholder: string;
}) {
  const [name, setName] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = name.trim();
    if (t) { onAdd(t); setName(""); }
  };
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <form onSubmit={submit} className="flex gap-2 max-w-md">
        <Input value={name} onChange={e => setName(e.target.value)} placeholder={placeholder} className="text-sm h-9" />
        <Button type="submit" size="sm" className="gap-1.5 text-xs"><Plus className="h-3.5 w-3.5" /> Add</Button>
      </form>
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden max-w-md">
        <table className="w-full">
          <tbody>
            {items.length === 0 ? (
              <tr><td className="px-5 py-8 text-center text-sm text-muted-foreground">None yet</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-5 py-3 text-sm font-medium text-foreground">{it.name}</td>
                <td className="px-5 py-3 text-right">
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:bg-destructive/10 text-destructive" onClick={() => onDelete(it.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-red-500" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaxSettingsCard() {
  const { data } = useGetTaxSettings();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({ remittanceTaxPct: 0, salesTaxPct: 0, withholdingTaxPct: 0 });
  useEffect(() => { if (data) setForm({
    remittanceTaxPct: data.remittanceTaxPct, salesTaxPct: data.salesTaxPct, withholdingTaxPct: data.withholdingTaxPct,
  }); }, [data]);
  const save = useUpdateTaxSettings({ mutation: {
    onSuccess: () => { qc.invalidateQueries({ queryKey: getGetTaxSettingsQueryKey() }); toast({ title: "Tax settings saved" }); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  }});
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Tax Settings</h2>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {(["remittanceTaxPct", "salesTaxPct", "withholdingTaxPct"] as const).map(k => (
          <label key={k} className="text-xs space-y-1">
            <span className="text-muted-foreground">
              {k === "remittanceTaxPct" ? "Remittance %" : k === "salesTaxPct" ? "Sales Tax %" : "Withholding %"}
            </span>
            <Input type="number" step="0.01" value={form[k]}
              onChange={e => setForm(f => ({ ...f, [k]: parseFloat(e.target.value) || 0 }))} />
          </label>
        ))}
      </div>
      <Button size="sm" onClick={() => save.mutate({ data: form })} disabled={save.isPending}>
        {save.isPending ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}
