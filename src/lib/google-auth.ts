// Google API OAuth2 Authentication & Clients
// Sourced from PRD_academic_task_agent.md (Section 6.1, 6.5, 9, 10)

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export function getGoogleOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Google OAuth environment variables: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GOOGLE_OAUTH_REFRESH_TOKEN'
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    process.env.GOOGLE_OAUTH_REDIRECT_URI || 'https://developers.google.com/oauthplayground' // standard redirect URI or custom
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return oauth2Client;
}

export function getGmailClient() {
  const auth = getGoogleOAuth2Client();
  return google.gmail({ version: 'v1', auth });
}

export function getClassroomClient() {
  const auth = getGoogleOAuth2Client();
  return google.classroom({ version: 'v1', auth });
}

export function getDriveClient() {
  const auth = getGoogleOAuth2Client();
  return google.drive({ version: 'v3', auth });
}

export function getDocsClient() {
  const auth = getGoogleOAuth2Client();
  return google.docs({ version: 'v1', auth });
}

export function getTasksClient() {
  const auth = getGoogleOAuth2Client();
  return google.tasks({ version: 'v1', auth });
}

export function getCalendarClient() {
  const auth = getGoogleOAuth2Client();
  return google.calendar({ version: 'v3', auth });
}
