import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Model } from 'mongoose';
import { EmailDocument } from './schemas/email.schema';
export declare class ImapService implements OnModuleInit, OnModuleDestroy {
    private emailModel;
    private readonly logger;
    private client;
    private pollTimer;
    constructor(emailModel: Model<EmailDocument>);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    private buildOptions;
    private connect;
    private poll;
    private headersToObject;
    private extractReceivingChain;
    private detectEsp;
}
