import { EmailService } from './email.service';
export declare class EmailController {
    private readonly emailService;
    constructor(emailService: EmailService);
    getLatestBySubject(subject: string): Promise<import("./schemas/email.schema").Email | {
        error: string;
        message?: undefined;
    } | {
        message: string;
        error?: undefined;
    }>;
    list(): Promise<import("./schemas/email.schema").Email[]>;
}
