import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class DailyInsightDto {
  @IsDateString()
  date!: string;

  @IsNumber()
  @Min(0)
  salesRevenue!: number;

  @IsNumber()
  @Min(0)
  purchaseTotal!: number;

  @IsNumber()
  @Min(0)
  expenseTotal!: number;

  @IsInt()
  @Min(0)
  invoiceCount!: number;

  @IsNumber()
  @Min(0)
  taxCollected!: number;

  @IsOptional()
  @IsNumber()
  profitEstimate?: number;
}

export class PushInsightsDto {
  @IsString()
  deviceId!: string;

  @IsUUID()
  branchId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyInsightDto)
  insights!: DailyInsightDto[];
}
