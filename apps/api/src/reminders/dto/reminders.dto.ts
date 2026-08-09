import { IsDateString, IsOptional } from 'class-validator';

export class GenerateRemindersDto {
  /** The day the shopkeeper wants to chase these dues. Defaults to a week out when omitted. */
  @IsOptional()
  @IsDateString()
  remindOn?: string;
}

export class RescheduleReminderDto {
  @IsDateString()
  remindOn!: string;
}
