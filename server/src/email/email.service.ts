import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Email, EmailDocument } from './schemas/email.schema';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  constructor(
    @InjectModel(Email.name) private emailModel: Model<EmailDocument>,
  ) {}

  async upsertByMessageId(doc: Partial<Email> & { messageId: string }): Promise<Email> {
    this.logger.debug(`Upserting email messageId="${doc.messageId}"`);
    return this.emailModel
      .findOneAndUpdate(
        { messageId: doc.messageId },
        { $set: doc },
        { upsert: true, new: true },
      )
      .lean<Email>()
      .exec();
  }

  async findLatestBySubject(subject: string): Promise<Email | null> {
    return this.emailModel.findOne({ subject }).sort({ createdAt: -1 }).lean<Email>().exec();
  }

  async list(limit = 50): Promise<Email[]> {
    return this.emailModel.find({}).sort({ createdAt: -1 }).limit(limit).lean<Email[]>().exec();
  }
}
