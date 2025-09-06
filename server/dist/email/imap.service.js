"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ImapService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImapService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const imapflow_1 = require("imapflow");
const mailparser_1 = require("mailparser");
const mongoose_2 = require("mongoose");
const email_schema_1 = require("./schemas/email.schema");
let ImapService = ImapService_1 = class ImapService {
    emailModel;
    logger = new common_1.Logger(ImapService_1.name);
    client = null;
    pollTimer = null;
    constructor(emailModel) {
        this.emailModel = emailModel;
    }
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
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        if (this.client)
            await this.client.logout().catch(() => { });
    }
    buildOptions() {
        return {
            host: process.env.IMAP_HOST,
            port: Number(process.env.IMAP_PORT || 993),
            secure: String(process.env.IMAP_SECURE || 'true') === 'true',
            auth: {
                user: process.env.IMAP_USER,
                pass: process.env.IMAP_PASSWORD,
            },
            logger: false,
        };
    }
    async connect() {
        this.client = new imapflow_1.ImapFlow(this.buildOptions());
        this.client.on('error', (err) => this.logger.error('IMAP error', err.stack || err.message));
        await this.client.connect();
        const mailbox = process.env.IMAP_MAILBOX || 'INBOX';
        await this.client.mailboxOpen(mailbox).catch(async () => {
            this.logger.warn(`Mailbox ${mailbox} not found. Trying INBOX.`);
            await this.client.mailboxOpen('INBOX');
        });
        this.logger.log('IMAP connected and mailbox opened');
    }
    async poll() {
        try {
            if (!this.client)
                await this.connect();
            try {
                await this.client.mailboxOpen(process.env.IMAP_MAILBOX || 'INBOX');
            }
            catch {
                await this.connect();
            }
            const subjectPrefix = process.env.TEST_SUBJECT_PREFIX || '[ESP-TEST]';
            const searchCriteria = {
                or: [
                    ['HEADER', 'Subject', subjectPrefix],
                    ['OR', ['HEADER', 'Subject', subjectPrefix], ['HEADER', 'Subject', subjectPrefix]],
                ],
            };
            const lock = await this.client.getMailboxLock('INBOX');
            try {
                for await (const msg of this.client.fetch({ seen: false }, { source: true, envelope: true, internalDate: true, headers: true })) {
                    const subject = msg.envelope?.subject || '';
                    if (!subject.includes(subjectPrefix))
                        continue;
                    const raw = msg.source?.toString('utf-8') || '';
                    const parsed = await (0, mailparser_1.simpleParser)(raw);
                    const messageId = parsed.messageId || msg.envelope?.messageId || `${Date.now()}-${Math.random()}`;
                    const from = parsed.from?.text || msg.envelope?.from?.map((a) => `${a.name || ''} <${a.address}>`).join(',') || '';
                    const to = parsed.to?.text || msg.envelope?.to?.map((a) => `${a.name || ''} <${a.address}>`).join(',') || '';
                    const hdrs = this.headersToObject(parsed.headerLines);
                    const hops = this.extractReceivingChain(hdrs);
                    const esp = this.detectEsp(hdrs, parsed.headers);
                    await this.emailModel
                        .findOneAndUpdate({ messageId }, {
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
                    }, { upsert: true, new: true })
                        .exec();
                }
            }
            finally {
                lock.release();
            }
        }
        catch (err) {
            this.logger.error('Poll error', err.stack || err.message);
        }
    }
    headersToObject(headerLines) {
        const obj = {};
        for (const { key, line } of headerLines) {
            const k = key.toLowerCase();
            if (!obj[k])
                obj[k] = [];
            obj[k].push(line.substring(line.indexOf(':') + 1).trim());
        }
        return obj;
    }
    extractReceivingChain(headers) {
        const received = headers['received'] || [];
        const hops = [];
        let prevTime;
        for (const r of received) {
            const hop = { by: '', from: undefined, with: undefined, id: undefined, timestamp: undefined, delayMs: undefined };
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
                if (!isNaN(t.getTime()))
                    hop.timestamp = t;
            }
            if (hop.timestamp && prevTime)
                hop.delayMs = Math.max(0, prevTime.getTime() - hop.timestamp.getTime());
            prevTime = hop.timestamp || prevTime;
            hops.push(hop);
        }
        return hops.reverse();
    }
    detectEsp(headers, map) {
        const h = (name) => (headers[name.toLowerCase()] || []).join('\n');
        const lowerAll = Object.entries(headers).map(([k, v]) => `${k}: ${v.join('\n')}`).join('\n').toLowerCase();
        if (/amazonses|amazon ses|ses-[a-z0-9.-]+/i.test(lowerAll) || /ses\.amazonaws\.com/i.test(lowerAll))
            return 'Amazon SES';
        if (/sendgrid|x-sg-emea|sg-mail\.com/i.test(lowerAll))
            return 'SendGrid';
        if (/mailgun|mx\.mailgun\.net|x-mailgun/i.test(lowerAll))
            return 'Mailgun';
        if (/sparkpost|x-msys/i.test(lowerAll))
            return 'SparkPost';
        if (/postmark|x-pm-/i.test(lowerAll))
            return 'Postmark';
        if (/sendinblue|brevo|x-mailin/i.test(lowerAll))
            return 'Brevo (Sendinblue)';
        if (/zoho\.com|zoho mail/i.test(lowerAll))
            return 'Zoho Mail';
        if (/gmail\.com|google\.com|mail\.google\.com|x-gm-/i.test(lowerAll))
            return 'Gmail';
        if (/outlook\.com|exchange|microsoft\.com|x-ms-/i.test(lowerAll))
            return 'Outlook/Exchange';
        if (/yahoo\.com|x-yahoo-/i.test(lowerAll))
            return 'Yahoo Mail';
        if (/sendpulse|x-smtpapi/i.test(lowerAll))
            return 'SendPulse';
        const received = headers['received']?.join('\n').toLowerCase() || '';
        if (received.includes('amazonses.com') || received.includes('ses.amazonaws.com'))
            return 'Amazon SES';
        if (received.includes('sendgrid.net'))
            return 'SendGrid';
        if (received.includes('mailgun.net'))
            return 'Mailgun';
        return undefined;
    }
};
exports.ImapService = ImapService;
exports.ImapService = ImapService = ImapService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)(email_schema_1.Email.name)),
    __metadata("design:paramtypes", [mongoose_2.Model])
], ImapService);
//# sourceMappingURL=imap.service.js.map