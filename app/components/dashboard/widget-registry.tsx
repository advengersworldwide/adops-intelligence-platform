import type { WidgetDef } from "@/lib/dashboard/types";
import { KpiRevenue } from "./widgets/KpiRevenue";
import { KpiCost } from "./widgets/KpiCost";
import { KpiProfit } from "./widgets/KpiProfit";
import { KpiMargin } from "./widgets/KpiMargin";
import { Counts } from "./widgets/Counts";
import { ProfitTrend } from "./widgets/ProfitTrend";
import { Alerts } from "./widgets/Alerts";
import { WorkingCapital } from "./widgets/WorkingCapital";
import { ClientPerformance } from "./widgets/ClientPerformance";
import { PlatformPerformance } from "./widgets/PlatformPerformance";
import { RecentTransactions } from "./widgets/RecentTransactions";
import { AiInsights } from "./widgets/AiInsights";
import { Concentration } from "./widgets/Concentration";
import { ForecastTrend } from "./widgets/ForecastTrend";
import { Anomalies } from "./widgets/Anomalies";
import { CashFlow } from "./widgets/CashFlow";
import { Aging } from "./widgets/Aging";
import { InvoiceFunnel } from "./widgets/InvoiceFunnel";
import { PoPacing } from "./widgets/PoPacing";
import { KpiCashPosition } from "./widgets/KpiCashPosition";

const KPI = { w: 3, h: 3, minW: 2, minH: 2 };

export const widgetRegistry: Record<string, WidgetDef> = {
  "revenue-kpi": { id: "revenue-kpi", label: "Revenue", description: "Total client spend", category: "kpi", permission: null, defaultLayout: KPI, Component: KpiRevenue },
  "cost-kpi": { id: "cost-kpi", label: "Cost", description: "Platform cost", category: "kpi", permission: "View Cost", defaultLayout: KPI, Component: KpiCost },
  "profit-kpi": { id: "profit-kpi", label: "Profit", description: "Net profit", category: "kpi", permission: "View Cost", defaultLayout: KPI, Component: KpiProfit },
  "margin-kpi": { id: "margin-kpi", label: "Margin %", description: "Profit / revenue", category: "kpi", permission: "View Cost", defaultLayout: KPI, Component: KpiMargin },
  "counts-row": { id: "counts-row", label: "Counts", description: "Clients / platforms / campaigns", category: "kpi", permission: null, defaultLayout: { w: 12, h: 3, minW: 6, minH: 2 }, Component: Counts },
  "profit-chart": { id: "profit-chart", label: "Profit & Revenue", description: "Trend over time", category: "profitability", permission: null, defaultLayout: { w: 8, h: 9, minW: 4, minH: 6 }, Component: ProfitTrend },
  "alerts-panel": { id: "alerts-panel", label: "Alerts", description: "Risk alerts", category: "risk", permission: null, defaultLayout: { w: 4, h: 9, minW: 3, minH: 4 }, Component: Alerts },
  "working-capital": { id: "working-capital", label: "Working Capital", description: "AR / AP / cash", category: "financial-ops", permission: "View Payments", defaultLayout: { w: 4, h: 8, minW: 3, minH: 5 }, Component: WorkingCapital },
  "client-performance-chart": { id: "client-performance-chart", label: "Client Performance", description: "By client", category: "profitability", permission: "View Clients", defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 }, Component: ClientPerformance },
  "platform-performance-chart": { id: "platform-performance-chart", label: "Platform Performance", description: "By platform", category: "profitability", permission: "View Partners", defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 }, Component: PlatformPerformance },
  "transactions-table": { id: "transactions-table", label: "Recent Transactions", description: "Latest transactions", category: "activity", permission: "View Transactions", defaultLayout: { w: 12, h: 8, minW: 6, minH: 5 }, Component: RecentTransactions },
  "ai-insights": { id: "ai-insights", label: "AI: What changed", description: "Auto-generated insight cards", category: "risk", permission: "View Analytics", defaultLayout: { w: 12, h: 5, minW: 6, minH: 4 }, Component: AiInsights },
  "concentration": { id: "concentration", label: "Concentration", description: "Top-client Pareto + HHI", category: "relationships", permission: "View Analytics", defaultLayout: { w: 6, h: 9, minW: 4, minH: 6 }, Component: Concentration },
  "forecast-trend": { id: "forecast-trend", label: "Forecast", description: "Trend + projection band", category: "profitability", permission: null, defaultLayout: { w: 8, h: 9, minW: 4, minH: 6 }, Component: ForecastTrend },
  "anomalies": { id: "anomalies", label: "Anomaly watch", description: "Outliers vs pattern", category: "risk", permission: "View Analytics", defaultLayout: { w: 6, h: 9, minW: 4, minH: 6 }, Component: Anomalies },
  "cashflow": { id: "cashflow", label: "Cash flow", description: "Collections vs payouts", category: "financial-ops", permission: "View Payments", defaultLayout: { w: 8, h: 9, minW: 4, minH: 6 }, Component: CashFlow },
  "aging": { id: "aging", label: "AR / AP aging", description: "Receivables & payables by age", category: "financial-ops", permission: "View Payments", defaultLayout: { w: 6, h: 10, minW: 4, minH: 6 }, Component: Aging },
  "invoice-funnel": { id: "invoice-funnel", label: "Invoice status", description: "Invoice lifecycle funnel", category: "financial-ops", permission: "View Billings", defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 }, Component: InvoiceFunnel },
  "po-pacing": { id: "po-pacing", label: "PO pacing", description: "PPO burn-down vs budget", category: "financial-ops", permission: "View Purchase Orders", defaultLayout: { w: 6, h: 9, minW: 4, minH: 6 }, Component: PoPacing },
  "cash-position-kpi": { id: "cash-position-kpi", label: "Cash Position", description: "Receivables minus payables", category: "kpi", permission: "View Payments", defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 }, Component: KpiCashPosition },
};

export const widgetList = Object.values(widgetRegistry);
