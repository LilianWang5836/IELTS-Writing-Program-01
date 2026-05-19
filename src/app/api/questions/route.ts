import { NextResponse } from "next/server";
import questions from "@/data/questions.json";
import type { Question } from "@/lib/domain/types";

export async function GET() {
  return NextResponse.json({ questions: questions as Question[] });
}
