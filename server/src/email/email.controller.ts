import { Controller, Get, Query } from '@nestjs/common';
import { EmailService } from './email.service';

@Controller('emails')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get('latest')
  async getLatestBySubject(@Query('subject') subject: string) {
    if (!subject) return { error: 'subject query param required' };
    const email = await this.emailService.findLatestBySubject(subject);
    return email || { message: 'No email found for subject' };
  }

  @Get()
  async list() {
    return this.emailService.list();
  }
}
