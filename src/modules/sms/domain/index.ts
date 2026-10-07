export type SmsTemplateMessage = Readonly<{
  mobile: string;
  templateId: number;
  parameters: readonly Readonly<{ name: string; value: string }>[];
}>;
