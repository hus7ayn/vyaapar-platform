import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@nexus/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { HotelService } from './hotel.service';
import { FilesService } from '../files/files.service';

@ApiTags('hotel')
@ApiBearerAuth()
@Controller('hotel')
@UseGuards(PermissionsGuard)
export class HotelController {
  constructor(
    private hotel: HotelService,
    private files: FilesService,
  ) {}

  @Get('rooms')
  @RequirePermissions(Permission.HOTEL_VIEW)
  getRooms(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @Query('branchId') queryBranchId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.hotel.getRooms(businessId, queryBranchId || branchId, { status, from, to });
  }

  @Post('rooms')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  createRoom(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @Body()
    body: {
      roomNumber: string;
      categoryId: string;
      floor?: number;
      notes?: string;
      status?: string;
      price?: number;
    },
    @Query('branchId') queryBranchId?: string,
  ) {
    return this.hotel.createRoom(businessId, queryBranchId || branchId, body);
  }

  @Patch('rooms/:id')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  updateRoom(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body()
    body: {
      roomNumber?: string;
      categoryId?: string;
      floor?: number;
      notes?: string;
      status?: string;
      price?: number;
    },
  ) {
    return this.hotel.updateRoom(businessId, id, body);
  }

  @Get('room-categories')
  @RequirePermissions(Permission.HOTEL_VIEW)
  getCategories(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @Query('branchId') queryBranchId?: string,
  ) {
    return this.hotel.getRoomCategories(businessId, queryBranchId || branchId);
  }

  @Get('reservations')
  @RequirePermissions(Permission.HOTEL_VIEW)
  async getReservations(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @Query('status') status?: string,
    @Query('branchId') queryBranchId?: string,
  ) {
    const reservations = await this.hotel.getReservations(businessId, status, queryBranchId || branchId);
    return reservations.map(res => {
      if (res.guest?.aadhaarDocUrl) {
        (res.guest as any).documentPublicUrl = this.files.getPublicUrl(res.guest.aadhaarDocUrl);
      }
      return res;
    });
  }

  @Get('guests')
  @RequirePermissions(Permission.HOTEL_VIEW)
  async getGuests(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @Query('search') search?: string,
    @Query('branchId') queryBranchId?: string,
  ) {
    const guests = await this.hotel.getGuests(businessId, search, queryBranchId || branchId);
    return guests.map((guest: any) => {
      if (guest.aadhaarDocUrl) {
        guest.documentPublicUrl = this.files.getPublicUrl(guest.aadhaarDocUrl);
      }
      return guest;
    });
  }

  @Post('check-in')
  @RequirePermissions(Permission.HOTEL_CHECKIN)
  checkIn(@CurrentUser('businessId') businessId: string, @Body() body: never) {
    return this.hotel.checkIn(businessId, body);
  }

  @Post('check-out/:id')
  @RequirePermissions(Permission.HOTEL_CHECKOUT)
  checkOut(@CurrentUser('businessId') businessId: string, @Param('id') id: string) {
    return this.hotel.checkOut(businessId, id);
  }

  @Get('calendar')
  @RequirePermissions(Permission.HOTEL_VIEW)
  calendar(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') queryBranchId?: string,
  ) {
    return this.hotel.getCalendar(businessId, from, to, queryBranchId || branchId);
  }

  @Post('reservations')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  createReservation(@CurrentUser('businessId') businessId: string, @Body() body: never) {
    return this.hotel.createReservation(businessId, body);
  }

  @Patch('reservations/:id')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  updateReservation(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: never,
  ) {
    return this.hotel.updateReservation(businessId, id, body);
  }

  @Post('reservations/:id/folio')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  addFolioCharge(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { description: string; amount: number; chargeType?: string; itemId?: string; quantity?: number },
  ) {
    return this.hotel.addFolioCharge(businessId, id, body);
  }

  @Post('reservations/:id/cancel')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  cancel(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { cancellationFee?: number; refundAmount?: number },
  ) {
    return this.hotel.cancelReservation(businessId, id, body);
  }

  @Post('guest-document')
  @RequirePermissions(Permission.HOTEL_AADHAAR)
  @UseInterceptors(FileInterceptor('file'))
  async uploadGuestDocument(@UploadedFile() file: Express.Multer.File) {
    const uploaded = await this.files.upload(file, 'guest-id');
    return { documentUrl: uploaded.key };
  }

  @Post('room-categories')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  createCategory(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @Body() body: { name: string; description?: string; basePrice: number; maxGuests?: number; amenities?: string[] },
    @Query('branchId') queryBranchId?: string,
  ) {
    return this.hotel.createRoomCategory(businessId, queryBranchId || branchId, body);
  }

  @Patch('room-categories/:id')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  updateCategory(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; basePrice?: number; maxGuests?: number; amenities?: string[] },
  ) {
    return this.hotel.updateRoomCategory(businessId, id, body);
  }

  @Post('reservations/:id/payments')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  addFolioPayment(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
    @Body() body: { method: string; amount: number; reference?: string },
  ) {
    return this.hotel.addFolioPayment(businessId, id, body);
  }

  @Get('reservations/:id/payments')
  @RequirePermissions(Permission.HOTEL_VIEW)
  getFolioPayments(
    @CurrentUser('businessId') businessId: string,
    @Param('id') id: string,
  ) {
    return this.hotel.getFolioPayments(businessId, id);
  }

  @Post('night-audit')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  runNightAudit(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @CurrentUser('sub') userId: string,
    @Query('branchId') queryBranchId?: string,
  ) {
    return this.hotel.runNightAudit(businessId, queryBranchId || branchId, userId);
  }

  @Get('night-audit')
  @RequirePermissions(Permission.HOTEL_VIEW)
  getNightAudits(
    @CurrentUser('businessId') businessId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.hotel.getNightAudits(businessId, branchId);
  }

  @Post('room-rates')
  @RequirePermissions(Permission.HOTEL_MANAGE)
  setRoomRate(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @Body() body: { categoryId: string; rateDate: string; rate: number },
    @Query('branchId') queryBranchId?: string,
  ) {
    return this.hotel.setRoomRate(businessId, queryBranchId || branchId, body);
  }

  @Get('room-rates')
  @RequirePermissions(Permission.HOTEL_VIEW)
  getRoomRates(
    @CurrentUser('businessId') businessId: string,
    @CurrentUser('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') queryBranchId?: string,
  ) {
    return this.hotel.getRoomRates(businessId, queryBranchId || branchId, from, to);
  }

  @Get('revenue-metrics')
  @RequirePermissions(Permission.HOTEL_VIEW)
  getRevenueMetrics(
    @CurrentUser('businessId') businessId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.hotel.getRevenueMetrics(businessId, branchId);
  }
}
