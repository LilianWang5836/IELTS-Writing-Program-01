import { NextResponse } from "next/server";
import { getLlmMode } from "@/lib/llm/client";

export async function GET() {
  return NextResponse.json(getLlmMode());
}
