import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ImapFlow, ImapFlowOptions } from 'imapflow';
import { simpleParser } from 'mailparser';
import { Model } from 'mongoose';
import { Email, EmailDocument, Hop } from './schemas/email.schema';

@Injectable()
export class ImapService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImapService.name);
  private client: ImapFlow | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(Email.name) private emailModel: Model<EmailDocument>,
  ) {}

  async onModuleInit() {
    if (!process.env.IMAP_HOST) {
      this.logger.warn('IMAP not configured; skipping connect. Define IMAP_* env vars to enable.');
      return;
    }
    await this.connect();
    const interval = Number(process.env.POLL_INTERVAL_MS || 15000);
    this.pollTimer = setInterval(() => this.poll(), Math.max(5000, interval));
  }

  async onModuleDestroy() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.client) await this.client.logout().catch(() => {});
  }

  private buildOptions(): ImapFlowOptions {
    return {
      host: process.env.IMAP_HOST!,
      port: Number(process.env.IMAP_PORT || 993),
      secure: String(process.env.IMAP_SECURE || 'true') === 'true',
      auth: {
        user: process.env.IMAP_USER!,
        pass: process.env.IMAP_PASSWORD!,
      },
      logger: false,
    };
  }

  private async connect() {
    this.client = new ImapFlow(this.buildOptions());
    this.client.on('error', (err) => this.logger.error('IMAP error', err.stack || err.message));
    await this.client.connect();
    const mailbox = process.env.IMAP_MAILBOX || 'INBOX';
    await this.client.mailboxOpen(mailbox).catch(async () => {
      this.logger.warn(`Mailbox ${mailbox} not found. Trying INBOX.`);
      await this.client!.mailboxOpen('INBOX');
    });
    this.logger.log('IMAP connected and mailbox opened');
  }

  private async poll() {
    try {
      if (!this.client) await this.connect();
      try {
        // Ensure mailbox is open; reconnect on failure
        await this.client!.mailboxOpen(process.env.IMAP_MAILBOX || 'INBOX');
      } catch {
        await this.connect();
      }
      const subjectPrefix = process.env.TEST_SUBJECT_PREFIX || '[ESP-TEST]';
      const searchCriteria = {
        or: [
          ['HEADER', 'Subject', subjectPrefix],
          ['OR', ['HEADER', 'Subject', subjectPrefix], ['HEADER', 'Subject', subjectPrefix]],
        ],
      };

      const lock = await this.client!.getMailboxLock('INBOX');
      try {
        for await (const msg of this.client!.fetch({ seen: false }, { source: true, envelope: true, internalDate: true, headers: true })) {
          const subject = msg.envelope?.subject || '';
          if (!subject.includes(subjectPrefix)) continue;
          const raw = msg.source?.toString('utf-8') || '';
          const parsed = await simpleParser(raw);
          const messageId = parsed.messageId || msg.envelope?.messageId || `${Date.now()}-${Math.random()}`;
          const from = parsed.from?.text || msg.envelope?.from?.map((a) => `${a.name || ''} <${a.address}>`).join(',') || '';
          const to = parsed.to?.text || msg.envelope?.to?.map((a) => `${a.name || ''} <${a.address}>`).join(',') || '';

          const hdrs = this.headersToObject(parsed.headerLines);
          const hops = this.extractReceivingChain(hdrs);
          const esp = this.detectEsp(hdrs, parsed.headers);

          await this.emailModel
            .findOneAndUpdate(
              { messageId },
              {
                $set: {
                  subject,
                  messageId,
                  from,
                  to,
                  raw,
                  rawHeaders: hdrs,
                  receivingChain: hops,
                  esp,
                },
              },
              { upsert: true, new: true },
            )
            .exec();
        }
      } finally {
        lock.release();
      }
    } catch (err: any) {
      this.logger.error('Poll error', err.stack || err.message);
    }
  }

  private headersToObject(headerLines: { key: string; line: string }[]) {
    const obj: Record<string, string[]> = {};
    for (const { key, line } of headerLines) {
      const k = key.toLowerCase();
      if (!obj[k]) obj[k] = [];
      obj[k].push(line.substring(line.indexOf(':') + 1).trim());
    }
    return obj;
  }

  private extractReceivingChain(headers: Record<string, string[]>) : Hop[] {
    const received = headers['received'] || [];
    const hops: Hop[] = [];
    let prevTime: Date | undefined;
    for (const r of received) {
      const hop: Hop = { by: '', from: undefined, with: undefined, id: undefined, timestamp: undefined, delayMs: undefined };
      // Basic parse: from X by Y with Z id ID; DATE
      const fromMatch = /from\s+([^;]+?)\s+by\s+/i.exec(r);
      const byMatch = /by\s+([^;]+?)(\s+with|\s+id|;|\(|$)/i.exec(r);
      const withMatch = /with\s+([^;]+?)(\s+id|;|\(|$)/i.exec(r);
      const idMatch = /id\s+([^;\s]+)(;|\s|\(|$)/i.exec(r);
      const dateMatch = /;\s*(.*)$/.exec(r);
      hop.from = fromMatch?.[1]?.trim();
      hop.by = byMatch?.[1]?.trim() || '';
      hop.with = withMatch?.[1]?.trim();
      hop.id = idMatch?.[1]?.trim();
      if (dateMatch?.[1]) {
        const t = new Date(dateMatch[1]);
        if (!isNaN(t.getTime())) hop.timestamp = t;
      }
      if (hop.timestamp && prevTime) hop.delayMs = Math.max(0, prevTime.getTime() - hop.timestamp.getTime());
      prevTime = hop.timestamp || prevTime;
      hops.push(hop);
    }
    // Reverse to show first hop -> last hop
    return hops.reverse();
  }

  private detectEsp(headers: Record<string, string[]>, map: Map<string, string>): string | undefined {
    const h = (name: string) => (headers[name.toLowerCase()] || []).join('\n');
    const lowerAll = Object.entries(headers).map(([k, v]) => `${k}: ${v.join('\n')}`).join('\n').toLowerCase();

    if (/amazonses|amazon ses|ses-[a-z0-9.-]+/i.test(lowerAll) || /ses\.amazonaws\.com/i.test(lowerAll)) return 'Amazon SES';
    if (/sendgrid|x-sg-emea|sg-mail\.com/i.test(lowerAll)) return 'SendGrid';
    if (/mailgun|mx\.mailgun\.net|x-mailgun/i.test(lowerAll)) return 'Mailgun';
    if (/sparkpost|x-msys/i.test(lowerAll)) return 'SparkPost';
    if (/postmark|x-pm-/i.test(lowerAll)) return 'Postmark';
    if (/sendinblue|brevo|x-mailin/i.test(lowerAll)) return 'Brevo (Sendinblue)';
    if (/zoho\.com|zoho mail/i.test(lowerAll)) return 'Zoho Mail';
    if (/gmail\.com|google\.com|mail\.google\.com|x-gm-/i.test(lowerAll)) return 'Gmail';
    if (/outlook\.com|exchange|microsoft\.com|x-ms-/i.test(lowerAll)) return 'Outlook/Exchange';
    if (/yahoo\.com|x-yahoo-/i.test(lowerAll)) return 'Yahoo Mail';
    if (/sendpulse|x-smtpapi/i.test(lowerAll)) return 'SendPulse';

    // Heuristics using 'Received' tokens
    const received = headers['received']?.join('\n').toLowerCase() || '';
    if (received.includes('amazonses.com') || received.includes('ses.amazonaws.com')) return 'Amazon SES';
    if (received.includes('sendgrid.net')) return 'SendGrid';
    if (received.includes('mailgun.net')) return 'Mailgun';

    return undefined;
  }
}
