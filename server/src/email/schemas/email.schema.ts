import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
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

@Schema({ timestamps: true })
export class Email {
  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  messageId: string;

  @Prop({ required: true })
  from: string;

  @Prop({ required: false })
  to?: string;

  @Prop({ type: [Object], default: [] })
  receivingChain: Hop[];

  @Prop({ required: false })
  esp?: string;

  @Prop({ type: Object })
  rawHeaders?: any;

  @Prop({ type: String })
  raw?: string;
}

export const EmailSchema = SchemaFactory.createForClass(Email);
