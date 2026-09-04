// Phase 3B: Morning Deadline Briefing API Route
// Called daily at 08:00 IST by GitHub Actions cron job

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendTelegramMessage } from "@/lib/telegram";

function escapeHtml(str: string): string {
  return (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization") || "";
  const cronSecret = process.env.CRON_SECRET || "";
  const ingestToken = process.env.INGEST_SECRET_TOKEN || "";
  const dashboardToken = process.env.DASHBOARD_ACCESS_TOKEN || "";
  const validSecrets = [cronSecret, ingestToken, dashboardToken].filter(Boolean);

  const providedToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (validSecrets.length > 0 && !validSecrets.includes(providedToken)) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date();
    const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. Stuck tasks in queued/claimed for > 24 hours (PRD / IMPLEMENT.md A8)
    const { data: stuckTasks } = await supabase
      .from("tasks")
      .select("id, title, course, status, created_at")
      .eq("archived", false)
      .in("status", ["queued", "claimed"])
      .lte("created_at", dayAgo.toISOString())
      .order("created_at", { ascending: true });

    // 2. Imminent deadlines (<12 hours) requiring urgent action
    const { data: imminentTasks } = await supabase
      .from("tasks")
      .select("id, title, course, status, due_date")
      .eq("archived", false)
      .neq("status", "done")
      .lte("due_date", in12h.toISOString())
      .gte("due_date", now.toISOString())
      .order("due_date", { ascending: true });

    // 3. Upcoming within 48h
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

    const studentName = process.env.STUDENT_NAME || 'Student';
    let msg = `\u{1F305} <b>Good Morning, ${studentName}!</b>\n\u{1F4C5} <b>${todayStr}</b>\n\n`;

    // Escalation section for stuck queue items
    if (stuckTasks && stuckTasks.length > 0) {
      msg += `🚨 <b>ESCALATION: Tasks Stuck in Queue &gt;24 Hours (${stuckTasks.length}):</b>\n`;
      stuckTasks.forEach((st) => {
        msg += `• <b>${escapeHtml(st.title)}</b> (${escapeHtml(st.course || "General")}) [${st.status.toUpperCase()}]\n`;
      });
      msg += `<i>Check PC build worker or task logs.</i>\n\n`;
    }

    // Imminent (<12h) section
    if (imminentTasks && imminentTasks.length > 0) {
      msg += `🔴 <b>CRITICAL: Due in Less Than 12 Hours (${imminentTasks.length}):</b>\n`;
      imminentTasks.forEach((it) => {
        const dueStr = it.due_date
          ? new Date(it.due_date).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })
          : "Soon";
        msg += `• <b>${escapeHtml(it.title)}</b> (${escapeHtml(it.course || "General")}) — Due: ${dueStr}\n`;
      });
      msg += `\n`;
    }

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
