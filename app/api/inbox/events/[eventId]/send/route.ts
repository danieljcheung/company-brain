import { externalWritesAllowed, externalWritesBlockedResponse, isSafetyModeActive } from "@/app/lib/integrations/safety";
import { InboxActionType, InboxDraftStatus, InboxEventStatus, GmailConnectionStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { requireMutationAuth } from "@/app/lib/apiAuth";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailableResponse,
  getDefaultContext,
  hasDatabaseUrl,
} from "../../../../brain/_shared";
import { getConnectedGmailConnection, getReadOnlyGmailAccessToken, sendGmailMessage } from "@/app/lib/integrations/gmail/client";
import { createInboxAction } from "@/app/lib/inbox/manualImport";

type SendRouteContext = {
  params: Promise<{ eventId: string }>;
};

type Participant = { name?: string; email: string };

export async function POST(request: NextRequest, context: SendRouteContext) {
  if (!hasDatabaseUrl()) return databaseUnavailableResponse();
  const unauthorized = await requireMutationAuth();
  if (unauthorized) return unauthorized;
  if (await isSafetyModeActive()) {
    return NextResponse.json(
      { error: "Blocked: External writes are disabled while Safety Mode is active." },
      { status: 403 },
    );
  }
  if (!externalWritesAllowed()) {
    return NextResponse.json(externalWritesBlockedResponse("Gmail send"), { status: 403 });
  }



  const { eventId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as { body?: unknown };
  const editedBody = typeof payload.body === "string" ? payload.body : null;


  try {
    const { company, reviewer } = await getDefaultContext();

    // 1. Find the event
    const event = await prisma.inboxEvent.findFirst({
      where: { id: eventId, companyId: company.id },
      include: {
        thread: true,
        drafts: {
          where: { status: InboxDraftStatus.DRAFT },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!event) {
      return NextResponse.json({ error: "Inbox event not found." }, { status: 404 });
    }

    const draft = event.drafts[0];
    if (!draft) {
      return NextResponse.json({ error: "No active draft found for this event." }, { status: 404 });
    }

    if (editedBody !== null) {
      await prisma.inboxDraft.update({
        where: { id: draft.id },
        data: { body: editedBody },
      });
      draft.body = editedBody;
    }

    // 2. Fetch connection
    const connection = await getConnectedGmailConnection(company.id);
    if (!connection || connection.status !== GmailConnectionStatus.CONNECTED) {
      return NextResponse.json({ error: "Gmail is not connected. Connect Gmail in settings first." }, { status: 400 });
    }

    const connectionEmail = connection.email || "";

    // 3. Obtain access token
    const accessToken = await getReadOnlyGmailAccessToken(connection);
    if (!accessToken) {
      return NextResponse.json({ error: "Failed to retrieve Gmail access token." }, { status: 400 });
    }

    // 4. Resolve recipient
    let recipientEmail: string | undefined = undefined;
    let recipientName: string | undefined = undefined;

    const extracted = event.extractedFields;
    if (extracted && typeof extracted === "object") {
      if ("customerEmail" in extracted && typeof (extracted as { customerEmail: unknown }).customerEmail === "string") {
        const emailVal = (extracted as { customerEmail: string }).customerEmail.trim();
        if (emailVal.includes("@")) {
          recipientEmail = emailVal;
        }
      }
      if ("customerName" in extracted && typeof (extracted as { customerName: unknown }).customerName === "string") {
        const nameVal = (extracted as { customerName: string }).customerName.trim();
        if (nameVal) {
          recipientName = nameVal;
        }
      }
    }

    const rawParticipants = event.thread.participants;
    let participants: Participant[] = [];
    if (Array.isArray(rawParticipants)) {
      participants = rawParticipants.filter(
        (p): p is Participant =>
          typeof p === "object" &&
          p !== null &&
          "email" in p &&
          typeof (p as { email: unknown }).email === "string"
      );
    }

    const recipient: Participant = recipientEmail
      ? { name: recipientName || "Customer", email: recipientEmail }
      : participants.find((p) => p.email.toLowerCase() !== connectionEmail.toLowerCase()) || participants[0];

    if (!recipient) {
      return NextResponse.json({ error: "No recipient address found in thread." }, { status: 400 });
    }

    // 5. Subject
    let subject = event.thread.subject;
    if (!subject.toLowerCase().startsWith("re:")) {
      subject = `Re: ${subject}`;
    }

    // 6. Threading headers
    const latestMessage = await prisma.gmailMessage.findFirst({
      where: { threadId: event.thread.id },
      orderBy: { sentAt: "desc" },
    });

    let messageIdHeader: string | undefined = undefined;
    const metadata = latestMessage?.metadata;
    if (metadata && typeof metadata === "object" && "messageIdHeader" in metadata) {
      const header = (metadata as { messageIdHeader: unknown }).messageIdHeader;
      if (typeof header === "string") {
        messageIdHeader = header;
      }
    }

    const escapeHtml = (text: string) => {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };

    let bodyHtml = escapeHtml(draft.body).replace(/\n/g, "<br />");
    const footer = process.env.GMAIL_FOOTER?.trim();
    if (footer) {
      if (footer.startsWith("http")) {
        bodyHtml = `${bodyHtml}<br /><br /><img src="${footer}" alt="Popup Pearl Team" />`;
      } else {
        const cleanFooter = escapeHtml(footer.replace(/\\n/g, "\n")).replace(/\n/g, "<br />");
        bodyHtml = `${bodyHtml}<br /><br />--<br />${cleanFooter}`;
      }
    }

    // 7. Send the email via Gmail API (slow external I/O call outside transaction)
    const sendResult = await sendGmailMessage(accessToken, {
      from: connectionEmail,
      to: recipient.email,
      subject,
      body: bodyHtml,
      threadId: event.thread.gmailThreadId,
      inReplyTo: messageIdHeader,
      references: messageIdHeader,
    });

    // Google returned ID
    const gmailMessageId = typeof sendResult === "object" && sendResult !== null && "id" in sendResult && typeof (sendResult as { id: unknown }).id === "string"
      ? (sendResult as { id: string }).id
      : `sent-${Date.now()}`;

    // 8. DB Writes inside transaction (fast local DB operations)
    await prisma.$transaction(async (tx) => {
      const sentMessage = await tx.gmailMessage.create({
        data: {
          threadId: event.thread.id,
          gmailMessageId,
          subject,
          from: { email: connectionEmail, name: "Popup Pearl" },
          to: [recipient],
          sentAt: new Date(),
          snippet: draft.body.slice(0, 100),
          bodyPlain: draft.body,
          bodyHtml: bodyHtml,
          metadata: {
            source: "gmail_api_sent",
            messageIdHeader: gmailMessageId,
          },
        },
      });

      // Update event status
      await tx.inboxEvent.update({
        where: { id: event.id },
        data: {
          status: InboxEventStatus.AWAITING_CUSTOMER,
        },
      });

      // Approve/mark draft sent
      await tx.inboxDraft.update({
        where: { id: draft.id },
        data: {
          status: InboxDraftStatus.SENT,
          approvedAt: new Date(),
          approvedById: reviewer.id,
        },
      });

      // Create action log
      await createInboxAction(tx, {
        eventId: event.id,
        messageId: sentMessage.id,
        draftId: draft.id,
        actorId: reviewer.id,
        actionType: InboxActionType.EMAIL_SENT,
        note: `Approved and sent reply email to ${recipient.email}.`,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send draft reply." },
      { status: 500 },
    );
  }
}
