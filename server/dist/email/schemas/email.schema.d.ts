import { HydratedDocument } from 'mongoose';
export type EmailDocument = HydratedDocument<Email>;
export type Hop = {
    by: string;
    from?: string;
    with?: string;
    id?: string;
    timestamp?: Date;
    delayMs?: number;
};
export declare class Email {
    subject: string;
    messageId: string;
    from: string;
    to?: string;
    receivingChain: Hop[];
    esp?: string;
    rawHeaders?: any;
    raw?: string;
}
export declare const EmailSchema: import("mongoose").Schema<Email, import("mongoose").Model<Email, any, any, any, import("mongoose").Document<unknown, any, Email, any, {}> & Email & {
    _id: import("mongoose").Types.ObjectId;
} & {
    __v: number;
}, any>, {}, {}, {}, {}, import("mongoose").DefaultSchemaOptions, Email, import("mongoose").Document<unknown, {}, import("mongoose").FlatRecord<Email>, {}, import("mongoose").ResolveSchemaOptions<import("mongoose").DefaultSchemaOptions>> & import("mongoose").FlatRecord<Email> & {
    _id: import("mongoose").Types.ObjectId;
} & {
    __v: number;
}>;
