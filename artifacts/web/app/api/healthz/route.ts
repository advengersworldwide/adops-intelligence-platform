import { NextResponse } from "next/server";
import { HealthCheckResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return NextResponse.json(HealthCheckResponse.parse({ status: "ok" }));
}
