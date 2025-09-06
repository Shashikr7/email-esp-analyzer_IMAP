import { Model } from 'mongoose';
import { Email, EmailDocument } from './schemas/email.schema';
export declare class EmailService {
    private emailModel;
    private readonly logger;
    constructor(emailModel: Model<EmailDocument>);
    upsertByMessageId(doc: Partial<Email> & {
        messageId: string;
    }): Promise<Email>;
    findLatestBySubject(subject: string): Promise<Email | null>;
    list(limit?: number): Promise<Email[]>;
}
