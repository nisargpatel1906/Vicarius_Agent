// Phase 3B: Morning Deadline Briefing API Route
// Called daily at 08:00 IST by GitHub Actions cron job

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "edge";

function escapeHtml(str: string): string {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data: upcoming } = await supabase
      .from("tasks")
      .select("id, title, course, task_type, status, due_date")
      .eq("archived", false)
      .neq("status", "done")
      .lte("due_date", in48h.toISOString())
      .gte("due_date", now.toISOString())
      .order("due_date", { ascending: true });

    const { data: upcoming7d } = await supabase
      .from("tasks")
      .select("id, title, course, task_type, status, due_date")
      .eq("archived", false)
      .neq("status", "done")
      .lte("due_date", in7d.toISOString())
      .gte("due_date", in48h.toISOString())
      .order("due_date", { ascending: true })
      .limit(5);

    const todayStr = now.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric",
    });

    let msg = `\u{1F305} <b>Good Morning, Nisarg!</b>\n\u{1F4C5} <b>${todayStr}</b>\n\n`;

    if (!upcoming || upcoming.length === 0) {
      msg += `\u2705 <b>No urgent deadlines in the next 48 hours.</b>\n`;
    } else {
      msg += `\u26A0\uFE0F <b>Due in 48 hours (${upcoming.length} task${upcoming.length !== 1 ? "s" : ""}):</b>\n\n`;
      upcoming.forEach((t) => {
        const dueStr = t.due_date
          ? new Date(t.due_date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
          : "No deadline";
        const badge = t.status === "queued" ? "\u23F3" : t.status === "building" || t.status === "claimed" ? "\u{1F528}" : t.status === "flagged" ? "\u26A0\uFE0F" : "\u{1F4CC}";
        msg += `${badge} <b>${escapeHtml(t.title)}</b>\n   \u{1F4DA} ${escapeHtml(t.course || "General")} | \u23F0 ${dueStr}\n\n`;
      });
    }

    if (upcoming7d && upcoming7d.length > 0) {
      msg += `\u{1F4C6} <b>Upcoming this week:</b>\n`;
      upcoming7d.slice(0, 4).forEach((t) => {
        const dueStr = t.due_date
          ? new Date(t.due_date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short" })
          : "No deadline";
        msg += `\u2022 <b>${escapeHtml(t.title)}</b> (${escapeHtml(t.course || "General")}) \u2014 ${dueStr}\n`;
      });
      msg += "\n";
    }

    msg += `<i>Use /tasks to see all active tasks or just tell me what to build!</i>`;
    await sendTelegramMessage(msg);

    return NextResponse.json({ success: true, urgent_count: upcoming?.length || 0 });
  } catch (err: any) {
    console.error("[Briefing]", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
