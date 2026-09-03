import { NextRequest, NextResponse } from 'next/server';
import { processSingleItem } from '@/lib/ingest';
import { getGmailClient } from '@/lib/google-auth';

// POST /api/webhooks/google
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Google Pub/Sub sends the message in the `message` object with a base64 encoded `data` field
    if (!body.message || !body.message.data) {
      return NextResponse.json({ error: 'Invalid Pub/Sub payload' }, { status: 400 });
    }

    const decodedData = Buffer.from(body.message.data, 'base64').toString('utf-8');
    const parsedData = JSON.parse(decodedData);

    // Determine if it's Gmail or Classroom based on the payload structure
    if (parsedData.emailAddress && parsedData.historyId) {
      // Gmail Webhook Push
      const gmail = getGmailClient();
      
      // Fetch the specific history record to get the changed message
      // NOTE: In a full production implementation you would query the history endpoint
      // and iterate through messagesAdded to process them.
      const historyRes = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: parsedData.historyId,
        maxResults: 10
      });

      const histories = historyRes.data.history || [];
      for (const history of histories) {
        const messagesAdded = history.messagesAdded || [];
        for (const added of messagesAdded) {
          if (added.message?.id) {
            // Fetch full message
            const detail = await gmail.users.messages.get({
              userId: 'me',
              id: added.message.id,
              format: 'full',
            });

            // Extract minimal info
            const headers = detail.data.payload?.headers || [];
            const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value || 'Untitled Email Task';
            const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value || '';
            const dateHeader = headers.find((h) => h.name?.toLowerCase() === 'date')?.value || '';
            const bodyText = detail.data.snippet || '';
            
            const attachments: any[] = [];
            const parts = detail.data.payload?.parts || [];
            for (const part of parts) {
              if (part.filename && part.body?.attachmentId) {
                attachments.push({ name: part.filename, mimeType: part.mimeType || undefined });
              }
            }

            const item = {
              source: 'gmail',
              external_id: `gmail_${added.message.id}`,
              course: from ? from.split('<')[0].trim() : null,
              title: subject,
              raw_body: `From: ${from}\nDate: ${dateHeader}\nSubject: ${subject}\n\n${bodyText}`,
              attachments,
              posted_date: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
            };

            await processSingleItem(item);
          }
        }
      }

    } else if (parsedData.collection === 'courses.courseWork' || parsedData.collection === 'courses.announcements') {
      // Classroom Webhook Push (Simulated logic based on Google Classroom Pub/Sub API)
      // Implementation depends heavily on what Classroom actually pushes
      console.log('Classroom Webhook received:', parsedData);
    } else {
      console.log('Unrecognized Pub/Sub event:', parsedData);
    }

    // Always return 200 so Pub/Sub knows the message was delivered
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Google Webhook Error:', err);
    // Return 200 to ack the message even on error to avoid exponential retry storms 
    // unless we strictly want retries.
    return NextResponse.json({ success: false, error: err?.message || 'Error processing webhook' }, { status: 200 });
  }
}
