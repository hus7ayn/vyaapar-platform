import { Controller, Get, Param, Post, Body, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { ReceiptsService } from './receipts.service';

@ApiTags('receipts')
@ApiBearerAuth()
@Controller('receipts')
@UseGuards(PermissionsGuard)
export class ReceiptsController {
  constructor(private receipts: ReceiptsService) {}

  @Get(':orderId/thermal')
  @RequirePermissions(Permission.POS_SELL)
  async thermal(
    @CurrentUser('businessId') businessId: string,
    @Param('orderId') orderId: string,
  ) {
    const text = await this.receipts.generateThermal(orderId, businessId);
    return { format: 'thermal', content: text };
  }

  @Get(':orderId/pdf')
  @RequirePermissions(Permission.POS_SELL)
  async pdf(
    @CurrentUser('businessId') businessId: string,
    @Param('orderId') orderId: string,
    @Res() res: Response,
  ) {
    const buffer = await this.receipts.generatePdf(orderId, businessId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${orderId}.pdf`);
    res.send(buffer);
  }

  @Post(':orderId/whatsapp')
  @RequirePermissions(Permission.POS_SELL)
  whatsapp(
    @CurrentUser('businessId') businessId: string,
    @Param('orderId') orderId: string,
    @Body() body: { phone: string },
  ) {
    return this.receipts.sendWhatsApp(orderId, businessId, body.phone);
  }

  @Post(':orderId/email')
  @RequirePermissions(Permission.POS_SELL)
  email(
    @CurrentUser('businessId') businessId: string,
    @Param('orderId') orderId: string,
    @Body() body: { email: string },
  ) {
    return this.receipts.sendEmail(orderId, businessId, body.email);
  }
}
