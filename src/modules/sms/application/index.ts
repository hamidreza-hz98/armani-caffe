import type { SmsTemplateMessage } from "../domain/index.ts";

export interface SmsSender {
  sendTemplate(message: SmsTemplateMessage): Promise<void>;
}

export class SmsService {
  constructor(private readonly sender: SmsSender) {}
  sendTemplate(message: SmsTemplateMessage) {
    return this.sender.sendTemplate(message);
  }
}
