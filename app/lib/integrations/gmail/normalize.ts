import {
  attachmentMetadataFromMessage,
  collectMessageBody,
  getHeader,
  type GmailMessageResource,
  type GmailThreadResource,
} from "./client";
import type { MockAddress, MockThreadInput } from "@/app/lib/inbox/manualImport";

export function normalizeGmailThread(thread: GmailThreadResource): MockThreadInput {
  const messages = thread.messages ?? [];
  const normalizedMessages = messages.map((message) => normalizeGmailMessage(message));
  const labels = Array.from(new Set(messages.flatMap((message) => message.labelIds ?? []))).sort();
  const participants = uniqueAddresses(
    messages.flatMap((message) => {
      const headers = message.payload?.headers;
      return [
        ...parseAddressList(getHeader(headers, "From")),
        ...parseAddressList(getHeader(headers, "To")),
        ...parseAddressList(getHeader(headers, "Cc")),
      ];
    }),
  );

  return {
    gmailThreadId: thread.id,
    subject:
      normalizedMessages.find((message) => message.subject)?.subject ??
      `Gmail thread ${thread.id}`,
    participants,
    labels,
    isArchived: labels.length > 0 && !labels.includes("INBOX"),
    latestMessageAt: latestDate(
      normalizedMessages.map((message) => message.sentAt ?? message.internalDate),
    ),
    metadata: {
      source: "gmail_api",
      historyId: thread.historyId,
      messageCount: messages.length,
    },
    messages: normalizedMessages,
  };
}

function normalizeGmailMessage(message: GmailMessageResource) {
  const headers = message.payload?.headers;
  const body = collectMessageBody(message);
  const sentAt = parseDate(getHeader(headers, "Date"));
  const internalDate = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : undefined;

  return {
    gmailMessageId: message.id,
    subject: getHeader(headers, "Subject"),
    from: parseAddressList(getHeader(headers, "From"))[0],
    to: parseAddressList(getHeader(headers, "To")),
    cc: parseAddressList(getHeader(headers, "Cc")),
    bcc: parseAddressList(getHeader(headers, "Bcc")),
    replyTo: parseAddressList(getHeader(headers, "Reply-To")),
    snippet: message.snippet,
    bodyPlain: body.plain,
    bodyHtml: body.html,
    sentAt: sentAt ?? internalDate,
    internalDate,
    metadata: {
      source: "gmail_api",
      historyId: message.historyId,
      labelIds: message.labelIds ?? [],
      sizeEstimate: message.sizeEstimate,
      messageIdHeader: getHeader(headers, "Message-ID"),
    },
    attachments: attachmentMetadataFromMessage(message),
  };
}

function parseAddressList(value?: string): MockAddress[] {
  if (!value) return [];
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const match = item.match(/^(?:"?([^"<]*)"?)?\s*<([^>]+)>$/);
      if (match) {
        return {
          name: match[1]?.trim() || undefined,
          email: match[2]?.trim(),
        };
      }
      if (item.includes("@")) return { email: item.replace(/^"|"$/g, "") };
      return { name: item.replace(/^"|"$/g, "") };
    });
}

function uniqueAddresses(addresses: MockAddress[]) {
  const seen = new Set<string>();
  const unique: MockAddress[] = [];
  for (const address of addresses) {
    const key = (address.email ?? address.name ?? "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(address);
  }
  return unique;
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function latestDate(values: Array<string | Date | undefined>) {
  const timestamps = values
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => !Number.isNaN(value));
  if (!timestamps.length) return undefined;
  return new Date(Math.max(...timestamps)).toISOString();
}
